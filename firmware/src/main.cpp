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
// ⚠ VERIFIQUE SE O IP DO BROKER MUDOU!
const char* SSID_WIFI = "ENG.BRITO";       
const char* SENHA_WIFI = "Engenheiros.com"; 
const char* MQTT_SERVER = "192.168.3.219"; // <--- CONFIRME ESSE IP NO SEU COMPUTADOR
const int MQTT_PORT = 1883;
const char* BOX_ID = "box_01";

// --- PINAGEM ---
#define PIN_DHT        15  // Sensor Temperatura
#define PIN_LDR        34  // Sensor Luz (AO)
#define PIN_BUZZER     4   // Buzzer
#define PIN_RGB_R      19  // Vermelho
#define PIN_RGB_G      18  // Verde
#define PIN_RGB_B      5   // Azul

// --- OBJETOS ---
WiFiClient espClient;
PubSubClient client(espClient);
DHT dht(PIN_DHT, DHT11); 
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// --- VARIÁVEIS ---
const int MAX_BUFFER_SIZE = 500; 
std::vector<String> offlineBuffer;
unsigned long lastMsg = 0;
String boxStatus = "AGUARDANDO...";

// Controle de Pisca (RGB)
unsigned long previousMillisBlink = 0;
bool ledState = LOW;

// --- AJUSTE DE SENSIBILIDADE DA LUZ ---
// Se o número no Serial for MAIOR que isso, apita.
// Ajuste conforme o que aparecer no seu monitor serial.
const int LIMITE_LUZ_ALARME = 2000; 

void setRGB(int r, int g, int b) {
  digitalWrite(PIN_RGB_R, r);
  digitalWrite(PIN_RGB_G, g);
  digitalWrite(PIN_RGB_B, b);
}

void atualizarHardware(bool online, bool erroSensor, int luz) {
  unsigned long currentMillis = millis();

  // 1. BUZZER (Debug no Serial para calibração)
  if (luz > LIMITE_LUZ_ALARME) { 
    digitalWrite(PIN_BUZZER, HIGH);
  } else {
    digitalWrite(PIN_BUZZER, LOW);  
  }

  // 2. LED RGB
  if (erroSensor) {
    // Pisca Vermelho (Erro leitura DHT)
    if (currentMillis - previousMillisBlink >= 200) {
      previousMillisBlink = currentMillis;
      ledState = !ledState;
      setRGB(ledState, 0, 0); 
    }
  }
  else if (online) {
    setRGB(0, 1, 0); // Verde (Conectado no MQTT)
  }
  else {
    setRGB(1, 1, 0); // Amarelo (Sem conexão)
  }
}

void drawScreen(float temp, int luz, int bufferSize, bool online, bool erro) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  // Status visual (Bolinhas)
  int r = 3; int yPos = 5;
  if (erro) display.fillCircle(125, yPos, r, SSD1306_WHITE);
  else if (online) display.fillCircle(105, yPos, r, SSD1306_WHITE);
  else display.fillCircle(115, yPos, r, SSD1306_WHITE);

  display.setTextSize(1);
  display.setCursor(0, 0);
  if (erro) display.print("ERRO SENSOR");
  else if (online) display.print("CONECTADO");
  else display.print("DESCONECTADO");

  display.setCursor(0, 15);
  display.setTextSize(2);
  if (isnan(temp)) display.print("--.- C"); 
  else { display.print(temp, 1); display.print(" C"); }

  display.setTextSize(1);
  display.setCursor(0, 38);
  display.print("Luz: ");
  display.print(luz); // <-- VALOR IMPORTANTE PARA CALIBRAR
  
  if (luz > LIMITE_LUZ_ALARME) {
    display.setCursor(65, 38);
    display.print("!ALARME!");
  }

  display.setCursor(0, 52);
  display.print("Mem:"); display.print(bufferSize);
  
  display.setCursor(50, 52);
  display.print(boxStatus); // "AGUARDANDO" ou Status do Server

  display.display();
}

void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Conectando WiFi: ");
  Serial.println(SSID_WIFI);
  WiFi.begin(SSID_WIFI, SENHA_WIFI);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Conectado!");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

// Recebe mensagens do Servidor (Backend)
void callback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];
  
  Serial.print("Mensagem recebida [");
  Serial.print(topic);
  Serial.print("]: ");
  Serial.println(message);

  StaticJsonDocument<200> doc;
  DeserializationError error = deserializeJson(doc, message);

  if (!error) {
    // Atualiza status se o servidor mandar
    if (doc.containsKey("led")) {
       const char* color = doc["led"];
       if (strcmp(color, "GREEN") == 0) boxStatus = "OK";
       else if (strcmp(color, "RED") == 0) boxStatus = "CRITICO!";
       else if (strcmp(color, "YELLOW") == 0) boxStatus = "ALERTA";
    }
  }
}

void tryReconnect() {
  if (WiFi.status() == WL_CONNECTED && !client.connected()) {
    Serial.print("Tentando MQTT... ");
    // Tenta conectar com mensagem de 'Last Will' (se cair avisa)
    if (client.connect(BOX_ID, "vasafe/box_01/status", 1, true, "OFFLINE")) {
      Serial.println("CONECTADO!");
      // Avisa que entrou
      client.publish("vasafe/box_01/status", "ONLINE");
      // Escuta comandos do servidor
      client.subscribe("vasafe/box_01/comando");
    } else {
      Serial.print("Falha, rc=");
      Serial.print(client.state());
      Serial.println(" tenta de novo em 5s");
    }
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(PIN_RGB_R, OUTPUT);
  pinMode(PIN_RGB_G, OUTPUT);
  pinMode(PIN_RGB_B, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  
  // Teste de vida do hardware
  setRGB(1,1,1); delay(500); setRGB(0,0,0);
  digitalWrite(PIN_BUZZER, HIGH); delay(100); digitalWrite(PIN_BUZZER, LOW);

  Wire.begin(21, 22);
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { 
    Serial.println(F("Falha OLED")); 
  } else {
    display.clearDisplay();
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

  // Leitura Sensores
  float temp = dht.readTemperature();
  int luz = analogRead(PIN_LDR); 

  // Debug instantâneo no Serial (AJUDA A CALIBRAR O BUZZER)
  // Serial.print("Luz: "); Serial.println(luz); 

  // Controle Hardware
  atualizarHardware(client.connected(), isnan(temp), luz);

  // Envio a cada 2 segundos
  if (now - lastMsg > 2000) {
    lastMsg = now;
    
    if (isnan(temp)) temp = 0.0; 

    // Cria JSON
    StaticJsonDocument<256> doc;
    doc["box_id"] = BOX_ID;
    doc["temp"] = temp;
    doc["luz"] = luz;

    char buffer[256];
    serializeJson(doc, buffer);
    String jsonString = String(buffer);

    // Envia se estiver online
    if (client.connected()) {
      Serial.print("Enviando JSON: ");
      Serial.println(jsonString);
      client.publish("vasafe/box_01/telemetria", buffer);
      
      // Esvazia buffer se tiver coisa velha guardada
      while (!offlineBuffer.empty()) {
        client.publish("vasafe/box_01/telemetria", offlineBuffer.front().c_str());
        offlineBuffer.erase(offlineBuffer.begin());
        delay(50);
      }
    } else {
      // Guarda no Buffer se estiver offline
      Serial.println("Offline. Salvando no buffer.");
      if (offlineBuffer.size() >= MAX_BUFFER_SIZE) {
        offlineBuffer.erase(offlineBuffer.begin());
      }
      offlineBuffer.push_back(jsonString);
    }
    
    drawScreen(temp, luz, offlineBuffer.size(), client.connected(), isnan(temp));
  }
}