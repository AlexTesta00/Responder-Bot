# Deploy su Hostinger

Il bot gira sull'hosting Node.js gestito di Hostinger (hPanel), sul dominio principale **`aboutly.site`**. I sottodomini di `aboutly.site` sono riservati ad altri usi: il bot non li usa.

## Come funziona

- Hostinger è collegato al repository GitHub e pubblica il branch **`main`** a ogni push: `npm install`, `npm run build`, riavvio dell'app.
- `main` riceve il lavoro solo con la pull request di fine sprint. Il deploy parte al merge e il test end-to-end dello sprint si fa su quel deploy, con una sola build per sprint.
- Le variabili d'ambiente di produzione esistono solo in hPanel, mai su GitHub.
- Quando uno sprint introduce una variabile d'ambiente obbligatoria, va aggiunta in hPanel **prima** di mergiare la pull request: il merge avvia il deploy, e senza la variabile la nuova versione non parte.
- Telegram consegna gli update a `https://aboutly.site/telegram/webhook`.

## Configurazione iniziale

Da fare una volta sola in hPanel.

1. **Websites → Add Website → Deploy Web App → Import Git repository → Connect with GitHub.** Autorizza l'app GitHub di Hostinger solo sul repository `Responder-Bot`.
2. Scegli il repository `AlexTesta00/Responder-Bot`, il branch `main` e il dominio `aboutly.site`.
3. Impostazioni di build:

   | Campo            | Valore                   |
   | ---------------- | ------------------------ |
   | Framework preset | Fastify (oppure "Other") |
   | Node.js version  | 24.x                     |
   | Package manager  | npm                      |
   | Build command    | `npm run build`          |
   | Output directory | `dist`                   |
   | Entry file       | `index.js`               |

   hPanel accetta come entry file solo file presenti nel repository, mentre `dist/` nasce durante la build. Per questo `index.js`, nella radice del repository, si limita a caricare il server compilato in `dist/server.js`.

4. Variabili d'ambiente, da impostare prima del primo deploy:

   | Variabile                  | Valore                      |
   | -------------------------- | --------------------------- |
   | `NODE_ENV`                 | `production`                |
   | `TELEGRAM_BOT_TOKEN`       | lo stesso del `.env` locale |
   | `TELEGRAM_WEBHOOK_SECRET`  | lo stesso del `.env` locale |
   | `TELEGRAM_ALLOWED_USER_ID` | lo stesso del `.env` locale |
   | `ANTHROPIC_API_KEY`        | la stessa del `.env` locale |

   `HOST` e `PORT` non vanno impostate: i default (`0.0.0.0` e `3000`) sono quelli che Hostinger si aspetta. Anche `ANTHROPIC_MODEL` è facoltativa: serve solo per usare un modello diverso da `claude-opus-5`. Puoi anche usare **Import .env** con il file locale e poi cambiare `NODE_ENV` in `production`.

   La API key si crea nella Claude Developer Platform ([console.anthropic.com](https://console.anthropic.com)), dove si acquista il credito per l'uso delle API: l'abbonamento a Claude non lo include. Conviene impostare lì anche un limite di spesa mensile.

5. Avvia il deploy e segui i build log in **Deployments**.

## Verifica

1. `https://aboutly.site/health` risponde `{"status":"ok"}`.
2. Registra il webhook dal tuo PC, con il `.env` locale:

   ```bash
   npm run telegram:webhook -- set https://aboutly.site
   ```

3. Su Telegram manda `/start` e `/help` al bot: deve rispondere a entrambi.
4. Manda uno screenshot del profilo Instagram di un'attività: la chat mostra "sta scrivendo…" e, di solito entro un minuto, arrivano il riepilogo del profilo e tre primi messaggi.

## Diagnostica

- **`npm run telegram:webhook -- info`** mostra l'ultimo errore di consegna registrato da Telegram. Un `401` indica che il secret in hPanel è diverso da quello nel `.env` locale usato per registrare il webhook. Un errore `5xx` o di connessione indica che l'app non è avviata.
- **Runtime logs** in hPanel: sono i log JSON dell'app, senza token né testi dei messaggi.
  - Se l'app non parte per variabili mancanti o non valide, i log le elencano per nome.
  - Un update ignorato con `reason: "UNAUTHORIZED_SENDER"` riporta `sender_id`: se è il tuo ID, `TELEGRAM_ALLOWED_USER_ID` è sbagliato.
  - Ogni analisi registra `ai generation completed`, con modello, durata e token (utili per stimare i costi), oppure `ai generation failed` con il tipo di errore in `ai_error`:
    - `REJECTED`: l'API Anthropic ha rifiutato la richiesta. Con `status` 401 la API key non è valida; con 400 o 403 controlla credito e limiti nella Console.
    - `UNAVAILABLE`: l'API è sovraccarica o non raggiungibile, anche dopo i tentativi automatici.
    - `REFUSED`, `TRUNCATED` o `INVALID_OUTPUT`: il modello non ha prodotto un'analisi utilizzabile.
  - Se un'analisi non arriva affatto, cerca `reply not delivered` (Telegram ha rifiutato il messaggio) o `background processing crashed` (errore imprevisto).
- Se cambi `TELEGRAM_WEBHOOK_SECRET`, aggiornalo sia in hPanel sia nel `.env` locale, poi ripeti `npm run telegram:webhook -- set https://aboutly.site`.

## Note tecniche

- `.npmrc` imposta `include=dev`. Hostinger esegue `npm install` con le variabili dell'app, e con `NODE_ENV=production` npm salterebbe le devDependencies necessarie alla build (TypeScript).
- Il web server di Hostinger (LiteSpeed, tramite `lsnode.js`) carica l'entry file con `require()`, che non può caricare moduli ES con top-level await: in quel caso l'app va in crash a ogni avvio (`ERR_REQUIRE_ASYNC_MODULE`) e il sito risponde 503. Per questo `src/server.ts` avvia il servizio da una funzione async, e una regola ESLint vieta il top-level await in `src/` e in `index.js`.
- Il registro degli update già elaborati vive in memoria: a ogni riavvio riparte vuoto. Sarà spostato nel database nello sprint dedicato alla memoria dei prospect.
- Un'analisi AI può durare più di quanto Telegram attende la risposta al webhook: l'update viene confermato subito e l'analisi prosegue in background. Se l'app si riavvia mentre un'analisi è in corso, quella risposta si perde: basta rimandare il messaggio.
