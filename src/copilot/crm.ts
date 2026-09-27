// Telegram as the panel of Alex's outreach: the prospect's card, and the
// lists of whom to answer and follow up. Built from the memory alone: no
// generation is paid for.
import type { StageChange } from "../conversations/domain.ts";
import { agendaOf, type Agenda } from "../followups/agenda.ts";
import type { ProspectMemory } from "../prospects/memory.ts";
import type { ProspectStore } from "../prospects/store.ts";
import { errorFields } from "../shared/errors.ts";
import type { Logger } from "../shared/logger.ts";
import { resolveReference, type ProspectReference } from "./memory.ts";

export type CardLookup =
  | Readonly<{
      type: "FOUND";
      memory: ProspectMemory;
      history: readonly StageChange[];
    }>
  /** No prospect with that username, or the message is about none. */
  | Readonly<{ type: "UNKNOWN" }>
  | Readonly<{ type: "UNAVAILABLE" }>;

export type AgendaLookup =
  | Readonly<{ type: "FOUND"; agenda: Agenda }>
  | Readonly<{ type: "UNAVAILABLE" }>;

export type Crm = Readonly<{
  /**
   * The card of the prospect Alex named, of the message Alex replied to or
   * of the item of a list Alex tapped.
   */
  card: (reference: ProspectReference, log: Logger) => Promise<CardLookup>;
  /** Every prospect in the day's agenda, as things stand at `now`. */
  agenda: (now: Date, log: Logger) => Promise<AgendaLookup>;
}>;

export const createCrm = ({
  prospects,
}: Readonly<{ prospects: ProspectStore }>): Crm => ({
  card: async (reference, log) => {
    const resolved = await resolveReference(prospects, reference, log);
    if (resolved.type !== "FOUND") {
      return resolved;
    }
    try {
      const memory = await prospects.load(resolved.username);
      if (memory === null) {
        return { type: "UNKNOWN" };
      }
      const history = await prospects
        .stageHistory(resolved.username)
        .catch((error: unknown) => {
          log.warn(errorFields(error), "stage history unavailable");
          return [];
        });
      return { type: "FOUND", memory, history };
    } catch (error) {
      log.error(errorFields(error), "prospect memory unavailable");
      return { type: "UNAVAILABLE" };
    }
  },
  agenda: async (now, log) => {
    try {
      return {
        type: "FOUND",
        agenda: agendaOf(await prospects.overview(), now),
      };
    } catch (error) {
      log.error(errorFields(error), "prospects unavailable");
      return { type: "UNAVAILABLE" };
    }
  },
});
