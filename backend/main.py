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

# --- LÓGICA DE SAÚDE (Compatível com novo Front) ---
def calcular_saude_lote(historico):
    # Se não tem histórico, retorna None para o Front entender como OFFLINE (Cinza)
    if not historico:
        return None, "AGUARDANDO", "#cbd5e1", "Aguardando conexão..."

    dado_atual = historico[0]
    
    # 1. Checagem de Fraude/Violação (Prioridade Máxima -> Preto)
    if dado_atual["violacao"]: 
        return 0, "FRAUDE", "#000000", "Violação detectada pelo Sensor!"

    # 2. Cálculo de Saúde
    saude = 100.0
    temp = dado_atual["temperatura"]
    
    # Penalidade por temperatura (exemplo: fora de 2°C a 8°C)
    if temp > 8 or temp < 2:
        saude -= 20 
    
    # Penalidade por tampa aberta
    if dado_atual["tampa_aberta"]:
        saude -= 10

    # Limites (0 a 100)
    saude = max(0, min(saude, 100))

    # 3. Definição do Status Visual e Cores
    if dado_atual["violacao"]:
         return 0, "FRAUDE", "#000000", "Violação Crítica!"
    elif dado_atual["tampa_aberta"]:
        return saude, "ALERTA", "#eab308", "Tampa Aberta!"
    elif saude < 60:
         return saude, "RISCO", "#ef4444", "Condições críticas."
    elif temp > 7 or temp < 3:
        return saude, "ATENÇÃO", "#eab308", "Temperatura oscilando."
    else:
        return saude, "APROVADO", "#22c55e", "Condições ideais."

# --- CALLBACKS MQTT (Com Limpeza de String) ---
def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("✅ MQTT conectado com sucesso!")
        client.subscribe("vasafe/+/telemetria")
    else:
        print(f"❌ Falha ao conectar no MQTT. Código: {rc}")

def on_message(client, userdata, msg):
    try:
        # 1. Pega a mensagem bruta
        raw_msg = msg.payload.decode().strip()
        
        # 2. LIMPEZA AVANÇADA DE STRING
        # Se for mensagem de log do sistema (ex: DESLIGANDO WIFI), ignora
        if ">>>" in raw_msg or "DESLIGANDO" in raw_msg:
            print(f"ℹ️ Log de sistema ignorado: {raw_msg}")
            return

        # Remove prefixos conhecidos
        clean_msg = raw_msg.replace("[BUFFER]", "").replace("Upload:", "").strip()

        # Garante que pegamos apenas o JSON (do primeiro '{' até o último '}')
        # Isso resolve casos onde sobram espaços ou caracteres estranhos nas pontas
        idx_inicio = clean_msg.find('{')
        idx_fim = clean_msg.rfind('}')
        
        if idx_inicio != -1 and idx_fim != -1:
            clean_msg = clean_msg[idx_inicio : idx_fim + 1]
        else:
            # Se não achar chaves {}, não é JSON válido
            return 

        # 3. Converte para JSON
        payload = json.loads(clean_msg)
        
        # Logs apenas para debug visual
        print(f"📥 [Dados] ID: {payload.get('box_id')} | Temp: {payload.get('temperatura')} | Bat: {payload.get('bateria')}%")

        # 4. Extração de dados com valores padrão seguros
        box_id = payload.get("box_id", "desconhecido")
        temperatura = float(payload.get("temperatura", 0.0))
        tampa_aberta = bool(payload.get("aberta", False))
        luz = int(payload.get("luz", 0))
        bateria = int(payload.get("bateria", 0))
        
        # Lógica de Violação (Se o ESP mandar alerta ou se a lógica for local)
        # Aqui assumimos que se vier "alerta" = "EVENTO_CRITICO", é fraude.
        alerta_recebido = payload.get("alerta", "")
        violacao = (alerta_recebido == "EVENTO_CRITICO")

        # 5. Grava no InfluxDB
        point = (
            Point("telemetria")
            .tag("lote", box_id)
            .field("temperatura", temperatura)
            .field("luz", luz)
            .field("bateria", bateria)
            .field("tampa_aberta", tampa_aberta)
            .field("violacao", violacao)
            .time(datetime.utcnow())
        )

        write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=point)

    except json.JSONDecodeError:
        print(f"❌ JSON Inválido. Recebido: {msg.payload.decode()}")
    except Exception as e:
        print(f"❌ Erro ao processar mensagem: {e}")

mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message

def iniciar_mqtt():
    while True:
        try:
            print(f"📡 Tentando conectar ao MQTT Broker: {MQTT_BROKER}:{MQTT_PORT}")
            mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
            mqtt_client.loop_forever()
        except Exception as e:
            print(f"⚠️ Erro conexão MQTT: {e}. Tentando em 5s...")
            time.sleep(5)

@app.on_event("startup")
def startup():
    threading.Thread(target=iniciar_mqtt, daemon=True).start()

# --- ENDPOINTS ---

@app.get("/analise/{lote}")
def analise_lote(lote: str):
    # Query busca dados das últimas 24h
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
                # O .get() é fundamental aqui caso o dado antigo não tenha 'bateria' ou 'luz'
                historico.append({
                    "time": r.get_time(),
                    "temperatura": float(r.get("temperatura", 0)),
                    "tampa_aberta": bool(r.get("tampa_aberta", False)),
                    "violacao": bool(r.get("violacao", False)),
                    "bateria": int(r.get("bateria", 0)),
                    "luz": int(r.get("luz", 0))
                })

        # CASO 1: SEM DADOS (OFFLINE)
        if not historico:
             return {
                "lote": lote,
                "analise_risco": {
                    "health_score": None, # Retorna null para o React pintar de Cinza/Offline
                    "status_operacional": "OFFLINE", 
                    "indicador_led": "#cbd5e1", 
                    "recomendacao": "Sem sinal do dispositivo."
                },
                "telemetria": {
                    "temperatura_atual": 0, 
                    "bateria": 0, 
                    "historico": []
                }
            }

        # CASO 2: COM DADOS
        saude, status, cor, msg = calcular_saude_lote(historico)
        recente = historico[0]

        return {
            "lote": lote,
            "analise_risco": {
                "health_score": saude,
                "status_operacional": status,
                "indicador_led": cor,
                "recomendacao": msg
            },
            "telemetria": {
                "temperatura_atual": round(recente["temperatura"], 1),
                "violacao": recente["violacao"],
                "tampa_aberta": recente["tampa_aberta"],
                "bateria": recente.get("bateria", 0),
                "luz": recente.get("luz", 0),
                "historico": historico
            }
        }

    except Exception as e:
        print(f"❌ ERRO CRÍTICO NA API ({lote}): {e}")
        # Retorno de erro seguro para não quebrar o front
        return {
            "lote": lote,
            "analise_risco": {
                "health_score": None, 
                "status_operacional": "OFFLINE", 
                "indicador_led": "#cbd5e1", 
                "recomendacao": "Erro interno no servidor"
            },
            "telemetria": {"temperatura_atual": 0, "bateria": 0, "historico": []}
        }

# --- ENDPOINTS DE AUTH ---
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