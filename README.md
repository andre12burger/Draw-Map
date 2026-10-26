# 🏃‍♂️🎨 Strava Art Generator (Web Service)

Um Web Service interativo projetado para o planeamento de rotas de GPS Art (Strava Art). Este sistema utiliza uma arquitetura **Cliente/Servidor** para integrar múltiplas APIs externas de geolocalização e roteamento urbano, permitindo o desenho de rotas magnéticas inteligentes sobre o mapa.

Projeto académico desenvolvido para a disciplina de Cliente/Servidor.

## ✨ Funcionalidades e Regras de Negócio

* **Roteamento Inteligente (Snap-to-Road):** O backend consome a API BRouter para calcular rotas reais, prendendo o traço do utilizador à malha de ruas e calçadas.
* **Geocodificação e Autocomplete:** Barra de busca integrada à API Nominatim, permitindo procurar endereços e voar diretamente para o local com centralização automática.
* **Batch Routing Engine:** Otimização de requisições em lote para processamento de desenhos densos (Modo Lápis), prevenindo estouros no limite de URI da API pública.
* **Exportação Nativa:** Compilação da matriz de segmentos diretamente para um ficheiro `.gpx` estruturado no padrão 1.1 XML.
* **Gestão de Estado (Observer):** Histórico de estados imutável com persistência via LocalStorage e suporte a *rollback* topológico (Ctrl+Z).
* **Navegação Dinâmica:** Ferramenta de desenho livre (Lápis) com atalho de barra de espaço para arrastar o ecrã fluidamente.

## 🏗️ Arquitetura do Sistema

O projeto adota o padrão **Proxy Pattern** no servidor para isolar as credenciais, contornar bloqueios de CORS e reduzir o processamento no dispositivo do utilizador final.

* **Frontend (Cliente):** HTML5, CSS3, JavaScript Vanilla (ES6 Modules) + Leaflet.
* **Backend (Web Service):** Node.js com Express.
* **APIs Externas Integradas:**
1. **BRouter API:** Consulta de matrizes de rotas (`profile=shortest`).
2. **Nominatim API (OpenStreetMap):** Serviço de geocodificação e pesquisa por string com retorno em GeoJSON.



## 🚀 Como Executar o Projeto

### Rodando Localmente

1. Certifique-se de ter o [Node.js](https://nodejs.org/) instalado (versão 18+).
2. Clone o repositório e aceda à pasta raiz:
```bash
git clone https://github.com/seu-usuario/strava-art-generator.git
cd strava-art-generator

```


3. Instale as dependências do servidor:
```bash
npm install

```


4. Inicie o Web Service:
```bash
npm start

```


5. Aceda no navegador: `http://localhost:3000`

## 👨‍💻 Autoria

**André Luiz Ditzel Burger**

Engenharia de Automação — Universidade Federal do Rio Grande (FURG).

---
