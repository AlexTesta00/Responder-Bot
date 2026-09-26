import { describe, expect, it } from "vitest";

import type {
  ConversationAnalysis,
  ScreenshotsAnalysis,
} from "../ai/outputs.ts";
import {
  aiProblemReply,
  conversationMessages,
  escapeHtml,
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
    const [summary, suggestions] = screenshotsMessages(profile);

    expect(summary).toBe(
      [
        "👤 <b>Profilo</b> · @mariofit · personal trainer",
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
    const [summary, suggestions] = screenshotsMessages({
      ...profile,
      prospect: { ...prospect, businessType: "bar & <bistrot>" },
      facts: ["Link in bio: <a href=x>menu</a>"],
      suggestions: [{ style: "BEST", text: "Ciao </pre><b>Mario</b>" }],
    });

    expect(summary).toContain("bar &amp; &lt;bistrot&gt;");
    expect(summary).toContain("&lt;a href=x&gt;menu&lt;/a&gt;");
    expect(suggestions).toContain(
      "<pre>Ciao &lt;/pre&gt;&lt;b&gt;Mario&lt;/b&gt;</pre>",
    );
  });

  it("presents a conversation with its analysis and replies", () => {
    const [summary, suggestions] = screenshotsMessages({
      kind: "CONVERSATION",
      prospect,
      facts: [],
      hypotheses: [],
      analysis,
      suggestions: [
        { style: "BEST", text: "Dipende: cosa ti serve?" },
        { style: "ALTERNATIVE", text: "Come lavori oggi?" },
        { style: "DIRECT", text: "Da 800 €." },
      ],
      note: null,
    });

    expect(summary).toBe(
      [
        "💬 <b>Conversazione</b> · @mariofit · personal trainer",
        "<b>Ultimo messaggio</b>: «Quanto costa un sito?»",
        "<b>Stage</b> ENGAGED · <b>Intent</b> PRICE_REQUEST · <b>Interesse</b> MEDIUM",
        "🎯 <b>Obiettivo</b> UNDERSTAND_PROCESS: Chiede il prezzo senza contesto.",
      ].join("\n"),
    );
    expect(suggestions).toContain("🎯 <b>DIRECT</b>\n<pre>Da 800 €.</pre>");
  });

  it("says so when no message should be sent", () => {
    const messages = screenshotsMessages({
      kind: "CONVERSATION",
      prospect,
      facts: [],
      hypotheses: [],
      analysis: { ...analysis, intent: "DO_NOT_CONTACT" },
      suggestions: [],
      note: "Ha chiesto di non essere contattato.",
    });

    expect(messages[0]).toContain("📝 Ha chiesto di non essere contattato.");
    expect(messages[1]).toBe("🚫 Nessun messaggio suggerito.");
  });

  it("shows at most five facts", () => {
    const [summary] = screenshotsMessages({
      ...profile,
      facts: ["1", "2", "3", "4", "5", "6"],
    });

    expect(summary?.match(/^• /gm)).toHaveLength(6);
    expect(summary).not.toContain("• 6");
  });

  it("explains screenshots that are neither profiles nor conversations", () => {
    expect(
      screenshotsMessages({ kind: "UNRELATED", note: "È un tramonto." }),
    ).toStrictEqual([
      "🤔 Non sembra un profilo o una conversazione di Instagram.\n\n📝 È un tramonto.",
    ]);
  });
});

describe("conversationMessages", () => {
  it("presents the analysis of a pasted conversation and the replies", () => {
    const [summary, suggestions] = conversationMessages({
      facts: [],
      hypotheses: [],
      analysis,
      suggestions: [{ style: "BEST", text: "Dipende: cosa ti serve?" }],
      note: null,
    });

    expect(summary).toContain("<b>Intent</b> PRICE_REQUEST");
    expect(suggestions).toContain("<pre>Dipende: cosa ti serve?</pre>");
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
