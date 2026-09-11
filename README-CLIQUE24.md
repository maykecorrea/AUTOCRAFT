# Clique24 — bot do Craft World

Painel + Chrome controlado (Playwright) que abre https://craft-world.gg/
e clica por você. **Não publica no Vercel/Grok** — precisa rodar num PC ou VPS 24h.

## No seu PC

Precisa de **Node.js 20+**.

```bash
unzip clique24-fonte.zip
cd clique24-fonte   # ou a pasta que o zip criar

npm install
npx playwright install chromium

npm run dev
```

Abra no navegador: http://localhost:8080

1. **Abrir** — sobe o Chrome do bot
2. Espere o jogo (spinner) até EMAIL / PHONE
3. **Clicar Phone** — usa o número em `data/creds.json`
4. Depois de logado: **Ligar AUTO 24h**

## VPS (24h)

Mesmos comandos. Deixe o processo rodando (`tmux`, `screen` ou `pm2`):

```bash
npm run dev
```

O Chrome do bot fica no servidor. Você só abre o painel no browser (`http://IP:8080`).

## Git (você cria o repositório)

Daqui não dá para empurrar para a sua conta. No PC:

```bash
git init
git add .
git commit -m "Clique24"
git remote add origin https://github.com/SEU_USER/clique24.git
git push -u origin main
```

## Arquivos úteis

- `data/creds.json` — e-mail e telefone do login
- `data/chrome-profile/` — sessão do Chrome (criada na primeira execução)
- `src/lib/bot/` — motor do bot (Playwright + análise de pixels)

## Se o Abrir falhar

- Linux: `npx playwright install-deps chromium`
- Porta 8080 ocupada: feche o outro processo ou mude a porta em `package.json`
