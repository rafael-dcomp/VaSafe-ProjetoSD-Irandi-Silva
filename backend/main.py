from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS
import paho.mqtt.client as mqtt
import os
import json
from datetime import datetime


app = FastAPI(title="VaSafe Digital Twin API")

# Configuração de CORS (Permite que o React acesse esta API)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Variáveis de Ambiente (com padrões para rodar localmente)
INFLUX_URL = os.getenv("INFLUX_URL", "http://influxdb:8086")
INFLUX_TOKEN = os.getenv("DOCKER_INFLUXDB_INIT_ADMIN_TOKEN", "token-secreto")
INFLUX_ORG = os.getenv("DOCKER_INFLUXDB_INIT_ORG", "ufsvasafe")
INFLUX_BUCKET = os.getenv("DOCKER_INFLUXDB_INIT_BUCKET", "telemetria")
MQTT_BROKER = os.getenv("MQTT_BROKER", "mosquitto") # Use IP local se não estiver no Docker

# Clientes de Banco de Dados
influx_client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
write_api = influx_client.write_api(write_options=SYNCHRONOUS)
query_api = influx_client.query_api()

# ==========================================
# LÓGICA DE NEGÓCIO (SISTEMA ESPECIALISTA)
# ==========================================
def calcular_saude_lote(dados_historicos, lote_id):
    """
    Analisa os dados históricos e define a saúde (0-100%) e status.
    Agora detecta FRAUDE (violação) e CAIXA ABERTA.
    """
    saude = 100.0
    status = "APROVADO"
    cor_led = "#22c55e" # Verde
    mensagem = "Carga em perfeitas condições."

    if not dados_historicos:
        return 0, "AGUARDANDO", "#cbd5e1", "Sem dados de telemetria"

    limite_temp_max = 8.0 
    limite_temp_min = 2.0
    
    houve_violacao = False
    
    for ponto in dados_historicos:
        temp = ponto.get('temperatura', 0)
        violacao = ponto.get('violacao', False) # Novo campo vindo do ESP32
        aberta = ponto.get('aberta', False)     # Novo campo vindo do ESP32
        
        # 1. Regra de Ouro: Violação de Hardware
        if violacao:
            houve_violacao = True
            saude = 0.0
            # Se detectou fraude, nem precisa calcular o resto
            break 

        # 2. Regra Térmica
        if temp > limite_temp_max:
            diferenca = temp - limite_temp_max
            penalidade = diferenca * 15.0 # Penalidade pesada por grau excedido
            saude -= penalidade
        elif temp < limite_temp_min:
            saude -= 10.0 
        
        # 3. Regra de Segurança Física (Tampa Aberta)
        if aberta:
            saude -= 5.0 # Perde 5% a cada leitura com caixa aberta
    
    # Normalização
    if saude < 0: saude = 0

    # Definição de Status
    if houve_violacao:
        status = "FRAUDE"
        cor_led = "#000000" # Preto (indicativo de crime/violação)
        mensagem = "ALERTA MÁXIMO: O dispositivo foi desligado forçadamente! Lote comprometido."
    elif saude >= 90:
        status = "APROVADO"
        cor_led = "#22c55e" 
        mensagem = "Vacina Intacta. Liberar para distribuição."
    elif 60 <= saude < 90:
        status = "ALERTA"
        cor_led = "#eab308" 
        mensagem = "Excursão térmica ou manuseio indevido (tampa aberta)."
    else:
        status = "CRÍTICO"
        cor_led = "#ef4444" 
        mensagem = f"Risco Biológico! Parâmetros excederam limites seguros."

    return round(saude, 1), status, cor_led, mensagem

# ==========================================
# MQTT (RECEBIMENTO DE DADOS DO ESP32)
# ==========================================
def on_connect(client, userdata, flags, rc):
    print(f"📡 MQTT Conectado (Código: {rc})")
    # O sinal '+' permite ouvir qualquer box: vasafe/box_01/telemetria, vasafe/box_02/..., etc
    client.subscribe("vasafe/+/telemetria")

def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode())
        print(f"📥 Recebido: {payload}")

        # MAPEAMENTO CRÍTICO: JSON do ESP32 -> Banco de Dados
        # ESP envia: { "box_id": "...", "temp": 24.5, "violacao": true, "aberta": false }
        
        lote_tag = payload.get("box_id", "desconhecido")
        
        point = Point("telemetria") \
            .tag("lote", lote_tag) \
            .field("temperatura", float(payload.get("temp", 0))) \
            .field("luz_raw", int(payload.get("luz_raw", 0))) \
            .field("aberta", bool(payload.get("aberta", False))) \
            .field("violacao", bool(payload.get("violacao", False)))
            # Nota: Bateria e Umidade removidos pois o ESP atual não envia, 
            # para não gravar zeros falsos.

        write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=point)
        
    except Exception as e:
        print(f"Erro ao processar MQTT: {e}")

mqtt_client = mqtt.Client()
mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message

try:
    # Se estiver rodando local fora do Docker, mude MQTT_BROKER para "localhost"
    mqtt_client.connect(MQTT_BROKER, 1883, 60)
    mqtt_client.loop_start()
except:
    print("⚠️ Aviso: Broker MQTT não encontrado. API rodando apenas com HTTP.")

# ==========================================
# API ENDPOINTS
# ==========================================

@app.post("/login")
def login(dados: dict):
    if dados.get("usuario") == "admin" and dados.get("senha") == "admin":
        return {"token": "token-acesso-lote-40", "nome": "Fiscal Sanitário"}
    raise HTTPException(status_code=401, detail="Acesso negado")

@app.get("/analise/{lote}")
def obter_analise_lote(lote: str):
    # Query ajustada para buscar os novos campos (violacao, aberta)
    query = f'''
    from(bucket: "{INFLUX_BUCKET}")
    |> range(start: -1h)
    |> filter(fn: (r) => r["_measurement"] == "telemetria")
    |> filter(fn: (r) => r["lote"] == "{lote}")
    |> filter(fn: (r) => r["_field"] == "temperatura" or r["_field"] == "violacao" or r["_field"] == "aberta")
    |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
    |> sort(columns: ["_time"], desc: true)
    |> limit(n: 50)
    '''
    
    try:
        result = query_api.query(org=INFLUX_ORG, query=query)
        
        dados_formatados = []
        temperatura_atual = 0.0
        violacao_atual = False
        aberta_atual = False

        for table in result:
            for record in table.records:
                # Tratamento seguro caso o campo não exista no registro
                temp_val = record["temperatura"] if "temperatura" in record.values else 0
                viol_val = record["violacao"] if "violacao" in record.values else False
                aberta_val = record["aberta"] if "aberta" in record.values else False
                
                dados_formatados.append({
                    "time": record.get_time(), 
                    "temperatura": temp_val,
                    "violacao": viol_val,
                    "aberta": aberta_val
                })
        
        # Pega os dados mais recentes para o card principal
        if dados_formatados:
            temperatura_atual = dados_formatados[0]['temperatura']
            violacao_atual = dados_formatados[0]['violacao']
            aberta_atual = dados_formatados[0]['aberta']

        # Calcula o score baseado no histórico
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
                "violacao": violacao_atual,
                "tampa_aberta": aberta_atual,
                "historico": dados_formatados
            }
        }
        
    except Exception as e:
        print(f"Erro na Query InfluxDB: {e}")
        return {
            "analise_risco": {"health_score": 0, "status_operacional": "OFFLINE", "indicador_led": "gray", "recomendacao": "Erro de Conexão"},
            "telemetria": {"temperatura_atual": 0, "historico": []}
        }