# Alex Outreach Bot

Personal AI conversation copilot for human-first sales outreach.

Bot Telegram privato che aiuta Alex a gestire l'outreach commerciale su Instagram: analizza profili e conversazioni, mantiene una memoria separata per ogni prospect e suggerisce il prossimo messaggio. L'invio resta sempre nelle mani di Alex.

Visione, principi ingegneristici e roadmap: [docs/PROJECT.md](docs/PROJECT.md). Deploy: [docs/DEPLOY.md](docs/DEPLOY.md).

## Stato

**Sprint 03 — Multimodal Input.** Il bot riceve gli update da Telegram tramite webhook, verifica il secret e risponde solo all'utente autorizzato in chat privata. Riconosce comandi, link e @username di profili Instagram, link generici, testo e screenshot, anche inviati come album, che raggruppa in un'unica risposta. Gli screenshot vengono scaricati solo in memoria e cancellati subito dopo l'elaborazione. Gira su Hostinger all'indirizzo `https://aboutly.site`. Analisi AI e database arrivano negli sprint successivi.

## Requisiti

- Node.js 24 o successivo (versione di riferimento in `.nvmrc`)
- npm
- Un bot Telegram creato con @BotFather

## Avvio rapido

```bash
npm ci
cp .env.example .env
npm run dev
```

Su PowerShell usa `Copy-Item .env.example .env` al posto di `cp`. Prima di avviare compila nel `.env` le variabili Telegram (vedi [Configurazione](#configurazione)). Il server risponde su <http://localhost:3000/health>.

In locale Telegram non può raggiungere il webhook: i messaggi reali arrivano al bot pubblicato su Hostinger.

## Comandi

| Comando                                       | Descrizione                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`                                 | Avvia il server dai sorgenti TypeScript con riavvio automatico e log leggibili |
| `npm run build`                               | Compila in `dist/`                                                             |
| `npm start`                                   | Avvia la build compilata                                                       |
| `npm run check`                               | Esegue tutti i quality gate: lint, typecheck, test e build                     |
| `npm run lint`                                | ESLint e controllo della formattazione Prettier                                |
| `npm run format`                              | Formatta i file con Prettier                                                   |
| `npm run typecheck`                           | Controllo dei tipi                                                             |
| `npm test`                                    | Esegue i test                                                                  |
| `npm run test:watch`                          | Esegue i test in watch mode                                                    |
| `npm run test:coverage`                       | Esegue i test con report di coverage in `coverage/`                            |
| `npm run telegram:webhook -- set <https-url>` | Registra il webhook del bot su Telegram                                        |
| `npm run telegram:webhook -- info`            | Mostra lo stato del webhook e l'ultimo errore di consegna                      |

## Configurazione

Le variabili d'ambiente sono validate all'avvio in `src/config/env.ts`. Se una variabile manca o non è valida, il processo si ferma indicandola per nome, senza mostrarne il valore. `.env.example` documenta tutte le variabili e un test verifica che resti allineato allo schema.

| Variabile                  | Default       | Descrizione                                                                                   |
| -------------------------- | ------------- | --------------------------------------------------------------------------------------------- |
| `NODE_ENV`                 | `development` | `development`, `test` o `production`; determina il livello di log (`debug`, `silent`, `info`) |
| `HOST`                     | `0.0.0.0`     | Interfaccia di rete su cui ascolta il server HTTP                                             |
| `PORT`                     | `3000`        | Porta del server HTTP                                                                         |
| `TELEGRAM_BOT_TOKEN`       | —             | Token del bot rilasciato da @BotFather                                                        |
| `TELEGRAM_WEBHOOK_SECRET`  | —             | Secret che Telegram invia con ogni update (32-256 caratteri tra lettere, cifre, `_` e `-`)    |
| `TELEGRAM_ALLOWED_USER_ID` | —             | ID numerico dell'unico utente autorizzato (lo fornisce @userinfobot)                          |

Per generare il secret:

```bash
node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
```

`npm run dev`, `npm start` e `npm run telegram:webhook` caricano `.env` se presente. In produzione le variabili arrivano dall'ambiente di esecuzione (hPanel).

## Struttura

```text
src/
├── server.ts                   entry point: valida l'ambiente, collega le dipendenze, avvia e chiude il server
├── app.ts                      costruisce l'applicazione Fastify, senza avviarla
├── config/env.ts               validazione delle variabili d'ambiente con Zod
├── inputs/
│   ├── classify.ts             cosa è un messaggio: comando, profilo, link, testo, screenshot
│   ├── images.ts               ciclo di vita degli screenshot: scarica, elabora, cancella
│   └── instagram.ts            username da link di profilo e @menzioni
├── routes/
│   ├── health.ts               GET /health
│   └── telegram-webhook.ts     POST /telegram/webhook: secret, parsing, esito dell'update
├── telegram/
│   ├── client.ts               client della Bot API, download dei file compreso
│   ├── files.ts                download degli screenshot con limite di dimensione
│   ├── ids.ts                  ID utente e chat come tipi distinti
│   ├── media-group.ts          raggruppa le foto di un album
│   ├── processed-updates.ts    registro degli update già elaborati
│   ├── replies.ts              testi delle risposte
│   ├── update.ts               parsing degli update: testo, foto, immagini come file, didascalie
│   └── webhook-handler.ts      caso d'uso: autorizza, deduplica, classifica e risponde
└── shared/
    ├── logger.ts               interfaccia di logging usata dal codice applicativo
    └── result.ts               tipo Result per gli errori attesi
scripts/telegram-webhook.ts     registrazione e stato del webhook
index.js                        entry file per Hostinger: carica il server compilato in dist/
```

I test stanno accanto al codice che verificano (`*.test.ts`).
