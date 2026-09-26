// The tables as Kysely sees them. Values read from the database are still
// validated before they become domain values: the types below only describe
// what the queries are allowed to write and select.

export interface ProspectsTable {
  id: string;
  platform: string;
  username: string;
  display_name: string | null;
  business_type: string | null;
  /** JSON array of strings. */
  facts: string;
  /** JSON array of strings. */
  hypotheses: string;
  stage: string | null;
  intent: string | null;
  interest: string | null;
  next_goal: string | null;
  summary: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProspectMessagesTable {
  prospect_id: string;
  /** Order of the message in the conversation, counting from 1. */
  seq: number;
  author: string;
  body: string;
  created_at: Date;
}

export interface GenerationRunsTable {
  id: string;
  prospect_id: string | null;
  ai_mode: string;
  prompt: string;
  model: string | null;
  /** OK, or the type of the error. */
  outcome: string;
  duration_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  stop_reason: string | null;
  created_at: Date;
}

export interface Database {
  prospects: ProspectsTable;
  prospect_messages: ProspectMessagesTable;
  generation_runs: GenerationRunsTable;
}
