# VaSafe-Projeto-de-Sistemas-Distribuidos-Irandi-Silva-

Desenvolvimento do Projeto da disciplina de Sistemas Distribuídos (UFS). 
O **VaSafe** é uma solução de Digital Twin para monitoramento em tempo real de cadeias de frio (transporte de vacinas, órgãos e medicamentos sensíveis).

## 🔗 Links do Projeto
* **Slides de Apresentação:** [Acessar Slides no Gamma](https://gamma.app/docs/VaSafe-Monitoramento-Inteligente-e-Resiliente-para-Cadeia-de-Frio-ut9epss0s5vjoj6)
* **Documento de Descrição:** [Acessar Google Docs](https://docs.google.com/document/d/1AF8GmFV52RN8By7BRZ-GfXvggemC5JP32hmq65LiBIg/edit?usp=sharing)

---

## 🏗️ Arquitetura do Sistema

O sistema utiliza uma arquitetura distribuída composta por três camadas principais:

| Camada | Tecnologia | Função |
| :--- | :--- | :--- |
| **Frontend** | React.js | Dashboard para monitoramento em tempo real. |
| **Backend** | FastAPI (Python) | API Gateway, processamento de Health Score e integração MQTT. |
| **Banco de Dados** | InfluxDB | Armazenamento de séries temporais (telemetria histórica). |
| **IoT / Edge** | Python / MQTT | Simulador de hardware e dispositivos de borda. |

---

## 🛠️ Especificações Técnicas

### 1. Frontend 
A interface foi projetada para garantir que o operador tenha feedback instantâne:
* **UI:** Comandos de "Manutenção" atualizam a interface localmente antes da confirmação do servidor.
* **Sincronização:** O sistema monitora se o estado real do dispositivo (via telemetria) condiz com o comando enviado.
* **Health Score Visual:** Cards dinâmicos que mudam de cor com base na saúde do lote (Verde: Estável, Amarelo: Alerta, Vermelho: Crítico/Violação).

### 2. Backend 
O servidor centraliza a lógica de negócios e a persistência:
* **Cálculo de Saúde:** Algoritmo que analisa os últimos 50 pontos de telemetria, penalizando o score por desvios de temperatura (fora de 2°C a 8°C) ou abertura de tampa.
* **Gateway MQTT:** Traduz requisições HTTP do frontend em comandos MQTT para os dispositivos.
* **Threaded MQTT:** Mantém uma conexão assíncrona ininterrupta para escutar os sensores enquanto atende chamadas da API.

### 3. Simulador IoT 
Para validar o sistema, o simulador emula o comportamento de múltiplas caixas térmicas:
* **Comportamento Estocástico:** Flutuações reais de temperatura e eventos aleatórios de violação.
* **Buffer de Envio:** Agrupa 5 leituras antes de transmitir, otimizando o tráfego de rede.
* **Escalabilidade:** Permite alterar a quantidade de caixas monitoradas dinamicamente via tópico de setup.

### 4. Provisionamento Dinâmico (WiFiManager)
Para evitar o *hardcoding* (gravação fixa) de senhas no código-fonte, o sistema utiliza um portal cautivo para configuração inicial:
* **Funcionamento:** Ao ligar pela primeira vez, o dispositivo cria um Ponto de Acesso (AP) próprio.
* **Objetivo:** O usuário conecta neste AP pelo celular, seleciona a rede WiFi local e digita a senha. O dispositivo salva as credenciais na memória não-volátil (NVS) e reinicia conectado. Isso garante a **portabilidade** do sistema para diferentes ambientes sem necessidade de reprogramação.

### 5. Estratégia de Buffer e Eficiência Energética
O sistema **não mantém o WiFi ligado 100% do tempo**. Foi adotada uma estratégia de *Store-and-Forward* (Armazenar e Enviar):
* **O Problema:** O rádio WiFi do ESP32 consome muita energia (~190mA), o que drenaria a bateria rapidamente em transporte.
* **A Solução:** O dispositivo realiza leituras dos sensores e armazena os dados em um buffer na memória RAM. Apenas após acumular um lote de dados (ex: a cada 5 leituras) ou detectar uma violação crítica, ele ativa o WiFi, conecta ao MQTT, descarrega o buffer e volta a desligar o rádio.
* **Benefício:** Redução drástica no consumo de energia e garantia de integridade dos dados mesmo se o caminhão passar por zonas de sombra (sem sinal 4G/WiFi).

---

## 🐳 Orquestração de Containers (Docker Compose)

O projeto foi desenhado para ser agnóstico à infraestrutura, utilizando **Docker Compose** para orquestrar os 4 serviços simultâneos. Isso garante que o ambiente de desenvolvimento seja idêntico ao de produção na AWS.

### Serviços Integrados
1.  **`mosquitto` (Broker MQTT):** Atua como o barramento de mensagens assíncrono. Exposto na porta 1883 para os dispositivos IoT externos e conectado internamente ao Backend.
2.  **`influxdb` (Banco Temporal):** Configurado com **Volumes Docker** persistentes. Isso garante que, mesmo se os containers forem reiniciados ou atualizados, o histórico de temperatura dos lotes não seja perdido.
3.  **`backend` (API Python):** Utiliza a diretiva `depends_on` para garantir que só inicie sua execução após o banco de dados e o broker estarem saudáveis.
4.  **`frontend` (Interface Web):** Container otimizado servindo a aplicação React.

### Rede Interna
Todos os containers comunicam-se através de uma rede virtual interna isolada. O Backend acessa o Broker chamando o host `mqtt` e o banco chamando `influxdb`, eliminando a necessidade de gerenciamento manual de IPs.

---


## ⚙️ Detalhes de Implementação e Hardware

### 1. Pinagem do Microcontrolador (ESP32)
Abaixo segue o mapa de conexões físicas dos sensores e atuadores utilizados no protótipo:

| Componente | Variável no Código | GPIO (Pino) | Função |
| :--- | :--- | :--- | :--- |
| **Sensor DHT11** | `PIN_DHT` | **15** | Leitura de Temperatura e Umidade. |
| **Sensor LDR** | `PIN_LDR` | **34** | Detecção de luz (Violação da caixa) - Entrada Analógica. |
| **Monitor Bateria** | `PIN_BATTERY` | **35** | Leitura de nível de tensão (Divisor de tensão). |
| **LED RGB (Vermelho)** | `PIN_RGB_R` | **19** | Indicador visual de alerta crítico. |
| **LED RGB (Verde)** | `PIN_RGB_G` | **18** | Indicador visual de normalidade. |
| **LED RGB (Azul)** | `PIN_RGB_B` | **5** | Indicador de conectividade/status. |
| **Buzzer** | `PIN_BUZZER` | **4** | Alarme sonoro para alertas locais. |
| **Botão Config** | `PIN_CONFIG_BTN` | **0** | Reset e Configuração (Boot). |
| **Display OLED** | *N/A (Wire.h)* | **21 (SDA) / 22 (SCL)** | Interface visual I2C (Padrão ESP32). |

---

## 🔄 Fluxo de Dados

1. **Coleta:** O sensor publica dados no tópico `vasafe/{id}/telemetria`.
2. **Ingestão:** O Backend recebe via MQTT e grava no InfluxDB.
3. **Análise:** O Frontend solicita `GET /analise`, o Backend processa os dados históricos e retorna o risco.
4. **Comando:** O usuário envia `POST /controle`, que é publicado no tópico `vasafe/{id}/comando` para atuação no hardware.

---
## 🚀 Como Rodar o Projeto

O ambiente está implantado em uma instância AWS EC2. Existem duas formas de acesso configuradas:

### Opção A: Acesso Simplificado (Senha)
Foi criado um usuário dedicado para a correção, que não exige chave `.pem`.

1. **Acesse via terminal:**
   ```bash
   ssh professor@98.90.117.5
   senha:professor
