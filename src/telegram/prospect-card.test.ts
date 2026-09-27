import { describe, expect, it } from "vitest";

import { memoryOf } from "../prospects/memory.test-support.ts";
import type { ProspectMemory } from "../prospects/memory.ts";
import { telegramLength } from "./message-length.ts";
import { profileLink, prospectCard } from "./prospect-card.ts";
import type { Presented } from "./suggestions.ts";

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

const ENGAGED_READING = {
  stage: "ENGAGED",
  intent: "PRICE_REQUEST",
  interest: "MEDIUM",
  nextGoal: "UNDERSTAND_PROCESS",
} as const;

const HISTORY = [
  { from: null, to: "OPENING", at: new Date("2026-09-20T10:00:00Z") },
  { from: "OPENING", to: "ENGAGED", at: new Date("2026-09-22T23:30:00Z") },
] as const;

// Sunday 27 September, 10:00 in Italy.
const NOW = new Date("2026-09-27T08:00:00Z");

const labels = (card: Presented) =>
  card.keyboard?.map((row) => row.map((button) => button.label)) ?? null;

describe("prospectCard", () => {
  it("shows what the bot remembers and what to do next", () => {
    const card = prospectCard(MEMORY, HISTORY, NOW);

    expect(card.html).toBe(
      [
        '🔍 <b><a href="https://www.instagram.com/mariofit/">@mariofit</a></b> · personal &lt;trainer&gt;',
        "<b>Stage</b> ENGAGED · <b>Intent</b> PRICE_REQUEST · <b>Interesse</b> MEDIUM",
        "🎯 <b>Obiettivo</b> UNDERSTAND_PROCESS",
        // Dates in Italian time: the last messages were seen on the 25th.
        "🕐 <b>Ultimo contatto</b> 2 giorni fa · messaggio tuo",
        "⏳ Aspetti la sua risposta · follow-up inviati: 0 di 2 · il prossimo da domani",
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
    expect(card.keyboard).toStrictEqual([
      [{ type: "CALLBACK", label: "✅ Già scritto", data: "1:ok:U" }],
    ]);
  });

  it("offers the follow-up once it is due", () => {
    const card = prospectCard(
      MEMORY,
      HISTORY,
      new Date("2026-09-28T08:00:00Z"),
    );

    expect(card.html).toContain(
      "⏰ Follow-up da fare: il 1° di 2 (il tuo ultimo messaggio: 3 giorni fa).",
    );
    expect(labels(card)).toStrictEqual([
      ["💬 Proponi follow-up", "✅ Già scritto"],
    ]);
  });

  it("gives Alex the turn when the prospect wrote last", () => {
    const card = prospectCard(
      memoryOf({
        ...MEMORY,
        messages: [
          ...MEMORY.messages,
          { author: "PROSPECT", text: "Ok, e poi?" },
        ],
      }),
      [],
      NOW,
    );

    expect(card.html).toContain(
      "🕐 <b>Ultimo contatto</b> 2 giorni fa · messaggio suo",
    );
    expect(card.html).toContain("🔥 Tocca a te: aspetta una tua risposta.");
    expect(card.keyboard).toStrictEqual([
      [
        { type: "CALLBACK", label: "↩️ Proponi risposte", data: "1:w:R" },
        { type: "CALLBACK", label: "✅ Già risposto", data: "1:ok:R" },
      ],
    ]);
  });

  it("offers the first messages for a profile not contacted yet", () => {
    const card = prospectCard(
      memoryOf({
        prospect: { ...MEMORY.prospect, conversation: null },
        messages: [],
      }),
      [],
      NOW,
    );

    expect(card.html).toContain(
      "👤 Solo profilo: nessuna conversazione in memoria.",
    );
    expect(card.html).toContain("🕐 Nessun contatto registrato.");
    expect(card.html).toContain("👤 Da contattare:");
    expect(card.html).toContain("💬 0 messaggi in memoria · aggiornato il");
    expect(card.html).not.toContain("Storia");
    expect(labels(card)).toStrictEqual([
      ["✍️ Proponi primi messaggi", "✅ Già scritto"],
    ]);
  });

  it("says why Alex should not write, without buttons", () => {
    const card = prospectCard(
      memoryOf({
        ...MEMORY,
        prospect: {
          ...MEMORY.prospect,
          conversation: { ...ENGAGED_READING, stage: "DO_NOT_CONTACT" },
        },
      }),
      [],
      NOW,
    );

    expect(card.html).toContain("🔒 Ha chiesto di non ricevere altri messaggi");
    expect(card.keyboard).toBeNull();
  });

  it("fits in one message, leaving out the history first", () => {
    const long = (text: string) =>
      Array.from({ length: 5 }, () => `${text} ${"x".repeat(700)}`);
    const { html } = prospectCard(
      {
        ...MEMORY,
        prospect: {
          ...MEMORY.prospect,
          facts: long("fatto"),
          hypotheses: long("ipotesi"),
        },
      },
      HISTORY,
      NOW,
    );

    expect(telegramLength(html)).toBeLessThanOrEqual(4_096);
    expect(html).not.toContain("Storia");
    expect(html).toContain("<b>Stage</b> ENGAGED");
  });
});

describe("profileLink", () => {
  it("links the username to the Instagram profile", () => {
    expect(profileLink("giulia.bakery")).toBe(
      '<a href="https://www.instagram.com/giulia.bakery/">@giulia.bakery</a>',
    );
  });
});
