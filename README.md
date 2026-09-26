# Alex Outreach Bot

Personal AI conversation copilot for human-first sales outreach.

Bot Telegram privato che aiuta Alex a gestire l'outreach commerciale su Instagram: analizza profili e conversazioni, mantiene una memoria separata per ogni prospect e suggerisce il prossimo messaggio. L'invio resta sempre nelle mani di Alex.

Visione, principi ingegneristici e roadmap: [docs/PROJECT.md](docs/PROJECT.md). Deploy: [docs/DEPLOY.md](docs/DEPLOY.md).

## Stato

**Sprint 05 — Prospect Memory.** Il bot riceve gli update da Telegram tramite webhook, verifica il secret e risponde solo all'utente autorizzato in chat privata. Gli screenshot, anche inviati come album, e il testo di una conversazione vengono analizzati da Claude tramite l'API Anthropic:

- dagli screenshot di un profilo nascono tre primi messaggi (BEST, CURIOSITY, NATURAL);
- dagli screenshot di una conversazione, o dal suo testo incollato, nascono l'analisi (ultimo messaggio del prospect, stage, intent, interesse, prossimo obiettivo) e tre risposte (BEST, ALTERNATIVE, DIRECT).

I suggerimenti portano verso i servizi di Alex: siti, landing page ed e-commerce, prenotazioni online e automazioni, software e app su misura, assistenza informatica. Il primo messaggio aggancia il prospect su qualcosa di specifico e accenna a cosa fa Alex; l'offerta vera arriva quando risponde, con un passo concreto: un esempio, una call o un preventivo.

Il bot ricorda ogni prospect. Prima dell'analisi, un'occhiata veloce con un modello piccolo (Claude Haiku) legge lo username negli screenshot; se il prospect è già noto, Claude riceve anche la sua memoria: profilo, ultima lettura della conversazione, un riassunto e gli ultimi messaggi. Dopo l'analisi la memoria si aggiorna, e ogni risposta dice se il prospect è nuovo, già in memoria o non salvato. La memoria di un prospect non entra mai nel contesto di un altro: due letture degli stessi screenshot devono concordare prima di scrivere qualcosa. Il testo incollato non indica il prospect e per ora resta senza memoria.

Claude decide da solo se uno screenshot mostra un profilo o una conversazione, e non suggerisce nulla quando non va scritto nulla. Mentre lavora la chat mostra "sta scrivendo…". Comandi, link e @username Instagram ricevono una risposta immediata. Gli screenshot restano solo in memoria e vengono cancellati subito dopo l'analisi: nel database finiscono solo le informazioni estratte e al massimo gli ultimi 50 messaggi per prospect. Gira su Hostinger all'indirizzo `https://aboutly.site`, con il database MySQL (MariaDB) dell'hosting.

## Requisiti

- Node.js 24 o successivo (versione di riferimento in `.nvmrc`)
- npm
- Un bot Telegram creato con @BotFather
- Una API key della Claude Developer Platform ([console.anthropic.com](https://console.anthropic.com)), con credito: l'abbonamento a Claude non include l'uso delle API
- In produzione, un database MySQL o MariaDB, come quello incluso nell'hosting Hostinger. In sviluppo è facoltativo: senza, la memoria resta nel processo
- Per i test del database, facoltativi, Docker

## Avvio rapido

```bash
npm ci
cp .env.example .env
npm run dev
```

Su PowerShell usa `Copy-Item .env.example .env` al posto di `cp`. Prima di avviare compila nel `.env` le variabili Telegram e Anthropic (vedi [Configurazione](#configurazione)). Il server risponde su <http://localhost:3000/health>.

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

| Variabile                  | Default            | Descrizione                                                                                   |
| -------------------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| `NODE_ENV`                 | `development`      | `development`, `test` o `production`; determina il livello di log (`debug`, `silent`, `info`) |
| `HOST`                     | `0.0.0.0`          | Interfaccia di rete su cui ascolta il server HTTP                                             |
| `PORT`                     | `3000`             | Porta del server HTTP                                                                         |
| `TELEGRAM_BOT_TOKEN`       | —                  | Token del bot rilasciato da @BotFather                                                        |
| `TELEGRAM_WEBHOOK_SECRET`  | —                  | Secret che Telegram invia con ogni update (32-256 caratteri tra lettere, cifre, `_` e `-`)    |
| `TELEGRAM_ALLOWED_USER_ID` | —                  | ID numerico dell'unico utente autorizzato (lo fornisce @userinfobot)                          |
| `ANTHROPIC_API_KEY`        | —                  | API key della Claude Developer Platform (`sk-ant-…`)                                          |
| `ANTHROPIC_MODEL`          | `claude-opus-5`    | Modello Claude usato dal bot                                                                  |
| `ANTHROPIC_FAST_MODEL`     | `claude-haiku-4-5` | Modello veloce ed economico per i passaggi semplici, come riconoscere il prospect             |
| `DATABASE_HOST`            | —                  | Host del database MySQL o MariaDB (su Hostinger `127.0.0.1`)                                  |
| `DATABASE_PORT`            | `3306`             | Porta del database                                                                            |
| `DATABASE_NAME`            | —                  | Nome del database                                                                             |
| `DATABASE_USER`            | —                  | Utente del database                                                                           |
| `DATABASE_PASSWORD`        | —                  | Password dell'utente del database                                                             |

Per generare il secret:

```bash
node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
```

Le variabili `DATABASE_*` sono obbligatorie in produzione. In sviluppo si possono lasciare vuote: la memoria dei prospect resta nel processo e si perde a ogni riavvio.

`npm run dev`, `npm start` e `npm run telegram:webhook` caricano `.env` se presente. In produzione le variabili arrivano dall'ambiente di esecuzione (hPanel).

## Test del database

I test che leggono e scrivono su MySQL partono solo se `TEST_MYSQL_URL` indica un server; altrimenti vengono saltati, e la CI li esegue su MariaDB 10.11 e MySQL 8.4. In locale, con Docker:

```bash
docker compose up -d
```

```bash
TEST_MYSQL_URL=mysql://root:test@127.0.0.1:3307/responder_test npm test
```

Su PowerShell imposta prima la variabile con `$env:TEST_MYSQL_URL = "mysql://root:test@127.0.0.1:3307/responder_test"`. Ogni file di test crea e ricrea un proprio database su quel server.

## Struttura

```text
src/
├── server.ts                   entry point: valida l'ambiente, collega le dipendenze, avvia e chiude il server
├── app.ts                      costruisce l'applicazione Fastify, senza avviarla
├── config/env.ts               validazione delle variabili d'ambiente con Zod
├── ai/
│   ├── engine.ts               contratto del motore AI: riconoscimento, analisi, errori, report per i log
│   ├── claude.ts               motore AI con Claude tramite l'API Anthropic
│   ├── outputs.ts              output strutturati: schemi Zod e conversione nel dominio
│   ├── runs.ts                 registro delle generazioni: costi e durate, mai il contenuto
│   └── prompts/                istruzioni a layer versionati e richieste di ogni modalità
├── conversations/domain.ts     vocabolario delle conversazioni: stage, intent, obiettivi, interesse
├── copilot/screenshots.ts      caso d'uso: riconosce il prospect, carica la memoria, analizza, ricorda
├── db/
│   ├── connection.ts           connessione a MySQL o MariaDB con Kysely e mysql2
│   ├── migrations.ts           schema del database, applicato in ordine all'avvio
│   ├── schema.ts               tabelle viste da Kysely
│   ├── prospect-store.ts       memoria dei prospect su MySQL
│   └── generation-log.ts       registro delle generazioni su MySQL
├── prospects/
│   ├── memory.ts               cosa si ricorda di un prospect e come un'analisi la aggiorna
│   └── store.ts                contratto dell'archivio della memoria e versione in memoria
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
│   ├── replies.ts              testi delle risposte immediate
│   ├── suggestions.ts          analisi e messaggi suggeriti in HTML, pronti da copiare
│   ├── update.ts               parsing degli update: testo, foto, immagini come file, didascalie
│   └── webhook-handler.ts      caso d'uso: autorizza, deduplica, risponde subito o passa all'AI
└── shared/
    ├── errors.ts               errori nei log: nome e codici, mai il messaggio
    ├── logger.ts               interfaccia di logging usata dal codice applicativo
    └── result.ts               tipo Result per gli errori attesi
scripts/telegram-webhook.ts     registrazione e stato del webhook
index.js                        entry file per Hostinger: carica il server compilato in dist/
compose.yaml                    MariaDB locale per i test del database
```

I test stanno accanto al codice che verificano (`*.test.ts`); i file `*.test-support.ts` contengono ciò che più test condividono, come il contratto degli archivi della memoria.
