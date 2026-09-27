import { describe, expect, it } from "vitest";

import { memoryOf } from "./memory.test-support.ts";
import type { ConversationMessage } from "../conversations/domain.ts";
import {
  messagesToAppend,
  remember,
  type Observation,
  type ProspectMemory,
} from "./memory.ts";

const alex = (text: string): ConversationMessage => ({ author: "ALEX", text });
const prospect = (text: string): ConversationMessage => ({
  author: "PROSPECT",
  text,
});

const CHAT = [
  alex("Ciao Mario, bello il format START!"),
  prospect("Grazie! Lo gestisco tutto in DM"),
  alex("Quanti START ricevi a settimana?"),
  prospect("Una trentina, a volte perdo i messaggi"),
];

const OBSERVATION: Observation = {
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
  summary: "Personal trainer, riceve una trentina di START a settimana.",
  objections: null,
  commitments: null,
  messages: CHAT,
};

const MEMORY: ProspectMemory = memoryOf({
  prospect: {
    id: "prospect-1",
    username: "mariofit",
    displayName: "Mario",
    businessType: "coach",
    facts: ["Ha un link a WhatsApp in bio."],
    hypotheses: ["Potrebbe volere un sito."],
    conversation: {
      stage: "OPENING",
      intent: "NEUTRAL",
      interest: "UNKNOWN",
      nextGoal: "GET_REPLY",
    },
    summary: "Primo messaggio inviato.",
    objections: ["Il prezzo gli sembra alto."],
    commitments: [{ by: "ALEX", text: "Mandare un esempio di sito." }],
    createdAt: new Date("2026-09-20T10:00:00Z"),
    updatedAt: new Date("2026-09-20T10:00:00Z"),
  },
  messages: CHAT.slice(0, 2),
});

describe("messagesToAppend", () => {
  it("adds every message of a new conversation", () => {
    expect(messagesToAppend([], CHAT)).toStrictEqual(CHAT);
  });

  it("adds only what follows the stored messages", () => {
    expect(messagesToAppend(CHAT.slice(0, 3), CHAT.slice(1))).toStrictEqual(
      CHAT.slice(3),
    );
  });

  it("adds nothing when the same screenshot comes again", () => {
    expect(messagesToAppend(CHAT, CHAT.slice(2))).toStrictEqual([]);
    expect(messagesToAppend(CHAT, CHAT.slice(1, 3))).toStrictEqual([]);
  });

  it("adds nothing for an older part of the chat", () => {
    const older = [alex("Ciao! Ti seguo da un po'"), ...CHAT.slice(0, 2)];

    expect(messagesToAppend(CHAT.slice(1), older)).toStrictEqual([]);
  });

  it("recognizes messages transcribed with other spacing or case", () => {
    expect(
      messagesToAppend(CHAT.slice(0, 2), [
        prospect("grazie!  Lo gestisco tutto in DM "),
        alex("Quanti START ricevi a settimana?"),
      ]),
    ).toStrictEqual([alex("Quanti START ricevi a settimana?")]);
  });

  it("keeps new messages that repeat an earlier greeting", () => {
    const stored = [alex("Ciao"), prospect("Ciao")];
    const seen = [prospect("Ciao"), alex("Ciao"), prospect("Mi dici?")];

    expect(messagesToAppend(stored, seen)).toStrictEqual([
      alex("Ciao"),
      prospect("Mi dici?"),
    ]);
  });

  it("does not confuse the authors of the same words", () => {
    expect(messagesToAppend([alex("Ok")], [prospect("Ok")])).toStrictEqual([
      prospect("Ok"),
    ]);
  });
});

describe("remember", () => {
  it("creates the memory of a new prospect", () => {
    expect(remember("mariofit", null, OBSERVATION)).toStrictEqual({
      profile: {
        username: "mariofit",
        displayName: "Mario Rossi",
        businessType: "personal trainer",
        facts: OBSERVATION.facts,
        hypotheses: OBSERVATION.hypotheses,
        conversation: OBSERVATION.conversation,
        summary: OBSERVATION.summary,
        objections: [],
        commitments: [],
      },
      newMessages: CHAT,
    });
  });

  it("updates what was observed again and keeps the rest", () => {
    const update = remember("mariofit", MEMORY, {
      ...OBSERVATION,
      displayName: null,
      businessType: " ",
      conversation: null,
      summary: null,
    });

    expect(update.profile).toMatchObject({
      displayName: "Mario",
      businessType: "coach",
      conversation: MEMORY.prospect.conversation,
      summary: "Primo messaggio inviato.",
    });
    expect(update.newMessages).toStrictEqual(CHAT.slice(2));
  });

  it("puts the latest facts first and drops repetitions", () => {
    const update = remember("mariofit", MEMORY, {
      ...OBSERVATION,
      facts: ["Ha un link a WhatsApp in bio.", "Pubblica ogni giorno."],
    });

    expect(update.profile.facts).toStrictEqual([
      "Ha un link a WhatsApp in bio.",
      "Pubblica ogni giorno.",
    ]);
    expect(update.profile.hypotheses).toStrictEqual([
      "Gestire i DM a mano gli fa perdere contatti.",
      "Potrebbe volere un sito.",
    ]);
  });

  it("keeps objections and promises when the analysis cannot tell", () => {
    const update = remember("mariofit", MEMORY, OBSERVATION);

    expect(update.profile.objections).toStrictEqual(MEMORY.prospect.objections);
    expect(update.profile.commitments).toStrictEqual(
      MEMORY.prospect.commitments,
    );
  });

  it("replaces them with the ones still open", () => {
    const update = remember("mariofit", MEMORY, {
      ...OBSERVATION,
      objections: [],
      commitments: [
        { by: "PROSPECT", text: "Mi fa sapere dopo le vacanze." },
        { by: "PROSPECT", text: " mi fa sapere  dopo le vacanze. " },
        { by: "ALEX", text: "  " },
      ],
    });

    expect(update.profile.objections).toStrictEqual([]);
    expect(update.profile.commitments).toStrictEqual([
      { by: "PROSPECT", text: "Mi fa sapere dopo le vacanze." },
    ]);
  });

  it("keeps notes, names and messages within the database limits", () => {
    const update = remember("mariofit", null, {
      ...OBSERVATION,
      displayName: "💪".repeat(150),
      facts: Array.from({ length: 20 }, (_, index) => `Fatto ${String(index)}`),
      messages: [alex("x".repeat(3_000)), prospect("   ")],
    });

    expect(Array.from(update.profile.displayName ?? "")).toHaveLength(100);
    expect(update.profile.facts).toHaveLength(12);
    expect(update.newMessages).toStrictEqual([alex("x".repeat(2_000))]);
  });
});
