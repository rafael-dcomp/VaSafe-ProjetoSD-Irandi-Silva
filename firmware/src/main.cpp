#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <vector>
#include <WiFiManager.h> 
#include <Preferences.h> 

// --- DEFINIÇÕES DE HARDWARE ---
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define PIN_DHT        15  
#define PIN_LDR        34   
#define PIN_BUZZER     4   
#define PIN_RGB_R      19  
#define PIN_RGB_G      18  
#define PIN_RGB_B      5   
#define PIN_CONFIG_BTN 0   

// --- CONSTANTES DO SISTEMA ---
const int CAPACIDADE_MEMORIA_MENSAGENS = 400; // Total de slots na memória RAM
const int LIMITE_LUZ_ALARME = 600;            // Abaixo disso = Caixa Aberta
const float LIMITE_VARIACAO_TEMP = 2.0;       // Variação brusca de temperatura

// --- OBJETOS GLOBAIS ---
WiFiClient espClient;
PubSubClient client(espClient);
DHT dht(PIN_DHT, DHT11); 
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
Preferences preferences; 

// --- VARIÁVEIS DE CONFIGURAÇÃO ---
char mqtt_server[40] = "0.0.0.0";
char mqtt_port[6] = "1883";
char box_id[15] = "box_01";

// Configurações de Tempo
char config_duracao[6] = "3";      // Duração da viagem (Horas) -> Define a MEDIÇÃO
char config_sync_min[6] = "5";    // Período de Sync (Minutos) -> Define o ENVIO

// --- VARIÁVEIS DE OPERAÇÃO ---
const char* TOPIC_TELEMETRIA_BASE = "vasafe/";
const char* TOPIC_COMANDO_BASE    = "vasafe/";
String topicTelemetria;
String topicComando;

std::vector<String> offlineBuffer;   

// Timers
unsigned long lastMedicao = 0;       // Timer para salvar na memória
unsigned long lastSync = 0;          // Timer para ligar o WiFi e enviar
unsigned long lastMsgEmergencia = 0; 

// Intervalos Calculados
unsigned long intervaloMedicaoReal = 0;      // Calculado (Duração / Memoria)
unsigned long intervaloSincronizacaoReal = 0; // Configurado pelo usuário

String boxStatus = "AGUARDANDO"; 

// --- CONTROLE DE COMANDO REMOTO ---
bool forcarSincronizacao = false; 

// --- CONTROLE DE ENERGIA E ESTADOS ---
bool wifiLigado = true;
unsigned long lastConnectionTime = 0;
float ultimaTempEnviada = -999.0;
bool modoEmergencia = false; 

// --- TIMER DE LEITURA RÁPIDA (VISUALIZAÇÃO) ---
unsigned long lastSensorRead = 0;     
const int INTERVALO_LEITURA_TELA = 1000; 

unsigned long previousMillisBlink = 0;
bool ledState = LOW;
bool shouldSaveConfig = false;
unsigned long btnPressStart = 0;

// --- CALLBACK WIFI MANAGER ---
void saveConfigCallback () {
  Serial.println("Alterações detectadas no Portal. Salvando...");
  shouldSaveConfig = true;
}

// --- FUNÇÕES AUXILIARES ---
void setRGB(int r, int g, int b) {
  digitalWrite(PIN_RGB_R, r);
  digitalWrite(PIN_RGB_G, g);
  digitalWrite(PIN_RGB_B, b);
}

void drawScreen(float temp, int luz, int bufferSize, bool wifiOn, bool erro) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(1);
  display.setCursor(0, 0);
  if (erro) display.print("ERRO SENSOR");
  else if (wifiOn) {
      if (forcarSincronizacao) display.print("CMD: SYNC...");
      else if (bufferSize > 0) display.print("ENVIANDO DADOS..."); 
      else display.print("ONLINE - AGUARDANDO");
  }
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
    display.print("!VIOLADO!"); 
  }

  display.setCursor(0, 54);
  display.print("S: ");
  if(boxStatus.length() > 10) display.print(boxStatus.substring(0, 10));
  else display.print(boxStatus); 

  display.display();
}

// --- CALLBACK MQTT ---
void callback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];
  
  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, message);

  if (!error) {
    if (doc.containsKey("status_operacional")) {
        boxStatus = doc["status_operacional"].as<String>();
        Serial.print("Status recebido: "); Serial.println(boxStatus);
    } 
    
    if (doc.containsKey("comando")) {
        String cmd = doc["comando"].as<String>();
        if (cmd == "SYNC") {
            Serial.println("!!! COMANDO REMOTO DE SYNC !!!");
            forcarSincronizacao = true; 
        }
    }
  }
}

void atualizarHardware(bool online, bool erroSensor, int luz) {
  unsigned long currentMillis = millis();
  bool caixaAberta = (luz < LIMITE_LUZ_ALARME); 

  if (caixaAberta) digitalWrite(PIN_BUZZER, HIGH);
  else digitalWrite(PIN_BUZZER, LOW);  

  if (erroSensor) {
    if (currentMillis - previousMillisBlink >= 200) {
      previousMillisBlink = currentMillis;
      ledState = !ledState;
      setRGB(ledState, 0, 0); 
    }
  }
  else if (online) {
    if (forcarSincronizacao) {
        if ((currentMillis / 100) % 2 == 0) setRGB(0, 1, 0);
        else setRGB(0, 0, 0);
    } else {
        setRGB(0, 1, 0); // Verde sólido = WiFi Ligado
    }
  }
  else {
    setRGB(0, 0, 0); // Led Apagado = Economia (Gravando na memória)
  }
}

void checkResetButton() {
  if (digitalRead(PIN_CONFIG_BTN) == LOW) {
    if (btnPressStart == 0) btnPressStart = millis();
    if (millis() - btnPressStart > 3000) {
       display.clearDisplay();
       display.setTextSize(2);
       display.setCursor(0,20);
       display.println("RESETANDO...");
       display.display();
       WiFiManager wm;
       wm.resetSettings(); 
       delay(1000);
       ESP.restart(); 
    }
  } else {
    btnPressStart = 0;
  }
}

// --- GERENCIADOR DE CONEXÃO INTELIGENTE ---
// Agora recebe "precisaSincronizar" ao invés de "precisaGravar"
void gerenciarConexao(bool precisaSincronizar, bool emergencia, bool comandoSync) {
  
  // LIGAR WIFI: Apenas se estourou o tempo de sync, é emergência ou comando manual
  if (precisaSincronizar || emergencia || comandoSync) {
    if (!wifiLigado) {
      Serial.println(">>> LIGANDO WIFI (Hora de Sincronizar) <<<");
      WiFi.mode(WIFI_STA); 
      WiFi.begin();        
      wifiLigado = true;
      lastConnectionTime = millis();
    }
    
    if (WiFi.status() == WL_CONNECTED && !client.connected()) {
       if (client.connect(box_id)) {
         client.subscribe(topicComando.c_str());
       }
    }
  } 
  // DESLIGAR WIFI: Se acabou o buffer e não tem nada urgente
  else if (wifiLigado && offlineBuffer.empty() && !comandoSync && !emergencia) {
     if (millis() - lastConnectionTime > 5000) { // 5s de carência
       Serial.println(">>> DESLIGANDO WIFI (Economia) <<<");
       client.disconnect();
       WiFi.disconnect(true);
       WiFi.mode(WIFI_OFF); 
       wifiLigado = false;
     }
  }
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n--- INICIANDO VASAFE ---");

  pinMode(PIN_RGB_R, OUTPUT);
  pinMode(PIN_RGB_G, OUTPUT);
  pinMode(PIN_RGB_B, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LDR, INPUT);
  pinMode(PIN_CONFIG_BTN, INPUT_PULLUP);

  Wire.begin(21, 22); 
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println(F("Falha no OLED")); 
  else { display.clearDisplay(); display.display(); }

  dht.begin();

  preferences.begin("vasafe_cfg", false);
  String saved_server = preferences.getString("server", "0.0.0.0");
  String saved_port   = preferences.getString("port", "1883");
  String saved_id     = preferences.getString("boxid", "box_01");
  String saved_dur    = preferences.getString("duration", "3");
  String saved_sync   = preferences.getString("sync_min", "30"); // Padrão: Sync a cada 30 min

  saved_server.toCharArray(mqtt_server, 40);
  saved_port.toCharArray(mqtt_port, 6);
  saved_id.toCharArray(box_id, 15);
  saved_dur.toCharArray(config_duracao, 6);
  saved_sync.toCharArray(config_sync_min, 6);

  WiFiManager wm;
  wm.setSaveConfigCallback(saveConfigCallback);

  WiFiManagerParameter custom_mqtt_server("server", "IP AWS (Broker)", mqtt_server, 40);
  WiFiManagerParameter custom_mqtt_port("port", "Porta MQTT", mqtt_port, 6);
  WiFiManagerParameter custom_box_id("boxid", "ID da Caixa", box_id, 15);
  
  // NOVOS PARAMETROS PARA A LOGICA SEPARADA
  WiFiManagerParameter custom_duration("duration", "Duracao Viagem (Horas)", config_duracao, 6);
  WiFiManagerParameter custom_sync("sync", "Sync Periodo (Minutos)", config_sync_min, 6);

  wm.addParameter(&custom_mqtt_server);
  wm.addParameter(&custom_mqtt_port);
  wm.addParameter(&custom_box_id);
  wm.addParameter(&custom_duration);
  wm.addParameter(&custom_sync);

  wm.setConfigPortalTimeout(180); 
  
  if (!wm.autoConnect("VaSafe-Config")) {
    Serial.println("Rodando Offline (Timeout Config)...");
  } else {
    Serial.println("WiFi Conectado na Configuração!");
    if (shouldSaveConfig) {
      strcpy(mqtt_server, custom_mqtt_server.getValue());
      strcpy(mqtt_port, custom_mqtt_port.getValue());
      strcpy(box_id, custom_box_id.getValue());
      strcpy(config_duracao, custom_duration.getValue());
      strcpy(config_sync_min, custom_sync.getValue());

      preferences.putString("server", mqtt_server);
      preferences.putString("port", mqtt_port);
      preferences.putString("boxid", box_id);
      preferences.putString("duration", config_duracao);
      preferences.putString("sync_min", config_sync_min);
    }
  }

  // --- 1. CÁLCULO DA FREQUÊNCIA DE MEDIÇÃO (GRAVAÇÃO) ---
  float duracaoHoras = atof(config_duracao);
  if (duracaoHoras <= 0) duracaoHoras = 1; 
  unsigned long totalSegundos = duracaoHoras * 3600;
  
  // Divide o tempo total pela capacidade da memória
  unsigned long calcIntervalo = totalSegundos / CAPACIDADE_MEMORIA_MENSAGENS;
  if (calcIntervalo < 10) calcIntervalo = 10; // Mínimo 10s entre medições
  intervaloMedicaoReal = calcIntervalo * 1000;

  // --- 2. CÁLCULO DA FREQUÊNCIA DE SINCRONIZAÇÃO (WIFI) ---
  int minutosSync = atoi(config_sync_min);
  if (minutosSync <= 0) minutosSync = 0.10; // Padrão se erro: 10 minutos
  intervaloSincronizacaoReal = minutosSync * 60000;

  Serial.println("--- CONFIGURACAO APLICADA ---");
  Serial.print("Duração Viagem: "); Serial.print(duracaoHoras); Serial.println(" h");
  Serial.print("Memória Disp.: "); Serial.println(CAPACIDADE_MEMORIA_MENSAGENS);
  Serial.print("-> Intervalo MEDIÇÃO (Gravar): "); Serial.print(intervaloMedicaoReal/1000); Serial.println(" s");
  Serial.print("-> Intervalo SYNC (WiFi): "); Serial.print(intervaloSincronizacaoReal/60000); Serial.println(" min");
  Serial.println("-----------------------------");

  topicTelemetria = String(TOPIC_TELEMETRIA_BASE) + String(box_id) + "/telemetria";
  topicComando    = String(TOPIC_COMANDO_BASE) + String(box_id) + "/comando";

  int portaInt = atoi(mqtt_port);
  client.setServer(mqtt_server, portaInt);
  client.setCallback(callback);
}

void loop() {
  checkResetButton();
  
  // --- LOOP DO WIFI/MQTT ---
  if (wifiLigado) {
    client.loop(); 
    
    // Se conectou, aproveita e esvazia o buffer
    if (client.connected() && !offlineBuffer.empty()) {
       Serial.println("--- [SYNC EM ANDAMENTO] ---");
       while (!offlineBuffer.empty() && client.connected()) {
          String msg = offlineBuffer.front(); 
          Serial.print(">> Upload: "); Serial.println(msg); 
          
          client.publish(topicTelemetria.c_str(), msg.c_str());
          offlineBuffer.erase(offlineBuffer.begin());
          client.loop(); 
          delay(50);     
       }
       // Reseta o timer de Sync para não conectar de novo imediatamente
       lastSync = millis(); 
       
       if (offlineBuffer.empty() && forcarSincronizacao) {
           Serial.println("Comando Sync Concluido!");
           forcarSincronizacao = false;
       }
    }
  }

  unsigned long now = millis();

  // --- OLHEIRO: LEITURA RÁPIDA (1s) PARA TELA E ALARMES ---
  if (now - lastSensorRead > INTERVALO_LEITURA_TELA) {
      lastSensorRead = now;

      setRGB(0,0,0);
      delay(5); 
      int luz = analogRead(PIN_LDR); 

      float temp = dht.readTemperature();
      bool erroSensor = isnan(temp);
      if (erroSensor) temp = 0.0;
      
      // --- CHECAGEM DE EMERGÊNCIA ---
      bool caixaViolada = (luz < LIMITE_LUZ_ALARME);
      bool variacaoBrusca = (!erroSensor && abs(temp - ultimaTempEnviada) > LIMITE_VARIACAO_TEMP && ultimaTempEnviada != -999.0);
      modoEmergencia = (caixaViolada || variacaoBrusca);
      bool emergenciaValida = (modoEmergencia && (now - lastMsgEmergencia > 5000));

      // --- DEFINIÇÃO DOS TEMPOS ---
      bool horaDeMedir = (now - lastMedicao > intervaloMedicaoReal);         // Hora de gravar no buffer?
      bool horaDeSync  = (now - lastSync > intervaloSincronizacaoReal);      // Hora de ligar o WiFi?
      
      // Se a memória estiver cheia (90%), força sync
      bool memoriaCheia = (offlineBuffer.size() > (CAPACIDADE_MEMORIA_MENSAGENS * 0.9));

      // --- GERENCIAMENTO DE CONEXÃO ---
      // LIGA O WIFI SE: Hora do Sync OU Memória Cheia OU Emergência OU Comando Manual
      gerenciarConexao(horaDeSync || memoriaCheia, emergenciaValida, forcarSincronizacao);
      
      atualizarHardware(wifiLigado, erroSensor, luz);
      drawScreen(temp, luz, offlineBuffer.size(), wifiLigado, erroSensor);

      // --- LÓGICA DE MEDIÇÃO E GRAVAÇÃO ---
      // Acontece independente do WiFi estar ligado ou não
      if (horaDeMedir || emergenciaValida || forcarSincronizacao) {
        
        // Atualiza timer de medição
        if (horaDeMedir) {
           lastMedicao = now;
           ultimaTempEnviada = temp;
        }
        if (emergenciaValida) {
           lastMsgEmergencia = now; 
        }

        StaticJsonDocument<256> doc;
        doc["box_id"] = box_id;
        doc["temperatura"] = temp; 
        doc["luz"] = luz;
        doc["aberta"] = caixaViolada; 
        
        if (modoEmergencia) doc["alerta"] = "EVENTO_CRITICO"; 
        if (forcarSincronizacao) doc["tipo"] = "SYNC_MANUAL";

        char buffer[256];
        serializeJson(doc, buffer);

        // Se o WiFi por acaso estiver ligado E conectado, manda direto.
        // Se não, salva no Buffer.
        if (wifiLigado && client.connected()) {
          Serial.print("[ONLINE DIRECT] Enviando: "); Serial.println(buffer);
          client.publish(topicTelemetria.c_str(), buffer);
        } else {
          Serial.print("[GRAVANDO BUFFER] ");
          Serial.print(offlineBuffer.size() + 1);
          Serial.print("/");
          Serial.print(CAPACIDADE_MEMORIA_MENSAGENS);
          Serial.print(": ");
          Serial.println(buffer);
          
          if (offlineBuffer.size() >= CAPACIDADE_MEMORIA_MENSAGENS) {
            Serial.println("!! OVERWRITE !!");
            offlineBuffer.erase(offlineBuffer.begin()); 
          }
          offlineBuffer.push_back(String(buffer));
        }
      }
  }
}