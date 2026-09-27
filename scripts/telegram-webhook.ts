// Manages the bot's registration with Telegram:
//   npm run telegram:webhook -- set https://<domain>   register the webhook
//   npm run telegram:webhook -- info                   show its status
//   npm run telegram:webhook -- commands               register the command menu
// Credentials come from the environment (.env locally); they are never
// printed.
import { z } from "zod";

import { describeEnvError, parseEnv } from "../src/config/env.ts";
import { TELEGRAM_WEBHOOK_PATH } from "../src/routes/telegram-webhook.ts";
import {
  createTelegramClient,
  type TelegramClient,
  type TelegramError,
} from "../src/telegram/client.ts";
import { MENU_COMMANDS } from "../src/telegram/commands.ts";
import { ALLOWED_UPDATES } from "../src/telegram/update.ts";

const USAGE = [
  "Usage:",
  "  npm run telegram:webhook -- set https://<domain>   register the webhook",
  "  npm run telegram:webhook -- info                   show its status",
  "  npm run telegram:webhook -- commands               register the command menu",
].join("\n");

const httpsUrlSchema = z.url({ protocol: /^https$/ });

const fail: (message: string) => never = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const describeFailure = (error: TelegramError): string => {
  switch (error.type) {
    case "API_ERROR":
      return `${String(error.status)} ${error.description}`;
    case "NETWORK_ERROR":
      return error.timedOut
        ? "Telegram did not answer in time"
        : "Telegram is unreachable";
    case "INVALID_RESPONSE":
      return `unexpected response (HTTP ${String(error.status)})`;
    case "FILE_TOO_LARGE":
      return `file larger than ${String(error.maxBytes)} bytes`;
  }
};

const printWebhookInfo = async (telegram: TelegramClient): Promise<void> => {
  const info = await telegram.getWebhookInfo();
  if (!info.ok) {
    fail(`Could not read the webhook status: ${describeFailure(info.error)}`);
  }

  const { url, pendingUpdateCount, lastErrorMessage, allowedUpdates } =
    info.value;
  process.stdout.write(
    [
      `Webhook URL:     ${url === "" ? "(not set)" : url}`,
      `Pending updates: ${String(pendingUpdateCount)}`,
      `Last error:      ${lastErrorMessage ?? "none"}`,
      `Allowed updates: ${allowedUpdates === null ? "(Telegram's default)" : allowedUpdates.join(", ")}`,
      "",
    ].join("\n"),
  );
};

const env = parseEnv(process.env);
if (!env.ok) {
  fail(describeEnvError(env.error));
}

const telegram = createTelegramClient({ token: env.value.TELEGRAM_BOT_TOKEN });
const [command, argument] = process.argv.slice(2);

switch (command) {
  case "set": {
    const baseUrl = httpsUrlSchema.safeParse(argument);
    if (!baseUrl.success) {
      fail(`Expected the bot's public HTTPS address.\n\n${USAGE}`);
    }

    const registered = await telegram.setWebhook({
      url: new URL(TELEGRAM_WEBHOOK_PATH, baseUrl.data).href,
      secretToken: env.value.TELEGRAM_WEBHOOK_SECRET,
      // Messages and button taps: without callback_query, buttons spin.
      allowedUpdates: [...ALLOWED_UPDATES],
      // Registering again an active webhook, as when it gains update
      // types, must not lose the messages waiting to be delivered.
      dropPendingUpdates: false,
    });
    if (!registered.ok) {
      fail(`Webhook registration failed: ${describeFailure(registered.error)}`);
    }

    process.stdout.write("Webhook registered.\n");
    await printWebhookInfo(telegram);
    break;
  }
  case "info":
    await printWebhookInfo(telegram);
    break;
  case "commands": {
    const registered = await telegram.setMyCommands(MENU_COMMANDS);
    if (!registered.ok) {
      fail(
        `Command menu registration failed: ${describeFailure(registered.error)}`,
      );
    }
    process.stdout.write(
      [
        "Command menu registered:",
        ...MENU_COMMANDS.map(
          ({ command, description }) => `  /${command} – ${description}`,
        ),
        "",
      ].join("\n"),
    );
    break;
  }
  case undefined:
  default:
    fail(USAGE);
}
