import type { Input } from "../inputs/classify.ts";
import type { ImageDownloadError } from "../inputs/images.ts";

/**
 * Inputs answered at once, from the input alone: screenshots and texts go
 * to the AI engine, the credit needs the costs recorded, and prospects and
 * profiles their memory.
 */
export type InstantInput = Exclude<
  Input,
  Readonly<{
    type: "SCREENSHOTS" | "TEXT" | "CREDIT" | "PROSPECT" | "INSTAGRAM_PROFILE";
  }>
>;

/** The answer to a profile the bot does not remember. */
export const profileHint = (username: string): string =>
  [
    `👤 Profilo @${username} riconosciuto.`,
    "",
    "Dal solo link non vedo bio e contenuti: mandami 1-3 screenshot del profilo, con bio e post, e ti propongo i primi messaggi.",
  ].join("\n");

export const unknownProspectReply = (username: string): string =>
  `🤷 @${username} non è in memoria. Mandami 1-3 screenshot del suo profilo, con bio e post, o della conversazione: ti propongo cosa scrivere e lo salvo.`;

export const PROSPECT_USAGE =
  "Scrivi /prospect seguito dallo username, per esempio /prospect @mariofit. Basta anche mandarmi solo @mariofit, oppure rispondere con /prospect a un mio messaggio su quel prospect.";

export const PROSPECT_NOT_LINKED_REPLY =
  "🤷 Non so di quale prospect parla il messaggio a cui hai risposto: scrivi /prospect seguito dallo username, per esempio /prospect @mariofit.";

export const PROSPECTS_UNAVAILABLE_REPLY =
  "⚠️ Non riesco a leggere i prospect: il database non risponde. Riprova tra qualche minuto.";

const BUTTONS =
  "Sotto ogni risposta trovi i bottoni: 📋 copia, ✅ inviato (toccalo quando mandi quel messaggio: così so chi aspetta una risposta e quando proporti un follow-up), 🔄 altre 3, 🙂 più naturale, 🎯 più diretto, 💬 follow-up (quando il tuo messaggio non ha avuto risposta), 🔍 cosa ricordo del prospect.";

const START = [
  "Ciao! 👋 Sono il tuo copilota per l'outreach su Instagram.",
  "",
  "Mandami:",
  "• screenshot del profilo di un prospect, e ti propongo tre primi messaggi;",
  "• screenshot di una conversazione, o il testo dei suoi messaggi, e ti dico a che punto è e ti propongo tre risposte.",
  "",
  "Tu scegli, correggi se vuoi e invii: io non scrivo mai a nessuno. Quando hai inviato, tocca ✅ accanto al messaggio che hai mandato.",
  "",
  BUTTONS,
  "",
  "Scrivi /help per vedere i comandi.",
].join("\n");

const HELP = [
  "Comandi disponibili:",
  "/start – presentazione del bot",
  "/help – questo elenco",
  "/prospect @username – la scheda di un prospect, con i bottoni (basta anche mandarmi @username)",
  "/credito – quanto hai speso questo mese e il credito che resta; con il saldo della Console, per esempio /credito 25,40, lo aggiorna",
  "",
  "Oltre ai comandi puoi mandarmi screenshot di profili e conversazioni (anche più di uno insieme), il testo di una conversazione e link o @username di profili Instagram.",
  "",
  BUTTONS,
].join("\n");

/** The reply to an input the bot answers without the AI engine. */
export const replyTo = (input: InstantInput): string => {
  switch (input.type) {
    case "COMMAND":
      return input.command === "start" ? START : HELP;
    case "UNKNOWN_COMMAND":
      return "Comando non riconosciuto. Scrivi /help per vedere i comandi.";
    case "INVALID_USERNAME":
      return "Non riconosco lo username: scrivilo come @nome oppure incolla il link del profilo Instagram.";
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
