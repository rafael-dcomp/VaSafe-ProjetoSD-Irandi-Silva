import paho.mqtt.client as mqtt
import json
import random
import time

# Configurações
BROKER = "localhost"
TOPIC = "vasafe/box_01/telemetria"

# --- CORREÇÃO AQUI (Adicionado VERSION1) ---
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, "Simulador_PC")
client.connect(BROKER, 1883)

print("SIMULADOR LIGADO! (Pressione Ctrl+C para parar)")

while True:
    try:
        temp = round(random.uniform(20.0, 30.0), 1)
        luz = random.randint(0, 4095)
        vib_raw = random.random()
        vib = "HIGH" if vib_raw > 0.9 else "LOW"

        payload = {
            "box_id": "box_01",
            "temp": temp,
            "vib": vib,
            "luz": luz
        }
        
        mensagem = json.dumps(payload)
        client.publish(TOPIC, mensagem)
        print(f"Enviado: {mensagem}")
        
        time.sleep(2)
    except KeyboardInterrupt:
        print("Parando...")
        break