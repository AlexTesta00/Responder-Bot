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
- Nessun test contatta Telegram, OpenAI o altri servizi esterni: si usano adapter finti.
- Le route si testano con `app.inject`, senza aprire porte.

## CI

GitHub Actions (`.github/workflows/ci.yml`): lint e typecheck in un job Ubuntu; test e build su Ubuntu, Windows e macOS. Le versioni dei runner sono fissate (niente etichette `-latest`) e si aggiornano deliberatamente.

## Deploy

Hostinger (hosting Node.js gestito da hPanel) pubblica automaticamente il branch `main` su `https://aboutly.site` a ogni push: **ogni aggiornamento di `main` va in produzione**. Per avere una sola build per sprint, `main` riceve il lavoro solo con la pull request di fine sprint. Si usa solo il dominio principale; i sottodomini di `aboutly.site` sono riservati ad altri usi. Configurazione e diagnostica: [docs/DEPLOY.md](docs/DEPLOY.md).

## Sicurezza

- Non leggere né stampare i valori di `.env`, e non committarlo mai. Per verificarlo, validalo con `parseEnv` senza stampare i valori.
- Il bot risponde solo a `TELEGRAM_ALLOWED_USER_ID` e solo in chat private; il webhook richiede il secret in ogni richiesta.
- I log non devono contenere token, secret, header di autenticazione, screenshot o conversazioni intere.
- Una nuova variabile d'ambiente va aggiunta allo schema in `src/config/env.ts` e documentata in `.env.example`: un test verifica l'allineamento.

## Lingua

Codice, commenti e messaggi di commit in inglese; documentazione in italiano.

## Git

- Branch: `main` ← `develop` ← `sprint/NN-nome`. A inizio sprint il branch si crea dall'ultimo `main`; durante lo sprint si pusha solo quello.
- Commit piccoli e con un solo scopo, in formato Conventional Commits. I commit del piano di sprint hanno il footer `Refs: SNN-CNN`.
- A fine sprint `develop` avanza in fast-forward fino al branch dello sprint e si apre la pull request `develop` → `main`. Alex la revisiona e la mergia con un merge commit; il merge fa partire il deploy, su cui si esegue il test end-to-end. Mai push diretti su `main`.
