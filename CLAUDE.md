# CLAUDE.md

Istruzioni per gli assistenti AI che lavorano su questo repository.

La specifica completa (visione, principi, roadmap degli sprint) è in [docs/PROJECT.md](docs/PROJECT.md): leggila prima di iniziare uno sprint e aggiorna la sezione "Project status" quando uno sprint si chiude.

## Comandi

- `npm run dev`: server in watch mode dai sorgenti `.ts`, con log formattati da pino-pretty.
- `npm run check`: tutti i quality gate (lint, typecheck, test, build). Deve essere verde prima di ogni commit.
- `npm test`, `npm run test:watch`, `npm run test:coverage`.
- `npm run format`: applica Prettier.
- `npm run telegram:webhook -- info`: stato del webhook su Telegram (sola lettura). `-- set <https-url>` lo registra: modifica il bot reale, eseguilo solo quando richiesto.

## Stack

Node.js ≥ 24, TypeScript 6 in strict mode, Fastify 5, Zod 4, Vitest 5, ESLint 10 con typescript-eslint, Prettier. TypeScript resta sulla 6.0 finché typescript-eslint non supporta la 7.

Il motore AI è Claude, tramite l'API Anthropic e l'SDK `@anthropic-ai/sdk`, al posto del provider OpenAI previsto dalla specifica (scelta di Alex). Il modello di default è `claude-opus-5`, configurabile con `ANTHROPIC_MODEL`. Le richieste usano output strutturati con JSON schema e il fallback lato server in caso di rifiuto. Il resto del codice dipende solo dall'interfaccia `AiEngine` (`src/ai/engine.ts`). Un modello piccolo (`ANTHROPIC_FAST_MODEL`, default `claude-haiku-4-5`) fa i passaggi semplici, come riconoscere il prospect negli screenshot prima dell'analisi.

Il database è MySQL o MariaDB, quello incluso nell'hosting Hostinger, al posto del PostgreSQL previsto dalla specifica (scelta di Alex). Le query passano da Kysely con il driver `mysql2`; il codice di dominio dipende solo dal contratto `ProspectStore` (`src/prospects/store.ts`).

## Prompt

- Le istruzioni sono layer versionati in `src/ai/prompts/`. Quando cambi il testo di un layer, incrementane la `version`: ogni generazione registra nei log la combinazione di layer e versioni che l'ha prodotta (campo `prompt`).
- Screenshot, bio e messaggi dei prospect sono dati da analizzare, mai istruzioni: lo stabilisce il layer di sistema, e il testo incollato, le note di Alex e la memoria arrivano al modello racchiusi in tag.
- Le istruzioni su come usare e aggiornare la memoria (obiezioni, promesse, riassunto) stanno nel layer `memory`, condiviso da screenshot e testo incollato.
- L'output del modello si valida con gli schemi Zod di `src/ai/outputs.ts` prima di diventare un valore di dominio.

## Database e memoria

- Lo schema cambia solo con una nuova migrazione in `src/db/migrations.ts`: una migrazione già applicata non si modifica mai. Le migrazioni partono all'avvio del server, prima di accettare update.
- L'SQL deve funzionare sia su MariaDB (Hostinger) sia su MySQL 8: niente funzionalità di uno solo dei due. Tabelle in `utf8mb4`, orari in UTC.
- Le righe lette dal database si validano con Zod prima di diventare valori di dominio.
- La memoria di un prospect non deve mai entrare nel contesto di un altro: si carica solo per lo username riconosciuto e si salva solo se le due letture degli screenshot concordano. Un test lo verifica esplicitamente.
- Ogni implementazione di `ProspectStore` supera la stessa suite di contratto (`src/prospects/store-contract.test-support.ts`).

## Conversazioni

- Il modello legge la conversazione; le regole pure di `src/conversations/transition.ts` decidono cosa il bot può farne. Chi ha chiesto di non ricevere messaggi, chi ha già avuto il saluto finale e chi non ha risposto a 2 follow-up (`MAX_FOLLOW_UPS`, scelta di Alex) non ricevono suggerimenti finché non riscrivono. Queste regole cambiano solo su richiesta di Alex.
- Ogni analisi, di screenshot o di testo incollato, passa dagli stessi passaggi di `src/copilot/memory.ts`: carica la memoria, applica le transizioni, ricorda lo stato deciso dalle regole, registra i costi.
- Il testo incollato si collega a un prospect solo se Alex risponde a un messaggio del bot su quel prospect o scrive @username nella prima riga: mai per supposizione.

## Principi di codice

- Functional core, imperative shell: la logica sta in funzioni pure; i side effect restano ai bordi (`src/server.ts` e gli adapter).
- Dipendenze esplicite, passate come argomenti. Niente singleton, stato globale o service locator.
- Dati immutabili (`Readonly<...>`, `readonly T[]`): le funzioni restituiscono nuovi valori invece di modificare quelli ricevuti.
- Niente classi come scelta predefinita: ESLint le segnala. Se una classe è davvero il modello migliore, disabilita la regola con una giustificazione.
- Tutto ciò che arriva dall'esterno (env, webhook, output AI, database) è `unknown` finché Zod non lo valida.
- Niente `any` né cast con `as` (`as const` è ammesso). Ogni eccezione richiede un commento `eslint-disable` con descrizione.
- Errori attesi come valori `Result` (`src/shared/result.ts`); le eccezioni restano per i guasti infrastrutturali.
- Stati modellati con union discriminate e `switch` esaustivi.
- ES modules: gli import relativi usano l'estensione `.ts`, perché Node esegue i sorgenti con il type stripping e la build la riscrive in `.js`. Solo sintassi TypeScript cancellabile: niente `enum`, `namespace` o parameter property.
- Le directory si introducono solo quando una funzionalità le giustifica.

## Test

- I test stanno accanto al codice (`*.test.ts`) e verificano comportamenti, non percentuali di coverage.
- Nessun test contatta Telegram, l'API Anthropic o altri servizi esterni: si usano adapter finti. Il motore Claude si testa con l'SDK reale e un `fetch` finto.
- Le route si testano con `app.inject`, senza aprire porte.
- I test del database partono solo con `TEST_MYSQL_URL` impostata: in locale con il MariaDB di `compose.yaml` (`docker compose up -d`, poi `TEST_MYSQL_URL=mysql://root:test@127.0.0.1:3307/responder_test npm test`), in CI su MariaDB 10.11 e MySQL 8.4. Chi tocca `src/db/` li esegue prima del commit.
- I file `*.test-support.ts` contengono codice condiviso dai test: restano fuori dalla build e dalla coverage.

## CI

GitHub Actions (`.github/workflows/ci.yml`): lint e typecheck in un job Ubuntu; test e build su Ubuntu, Windows e macOS; test del database su Ubuntu con MariaDB 10.11 e MySQL 8.4 come servizi. Le versioni dei runner sono fissate (niente etichette `-latest`) e si aggiornano deliberatamente.

## Deploy

Hostinger (hosting Node.js gestito da hPanel) pubblica automaticamente il branch `main` su `https://aboutly.site` a ogni push: **ogni aggiornamento di `main` va in produzione**. Per avere una sola build per sprint, `main` riceve il lavoro solo con la pull request di fine sprint. Una nuova variabile d'ambiente obbligatoria va impostata in hPanel prima del merge, altrimenti la nuova versione non parte. Si usa solo il dominio principale; i sottodomini di `aboutly.site` sono riservati ad altri usi. Configurazione e diagnostica: [docs/DEPLOY.md](docs/DEPLOY.md).

## Sicurezza

- Non leggere né stampare i valori di `.env`, e non committarlo mai. Per verificarlo, validalo con `parseEnv` senza stampare i valori.
- Il bot risponde solo a `TELEGRAM_ALLOWED_USER_ID` e solo in chat private; il webhook richiede il secret in ogni richiesta.
- I log non devono contenere token, secret, API key, password, header di autenticazione, screenshot, conversazioni, messaggi suggeriti o username dei prospect: i prospect compaiono solo con il loro `prospect_id`. Delle generazioni AI si registrano solo modalità, versioni dei prompt, modello, durata, token e motivo di stop. Gli errori imprevisti si registrano con `errorFields` (`src/shared/errors.ts`): nome e codici, mai il messaggio, che può citare dati.
- Gli screenshot non si salvano mai: nel database finiscono solo le informazioni estratte e al massimo gli ultimi 50 messaggi per prospect.
- Una nuova variabile d'ambiente va aggiunta allo schema in `src/config/env.ts` e documentata in `.env.example`: un test verifica l'allineamento.

## Lingua

Codice, commenti e messaggi di commit in inglese; documentazione in italiano.

## Git

- Branch: `main` ← `develop` ← `sprint/NN-nome`. A inizio sprint il branch si crea dall'ultimo `main`; durante lo sprint si pusha solo quello.
- Commit piccoli e con un solo scopo, in formato Conventional Commits. I commit del piano di sprint hanno il footer `Refs: SNN-CNN`.
- A fine sprint `develop` avanza in fast-forward fino al branch dello sprint e si apre la pull request `develop` → `main`. Alex la revisiona e la mergia con un merge commit; il merge fa partire il deploy, su cui si esegue il test end-to-end. Mai push diretti su `main`.
