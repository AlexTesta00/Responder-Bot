import { describe, expect, it } from "vitest";

import { errorFields } from "./errors.ts";

describe("errorFields", () => {
  it("keeps the codes of a database error and drops its message", () => {
    const error = Object.assign(
      new Error("Duplicate entry 'mariofit' for key 'username'"),
      { code: "ER_DUP_ENTRY", errno: 1062, sqlState: "23000" },
    );

    const fields = errorFields(error);

    expect(fields).toStrictEqual({
      error_name: "Error",
      error_code: "ER_DUP_ENTRY",
      errno: 1062,
      sql_state: "23000",
    });
    expect(JSON.stringify(fields)).not.toContain("mariofit");
  });

  it("tolerates anything thrown", () => {
    expect(errorFields("boom")).toStrictEqual({
      error_name: null,
      error_code: null,
      errno: null,
      sql_state: null,
    });
  });
});
