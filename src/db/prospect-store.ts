import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";
import { z } from "zod";

import {
  SUGGESTION_KINDS,
  SUGGESTION_STYLES,
  type SuggestionKind,
  type SuggestionStyle,
} from "../ai/outputs.ts";
import {
  CONVERSATION_INTENTS,
  CONVERSATION_STAGES,
  INTEREST_LEVELS,
  NEXT_GOALS,
  type Commitment,
  type ConversationMessage,
  type StageChange,
} from "../conversations/domain.ts";
import {
  contactFactsOf,
  MAX_LOADED_SENDS,
  MAX_STORED_MESSAGES,
  MAX_STORED_SENDS,
  storedSendText,
  type Prospect,
  type ProspectMemory,
  type ProspectOverview,
  type Send,
  type StoredAt,
} from "../prospects/memory.ts";
import {
  sendsToLoad,
  type ProspectStore,
  type StoreDependencies,
} from "../prospects/store.ts";
import type { Database } from "./schema.ts";

/** Prospects come from Instagram; the column leaves room for other channels. */
const PLATFORM = "instagram";

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const notesSchema = z.string().transform(parseJson).pipe(z.array(z.string()));

const authorSchema = z.enum(["ALEX", "PROSPECT"]);

const commitmentsSchema = z
  .string()
  .transform(parseJson)
  .pipe(
    z.array(
      z
        .object({ by: authorSchema, text: z.string() })
        .transform((commitment): Commitment => commitment),
    ),
  );

const prospectRowSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    display_name: z.string().nullable(),
    business_type: z.string().nullable(),
    facts: notesSchema,
    hypotheses: notesSchema,
    stage: z.enum(CONVERSATION_STAGES).nullable(),
    intent: z.enum(CONVERSATION_INTENTS).nullable(),
    interest: z.enum(INTEREST_LEVELS).nullable(),
    next_goal: z.enum(NEXT_GOALS).nullable(),
    summary: z.string().nullable(),
    objections: notesSchema,
    commitments: commitmentsSchema,
    created_at: z.date(),
    updated_at: z.date(),
  })
  .transform((row): Prospect => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    businessType: row.business_type,
    facts: row.facts,
    hypotheses: row.hypotheses,
    conversation:
      row.stage === null ||
      row.intent === null ||
      row.interest === null ||
      row.next_goal === null
        ? null
        : {
            stage: row.stage,
            intent: row.intent,
            interest: row.interest,
            nextGoal: row.next_goal,
          },
    summary: row.summary,
    objections: row.objections,
    commitments: row.commitments,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

const messagesSchema = z.array(
  z
    .object({ author: authorSchema, body: z.string(), created_at: z.date() })
    .transform(
      (row): Readonly<{ message: ConversationMessage; stored: StoredAt }> => ({
        message: { author: row.author, text: row.body },
        stored: { author: row.author, at: row.created_at },
      }),
    ),
);

const sendColumns = {
  kind: z.enum(SUGGESTION_KINDS),
  style: z.enum(SUGGESTION_STYLES).nullable(),
  body: z.string().nullable(),
  sent_at: z.date(),
};

const sendOf = (
  row: Readonly<{
    kind: SuggestionKind;
    style: SuggestionStyle | null;
    body: string | null;
    sent_at: Date;
  }>,
): Send => ({
  kind: row.kind,
  style: row.style,
  text: row.body,
  sentAt: row.sent_at,
});

const sendsSchema = z.array(z.object(sendColumns).transform(sendOf));

const prospectSendsSchema = z.array(
  z
    .object({ prospect_id: z.string(), ...sendColumns })
    .transform((row) => ({ prospectId: row.prospect_id, send: sendOf(row) })),
);

const linkedSchema = z.object({ id: z.string(), username: z.string() });

const existingSendSchema = z.object({
  style: z.enum(SUGGESTION_STYLES).nullable(),
  sent_at: z.date(),
});

// MySQL may return BIGINT columns and counts as strings.
const countSchema = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform(Number)
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));

const idSchema = z.object({ id: countSchema });

// The latest of DATETIME values, as a date or, from some engines, as text.
const latestTimeSchema = z.union([
  z.date(),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/)
    .transform((text) => new Date(`${text.replace(" ", "T")}Z`))
    .pipe(z.date()),
]);

/** Each prospect's messages by author: how many, the last one and when. */
const messageTotalsSchema = z.array(
  z
    .object({
      prospect_id: z.string(),
      author: authorSchema,
      messages: countSchema,
      last_seq: countSchema,
      last_at: latestTimeSchema,
    })
    .transform((row) => ({
      prospectId: row.prospect_id,
      author: row.author,
      messages: row.messages,
      lastSeq: row.last_seq,
      lastAt: row.last_at,
    })),
);

type MessageTotals = z.output<typeof messageTotalsSchema>[number];

/** A second send for the same message of the bot: ER_DUP_ENTRY. */
const isDuplicate = (error: unknown): boolean =>
  z.object({ errno: z.literal(1062) }).safeParse(error).success;

const stageChangesSchema = z.array(
  z
    .object({
      from_stage: z.enum(CONVERSATION_STAGES).nullable(),
      to_stage: z.enum(CONVERSATION_STAGES),
      changed_at: z.date(),
    })
    .transform((row): StageChange => ({
      from: row.from_stage,
      to: row.to_stage,
      at: row.changed_at,
    })),
);

const loadMemory = async (
  db: Kysely<Database>,
  username: string,
): Promise<ProspectMemory | null> => {
  const row = await db
    .selectFrom("prospects")
    .selectAll()
    .where("platform", "=", PLATFORM)
    .where("username", "=", username)
    .executeTakeFirst();
  if (row === undefined) {
    return null;
  }

  const prospect = prospectRowSchema.parse(row);
  const latest = await db
    .selectFrom("prospect_messages")
    .select(["author", "body", "created_at"])
    .where("prospect_id", "=", prospect.id)
    .orderBy("seq", "desc")
    .limit(MAX_STORED_MESSAGES)
    .execute();
  const rows = messagesSchema.parse(latest).toReversed();
  const times = rows.map(({ stored }) => stored);
  const { lastProspectMessageAt } = contactFactsOf(times, []);
  // The sends after the prospect's latest message, or all of them.
  const sends = await db
    .selectFrom("prospect_sends")
    .select(["kind", "style", "body", "sent_at"])
    .where("prospect_id", "=", prospect.id)
    .$if(lastProspectMessageAt !== null, (query) =>
      query.where("sent_at", ">", lastProspectMessageAt ?? new Date(0)),
    )
    .orderBy("sent_at", "desc")
    .orderBy("id", "desc")
    .limit(MAX_LOADED_SENDS)
    .execute();
  return {
    prospect,
    messages: rows.map(({ message }) => message),
    contact: contactFactsOf(times, sendsSchema.parse(sends).toReversed()),
  };
};

/**
 * A prospect's overview from the totals of its messages by author and the
 * sends after its latest message, oldest first.
 */
const overviewFrom = (
  prospect: Prospect,
  totals: readonly MessageTotals[],
  sends: readonly Send[],
): ProspectOverview => {
  const fromProspect = totals.find(({ author }) => author === "PROSPECT");
  const fromAlex = totals.find(({ author }) => author === "ALEX");
  const latest = totals.map(({ author, lastAt }) => ({ author, at: lastAt }));
  const { lastProspectMessageAt } = contactFactsOf(latest, []);
  return {
    prospect,
    storedMessages: totals.reduce((sum, { messages }) => sum + messages, 0),
    // The kept messages are numbered without gaps: those after the
    // prospect's latest one are all Alex's.
    storedUnanswered:
      fromAlex === undefined
        ? 0
        : fromProspect === undefined
          ? fromAlex.messages
          : Math.max(0, fromAlex.lastSeq - fromProspect.lastSeq),
    contact: contactFactsOf(latest, sendsToLoad(sends, lastProspectMessageAt)),
  };
};

/** Every prospect's overview, in three queries whatever their number. */
const overview = async (
  db: Kysely<Database>,
): Promise<readonly ProspectOverview[]> => {
  const prospects = z
    .array(prospectRowSchema)
    .parse(
      await db
        .selectFrom("prospects")
        .selectAll()
        .where("platform", "=", PLATFORM)
        .execute(),
    );
  const totals = messageTotalsSchema.parse(
    await db
      .selectFrom("prospect_messages")
      .select((eb) => [
        "prospect_id",
        "author",
        eb.fn.countAll().as("messages"),
        eb.fn.max("seq").as("last_seq"),
        eb.fn.max("created_at").as("last_at"),
      ])
      .groupBy(["prospect_id", "author"])
      .execute(),
  );
  // Only the sends after each prospect's latest message, or all of them.
  const sends = prospectSendsSchema.parse(
    await db
      .selectFrom("prospect_sends as s")
      .leftJoin(
        (eb) =>
          eb
            .selectFrom("prospect_messages")
            .select((inner) => [
              "prospect_id",
              inner.fn.max("created_at").as("last_prospect_at"),
            ])
            .where("author", "=", "PROSPECT")
            .groupBy("prospect_id")
            .as("lp"),
        (join) => join.onRef("lp.prospect_id", "=", "s.prospect_id"),
      )
      .select(["s.prospect_id", "s.kind", "s.style", "s.body", "s.sent_at"])
      .where((eb) =>
        eb.or([
          eb("lp.last_prospect_at", "is", null),
          eb("s.sent_at", ">", eb.ref("lp.last_prospect_at")),
        ]),
      )
      .orderBy("s.prospect_id")
      .orderBy("s.sent_at")
      .orderBy("s.id")
      .execute(),
  );
  const totalsOf = Map.groupBy(totals, ({ prospectId }) => prospectId);
  const sendsOf = Map.groupBy(sends, ({ prospectId }) => prospectId);
  return prospects.map((prospect) =>
    overviewFrom(
      prospect,
      totalsOf.get(prospect.id) ?? [],
      (sendsOf.get(prospect.id) ?? []).map(({ send }) => send),
    ),
  );
};

/** Prospect memory in MySQL or MariaDB. */
export const createMysqlProspectStore = (
  db: Kysely<Database>,
  { now = () => new Date(), newId = randomUUID }: StoreDependencies = {},
): ProspectStore => ({
  load: (username) => loadMemory(db, username),
  save: ({ profile, newMessages }) =>
    db.transaction().execute(async (trx) => {
      const time = now();
      const columns = {
        display_name: profile.displayName,
        business_type: profile.businessType,
        facts: JSON.stringify(profile.facts),
        hypotheses: JSON.stringify(profile.hypotheses),
        stage: profile.conversation?.stage ?? null,
        intent: profile.conversation?.intent ?? null,
        interest: profile.conversation?.interest ?? null,
        next_goal: profile.conversation?.nextGoal ?? null,
        summary: profile.summary,
        objections: JSON.stringify(profile.objections),
        commitments: JSON.stringify(profile.commitments),
        updated_at: time,
      };

      // Locking the row makes concurrent saves of a prospect take turns.
      const existing = await trx
        .selectFrom("prospects")
        .select(["id", "stage"])
        .where("platform", "=", PLATFORM)
        .where("username", "=", profile.username)
        .forUpdate()
        .executeTakeFirst();
      const id = existing?.id ?? newId();
      if (existing === undefined) {
        await trx
          .insertInto("prospects")
          .values({
            id,
            platform: PLATFORM,
            username: profile.username,
            created_at: time,
            ...columns,
          })
          .execute();
      } else {
        await trx
          .updateTable("prospects")
          .set(columns)
          .where("id", "=", id)
          .execute();
      }

      const stage = profile.conversation?.stage ?? null;
      const earlierStage = existing?.stage ?? null;
      if (stage !== null && stage !== earlierStage) {
        await trx
          .insertInto("prospect_stage_changes")
          .values({
            prospect_id: id,
            from_stage: earlierStage,
            to_stage: stage,
            changed_at: time,
          })
          .execute();
      }

      if (newMessages.length > 0) {
        const { last } = await trx
          .selectFrom("prospect_messages")
          // MAX is NULL while the prospect has no messages.
          .select((eb) => eb.fn.max<number | null>("seq").as("last"))
          .where("prospect_id", "=", id)
          .executeTakeFirstOrThrow();
        const first = (last ?? 0) + 1;
        await trx
          .insertInto("prospect_messages")
          .values(
            newMessages.map((message, index) => ({
              prospect_id: id,
              seq: first + index,
              author: message.author,
              body: message.text,
              created_at: time,
            })),
          )
          .execute();
        await trx
          .deleteFrom("prospect_messages")
          .where("prospect_id", "=", id)
          .where(
            "seq",
            "<=",
            first + newMessages.length - 1 - MAX_STORED_MESSAGES,
          )
          .execute();
      }

      const memory = await loadMemory(trx, profile.username);
      if (memory === null) {
        throw new Error("the prospect just saved cannot be read back");
      }
      return memory;
    }),
  stageHistory: async (username) =>
    stageChangesSchema.parse(
      await db
        .selectFrom("prospect_stage_changes")
        .innerJoin(
          "prospects",
          "prospects.id",
          "prospect_stage_changes.prospect_id",
        )
        .select([
          "prospect_stage_changes.from_stage",
          "prospect_stage_changes.to_stage",
          "prospect_stage_changes.changed_at",
        ])
        .where("prospects.platform", "=", PLATFORM)
        .where("prospects.username", "=", username)
        .orderBy("prospect_stage_changes.id")
        .execute(),
    ),
  linkMessages: async (prospectId, chatId, messageIds) => {
    if (messageIds.length === 0) {
      return;
    }
    const time = now();
    await db
      .insertInto("telegram_messages")
      .values(
        messageIds.map((messageId) => ({
          chat_id: chatId,
          message_id: messageId,
          prospect_id: prospectId,
          created_at: time,
        })),
      )
      .execute();
  },
  prospectOfMessage: async (chatId, messageId) => {
    const row = await db
      .selectFrom("telegram_messages")
      .innerJoin("prospects", "prospects.id", "telegram_messages.prospect_id")
      .select("prospects.username")
      .where("telegram_messages.chat_id", "=", chatId)
      .where("telegram_messages.message_id", "=", messageId)
      .executeTakeFirst();
    return z
      .string()
      .nullable()
      .parse(row?.username ?? null);
  },
  // No transaction and no lock: the unique key on the message of the bot
  // settles concurrent taps, without deadlocks.
  recordSend: async ({ chatId, messageId, kind, style, text }) => {
    const linked = await db
      .selectFrom("telegram_messages")
      .innerJoin("prospects", "prospects.id", "telegram_messages.prospect_id")
      .select(["prospects.id", "prospects.username"])
      .where("telegram_messages.chat_id", "=", chatId)
      .where("telegram_messages.message_id", "=", messageId)
      .executeTakeFirst();
    if (linked === undefined) {
      return { type: "NOT_LINKED" };
    }
    const { id: prospectId, username } = linkedSchema.parse(linked);
    const body = storedSendText(text);
    const sentAt = now();
    try {
      await db
        .insertInto("prospect_sends")
        .values({
          prospect_id: prospectId,
          chat_id: chatId,
          message_id: messageId,
          kind,
          style,
          body,
          sent_at: sentAt,
        })
        .execute();
    } catch (error) {
      if (!isDuplicate(error)) {
        throw error;
      }
      const existing = existingSendSchema.parse(
        await db
          .selectFrom("prospect_sends")
          .select(["style", "sent_at"])
          .where("chat_id", "=", chatId)
          .where("message_id", "=", messageId)
          .executeTakeFirstOrThrow(),
      );
      const corrected = style !== null && style !== existing.style;
      if (corrected) {
        await db
          .updateTable("prospect_sends")
          .set({ style, body })
          .where("chat_id", "=", chatId)
          .where("message_id", "=", messageId)
          .execute();
      }
      return {
        type: corrected ? "CORRECTED" : "UNCHANGED",
        prospectId,
        username,
        sentAt: existing.sent_at,
      };
    }

    // The oldest send beyond those kept, if any: it and older ones go.
    const beyond = await db
      .selectFrom("prospect_sends")
      .select("id")
      .where("prospect_id", "=", prospectId)
      .orderBy("id", "desc")
      .limit(1)
      .offset(MAX_STORED_SENDS)
      .executeTakeFirst();
    if (beyond !== undefined) {
      await db
        .deleteFrom("prospect_sends")
        .where("prospect_id", "=", prospectId)
        .where("id", "<=", idSchema.parse(beyond).id)
        .execute();
    }
    return { type: "RECORDED", prospectId, username, sentAt };
  },
  overview: () => overview(db),
});
