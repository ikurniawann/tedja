import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  effectiveCompanyId,
  getApiUserScope,
} from "@/lib/api/scope";
import { withTransaction } from "@/lib/db";
import {
  parseCoaSpreadsheet,
  type ParsedCoaRow,
} from "@/lib/accounting/coa-spreadsheet";
import { recomputePostableForCompany } from "@/lib/accounting/coa-postable";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

type PreviewAction = "create" | "update" | "skip" | "error";

interface PreviewRow {
  source_row: number;
  code: string;
  name: string;
  parent_code: string | null;
  account_type_code: string;
  action: PreviewAction;
  message?: string;
}

async function loadTypeMap() {
  const db = await createServerPgClient();
  const { data } = await db
    .from("account_types", "accounting")
    .select("id, code")
    .eq("is_active", true);
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(String(row.code).toUpperCase(), String(row.id));
  }
  return map;
}

async function loadExistingByCode(companyId: string | null) {
  const db = await createServerPgClient();
  let q = db
    .from("chart_of_accounts", "accounting")
    .select("id, code, name, parent_id")
    .is("deleted_at", null);
  q = companyId ? q.eq("company_id", companyId) : q.is("company_id", null);
  const { data } = await q;
  const map = new Map<
    string,
    { id: string; code: string; name: string; parent_id: string | null }
  >();
  for (const row of data ?? []) {
    map.set(String(row.code), {
      id: String(row.id),
      code: String(row.code),
      name: String(row.name),
      parent_id: (row.parent_id as string | null) ?? null,
    });
  }
  return map;
}

function buildPreview(
  parsed: ParsedCoaRow[],
  typeMap: Map<string, string>,
  existing: Map<string, { id: string; name: string }>
): PreviewRow[] {
  const importCodes = new Set(parsed.map((r) => r.code));

  return parsed.map((row) => {
    if (!typeMap.has(row.account_type_code)) {
      return {
        source_row: row.source_row,
        code: row.code,
        name: row.name,
        parent_code: row.parent_code,
        account_type_code: row.account_type_code,
        action: "error" as const,
        message: `Account type ${row.account_type_code} tidak ditemukan`,
      };
    }

    if (
      row.parent_code &&
      !importCodes.has(row.parent_code) &&
      !existing.has(row.parent_code)
    ) {
      return {
        source_row: row.source_row,
        code: row.code,
        name: row.name,
        parent_code: row.parent_code,
        account_type_code: row.account_type_code,
        action: "error" as const,
        message: `Parent ${row.parent_code} tidak ditemukan`,
      };
    }

    const ex = existing.get(row.code);
    if (ex) {
      if (ex.name === row.name) {
        return {
          source_row: row.source_row,
          code: row.code,
          name: row.name,
          parent_code: row.parent_code,
          account_type_code: row.account_type_code,
          action: "skip" as const,
          message: "Tidak berubah",
        };
      }
      return {
        source_row: row.source_row,
        code: row.code,
        name: row.name,
        parent_code: row.parent_code,
        account_type_code: row.account_type_code,
        action: "update" as const,
      };
    }

    return {
      source_row: row.source_row,
      code: row.code,
      name: row.name,
      parent_code: row.parent_code,
      account_type_code: row.account_type_code,
      action: "create" as const,
    };
  });
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiRole([...ACCOUNTING_API_ROLES]);
    const scope = await getApiUserScope();
    const companyId = effectiveCompanyId(scope);

    const form = await request.formData();
    const file = form.get("file");
    const mode = String(form.get("mode") || "preview");

    if (!(file instanceof File)) {
      throw ApiError.badRequest("File Excel wajib diunggah");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { rows: parsed, issues } = parseCoaSpreadsheet(buffer, file.name);

    if (parsed.length === 0) {
      return NextResponse.json({
        data: {
          mode,
          issues,
          preview: [],
          summary: { create: 0, update: 0, skip: 0, error: issues.length },
        },
        message: "Tidak ada baris valid untuk diimpor",
      });
    }

    const typeMap = await loadTypeMap();
    const existing = await loadExistingByCode(companyId);
    const preview = buildPreview(parsed, typeMap, existing);

    // Merge parse issues into preview error counts
    const summary = {
      create: preview.filter((p) => p.action === "create").length,
      update: preview.filter((p) => p.action === "update").length,
      skip: preview.filter((p) => p.action === "skip").length,
      error:
        preview.filter((p) => p.action === "error").length + issues.length,
    };

    if (mode !== "commit") {
      return NextResponse.json({
        data: { mode: "preview", issues, preview, summary },
      });
    }

    if (summary.error > 0) {
      throw ApiError.badRequest(
        "Masih ada error — perbaiki file sebelum commit"
      );
    }

    const parsedByCode = new Map(parsed.map((r) => [r.code, r]));

    await withTransaction(async (client) => {
      // Sort by level then code so parents exist first
      const ordered = [...parsed].sort(
        (a, b) => a.level - b.level || a.code.localeCompare(b.code)
      );

      const idByCode = new Map<string, string>();
      for (const [code, row] of existing) {
        idByCode.set(code, row.id);
      }

      for (const row of ordered) {
        const typeId = typeMap.get(row.account_type_code);
        if (!typeId) continue;

        let parentId: string | null = null;
        if (row.parent_code) {
          parentId = idByCode.get(row.parent_code) ?? null;
          if (!parentId) {
            throw new Error(`Parent ${row.parent_code} belum ter-resolve`);
          }
        }

        const ex = existing.get(row.code);
        if (ex) {
          await client.query(
            `UPDATE accounting.chart_of_accounts
             SET name = $1,
                 parent_id = $2,
                 account_type_id = $3,
                 level = $4,
                 is_contra = $5,
                 cash_flow_category = $6,
                 description = $7,
                 is_active = true,
                 deleted_at = NULL,
                 deleted_by = NULL,
                 updated_by = $8,
                 updated_at = now()
             WHERE id = $9`,
            [
              row.name,
              parentId,
              typeId,
              row.level,
              row.is_contra,
              row.cash_flow_category,
              row.description,
              user.id,
              ex.id,
            ]
          );
          idByCode.set(row.code, ex.id);
        } else {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO accounting.chart_of_accounts (
               company_id, code, name, parent_id, account_type_id, level,
               is_postable, is_contra, cash_flow_category, description,
               is_active, created_by, updated_by
             ) VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,true,$10,$10)
             RETURNING id`,
            [
              companyId,
              row.code,
              row.name,
              parentId,
              typeId,
              row.level,
              row.is_contra,
              row.cash_flow_category,
              row.description,
              user.id,
            ]
          );
          idByCode.set(row.code, inserted.rows[0].id);
        }
      }

      await recomputePostableForCompany(companyId, client);
      void parsedByCode;
    });

    return NextResponse.json({
      data: { mode: "commit", issues, preview, summary },
      message: `Import selesai: ${summary.create} baru, ${summary.update} update`,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/coa/import] POST", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
