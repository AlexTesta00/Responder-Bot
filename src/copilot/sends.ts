// ✅ Inviato: Alex tells which suggestion of a message of the bot was sent.
// Only a send is recorded, for the prospect of that message: the memory of
// the analyses does not change. The situation after it tells Alex when a
// follow-up will be due.
import {
  KIND_STYLES,
  type SuggestionIndex,
  type SuggestionKind,
  type SuggestionStyle,
} from "../ai/outputs.ts";
import { situationOfMemory, type Situation } from "../followups/situation.ts";
import type { ProspectStore } from "../prospects/store.ts";
import { errorFields } from "../shared/errors.ts";
import type { Logger } from "../shared/logger.ts";
import type { TappedMessage } from "./buttons.ts";

/** Which suggestion was sent: null when Alex did not say which one. */
export type SentPress = Readonly<{
  kind: SuggestionKind;
  index: SuggestionIndex | null;
}>;

export type MarkedSend =
  | Readonly<{
      type: "RECORDED" | "CORRECTED" | "UNCHANGED";
      /** The suggestion now marked, when known. */
      style: SuggestionStyle | null;
      /** When the send was first marked. */
      sentAt: Date;
      /** What Alex should do next, when the memory could be read. */
      situation: Situation | null;
    }>
  /** The message is about no prospect the bot remembers. */
  | Readonly<{ type: "NOT_LINKED" }>
  /** The send could not be recorded. */
  | Readonly<{ type: "UNAVAILABLE" }>;

export type MarkSent = (
  press: SentPress,
  tapped: TappedMessage,
  log: Logger,
) => Promise<MarkedSend>;

export const createSendMarking = ({
  prospects,
  now,
}: Readonly<{ prospects: ProspectStore; now: () => Date }>): MarkSent => {
  const situationAfter = async (
    username: string,
    log: Logger,
  ): Promise<Situation | null> => {
    try {
      const memory = await prospects.load(username);
      return memory === null ? null : situationOfMemory(memory, now());
    } catch (error) {
      log.warn(errorFields(error), "prospect memory unavailable");
      return null;
    }
  };

  return async ({ kind, index }, tapped, log) => {
    const style = index === null ? null : KIND_STYLES[kind][index];
    // The text is read back only when the message still shows all three.
    const texts =
      tapped.suggestions.length === KIND_STYLES[kind].length
        ? tapped.suggestions
        : [];
    const text = index === null ? null : (texts[index] ?? null);

    const outcome = await prospects
      .recordSend({
        chatId: tapped.chatId,
        messageId: tapped.messageId,
        kind,
        style,
        text,
      })
      .catch((error: unknown) => {
        log.error(errorFields(error), "send not recorded");
        return null;
      });
    if (outcome === null) {
      return { type: "UNAVAILABLE" };
    }
    log.info(
      {
        ...(outcome.type === "NOT_LINKED"
          ? {}
          : { prospect_id: outcome.prospectId }),
        kind,
        style,
        outcome: outcome.type,
      },
      "send recorded",
    );
    if (outcome.type === "NOT_LINKED") {
      return outcome;
    }
    return {
      type: outcome.type,
      style,
      sentAt: outcome.sentAt,
      situation: await situationAfter(outcome.username, log),
    };
  };
};
