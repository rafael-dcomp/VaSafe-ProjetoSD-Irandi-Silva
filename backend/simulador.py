import paho.mqtt.client as mqtt
import json
import time
import random

# --- CONFIGURAÇÕES GERAIS ---
MQTT_BROKER = "98.90.117.5"
MQTT_PORT = 1883
TOPIC_BASE = "vasafe/"

# Quantidade de caixas para o Stress Test
# Se colocar 20, ele vai gerar da box_02 até a box_20 (19 caixas virtuais)
# A box_01 é pulada para respeitar sua ESP32 física.
QTD_TOTAL_CAIXAS = 20  

# --- PARÂMETROS DE SIMULAÇÃO (Igual ao Arduino) ---
LIMITE_LUZ_ALARME = 600   # < 600 é Aberto/Violado
LIMITE_TEMP_MIN = 2.0
LIMITE_TEMP_MAX = 8.0

print(f"\n--- INICIANDO SIMULADOR HÍBRIDO DE CARGA ---")
print(f"--- Gerando dados para {QTD_TOTAL_CAIXAS - 1} caixas virtuais ---")
print(f"--- A box_01 foi preservada para a ESP32 Real ---")

# --- CONFIGURAÇÃO MQTT (V2) ---
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, "Simulador_PC_Load_Test")

def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        print("✅ Conectado ao Broker MQTT!")
    else:
        print(f"❌ Falha ao conectar. Código: {reason_code}")

client.on_connect = on_connect

try:
    client.connect(MQTT_BROKER, MQTT_PORT, 60)
    client.loop_start()
    time.sleep(1) # Aguarda conexão estabilizar
except Exception as e:
    print(f"❌ Erro crítico: {e}")
    exit()

# Variável para controlar o ciclo da caixa de "Drama" (box_02)
ciclo_drama = 0 

# ---------------------------------------------------------
# FUNÇÃO 1: CAIXA DRAMÁTICA (box_02)
# Simula falhas, aberturas e alertas para demonstração
# ---------------------------------------------------------
def gerar_dados_drama(box_id):
    global ciclo_drama
    ciclo_drama += 1
    
    payload = {"box_id": box_id}
    status_desc = ""
    temp = 0.0
    luz = 0
    modo_emergencia = False
    forcar_sync = False

    # ROTEIRO (Loop de 20 ciclos)
    if ciclo_drama <= 5:
        # FASE 1: TUDO NORMAL
        temp = round(random.uniform(4.0, 5.0), 1)
        luz = random.randint(2000, 4095)
        status_desc = "🟢 Normal"

    elif ciclo_drama <= 10:
        # FASE 2: AQUECIMENTO (Alerta Amarelo/Vermelho)
        temp = round(9.0 + (ciclo_drama - 5) * 0.5, 1) # Sobe a temp
        luz = random.randint(2000, 4095)
        modo_emergencia = True 
        status_desc = "🔥 Temp Alta"

    elif ciclo_drama <= 15:
        # FASE 3: VIOLAÇÃO (Tampa Aberta)
        temp = 12.0
        luz = random.randint(100, 400) # Luz baixa = Aberta
        modo_emergencia = True
        status_desc = "🚨 VIOLAÇÃO (Aberta)"

    else:
        # FASE 4: BOTÃO SYNC (Resolução)
        temp = 12.5
        luz = 300
        modo_emergencia = True
        forcar_sync = True
        status_desc = "🔘 SYNC MANUAL"
        if ciclo_drama >= 20: 
            ciclo_drama = 0 # Reinicia o roteiro

    # Lógica de negócio
    aberta = (luz < LIMITE_LUZ_ALARME)

    payload["temperatura"] = temp
    payload["luz"] = luz
    payload["aberta"] = aberta
    
    if modo_emergencia:
        payload["alerta"] = "EVENTO_CRITICO"
    if forcar_sync:
        payload["tipo"] = "SYNC_MANUAL"

    return payload, status_desc

# ---------------------------------------------------------
# FUNÇÃO 2: CAIXAS DE CARGA (box_03 em diante)
# Simula comportamento normal apenas para encher o Dashboard
# ---------------------------------------------------------
def gerar_dados_carga(box_id):
    # Temperatura sempre ideal (entre 3.5 e 5.5)
    temp = round(random.uniform(3.5, 5.5), 1)
    # Luz sempre "Fechado" (Escuro)
    luz = random.randint(2500, 4095)
    
    payload = {
        "box_id": box_id,
        "temperatura": temp,
        "luz": luz,
        "aberta": False # Sempre fechada
    }
    return payload

# ---------------------------------------------------------
# LOOP PRINCIPAL
# ---------------------------------------------------------
try:
    while True:
        print(f"\n--- Enviando Ciclo... ---")

        # Loop começa em 2 (preserva box_01) e vai até o total definido
        for i in range(2, QTD_TOTAL_CAIXAS + 1):
            
            # Formata o ID (box_02, box_03, ... box_10)
            suffix = f"0{i}" if i < 10 else str(i)
            box_id = f"box_{suffix}"
            
            topic = f"{TOPIC_BASE}{box_id}/telemetria"
            json_msg = ""

            # Se for a caixa 02, roda o drama
            if i == 2:
                dados, desc = gerar_dados_drama(box_id)
                json_msg = json.dumps(dados)
                print(f"[{box_id}] {desc}: Temp={dados['temperatura']} Luz={dados['luz']}")
            
            # As outras são apenas carga (estáveis)
            else:
                dados = gerar_dados_carga(box_id)
                json_msg = json.dumps(dados)
                # Não fazemos print de todas para não poluir o terminal, 
                # a menos que seja a última
                if i == QTD_TOTAL_CAIXAS:
                    print(f"[{box_id}] ... (Carga ok)")

            # Publica
            client.publish(topic, json_msg)
            
            # Pequena pausa para não engasgar a rede se forem muitas caixas
            time.sleep(0.01)

        print("-" * 40)
        time.sleep(5) # Intervalo entre atualizações no Dashboard

except KeyboardInterrupt:
    print("\n🛑 Simulador encerrado.")
    client.loop_stop()
    client.disconnect()