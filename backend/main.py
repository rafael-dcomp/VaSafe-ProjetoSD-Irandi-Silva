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
influx_client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG, timeout=20000)
write_api = influx_client.write_api(write_options=SYNCHRONOUS)
query_api = influx_client.query_api()

# --- SETUP MQTT ---
mqtt_client = mqtt.Client(client_id="vasafe-backend", protocol=mqtt.MQTTv311)

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

# --- LÓGICA DE SAÚDE (CORRIGIDA) ---
def calcular_saude_lote(historico):
    if not historico:
        # Retorna None para que o React entenda como cinza/offline, não fraude
        return None, "AGUARDANDO", "#cbd5e1", "Aguardando dados..."

    # Pega o dado mais recente para determinar o estado ATUAL
    dado_atual = historico[0]
    
    # Se o ESP32 enviou alerta crítico (Flag de Violação Real)
    if dado_atual["violacao"]: 
        return 0, "FRAUDE", "#000000", "Violação detectada pelo Sensor!"

    # Cálculo normal de saúde
    saude = 100.0
    
    # Verifica temperatura do momento atual
    temp = dado_atual["temperatura"]
    
    # Penalidades (Apenas reduz a saúde, não zera, a menos que o ESP mande violacao)
    if temp > 8 or temp < 2:
        saude -= 20 
    
    if dado_atual["tampa_aberta"]:
        saude -= 10

    # Limites
    saude = max(saude, 0) # Nunca menor que 0
    saude = min(saude, 100)

    # Definição do Status Visual
    if dado_atual["violacao"]: # Redundância para garantir
         return 0, "FRAUDE", "#000000", "Violação Crítica!"
    elif dado_atual["tampa_aberta"]:
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
        print("✅ MQTT conectado")
        client.subscribe("vasafe/+/telemetria")
    else:
        print("❌ Erro MQTT:", rc)

def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode())
        print(f"📥 MQTT Recebido: {payload}")

        box_id = payload.get("box_id", "unknown")
        # Conversão segura
        temperatura = float(payload.get("temperatura", 0))
        tampa_aberta = bool(payload.get("aberta", False))
        luz = int(payload.get("luz", 0))
        bateria = int(payload.get("bateria", 0))
        
        # A lógica de fraude vem do ESP32. Se o ESP disser que violou, violou.
        alerta_recebido = payload.get("alerta", "")
        violacao = (alerta_recebido == "EVENTO_CRITICO")

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

    except Exception as e:
        print("❌ Erro ao processar mensagem:", e)

mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message

def iniciar_mqtt():
    while True:
        try:
            mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
            mqtt_client.loop_forever()
        except Exception as e:
            print(f"⚠️ Erro conexão MQTT: {e}. Tentando em 5s...")
            time.sleep(5)

@app.on_event("startup")
def startup():
    threading.Thread(target=iniciar_mqtt, daemon=True).start()

# --- ENDPOINTS ---

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

@app.get("/analise/{lote}")
def analise_lote(lote: str):
    # Busca dados ordenados por tempo (decrescente)
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
                # Usamos .get() com valor padrão para evitar erro 500 se o campo não existir
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
                    "health_score": None, # Importante: None vira null no JSON (Cinza no React)
                    "status_operacional": "OFFLINE", 
                    "indicador_led": "#cbd5e1", 
                    "recomendacao": "Aguardando conexão..."
                },
                "telemetria": {
                    "temperatura_atual": 0, 
                    "bateria": 0, 
                    "historico": []
                }
            }

        # CASO 2: DADOS EXISTEM -> Calcular Saúde
        saude, status, cor, msg = calcular_saude_lote(historico)
        
        recente = historico[0]

        return {
            "lote": lote,
            "analise_risco": {
                "health_score": saude, # Se for 0 é fraude, se for None é offline
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
        print(f"❌ ERRO CRÍTICO NA API: {e}")
        # Retorna estrutura segura em caso de erro interno
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