from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS
import paho.mqtt.client as mqtt
import os
import json
from datetime import datetime

app = FastAPI(title="VaSafe Digital Twin API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

INFLUX_URL = os.getenv("INFLUX_URL", "http://influxdb:8086")
INFLUX_TOKEN = os.getenv("DOCKER_INFLUXDB_INIT_ADMIN_TOKEN", "token-secreto")
INFLUX_ORG = os.getenv("DOCKER_INFLUXDB_INIT_ORG", "ufsvasafe")
INFLUX_BUCKET = os.getenv("DOCKER_INFLUXDB_INIT_BUCKET", "telemetria")
MQTT_BROKER = os.getenv("MQTT_BROKER", "mosquitto")

influx_client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
write_api = influx_client.write_api(write_options=SYNCHRONOUS)
query_api = influx_client.query_api()

def calcular_saude_lote(dados_historicos, lote_id):
    """
    Analisa o histórico e define a saúde (0-100%) e o status do lote.
    """
    saude = 100.0
    status = "APROVADO"
    cor_led = "#22c55e" # Verde
    mensagem = "Carga em perfeitas condições."

    if not dados_historicos:
        return 0, "AGUARDANDO", "#cbd5e1", "Sem dados de telemetria"

    limite_temp = 8.0 
    limite_min_temp = 2.0

    for ponto in dados_historicos:
        temp = ponto.get('temperatura', 0)
        bat = ponto.get('bateria', 100)
        
        if temp > limite_temp:
            diferenca = temp - limite_temp
            
            penalidade = diferenca * 15.0 
            saude -= penalidade
        
        elif temp < limite_min_temp:
            saude -= 10.0 
         
        if bat < 20:
             saude -= 2.0 
    
    if saude < 0: saude = 0

    if saude >= 90:
        status = "APROVADO"
        cor_led = "#22c55e" 
        mensagem = "Vacina Intacta. Liberar para distribuição."
    elif 60 <= saude < 90:
        status = "ALERTA"
        cor_led = "#eab308" 
        mensagem = "Pequena excursão térmica. Verificar potência."
    else:
        status = "CRÍTICO"
        cor_led = "#ef4444" 
        mensagem = f"Risco Biológico! Temp excedeu limites seguros."

    return round(saude, 1), status, cor_led, mensagem

def on_connect(client, userdata, flags, rc):
    print(f"📡 MQTT Conectado (Código: {rc})")
    client.subscribe("vasafe/sensores/#")

def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode())
        point = Point("telemetria") \
            .tag("lote", payload.get("lote", "desconhecido")) \
            .field("temperatura", float(payload.get("temperatura", 0))) \
            .field("umidade", float(payload.get("umidade", 0))) \
            .field("bateria", float(payload.get("bateria", 100)))
        write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=point)
    except Exception as e:
        print(f"Erro ao processar MQTT: {e}")

mqtt_client = mqtt.Client()
mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message
try:
    mqtt_client.connect(MQTT_BROKER, 1883, 60)
    mqtt_client.loop_start()
except:
    print("⚠️ Aviso: Broker MQTT não encontrado. API rodando apenas com HTTP.")


@app.post("/login")
def login(dados: dict):
    if dados.get("usuario") == "admin" and dados.get("senha") == "admin":
        return {"token": "token-acesso-lote-40", "nome": "Fiscal Sanitário"}
    raise HTTPException(status_code=401, detail="Acesso negado")

@app.get("/analise/{lote}")
def obter_analise_lote(lote: str):

    query = f'''
    from(bucket: "{INFLUX_BUCKET}")
    |> range(start: -1h)
    |> filter(fn: (r) => r["_measurement"] == "telemetria")
    |> filter(fn: (r) => r["lote"] == "{lote}")
    |> filter(fn: (r) => r["_field"] == "temperatura" or r["_field"] == "umidade" or r["_field"] == "bateria")
    |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
    |> sort(columns: ["_time"], desc: true)
    |> limit(n: 50)
    '''
    
    try:
        result = query_api.query(org=INFLUX_ORG, query=query)
        
        dados_formatados = []
        temperatura_atual = 0.0
        umidade_atual = 0.0
        bateria_atual = 0.0

        for table in result:
            for record in table.records:
                temp_val = record["temperatura"] if "temperatura" in record.values else 0
                umid_val = record["umidade"] if "umidade" in record.values else 0
                bat_val  = record["bateria"] if "bateria" in record.values else 0
                
                dados_formatados.append({
                    "time": record.get_time(), 
                    "temperatura": temp_val,
                    "umidade": umid_val,
                    "bateria": bat_val
                })
        
        if dados_formatados:
            temperatura_atual = dados_formatados[0]['temperatura']
            umidade_atual = dados_formatados[0]['umidade']
            bateria_atual = dados_formatados[0]['bateria']

        saude, status, cor, msg = calcular_saude_lote(dados_formatados, lote)

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
                "umidade_atual": round(umidade_atual, 1),
                "bateria_atual": round(bateria_atual, 0), 
                "historico": dados_formatados
            }
        }
        
    except Exception as e:
        print(f"Erro na Query InfluxDB: {e}")
        return {
            "analise_risco": {"health_score": 0, "status_operacional": "OFFLINE", "indicador_led": "gray", "recomendacao": "Erro de Conexão"},
            "telemetria": {"temperatura_atual": 0, "umidade_atual": 0, "bateria_atual": 0, "historico": []}
        }