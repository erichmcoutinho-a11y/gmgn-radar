# Radar de Memecoins (Cloudflare + GitHub)

Site que dá nota de 0 a 100 às memecoins novas da Solana, mostra o ranking e avisa no Telegram quando uma moeda chega à fase **Alerta**.

## Como as peças se encaixam

- **GitHub Actions (coletor):** a cada 5 minutos consulta a API da GMGN e envia a lista ao seu site. Foi preciso porque a GMGN bloqueou o endereço de rede compartilhado da Cloudflare.
- **Cloudflare (site):** recebe a lista, corta moedas perigosas, dá a nota, guarda o histórico, mostra o painel e manda os alertas.

A nota mede qualidade e tração. Ela não prevê lucro, e a maioria das memecoins vai a zero.

## O que ele faz com cada moeda

1. **Filtros eliminatórios:** rug, bundler, insiders, top 10, bots, carteiras novas, dev segurando, phishing, liquidez, market cap, idade, holders e atividade. Reprovou em um, nem recebe nota. Os limites ficam em **Ajustes**.
2. **Nota (100 pontos):** Tração 25, Smart money 20, Fluxo 15, Saúde 20, Estágio 15, Social 5. A tração compara a moeda com ela mesma minutos atrás, por isso o alerta só sai depois de 3 minutos de histórico.
3. **Fases:** Radar, Candidata e Alerta (vai ao Telegram, uma vez por moeda).
4. **Calibração:** toda candidata ou alerta é acompanhada por 24 horas, e a aba Calibração mostra o que a nota realmente previu.

## Passo a passo para colocar o coletor no ar

### 1. Atualizar os arquivos no GitHub
Em cada passo, clique em **Commit changes** no final.

1. Na raiz do repositório: **Add file → Upload files** e envie `wrangler.jsonc` (substitui o antigo).
2. Entre na pasta `src`, **Add file → Upload files** e envie `index.js`, `api.js` e `collector.js`.
3. Volte à raiz, entre em `public`, **Add file → Upload files** e envie `app.js` e `index.html`.
4. Na raiz, **Add file → Create new file**. No nome digite `collector/run.mjs` (a barra cria a pasta). Cole dentro o conteúdo do arquivo `run.mjs`.
5. Outra vez **Add file → Create new file**, com o nome `.github/workflows/coletor.yml`. Cole o conteúdo do arquivo `coletor.yml`.

A Cloudflare recompila o site sozinha. O arquivo `src/gmgn.js` antigo pode ficar onde está.

### 2. Tornar o repositório público
**Settings → General → Danger zone → Change visibility → Make public.** Isso é necessário porque repositórios privados têm só 2.000 minutos grátis por mês, e o coletor gasta mais que isso. O que fica visível é o código. As chaves e senhas ficam nos Secrets e não aparecem.

### 3. Guardar as chaves no GitHub
**Settings → Secrets and variables → Actions → New repository secret.** Crie três:

| Nome | Valor |
|---|---|
| `GMGN_API_KEY` | a API Key da GMGN |
| `RADAR_URL` | o endereço do seu site, como `https://gmgn-radar.SEU-NOME.workers.dev`, sem barra no final |
| `RADAR_PASSWORD` | a mesma senha que está em `DASH_PASSWORD` na Cloudflare |

### 4. Ligar e testar
1. Aba **Actions** do repositório. Se o GitHub pedir, clique em **I understand my workflows, go ahead and enable them**.
2. À esquerda escolha **Coletor** e clique em **Run workflow**.
3. Abra a execução. No log deve aparecer `Enviado: N lidas, N passaram…`.
4. Abra o painel do site. As moedas aparecem em poucos minutos.

Depois disso o GitHub roda sozinho a cada 5 minutos. Cada execução consulta a GMGN 2 vezes (o intervalo é o de **Ajustes**, padrão 3 minutos).

## Se algo não funcionar

- **Log do GitHub com `HTTP 401`:** `RADAR_PASSWORD` é diferente de `DASH_PASSWORD`. Corrija um dos dois.
- **Log com `HTTP 403`:** o site não tem o segredo `DASH_PASSWORD` na Cloudflare.
- **Log com `GMGN HTTP 429` / `RATE_LIMIT_BANNED`:** a GMGN também bloqueou o endereço do GitHub naquela execução. O coletor para e o painel mostra até quando. Se acontecer toda hora, me avise, porque a saída passa a ser um servidor com endereço fixo.
- **Aviso no painel "O coletor não envia dados há N minutos":** veja a aba Actions. O GitHub atrasa execuções agendadas em horários de pico, e desativa agendamentos de repositórios públicos parados há 60 dias, então abra o repositório de vez em quando.
- **Ranking vazio com dados chegando:** veja em **Ajustes** a lista do que está cortando as moedas e relaxe os filtros.
- **Erro de limite de CPU na Cloudflare:** aumente o intervalo em Ajustes ou use o plano pago da Cloudflare.

## Estrutura

```
collector/run.mjs                 coletor que roda no GitHub
.github/workflows/coletor.yml     agenda do coletor (a cada 5 min)
src/score.js                      motor de nota e filtros (edite pesos aqui)
src/collector.js                  recebe a lista, grava, alerta e acompanha resultados
src/api.js                        rotas do painel
src/telegram.js                   formato do alerta
public/                           o painel
test/                             testes do motor (npm test)
```
