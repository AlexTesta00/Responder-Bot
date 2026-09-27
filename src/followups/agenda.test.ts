import { describe, expect, it } from "vitest";

import { pauseOf } from "../copilot/memory.ts";
import type {
  ConversationIntent,
  ConversationMessage,
  ConversationStage,
  InterestLevel,
} from "../conversations/domain.ts";
import {
  overviewOf,
  type ProspectMemory,
  type Send,
} from "../prospects/memory.ts";
import { memoryOf } from "../prospects/memory.test-support.ts";
import { agendaOf, firstOf, type Agenda } from "./agenda.ts";
import { situationOfMemory } from "./situation.ts";

// Sunday 27 September, 10:00 in Italy.
const NOW = new Date("2026-09-27T08:00:00Z");

const daysAgo = (days: number): Date =>
  new Date(NOW.getTime() - days * 86_400_000);

const alex = (text: string): ConversationMessage => ({ author: "ALEX", text });
const them = (text: string): ConversationMessage => ({
  author: "PROSPECT",
  text,
});

type Fixture = Readonly<{
  stage?: ConversationStage;
  intent?: ConversationIntent;
  interest?: InterestLevel;
  /** Null for a prospect only seen in the profile. */
  messages?: readonly ConversationMessage[] | null;
  /** When the latest analysis stored the messages. */
  analyzed?: number;
  sends?: readonly Send[];
}>;

/** A prospect's memory, with every message stored `analyzed` days ago. */
const memory = (
  username: string,
  {
    stage = "ENGAGED",
    intent = "INTERESTED",
    interest = "MEDIUM",
    messages = [them("Quanto costa?")],
    analyzed = 1,
    sends = [],
  }: Fixture = {},
): ProspectMemory =>
  memoryOf(
    {
      prospect: {
        id: `id-${username}`,
        username,
        displayName: null,
        businessType: null,
        facts: [],
        hypotheses: [],
        conversation:
          messages === null
            ? null
            : { stage, intent, interest, nextGoal: "UNDERSTAND_PROCESS" },
        summary: null,
        objections: [],
        commitments: [],
        createdAt: daysAgo(30),
        updatedAt: daysAgo(analyzed),
      },
      messages: messages ?? [],
    },
    sends,
  );

const agenda = (...memories: readonly ProspectMemory[]): Agenda =>
  agendaOf(memories.map(overviewOf), NOW);

const names = (entries: Agenda[keyof Agenda]): readonly string[] =>
  entries.map(({ prospect }) => prospect.username);

/** Alex wrote last, `days` days ago, and `unanswered` times in a row. */
const waited = (days: number, unanswered = 1): Fixture => ({
  messages: [
    them("Ci penso"),
    ...Array.from({ length: unanswered }, () => alex("Ok!")),
  ],
  analyzed: days,
});

describe("agendaOf", () => {
  it("puts every prospect in the one section its situation calls for", () => {
    const sections = agenda(
      memory("da.rispondere"),
      memory("da.seguire", waited(4)),
      memory("in.attesa", waited(1)),
      memory("nuovo", { messages: null }),
      memory("fermo", { stage: "DO_NOT_CONTACT", intent: "DO_NOT_CONTACT" }),
      memory("cliente", { stage: "WON", ...waited(10) }),
    );

    expect(
      Object.fromEntries(
        Object.entries(sections).map(([section, entries]) => [
          section,
          names(entries),
        ]),
      ),
    ).toStrictEqual({
      reply: ["da.rispondere"],
      followUp: ["da.seguire"],
      waiting: ["in.attesa"],
      toContact: ["nuovo"],
      paused: ["fermo"],
      won: ["cliente"],
    });
  });

  it("lists nothing for nobody", () => {
    expect(agenda()).toStrictEqual({
      reply: [],
      followUp: [],
      waiting: [],
      toContact: [],
      paused: [],
      won: [],
    });
  });

  it("answers the hottest first, then the most interested, then the latest", () => {
    const { reply } = agenda(
      memory("tiepido", { interest: "MEDIUM", analyzed: 1 }),
      memory("caldo.vecchio", {
        intent: "PRICE_REQUEST",
        interest: "LOW",
        analyzed: 10,
      }),
      memory("interessato", { interest: "HIGH", analyzed: 5 }),
      memory("caldo", {
        intent: "READY_FOR_CALL",
        interest: "LOW",
        analyzed: 2,
      }),
      memory("recente", { intent: "NEUTRAL", analyzed: 0 }),
      memory("ignoto", { interest: "UNKNOWN", analyzed: 0 }),
    );

    // Old chats come last, without disappearing.
    expect(names(reply)).toStrictEqual([
      "caldo",
      "caldo.vecchio",
      "interessato",
      "recente",
      "tiepido",
      "ignoto",
    ]);
  });

  it("follows up the longest overdue first, then the most interested", () => {
    const { followUp } = agenda(
      memory("oggi", waited(3)),
      memory("dieci.giorni", waited(10)),
      memory("dieci.giorni.hot", { interest: "HIGH", ...waited(10) }),
      // The second follow-up waits 5 days: due since yesterday.
      memory("secondo", waited(6, 2)),
      memory("occupato", { intent: "BUSY", ...waited(9) }),
    );

    expect(names(followUp)).toStrictEqual([
      "dieci.giorni.hot",
      "dieci.giorni",
      "occupato",
      "secondo",
      "oggi",
    ]);
    expect(followUp.map(({ situation }) => situation.number)).toStrictEqual([
      1, 1, 1, 2, 1,
    ]);
  });

  it("waits for the follow-ups due soonest first", () => {
    const { waiting } = agenda(
      memory("ieri", waited(1)),
      memory("oggi", waited(0)),
      memory("secondo", waited(2, 2)),
      memory("occupato", { stage: "BUSY", ...waited(2) }),
    );

    expect(names(waiting)).toStrictEqual([
      "ieri",
      "oggi",
      "secondo",
      "occupato",
    ]);
  });

  it("contacts the latest analyzed profiles first", () => {
    const { toContact } = agenda(
      memory("vecchio", { messages: null, analyzed: 9 }),
      memory("nuovo", { messages: null, analyzed: 0 }),
      memory("ieri", { messages: null, analyzed: 1 }),
    );

    expect(names(toContact)).toStrictEqual(["nuovo", "ieri", "vecchio"]);
  });

  it("counts what Alex marked as sent, like the card", () => {
    const sent = (days: number): Send => ({
      kind: "FIRST_MESSAGES",
      style: "BEST",
      text: "Ciao!",
      sentAt: daysAgo(days),
    });

    const sections = agenda(
      memory("scritto", { messages: null, analyzed: 5, sends: [sent(4)] }),
      memory("scritto.ieri", { messages: null, analyzed: 5, sends: [sent(1)] }),
    );

    expect(names(sections.toContact)).toStrictEqual([]);
    expect(names(sections.followUp)).toStrictEqual(["scritto"]);
    expect(names(sections.waiting)).toStrictEqual(["scritto.ieri"]);
  });

  it("keeps the paused and the clients, the latest activity first", () => {
    const sections = agenda(
      memory("chiuso", { stage: "NOT_INTERESTED", ...waited(9) }),
      memory("limite", waited(2, 3)),
      memory("cliente.vecchio", { stage: "WON", ...waited(20) }),
      memory("cliente", { stage: "WON", ...waited(3) }),
    );

    expect(names(sections.paused)).toStrictEqual(["limite", "chiuso"]);
    expect(
      sections.paused.map(({ situation }) => situation.pause),
    ).toStrictEqual(["FOLLOW_UP_LIMIT", "CLOSED"]);
    expect(names(sections.won)).toStrictEqual(["cliente", "cliente.vecchio"]);
  });

  it("shows each prospect in the situation of its card, paused as the rules say", () => {
    const memories = [
      memory("da.rispondere"),
      memory("da.seguire", waited(4)),
      memory("in.attesa", waited(1, 2)),
      memory("nuovo", { messages: null }),
      memory("fermo", { stage: "DO_NOT_CONTACT", intent: "DO_NOT_CONTACT" }),
      memory("limite", waited(2, 3)),
      memory("cliente", { stage: "WON", ...waited(10) }),
    ];

    const entries = Object.values(agenda(...memories)).flat();

    expect(entries).toHaveLength(memories.length);
    for (const remembered of memories) {
      const entry = entries.find(
        ({ prospect }) => prospect.id === remembered.prospect.id,
      );
      const situation = situationOfMemory(remembered, NOW);
      expect(entry?.situation).toStrictEqual(situation);
      expect(situation.type === "PAUSED" ? situation.pause : null).toBe(
        pauseOf(remembered),
      );
    }
  });
});

describe("firstOf", () => {
  it("shows the first entries and counts the others", () => {
    expect(firstOf(["a", "b", "c"], 2)).toStrictEqual({
      shown: ["a", "b"],
      more: 1,
    });
    expect(firstOf(["a"], 5)).toStrictEqual({ shown: ["a"], more: 0 });
  });
});
