import type { AiError } from "../ai/engine.ts";
import type { SuggestionKind } from "../ai/outputs.ts";
import type { SpendingLedger } from "../ai/spending.ts";
import type {
  AnswerPress,
  ButtonAction,
  ButtonAnswer,
  PressButton,
  WriteFromCard,
} from "../copilot/buttons.ts";
import type { ReplyToConversation } from "../copilot/conversation.ts";
import type { ProspectReference } from "../copilot/memory.ts";
import type { Crm } from "../copilot/crm.ts";
import type { Agenda } from "../followups/agenda.ts";
import type { AnalyzeScreenshots } from "../copilot/screenshots.ts";
import { situationOfMemory } from "../followups/situation.ts";
import type { StageChange } from "../conversations/domain.ts";
import type { ProspectMemory } from "../prospects/memory.ts";
import type { ProspectStore } from "../prospects/store.ts";
import { errorFields } from "../shared/errors.ts";
import { relativeDay } from "../shared/time.ts";
import {
  classifyText,
  type CreditRequest,
  type Input,
} from "../inputs/classify.ts";
import {
  withDownloadedImages,
  type DownloadImage,
  type ImageRef,
} from "../inputs/images.ts";
import type { Logger } from "../shared/logger.ts";
import type { Result } from "../shared/result.ts";
import type { MarkSent, SentPress } from "../copilot/sends.ts";
import {
  BUSY_NOTICE,
  EXPIRED_BUTTON_NOTICE,
  MEMORY_UNAVAILABLE_REPLY,
  NOT_LINKED_REPLY,
  OLD_LIST_REPLY,
  pressNotice,
  sentNotice,
  writeNotice,
} from "./button-replies.ts";
import {
  isKeyboardRejection,
  isRetryable,
  type SendOptions,
  type SentMessage,
  type TelegramClient,
  type TelegramError,
} from "./client.ts";
import {
  costLine,
  creditSetReply,
  INVALID_CREDIT_REPLY,
  SPENDING_UNAVAILABLE_REPLY,
  spendingReport,
} from "./costs.ts";
import type { ButtonPress } from "./button-data.ts";
import type { TelegramChatId, TelegramUserId } from "./ids.ts";
import type { InFlight } from "./in-flight.ts";
import { createMediaGroupCollector, type Schedule } from "./media-group.ts";
import type { ProcessedUpdates } from "./processed-updates.ts";
import {
  followUpsList,
  newProspectsList,
  prospectsList,
  todayList,
  type PresentedList,
} from "./lists.ts";
import { prospectCard } from "./prospect-card.ts";
import {
  imageProblemReply,
  profileHint,
  PROSPECT_NOT_LINKED_REPLY,
  PROSPECT_USAGE,
  PROSPECTS_UNAVAILABLE_REPLY,
  replyTo,
  unknownProspectReply,
} from "./replies.ts";
import {
  aiProblemReply,
  conversationAnswer,
  escapeHtml,
  newSuggestionsAnswer,
  pauseAnswer,
  plainMessage,
  screenshotsAnswer,
  type Footer,
  type Presented,
} from "./suggestions.ts";
import type {
  IncomingCallback,
  IncomingUpdate,
  MessageContent,
  TappedBotMessage,
} from "./update.ts";

/** How long to wait for more photos of an album before answering. */
export const ALBUM_QUIET_MS = 2_000;

/** Telegram albums hold at most ten items. */
const ALBUM_MAX_ITEMS = 10;

/**
 * A list's buttons are remembered just after it is sent: a tap that comes
 * first is tried again once, this much later.
 */
export const LIST_RETRY_MS = 1_000;

/** Telegram shows "typing…" for five seconds at most: renewed before then. */
export const TYPING_REFRESH_MS = 4_000;

/** Inputs answered by the AI engine, which takes too long to wait for. */
export type AiInput = Extract<
  Input,
  Readonly<{ type: "SCREENSHOTS" | "TEXT" | "FOLLOW_UP_FOR" }>
>;

/** Inputs answered while Telegram waits, the instant ones and the credit. */
export type RepliedInput = Exclude<Input, AiInput>;

export type IgnoredReason =
  | "UNSUPPORTED_UPDATE"
  | "NOT_PRIVATE_CHAT"
  | "UNAUTHORIZED_SENDER"
  | "DUPLICATE"
  /** A button that is not under a message of a chat. */
  | "NO_BUTTON_MESSAGE"
  /** A button whose data the bot does not know, such as an older one. */
  | "INVALID_BUTTON"
  /** A second tap while the first one is still being answered. */
  | "BUSY";

/** What opened a prospect's card, as the logs name it. */
type CardSource = "command" | "mention" | "item" | "button";

/** The button a tap pressed, as the logs name it. */
export type PressName = ButtonAction | "SENT" | "WRITE" | "OPEN";

export type UpdateOutcome =
  | Readonly<{ type: "REPLIED"; input: RepliedInput["type"] }>
  /** Handed to the AI engine: the answer follows in the background. */
  | Readonly<{ type: "ACCEPTED"; input: AiInput["type"] }>
  /** An album photo, answered together with the rest of its album. */
  | Readonly<{ type: "COLLECTED" }>
  /** A button tap: the answer follows in the background. */
  | Readonly<{
      type: "PRESSED";
      button: PressName;
      /** Null for the buttons of a list. */
      kind: SuggestionKind | null;
    }>
  | Readonly<{ type: "IGNORED"; reason: IgnoredReason }>
  | Readonly<{ type: "FAILED"; retryable: boolean; error: TelegramError }>;

export type UpdateHandler = (
  update: IncomingUpdate,
  log: Logger,
) => Promise<UpdateOutcome>;

export type UpdateHandlerDependencies = Readonly<{
  allowedUserId: TelegramUserId;
  processedUpdates: ProcessedUpdates;
  sendMessage: TelegramClient["sendMessage"];
  sendTyping: TelegramClient["sendTyping"];
  downloadImage: DownloadImage;
  /** Screenshots are analyzed with the memory of the prospect they show. */
  analyzeScreenshots: AnalyzeScreenshots;
  /** A pasted conversation, with the memory of the prospect Alex named. */
  replyToConversation: ReplyToConversation;
  /** A button under an answer, answered from the prospect's memory. */
  pressButton: PressButton;
  /** A button of a prospect's card, written from the memory. */
  writeFromCard: WriteFromCard;
  answerCallbackQuery: TelegramClient["answerCallbackQuery"];
  /** ✅: marks the suggestion Alex sent from a message of the bot. */
  markSent: MarkSent;
  /** The cards and lists of the outreach, from the memory. */
  crm: Crm;
  /** Remembers which prospect each button of a list opens. */
  linkItems: ProspectStore["linkItems"];
  /** The buttons being answered, to answer a double tap once. */
  inFlight: InFlight;
  /** Remembers which prospect the messages of the bot are about. */
  linkMessages: ProspectStore["linkMessages"];
  /** What the analyses cost, and the credit Alex set. */
  spending: SpendingLedger;
  /** The monthly spend limit set on the Console, in millionths of a dollar. */
  monthlyLimitMicroUsd: number | null;
  schedule: Schedule;
  now: () => Date;
}>;

type AlbumPhoto = Readonly<{
  chatId: TelegramChatId;
  image: ImageRef;
  caption: string | null;
  log: Logger;
}>;

export const isAuthorizedUser = (
  allowedUserId: TelegramUserId,
  senderUserId: TelegramUserId,
): boolean => allowedUserId === senderUserId;

const ignored = (reason: IgnoredReason): UpdateOutcome => ({
  type: "IGNORED",
  reason,
});

/** Taps that may run together: each has its own key while it runs. */
const pressKey = (messageKey: string, press: ButtonPress): string => {
  switch (press.type) {
    // ✅ does not wait for a generation under the same message.
    case "SENT":
      return `${messageKey}:ok`;
    // Each item of a list opens on its own.
    case "OPEN":
      return `${messageKey}:o:${String(press.index)}`;
    case "ANSWER":
    case "WRITE":
      return messageKey;
  }
};

/** How many prospects each section of the agenda holds, for the logs. */
const agendaCounts = (agenda: Agenda) => ({
  to_reply: agenda.reply.length,
  follow_up: agenda.followUp.length,
  waiting: agenda.waiting.length,
  to_contact: agenda.toContact.length,
  paused: agenda.paused.length,
  won: agenda.won.length,
});

const notDelivered = (error: TelegramError, log: Logger): void => {
  log.error(
    { error_type: error.type, telegram_error: error },
    "reply not delivered",
  );
};

const inputOf = (content: MessageContent): Input => {
  switch (content.type) {
    case "TEXT":
      return classifyText(content.text);
    case "IMAGE":
      return {
        type: "SCREENSHOTS",
        images: [content.image],
        caption: content.caption,
      };
    case "OTHER":
      return { type: "UNSUPPORTED" };
  }
};

/**
 * Whose conversation a text is: the @username on its first line or, failing
 * that, the message of the bot it replies to.
 */
const referenceOf = (
  username: string | null,
  content: MessageContent,
  chatId: TelegramChatId,
): ProspectReference | null => {
  if (username !== null) {
    return { type: "USERNAME", username };
  }
  return content.type === "TEXT" && content.replyTo !== null
    ? { type: "REPLY", chatId, messageId: content.replyTo }
    : null;
};

/** Decides what to do with an update and answers the allowed user. */
export const createUpdateHandler = ({
  allowedUserId,
  processedUpdates,
  sendMessage,
  sendTyping,
  downloadImage,
  analyzeScreenshots,
  replyToConversation,
  pressButton,
  writeFromCard,
  answerCallbackQuery,
  inFlight,
  markSent,
  crm,
  linkItems,
  linkMessages,
  spending,
  monthlyLimitMicroUsd,
  schedule,
  now,
}: UpdateHandlerDependencies): UpdateHandler => {
  // The AI engine answers after Telegram has been acknowledged, so its
  // failures cannot be retried by Telegram: they are explained or logged.
  const runInBackground = (task: Promise<void>, log: Logger): void => {
    task.catch((error: unknown) => {
      log.error({ err: error }, "background processing crashed");
    });
  };

  /** Shows "typing…" in the chat while `task` runs. */
  const whileTyping = async <T>(
    chatId: TelegramChatId,
    task: () => Promise<T>,
  ): Promise<T> => {
    let cancel = (): void => undefined;
    const showTyping = (): void => {
      // Only a courtesy: when Telegram fails here, the answer fails too and
      // that failure is logged.
      void sendTyping(chatId);
      cancel = schedule(showTyping, TYPING_REFRESH_MS);
    };

    showTyping();
    try {
      return await task();
    } finally {
      cancel();
    }
  };

  /**
   * What an answer cost and what is left, under the answer. Without the
   * month and the credit, the line still tells what the answer cost.
   */
  const costFooter = async (
    costMicroUsd: number | null,
    log: Logger,
  ): Promise<Footer> => {
    const current = await spending.spending().catch((error: unknown) => {
      log.warn(errorFields(error), "spending unavailable");
      return null;
    });
    return costLine({
      costMicroUsd,
      spending: current,
      monthlyLimitMicroUsd,
    });
  };

  /** The reply to /credito: sets the credit if asked, then reports. */
  const creditReply = async (
    request: CreditRequest,
    log: Logger,
  ): Promise<string> => {
    if (request.type === "INVALID") {
      return escapeHtml(INVALID_CREDIT_REPLY);
    }
    try {
      if (request.type === "SET") {
        await spending.setCredit(request.amountMicroUsd);
        log.info({}, "credit set");
      }
      const report = spendingReport(
        await spending.spending(),
        monthlyLimitMicroUsd,
      );
      return request.type === "SET"
        ? `${creditSetReply(request.amountMicroUsd)}\n\n${report}`
        : report;
    } catch (error) {
      log.error(errorFields(error), "spending unavailable");
      return escapeHtml(SPENDING_UNAVAILABLE_REPLY);
    }
  };

  /**
   * Sends an HTML message, in reply to `replyTo` if given. When Telegram
   * refuses its buttons, the text still arrives, without them.
   */
  const sendPresented = async (
    chatId: TelegramChatId,
    { html, keyboard }: Presented,
    log: Logger,
    replyTo?: number,
  ): Promise<Result<SentMessage, TelegramError>> => {
    const options: SendOptions =
      replyTo === undefined
        ? { parseMode: "HTML" }
        : { parseMode: "HTML", replyTo };
    const first = await sendMessage(
      chatId,
      html,
      keyboard === null ? options : { ...options, keyboard },
    );
    if (first.ok || keyboard === null || !isKeyboardRejection(first.error)) {
      return first;
    }
    log.warn(
      { telegram_error: first.error },
      "keyboard rejected, answer resent without buttons",
    );
    return sendMessage(chatId, html, options);
  };

  /** Sends an answer nobody waits for, and returns its id. */
  const deliver = async (
    chatId: TelegramChatId,
    presented: Presented,
    log: Logger,
    replyTo?: number,
  ): Promise<number | null> => {
    const delivery = await sendPresented(chatId, presented, log, replyTo);
    if (!delivery.ok) {
      notDelivered(delivery.error, log);
      return null;
    }
    return delivery.value.messageId;
  };

  /**
   * Links a message of the bot to a prospect: replying to it, or tapping its
   * buttons, continues with that prospect.
   */
  const link = async (
    prospectId: string,
    chatId: TelegramChatId,
    messageId: number,
    log: Logger,
  ): Promise<void> => {
    try {
      await linkMessages(prospectId, chatId, [messageId]);
    } catch (error) {
      // The message arrived: only replying to it loses the prospect.
      log.warn(errorFields(error), "bot messages not linked to the prospect");
    }
  };

  /** Delivers a message about a prospect, then links it to them. */
  const deliverLinked = async (
    chatId: TelegramChatId,
    presented: Presented,
    prospectId: string | null,
    log: Logger,
    replyTo?: number,
  ): Promise<void> => {
    const sent = await deliver(chatId, presented, log, replyTo);
    if (prospectId !== null && sent !== null) {
      await link(prospectId, chatId, sent, log);
    }
  };

  /** Sends a prospect's card, linked to them like every answer about them. */
  const sendCard = async (
    chatId: TelegramChatId,
    card: Readonly<{ memory: ProspectMemory; history: readonly StageChange[] }>,
    source: CardSource,
    log: Logger,
    replyTo?: number,
  ): Promise<Result<SentMessage, TelegramError>> => {
    const time = now();
    const { memory } = card;
    const sent = await sendPresented(
      chatId,
      prospectCard(memory, card.history, time),
      log,
      replyTo,
    );
    if (sent.ok) {
      log.info(
        {
          prospect_id: memory.prospect.id,
          situation: situationOfMemory(memory, time).type,
          source,
        },
        "prospect card shown",
      );
      await link(memory.prospect.id, chatId, sent.value.messageId, log);
    }
    return sent;
  };

  /** Delivers the answer of an analysis, linked to its prospect. */
  const deliverAnswer = async <T>(
    chatId: TelegramChatId,
    result: Result<T, AiError>,
    present: (value: T, footer: Footer) => Presented,
    answer: Readonly<{
      prospectId: string | null;
      costMicroUsd: number | null;
    }>,
    log: Logger,
  ): Promise<void> => {
    const footer = await costFooter(answer.costMicroUsd, log);
    await deliverLinked(
      chatId,
      result.ok
        ? present(result.value, footer)
        : plainMessage(aiProblemReply(result.error), footer),
      answer.prospectId,
      log,
    );
  };

  const answerScreenshots = async (
    chatId: TelegramChatId,
    images: readonly ImageRef[],
    caption: string | null,
    log: Logger,
  ): Promise<void> => {
    const analyzed = await whileTyping(chatId, () =>
      withDownloadedImages(images, downloadImage, (downloaded) =>
        analyzeScreenshots(downloaded, caption, log),
      ),
    );
    if (!analyzed.ok) {
      log.warn({ image_problem: analyzed.error }, "screenshots not processed");
      await deliver(
        chatId,
        plainMessage(imageProblemReply(analyzed.error)),
        log,
      );
      return;
    }
    const { generation, memory, pause, prospectId } = analyzed.value;
    await deliverAnswer(
      chatId,
      generation.result,
      (analysis, footer) =>
        screenshotsAnswer(analysis, {
          memory,
          pause,
          linked: prospectId !== null,
          footer,
        }),
      analyzed.value,
      log,
    );
  };

  const answerConversation = async (
    chatId: TelegramChatId,
    text: string,
    reference: ProspectReference | null,
    log: Logger,
  ): Promise<void> => {
    const answer = await whileTyping(chatId, () =>
      replyToConversation(text, reference, log),
    );
    const { generation, username, memory, pause, prospectId } = answer;
    await deliverAnswer(
      chatId,
      generation.result,
      (reply, footer) =>
        conversationAnswer(reply, username, {
          memory,
          pause,
          linked: prospectId !== null,
          footer,
        }),
      answer,
      log,
    );
  };

  /** The message that answers a tap, in reply to the tapped message. */
  /**
   * Delivers what a button, or /followup @name, asked for: in reply to the
   * tapped message, if any.
   */
  const deliverPressAnswer = async (
    chatId: TelegramChatId,
    kind: SuggestionKind,
    answer: ButtonAnswer,
    source: CardSource,
    log: Logger,
    messageId?: number,
  ): Promise<void> => {
    switch (answer.type) {
      case "SUGGESTED": {
        const { result } = answer.generation;
        const footer = await costFooter(answer.costMicroUsd, log);
        await deliverLinked(
          chatId,
          result.ok
            ? newSuggestionsAnswer(
                result.value,
                {
                  action: answer.action,
                  kind: answer.kind,
                  username: answer.username,
                  upgraded: answer.upgraded,
                  previousLost: answer.previousLost,
                  declared: answer.declared,
                  fromCard: answer.fromCard,
                  followUp:
                    answer.followUp === null
                      ? null
                      : {
                          number: answer.followUp.number,
                          lastWritten: relativeDay(
                            answer.followUp.lastOutboundAt,
                            now(),
                          ),
                        },
                },
                footer,
              )
            : plainMessage(aiProblemReply(result.error), footer),
          answer.prospectId,
          log,
          messageId,
        );
        return;
      }
      case "PAUSED":
        await deliverLinked(
          chatId,
          pauseAnswer(answer.pause, kind),
          answer.prospectId,
          log,
          messageId,
        );
        return;
      case "CARD": {
        const sent = await sendCard(chatId, answer, source, log, messageId);
        if (!sent.ok) {
          notDelivered(sent.error, log);
        }
        return;
      }
      case "NOT_LINKED":
        await deliver(chatId, plainMessage(NOT_LINKED_REPLY), log, messageId);
        return;
      case "UNAVAILABLE":
        await deliver(
          chatId,
          plainMessage(MEMORY_UNAVAILABLE_REPLY),
          log,
          messageId,
        );
        return;
    }
  };

  /** Stops the loading indicator of a button, with a notice if any. */
  const acknowledge = async (
    queryId: string,
    notice: string | undefined,
    log: Logger,
  ): Promise<void> => {
    const answered = await answerCallbackQuery(queryId, notice);
    if (!answered.ok) {
      // The indicator stops by itself: the tap is still answered.
      log.warn(
        {
          error_type: answered.error.type,
          telegram_error: answered.error,
        },
        "button tap not acknowledged",
      );
    }
  };

  /**
   * Answers a tap: acknowledged at once, before reading the memory or
   * calling the AI, then answered with a new message.
   */
  const answerPress = async (
    queryId: string,
    tapped: TappedBotMessage,
    press: AnswerPress,
    key: string,
    log: Logger,
  ): Promise<void> => {
    try {
      await acknowledge(queryId, pressNotice(press.action), log);
      const request = {
        chatId: tapped.chatId,
        messageId: tapped.messageId,
        suggestions: tapped.suggestions,
      };
      // What the bot remembers is shown at once; writing takes a while.
      const answer =
        press.action === "ANALYZE"
          ? await pressButton(press, request, log)
          : await whileTyping(tapped.chatId, () =>
              pressButton(press, request, log),
            );
      log.info(
        {
          button: press.action,
          kind: press.kind,
          response: answer.type,
          ...(answer.type === "PAUSED" ? { pause: answer.pause } : {}),
        },
        "button handled",
      );
      await deliverPressAnswer(
        tapped.chatId,
        press.kind,
        answer,
        "button",
        log,
        tapped.messageId,
      );
    } finally {
      inFlight.finish(key);
    }
  };

  /** Answers a button of a card, like one under suggestions. */
  const answerWrite = async (
    queryId: string,
    tapped: TappedBotMessage,
    kind: SuggestionKind,
    key: string,
    log: Logger,
  ): Promise<void> => {
    try {
      await acknowledge(queryId, writeNotice(kind), log);
      const answer = await whileTyping(tapped.chatId, () =>
        writeFromCard(
          kind,
          { type: "REPLY", chatId: tapped.chatId, messageId: tapped.messageId },
          log,
        ),
      );
      log.info(
        {
          button: "WRITE",
          kind,
          response: answer.type,
          ...(answer.type === "PAUSED" ? { pause: answer.pause } : {}),
        },
        "button handled",
      );
      await deliverPressAnswer(
        tapped.chatId,
        kind,
        answer,
        "button",
        log,
        tapped.messageId,
      );
    } finally {
      inFlight.finish(key);
    }
  };

  /**
   * Answers ✅: the send is recorded first, then the tap is acknowledged
   * with what happened, so that the notice never says more than was done.
   */
  const answerSent = async (
    queryId: string,
    tapped: TappedBotMessage,
    press: SentPress,
    key: string,
    log: Logger,
  ): Promise<void> => {
    try {
      const marked = await markSent(
        press,
        {
          chatId: tapped.chatId,
          messageId: tapped.messageId,
          suggestions: tapped.suggestions,
        },
        log,
      );
      log.info(
        { button: "SENT", kind: press.kind, response: marked.type },
        "button handled",
      );
      await acknowledge(queryId, sentNotice(marked, now()), log);
    } finally {
      inFlight.finish(key);
    }
  };

  /** Remembers which prospect each button of a list opens. */
  const linkListItems = async (
    chatId: TelegramChatId,
    messageId: number,
    items: readonly string[],
    log: Logger,
  ): Promise<void> => {
    if (items.length === 0) {
      return;
    }
    try {
      await linkItems(chatId, messageId, items);
    } catch (error) {
      // The list arrived: its buttons will say it is old.
      log.warn(errorFields(error), "list items not linked");
    }
  };

  /** A list of the agenda, each prospect with a button to the card. */
  const replyList = async (
    chatId: TelegramChatId,
    command: "today" | "follow_ups" | "new_prospects" | "list",
    render: (agenda: Agenda, now: Date) => PresentedList,
    log: Logger,
  ): Promise<Result<SentMessage, TelegramError>> => {
    const time = now();
    const found = await crm.agenda(time, log);
    if (found.type === "UNAVAILABLE") {
      return sendMessage(chatId, PROSPECTS_UNAVAILABLE_REPLY);
    }
    const list = render(found.agenda, time);
    const sent = await sendPresented(chatId, list, log);
    if (sent.ok) {
      log.info(
        { command, ...agendaCounts(found.agenda), items: list.items.length },
        "crm command handled",
      );
      await linkListItems(chatId, sent.value.messageId, list.items, log);
    }
    return sent;
  };

  /**
   * /followup @name: the follow-up, written only when it is due; otherwise
   * the card says when it will be, and nothing is paid for.
   */
  const answerFollowUpFor = async (
    chatId: TelegramChatId,
    username: string,
    log: Logger,
  ): Promise<void> => {
    const answer = await whileTyping(chatId, () =>
      writeFromCard("FOLLOW_UPS", { type: "USERNAME", username }, log),
    );
    log.info(
      {
        command: "follow_up_for",
        response: answer.type,
        ...(answer.type === "PAUSED" ? { pause: answer.pause } : {}),
      },
      "crm command handled",
    );
    if (answer.type === "NOT_LINKED") {
      await deliver(chatId, plainMessage(unknownProspectReply(username)), log);
      return;
    }
    await deliverPressAnswer(chatId, "FOLLOW_UPS", answer, "command", log);
  };

  /** The card of a prospect, or plain text when there is none to show. */
  const cardReply = async (
    chatId: TelegramChatId,
    reference: ProspectReference,
    texts: Readonly<{ unknown: string; unavailable: string }>,
    source: CardSource,
    log: Logger,
  ): Promise<Result<SentMessage, TelegramError>> => {
    const found = await crm.card(reference, log);
    switch (found.type) {
      case "FOUND":
        return sendCard(chatId, found, source, log);
      case "UNKNOWN":
        return sendMessage(chatId, texts.unknown);
      case "UNAVAILABLE":
        return sendMessage(chatId, texts.unavailable);
    }
  };

  /** Answers the inputs Telegram waits for: commands, cards, profiles. */
  const replyNow = async (
    input: RepliedInput,
    content: MessageContent,
    chatId: TelegramChatId,
    log: Logger,
  ): Promise<Result<SentMessage, TelegramError>> => {
    switch (input.type) {
      case "CREDIT":
        return sendMessage(chatId, await creditReply(input.request, log), {
          parseMode: "HTML",
        });
      case "TODAY":
        return replyList(chatId, "today", todayList, log);
      case "FOLLOW_UPS":
        return replyList(chatId, "follow_ups", followUpsList, log);
      case "NEW_PROSPECTS":
        return replyList(chatId, "new_prospects", newProspectsList, log);
      case "LIST":
        return replyList(chatId, "list", prospectsList, log);
      case "PROSPECT": {
        if (input.username !== null) {
          return cardReply(
            chatId,
            { type: "USERNAME", username: input.username },
            {
              unknown: unknownProspectReply(input.username),
              unavailable: PROSPECTS_UNAVAILABLE_REPLY,
            },
            "command",
            log,
          );
        }
        // Without a username, only the message Alex replied to says who.
        return content.type === "TEXT" && content.replyTo !== null
          ? cardReply(
              chatId,
              { type: "REPLY", chatId, messageId: content.replyTo },
              {
                unknown: PROSPECT_NOT_LINKED_REPLY,
                unavailable: PROSPECTS_UNAVAILABLE_REPLY,
              },
              "command",
              log,
            )
          : sendMessage(chatId, PROSPECT_USAGE);
      }
      case "INSTAGRAM_PROFILE":
        // A profile the bot remembers opens its card; any other gets the hint.
        return cardReply(
          chatId,
          { type: "USERNAME", username: input.username },
          {
            unknown: profileHint(input.username),
            unavailable: profileHint(input.username),
          },
          "mention",
          log,
        );
      case "COMMAND":
      case "INVALID_USERNAME":
      case "UNKNOWN_COMMAND":
      case "LINK":
      case "UNSUPPORTED":
        return sendMessage(chatId, replyTo(input));
    }
  };

  const waitFor = (delayMs: number): Promise<void> =>
    new Promise((resolve) => {
      schedule(resolve, delayMs);
    });

  /** A button of a list: the card of its prospect, in reply to the list. */
  const answerOpen = async (
    queryId: string,
    tapped: TappedBotMessage,
    index: number,
    key: string,
    log: Logger,
  ): Promise<void> => {
    try {
      await acknowledge(queryId, undefined, log);
      const { chatId, messageId } = tapped;
      const reference = { type: "ITEM", chatId, messageId, index } as const;
      const first = await crm.card(reference, log);
      const found =
        first.type === "UNKNOWN"
          ? await waitFor(LIST_RETRY_MS).then(() => crm.card(reference, log))
          : first;
      log.info({ button: "OPEN", response: found.type }, "button handled");
      switch (found.type) {
        case "FOUND": {
          const sent = await sendCard(chatId, found, "item", log, messageId);
          if (!sent.ok) {
            notDelivered(sent.error, log);
          }
          return;
        }
        case "UNKNOWN":
          await deliver(chatId, plainMessage(OLD_LIST_REPLY), log, messageId);
          return;
        case "UNAVAILABLE":
          await deliver(
            chatId,
            plainMessage(PROSPECTS_UNAVAILABLE_REPLY),
            log,
            messageId,
          );
          return;
      }
    } finally {
      inFlight.finish(key);
    }
  };

  /** What can be decided about a tap without waiting for anything. */
  const handleCallback = (
    updateId: number,
    { queryId, senderId, message, press }: IncomingCallback,
    log: Logger,
  ): UpdateOutcome => {
    if (message === null) {
      return ignored("NO_BUTTON_MESSAGE");
    }
    if (message.chatType !== "private") {
      return ignored("NOT_PRIVATE_CHAT");
    }
    if (!isAuthorizedUser(allowedUserId, senderId)) {
      return ignored("UNAUTHORIZED_SENDER");
    }
    // A tap is never released for a retry: each one may pay for the AI.
    if (!processedUpdates.claim(updateId)) {
      return ignored("DUPLICATE");
    }
    if (press === null) {
      runInBackground(acknowledge(queryId, EXPIRED_BUTTON_NOTICE, log), log);
      return ignored("INVALID_BUTTON");
    }
    const key = pressKey(
      `${String(message.chatId)}:${String(message.messageId)}`,
      press,
    );
    if (!inFlight.start(key)) {
      runInBackground(acknowledge(queryId, BUSY_NOTICE, log), log);
      return ignored("BUSY");
    }
    switch (press.type) {
      case "ANSWER":
        runInBackground(answerPress(queryId, message, press, key, log), log);
        return { type: "PRESSED", button: press.action, kind: press.kind };
      case "SENT":
        runInBackground(answerSent(queryId, message, press, key, log), log);
        return { type: "PRESSED", button: "SENT", kind: press.kind };
      case "WRITE":
        runInBackground(
          answerWrite(queryId, message, press.kind, key, log),
          log,
        );
        return { type: "PRESSED", button: "WRITE", kind: press.kind };
      case "OPEN":
        runInBackground(
          answerOpen(queryId, message, press.index, key, log),
          log,
        );
        return { type: "PRESSED", button: "OPEN", kind: null };
    }
  };

  const albums = createMediaGroupCollector<AlbumPhoto>({
    quietMs: ALBUM_QUIET_MS,
    maxItems: ALBUM_MAX_ITEMS,
    schedule,
    onComplete: (photos) => {
      const [first] = photos;
      const last = photos.at(-1);
      if (first === undefined || last === undefined) {
        return;
      }

      last.log.info(
        { input: "SCREENSHOTS", images: photos.length },
        "telegram album accepted for processing",
      );
      runInBackground(
        answerScreenshots(
          first.chatId,
          photos.map((photo) => photo.image),
          photos.find((photo) => photo.caption !== null)?.caption ?? null,
          last.log,
        ),
        last.log,
      );
    },
  });

  return async (update, log) => {
    if (update.type === "UNSUPPORTED") {
      return ignored("UNSUPPORTED_UPDATE");
    }
    if (update.type === "CALLBACK") {
      return handleCallback(update.updateId, update.callback, log);
    }

    const { message } = update;

    // The bot is personal: prospect data must never reach groups or channels.
    if (message.chatType !== "private") {
      return ignored("NOT_PRIVATE_CHAT");
    }
    if (!isAuthorizedUser(allowedUserId, message.senderId)) {
      return ignored("UNAUTHORIZED_SENDER");
    }
    // Telegram delivers an update again when it misses our response.
    if (!processedUpdates.claim(update.updateId)) {
      return ignored("DUPLICATE");
    }

    const { chatId, content } = message;
    if (content.type === "IMAGE" && content.mediaGroupId !== null) {
      // Each photo of an album arrives as its own update: they are answered
      // together, with a single analysis.
      albums.add(`${String(chatId)}:${content.mediaGroupId}`, {
        chatId,
        image: content.image,
        caption: content.caption,
        log,
      });
      return { type: "COLLECTED" };
    }

    const input = inputOf(content);
    if (input.type === "SCREENSHOTS") {
      runInBackground(
        answerScreenshots(chatId, input.images, input.caption, log),
        log,
      );
      return { type: "ACCEPTED", input: input.type };
    }
    if (input.type === "TEXT") {
      runInBackground(
        answerConversation(
          chatId,
          input.text,
          referenceOf(input.username, content, chatId),
          log,
        ),
        log,
      );
      return { type: "ACCEPTED", input: input.type };
    }
    if (input.type === "FOLLOW_UP_FOR") {
      runInBackground(answerFollowUpFor(chatId, input.username, log), log);
      return { type: "ACCEPTED", input: input.type };
    }

    const sent = await replyNow(input, content, chatId, log);
    if (sent.ok) {
      return { type: "REPLIED", input: input.type };
    }

    const retryable = isRetryable(sent.error);
    if (retryable) {
      // Nothing was sent: let Telegram's next delivery try again.
      processedUpdates.release(update.updateId);
    }
    return { type: "FAILED", retryable, error: sent.error };
  };
};
