import time
import random
import math
from datetime import datetime
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS

INFLUX_URL = "http://localhost:8086"
INFLUX_TOKEN = "token-secreto"       
INFLUX_ORG = "ufsvasafe"
INFLUX_BUCKET = "telemetria"


estado_caixas = {
    "Lote-A": {
        "temp_base": 4.0,      
        "comportamento": "estavel", 
        "bateria": 95.0
    },
    "Lote-B": {
        "temp_base": 7.5,   
        "comportamento": "falha_cooler",
        "bateria": 82.0
    },
    "Lote-C": {
        "temp_base": 3.0,    
        "comportamento": "estavel",
        "bateria": 100.0
    }
}

print("\nINICIANDO SIMULADOR DE CAIXAS INTELIGENTES (VASAFE)...")
print(f"Conectando ao InfluxDB em: {INFLUX_URL}")

try:
    client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
    write_api = client.write_api(write_options=SYNCHRONOUS)
    
    step = 0
    
    while True:
        dados_para_enviar = []
        step += 1
        
        print(f"\n⏱Ciclo de Leitura: {step}")

        for lote_id, dados in estado_caixas.items():
            
        
            ruido = random.uniform(-0.1, 0.1) 

            if dados["comportamento"] == "estavel":
                variacao = math.sin(step * 0.2) * 0.4
                temp_atual = dados["temp_base"] + variacao + ruido
            
            elif dados["comportamento"] == "falha_cooler":
                dados["temp_base"] += 0.2
                if dados["temp_base"] > 15: dados["temp_base"] = 7.0 
                
                temp_atual = dados["temp_base"] + (ruido * 2) 

            umid_atual = 50 - (temp_atual * 1.5) + random.uniform(-1, 1)
            
            dados["bateria"] -= 0.05
            if dados["bateria"] < 0: dados["bateria"] = 100


            p = Point("telemetria") \
                .tag("lote", lote_id) \
                .tag("tipo", "caixa-termica") \
                .field("temperatura", float(round(temp_atual, 2))) \
                .field("umidade", float(round(umid_atual, 2))) \
                .field("bateria", float(round(dados["bateria"], 1)))

            dados_para_enviar.append(p)

            icone = "✅"
            if temp_atual > 8 or temp_atual < 2: icone = "🚨"
            if lote_id == "Lote-B": icone = "🔥" 

            print(f" {lote_id}: {temp_atual:.2f}°C | {umid_atual:.1f}% Ur | 🔋 {int(dados['bateria'])}% | {icone}")


        write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=dados_para_enviar)
        
        time.sleep(3)

except KeyboardInterrupt:
    print("\nSimulador parado pelo usuário.")
except Exception as e:
    print(f"\nERRO: Não foi possível conectar ao InfluxDB.")
    print(f"Detalhes: {e}")