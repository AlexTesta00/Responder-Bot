import type { Input } from "../inputs/classify.ts";
import type { ImageDownloadError } from "../inputs/images.ts";

/** Inputs answered at once; screenshots and texts go to the AI engine. */
export type InstantInput = Exclude<
  Input,
  Readonly<{ type: "SCREENSHOTS" | "TEXT" }>
>;

const START = [
  "Ciao! 👋 Sono il tuo copilota per l'outreach su Instagram.",
  "",
  "Mandami:",
  "• screenshot del profilo di un prospect, e ti propongo tre primi messaggi;",
  "• screenshot di una conversazione, o il testo dei suoi messaggi, e ti dico a che punto è e ti propongo tre risposte.",
  "",
  "Tu scegli, correggi se vuoi e invii: io non scrivo mai a nessuno.",
  "",
  "Scrivi /help per vedere i comandi.",
].join("\n");

const HELP = [
  "Comandi disponibili:",
  "/start – presentazione del bot",
  "/help – questo elenco",
  "",
  "Oltre ai comandi puoi mandarmi screenshot di profili e conversazioni (anche più di uno insieme), il testo di una conversazione e link o @username di profili Instagram.",
].join("\n");

/** The reply to an input the bot answers without the AI engine. */
export const replyTo = (input: InstantInput): string => {
  switch (input.type) {
    case "COMMAND":
      return input.command === "start" ? START : HELP;
    case "UNKNOWN_COMMAND":
      return "Comando non riconosciuto. Scrivi /help per vedere i comandi.";
    case "INSTAGRAM_PROFILE":
      return [
        `👤 Profilo @${input.username} riconosciuto.`,
        "",
        "Dal solo link non vedo bio e contenuti: mandami 1-3 screenshot del profilo, con bio e post, e ti propongo i primi messaggi.",
      ].join("\n");
    case "LINK":
      return "🔗 Link ricevuto. Per un profilo Instagram mandami il link del profilo (instagram.com/nome) o lo @username, e poi gli screenshot.";
    case "UNSUPPORTED":
      return "Per ora gestisco screenshot, testo e link o @username Instagram: questo tipo di messaggio non lo so ancora leggere.";
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
