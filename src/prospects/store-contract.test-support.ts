// The behavior every ProspectStore must have, run against each
// implementation by its own test file.
import { describe, expect, it } from "vitest";

import type { ConversationMessage } from "../conversations/domain.ts";
import {
  MAX_STORED_MESSAGES,
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
  objections: ["Un sito gli sembra una spesa alta per ora."],
  commitments: [
    { by: "ALEX", text: "Mandargli un esempio di prenotazione online." },
    { by: "PROSPECT", text: "Fargli sapere entro venerdì." },
  ],
};

const GIULIA: ProspectProfile = {
  username: "giulia.bakery",
  displayName: "Giulia",
  businessType: "pasticceria",
  facts: ["Prende gli ordini delle torte solo su WhatsApp."],
  hypotheses: [],
  conversation: null,
  summary: null,
  objections: [],
  commitments: [],
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
        contact: {
          lastProspectMessageAt: at(1),
          lastAlexMessageAt: at(1),
          lastMessageAt: at(1),
          sends: [],
        },
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
        contact: {
          lastProspectMessageAt: null,
          lastAlexMessageAt: at(2),
          lastMessageAt: at(2),
          sends: [],
        },
      });
      expect(mario?.prospect.id).toBe("00000000-0000-4000-8000-000000000001");
      expect(mario?.messages).toStrictEqual([
        alex("Ciao Mario!"),
        prospect("Ciao, dimmi pure"),
      ]);
    });

    it("records every change of stage, and only those", async () => {
      const valued = {
        ...MARIO,
        conversation: {
          stage: "VALUE",
          intent: "CURIOUS",
          interest: "HIGH",
          nextGoal: "PROPOSE_CALL",
        },
      } as const;
      const store = await save(
        { profile: { ...MARIO, conversation: null }, newMessages: [] },
        { profile: MARIO, newMessages: [] },
        { profile: MARIO, newMessages: [] },
        { profile: valued, newMessages: [] },
        { profile: GIULIA, newMessages: [] },
      );

      expect(await store.stageHistory("mariofit")).toStrictEqual([
        { from: null, to: "DISCOVERY", at: at(2) },
        { from: "DISCOVERY", to: "VALUE", at: at(4) },
      ]);
      expect(await store.stageHistory("giulia.bakery")).toStrictEqual([]);
      expect(await store.stageHistory("nobody")).toStrictEqual([]);
    });

    it("remembers which prospect each message of the bot is about", async () => {
      const store = await open(dependencies());
      const mario = await store.save({ profile: MARIO, newMessages: [] });
      const giulia = await store.save({ profile: GIULIA, newMessages: [] });

      await store.linkMessages(mario.prospect.id, 42, [1_001, 1_002]);
      await store.linkMessages(giulia.prospect.id, 42, [1_003]);
      await store.linkMessages(giulia.prospect.id, 42, []);

      expect(await store.prospectOfMessage(42, 1_002)).toBe("mariofit");
      expect(await store.prospectOfMessage(42, 1_003)).toBe("giulia.bakery");
      expect(await store.prospectOfMessage(42, 1_004)).toBeNull();
      expect(await store.prospectOfMessage(7, 1_001)).toBeNull();
    });

    it("remembers when each side last wrote, as the bot saw it", async () => {
      const store = await save(
        { profile: MARIO, newMessages: [alex("Ciao Mario!")] },
        { profile: MARIO, newMessages: [prospect("Ciao, dimmi pure")] },
        { profile: MARIO, newMessages: [alex("Ti mando un esempio")] },
        // Nothing new: an analysis of the same chat, or of the profile.
        { profile: MARIO, newMessages: [] },
      );

      expect((await store.load("mariofit"))?.contact).toStrictEqual({
        lastProspectMessageAt: at(2),
        lastAlexMessageAt: at(3),
        lastMessageAt: at(3),
        sends: [],
      });
    });

    it("knows no contact with a prospect only seen in the profile", async () => {
      const store = await save({ profile: MARIO, newMessages: [] });

      expect((await store.load("mariofit"))?.contact).toStrictEqual({
        lastProspectMessageAt: null,
        lastAlexMessageAt: null,
        lastMessageAt: null,
        sends: [],
      });
    });

    describe("sends", () => {
      const CHAT = 42;

      /** A store with Mario, and message 1001 of the bot about Mario. */
      const withMario = async () => {
        const store = await open(dependencies());
        const memory = await store.save({
          profile: MARIO,
          newMessages: [alex("Ciao Mario!")],
        });
        await store.linkMessages(memory.prospect.id, CHAT, [1_001]);
        return { store, id: memory.prospect.id };
      };

      const best = {
        chatId: CHAT,
        messageId: 1_001,
        kind: "FIRST_MESSAGES",
        style: "BEST",
        text: "Ciao Mario 💪 quanti START ricevi?",
      } as const;

      it("marks the suggestion Alex sent from a message about the prospect", async () => {
        const { store, id } = await withMario();

        expect(await store.recordSend(best)).toStrictEqual({
          type: "RECORDED",
          prospectId: id,
          username: "mariofit",
          sentAt: at(3),
        });
        expect((await store.load("mariofit"))?.contact.sends).toStrictEqual([
          {
            kind: "FIRST_MESSAGES",
            style: "BEST",
            text: "Ciao Mario 💪 quanti START ricevi?",
            sentAt: at(3),
          },
        ]);
      });

      it("keeps one send per message, corrected when it names another suggestion", async () => {
        const { store, id } = await withMario();
        await store.recordSend(best);

        const again = await store.recordSend(best);
        const unnamed = await store.recordSend({
          ...best,
          style: null,
          text: null,
        });
        const other = await store.recordSend({
          ...best,
          style: "NATURAL",
          text: "Bello il format START!",
        });

        const kept = { prospectId: id, username: "mariofit", sentAt: at(3) };
        expect([again, unnamed, other]).toStrictEqual([
          { type: "UNCHANGED", ...kept },
          { type: "UNCHANGED", ...kept },
          { type: "CORRECTED", ...kept },
        ]);
        expect((await store.load("mariofit"))?.contact.sends).toStrictEqual([
          {
            kind: "FIRST_MESSAGES",
            style: "NATURAL",
            text: "Bello il format START!",
            sentAt: at(3),
          },
        ]);
      });

      it("marks nothing for a message about no prospect", async () => {
        const { store } = await withMario();

        expect(
          await store.recordSend({ ...best, messageId: 9_999 }),
        ).toStrictEqual({ type: "NOT_LINKED" });
        expect((await store.load("mariofit"))?.contact.sends).toStrictEqual([]);
      });

      it("loads only what Alex sent after the prospect's latest message", async () => {
        const { store, id } = await withMario();
        await store.recordSend(best);
        await store.save({
          profile: MARIO,
          newMessages: [prospect("Tanti! Perché?")],
        });
        await store.linkMessages(id, CHAT, [1_002]);
        await store.recordSend({
          chatId: CHAT,
          messageId: 1_002,
          kind: "REPLIES",
          style: null,
          text: null,
        });

        expect((await store.load("mariofit"))?.contact.sends).toStrictEqual([
          { kind: "REPLIES", style: null, text: null, sentAt: at(6) },
        ]);
      });

      it("never mixes the sends of two prospects", async () => {
        const { store } = await withMario();
        const giulia = await store.save({
          profile: GIULIA,
          newMessages: [],
        });
        await store.linkMessages(giulia.prospect.id, CHAT, [2_001]);

        await store.recordSend({ ...best, messageId: 2_001 });

        expect((await store.load("mariofit"))?.contact.sends).toStrictEqual([]);
        expect((await store.load("giulia.bakery"))?.contact.sends).toHaveLength(
          1,
        );
      });

      it("loads the latest sends only", async () => {
        const { store, id } = await withMario();
        const messageIds = Array.from(
          { length: 12 },
          (_, index) => 1_100 + index,
        );
        await store.linkMessages(id, CHAT, messageIds);
        for (const messageId of messageIds) {
          await store.recordSend({
            ...best,
            messageId,
            text: String(messageId),
          });
        }

        const sends = (await store.load("mariofit"))?.contact.sends ?? [];
        expect(sends.map(({ text }) => text)).toStrictEqual(
          messageIds.slice(-10).map(String),
        );
      });
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
