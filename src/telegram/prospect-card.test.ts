import { describe, expect, it } from "vitest";

import { memoryOf } from "../prospects/memory.test-support.ts";
import type { ProspectMemory } from "../prospects/memory.ts";
import { telegramLength } from "./message-length.ts";
import { prospectCard } from "./prospect-card.ts";

const MEMORY: ProspectMemory = memoryOf({
  prospect: {
    id: "prospect-1",
    username: "mariofit",
    displayName: "Mario",
    businessType: "personal <trainer>",
    facts: ["La bio invita a scrivere START in DM."],
    hypotheses: ["Gestire i DM a mano gli fa perdere contatti."],
    conversation: {
      stage: "ENGAGED",
      intent: "PRICE_REQUEST",
      interest: "MEDIUM",
      nextGoal: "UNDERSTAND_PROCESS",
    },
    summary: "Ha chiesto il prezzo di un sito.",
    objections: ["Il prezzo gli sembra alto."],
    commitments: [{ by: "ALEX", text: "Mandare un esempio." }],
    createdAt: new Date("2026-09-20T10:00:00Z"),
    updatedAt: new Date("2026-09-24T22:30:00Z"),
  },
  messages: [
    { author: "PROSPECT", text: "Quanto costa?" },
    { author: "ALEX", text: "Dipende: cosa ti serve?" },
  ],
});

const HISTORY = [
  { from: null, to: "OPENING", at: new Date("2026-09-20T10:00:00Z") },
  { from: "OPENING", to: "ENGAGED", at: new Date("2026-09-22T23:30:00Z") },
] as const;

describe("prospectCard", () => {
  it("shows what the bot remembers about the prospect", () => {
    expect(prospectCard(MEMORY, HISTORY, null)).toBe(
      [
        "🔍 <b>@mariofit</b> · personal &lt;trainer&gt;",
        "<b>Stage</b> ENGAGED · <b>Intent</b> PRICE_REQUEST · <b>Interesse</b> MEDIUM",
        "🎯 <b>Obiettivo</b> UNDERSTAND_PROCESS",
        // Dates in Italian time: the last update was on the 25th there.
        "💬 2 messaggi in memoria · 1 tuo senza risposta · aggiornato il 25/09/2026",
        "",
        "<b>Riassunto</b>",
        "Ha chiesto il prezzo di un sito.",
        "",
        "<b>Obiezioni aperte</b>",
        "• Il prezzo gli sembra alto.",
        "",
        "<b>Promesse</b>",
        "• Tu: Mandare un esempio.",
        "",
        "<b>Cosa so</b>",
        "• La bio invita a scrivere START in DM.",
        "",
        "<b>Ipotesi da verificare</b>",
        "• Gestire i DM a mano gli fa perdere contatti.",
        "",
        "<b>Storia</b>",
        "• 20/09 inizio → OPENING",
        "• 23/09 OPENING → ENGAGED",
      ].join("\n"),
    );
  });

  it("says why Alex should not write, and when there is only a profile", () => {
    const card = prospectCard(
      memoryOf({
        prospect: { ...MEMORY.prospect, conversation: null },
        messages: [],
      }),
      [],
      "DO_NOT_CONTACT",
    );

    expect(card).toContain(
      "👤 Solo profilo: nessuna conversazione in memoria.",
    );
    expect(card).toContain("🔒 Ha chiesto di non ricevere altri messaggi");
    expect(card).toContain("💬 0 messaggi in memoria · aggiornato il");
    expect(card).not.toContain("Storia");
  });

  it("fits in one message, leaving out the history first", () => {
    const long = (text: string) =>
      Array.from({ length: 5 }, () => `${text} ${"x".repeat(700)}`);
    const card = prospectCard(
      {
        ...MEMORY,
        prospect: {
          ...MEMORY.prospect,
          facts: long("fatto"),
          hypotheses: long("ipotesi"),
        },
      },
      HISTORY,
      null,
    );

    expect(telegramLength(card)).toBeLessThanOrEqual(4_096);
    expect(card).not.toContain("Storia");
    expect(card).toContain("<b>Stage</b> ENGAGED");
  });
});
