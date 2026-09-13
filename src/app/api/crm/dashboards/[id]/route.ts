import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { noContentResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import {
  canManageShared, loadAccessibleReport, parseStoredDefinition, requireReportUser, runReportDefinition,
  type ReportResult,
} from "@/lib/crm/report-builder-server";
import type { ReportDataset } from "@/lib/crm/report-builder";

interface DashboardRow { id: string; company_id: string | null; name: string; description: string | null; is_default: boolean; created_by: string | null }
interface WidgetRow {
  id: string; report_id: string; title: string | null; widget_type: string; width: number; sort_order: number;
  report_name: string; dataset: ReportDataset; definition: unknown;
}

async function loadDashboard(id: string, companyId: string | null | undefined): Promise<DashboardRow | null> {
  const params: unknown[] = [id];
  let where = "id = $1 AND deleted_at IS NULL";
  if (companyId) {
    params.push(companyId);
    where += ` AND (company_id IS NULL OR company_id = $${params.length})`;
  }
  return queryOne<DashboardRow>(`SELECT id, company_id, name, description, is_default, created_by FROM crm.crm_dashboards WHERE ${where}`, params);
}

/** GET = dashboard + widget beserta hasil tiap report. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireReportUser();
  if (error) return error;
  const { id } = await params;
  const dashboard = await loadDashboard(id, scope?.companyId);
  if (!dashboard) return NextResponse.json({ success: false, error: "Dashboard tidak ditemukan" }, { status: 404 });
  const widgets = await query<WidgetRow>(
    `SELECT w.id, w.report_id, w.title, w.widget_type, w.width, w.sort_order,
            r.name AS report_name, r.dataset, r.definition
     FROM crm.crm_dashboard_widgets w
     JOIN crm.crm_reports r ON r.id = w.report_id AND r.deleted_at IS NULL
     WHERE w.dashboard_id = $1
     ORDER BY w.sort_order, w.id`,
    [id]
  );
  const results = await Promise.all(
    widgets.map(async (w) => {
      // Report yang tidak boleh dilihat user ini tampil kosong, bukan menggagalkan dashboard.
      const allowed = await loadAccessibleReport(w.report_id, user, scope);
      if (!allowed) return null;
      const definition = parseStoredDefinition(w.dataset, w.definition);
      try {
        return { definition, result: await runReportDefinition(definition, user, scope) };
      } catch {
        return null;
      }
    })
  );
  return successResponse({
    dashboard,
    widgets: widgets.map((w, i) => ({
      id: w.id, report_id: w.report_id, title: w.title ?? w.report_name, widget_type: w.widget_type,
      width: w.width, sort_order: w.sort_order, report_name: w.report_name, dataset: w.dataset,
      definition: results[i]?.definition ?? null,
      result: (results[i]?.result ?? null) as ReportResult | null,
    })),
  });
}

const widgetSchema = z.object({
  report_id: z.string().uuid(),
  title: z.string().trim().max(120).optional().nullable(),
  widget_type: z.enum(["chart", "kpi", "table"]).default("chart"),
  width: z.number().int().min(1).max(3).default(1),
});
const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  is_default: z.boolean().optional(),
  widgets: z.array(widgetSchema).max(24).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireReportUser();
  if (error) return error;
  const { id } = await params;
  const dashboard = await loadDashboard(id, scope?.companyId);
  if (!dashboard) return NextResponse.json({ success: false, error: "Dashboard tidak ditemukan" }, { status: 404 });
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  if (b.is_default !== undefined && !canManageShared(user)) {
    return NextResponse.json({ success: false, error: "Hanya admin yang bisa menetapkan dashboard Overview" }, { status: 403 });
  }
  if (b.widgets) {
    for (const w of b.widgets) {
      if (!(await loadAccessibleReport(w.report_id, user, scope))) {
        return NextResponse.json({ success: false, error: "Ada report yang tidak bisa diakses" }, { status: 400 });
      }
    }
  }
  await withTransaction(async (client) => {
    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    const push = (col: string, v: unknown) => { values.push(v); sets.push(`${col} = $${values.length}`); };
    if (b.name !== undefined) push("name", b.name);
    if (b.description !== undefined) push("description", b.description ?? null);
    if (b.is_default === true) {
      await client.query(
        `UPDATE crm.crm_dashboards SET is_default = false, updated_at = now()
         WHERE is_default AND deleted_at IS NULL AND id <> $1
           AND COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
        [id, dashboard.company_id]
      );
      push("is_default", true);
    } else if (b.is_default === false) push("is_default", false);
    if (values.length > 0) {
      values.push(id);
      await client.query(`UPDATE crm.crm_dashboards SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
    }
    if (b.widgets) {
      await client.query(`DELETE FROM crm.crm_dashboard_widgets WHERE dashboard_id = $1`, [id]);
      let order = 0;
      for (const w of b.widgets) {
        await client.query(
          `INSERT INTO crm.crm_dashboard_widgets (dashboard_id, report_id, title, widget_type, width, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, w.report_id, w.title ?? null, w.widget_type, w.width, order++]
        );
      }
    }
  });
  return successResponse({ id }, "Dashboard diperbarui");
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireReportUser();
  if (error) return error;
  const { id } = await params;
  const dashboard = await loadDashboard(id, scope?.companyId);
  if (!dashboard) return NextResponse.json({ success: false, error: "Dashboard tidak ditemukan" }, { status: 404 });
  if (dashboard.created_by !== user.id && !canManageShared(user)) {
    return NextResponse.json({ success: false, error: "Hanya pembuat atau admin yang bisa menghapus dashboard ini" }, { status: 403 });
  }
  await query(`UPDATE crm.crm_dashboards SET deleted_at = now(), is_default = false WHERE id = $1`, [id]);
  return noContentResponse();
}
