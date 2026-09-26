# Alex Outreach Bot

Personal AI conversation copilot for human-first sales outreach.

Bot Telegram privato che aiuta Alex a gestire l'outreach commerciale su Instagram: analizza profili e conversazioni, mantiene una memoria separata per ogni prospect e suggerisce il prossimo messaggio. L'invio resta sempre nelle mani di Alex.

Visione, principi ingegneristici e roadmap: [docs/PROJECT.md](docs/PROJECT.md).

## Stato

**Sprint 01 — Foundation.** Servizio TypeScript/Fastify con configurazione validata, endpoint `GET /health`, logging strutturato, test e CI. Telegram, OpenAI e database arrivano negli sprint successivi.

## Requisiti

- Node.js 24 o successivo (versione di riferimento in `.nvmrc`)
- npm

## Avvio rapido

```bash
npm ci
cp .env.example .env
npm run dev
```

Su PowerShell usa `Copy-Item .env.example .env` al posto di `cp`. Il server risponde su <http://localhost:3000/health>.

## Comandi

| Comando                 | Descrizione                                                                    |
| ----------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`           | Avvia il server dai sorgenti TypeScript con riavvio automatico e log leggibili |
| `npm run build`         | Compila in `dist/`                                                             |
| `npm start`             | Avvia la build compilata                                                       |
| `npm run check`         | Esegue tutti i quality gate: lint, typecheck, test e build                     |
| `npm run lint`          | ESLint e controllo della formattazione Prettier                                |
| `npm run format`        | Formatta i file con Prettier                                                   |
| `npm run typecheck`     | Controllo dei tipi                                                             |
| `npm test`              | Esegue i test                                                                  |
| `npm run test:watch`    | Esegue i test in watch mode                                                    |
| `npm run test:coverage` | Esegue i test con report di coverage in `coverage/`                            |

## Configurazione

Le variabili d'ambiente sono validate all'avvio in `src/config/env.ts`. Se una variabile non è valida, il processo si ferma indicandola per nome, senza mostrarne il valore. `.env.example` documenta tutte le variabili e un test verifica che resti allineato allo schema.

| Variabile  | Default       | Descrizione                                                                                   |
| ---------- | ------------- | --------------------------------------------------------------------------------------------- |
| `NODE_ENV` | `development` | `development`, `test` o `production`; determina il livello di log (`debug`, `silent`, `info`) |
| `HOST`     | `0.0.0.0`     | Interfaccia di rete su cui ascolta il server HTTP                                             |
| `PORT`     | `3000`        | Porta del server HTTP                                                                         |

`npm run dev` e `npm start` caricano `.env` se presente. In produzione le variabili arrivano dall'ambiente di esecuzione.

## Struttura

```text
src/
├── server.ts          entry point: valida l'ambiente, avvia e chiude il server
├── app.ts             costruisce l'applicazione Fastify, senza avviarla
├── config/env.ts      validazione delle variabili d'ambiente con Zod
├── routes/health.ts   GET /health
└── shared/result.ts   tipo Result per gli errori attesi
```

I test stanno accanto al codice che verificano (`*.test.ts`).
