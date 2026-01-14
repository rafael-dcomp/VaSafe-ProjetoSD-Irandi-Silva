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

// SUAS CREDENCIAIS
const char* SSID_WIFI = "ENG.BRITO";
const char* SENHA_WIFI = "Engenheiros.com";
const char* MQTT_SERVER = "192.168.3.219";
const int MQTT_PORT = 1883;
const char* BOX_ID = "box_01";

// Limite de segurança para não estourar a memória RAM da ESP32
const int MAX_BUFFER_SIZE = 500;

// ==========================================
// 2. PINAGEM
// ==========================================
#define PIN_DHT     15  // Sensor Temperatura
#define PIN_LDR     34  // Sensor Luz (AO - Analogico)
#define PIN_BTN     4   // Botão

// ==========================================
// 3. OBJETOS E VARIÁVEIS
// ==========================================
WiFiClient espClient;
PubSubClient client(espClient);
DHT dht(PIN_DHT, DHT11);
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

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
  display.setTextColor(SSD1306_WHITE);

  // Linha 1: Status Conexão
  display.setTextSize(1);
  display.setCursor(0, 0);
  if (online) {
    display.print("ONLINE  MQTT:OK");
  } else {
    display.setTextColor(SSD1306_BLACK, SSD1306_WHITE);
    display.print("OFFLINE (SALVANDO)");
    display.setTextColor(SSD1306_WHITE);
  }

  // Linha 2: Temperatura
  display.setCursor(0, 15);
  display.setTextSize(2);
  if (isnan(temp)) {
    display.print("--.- C"); // Mostra traços se der erro
  } else {
    display.print(temp, 1);
    display.print(" C");
  }

  // Linha 3: Buffer e Vibração
  display.setTextSize(1);
  display.setCursor(80, 15);
  display.print("Mem:");
  display.print(bufferSize);

  display.setCursor(0, 35);
  display.print("Vib: ");
  display.print(vibStatus);

  // Linha 4: Status Final
  display.setCursor(0, 50);
  display.print("Sts: ");
  if (boxStatus == "CRITICO!") {
    display.setTextColor(SSD1306_BLACK, SSD1306_WHITE);
  }
  display.print(boxStatus);
  display.setTextColor(SSD1306_WHITE);

  display.display();
}

// ==========================================
// 5. REDE
// ==========================================
void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Tentando conectar WiFi: ");
  Serial.println(SSID_WIFI);
  WiFi.begin(SSID_WIFI, SENHA_WIFI);
}

void callback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];
  
  Serial.print("MENSAGEM RECEBIDA [");
  Serial.print(topic);
  Serial.print("]: ");
  Serial.println(message);

  StaticJsonDocument<200> doc;
  DeserializationError error = deserializeJson(doc, message);

  if (!error && doc.containsKey("led")) {
    const char* color = doc["led"];
    if (strcmp(color, "GREEN") == 0) boxStatus = "APROVADO";
    else if (strcmp(color, "RED") == 0) boxStatus = "CRITICO!";
    else if (strcmp(color, "YELLOW") == 0) boxStatus = "ALERTA";
  }
}

void tryReconnect() {
  if (WiFi.status() == WL_CONNECTED && !client.connected()) {
    Serial.print("Tentando reconexão MQTT... ");
    if (client.connect(BOX_ID, "vasafe/box_01/status", 1, true, "OFFLINE")) {
      Serial.println("CONECTADO!");
      client.publish("vasafe/box_01/status", "ONLINE");
      client.subscribe("vasafe/box_01/comando");
    } else {
      Serial.print("Falha. Estado: ");
      Serial.println(client.state());
    }
  }
}

// ==========================================
// 6. SETUP
// ==========================================
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== INICIANDO SISTEMA VASAFE ===");

  pinMode(PIN_BTN, INPUT_PULLUP);
  pinMode(PIN_LDR, INPUT);

  Wire.begin(21, 22);

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("ERRO CRÍTICO: OLED não encontrado!");
    // Não trava, tenta seguir
  } else {
    Serial.println("OLED Iniciado OK");
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0,0);
    display.println("Iniciando...");
    display.display();
  }

  dht.begin();
  setup_wifi();
  client.setServer(MQTT_SERVER, MQTT_PORT);
  client.setCallback(callback);
}

// ==========================================
// 7. LOOP PRINCIPAL
// ==========================================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    // WiFi caindo...
  } else {
    if (!client.connected()) tryReconnect();
  }

  client.loop();

  int reading = digitalRead(PIN_BTN);
  if (reading == LOW && lastButtonState == HIGH) {
    buttonPressCount++;
    Serial.println("Botão Pressionado!"); // Debug Botão
    delay(50);
  }
  lastButtonState = reading;

  unsigned long now = millis();
  if (now - lastMsg > 2000) {
    lastMsg = now;

    // --- DIAGNÓSTICO (LEITURA DETALHADA) ---
    Serial.println("\n--- LEITURA DE SENSORES ---");
    
    // 1. Temperatura
    float temp = dht.readTemperature();
    Serial.print("DHT Temp: ");
    if (isnan(temp)) {
      Serial.println("ERRO (NaN) - Verifique fio no Pino 15!");
      temp = 0.0;
    } else {
      Serial.print(temp);
      Serial.println(" °C");
    }

    // 2. Luz
    int luz = analogRead(PIN_LDR);
    Serial.print("LDR Luz (0-4095): ");
    Serial.print(luz);
    if(luz == 0 || luz == 4095) Serial.print(" <- ALERTA: Pode precisar calibrar parafuso!");
    Serial.println();

    // 3. Vibração
    String vibLevel = (buttonPressCount >= 2) ? "ALTA" : "BAIXA";
    buttonPressCount = 0;
    Serial.print("Vibração detectada: ");
    Serial.println(vibLevel);

    // --- JSON ---
    StaticJsonDocument<256> doc;
    doc["box_id"] = BOX_ID;
    doc["temp"] = temp;
    doc["vib"] = (vibLevel == "ALTA") ? "HIGH" : "LOW";
    doc["luz"] = luz;

    char buffer[256];
    serializeJson(doc, buffer);
    String jsonString = String(buffer);

    // --- ENVIO ---
    if (client.connected()) {
      Serial.print("Enviando MQTT: ");
      Serial.println(jsonString);
      client.publish("vasafe/box_01/telemetria", buffer);

      if (offlineBuffer.size() > 0) {
        Serial.print("Sincronizando Buffer... ");
        for (size_t i = 0; i < offlineBuffer.size(); i++) {
          client.publish("vasafe/box_01/telemetria", offlineBuffer[i].c_str());
          delay(50);
        }
        offlineBuffer.clear();
        Serial.println("OK!");
      }

    } else {
      Serial.println("WiFi/MQTT Offline. Salvando no Buffer.");
      if ((int)offlineBuffer.size() < MAX_BUFFER_SIZE) {
        offlineBuffer.push_back(jsonString);
      } else {
        offlineBuffer.erase(offlineBuffer.begin());
        offlineBuffer.push_back(jsonString);
      }
    }

    drawScreen(temp, vibLevel, offlineBuffer.size(), client.connected());
  }
}