import { Kysely, MysqlDialect } from "kysely";
import { createPool } from "mysql2";

import type { DatabaseConfig } from "../config/env.ts";
import type { Database } from "./schema.ts";

/** A few queries at a time: shared hosting limits connections per user. */
const CONNECTION_LIMIT = 5;

/** Connects lazily: the first query opens the first connection. */
export const createDatabase = (config: DatabaseConfig): Kysely<Database> =>
  new Kysely<Database>({
    dialect: new MysqlDialect({
      pool: createPool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        // Emojis are common in Instagram messages.
        charset: "UTF8MB4_UNICODE_CI",
        // DATETIME values are written and read as UTC.
        timezone: "Z",
        connectionLimit: CONNECTION_LIMIT,
        connectTimeout: 10_000,
        // Hosting providers close idle connections: the pool closes them
        // first, and keeps the one it holds alive.
        maxIdle: 1,
        idleTimeout: 60_000,
        enableKeepAlive: true,
      }),
    }),
  });
