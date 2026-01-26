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

# Configurações de Ambiente
MQTT_BROKER = os.getenv("MQTT_BROKER", "98.90.117.5") # Atualizei com o IP que estava no seu Arduino
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
INFLUX_URL = os.getenv("INFLUX_URL", "http://influxdb:8086")
INFLUX_TOKEN = os.getenv("INFLUX_TOKEN", os.getenv("DOCKER_INFLUXDB_INIT_ADMIN_TOKEN", "token-secreto"))
INFLUX_ORG = os.getenv("INFLUX_ORG", "ufsvasafe")
INFLUX_BUCKET = os.getenv("INFLUX_BUCKET", "telemetria")
USERS_FILE = "users.json"

# Setup InfluxDB
influx_client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG, timeout=20000)
write_api = influx_client.write_api(write_options=SYNCHRONOUS)
query_api = influx_client.query_api()

# Setup MQTT
mqtt_client = mqtt.Client(client_id="vasafe-backend", protocol=mqtt.MQTTv311)

# Funções Auxiliares de Usuário
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

# Lógica de Saúde do Lote
def calcular_saude_lote(historico):
    if not historico:
        return 0, "AGUARDANDO", "#808080", "Aguardando dados..."

    saude = 100.0
    violacao_detectada = False

    for p in historico:
        temp = p.get("temperatura", 0)
        aberta = p.get("tampa_aberta", False)
        # Se tiver luz no histórico, podemos usar também, mas manteremos simples
        
        if temp > 8 or temp < 2:
            saude -= 20
        if aberta:
            saude -= 5
        if p.get("violacao", False):
            violacao_detectada = True
            saude = 0
            break

    saude = max(saude, 0)

    if violacao_detectada:
        return saude, "FRAUDE", "#000000", "Violação detectada!"
    elif saude >= 90:
        return saude, "APROVADO", "#22c55e", "Carga segura."
    elif saude >= 60:
        return saude, "ALERTA", "#eab308", "Monitorar condições."
    else:
        return saude, "CRITICO", "#ef4444", "Risco biológico!"

# --- MUDANÇA PRINCIPAL AQUI (Callbacks MQTT) ---
def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("✅ MQTT conectado")
        client.subscribe("vasafe/+/telemetria")
    else:
        print("❌ Erro MQTT:", rc)

def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode())
        print("📥 MQTT Recebido:", payload)

        # Extração dos dados vindos do Arduino
        box_id = payload.get("box_id", "unknown")
        temperatura = float(payload.get("temperatura", 0))
        tampa_aberta = bool(payload.get("aberta", False))
        
        # Novos campos adicionados no Arduino
        luz = int(payload.get("luz", 0))
        tipo_envio = payload.get("tipo", "AUTO") # "SYNC_MANUAL" ou vazio
        alerta_msg = payload.get("alerta", "NORMAL")

        # Verifica violação (temperatura ou tampa violada pelo LDR)
        violacao = (temperatura > 8 or temperatura < 2) or (luz < 600)

        # Cria o ponto para o InfluxDB com TODOS os dados
        point = (
            Point("telemetria")
            .tag("lote", box_id)
            .tag("tipo_envio", tipo_envio) # Tag para filtrar se foi botão
            .field("temperatura", temperatura)
            .field("luz", luz)             # Campo novo
            .field("tampa_aberta", tampa_aberta)
            .field("violacao", violacao)
            .field("msg_alerta", alerta_msg) # Campo novo
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
            print(f"Tentando reconectar MQTT... Erro: {e}")
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
    # Query ajustada para garantir que pegamos os campos certos
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
                # O Influx retorna None se o campo não existir naquele registro
                historico.append({
                    "time": r.get_time(),
                    "temperatura": float(r["temperatura"]) if "temperatura" in r else 0.0,
                    "luz": int(r["luz"]) if "luz" in r else 0, # Adicionado LUZ
                    "tampa_aberta": bool(r["tampa_aberta"]) if "tampa_aberta" in r else False,
                    "violacao": bool(r["violacao"]) if "violacao" in r else False
                })

        temperatura_atual = historico[0]["temperatura"] if historico else 0.0
        luz_atual = historico[0]["luz"] if historico and "luz" in historico[0] else 0
        
        saude, status, cor, msg = calcular_saude_lote(historico)

        return {
            "lote": lote,
            "analise_risco": {
                "health_score": saude,
                "status_operacional": status,
                "indicador_led": cor,
                "recomendacao": msg
            },
            "telemetria": {
                "temperatura_atual": round(temperatura_atual, 1),
                "luz_atual": luz_atual,
                "violacao": historico[0]["violacao"] if historico else False,
                "tampa_aberta": historico[0]["tampa_aberta"] if historico else False,
                "historico": historico
            }
        }

    except Exception as e:
        print("❌ ERRO ANALISE:", e)
        return {
            "lote": lote,
            "analise_risco": {
                "health_score": 0, "status_operacional": "OFFLINE", 
                "indicador_led": "#808080", "recomendacao": "Erro interno ou Sem Dados"
            },
            "telemetria": {"temperatura_atual": 0, "historico": []}
        }