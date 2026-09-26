import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";
import { z } from "zod";

import {
  CONVERSATION_INTENTS,
  CONVERSATION_STAGES,
  INTEREST_LEVELS,
  NEXT_GOALS,
} from "../conversations/domain.ts";
import {
  MAX_STORED_MESSAGES,
  type Commitment,
  type ConversationMessage,
  type Prospect,
  type ProspectMemory,
} from "../prospects/memory.ts";
import type { ProspectStore, StoreDependencies } from "../prospects/store.ts";
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
    .object({ author: authorSchema, body: z.string() })
    .transform((row): ConversationMessage => ({
      author: row.author,
      text: row.body,
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
    .select(["author", "body"])
    .where("prospect_id", "=", prospect.id)
    .orderBy("seq", "desc")
    .limit(MAX_STORED_MESSAGES)
    .execute();
  return { prospect, messages: messagesSchema.parse(latest).toReversed() };
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
        .select("id")
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
});
