# Deploy su Hostinger

Il bot gira sull'hosting Node.js gestito di Hostinger (hPanel), sul dominio principale **`aboutly.site`**. I sottodomini di `aboutly.site` sono riservati ad altri usi: il bot non li usa.

## Come funziona

- Hostinger è collegato al repository GitHub e pubblica il branch **`develop`** a ogni push: `npm install`, `npm run build`, riavvio dell'app.
- `develop` riceve il lavoro di uno sprint quando è pronto per il test end-to-end; poi arriva su `main` con la pull request `develop → main`.
- Le variabili d'ambiente di produzione esistono solo in hPanel, mai su GitHub.
- Telegram consegna gli update a `https://aboutly.site/telegram/webhook`.

## Configurazione iniziale

Da fare una volta sola in hPanel.

1. **Websites → Add Website → Deploy Web App → Import Git repository → Connect with GitHub.** Autorizza l'app GitHub di Hostinger solo sul repository `Responder-Bot`.
2. Scegli il repository `AlexTesta00/Responder-Bot`, il branch `develop` e il dominio `aboutly.site`.
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

   `HOST` e `PORT` non vanno impostate: i default (`0.0.0.0` e `3000`) sono quelli che Hostinger si aspetta. Puoi anche usare **Import .env** con il file locale e poi cambiare `NODE_ENV` in `production`.

5. Avvia il deploy e segui i build log in **Deployments**.

## Verifica

1. `https://aboutly.site/health` risponde `{"status":"ok"}`.
2. Registra il webhook dal tuo PC, con il `.env` locale:

   ```bash
   npm run telegram:webhook -- set https://aboutly.site
   ```

3. Su Telegram manda `/start` e `/help` al bot: deve rispondere a entrambi.

## Diagnostica

- **`npm run telegram:webhook -- info`** mostra l'ultimo errore di consegna registrato da Telegram. Un `401` indica che il secret in hPanel è diverso da quello nel `.env` locale usato per registrare il webhook. Un errore `5xx` o di connessione indica che l'app non è avviata.
- **Runtime logs** in hPanel: sono i log JSON dell'app, senza token né testi dei messaggi.
  - Se l'app non parte per variabili mancanti o non valide, i log le elencano per nome.
  - Un update ignorato con `reason: "UNAUTHORIZED_SENDER"` riporta `sender_id`: se è il tuo ID, `TELEGRAM_ALLOWED_USER_ID` è sbagliato.
- Se cambi `TELEGRAM_WEBHOOK_SECRET`, aggiornalo sia in hPanel sia nel `.env` locale, poi ripeti `npm run telegram:webhook -- set https://aboutly.site`.

## Note tecniche

- `.npmrc` imposta `include=dev`. Hostinger esegue `npm install` con le variabili dell'app, e con `NODE_ENV=production` npm salterebbe le devDependencies necessarie alla build (TypeScript).
- Il registro degli update già elaborati vive in memoria: a ogni riavvio riparte vuoto. Sarà spostato nel database nello sprint dedicato alla memoria dei prospect.
