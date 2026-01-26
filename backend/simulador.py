import paho.mqtt.client as mqtt
import json
import time
import random

# --- CONFIGURAÇÕES ---
MQTT_BROKER = "98.90.117.5"
MQTT_PORT = 1883
TOPIC_BASE = "vasafe/"
TOPIC_CONFIG = "vasafe/setup/qtd"  # Tópico para receber o comando do Front

# Valor padrão inicial (caso o Front não mande nada)
QTD_TOTAL_CAIXAS = 30 
INICIO_ID = 1  

print(f"\n--- INICIANDO SIMULADOR V4 (CONTROLÁVEL VIA MQTT) ---")
print(f"--- Aguardando comandos no tópico: {TOPIC_CONFIG} ---")
print(f"--- Qtd Atual: {QTD_TOTAL_CAIXAS} caixas ---")

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, "Simulador_Remoto")

# --- FUNÇÃO PARA RECEBER MENSAGEM DO FRONT ---
def on_message(client, userdata, msg):
    global QTD_TOTAL_CAIXAS
    try:
        if msg.topic == TOPIC_CONFIG:
            novo_valor = int(msg.payload.decode())
            if novo_valor > 0 and novo_valor <= 200: # Limite de segurança
                QTD_TOTAL_CAIXAS = novo_valor
                print(f"\n📢 COMANDO RECEBIDO: Atualizando para {QTD_TOTAL_CAIXAS} caixas!\n")
            else:
                print(f"\n⚠️ Valor inválido recebido: {novo_valor}")
    except Exception as e:
        print(f"Erro ao processar comando: {e}")

def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        print("✅ Conectado ao Broker MQTT!")
        # Se inscreve para ouvir o comando do Front
        client.subscribe(TOPIC_CONFIG)
    else:
        print(f"❌ Falha ao conectar. Código: {reason_code}")

client.on_connect = on_connect
client.on_message = on_message # Vincula a função de receber mensagem

try:
    client.connect(MQTT_BROKER, MQTT_PORT, 60)
    client.loop_start()
    time.sleep(1) 
except Exception as e:
    print(f"❌ Erro crítico: {e}")
    exit()

ciclo_drama = 0 

# --- GERAÇÃO DE DADOS ---
def gerar_dados_drama(box_id):
    global ciclo_drama
    ciclo_drama += 1
    
    payload = {"box_id": box_id}
    status_desc = ""
    
    if ciclo_drama <= 3:
        temp = round(random.uniform(4.0, 5.0), 1)
        luz = 3000
        status_desc = "🟢 Normal"
    elif ciclo_drama <= 6:
        temp = round(8.5 + (ciclo_drama * 0.1), 1) 
        luz = 3000
        status_desc = "🟡 Alerta Temp"
    elif ciclo_drama <= 9:
        temp = 12.0
        luz = 300 
        status_desc = "🔴 VIOLAÇÃO"
    else:
        status_desc = "🔄 Reset"
        temp = 5.0
        luz = 3000
        if ciclo_drama >= 10: 
            ciclo_drama = 0 

    aberta = (luz < 600)
    payload["temperatura"] = temp
    payload["luz"] = luz
    payload["aberta"] = aberta
    
    if aberta:
        payload["alerta"] = "EVENTO_CRITICO"

    return payload, status_desc

def gerar_dados_normal(box_id):
    temp = round(random.uniform(3.0, 6.0), 1)
    luz = random.randint(2500, 4095)
    return {
        "box_id": box_id,
        "temperatura": temp,
        "luz": luz,
        "aberta": False 
    }

try:
    while True:
        # Usa a variável global QTD_TOTAL_CAIXAS que pode mudar a qualquer momento
        qtd_atual = QTD_TOTAL_CAIXAS 
        
        print(f"\n--- Enviando para {qtd_atual} Caixas ({time.strftime('%H:%M:%S')}) ---")
        
        for i in range(INICIO_ID, qtd_atual + 1):

            suffix = f"0{i}" if i < 10 else str(i)
            box_id = f"box_{suffix}"
            topic = f"{TOPIC_BASE}{box_id}/telemetria"
            
            payload = {}
            msg_log = ""

            # LÓGICA DE DADOS
            if i == 2:
                payload, desc = gerar_dados_drama(box_id)
                msg_log = f"[{box_id}] {desc} | T:{payload['temperatura']}°C"
            elif i == 3:
                payload = {"box_id": box_id, "temperatura": 9.0, "luz": 3000, "aberta": False}
                msg_log = f"[{box_id}] 🟡 Quente | T:9.0°C"
            elif i == 4:
                payload = {"box_id": box_id, "temperatura": 1.0, "luz": 3000, "aberta": False}
                msg_log = f"[{box_id}] 🟡 Frio | T:1.0°C"
            elif i == 5:
                payload = {"box_id": box_id, "temperatura": 10.0, "luz": 100, "aberta": True}
                msg_log = f"[{box_id}] 🔴 ABERTA | Luz:100"
            else:
                payload = gerar_dados_normal(box_id)
                msg_log = f"[{box_id}] 🟢 Normal | T:{payload['temperatura']}°C"

            # Envia MQTT
            client.publish(topic, json.dumps(payload))
            print(msg_log)
            
            # Acelera se tiver muitas caixas para não demorar demais o loop
            delay = 0.05 if qtd_atual < 50 else 0.01
            time.sleep(delay)

        print("-" * 30)
        time.sleep(2) 

except KeyboardInterrupt:
    print("\nSimulador encerrado.")
    client.loop_stop()
    client.disconnect()