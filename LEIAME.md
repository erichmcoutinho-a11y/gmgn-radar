# Radar de Memecoins (Cloudflare)

Site que consulta a API da GMGN a cada poucos minutos, corta moedas perigosas, dá nota de 0 a 100 às que sobram, mostra o ranking e avisa no Telegram quando uma moeda chega à fase **Alerta**. Roda inteiro na Cloudflare, sem servidor seu e sem terminal.

## O que ele faz

1. **Coleta:** pede à GMGN as moedas novas da Solana (recém-criadas, perto de graduar e já graduadas).
2. **Filtros eliminatórios:** rug, bundler, insiders, top 10, bots, carteiras novas, dev segurando, phishing, liquidez, market cap, idade, holders e atividade. Reprovou em um, a moeda nem recebe nota.
3. **Nota (100 pontos):** Tração 25, Smart money 20, Fluxo 15, Saúde 20, Estágio 15, Social 5. A tração compara a moeda com ela mesma minutos atrás (holders, market cap, ritmo de compras), por isso um alerta só sai depois de pelo menos 3 minutos de histórico.
4. **Fases:** Radar (passou nos filtros), Candidata, Alerta (vai ao Telegram, uma vez por moeda).
5. **Calibração:** toda candidata ou alerta é acompanhada por 24 horas. A aba Calibração mostra quanto cada faixa de nota e cada pilar realmente acertou, para você ajustar pesos com dados.

A nota mede qualidade e tração. Ela não prevê lucro, e a maioria das memecoins vai a zero.

## Passo a passo para publicar

### 1. Chave da GMGN
1. Entre em **https://gmgn.ai/ai** e crie uma API Key. Ele pede uma chave pública: cole o conteúdo do arquivo `chave-publica-gmgn.pem` que veio junto, incluindo as linhas BEGIN e END.
2. Guarde a **API Key** que a GMGN mostrar. Este site só lê dados, então não precisa de chave privada.

### 2. Colocar o projeto no GitHub
1. Crie uma conta em github.com (se ainda não tiver) e um repositório **privado** chamado `gmgn-radar`.
2. Descompacte o `.zip`. No repositório, clique em **Add file → Upload files** e arraste **o conteúdo da pasta** (`src`, `public`, `wrangler.jsonc`, `package.json` e o resto). Clique em **Commit changes**.

### 3. Publicar na Cloudflare
1. Em **dash.cloudflare.com**, vá em **Workers & Pages → Create → Import a repository** e escolha o repositório `gmgn-radar`.
2. Deixe o nome como `gmgn-radar`, a pasta raiz em branco e clique em **Deploy**. Na primeira publicação a Cloudflare cria o banco de dados (D1) sozinha.
3. Quando terminar, a Cloudflare mostra o endereço `https://gmgn-radar.SEU-NOME.workers.dev`.

### 4. Senhas e chaves (segredos)
No Worker `gmgn-radar`, abra **Settings → Variables and Secrets → Add**, escolha o tipo **Secret** e crie:

| Nome | Valor |
|---|---|
| `GMGN_API_KEY` | a API Key da GMGN |
| `DASH_PASSWORD` | uma senha sua para entrar no painel |
| `TELEGRAM_BOT_TOKEN` | token do bot (opcional, veja abaixo) |
| `TELEGRAM_CHAT_ID` | número do seu chat (opcional, veja abaixo) |

Salve e faça o deploy de novo se a Cloudflare pedir.

### 5. Telegram (opcional)
1. No Telegram, converse com **@BotFather**, envie `/newbot` e siga os passos. Ele entrega o **token**.
2. Abra uma conversa com o seu novo bot e envie qualquer mensagem.
3. No navegador, abra `https://api.telegram.org/botSEU_TOKEN/getUpdates` e procure `"chat":{"id":` seguido de um número. Esse número é o **chat id**.
4. No painel, em **Ajustes**, clique em **Testar Telegram**.

### 6. Usar
Abra o endereço do site. O navegador pede usuário e senha: use qualquer usuário e a senha `DASH_PASSWORD`. Clique em **Rodar agora** para a primeira consulta. Depois disso a Cloudflare consulta sozinha, e o intervalo é ajustável em **Ajustes**.

## Se algo não funcionar

- **Faixa vermelha com erro da GMGN:** o texto do erro aparece no topo do painel. Se falar em chave, confira `GMGN_API_KEY`. A GMGN só aceita conexões IPv4 e a Cloudflare escolhe o caminho de rede sozinha, então se o erro for de conexão ou de IP, me mande o texto.
- **Deploy reclama do D1 / `database_id`:** em **Storage & Databases → D1 → Create** crie um banco `radar-db`, copie o ID dele e, no GitHub, edite `wrangler.jsonc`, trocando `{ "binding": "DB" }` por `{ "binding": "DB", "database_name": "radar-db", "database_id": "SEU_ID" }`.
- **Erro de limite de CPU nos logs:** o plano gratuito tem limite apertado por execução. Aumente o intervalo em Ajustes ou use o plano pago da Cloudflare (US$ 5 por mês).
- **Ranking vazio:** veja em Ajustes a lista de por que as moedas foram cortadas. Se estiver cortando tudo, relaxe os filtros.

## Estrutura

```
src/score.js       motor de nota e filtros (edite pesos aqui)
src/collector.js   rodada de coleta, alertas e acompanhamento
src/gmgn.js        cliente da API da GMGN
src/api.js         rotas do painel
src/telegram.js    formato do alerta
public/            o painel (HTML, CSS, JS)
test/              testes do motor (npm test)
```
