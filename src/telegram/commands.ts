// The commands of the bot: the menu Telegram shows next to the text field,
// and the list /help explains. One place for both, so they never differ.

export type BotCommand = Readonly<{
  /** Without the slash: lowercase letters, digits and underscores. */
  command: string;
  /** What the menu says: at most 256 characters. */
  description: string;
  /** The line of /help. */
  help: string;
  /** /start is in the chat already: Telegram shows its own button. */
  inMenu: boolean;
}>;

export const BOT_COMMANDS: readonly BotCommand[] = [
  {
    command: "oggi",
    description: "A chi rispondere e i follow-up di oggi",
    help: "/oggi – a chi rispondere e i follow-up da fare oggi",
    inMenu: true,
  },
  {
    command: "followup",
    description: "Follow-up da fare; con @username li scrive",
    help: "/followup – i follow-up da fare e quelli in arrivo; con @username li scrive",
    inMenu: true,
  },
  {
    command: "prospect",
    description: "Scheda di un prospect: /prospect @username",
    help: "/prospect @username – la scheda di un prospect, con i bottoni (basta anche mandarmi @username)",
    inMenu: true,
  },
  {
    command: "nuovo",
    description: "Aggiungere un prospect, chi è da contattare",
    help: "/nuovo – come aggiungere un prospect e chi è ancora da contattare",
    inMenu: true,
  },
  {
    command: "lista",
    description: "Tutti i prospect per stage",
    help: "/lista – tutti i prospect, per stage",
    inMenu: true,
  },
  {
    command: "credito",
    description: "Spesa del mese e credito rimasto",
    help: "/credito – quanto hai speso questo mese e il credito che resta; con il saldo della Console, per esempio /credito 25,40, lo aggiorna",
    inMenu: true,
  },
  {
    command: "start",
    description: "Presentazione del bot",
    help: "/start – presentazione del bot",
    inMenu: false,
  },
  {
    command: "help",
    description: "Comandi e bottoni",
    help: "/help – questo elenco",
    inMenu: true,
  },
];

/** The menu, as Telegram's setMyCommands takes it. */
export const MENU_COMMANDS: readonly Readonly<{
  command: string;
  description: string;
}>[] = BOT_COMMANDS.filter(({ inMenu }) => inMenu).map(
  ({ command, description }) => ({ command, description }),
);
