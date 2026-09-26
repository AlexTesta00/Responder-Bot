import { readFileSync } from "node:fs";
import { parseEnv as parseDotenv } from "node:util";

import { describe, expect, it } from "vitest";

import { describeEnvError, ENV_VARIABLES, parseEnv } from "./env.ts";

describe("parseEnv", () => {
  it("applies defaults for missing variables", () => {
    expect(parseEnv({})).toStrictEqual({
      ok: true,
      value: { NODE_ENV: "development", HOST: "0.0.0.0", PORT: 3000 },
    });
  });

  it("reads provided values and coerces the port to a number", () => {
    expect(
      parseEnv({ NODE_ENV: "production", HOST: "127.0.0.1", PORT: "8080" }),
    ).toStrictEqual({
      ok: true,
      value: { NODE_ENV: "production", HOST: "127.0.0.1", PORT: 8080 },
    });
  });

  it("drops variables it does not declare", () => {
    expect(parseEnv({ BOT_TOKEN: "123456:secret" })).toStrictEqual({
      ok: true,
      value: { NODE_ENV: "development", HOST: "0.0.0.0", PORT: 3000 },
    });
  });

  it.each(["abc", "0", "65536", "80.5", ""])("rejects PORT=%j", (port) => {
    expect(parseEnv({ PORT: port })).toMatchObject({
      ok: false,
      error: { type: "ENV_VALIDATION_ERROR", issues: [{ variable: "PORT" }] },
    });
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(parseEnv({ NODE_ENV: "staging" })).toMatchObject({
      ok: false,
      error: { issues: [{ variable: "NODE_ENV" }] },
    });
  });

  it("reports every invalid variable at once", () => {
    expect(parseEnv({ NODE_ENV: "staging", PORT: "abc" })).toMatchObject({
      ok: false,
      error: { issues: [{ variable: "NODE_ENV" }, { variable: "PORT" }] },
    });
  });
});

describe("describeEnvError", () => {
  it("names invalid variables without echoing their values", () => {
    const result = parseEnv({ PORT: "not-a-port" });
    if (result.ok) {
      expect.unreachable("the configuration should be invalid");
    }

    const report = describeEnvError(result.error);

    expect(report).toContain("PORT");
    expect(report).not.toContain("not-a-port");
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
