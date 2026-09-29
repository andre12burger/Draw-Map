# Strava Art Generator 🏃‍♂️🎨

Uma ferramenta web interativa desenvolvida para facilitar o planejamento de GPS Art (Strava Art) para corredores e ciclistas. O projeto permite desenhar rotas em cima de mapas reais, combinando traçados magnéticos que respeitam a malha urbana com opções de traçado livre para liberdade artística.

## 🚀 Funcionalidades

* **Snap-to-Road (Traçado Inteligente):** Clique no mapa e a linha seguirá automaticamente o fluxo das ruas e calçadas utilizando o motor de roteamento do BRouter, otimizado para pedestres e atividades ao ar livre.
* **Traçado Livre (Modo Linha Reta):** Pressione `Shift + Clique` para forçar um traçado ignorando as restrições da via (ideal para cruzar praças, terrenos abertos ou criar conexões não mapeadas).
* **Correção Automática de Nós:** Os marcadores visuais se ajustam magneticamente ao limite das ruas para garantir a precisão da rota.
* **Sistema de Desfazer:** Cometeu um erro? Pressione `Ctrl + Z` para apagar o último trecho desenhado sem perder o resto do trabalho.

## 🛠️ Tecnologias Utilizadas

* **Frontend:** HTML5, CSS3, JavaScript (Vanilla)
* **Mapa e Interatividade:** [Leaflet.js](https://leafletjs.com/)
* **Dados Cartográficos:** [OpenStreetMap](https://www.openstreetmap.org/)
* **Motor de Roteamento:** API Pública do [BRouter](https://brouter.de/) (Perfil: Foot/Walking)

## ⚙️ Como executar o projeto localmente

Como o projeto faz requisições externas para carregar as imagens do mapa, é necessário executá-lo através de um servidor web local para evitar bloqueios de segurança (CORS).

1. Clone este repositório:
```bash
git clone [https://github.com/seu-usuario/strava-art-generator.git](https://github.com/seu-usuario/strava-art-generator.git)
```

2. Abra o terminal na pasta raiz do projeto.
3. Inicie um servidor HTTP usando Python:
```bash
python -m http.server 8000

```


4. Abra o navegador e acesse: `http://localhost:8000`

## 👨‍💻 Autor

**André Luiz Ditzel Burger**

Estudante de Engenharia de Automação (FURG) e entusiasta de corridas de longa distância e GPS Art.

---

*Projeto em desenvolvimento. Próximos passos incluem exportação direta para arquivo `.gpx`.*
