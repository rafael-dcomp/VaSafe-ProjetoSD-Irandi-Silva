#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <vector> 

// --- CONFIGURAÇÕES DE TELA ---
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

// --- CONFIGURAÇÕES DE REDE ---
const char* SSID_WIFI = "ENG.BRITO";       
const char* SENHA_WIFI = "Engenheiros.com"; 
const char* MQTT_SERVER = "192.168.3.219"; 
const int MQTT_PORT = 1883;
const char* BOX_ID = "box_01";

// --- PINAGEM (ATUALIZADA) ---
#define PIN_DHT        15  // Sensor Temperatura
#define PIN_LDR        34  // Sensor Luz (AO)
#define PIN_BUZZER     4   // Buzzer (Alarme)

// Pinos do RGB
#define PIN_RGB_R      19  // Vermelho
#define PIN_RGB_G      18  // Verde
#define PIN_RGB_B      5   // Azul

// --- OBJETOS GLOBAIS ---
WiFiClient espClient;
PubSubClient client(espClient);
DHT dht(PIN_DHT, DHT11); 
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// --- VARIÁVEIS DE CONTROLE ---
const int MAX_BUFFER_SIZE = 500; 
std::vector<String> offlineBuffer;
unsigned long lastMsg = 0;
String boxStatus = "AGUARDANDO...";

// Controle de Pisca (RGB Vermelho)
unsigned long previousMillisBlink = 0;
bool ledState = LOW;

// --- FUNÇÃO AUXILIAR: DEFINIR COR RGB ---
void setRGB(int r, int g, int b) {
  // Se for Cátodo Comum (GND comum), use HIGH para acender
  digitalWrite(PIN_RGB_R, r);
  digitalWrite(PIN_RGB_G, g);
  digitalWrite(PIN_RGB_B, b);
}

// --- CONTROLE DE HARDWARE (LEDS + BUZZER) ---
void atualizarHardware(bool online, bool erroSensor, int luz) {
  unsigned long currentMillis = millis();

  // 1. LÓGICA DO BUZZER (ALARME DE LUZ)
  // Se a luz passar de 2000, a caixa abriu -> APITA!
  if (luz > 2000) { 
    digitalWrite(PIN_BUZZER, HIGH); // Apita
  } else {
    digitalWrite(PIN_BUZZER, LOW);  // Silêncio
  }

  // 2. LÓGICA DO LED RGB
  
  // PRIORIDADE 1: ERRO DE SENSOR (PISCA VERMELHO)
  if (erroSensor) {
    if (currentMillis - previousMillisBlink >= 200) {
      previousMillisBlink = currentMillis;
      ledState = !ledState;
      // Pisca Vermelho
      setRGB(ledState, 0, 0); 
    }
  }
  // PRIORIDADE 2: ONLINE (VERDE)
  else if (online) {
    setRGB(0, 1, 0); // R=0, G=1, B=0
  }
  // PRIORIDADE 3: OFFLINE (AMARELO -> VERMELHO + VERDE)
  else {
    setRGB(1, 1, 0); // Mistura R+G = Amarelo
  }
}

// --- DESENHO NA TELA ---
void drawScreen(float temp, int luz, int bufferSize, bool online, bool erro) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  // Bolinhas Digitais (Mantivemos para combinar com o RGB)
  int r = 3; int yPos = 5;
  int xG = 105; int xY = 115; int xR = 125;
  display.drawCircle(xG, yPos, r, SSD1306_WHITE);
  display.drawCircle(xY, yPos, r, SSD1306_WHITE);
  display.drawCircle(xR, yPos, r, SSD1306_WHITE);

  if (erro) display.fillCircle(xR, yPos, r, SSD1306_WHITE);
  else if (online) display.fillCircle(xG, yPos, r, SSD1306_WHITE);
  else display.fillCircle(xY, yPos, r, SSD1306_WHITE);

  // Linha 1: Status Texto
  display.setTextSize(1);
  display.setCursor(0, 0);
  if (erro) display.print("ERRO SENSOR");
  else if (online) display.print("SISTEMA OK");
  else display.print("MODO BUFFER");

  // Linha 2: Temperatura
  display.setCursor(0, 15);
  display.setTextSize(2);
  if (isnan(temp)) {
    display.print("--.- C"); 
  } else {
    display.print(temp, 1);
    display.print(" C");
  }

  // Linha 3: Luz e Alarme
  display.setTextSize(1);
  display.setCursor(0, 38);
  display.print("Luz: ");
  display.print(luz);
  
  // Aviso visual de alarme
  if (luz > 2000) {
    display.setCursor(65, 38);
    display.print("!ALARME!");
  }

  // Linha 4: Memória
  display.setCursor(0, 52);
  display.print("Mem:");
  display.print(bufferSize);
  
  display.setCursor(60, 52);
  if (boxStatus == "CRITICO!") display.setTextColor(SSD1306_BLACK, SSD1306_WHITE); 
  display.print(boxStatus);
  display.setTextColor(SSD1306_WHITE);

  display.display();
}

void setup_wifi() {
  delay(10);
  WiFi.begin(SSID_WIFI, SENHA_WIFI);
}

void callback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];
  
  StaticJsonDocument<200> doc;
  DeserializationError error = deserializeJson(doc, message);

  if (!error && doc.containsKey("led")) {
    const char* color = doc["led"];
    if (strcmp(color, "GREEN") == 0) boxStatus = "OK";
    else if (strcmp(color, "RED") == 0) boxStatus = "CRITICO!";
    else if (strcmp(color, "YELLOW") == 0) boxStatus = "ALERTA";
  }
}

void tryReconnect() {
  if (WiFi.status() == WL_CONNECTED && !client.connected()) {
    if (client.connect(BOX_ID, "vasafe/box_01/status", 1, true, "OFFLINE")) {
      client.publish("vasafe/box_01/status", "ONLINE");
      client.subscribe("vasafe/box_01/comando");
    }
  }
}

void setup() {
  Serial.begin(115200);

  // Configuração Pinos RGB e Buzzer
  pinMode(PIN_RGB_R, OUTPUT);
  pinMode(PIN_RGB_G, OUTPUT);
  pinMode(PIN_RGB_B, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  
  // Teste de Cores Inicial (RGB) e Buzzer
  setRGB(1, 0, 0); delay(200); // Vermelho
  setRGB(0, 1, 0); delay(200); // Verde
  setRGB(0, 0, 1); delay(200); // Azul
  setRGB(0, 0, 0); // Desliga
  
  // Apito curto de teste
  digitalWrite(PIN_BUZZER, HIGH); delay(100); digitalWrite(PIN_BUZZER, LOW);

  Wire.begin(21, 22);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("FALHA NO OLED");
  } else {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.println("Iniciando...");
    display.display();
  }

  dht.begin();
  setup_wifi();
  client.setServer(MQTT_SERVER, MQTT_PORT);
  client.setCallback(callback);
}

void loop() {
  if (WiFi.status() == WL_CONNECTED && !client.connected()) {
    tryReconnect();
  }
  client.loop();

  unsigned long now = millis();
  
  // --- LEITURA INSTANTÂNEA PARA RGB E BUZZER ---
  float checkTemp = dht.readTemperature();
  int checkLuz = analogRead(PIN_LDR); // Leitura para o alarme
  
  bool sensorError = isnan(checkTemp);
  bool isOnline = client.connected();

  // Controla cor do LED e Som do Buzzer
  atualizarHardware(isOnline, sensorError, checkLuz);

  // --- LOOP DE ENVIO (2 segundos) ---
  if (now - lastMsg > 2000) {
    lastMsg = now;

    float temp = dht.readTemperature();
    int luz = analogRead(PIN_LDR);

    if (isnan(temp)) temp = 0.0; 

    StaticJsonDocument<256> doc;
    doc["box_id"] = BOX_ID;
    doc["temp"] = temp;
    doc["luz"] = luz;

    char buffer[256];
    serializeJson(doc, buffer);
    String jsonString = String(buffer);

    // Lógica de Envio / Buffer
    if (isOnline && !sensorError) {
      client.publish("vasafe/box_01/telemetria", buffer);
      while (offlineBuffer.size() > 0) {
        client.publish("vasafe/box_01/telemetria", offlineBuffer[0].c_str());
        offlineBuffer.erase(offlineBuffer.begin());
        delay(50);
      }
    } else {
      if (!sensorError) {
         if ((int)offlineBuffer.size() < MAX_BUFFER_SIZE) {
           offlineBuffer.push_back(jsonString);
         } else {
           offlineBuffer.erase(offlineBuffer.begin());
           offlineBuffer.push_back(jsonString);
         }
      }
    }
    drawScreen(temp, luz, offlineBuffer.size(), isOnline, sensorError);
  }
}