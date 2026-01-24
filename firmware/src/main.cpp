#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <vector> 

// ==========================================
// CONFIGURAÇÕES DE REDE E SERVIDOR
// ==========================================
const char* SSID_WIFI = "ENG.BRITO";       
const char* SENHA_WIFI = "Engenheiros.com"; 

// IMPORTANTE: Este IP deve ser o do seu computador (Wi-Fi)
const char* MQTT_SERVER = "192.168.3.219"; 
const int MQTT_PORT = 1883;

// ID único desta caixa (deve ser igual ao configurado no Python)
const char* BOX_ID = "box_01";

// Tópicos MQTT
const char* TOPIC_TELEMETRIA = "vasafe/box_01/telemetria";
const char* TOPIC_COMANDO    = "vasafe/box_01/comando";

// ==========================================
// PINAGEM E HARDWARE
// ==========================================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

#define PIN_DHT        15  // Sensor Temperatura
#define PIN_LDR        34  // Sensor Luz (Deve ser pino apenas de entrada ou ADC1)
#define PIN_BUZZER     4   // Buzzer
#define PIN_RGB_R      19  // Vermelho
#define PIN_RGB_G      18  // Verde
#define PIN_RGB_B      5   // Azul

// Objetos
WiFiClient espClient;
PubSubClient client(espClient);
DHT dht(PIN_DHT, DHT11); 
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// ==========================================
// VARIÁVEIS GLOBAIS
// ==========================================
const int MAX_BUFFER_SIZE = 50; // Tamanho do buffer offline
std::vector<String> offlineBuffer;
unsigned long lastMsg = 0;
String boxStatus = "AGUARDANDO"; // Status recebido do servidor

// Controle de Pisca (LED RGB)
unsigned long previousMillisBlink = 0;
bool ledState = LOW;

// Ajuste de Sensibilidade da Luz
// 50 = Escuro (Fechado) | 1200 = Claro (Aberto)
// Limite para considerar "Aberta":
const int LIMITE_LUZ_ALARME = 600; 

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

// Controla LED RGB (Catodo Comum)
// Se for Anodo Comum, use: digitalWrite(PIN, !valor);
void setRGB(int r, int g, int b) {
  digitalWrite(PIN_RGB_R, r);
  digitalWrite(PIN_RGB_G, g);
  digitalWrite(PIN_RGB_B, b);
}

// Atualiza Hardware (LEDs e Buzzer) baseado nos sensores e comandos
void atualizarHardware(bool online, bool erroSensor, int luz) {
  unsigned long currentMillis = millis();
  bool caixaAberta = (luz < LIMITE_LUZ_ALARME); // Se luz > 600, está aberta

  // --- A. LÓGICA DO BUZZER (SEGURANÇA FÍSICA) ---
  if (caixaAberta) { 
    digitalWrite(PIN_BUZZER, HIGH); // Apita se abrir
  } else {
    digitalWrite(PIN_BUZZER, LOW);  
  }

  // --- B. LÓGICA DO LED (STATUS DO SISTEMA) ---
  if (erroSensor) {
    // Pisca Vermelho Rápido (Erro no DHT)
    if (currentMillis - previousMillisBlink >= 200) {
      previousMillisBlink = currentMillis;
      ledState = !ledState;
      setRGB(ledState, 0, 0); 
    }
  }
  else if (online) {
    // O ESP32 obedece a variável 'boxStatus' enviada pelo Python
    if (boxStatus == "CRITICO!" || boxStatus == "FRAUDE") {
        setRGB(1, 0, 0); // Vermelho Fixo
    } else if (boxStatus == "ALERTA" || boxStatus == "ALERTA_LUZ") {
        setRGB(1, 1, 0); // Amarelo (Vermelho + Verde)
    } else {
        setRGB(0, 1, 0); // Verde (OK)
    }
  }
  else {
    // Azul: Conectado no WiFi mas sem MQTT (ou tentando reconectar)
    setRGB(0, 0, 1); 
  }
}

// Desenha a interface OLED
void drawScreen(float temp, int luz, int bufferSize, bool online, bool erro) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  // Linha 1: Status Conexão
  display.setTextSize(1);
  display.setCursor(0, 0);
  if (erro) display.print("ERRO SENSOR");
  else if (online) display.print("MONITORAMENTO ON");
  else display.print("OFFLINE (Buf: " + String(bufferSize) + ")");

  // Linha 2: Temperatura
  display.setCursor(0, 15);
  display.setTextSize(2);
  if (isnan(temp)) display.print("--.- C"); 
  else { display.print(temp, 1); display.print(" C"); }

  // Linha 3: Luz e Alerta Visual
  display.setTextSize(1);
  display.setCursor(0, 38);
  display.print("Luz: "); display.print(luz); 
  
  if (luz < LIMITE_LUZ_ALARME) {
    display.setCursor(70, 38);
    display.print("!ABERTO!"); 
  }

  // Linha 4: Status Remoto
  display.setCursor(0, 54);
  display.print("Status: ");
  // Corta a string se for muito longa para caber na tela
  if(boxStatus.length() > 10) display.print(boxStatus.substring(0, 10));
  else display.print(boxStatus); 

  display.display();
}

// Conexão WiFi
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
  Serial.print("IP ESP32: ");
  Serial.println(WiFi.localIP());
}

// ==========================================
// CALLBACK MQTT (Recebe comandos do Python)
// ==========================================
void callback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];
  
  Serial.print("MENSAGEM RECEBIDA: ");
  Serial.println(message); 

  // Tenta ler o JSON recebido
  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, message);

  if (!error) {
    // Se o Python mandar {"status": "CRITICO!"} ou {"led": "RED"}
    if (doc.containsKey("status_operacional")) {
        boxStatus = doc["status_operacional"].as<String>();
    } 
    else if (doc.containsKey("led")) {
       // Compatibilidade caso mande comando direto de cor
       String led = doc["led"].as<String>();
       if(led == "RED") boxStatus = "CRITICO!";
       else if(led == "YELLOW") boxStatus = "ALERTA";
       else boxStatus = "OK";
    }
  } else {
    Serial.println("Erro ao ler JSON recebido");
  }
}

// Reconexão MQTT
void tryReconnect() {
  if (WiFi.status() == WL_CONNECTED && !client.connected()) {
    Serial.print("Tentando MQTT em " + String(MQTT_SERVER) + "... ");
    
    // Conecta com o ID da caixa
    if (client.connect(BOX_ID)) {
      Serial.println("CONECTADO!");
      
      // Se inscreve para receber comandos
      client.subscribe(TOPIC_COMANDO); 
      Serial.println("Inscrito em: " + String(TOPIC_COMANDO));
      
    } else {
      Serial.print("Falha, rc=");
      Serial.print(client.state());
      Serial.println(" (tenta em 5s)");
      delay(5000);
    }
  }
}

// ==========================================
// SETUP
// ==========================================
void setup() {
  Serial.begin(115200);

  // Configura Pinos
  pinMode(PIN_RGB_R, OUTPUT);
  pinMode(PIN_RGB_G, OUTPUT);
  pinMode(PIN_RGB_B, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LDR, INPUT); // LDR é entrada analógica

  // Inicializa OLED
  Wire.begin(21, 22); // SDA, SCL padrão ESP32
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { 
    Serial.println(F("Falha no OLED")); 
  } else {
    display.clearDisplay();
    display.display();
  }

  dht.begin();
  setup_wifi();
  
  client.setServer(MQTT_SERVER, MQTT_PORT);
  client.setCallback(callback);
}

// ==========================================
// LOOP PRINCIPAL
// ==========================================
void loop() {
  // Verifica conexão MQTT
  if (!client.connected()) {
    tryReconnect();
  }
  client.loop(); // Mantém comunicação ativa

  unsigned long now = millis();

  // 1. Leitura de Sensores
  float temp = dht.readTemperature();
  int luz = analogRead(PIN_LDR); 

  // Trata erro de leitura do DHT
  bool erroSensor = isnan(temp);
  if (erroSensor) temp = 0.0;

  // 2. Atualiza atuadores (LED/Buzzer)
  atualizarHardware(client.connected(), erroSensor, luz);

  // 3. Envia Telemetria (a cada 2 segundos)
  if (now - lastMsg > 2000) {
    lastMsg = now;

    // Cria JSON
    StaticJsonDocument<256> doc;
    doc["box_id"] = BOX_ID;
    doc["temperatura"] = temp; // Nomes devem bater com o Python Pydantic
    doc["luz"] = luz;
    doc["aberta"] = (luz < LIMITE_LUZ_ALARME); // Booleano para facilitar pro Python

    char buffer[256];
    serializeJson(doc, buffer);

    // Envia ou guarda no Buffer
    if (client.connected()) {
      Serial.print("Enviando: ");
      Serial.println(buffer);
      client.publish(TOPIC_TELEMETRIA, buffer);
      
      // Se tiver dados velhos guardados, tenta enviar agora
      while (!offlineBuffer.empty()) {
        client.publish(TOPIC_TELEMETRIA, offlineBuffer.front().c_str());
        offlineBuffer.erase(offlineBuffer.begin());
        delay(50); // Pequeno delay para não engasgar
      }
    } else {
      Serial.println("Offline: Guardando no buffer...");
      if (offlineBuffer.size() >= MAX_BUFFER_SIZE) {
        offlineBuffer.erase(offlineBuffer.begin()); // Remove o mais antigo se encher
      }
      offlineBuffer.push_back(String(buffer));
    }
    
    // Atualiza a tela OLED
    drawScreen(temp, luz, offlineBuffer.size(), client.connected(), erroSensor);
  }
}