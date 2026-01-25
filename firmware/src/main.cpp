#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <vector>
#include <WiFiManager.h> // <--- BIBLIOTECA PARA PORTAL DE CONFIGURAÇÃO
#include <Preferences.h> // <--- PARA SALVAR DADOS NA MEMÓRIA

// --- DEFINIÇÕES DE HARDWARE ---
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define PIN_DHT        15  // Sensor Temperatura
#define PIN_LDR        34  // Sensor Luz 
#define PIN_BUZZER     4   // Buzzer
#define PIN_RGB_R      19  // Vermelho
#define PIN_RGB_G      18  // Verde
#define PIN_RGB_B      5   // Azul
#define PIN_CONFIG_BTN 0   // Botão BOOT (Agora usado no LOOP)

// --- CONSTANTES DO SISTEMA ---
const int CAPACIDADE_MEMORIA_MENSAGENS = 400; 
const int LIMITE_LUZ_ALARME = 600; 

// --- OBJETOS GLOBAIS ---
WiFiClient espClient;
PubSubClient client(espClient);
DHT dht(PIN_DHT, DHT11); 
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
Preferences preferences; 

// --- VARIÁVEIS DE CONFIGURAÇÃO (Valores padrão) ---
char mqtt_server[40] = "0.0.0.0";
char mqtt_port[6] = "1883";
char box_id[15] = "box_01";
char config_intervalo[6] = "0"; // 0 = Automático
char config_duracao[6] = "3";   // 3 horas padrão

// --- VARIÁVEIS DE OPERAÇÃO ---
const char* TOPIC_TELEMETRIA_BASE = "vasafe/";
const char* TOPIC_COMANDO_BASE    = "vasafe/";
String topicTelemetria;
String topicComando;

std::vector<String> offlineBuffer;
unsigned long lastMsg = 0;
unsigned long intervaloEnvioReal = 60000; 
String boxStatus = "AGUARDANDO"; 

unsigned long previousMillisBlink = 0;
bool ledState = LOW;
bool shouldSaveConfig = false;

// Variável para controlar o botão de reset no loop
unsigned long btnPressStart = 0;

// --- CALLBACK WIFI MANAGER ---
void saveConfigCallback () {
  Serial.println("Alterações detectadas. Salvando...");
  shouldSaveConfig = true;
}

// --- FUNÇÕES AUXILIARES ---
void setRGB(int r, int g, int b) {
  digitalWrite(PIN_RGB_R, r);
  digitalWrite(PIN_RGB_G, g);
  digitalWrite(PIN_RGB_B, b);
}

void desenharTelaConfig() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("MODO CONFIGURACAO");
  display.println("-----------------");
  display.println("Conecte no WiFi:");
  display.setTextSize(2);
  display.println("VaSafe-CFG");
  display.setTextSize(1);
  display.println("IP: 192.168.4.1");
  display.display();
}

void drawScreen(float temp, int luz, int bufferSize, bool online, bool erro) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(1);
  display.setCursor(0, 0);
  if (erro) display.print("ERRO SENSOR");
  else if (online) display.print("MONITORAMENTO ON");
  else display.print("OFFLINE (Buf: " + String(bufferSize) + ")");

  display.setCursor(0, 15);
  display.setTextSize(2);
  if (isnan(temp)) display.print("--.- C"); 
  else { display.print(temp, 1); display.print(" C"); }

  display.setTextSize(1);
  display.setCursor(0, 38);
  display.print("Luz: "); display.print(luz); 
  
  if (luz < LIMITE_LUZ_ALARME) {
    display.setCursor(70, 38);
    display.print("!ABERTO!"); 
  }

  display.setCursor(0, 54);
  display.print("S: ");
  if(boxStatus.length() > 10) display.print(boxStatus.substring(0, 10));
  else display.print(boxStatus); 

  display.display();
}

void callback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];
  
  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, message);

  if (!error) {
    if (doc.containsKey("status_operacional")) {
        boxStatus = doc["status_operacional"].as<String>();
    } 
    else if (doc.containsKey("led")) {
       String led = doc["led"].as<String>();
       if(led == "RED") boxStatus = "CRITICO!";
       else if(led == "YELLOW") boxStatus = "ALERTA";
       else boxStatus = "OK";
    }
  }
}

void atualizarHardware(bool online, bool erroSensor, int luz) {
  unsigned long currentMillis = millis();
  
  bool caixaAberta = (luz < LIMITE_LUZ_ALARME); 

  if (caixaAberta) { 
    digitalWrite(PIN_BUZZER, HIGH);
  } else {
    digitalWrite(PIN_BUZZER, LOW);  
  }

  if (erroSensor) {
    if (currentMillis - previousMillisBlink >= 200) {
      previousMillisBlink = currentMillis;
      ledState = !ledState;
      setRGB(ledState, 0, 0); 
    }
  }
  else if (online) {
    if (boxStatus == "CRITICO!" || boxStatus == "FRAUDE") {
        setRGB(1, 0, 0);
    } else if (boxStatus == "ALERTA" || boxStatus == "ALERTA_LUZ") {
        setRGB(1, 1, 0); 
    } else {
        setRGB(0, 1, 0); 
    }
  }
  else {
    setRGB(0, 0, 1); 
  }
}

void tryReconnect() {
  if (WiFi.status() == WL_CONNECTED && !client.connected()) {
    if (client.connect(box_id)) {
      client.subscribe(topicComando.c_str()); 
    }
  }
}

// --- FUNÇÃO DE RESET SEGURO ---
void checkResetButton() {
  // O botão BOOT (GPIO 0) é LOW quando pressionado
  if (digitalRead(PIN_CONFIG_BTN) == LOW) {
    // Se começou a apertar agora
    if (btnPressStart == 0) {
       btnPressStart = millis();
    }
    // Se já está segurando há mais de 3 segundos (3000ms)
    if (millis() - btnPressStart > 3000) {
       Serial.println("Botão Segurado: Resetando Configurações...");
       
       display.clearDisplay();
       display.setCursor(0,20);
       display.setTextSize(2);
       display.println("RESETANDO");
       display.println(" WIFI...");
       display.display();
       
       WiFiManager wm;
       wm.resetSettings(); // Apaga as configurações salvas
       delay(1000);
       ESP.restart(); // Reinicia a placa (vai voltar no modo AP)
    }
  } else {
    // Se soltou o botão, zera o contador
    btnPressStart = 0;
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(PIN_RGB_R, OUTPUT);
  pinMode(PIN_RGB_G, OUTPUT);
  pinMode(PIN_RGB_B, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LDR, INPUT);
  pinMode(PIN_CONFIG_BTN, INPUT_PULLUP);

  Wire.begin(21, 22); 
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { 
    Serial.println(F("Falha no OLED")); 
  } else {
    display.clearDisplay();
    display.display();
  }

  dht.begin();

  // --- CARREGAR DADOS ---
  preferences.begin("vasafe_cfg", false);
  String saved_server = preferences.getString("server", "0.0.0.0");
  String saved_port   = preferences.getString("port", "1883");
  String saved_id     = preferences.getString("boxid", "box_01");
  String saved_int    = preferences.getString("interval", "0");
  String saved_dur    = preferences.getString("duration", "3");

  saved_server.toCharArray(mqtt_server, 40);
  saved_port.toCharArray(mqtt_port, 6);
  saved_id.toCharArray(box_id, 15);
  saved_int.toCharArray(config_intervalo, 6);
  saved_dur.toCharArray(config_duracao, 6);

  // --- WIFIMANAGER ---
  WiFiManager wm;
  wm.setSaveConfigCallback(saveConfigCallback);

  WiFiManagerParameter custom_mqtt_server("server", "IP AWS (Publico)", mqtt_server, 40);
  WiFiManagerParameter custom_mqtt_port("port", "Porta MQTT", mqtt_port, 6);
  WiFiManagerParameter custom_box_id("boxid", "ID da Caixa", box_id, 15);
  WiFiManagerParameter custom_interval("interval", "Intervalo Manual (seg) - 0 p/ Auto", config_intervalo, 6);
  WiFiManagerParameter custom_duration("duration", "Duracao Viagem (Horas)", config_duracao, 6);

  wm.addParameter(&custom_mqtt_server);
  wm.addParameter(&custom_mqtt_port);
  wm.addParameter(&custom_box_id);
  wm.addParameter(&custom_interval);
  wm.addParameter(&custom_duration);

  // REMOVI O CHEQUE DO BOTÃO AQUI NO SETUP PARA EVITAR O MODO DOWNLOAD

  wm.setConfigPortalTimeout(180); 
  
  // Tenta conectar. Se não tiver rede salva, cria o AP VaSafe-Config
  if (!wm.autoConnect("VaSafe-Config")) {
    Serial.println("Falha na conexao ou timeout. Rodando em modo Offline...");
  } else {
    Serial.println("WiFi Conectado!");
    
    if (shouldSaveConfig) {
      strcpy(mqtt_server, custom_mqtt_server.getValue());
      strcpy(mqtt_port, custom_mqtt_port.getValue());
      strcpy(box_id, custom_box_id.getValue());
      strcpy(config_intervalo, custom_interval.getValue());
      strcpy(config_duracao, custom_duration.getValue());

      preferences.putString("server", mqtt_server);
      preferences.putString("port", mqtt_port);
      preferences.putString("boxid", box_id);
      preferences.putString("interval", config_intervalo);
      preferences.putString("duration", config_duracao);
    }
  }

  // --- CÁLCULO INTERVALO ---
  int intervaloManual = atoi(config_intervalo);
  float duracaoHoras = atof(config_duracao);

  if (intervaloManual > 0) {
      intervaloEnvioReal = intervaloManual * 1000;
  } else {
      if (duracaoHoras <= 0) duracaoHoras = 1; 
      unsigned long totalSegundosViagem = duracaoHoras * 3600;
      unsigned long calcIntervalo = totalSegundosViagem / CAPACIDADE_MEMORIA_MENSAGENS;
      if (calcIntervalo < 10) calcIntervalo = 10; 
      intervaloEnvioReal = calcIntervalo * 1000;
      Serial.print("Calculo AUTOMATICO: "); Serial.print(calcIntervalo); Serial.println("s");
  }

  topicTelemetria = String(TOPIC_TELEMETRIA_BASE) + String(box_id) + "/telemetria";
  topicComando    = String(TOPIC_COMANDO_BASE) + String(box_id) + "/comando";

  int portaInt = atoi(mqtt_port);
  client.setServer(mqtt_server, portaInt);
  client.setCallback(callback);
}

void loop() {
  checkResetButton();

  if (WiFi.status() == WL_CONNECTED) {
    if (!client.connected()) {
       tryReconnect();
    }
    client.loop();
  }

  unsigned long now = millis();
  float temp = dht.readTemperature();
  int luz = analogRead(PIN_LDR); 

  bool erroSensor = isnan(temp);
  if (erroSensor) temp = 0.0;

  atualizarHardware(client.connected(), erroSensor, luz);

  if (now - lastMsg > intervaloEnvioReal) {
    lastMsg = now;

    StaticJsonDocument<256> doc;
    doc["box_id"] = box_id;
    doc["temperatura"] = temp; 
    doc["luz"] = luz;
    doc["aberta"] = (luz < LIMITE_LUZ_ALARME); 

    char buffer[256];
    serializeJson(doc, buffer);

    if (client.connected()) {
      Serial.print("Enviando (Online): ");
      Serial.println(buffer);
      client.publish(topicTelemetria.c_str(), buffer);
      
      while (!offlineBuffer.empty()) {
        client.publish(topicTelemetria.c_str(), offlineBuffer.front().c_str());
        offlineBuffer.erase(offlineBuffer.begin());
        delay(50); 
      }
    } else {
      Serial.print("Salvando (Offline) - Buffer: ");
      Serial.println(offlineBuffer.size() + 1);
      
      if (offlineBuffer.size() >= CAPACIDADE_MEMORIA_MENSAGENS) {
        offlineBuffer.erase(offlineBuffer.begin()); 
      }
      offlineBuffer.push_back(String(buffer));
    }
    
    drawScreen(temp, luz, offlineBuffer.size(), client.connected(), erroSensor);
  }
}