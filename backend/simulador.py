import paho.mqtt.client as mqtt
import json
import random
import time

# Configurações
BROKER = "localhost"

TOPIC_BASE = "vasafe/telemetria" 

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, "Simulador_PC")
client.connect(BROKER, 1883)

print("SIMULADOR LIGADO! (Pressione Ctrl+C para parar)")

CAIXAS_DISPONIVEIS = ["box_01", "box_02", "box_03", "box_04"]


while True:
    try:
        # 1. ESCOLHE UMA CAIXA ALEATORIAMENTE
        box_id_selecionada = random.choice(CAIXAS_DISPONIVEIS)
        
        # 2. GERA DADOS ALEATÓRIOS
        temp = round(random.uniform(20.0, 30.0), 1)
        luz = random.randint(0, 4095)
        vib_raw = random.random()
        vib = "HIGH" if vib_raw > 0.9 else "LOW"

        # 3. CRIA O PAYLOAD
        payload = {
            "box_id": box_id_selecionada, 
            "temp": temp,
            "vib": vib,
            "luz": luz
        }
        
        mensagem = json.dumps(payload)
        
        # 4. PUBLICA NO TÓPICO DA CAIXA ESCOLHIDA
        topic_publicacao = f"vasafe/{box_id_selecionada}/telemetria"
        client.publish(topic_publicacao, mensagem)
        
        print(f"Enviado [{box_id_selecionada}]: {mensagem}")
        
        time.sleep(2)
    except KeyboardInterrupt:
        print("Parando...")
        break