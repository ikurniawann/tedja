import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import {
  TICKETING_OPERATOR_ROLES,
  requireTicketingContext,
} from "@/lib/ticketing/server";
import { computeTabSummary, settlementPlan } from "@/lib/ticketing/tab";

interface VisitRow {
  id: string;
  contact_name: string;
  contact_phone: string | null;
  payment_mode: "postpaid" | "prepaid";
  credit_limit: string | null;
  status: string;
  opened_at: string;
  settled_at: string | null;
  notes: string | null;
}

interface VisitBandRow {
  id: string;
  band_id: string;
  nfc_uid: string;
  label: string | null;
  ticket_type_id: string;
  ticket_type_name: string;
  entered_at: string | null;
  status: string;
}

interface ChargeRow {
  id: string;
  band_id: string | null;
  charge_type: string;
  direction: "debit" | "kredit";
  description: string;
  amount: string;
  payment_method: string | null;
  pos_order_id: string | null;
  voided_by_charge_id: string | null;
  created_at: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  try {
    const { id } = await params;
    const visit = await queryOne<VisitRow>(
      `SELECT id, contact_name, contact_phone, payment_mode, credit_limit,
              status, opened_at, settled_at, notes
       FROM ticketing.ticket_visits
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (!visit) {
      return NextResponse.json(
        { success: false, error: "Kunjungan tidak ditemukan" },
        { status: 404 }
      );
    }

    const [bands, charges] = await Promise.all([
      query<VisitBandRow>(
        `SELECT vb.id, vb.band_id, b.nfc_uid, b.label, vb.ticket_type_id,
                t.name AS ticket_type_name, vb.entered_at, vb.status
         FROM ticketing.ticket_visit_bands vb
         JOIN ticketing.ticket_bands b ON b.id = vb.band_id
         JOIN ticketing.ticket_types t ON t.id = vb.ticket_type_id
         WHERE vb.visit_id = $1
         ORDER BY vb.created_at`,
        [id]
      ),
      query<ChargeRow>(
        `SELECT id, band_id, charge_type, direction, description, amount,
                payment_method, pos_order_id, voided_by_charge_id, created_at
         FROM ticketing.ticket_visit_charges
         WHERE visit_id = $1
         ORDER BY created_at, id`,
        [id]
      ),
    ]);

    const summary = computeTabSummary(
      charges.map((c) => ({ direction: c.direction, amount: Number(c.amount) }))
    );
    const plan = settlementPlan(summary);

    return successResponse({
      visit: {
        ...visit,
        credit_limit:
          visit.credit_limit === null ? null : Number(visit.credit_limit),
      },
      bands,
      charges: charges.map((c) => ({ ...c, amount: Number(c.amount) })),
      summary,
      plan,
    });
  } catch (err) {
    console.error("[ticketing] visit detail error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat rincian kunjungan" },
      { status: 500 }
    );
  }
}
