import { describe, expect, it } from "vitest";

import type {
  ConversationAnalysis,
  ConversationReply,
  ScreenshotsAnalysis,
} from "../ai/outputs.ts";
import {
  aiProblemReply,
  conversationAnswer,
  escapeHtml,
  memoryLine,
  pauseMessage,
  plainMessage,
  screenshotsAnswer,
} from "./suggestions.ts";
import { telegramLength } from "./message-length.ts";

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

const conversation: ScreenshotsAnalysis = {
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
};

const reply: ConversationReply = {
  messages: [],
  facts: [],
  hypotheses: [],
  analysis,
  objections: [],
  commitments: [],
  summary: null,
  suggestions: [{ style: "BEST", text: "Dipende: cosa ti serve?" }],
  note: null,
};

describe("escapeHtml", () => {
  it("escapes the characters Telegram HTML reserves", () => {
    expect(escapeHtml("<b>Tom & Jerry</b>")).toBe(
      "&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;",
    );
  });

  it("makes plain messages without buttons", () => {
    expect(plainMessage("1 < 2")).toStrictEqual({
      html: "1 &lt; 2",
      keyboard: null,
    });
  });
});

describe("screenshotsAnswer", () => {
  it("opens a profile on the first messages, with the analysis folded below", () => {
    const { html, keyboard } = screenshotsAnswer(
      profile,
      { type: "CREATED" },
      null,
    );

    expect(html).toBe(
      [
        "👤 <b>@mariofit</b> · personal trainer",
        "",
        "🔥 <b>BEST</b>",
        "<pre>Ciao Mario, quanti START ricevi?</pre>",
        "",
        "👀 <b>CURIOSITY</b>",
        "<pre>Lo segui tu uno a uno?</pre>",
        "",
        "🙂 <b>NATURAL</b>",
        "<pre>Bello il format START!</pre>",
        "",
        [
          "<blockquote expandable>🔍 <b>Analisi</b>",
          "🧠 Nuovo prospect: l'ho salvato in memoria.",
          "",
          "<b>Cosa ho visto</b>",
          "• La bio invita a scrivere START in DM.",
          "",
          "<b>Ipotesi da verificare</b>",
          "• Gestire i DM a mano potrebbe richiedere tempo.</blockquote>",
        ].join("\n"),
      ].join("\n"),
    );
    expect(keyboard).toStrictEqual([
      [
        {
          type: "COPY",
          label: "📋 Copia BEST",
          text: "Ciao Mario, quanti START ricevi?",
          primary: true,
        },
      ],
      [
        {
          type: "COPY",
          label: "📋 CURIOSITY",
          text: "Lo segui tu uno a uno?",
          primary: false,
        },
        {
          type: "COPY",
          label: "📋 NATURAL",
          text: "Bello il format START!",
          primary: false,
        },
      ],
    ]);
  });

  it("escapes what the prospect and the model wrote, but copies it as written", () => {
    const { html, keyboard } = screenshotsAnswer(
      {
        ...profile,
        prospect: { ...prospect, businessType: "bar & <bistrot>" },
        facts: ["Link in bio: <a href=x>menu</a>"],
        suggestions: [{ style: "BEST", text: "Ciao </pre><b>Mario</b>" }],
      },
      null,
      null,
    );

    expect(html).toContain("bar &amp; &lt;bistrot&gt;");
    expect(html).toContain("&lt;a href=x&gt;menu&lt;/a&gt;");
    expect(html).toContain(
      "<pre>Ciao &lt;/pre&gt;&lt;b&gt;Mario&lt;/b&gt;</pre>",
    );
    expect(keyboard?.[0]?.[0]).toMatchObject({
      text: "Ciao </pre><b>Mario</b>",
    });
  });

  it("presents a conversation with the message it answers and its analysis", () => {
    const { html, keyboard } = screenshotsAnswer(
      conversation,
      { type: "UPDATED", knownMessages: 3 },
      null,
    );

    expect(html).toBe(
      [
        "💬 <b>@mariofit</b> · personal trainer",
        "↩️ «Quanto costa un sito?»",
        "",
        "🔥 <b>BEST</b>",
        "<pre>Dipende: cosa ti serve?</pre>",
        "",
        "👀 <b>ALTERNATIVE</b>",
        "<pre>Come lavori oggi?</pre>",
        "",
        "🎯 <b>DIRECT</b>",
        "<pre>Da 800 €.</pre>",
        "",
        [
          "<blockquote expandable>🔍 <b>Analisi</b>",
          "<b>Stage</b> ENGAGED · <b>Intent</b> PRICE_REQUEST · <b>Interesse</b> MEDIUM",
          "🎯 <b>Obiettivo</b> UNDERSTAND_PROCESS: Chiede il prezzo senza contesto.",
          "🧠 Già in memoria: ho tenuto conto di 3 messaggi precedenti.</blockquote>",
        ].join("\n"),
      ].join("\n"),
    );
    expect(
      keyboard?.map((row) => row.map((button) => button.label)),
    ).toStrictEqual([["📋 Copia BEST"], ["📋 ALTERNATIVE", "📋 DIRECT"]]);
  });

  it("names the conversation when the username is not visible", () => {
    const { html } = screenshotsAnswer(
      {
        ...conversation,
        prospect: { username: null, displayName: null, businessType: null },
      },
      { type: "NOT_SAVED", reason: "NO_USERNAME" },
      null,
    );

    expect(html.split("\n").slice(0, 2)).toStrictEqual([
      "💬 <b>Conversazione</b>",
      memoryLine({ type: "NOT_SAVED", reason: "NO_USERNAME" }),
    ]);
  });

  it("shortens the quoted message of the prospect", () => {
    const { html } = screenshotsAnswer(
      {
        ...conversation,
        analysis: { ...analysis, lastProspectMessage: "a".repeat(200) },
      },
      null,
      null,
    );

    expect(html).toContain(`↩️ «${"a".repeat(120)}…»`);
  });

  it("says so when no message should be sent, with the reason in sight", () => {
    const { html, keyboard } = screenshotsAnswer(
      {
        ...conversation,
        analysis: { ...analysis, intent: "DO_NOT_CONTACT" },
        suggestions: [],
        note: "Ha chiesto di non essere contattato.",
      },
      null,
      null,
    );

    expect(html).toContain(
      "🚫 Nessun messaggio suggerito.\n\n📝 Ha chiesto di non essere contattato.",
    );
    expect(html.match(/📝/g)).toHaveLength(1);
    expect(keyboard).toBeNull();
  });

  it("shows why it suggests nothing, in place of the suggestions", () => {
    const { html, keyboard } = screenshotsAnswer(
      profile,
      null,
      "FOLLOW_UP_LIMIT",
    );

    expect(html).toContain(pauseMessage("FOLLOW_UP_LIMIT"));
    expect(html).not.toContain("<pre>");
    expect(keyboard).toBeNull();
  });

  it("shows the open objections and promises of a conversation", () => {
    const { html } = screenshotsAnswer(
      {
        ...conversation,
        objections: ["Il prezzo <alto>"],
        commitments: [
          { by: "ALEX", text: "Mandare un esempio" },
          { by: "PROSPECT", text: "Farti sapere venerdì" },
        ],
      },
      null,
      null,
    );

    expect(html).toContain("<b>Obiezioni aperte</b>\n• Il prezzo &lt;alto&gt;");
    expect(html).toContain(
      "<b>Promesse</b>\n• Tu: Mandare un esempio\n• Prospect: Farti sapere venerdì",
    );
  });

  it("shows at most five facts", () => {
    const { html } = screenshotsAnswer(
      { ...profile, facts: ["1", "2", "3", "4", "5", "6"], hypotheses: [] },
      null,
      null,
    );

    expect(html.match(/^• /gm)).toHaveLength(5);
    expect(html).not.toContain("• 6");
  });

  it("keeps suggestions too long to copy, without their button", () => {
    const long = "x".repeat(257);
    const { html, keyboard } = screenshotsAnswer(
      {
        ...profile,
        suggestions: [
          { style: "BEST", text: long },
          { style: "CURIOSITY", text: "y".repeat(256) },
        ],
      },
      null,
      null,
    );

    expect(html).toContain(
      `<pre>${long}</pre>\n✂️ Troppo lungo per il tasto Copia: tieni premuto il testo qui sopra per copiarlo.`,
    );
    expect(keyboard).toStrictEqual([
      [
        {
          type: "COPY",
          label: "📋 CURIOSITY",
          text: "y".repeat(256),
          primary: false,
        },
      ],
    ]);
  });

  it("leaves out the details that do not fit in one message", () => {
    const many = (text: string) =>
      Array.from(
        { length: 5 },
        (_, index) => `${text} ${String(index)} ${"<".repeat(300)}`,
      );
    const suggestion = "&".repeat(1_000);
    const { html } = screenshotsAnswer(
      {
        ...conversation,
        facts: many("fatto"),
        hypotheses: many("ipotesi"),
        objections: many("obiezione"),
        suggestions: [
          { style: "BEST", text: suggestion },
          { style: "ALTERNATIVE", text: suggestion },
          { style: "DIRECT", text: suggestion },
        ],
        note: "n".repeat(500),
      },
      { type: "CREATED" },
      null,
    );

    expect(telegramLength(html)).toBeLessThanOrEqual(4_096);
    expect(html.match(/<pre>/g)).toHaveLength(3);
    expect(html).not.toContain("Ipotesi da verificare");
    expect(html).toContain("<b>Stage</b> ENGAGED");
  });

  it("explains screenshots that are neither profiles nor conversations", () => {
    expect(
      screenshotsAnswer(
        { kind: "UNRELATED", note: "È un tramonto." },
        null,
        null,
      ),
    ).toStrictEqual({
      html: "🤔 Non sembra un profilo o una conversazione di Instagram.\n\n📝 È un tramonto.",
      keyboard: null,
    });
  });
});

describe("conversationAnswer", () => {
  it("names the prospect Alex pointed to", () => {
    const { html, keyboard } = conversationAnswer(
      reply,
      "mariofit",
      { type: "UPDATED", knownMessages: 2 },
      null,
    );

    expect(
      html.startsWith("💬 <b>@mariofit</b>\n↩️ «Quanto costa un sito?»"),
    ).toBe(true);
    expect(html).toContain("<b>Intent</b> PRICE_REQUEST");
    expect(html).toContain("<pre>Dipende: cosa ti serve?</pre>");
    expect(keyboard).toHaveLength(1);
  });

  it("shows first that it does not know whose conversation it is", () => {
    const { html } = conversationAnswer(
      reply,
      null,
      { type: "NOT_SAVED", reason: "NO_PROSPECT" },
      null,
    );

    expect(html.split("\n").slice(0, 2)).toStrictEqual([
      "💬 <b>Conversazione</b>",
      memoryLine({ type: "NOT_SAVED", reason: "NO_PROSPECT" }),
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

describe("pauseMessage", () => {
  it.each([
    ["DO_NOT_CONTACT", "non ricevere altri messaggi"],
    ["CLOSED", "saluto finale"],
    ["FOLLOW_UP_LIMIT", "2 follow-up senza risposta"],
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
