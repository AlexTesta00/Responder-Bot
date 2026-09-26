import type { Input } from "../inputs/classify.ts";
import type { ImageDownloadError } from "../inputs/images.ts";

const START = [
  "Ciao! 👋 Sono il tuo copilota per l'outreach su Instagram.",
  "",
  "Puoi mandarmi:",
  "• il link o lo @username di un profilo Instagram",
  "• uno o più screenshot di un profilo o di una conversazione",
  "• il testo di un messaggio",
  "",
  "Per ora riconosco cosa mi mandi; analisi e suggerimenti di risposta arriveranno presto.",
  "",
  "Scrivi /help per vedere i comandi.",
].join("\n");

const HELP = [
  "Comandi disponibili:",
  "/start – presentazione del bot",
  "/help – questo elenco",
  "",
  "Oltre ai comandi puoi mandarmi link e @username di profili Instagram, screenshot (anche più di uno insieme) e testo.",
].join("\n");

const screenshotsReceived = (count: number): string =>
  count === 1
    ? "📸 Screenshot ricevuto. L'ho scaricato e subito eliminato: l'analisi del contenuto arriverà con il motore AI."
    : `📸 ${String(count)} screenshot ricevuti insieme. Li ho scaricati e subito eliminati: l'analisi del contenuto arriverà con il motore AI.`;

/** The reply to an input the bot has understood. */
export const replyTo = (input: Input): string => {
  switch (input.type) {
    case "COMMAND":
      return input.command === "start" ? START : HELP;
    case "UNKNOWN_COMMAND":
      return "Comando non riconosciuto. Scrivi /help per vedere i comandi.";
    case "INSTAGRAM_PROFILE":
      return [
        `👤 Profilo @${input.username} riconosciuto.`,
        "",
        "Dal solo link non vedo bio e contenuti: mandami 1-3 screenshot del profilo, con bio e post, e li userò per l'analisi.",
      ].join("\n");
    case "LINK":
      return "🔗 Link ricevuto. Per un profilo Instagram mandami il link del profilo (instagram.com/nome) o lo @username.";
    case "TEXT":
      return "📝 Testo ricevuto. Quando arriverà l'analisi lo userò come contesto della conversazione.";
    case "SCREENSHOTS":
      return screenshotsReceived(input.images.length);
    case "UNSUPPORTED":
      return "Per ora gestisco link e @username Instagram, screenshot e testo: questo tipo di messaggio non lo so ancora leggere.";
  }
};

/** Explains why the screenshots could not be processed. */
export const imageProblemReply = (error: ImageDownloadError): string => {
  switch (error.type) {
    case "IMAGE_TOO_LARGE":
      return "⚠️ Uno screenshot è troppo grande. Prova a mandarlo come foto invece che come file.";
    case "UNSUPPORTED_IMAGE_FORMAT":
      return "⚠️ Non riesco a leggere il formato di questa immagine. Mandala come foto, oppure come file JPEG o PNG.";
    case "DOWNLOAD_FAILED":
      return "⚠️ Non sono riuscito a scaricare lo screenshot. Riprova tra poco.";
  }
};
