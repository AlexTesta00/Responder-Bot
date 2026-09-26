/** A picture sent to the bot, stored by Telegram until it is downloaded. */
export type ImageRef = Readonly<{
  fileId: string;
  /** Size in bytes, when Telegram reports it. */
  fileSize: number | null;
}>;
