import paho.mqtt.client as mqtt
import json
import time
import random

MQTT_BROKER = "98.90.117.5"
MQTT_PORT = 1883
TOPIC_SETUP = "vasafe/setup/qtd"
TOPIC_BASE = "vasafe/"

qtd_caixas_total = 20
caixas_virtuais = []

class CaixaVirtual:
    def __init__(self, id_num):
        self.id = f"box_{id_num:02d}"
        self.buffer = []
        self.contador = 0
        self.temperatura = 5.0

    def processar(self, client):
        variacao = random.uniform(-0.3, 0.4)
        self.temperatura += variacao
        if self.temperatura < 2.0: self.temperatura = 2.0
        if self.temperatura > 9.0: self.temperatura = 9.0

        aberta = False
        if random.random() < 0.01:
            aberta = True
            self.temperatura += 2.0

        leitura = {
            "box_id": self.id,
            "temperatura": round(self.temperatura, 2),
            "aberta": aberta
        }

        self.buffer.append(leitura)
        self.contador += 1

        if self.contador >= 5:
            topic = f"{TOPIC_BASE}{self.id}/telemetria"
            
            print(f"[AUDITORIA] Iniciando envio em lote: {self.id}")
            
            for dados in self.buffer:
                payload_json = json.dumps(dados)
                client.publish(topic, payload_json)
                print(f"[ENVIADO] Topico: {topic} | Payload: {payload_json}")
                time.sleep(0.05)
            
            self.buffer = []
            self.contador = 0

def recriar_ambiente(quantidade):
    global caixas_virtuais
    caixas_virtuais = []
    
    if quantidade < 2:
        print("Modo apenas fisico. Simulador em espera.")
        return

    for i in range(2, quantidade + 1):
        caixas_virtuais.append(CaixaVirtual(i))
    
    print(f"Ambiente reconfigurado. Caixas virtuais ativas: {len(caixas_virtuais)}")

def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        print(f"Conectado ao Broker: {MQTT_BROKER}")
        client.subscribe(TOPIC_SETUP)
        recriar_ambiente(qtd_caixas_total)
    else:
        print(f"Erro de conexao: {reason_code}")

def on_message(client, userdata, msg):
    global qtd_caixas_total
    try:
        payload = msg.payload.decode()
        print(f"[SETUP] Nova configuracao recebida: {payload}")
        
        nova_qtd = int(payload)
        if nova_qtd != qtd_caixas_total:
            qtd_caixas_total = nova_qtd
            recriar_ambiente(qtd_caixas_total)
            
    except Exception as e:
        print(f"Erro ao processar mensagem: {e}")

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, "Simulador_Auditoria_V5")
client.on_connect = on_connect
client.on_message = on_message

try:
    client.connect(MQTT_BROKER, MQTT_PORT, 60)
    client.loop_start()

    while True:
        if len(caixas_virtuais) > 0:
            for caixa in caixas_virtuais:
                caixa.processar(client)
        
        time.sleep(1.0)

except KeyboardInterrupt:
    client.loop_stop()
    client.disconnect()