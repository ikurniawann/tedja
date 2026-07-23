import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import { requireFinanceRole } from "@/lib/finance/server";
import { requireCompanyScope } from "@/lib/sales-funnel/server";

// EPIC-025 — daftar invoice lintas-deal untuk modul Finance:
// pengajuan sales masuk sini (status 'diajukan'), finance memproses.

const INVOICE_STATUSES = ["diajukan", "draft", "terkirim", "batal"] as const;
const MAX_ROWS = 300;

export async function GET(request: NextRequest) {
  const { error, user } = await requireFinanceRole();
  if (error) return error;

  try {
    const scope = await getApiUserScope();
    const scopeError = requireCompanyScope(user, scope);
    if (scopeError) return scopeError;

    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "";
    const q = url.searchParams.get("q")?.trim() ?? "";

    const conditions: string[] = ["i.deleted_at IS NULL"];
    const params: unknown[] = [];
    const add = (fragment: string, value: unknown) => {
      params.push(value);
      conditions.push(fragment.replace("?", `$${params.length}`));
    };

    // Tenant isolation fail-closed — pola list deals sales-funnel
    if (scope?.companyId) add("i.company_id = ?", scope.companyId);
    if (scope?.businessScope === "branch" && scope.branchId) {
      add("i.branch_id = ?", scope.branchId);
    }
    if (status && (INVOICE_STATUSES as readonly string[]).includes(status)) {
      add("i.status = ?", status);
    }
    if (q) {
      params.push(`%${q}%`);
      conditions.push(
        `(i.invoice_number ILIKE $${params.length}
          OR l.org_name ILIKE $${params.length}
          OR d.title ILIKE $${params.length})`
      );
    }

    const rows = await query<{
      id: string;
      invoice_number: string;
      label: string;
      amount: string;
      due_date: string | null;
      status: string;
      sent_at: string | null;
      note: string | null;
      created_at: string;
      deal_id: string;
      deal_title: string;
      org_name: string;
      pic_name: string;
      quote_number: string | null;
      created_by_name: string | null;
      paid: string;
    }>(
      `SELECT i.id, i.invoice_number, i.label, i.amount,
              i.due_date::text AS due_date, i.status, i.sent_at, i.note,
              i.created_at, i.deal_id,
              d.title AS deal_title, l.org_name, l.pic_name,
              q.quote_number, u.full_name AS created_by_name,
              COALESCE(
                (SELECT SUM(p.amount) FROM crm.crm_sales_deal_payments p
                 WHERE p.invoice_id = i.id AND p.deleted_at IS NULL),
                0
              ) AS paid
       FROM crm.crm_sales_invoices i
       JOIN crm.crm_sales_deals d ON d.id = i.deal_id
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
       LEFT JOIN crm.crm_sales_quotations q ON q.id = i.quotation_id
       LEFT JOIN configuration.users u ON u.id = i.created_by
       WHERE ${conditions.join(" AND ")}
       ORDER BY (i.status = 'diajukan') DESC, i.created_at DESC
       LIMIT ${MAX_ROWS}`,
      params
    );

    return successResponse(
      rows.map((row) => {
        const amount = Number(row.amount);
        const paid = Number(row.paid);
        return {
          id: row.id,
          invoice_number: row.invoice_number,
          label: row.label,
          amount,
          due_date: row.due_date,
          status: row.status,
          sent_at: row.sent_at,
          note: row.note,
          created_at: row.created_at,
          deal_id: row.deal_id,
          deal_title: row.deal_title,
          org_name: row.org_name,
          pic_name: row.pic_name,
          quote_number: row.quote_number,
          created_by_name: row.created_by_name,
          paid,
          payment_status:
            amount > 0 && paid >= amount
              ? "lunas"
              : paid > 0
                ? "sebagian"
                : "belum",
          outstanding: Math.max(0, Math.round((amount - paid) * 100) / 100),
        };
      })
    );
  } catch (err) {
    console.error("[finance] list invoices error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat invoice" },
      { status: 500 }
    );
  }
}
