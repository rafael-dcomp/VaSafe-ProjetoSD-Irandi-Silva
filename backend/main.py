import paho.mqtt.client as mqtt
import json
from influxdb import InfluxDBClient
from datetime import datetime

# CONFIGURAÇÕES
MQTT_BROKER = "localhost"
MQTT_TOPIC = "vasafe/+/telemetria"
DB_HOST = "localhost"
DB_NAME = "vacinas"

# Conexão com Banco de Dados
db_client = InfluxDBClient(host=DB_HOST, port=8086)
db_client.create_database(DB_NAME)
db_client.switch_database(DB_NAME)

print(f"GÊMEO DIGITAL INICIADO...")

def on_message(client, userdata, msg):
    try:
        payload = msg.payload.decode()
        data = json.loads(payload)
        
        box_id = data['box_id']
        temp = float(data['temp'])
        vib = data['vib']
        luz = int(data['luz'])
        
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {box_id}: {temp}°C | Vib: {vib} | Luz: {luz}")

        # Salvar no InfluxDB
        json_body = [
            {
                "measurement": "telemetria",
                "tags": { "box_id": box_id },
                "fields": {
                    "temperatura": temp,
                    "vibracao": 1 if vib == "HIGH" else 0,
                    "luz": luz
                }
            }
        ]
        db_client.write_points(json_body)
        print("Salvo!")

    except Exception as e:
        print(f"Erro: {e}")

# --- CORREÇÃO AQUI (Adicionado VERSION1) ---
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1)

client.on_message = on_message
client.connect(MQTT_BROKER, 1883, 60)
client.subscribe(MQTT_TOPIC)

print("Ouvindo mensagens...")
client.loop_forever()