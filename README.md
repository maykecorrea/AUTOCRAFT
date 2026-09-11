# AUTOCRAFT (Clique24)

Bot 24h do [Craft World](https://craft-world.gg/). Painel web + Chrome controlado (Playwright).

Não é o Chrome da sua casa. Roda no **PC** ou na **VPS**.

## Rodar local

Precisa de Node.js 20+.

```bash
git clone https://github.com/maykecorrea/AUTOCRAFT.git
cd AUTOCRAFT
cp data/creds.example.json data/creds.json   # edite e-mail e telefone
npm install
npx playwright install chromium
npm run dev
```

Abra http://localhost:8080

1. **Abrir** — sobe o Chrome do bot
2. Espere EMAIL / PHONE
3. **Clicar Phone**
4. Depois de logado: **Ligar AUTO 24h**

Linux: se o Chromium falhar, `npx playwright install-deps chromium`

## VPS

Mesmos comandos. Depois:

```bash
tmux new -s autocraft
npm run dev
```

Painel: `http://IP-DA-VPS:8080`

Atualizar (depois de configurar):

```bash
cd AUTOCRAFT
git pull
npm install
# reinicia o npm run dev
```

## O que o bot faz

O código tira foto PNG da tela e lê **pixels** (não é IA):

- Login: barras roxas EMAIL / PHONE
- AUTO: botões verde/amarelo de play no mapa
