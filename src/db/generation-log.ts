import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";

import type { GenerationLog } from "../ai/runs.ts";
import type { StoreDependencies } from "../prospects/store.ts";
import type { Database } from "./schema.ts";

/** Records generations in MySQL or MariaDB. */
export const createMysqlGenerationLog = (
  db: Kysely<Database>,
  { now = () => new Date(), newId = randomUUID }: StoreDependencies = {},
): GenerationLog => ({
  record: async ({ prospectId, report, outcome }) => {
    await db
      .insertInto("generation_runs")
      .values({
        id: newId(),
        prospect_id: prospectId,
        ai_mode: report.mode,
        prompt: report.prompt,
        model: report.model,
        outcome,
        duration_ms: Math.round(report.durationMs),
        input_tokens: report.inputTokens,
        output_tokens: report.outputTokens,
        cache_read_tokens: report.cacheReadTokens,
        cache_write_tokens: report.cacheWriteTokens,
        cost_micro_usd: report.costMicroUsd,
        stop_reason: report.stopReason,
        created_at: now(),
      })
      .execute();
  },
});
