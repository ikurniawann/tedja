import { config } from "dotenv";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { parseInValues, QueryBuilder } from "@/lib/pg/query-builder";

/** Fake `Pool` yang cuma menangkap SQL/params tiap query — dipakai lintas test. */
function fakePoolCapturing(captured: { sql: string; params: unknown[] }[]): Pool {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      captured.push({ sql, params });
      return { rows: [] };
    },
  } as unknown as Pool;
}

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

describe("QueryBuilder count with pagination", () => {
  it("returns total row count, not page length, when count exact is requested with range", async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const fakePool = {
      query: async (sql: string, queryParams: unknown[] = []) => {
        captured.push({ sql, params: queryParams });
        if (sql.includes("count(*)")) {
          return { rows: [{ count: 266 }] };
        }
        return { rows: Array.from({ length: 10 }, (_, i) => ({ id: `row-${i}` })) };
      },
    } as any;

    const result = await new QueryBuilder("v_raw_materials_stock", "public", fakePool)
      .select("*", { count: "exact" })
      .is("deleted_at", null)
      .range(0, 9);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(10);
    expect(result.count).toBe(266);
    expect(captured.some((entry) => entry.sql.includes("count(*)"))).toBe(true);
  });
});

describe("QueryBuilder .not()", () => {
  it("translates symbolic op 'eq' into a valid SQL NOT clause (not the raw 'EQ' token)", async () => {
    const captured: { sql: string; params: unknown[] }[] = [];

    await new QueryBuilder("pos_orders", "public", fakePoolCapturing(captured))
      .select("*")
      .not("status", "eq", "cancelled");

    expect(captured[0].sql).toContain('NOT ("status" = $1)');
    expect(captured[0].sql).not.toContain("EQ");
    expect(captured[0].params).toEqual(["cancelled"]);
  });

  it.each([
    { op: "neq", value: "x", expectSql: 'NOT ("a" <> $1)' },
    { op: "gt", value: 1, expectSql: 'NOT ("a" > $1)' },
    { op: "gte", value: 1, expectSql: 'NOT ("a" >= $1)' },
    { op: "lt", value: 1, expectSql: 'NOT ("a" < $1)' },
    { op: "lte", value: 1, expectSql: 'NOT ("a" <= $1)' },
    { op: "is", value: null, expectSql: '"a" IS NOT NULL' },
  ])("translates symbolic op '$op' to a valid SQL operator", async ({ op, value, expectSql }) => {
    const captured: { sql: string; params: unknown[] }[] = [];

    await new QueryBuilder("t", "public", fakePoolCapturing(captured)).select("*").not("a", op, value);

    expect(captured[0].sql).toContain(expectSql);
  });

  it("translates symbolic op 'in' via the dedicated NOT IN / buildInClause path", async () => {
    const captured: { sql: string; params: unknown[] }[] = [];

    await new QueryBuilder("t", "public", fakePoolCapturing(captured))
      .select("*")
      .not("status", "in", "(cancelled,voided)");

    expect(captured[0].sql).toContain('"status" NOT IN ($1, $2)');
  });

  it.each([
    { op: "=", value: "x", expectSql: 'NOT ("a" = $1)' },
    { op: "<>", value: "x", expectSql: 'NOT ("a" <> $1)' },
    { op: "IN", value: "(x,y)", expectSql: '"a" NOT IN' },
  ])("keeps raw SQL operator '$op' working unchanged (backward compatibility)", async ({ op, value, expectSql }) => {
    const captured: { sql: string; params: unknown[] }[] = [];

    await new QueryBuilder("t", "public", fakePoolCapturing(captured)).select("*").not("a", op, value);

    expect(captured[0].sql).toContain(expectSql);
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
