import { config } from "dotenv";
import { describe, expect, it } from "vitest";
import { parseInValues, QueryBuilder } from "@/lib/pg/query-builder";

config({ path: ".env" });
config({ path: ".env.local" });

describe("parseInValues", () => {
  it("splits unquoted PostgREST in-list into separate values", () => {
    expect(parseInValues("(voided,cancelled,merged,completed)")).toEqual([
      "voided",
      "cancelled",
      "merged",
      "completed",
    ]);
  });

  it("keeps quoted values and arrays", () => {
    expect(parseInValues('("completed","cancelled")')).toEqual([
      "completed",
      "cancelled",
    ]);
    expect(parseInValues(["voided", "cancelled"])).toEqual(["voided", "cancelled"]);
  });
});

describe("QueryBuilder buildReturning", () => {
  it('does not quote "*" when select mixes * with an embed (insert returning)', async () => {
    const captured: { sql: string }[] = [];
    const fakePool = {
      query: async (sql: string) => {
        captured.push({ sql });
        return { rows: [{ id: "x" }] };
      },
    } as any;

    const result = await new QueryBuilder("employee_salary", "public", fakePool)
      .insert({ employee_id: "e1", base_salary: 1000 })
      .select(`*, employee:employees (id, full_name)`)
      .single();

    expect(result.error).toBeNull();
    expect(captured[0].sql).toContain("RETURNING *");
    expect(captured[0].sql).not.toContain('"*"');
  });
});

describe("QueryBuilder embed FK hints", () => {
  it("parses PostgREST table!fk_hint syntax for self-referential joins", async () => {
    const result = await new QueryBuilder("employees")
      .select(
        `*, manager:employees!reporting_to (id, full_name, nip)`
      )
      .order("full_name", { ascending: true })
      .limit(1);

    expect(result.error).toBeNull();
    expect(Array.isArray(result.data)).toBe(true);
  });
});
