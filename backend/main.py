from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS
import paho.mqtt.client as mqtt
import os
import json
import time
import threading
from datetime import datetime

app = FastAPI(title="VaSafe Digital Twin API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- CONFIGURAÇÕES DE AMBIENTE ---
MQTT_BROKER = os.getenv("MQTT_BROKER", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
INFLUX_URL = os.getenv("INFLUX_URL", "http://influxdb:8086")
INFLUX_TOKEN = os.getenv("INFLUX_TOKEN", os.getenv("DOCKER_INFLUXDB_INIT_ADMIN_TOKEN", "token-secreto"))
INFLUX_ORG = os.getenv("INFLUX_ORG", "ufsvasafe")
INFLUX_BUCKET = os.getenv("INFLUX_BUCKET", "telemetria")
USERS_FILE = "users.json"

# --- SETUP INFLUXDB ---
print(f"🔌 Conectando ao InfluxDB em {INFLUX_URL}...")
influx_client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG, timeout=20000)
write_api = influx_client.write_api(write_options=SYNCHRONOUS)
query_api = influx_client.query_api()

# --- SETUP MQTT ---
mqtt_client = mqtt.Client(client_id="vasafe-backend-api", protocol=mqtt.MQTTv311)

# --- FUNÇÕES DE USUÁRIO ---
def load_users():
    if not os.path.exists(USERS_FILE):
        return {"admin": "admin"}
    try:
        with open(USERS_FILE, 'r') as f:
            return json.load(f)
    except:
        return {"admin": "admin"}

def save_new_user(usuario, senha):
    users = load_users()
    if usuario in users:
        return False
    users[usuario] = senha
    with open(USERS_FILE, 'w') as f:
        json.dump(users, f)
    return True

# --- LÓGICA DE SAÚDE DO LOTE ---
def calcular_saude_lote(historico):
    # Lógica Offline: Se não tem dados, retorna None para o front ficar Cinza
    if not historico:
        return None, "AGUARDANDO", "#cbd5e1", "Aguardando conexão..."

    dado_atual = historico[0]

    # 1. Checagem de Fraude/Violação (Prioridade Máxima -> Preto)
    if dado_atual.get("violacao"):
        return 0, "FRAUDE", "#000000", "Violação detectada pelo Sensor!"

    # 2. Cálculo de Saúde
    saude = 100.0

    temp = dado_atual.get("temperatura", 0) or 0

    # Penalidade por temperatura (ex: fora de 2°C a 8°C)
    if temp > 8 or temp < 2:
        saude -= 20

    # Penalidade por tampa aberta
    if dado_atual.get("tampa_aberta"):
        saude -= 10

    # Limites (0 a 100)
    saude = max(0, min(saude, 100))

    # 3. Definição do Status Visual e Cores para o Dashboard
    if dado_atual.get("violacao"):
        return 0, "FRAUDE", "#000000", "Violação Crítica!"
    elif dado_atual.get("tampa_aberta"):
        return saude, "ALERTA", "#eab308", "Tampa Aberta!"
    elif saude < 60:
        return saude, "RISCO", "#ef4444", "Condições críticas."
    elif temp > 7 or temp < 3:
        return saude, "ATENÇÃO", "#eab308", "Temperatura oscilando."
    else:
        return saude, "APROVADO", "#22c55e", "Condições ideais."

# --- CALLBACKS MQTT ---
def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("✅ MQTT conectado com sucesso!")
        client.subscribe("vasafe/+/telemetria")
    else:
        print(f"❌ Falha ao conectar no MQTT. Código: {rc}")

def on_message(client, userdata, msg):
    try:
        # 1. Pega a string bruta
        raw_msg = msg.payload.decode().strip()

        # 2. FILTRAGEM DE LOGS DO SISTEMA
        if ">>>" in raw_msg or "DESLIGANDO" in raw_msg:
            return

        # 3. LIMPEZA DA STRING
        clean_msg = raw_msg.replace("[BUFFER]", "").replace("Upload:", "").strip()

        # 4. EXTRAÇÃO DO JSON PURO
        idx_inicio = clean_msg.find('{')
        idx_fim = clean_msg.rfind('}')

        if idx_inicio != -1 and idx_fim != -1:
            clean_msg = clean_msg[idx_inicio : idx_fim + 1]
        else:
            # Se não tiver chaves {}, não é um dado válido
            return

        # 5. CONVERSÃO PARA JSON
        payload = json.loads(clean_msg)
        print(f"📥 [MQTT] ID: {payload.get('box_id')} | Temp: {payload.get('temperatura')} | Bat: {payload.get('bateria')}")

        # Extração segura dos dados
        box_id = payload.get("box_id", "unknown")
        temperatura = float(payload.get("temperatura", 0))
        tampa_aberta = bool(payload.get("aberta", False))
        luz = payload.get("luz", None)
        bateria_val = payload.get("bateria", None)

        # tenta convertir quando possível
        try:
            luz = int(luz) if luz is not None else None
        except:
            luz = None

        try:
            bateria = int(bateria_val) if bateria_val is not None else None
        except:
            bateria = None

        # Define violação (pode vir no JSON como 'alerta' ou calculamos aqui)
        alerta = payload.get("alerta", "")
        violacao = (alerta == "EVENTO_CRITICO")

        # 6. GRAVAÇÃO NO INFLUXDB
        # Escrevemos todos os fields possíveis; se algum for None, escrevemos 0 para compatibilidade,
        # porque algumas versões do Influx/Point não aceitam None como field value.
        # (Mas a API vai preservar None quando não houver registros para montar histórico.)
        point = (
            Point("telemetria")
            .tag("lote", box_id)
            .field("temperatura", temperatura)
            .field("tampa_aberta", tampa_aberta)
        )

        # Adiciona luz/bateria apenas se forem numéricos; caso contrário grava 0 para manter consistência
        if luz is not None:
            point = point.field("luz", luz)
        else:
            point = point.field("luz", 0)

        if bateria is not None:
            point = point.field("bateria", bateria)
        else:
            point = point.field("bateria", 0)

        point = point.field("violacao", violacao).time(datetime.utcnow())

        write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=point)

    except json.JSONDecodeError:
        print(f"❌ Erro JSON. Recebido: {msg.payload.decode()}")
    except Exception as e:
        print(f"❌ Erro processamento: {e}")

mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message

def iniciar_mqtt():
    while True:
        try:
            print(f"📡 Conectando ao MQTT: {MQTT_BROKER}:{MQTT_PORT}")
            mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
            mqtt_client.loop_forever()
        except Exception as e:
            print(f"⚠️ Erro MQTT: {e}. Retentando em 5s...")
            time.sleep(5)

@app.on_event("startup")
def startup():
    threading.Thread(target=iniciar_mqtt, daemon=True).start()

# --- ENDPOINTS ---

@app.get("/analise/{lote}")
def analise_lote(lote: str):
    # Query: Busca dados, incluindo Luz e Bateria
    query = f'''
    from(bucket: "{INFLUX_BUCKET}")
      |> range(start: -24h)
      |> filter(fn: (r) => r["_measurement"] == "telemetria")
      |> filter(fn: (r) => r["lote"] == "{lote}")
      |> pivot(rowKey:["_time"], columnKey:["_field"], valueColumn:"_value")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: 50)
    '''

    try:
        result = query_api.query(query=query, org=INFLUX_ORG)
        historico = []

        for table in result:
            for r in table.records:
                # Usa .get() para evitar erro se o campo não existir em registros antigos
                bateria_raw = r.get("bateria")
                luz_raw = r.get("luz")

                try:
                    bateria_val = int(bateria_raw) if bateria_raw is not None else None
                except:
                    bateria_val = None

                try:
                    luz_val = int(luz_raw) if luz_raw is not None else None
                except:
                    luz_val = None

                historico.append({
                    "time": r.get_time(),
                    "temperatura": float(r.get("temperatura", 0)) if r.get("temperatura") is not None else 0.0,
                    "tampa_aberta": bool(r.get("tampa_aberta", False)),
                    "violacao": bool(r.get("violacao", False)),
                    # Preserve None quando o campo não existir
                    "bateria": bateria_val,
                    "luz": luz_val
                })

        # --- LÓGICA OFFLINE ---
        if not historico:
            return {
                "lote": lote,
                "offline": True,
                "analise_risco": {
                    "health_score": None,  # Null faz o front ficar Cinza/AGUARDANDO
                    "status_operacional": "OFFLINE",
                    "indicador_led": "#cbd5e1",
                    "recomendacao": "Sem sinal do dispositivo."
                },
                "telemetria": {
                    "temperatura_atual": 0,
                    "bateria": None,
                    "luz": None,
                    "historico": []
                }
            }

        # Com dados -> Calcula saúde
        saude, status, cor, msg = calcular_saude_lote(historico)
        recente = historico[0]

        return {
            "lote": lote,
            "offline": False,
            "analise_risco": {
                "health_score": saude,
                "status_operacional": status,
                "indicador_led": cor,
                "recomendacao": msg
            },
            "telemetria": {
                "temperatura_atual": round(recente.get("temperatura", 0), 1),
                "violacao": recente.get("violacao", False),
                "tampa_aberta": recente.get("tampa_aberta", False),
                # Retorna None se não existir (agora preservado)
                "bateria": recente.get("bateria", None),
                "luz": recente.get("luz", None),
                "historico": historico
            }
        }

    except Exception as e:
        print(f"❌ ERRO API: {e}")
        return {
            "lote": lote,
            "offline": True,
            "analise_risco": {
                "health_score": None,
                "status_operacional": "OFFLINE",
                "indicador_led": "#cbd5e1",
                "recomendacao": "Erro interno no servidor"
            },
            "telemetria": {"temperatura_atual": 0, "bateria": None, "historico": []}
        }

@app.post("/register")
def register(dados: dict):
    usuario = dados.get("usuario")
    senha = dados.get("senha")
    if not usuario or not senha:
        raise HTTPException(status_code=400, detail="Dados incompletos")
    sucesso = save_new_user(usuario, senha)
    if not sucesso:
        raise HTTPException(status_code=400, detail="Usuário já existe")
    return {"message": "Usuário criado com sucesso"}

@app.post("/login")
def login(dados: dict):
    usuario = dados.get("usuario")
    senha = dados.get("senha")
    users = load_users()
    if usuario in users and users[usuario] == senha:
        return {"token": "token-simples-jwt-fake", "nome": usuario}
    raise HTTPException(status_code=401, detail="Credenciais inválidas")
