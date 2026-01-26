import paho.mqtt.client as mqtt
import json
import time
import random

MQTT_BROKER = "98.90.117.5"
MQTT_PORT = 1883
TOPIC_BASE = "vasafe/"

QTD_TOTAL_CAIXAS = 20  
LIMITE_LUZ_ALARME = 600   # Abaixo disso = ABERTA (Perigo)
LIMITE_TEMP_MIN = 2.0
LIMITE_TEMP_MAX = 8.0

print(f"\n--- INICIANDO SIMULADOR V3 (COM TESTE DE AMARELO) ---")
print(f"--- Box 02: Drama (Ciclo) ---")
print(f"--- Box 03: Amarelo (Quente > 8.0) ---")
print(f"--- Box 04: Amarelo (Frio < 2.0) ---")
print(f"--- Box 05+: Verde (Normal) ---")

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, "Simulador_Yellow_Test")

def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        print("✅ Conectado ao Broker MQTT!")
    else:
        print(f"❌ Falha ao conectar. Código: {reason_code}")

client.on_connect = on_connect

try:
    client.connect(MQTT_BROKER, MQTT_PORT, 60)
    client.loop_start()
    time.sleep(1) 
except Exception as e:
    print(f"❌ Erro crítico: {e}")
    exit()

ciclo_drama = 0 

# --- FUNÇÃO DO DRAMA (BOX 02) ---
def gerar_dados_drama(box_id):
    global ciclo_drama
    ciclo_drama += 1
    
    payload = {"box_id": box_id}
    status_desc = ""
    temp = 0.0
    luz = 0
    modo_emergencia = False

    if ciclo_drama <= 5:
        # Verde
        temp = round(random.uniform(4.0, 5.0), 1)
        luz = 3000
        status_desc = "Normal"
    elif ciclo_drama <= 10:
        # Amarelo (Quente)
        temp = round(8.5 + (ciclo_drama - 5) * 0.2, 1) 
        luz = 3000
        status_desc = "Temp Alta (Amarelo)"
    elif ciclo_drama <= 15:
        # Vermelho (Aberta)
        temp = 12.0
        luz = 300 
        modo_emergencia = True
        status_desc = "VIOLAÇÃO (Vermelho)"
    else:
        status_desc = "Resetando..."
        temp = 5.0
        luz = 3000
        if ciclo_drama >= 18: 
            ciclo_drama = 0 

    aberta = (luz < LIMITE_LUZ_ALARME)
    payload["temperatura"] = temp
    payload["luz"] = luz
    payload["aberta"] = aberta
    
    if modo_emergencia:
        payload["alerta"] = "EVENTO_CRITICO"

    return payload, status_desc

# --- FUNÇÃO GERAL (BOX 05+) ---
def gerar_dados_normal(box_id):
    temp = round(random.uniform(3.5, 5.5), 1)
    luz = random.randint(2500, 4095)
    return {
        "box_id": box_id,
        "temperatura": temp,
        "luz": luz,
        "aberta": False 
    }

try:
    while True:
        print(f"\n--- Enviando Ciclo... ---")
        for i in range(2, QTD_TOTAL_CAIXAS + 1):

            suffix = f"0{i}" if i < 10 else str(i)
            box_id = f"box_{suffix}"
            topic = f"{TOPIC_BASE}{box_id}/telemetria"
            
            payload = {}
            msg_log = ""

            # LÓGICA DE DISTRIBUIÇÃO DOS TESTES
            if i == 2:
                # Box Dramática
                payload, desc = gerar_dados_drama(box_id)
                msg_log = f"[{box_id}] {desc}: {payload['temperatura']}°C"

            elif i == 3:
                # FORÇA AMARELO (QUENTE)
                # Temp > 8.0, mas Luz ALTA (Fechada)
                payload = {
                    "box_id": box_id,
                    "temperatura": round(random.uniform(8.2, 9.5), 1),
                    "luz": 3000,
                    "aberta": False
                }
                msg_log = f"[{box_id}] TESTE AMARELO (Quente): {payload['temperatura']}°C"

            elif i == 4:
                # FORÇA AMARELO (FRIO)
                # Temp < 2.0, mas Luz ALTA (Fechada)
                payload = {
                    "box_id": box_id,
                    "temperatura": round(random.uniform(0.5, 1.8), 1),
                    "luz": 3000,
                    "aberta": False
                }
                msg_log = f"[{box_id}] TESTE AMARELO (Frio): {payload['temperatura']}°C"

            else:
                # Verde Normal
                payload = gerar_dados_normal(box_id)
                # Só imprime o log da última para não poluir
                if i == QTD_TOTAL_CAIXAS:
                    msg_log = f"[{box_id}] ... (Carga Normal)"

            # Envia
            json_msg = json.dumps(payload)
            client.publish(topic, json_msg)
            
            if msg_log:
                print(msg_log)
            
            time.sleep(0.05)

        print("-" * 40)
        time.sleep(3) 

except KeyboardInterrupt:
    print("\nSimulador encerrado.")
    client.loop_stop()
    client.disconnect()