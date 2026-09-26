// The behavior every ProspectStore must have, run against each
// implementation by its own test file.
import { describe, expect, it } from "vitest";

import {
  MAX_STORED_MESSAGES,
  type ConversationMessage,
  type MemoryUpdate,
  type ProspectProfile,
} from "./memory.ts";
import type { ProspectStore, StoreDependencies } from "./store.ts";

/** Opens an empty store that uses the given clock and identifiers. */
export type OpenStore = (
  dependencies: Required<StoreDependencies>,
) => Promise<ProspectStore>;

const alex = (text: string): ConversationMessage => ({ author: "ALEX", text });
const prospect = (text: string): ConversationMessage => ({
  author: "PROSPECT",
  text,
});

const MARIO: ProspectProfile = {
  username: "mariofit",
  displayName: "Mario Rossi",
  businessType: "personal trainer",
  facts: ["La bio invita a scrivere START in DM."],
  hypotheses: ["Gestire i DM a mano gli fa perdere contatti."],
  conversation: {
    stage: "DISCOVERY",
    intent: "INTERESTED",
    interest: "MEDIUM",
    nextGoal: "VALIDATE_PROBLEM",
  },
  summary: "Personal trainer, riceve molti START in DM.",
};

const GIULIA: ProspectProfile = {
  username: "giulia.bakery",
  displayName: "Giulia",
  businessType: "pasticceria",
  facts: ["Prende gli ordini delle torte solo su WhatsApp."],
  hypotheses: [],
  conversation: null,
  summary: null,
};

/** A clock that moves one second at each save, and predictable ids. */
const dependencies = (): Required<StoreDependencies> => {
  let seconds = 0;
  let ids = 0;
  return {
    now: () => {
      seconds += 1;
      return new Date(Date.UTC(2026, 8, 26, 10, 0, seconds, 250));
    },
    newId: () => {
      ids += 1;
      return `00000000-0000-4000-8000-${String(ids).padStart(12, "0")}`;
    },
  };
};

const at = (second: number): Date =>
  new Date(Date.UTC(2026, 8, 26, 10, 0, second, 250));

export const describeProspectStore = (name: string, open: OpenStore): void => {
  describe(name, () => {
    const save = async (...updates: readonly MemoryUpdate[]) => {
      const store = await open(dependencies());
      for (const update of updates) {
        await store.save(update);
      }
      return store;
    };

    it("knows nothing about a prospect it has never seen", async () => {
      const store = await save();

      expect(await store.load("mariofit")).toBeNull();
    });

    it("creates a prospect with its first messages", async () => {
      const store = await open(dependencies());
      const messages = [alex("Ciao Mario!"), prospect("Ciao, dimmi pure")];

      const saved = await store.save({ profile: MARIO, newMessages: messages });

      const expected = {
        prospect: {
          ...MARIO,
          id: "00000000-0000-4000-8000-000000000001",
          createdAt: at(1),
          updatedAt: at(1),
        },
        messages,
      };
      expect(saved).toStrictEqual(expected);
      expect(await store.load("mariofit")).toStrictEqual(expected);
    });

    it("updates the same prospect when it comes back", async () => {
      const store = await save(
        { profile: MARIO, newMessages: [alex("Ciao Mario!")] },
        {
          profile: { ...MARIO, summary: "Ha risposto con interesse." },
          newMessages: [prospect("Ciao, dimmi pure")],
        },
      );

      const memory = await store.load("mariofit");

      expect(memory?.prospect).toStrictEqual({
        ...MARIO,
        summary: "Ha risposto con interesse.",
        id: "00000000-0000-4000-8000-000000000001",
        createdAt: at(1),
        updatedAt: at(2),
      });
      expect(memory?.messages).toStrictEqual([
        alex("Ciao Mario!"),
        prospect("Ciao, dimmi pure"),
      ]);
    });

    it("keeps only the latest messages", async () => {
      const numbered = (from: number, count: number) =>
        Array.from({ length: count }, (_, index) =>
          alex(`Messaggio ${String(from + index)}`),
        );
      const store = await save(
        { profile: MARIO, newMessages: numbered(1, 45) },
        { profile: MARIO, newMessages: numbered(46, 10) },
      );

      const memory = await store.load("mariofit");

      expect(memory?.messages).toStrictEqual(
        numbered(56 - MAX_STORED_MESSAGES, MAX_STORED_MESSAGES),
      );
    });

    it("never mixes two prospects", async () => {
      const store = await save(
        { profile: MARIO, newMessages: [alex("Ciao Mario!")] },
        { profile: GIULIA, newMessages: [alex("Ciao Giulia!")] },
        { profile: MARIO, newMessages: [prospect("Ciao, dimmi pure")] },
      );

      const mario = await store.load("mariofit");
      const giulia = await store.load("giulia.bakery");

      expect(giulia).toStrictEqual({
        prospect: {
          ...GIULIA,
          id: "00000000-0000-4000-8000-000000000002",
          createdAt: at(2),
          updatedAt: at(2),
        },
        messages: [alex("Ciao Giulia!")],
      });
      expect(mario?.prospect.id).toBe("00000000-0000-4000-8000-000000000001");
      expect(mario?.messages).toStrictEqual([
        alex("Ciao Mario!"),
        prospect("Ciao, dimmi pure"),
      ]);
    });

    it("keeps emojis and accents", async () => {
      const store = await save({
        profile: { ...GIULIA, displayName: "Giulia 🎂 Pasticcerìa" },
        newMessages: [prospect("Perché no? 😅👍🏼")],
      });

      const memory = await store.load("giulia.bakery");

      expect(memory?.prospect.displayName).toBe("Giulia 🎂 Pasticcerìa");
      expect(memory?.messages).toStrictEqual([prospect("Perché no? 😅👍🏼")]);
    });
  });
};
