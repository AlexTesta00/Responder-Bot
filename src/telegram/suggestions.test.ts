import { describe, expect, it } from "vitest";

import type {
  ConversationAnalysis,
  ScreenshotsAnalysis,
} from "../ai/outputs.ts";
import {
  aiProblemReply,
  conversationMessages,
  escapeHtml,
  memoryLine,
  pauseMessage,
  screenshotsMessages,
} from "./suggestions.ts";

const prospect = {
  username: "mariofit",
  displayName: "Mario",
  businessType: "personal trainer",
};

const analysis: ConversationAnalysis = {
  lastProspectMessage: "Quanto costa un sito?",
  stage: "ENGAGED",
  intent: "PRICE_REQUEST",
  interest: "MEDIUM",
  nextGoal: "UNDERSTAND_PROCESS",
  rationale: "Chiede il prezzo senza contesto.",
};

const profile: ScreenshotsAnalysis = {
  kind: "PROFILE",
  prospect,
  facts: ["La bio invita a scrivere START in DM."],
  hypotheses: ["Gestire i DM a mano potrebbe richiedere tempo."],
  summary: null,
  suggestions: [
    { style: "BEST", text: "Ciao Mario, quanti START ricevi?" },
    { style: "CURIOSITY", text: "Lo segui tu uno a uno?" },
    { style: "NATURAL", text: "Bello il format START!" },
  ],
  note: null,
};

describe("escapeHtml", () => {
  it("escapes the characters Telegram HTML reserves", () => {
    expect(escapeHtml("<b>Tom & Jerry</b>")).toBe(
      "&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;",
    );
  });
});

describe("screenshotsMessages", () => {
  it("presents a profile, then the first messages to copy", () => {
    const [summary, suggestions] = screenshotsMessages(
      profile,
      { type: "CREATED" },
      null,
    );

    expect(summary).toBe(
      [
        "👤 <b>Profilo</b> · @mariofit · personal trainer",
        "🧠 Nuovo prospect: l'ho salvato in memoria.",
        "",
        "<b>Cosa ho visto</b>",
        "• La bio invita a scrivere START in DM.",
        "",
        "<b>Ipotesi da verificare</b>",
        "• Gestire i DM a mano potrebbe richiedere tempo.",
      ].join("\n"),
    );
    expect(suggestions).toBe(
      [
        "<b>Primi messaggi</b>",
        "",
        "🔥 <b>BEST</b>",
        "<pre>Ciao Mario, quanti START ricevi?</pre>",
        "",
        "👀 <b>CURIOSITY</b>",
        "<pre>Lo segui tu uno a uno?</pre>",
        "",
        "🙂 <b>NATURAL</b>",
        "<pre>Bello il format START!</pre>",
      ].join("\n"),
    );
  });

  it("escapes what the prospect and the model wrote", () => {
    const [summary, suggestions] = screenshotsMessages(
      {
        ...profile,
        prospect: { ...prospect, businessType: "bar & <bistrot>" },
        facts: ["Link in bio: <a href=x>menu</a>"],
        suggestions: [{ style: "BEST", text: "Ciao </pre><b>Mario</b>" }],
      },
      null,
      null,
    );

    expect(summary).toContain("bar &amp; &lt;bistrot&gt;");
    expect(summary).toContain("&lt;a href=x&gt;menu&lt;/a&gt;");
    expect(suggestions).toContain(
      "<pre>Ciao &lt;/pre&gt;&lt;b&gt;Mario&lt;/b&gt;</pre>",
    );
  });

  it("presents a conversation with its analysis and replies", () => {
    const [summary, suggestions] = screenshotsMessages(
      {
        kind: "CONVERSATION",
        prospect,
        messages: [],
        facts: [],
        hypotheses: [],
        summary: null,
        objections: [],
        commitments: [],
        analysis,
        suggestions: [
          { style: "BEST", text: "Dipende: cosa ti serve?" },
          { style: "ALTERNATIVE", text: "Come lavori oggi?" },
          { style: "DIRECT", text: "Da 800 €." },
        ],
        note: null,
      },
      { type: "UPDATED", knownMessages: 3 },
      null,
    );

    expect(summary).toBe(
      [
        "💬 <b>Conversazione</b> · @mariofit · personal trainer",
        "🧠 Già in memoria: ho tenuto conto di 3 messaggi precedenti.",
        "<b>Ultimo messaggio</b>: «Quanto costa un sito?»",
        "<b>Stage</b> ENGAGED · <b>Intent</b> PRICE_REQUEST · <b>Interesse</b> MEDIUM",
        "🎯 <b>Obiettivo</b> UNDERSTAND_PROCESS: Chiede il prezzo senza contesto.",
      ].join("\n"),
    );
    expect(suggestions).toContain("🎯 <b>DIRECT</b>\n<pre>Da 800 €.</pre>");
  });

  it("says so when no message should be sent", () => {
    const messages = screenshotsMessages(
      {
        kind: "CONVERSATION",
        prospect,
        messages: [],
        facts: [],
        hypotheses: [],
        summary: null,
        objections: [],
        commitments: [],
        analysis: { ...analysis, intent: "DO_NOT_CONTACT" },
        suggestions: [],
        note: "Ha chiesto di non essere contattato.",
      },
      null,
      null,
    );

    expect(messages[0]).toContain("📝 Ha chiesto di non essere contattato.");
    expect(messages[1]).toBe("🚫 Nessun messaggio suggerito.");
  });

  it("shows at most five facts", () => {
    const [summary] = screenshotsMessages(
      { ...profile, facts: ["1", "2", "3", "4", "5", "6"] },
      null,
      null,
    );

    expect(summary?.match(/^• /gm)).toHaveLength(6);
    expect(summary).not.toContain("• 6");
  });

  it("explains screenshots that are neither profiles nor conversations", () => {
    expect(
      screenshotsMessages(
        { kind: "UNRELATED", note: "È un tramonto." },
        null,
        null,
      ),
    ).toStrictEqual([
      "🤔 Non sembra un profilo o una conversazione di Instagram.\n\n📝 È un tramonto.",
    ]);
  });
});

describe("memoryLine", () => {
  it.each([
    [{ type: "CREATED" } as const, "Nuovo prospect"],
    [{ type: "UPDATED", knownMessages: 0 } as const, "dell'analisi precedente"],
    [{ type: "UPDATED", knownMessages: 1 } as const, "1 messaggio precedente"],
    [{ type: "NOT_SAVED", reason: "NO_PROSPECT" } as const, "@username"],
    [{ type: "NOT_SAVED", reason: "NO_USERNAME" } as const, "username"],
    [{ type: "NOT_SAVED", reason: "OTHER_PERSON" } as const, "chi sia"],
    [{ type: "NOT_SAVED", reason: "UNAVAILABLE" } as const, "non disponibile"],
  ])("explains %j", (memory, expected) => {
    expect(memoryLine(memory)).toContain(expected);
  });
});

describe("conversationMessages", () => {
  it("presents the analysis of a pasted conversation and the replies", () => {
    const [summary, suggestions] = conversationMessages(
      {
        messages: [],
        facts: [],
        hypotheses: [],
        analysis,
        objections: [],
        commitments: [],
        summary: null,
        suggestions: [{ style: "BEST", text: "Dipende: cosa ti serve?" }],
        note: null,
      },
      null,
      null,
    );

    expect(summary).toContain("<b>Intent</b> PRICE_REQUEST");
    expect(suggestions).toContain("<pre>Dipende: cosa ti serve?</pre>");
  });
});

describe("pauses and open points", () => {
  it("shows the open objections and promises of a conversation", () => {
    const [summary] = screenshotsMessages(
      {
        kind: "CONVERSATION",
        prospect,
        messages: [],
        facts: [],
        hypotheses: [],
        summary: null,
        objections: ["Il prezzo <alto>"],
        commitments: [
          { by: "ALEX", text: "Mandare un esempio" },
          { by: "PROSPECT", text: "Farti sapere venerdì" },
        ],
        analysis,
        suggestions: [{ style: "BEST", text: "Ecco l'esempio!" }],
        note: null,
      },
      null,
      null,
    );

    expect(summary).toContain(
      "<b>Obiezioni aperte</b>\n• Il prezzo &lt;alto&gt;",
    );
    expect(summary).toContain(
      "<b>Promesse</b>\n• Tu: Mandare un esempio\n• Prospect: Farti sapere venerdì",
    );
  });

  it("shows why it suggests nothing, in place of the suggestions", () => {
    const messages = screenshotsMessages(profile, null, "FOLLOW_UP_LIMIT");

    expect(messages[1]).toBe(pauseMessage("FOLLOW_UP_LIMIT"));
    expect(messages[1]).toContain("2 follow-up");
  });

  it.each([
    ["DO_NOT_CONTACT", "non ricevere altri messaggi"],
    ["CLOSED", "saluto finale"],
    ["FOLLOW_UP_LIMIT", "senza risposta"],
  ] as const)("explains the pause %s", (pause, expected) => {
    expect(pauseMessage(pause)).toContain(expected);
  });
});

describe("aiProblemReply", () => {
  it.each([
    [{ type: "REFUSED" } as const, "rifiutato"],
    [{ type: "TRUNCATED" } as const, "Riprova"],
    [{ type: "INVALID_OUTPUT", reason: "test" } as const, "Riprova"],
    [{ type: "UNAVAILABLE", status: 529 } as const, "non è raggiungibile"],
    [{ type: "REJECTED", status: 401 } as const, "API key"],
  ])("explains %j", (error, expected) => {
    expect(aiProblemReply(error)).toContain(expected);
  });
});
