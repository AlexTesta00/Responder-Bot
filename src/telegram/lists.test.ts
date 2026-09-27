import { describe, expect, it } from "vitest";

import {
  CONVERSATION_STAGES,
  type Commitment,
  type ConversationIntent,
  type ConversationMessage,
  type ConversationStage,
} from "../conversations/domain.ts";
import { agendaOf, type Agenda } from "../followups/agenda.ts";
import { overviewOf, type ProspectMemory } from "../prospects/memory.ts";
import { memoryOf } from "../prospects/memory.test-support.ts";
import { decodeButton } from "./button-data.ts";
import { fitsInMessage } from "./message-length.ts";
import {
  followUpsList,
  newProspectsList,
  prospectsList,
  todayList,
} from "./lists.ts";

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
  businessType?: string | null;
  stage?: ConversationStage;
  intent?: ConversationIntent;
  /** Null for a prospect only seen in the profile. */
  messages?: readonly ConversationMessage[] | null;
  analyzed?: number;
  commitments?: readonly Commitment[];
}>;

const memory = (
  username: string,
  {
    businessType = null,
    stage = "ENGAGED",
    intent = "INTERESTED",
    messages = [them("Ciao!")],
    analyzed = 1,
    commitments = [],
  }: Fixture = {},
): ProspectMemory =>
  memoryOf({
    prospect: {
      id: `id-${username}`,
      username,
      displayName: null,
      businessType,
      facts: [],
      hypotheses: [],
      conversation:
        messages === null
          ? null
          : {
              stage,
              intent,
              interest: "MEDIUM",
              nextGoal: "UNDERSTAND_PROCESS",
            },
      summary: null,
      objections: [],
      commitments,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(analyzed),
    },
    messages: messages ?? [],
  });

const agenda = (...memories: readonly ProspectMemory[]): Agenda =>
  agendaOf(memories.map(overviewOf), NOW);

/** Alex wrote last, `days` days ago, and `unanswered` times in a row. */
const waited = (days: number, unanswered = 1): Fixture => ({
  messages: [
    them("Ci penso"),
    ...Array.from({ length: unanswered }, () => alex("Ok!")),
  ],
  analyzed: days,
});

const link = (username: string): string =>
  `<a href="https://www.instagram.com/${username}/">@${username}</a>`;

describe("todayList", () => {
  it("lists whom to answer and to follow up, and counts the others", () => {
    const list = todayList(
      agenda(
        memory("mariofit", {
          businessType: "personal trainer",
          commitments: [
            {
              by: "ALEX",
              text: "Mandargli un esempio di prenotazione online",
            },
            { by: "PROSPECT", text: "Fargli sapere entro venerdì" },
          ],
        }),
        memory("coachmarco", {
          businessType: "coach",
          intent: "PRICE_REQUEST",
        }),
        memory("barberriccione", { businessType: "barbiere", ...waited(4) }),
        memory("ristorantexyz", waited(5, 2)),
        memory("attesa.uno", waited(1)),
        memory("attesa.due", waited(0)),
        memory("attesa.tre", waited(2)),
        memory("giulia.bakery", { messages: null }),
        memory("officina.rossi", { messages: null }),
      ),
      NOW,
    );

    expect(list.html).toBe(
      [
        "📋 <b>OGGI</b> · domenica 27 settembre",
        "",
        "🔥 <b>DA RISPONDERE</b> (2)",
        "",
        `${link("coachmarco")} · coach`,
        "ha chiesto il prezzo · ieri",
        "",
        `${link("mariofit")} · personal trainer`,
        "ha risposto ieri",
        "🤝 Hai promesso: Mandargli un esempio di prenotazione online",
        "",
        "⏰ <b>FOLLOW-UP</b> (2)",
        "",
        `${link("barberriccione")} · barbiere`,
        "ultimo contatto: 4 giorni fa · 1° follow-up",
        "",
        link("ristorantexyz"),
        "ultimo contatto: 5 giorni fa · 2° e ultimo follow-up",
        "",
        "⏳ 3 in attesa di risposta: /followup",
        "👤 2 da contattare: /nuovo",
        "",
        "Tocca un bottone qui sotto per aprire la scheda, o il nome per aprire Instagram.",
      ].join("\n"),
    );
    expect(
      list.keyboard?.map((row) => row.map((button) => button.label)),
    ).toStrictEqual([
      ["🔥 @coachmarco", "🔥 @mariofit"],
      ["⏰ @barberriccione", "⏰ @ristorantexyz"],
    ]);
    // Each button opens the prospect at its position.
    expect(
      list.keyboard
        ?.flat()
        .map((button) =>
          button.type === "CALLBACK" ? decodeButton(button.data) : null,
        ),
    ).toStrictEqual([0, 1, 2, 3].map((index) => ({ type: "OPEN", index })));
    expect(list.items).toStrictEqual([
      "id-coachmarco",
      "id-mariofit",
      "id-barberriccione",
      "id-ristorantexyz",
    ]);
  });

  it.each<[ConversationIntent, string]>([
    ["READY_FOR_CALL", "vuole sentirti in call · ieri"],
    ["ASKING_FOR_MORE_INFO", "vuole più informazioni · ieri"],
    ["PRICE_OBJECTION", "trova alto il prezzo · ieri"],
    ["ALREADY_HAS_PROVIDER", "ha già un fornitore · ieri"],
    ["SKEPTICAL", "ha dei dubbi · ieri"],
    ["CONFUSED", "non ha capito bene · ieri"],
    ["BUSY", "ora ha poco tempo · ieri"],
    ["NOT_INTERESTED", "non vuole andare avanti: chiudi con un saluto · ieri"],
    ["POSITIVE", "ha risposto ieri"],
  ])("says what a reply with intent %s asks for", (intent, line) => {
    const { html } = todayList(agenda(memory("mariofit", { intent })), NOW);

    expect(html.split("\n")).toContain(line);
  });

  it("shows a few of each section, and where the others are", () => {
    const { html, keyboard, items } = todayList(
      agenda(
        ...Array.from({ length: 7 }, (_, index) =>
          memory(`risposta.${String(index)}`, { analyzed: index }),
        ),
        ...Array.from({ length: 6 }, (_, index) =>
          memory(`seguito.${String(index)}`, waited(10 + index)),
        ),
      ),
      NOW,
    );

    expect(html).toContain("🔥 <b>DA RISPONDERE</b> (7)");
    expect(html).toContain("…e altri 2: /lista");
    expect(html).toContain("⏰ <b>FOLLOW-UP</b> (6)");
    expect(html).toContain("…e un altro: /followup");
    expect(items).toHaveLength(10);
    expect(keyboard?.flat()).toHaveLength(10);
  });

  it("gives a long name a row of its own", () => {
    const { keyboard } = todayList(
      agenda(
        memory("mariofit", { analyzed: 1 }),
        memory("pasticceria.dolce.vita.rimini", { analyzed: 2 }),
        memory("giulia", { analyzed: 3 }),
      ),
      NOW,
    );

    expect(keyboard?.map((row) => row.map(({ label }) => label))).toStrictEqual(
      [["🔥 @mariofit"], ["🔥 @pasticceria.dolce.vita.rimini"], ["🔥 @giulia"]],
    );
  });

  it("cuts a long promise and counts Alex's other ones", () => {
    const promise = `Preparare ${"una bozza molto dettagliata ".repeat(5)}`;
    const { html } = todayList(
      agenda(
        memory("mariofit", {
          commitments: [
            { by: "PROSPECT", text: "Mandare le foto" },
            { by: "ALEX", text: promise },
            { by: "ALEX", text: "Chiamarlo lunedì" },
            { by: "ALEX", text: "Mandare il preventivo" },
          ],
        }),
      ),
      NOW,
    );

    const line = html.split("\n").find((text) => text.startsWith("🤝"));
    expect(line).toBe(
      `🤝 Hai promesso: ${Array.from(promise).slice(0, 80).join("").trimEnd()}… (+2)`,
    );
  });

  it("escapes what the prospect's profile says", () => {
    const { html } = todayList(
      agenda(memory("mariofit", { businessType: "<b>Gym</b> & co" })),
      NOW,
    );

    expect(html).toContain(
      `${link("mariofit")} · &lt;b&gt;Gym&lt;/b&gt; &amp; co`,
    );
  });

  it("leaves out the promises first when the list would not fit", () => {
    const longPromise = [{ by: "ALEX", text: "p".repeat(80) }] as const;
    const { html } = todayList(
      agenda(
        ...Array.from({ length: 10 }, (_, index) =>
          memory(`prospect.${String(index)}`, {
            businessType: "b".repeat(250),
            commitments: longPromise,
            ...(index < 5 ? { analyzed: index } : waited(10 + index)),
          }),
        ),
      ),
      NOW,
    );

    expect(fitsInMessage(html)).toBe(true);
    expect(html).not.toContain("🤝");
    expect(html).toContain("🔥 <b>DA RISPONDERE</b> (5)");
  });

  it("says when nobody is waiting for Alex", () => {
    const list = todayList(
      agenda(
        memory("attesa", waited(1)),
        memory("giulia.bakery", { messages: null }),
      ),
      NOW,
    );

    expect(list).toStrictEqual({
      html: [
        "📋 <b>OGGI</b> · domenica 27 settembre",
        "",
        "✅ Tutto in pari: nessuno aspetta una tua risposta e nessun follow-up è in scadenza.",
        "",
        "⏳ 1 in attesa di risposta: /followup",
        "👤 1 da contattare: /nuovo",
      ].join("\n"),
      keyboard: null,
      items: [],
    });
  });

  it("asks for a first profile when it knows nobody", () => {
    const list = todayList(agenda(), NOW);

    expect(list.html).toContain("Non ho ancora nessun prospect in memoria");
    expect(list.keyboard).toBeNull();
    expect(list.items).toStrictEqual([]);
  });
});

describe("followUpsList", () => {
  it("lists the follow-ups due and coming, with the day each is due", () => {
    const list = followUpsList(
      agenda(
        memory("barberriccione", { businessType: "barbiere", ...waited(4) }),
        memory("ristorantexyz", waited(5, 2)),
        memory("pizzeria.gino", { businessType: "ristorante", ...waited(1) }),
        memory("studio.rossi", waited(2, 2)),
        memory("fermo.uno", waited(3, 3)),
        memory("fermo.due", waited(9, 3)),
        memory("da.rispondere"),
      ),
      NOW,
    );

    expect(list.html).toBe(
      [
        "⏰ <b>FOLLOW-UP</b>",
        "",
        "<b>Da fare</b> (2)",
        "",
        `${link("barberriccione")} · barbiere`,
        "ultimo contatto: 4 giorni fa · 1° follow-up",
        "",
        link("ristorantexyz"),
        "ultimo contatto: 5 giorni fa · 2° e ultimo follow-up",
        "",
        "<b>In attesa</b> (2)",
        "",
        `${link("pizzeria.gino")} · ristorante`,
        "ultimo contatto: ieri · 1° follow-up da martedì 29/09",
        "",
        link("studio.rossi"),
        "ultimo contatto: 2 giorni fa · 2° e ultimo follow-up da mercoledì 30/09",
        "",
        "🤐 2 fermi dopo 2 follow-up senza risposta: non li ripropongo.",
        "",
        "Tocca un bottone per aprire la scheda: da lì 💬 scrive il follow-up. Al massimo 2 follow-up a chi non risponde.",
      ].join("\n"),
    );
    expect(
      list.keyboard?.map((row) => row.map((button) => button.label)),
    ).toStrictEqual([
      ["⏰ @barberriccione", "⏰ @ristorantexyz"],
      ["⏳ @pizzeria.gino", "⏳ @studio.rossi"],
    ]);
    expect(list.items).toStrictEqual([
      "id-barberriccione",
      "id-ristorantexyz",
      "id-pizzeria.gino",
      "id-studio.rossi",
    ]);
  });

  it("shows ten of each group, twenty buttons at most", () => {
    const { html, items } = followUpsList(
      agenda(
        ...Array.from({ length: 12 }, (_, index) =>
          memory(`dovuto.${String(index)}`, waited(10 + index)),
        ),
        ...Array.from({ length: 11 }, (_, index) =>
          memory(`attesa.${String(index)}`, waited(index % 3)),
        ),
      ),
      NOW,
    );

    expect(html).toContain("<b>Da fare</b> (12)");
    expect(html).toContain("…e altri 2: /lista");
    expect(html).toContain("<b>In attesa</b> (11)");
    expect(html).toContain("…e un altro: /lista");
    expect(items).toHaveLength(20);
  });

  it("leaves out what the prospects do when the list would not fit", () => {
    // The longest the memory keeps: 30-character usernames, 100-character
    // business types, second follow-ups and dates older than a month.
    const longest = (index: number, days: number) =>
      memory(`${String(index).padStart(2, "0")}${"x".repeat(28)}`, {
        businessType: "b".repeat(100),
        ...waited(days, 2),
      });
    const { html, items } = followUpsList(
      agenda(
        ...Array.from({ length: 12 }, (_, index) => longest(index, 40 + index)),
        ...Array.from({ length: 12 }, (_, index) =>
          longest(20 + index, index % 3),
        ),
        memory("fermo.limite", waited(2, 3)),
      ),
      NOW,
    );

    expect(fitsInMessage(html)).toBe(true);
    expect(html).not.toContain("b".repeat(100));
    expect(html).toContain("🤐 1 fermi");
    expect(items).toHaveLength(20);
  });

  it("says when no follow-up is due or coming", () => {
    const list = followUpsList(agenda(memory("da.rispondere")), NOW);

    expect(list).toStrictEqual({
      html: [
        "⏰ <b>FOLLOW-UP</b>",
        "",
        "Nessun follow-up da fare né in arrivo. Quando mandi un messaggio tocca ✅ Inviato: se non ti rispondono, te lo ricordo qui e in /oggi.",
      ].join("\n"),
      keyboard: null,
      items: [],
    });
  });
});

describe("newProspectsList", () => {
  const HELP =
    "Mandami 1-3 screenshot del suo profilo Instagram, con bio e post: ti propongo tre primi messaggi e lo salvo in memoria. Quando ne mandi uno, tocca ✅ Inviato accanto al 📋 che hai copiato.";

  it("explains how to add a prospect and lists those still to contact", () => {
    const list = newProspectsList(
      agenda(
        memory("officina.rossi", { messages: null, analyzed: 5 }),
        memory("giulia.bakery", {
          businessType: "pasticceria",
          messages: null,
          analyzed: 0,
        }),
        memory("da.rispondere"),
      ),
      NOW,
    );

    expect(list.html).toBe(
      [
        "➕ <b>NUOVO PROSPECT</b>",
        "",
        HELP,
        "",
        "👤 <b>Da contattare</b> (2)",
        "",
        `${link("giulia.bakery")} · pasticceria`,
        "profilo analizzato oggi",
        "",
        link("officina.rossi"),
        "profilo analizzato 5 giorni fa",
        "",
        "Hai già scritto a qualcuno di loro? Apri la scheda e tocca ✅ Già scritto.",
      ].join("\n"),
    );
    expect(
      list.keyboard?.map((row) => row.map((button) => button.label)),
    ).toStrictEqual([["👤 @giulia.bakery", "👤 @officina.rossi"]]);
    expect(list.items).toStrictEqual(["id-giulia.bakery", "id-officina.rossi"]);
  });

  it("shows ten profiles at most", () => {
    const { html, items } = newProspectsList(
      agenda(
        ...Array.from({ length: 12 }, (_, index) =>
          memory(`profilo.${String(index)}`, {
            messages: null,
            analyzed: index,
          }),
        ),
      ),
      NOW,
    );

    expect(html).toContain("…e altri 2: /lista");
    expect(items).toHaveLength(10);
  });

  it("says when Alex has written to every profile", () => {
    const list = newProspectsList(agenda(memory("da.rispondere")), NOW);

    expect(list).toStrictEqual({
      html: [
        "➕ <b>NUOVO PROSPECT</b>",
        "",
        HELP,
        "",
        "👤 <b>Da contattare</b>",
        "Nessun profilo da contattare: a tutti quelli che ho in memoria hai già scritto.",
      ].join("\n"),
      keyboard: null,
      items: [],
    });
  });
});

describe("prospectsList", () => {
  const LEGEND = [
    "",
    "🔥 da rispondere · ⏰ follow-up da fare · ⏳ in attesa · 🤐 2 follow-up senza risposta · 🔒 non vuole messaggi · 👋 saluto finale inviato",
    "Per la scheda: tocca un bottone in /oggi, /followup o /nuovo, oppure mandami lo username.",
  ];

  it("groups every prospect by stage, with what each waits for", () => {
    const list = prospectsList(
      agenda(
        memory("coachmarco", { stage: "DISCOVERY", ...waited(4) }),
        memory("mariofit", { stage: "DISCOVERY" }),
        memory("studio.foto", { stage: "DISCOVERY", ...waited(1) }),
        memory("barberriccione", { stage: "OPENING", ...waited(5) }),
        memory("giulia.bakery", { messages: null, analyzed: 0 }),
        memory("fotostudio", { stage: "WON", ...waited(3) }),
        memory("fermo.limite", waited(2, 3)),
        memory("non.scrivere", {
          stage: "DO_NOT_CONTACT",
          intent: "DO_NOT_CONTACT",
        }),
      ),
    );

    expect(list).toStrictEqual({
      html: [
        "📇 <b>PROSPECT</b> · 8 in memoria",
        "",
        "<b>OPENING</b> · 1",
        `${link("barberriccione")} ⏰`,
        "",
        "<b>DISCOVERY</b> · 3",
        `${link("mariofit")} 🔥 · ${link("studio.foto")} ⏳ · ${link("coachmarco")} ⏰`,
        "",
        "👤 <b>Solo profilo</b> · 1",
        link("giulia.bakery"),
        "",
        "🏆 <b>Clienti</b> · 1",
        link("fotostudio"),
        "",
        "⏸ <b>Fermi</b> · 2",
        `${link("non.scrivere")} 🔒 · ${link("fermo.limite")} 🤐`,
        ...LEGEND,
      ].join("\n"),
      keyboard: null,
      items: [],
    });
  });

  it("shows fewer names per group when they do not fit", () => {
    const stages = CONVERSATION_STAGES.filter(
      (stage) => stage !== "WON" && stage !== "DO_NOT_CONTACT",
    );
    const { html } = prospectsList(
      agenda(
        ...stages.flatMap((stage, group) =>
          Array.from({ length: 13 }, (_, index) =>
            memory(
              `${String(group).padStart(2, "0")}.${String(index).padStart(2, "0")}.${"x".repeat(22)}`,
              { stage },
            ),
          ),
        ),
      ),
    );

    expect(fitsInMessage(html)).toBe(true);
    expect(html).toContain(
      `📇 <b>PROSPECT</b> · ${String(stages.length * 13)} in memoria`,
    );
    expect(html).toContain(" +8");
  });

  it("says when it knows nobody", () => {
    expect(prospectsList(agenda()).html).toBe(
      "📇 Nessun prospect in memoria: mandami gli screenshot di un profilo per iniziare.",
    );
  });
});
