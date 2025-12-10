#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <vector> // Biblioteca para criar o Buffer Dinâmico

// ==========================================
// 1. CONFIGURAÇÕES
// ==========================================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

const char* SSID_WIFI = "ENG.BRITO";
const char* SENHA_WIFI = "Engenheiros.com";
const char* MQTT_SERVER = "192.168.3.219"; 
const int MQTT_PORT = 1883;
const char* BOX_ID = "box_01";

// Limite de segurança para não estourar a memória RAM
const int MAX_BUFFER_SIZE = 500; 

// ==========================================
// 2. PINAGEM
// ==========================================
#define PIN_DHT     15
#define PIN_LDR     34
#define PIN_BTN     4

// ==========================================
// 3. OBJETOS E VARIÁVEIS
// ==========================================
WiFiClient espClient;
PubSubClient client(espClient);
DHT dht(PIN_DHT, DHT11);
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// BUFFER NA RAM (A "Caixa Preta")
std::vector<String> offlineBuffer; 

unsigned long lastMsg = 0;
int buttonPressCount = 0;
bool lastButtonState = HIGH;
String boxStatus = "AGUARDANDO...";

// ==========================================
// 4. FUNÇÃO VISUAL (OLED)
// ==========================================
void drawScreen(float temp, String vibStatus, int bufferSize, bool online) {
  display.clearDisplay();
  display.setTextColor(WHITE);
  
  // Linha 1: Status Conexão
  display.setTextSize(1);
  display.setCursor(0, 0);
  if(online) {
    display.print("ONLINE  MQTT:OK");
  } else {
    // Inverte cores para alertar que está OFFLINE
    display.setTextColor(BLACK, WHITE);
    display.print("OFFLINE (SALVANDO)");
    display.setTextColor(WHITE);
  }
  
  // Linha 2: Temperatura
  display.setCursor(0, 15);
  display.setTextSize(2);
  display.print(temp, 1);
  display.print(" C");

  // Linha 3: Buffer (Memória) e Vibração
  display.setTextSize(1);
  display.setCursor(80, 15);
  display.print("Mem:");
  display.println(bufferSize); // Mostra quantos dados estão guardados

  display.setCursor(0, 35);
  display.print("Vib: ");
  display.print(vibStatus);

  // Linha 4: Status Final
  display.setCursor(0, 50);
  display.print("Sts: ");
  if (boxStatus == "CRITICO!") display.setTextColor(BLACK, WHITE);
  display.print(boxStatus);
  display.setTextColor(WHITE);

  display.display();
}

// ==========================================
// 5. REDE
// ==========================================
void setup_wifi() {
  WiFi.begin(SSID_WIFI, SENHA_WIFI);
  // Não travamos o código aqui. Se não conectar, ele segue em modo offline.
}

void callback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (int i = 0; i < length; i++) message += (char)payload[i];
  
  StaticJsonDocument<200> doc;
  deserializeJson(doc, message);
  const char* color = doc["led"];

  if (strcmp(color, "GREEN") == 0) boxStatus = "APROVADO";
  else if (strcmp(color, "RED") == 0) boxStatus = "CRITICO!";
  else if (strcmp(color, "YELLOW") == 0) boxStatus = "ALERTA";
}

void tryReconnect() {
  // Tenta reconectar sem travar o processamento (Non-blocking)
  if (WiFi.status() == WL_CONNECTED && !client.connected()) {
    if (client.connect(BOX_ID, "vasafe/box_01/status", 1, true, "OFFLINE")) {
      client.publish("vasafe/box_01/status", "ONLINE");
      client.subscribe("vasafe/box_01/comando");
    }
  }
}

// ==========================================
// 6. SETUP
// ==========================================
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BTN, INPUT_PULLUP);
  pinMode(PIN_LDR, INPUT);

  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) for(;;);
  display.clearDisplay();
  
  dht.begin();
  setup_wifi();
  client.setServer(MQTT_SERVER, MQTT_PORT);
  client.setCallback(callback);
}

// ==========================================
// 7. LOOP PRINCIPAL (INTELIGÊNCIA)
// ==========================================
void loop() {
  // 1. Garante conexão se possível, mas não trava se não der
  if (WiFi.status() != WL_CONNECTED) {
    // Tenta reconectar WiFi silenciosamente
    // WiFi.reconnect(); // O ESP32 faz isso sozinho geralmente
  } else {
    // Se tem WiFi mas não tem MQTT, tenta MQTT
    if (!client.connected()) tryReconnect();
  }
  
  client.loop();

  // 2. Leitura de Botão (Vibração)
  int reading = digitalRead(PIN_BTN);
  if (reading == LOW && lastButtonState == HIGH) {
    buttonPressCount++;
  }
  lastButtonState = reading;

  // 3. Ciclo de Telemetria (2 segundos)
  unsigned long now = millis();
  if (now - lastMsg > 2000) {
    lastMsg = now;

    // --- LEITURA ---
    float temp = dht.readTemperature();
    if (isnan(temp)) temp = 0.0;
    int luz = analogRead(PIN_LDR);
    String vibLevel = (buttonPressCount > 5) ? "ALTA" : "BAIXA";
    buttonPressCount = 0; // Reseta vibração

    // --- PACOTE JSON ---
    StaticJsonDocument<256> doc;
    doc["box_id"] = BOX_ID;
    doc["temp"] = temp;
    doc["vib"] = (vibLevel == "ALTA") ? "HIGH" : "LOW";
    doc["luz"] = luz;
    
    // Adiciona Timestamp se estiver offline (opcional, aqui usamos o do servidor)
    // Mas vamos marcar se é dado recuperado
    bool isBufferedData = false; 

    char buffer[256];
    serializeJson(doc, buffer);
    String jsonString = String(buffer);

    // --- LÓGICA STORE-AND-FORWARD ---
    
    if (client.connected()) {
      // CENÁRIO A: ONLINE
      // 1. Envia o dado atual
      client.publish("vasafe/box_01/telemetria", buffer);
      Serial.println("Enviando (Ao Vivo): " + jsonString);

      // 2. Verifica se tem lixo na memória (Buffer)
      if (offlineBuffer.size() > 0) {
        Serial.print(">>> SINCRONIZANDO BUFFER: ");
        Serial.print(offlineBuffer.size());
        Serial.println(" pendentes...");

        // Envia tudo o que estava guardado (Burst Upload)
        for (int i = 0; i < offlineBuffer.size(); i++) {
          client.publish("vasafe/box_01/telemetria", offlineBuffer[i].c_str());
          delay(50); // Pequeno delay para não engasgar o Broker
        }
        // Limpa a memória
        offlineBuffer.clear();
        Serial.println(">>> BUFFER SINCRONIZADO COM SUCESSO!");
      }

    } else {
      // CENÁRIO B: OFFLINE
      // Salva na RAM
      if (offlineBuffer.size() < MAX_BUFFER_SIZE) {
        offlineBuffer.push_back(jsonString);
        Serial.print("OFFLINE! Salvo na RAM. Total: ");
        Serial.println(offlineBuffer.size());
      } else {
        Serial.println("ERRO: Memória Cheia! Perdendo dados antigos...");
        // Opcional: Apagar o mais antigo para por o novo
        offlineBuffer.erase(offlineBuffer.begin());
        offlineBuffer.push_back(jsonString);
      }
    }

    // --- ATUALIZA TELA ---
    drawScreen(temp, vibLevel, offlineBuffer.size(), client.connected());
  }
  
  delay(10);
}