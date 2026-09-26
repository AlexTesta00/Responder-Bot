import { readFileSync } from "node:fs";
import { parseEnv as parseDotenv } from "node:util";

import { describe, expect, it } from "vitest";

import { describeEnvError, ENV_VARIABLES, parseEnv } from "./env.ts";

const TELEGRAM = {
  TELEGRAM_BOT_TOKEN: "123456:test-token_value",
  TELEGRAM_WEBHOOK_SECRET: "s".repeat(32),
  TELEGRAM_ALLOWED_USER_ID: "42",
};

const PARSED_TELEGRAM = {
  TELEGRAM_BOT_TOKEN: "123456:test-token_value",
  TELEGRAM_WEBHOOK_SECRET: "s".repeat(32),
  TELEGRAM_ALLOWED_USER_ID: 42,
};

describe("parseEnv", () => {
  it("applies defaults for missing optional variables", () => {
    expect(parseEnv(TELEGRAM)).toStrictEqual({
      ok: true,
      value: {
        NODE_ENV: "development",
        HOST: "0.0.0.0",
        PORT: 3000,
        ...PARSED_TELEGRAM,
      },
    });
  });

  it("reads provided values and converts numbers", () => {
    expect(
      parseEnv({
        ...TELEGRAM,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "8080",
      }),
    ).toStrictEqual({
      ok: true,
      value: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: 8080,
        ...PARSED_TELEGRAM,
      },
    });
  });

  it("drops variables it does not declare", () => {
    expect(parseEnv({ ...TELEGRAM, BOT_TOKEN: "123456:secret" })).toStrictEqual(
      {
        ok: true,
        value: {
          NODE_ENV: "development",
          HOST: "0.0.0.0",
          PORT: 3000,
          ...PARSED_TELEGRAM,
        },
      },
    );
  });

  it("requires the Telegram credentials", () => {
    expect(parseEnv({})).toMatchObject({
      ok: false,
      error: {
        type: "ENV_VALIDATION_ERROR",
        issues: [
          { variable: "TELEGRAM_BOT_TOKEN" },
          { variable: "TELEGRAM_WEBHOOK_SECRET" },
          { variable: "TELEGRAM_ALLOWED_USER_ID" },
        ],
      },
    });
  });

  it.each([
    ["PORT", "abc"],
    ["PORT", "0"],
    ["PORT", "65536"],
    ["PORT", "80.5"],
    ["PORT", ""],
    ["NODE_ENV", "staging"],
    ["TELEGRAM_BOT_TOKEN", "123456"],
    ["TELEGRAM_BOT_TOKEN", "bot:123456"],
    ["TELEGRAM_WEBHOOK_SECRET", "too-short"],
    ["TELEGRAM_WEBHOOK_SECRET", `${"s".repeat(32)}!`],
    ["TELEGRAM_ALLOWED_USER_ID", "abc"],
    ["TELEGRAM_ALLOWED_USER_ID", "0"],
    ["TELEGRAM_ALLOWED_USER_ID", "-42"],
    ["TELEGRAM_ALLOWED_USER_ID", "99999999999999999999"],
  ])("rejects %s=%j", (variable, value) => {
    expect(parseEnv({ ...TELEGRAM, [variable]: value })).toMatchObject({
      ok: false,
      error: { issues: [{ variable }] },
    });
  });

  it("reports every invalid variable at once", () => {
    expect(
      parseEnv({ ...TELEGRAM, NODE_ENV: "staging", PORT: "abc" }),
    ).toMatchObject({
      ok: false,
      error: { issues: [{ variable: "NODE_ENV" }, { variable: "PORT" }] },
    });
  });
});

describe("describeEnvError", () => {
  it("names invalid variables without echoing their values", () => {
    const result = parseEnv({
      ...TELEGRAM,
      TELEGRAM_BOT_TOKEN: "leaked-secret-value",
    });
    if (result.ok) {
      expect.unreachable("the configuration should be invalid");
    }

    const report = describeEnvError(result.error);

    expect(report).toContain("TELEGRAM_BOT_TOKEN");
    expect(report).not.toContain("leaked-secret-value");
  });
});

describe(".env.example", () => {
  it("documents exactly the variables the service reads", () => {
    const example = parseDotenv(
      readFileSync(new URL("../../.env.example", import.meta.url), "utf8"),
    );

    expect(Object.keys(example).toSorted()).toStrictEqual(
      ENV_VARIABLES.toSorted(),
    );
  });
});
