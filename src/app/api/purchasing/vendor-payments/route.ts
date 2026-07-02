import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
} from "@/lib/api/scope";
import {
  computePoInvoiceAmounts,
  getReturnCreditsByPoIds,
} from "@/lib/purchasing/po-payments";
import { getVendorCreditsByPoIds } from "@/lib/purchasing/vendor-credit-service";

const INVOICE_PO_STATUSES = ["approved", "sent", "partial", "partially_received", "received"];

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// GET /api/purchasing/vendor-payments — purchase invoice / payable list by PO
export async function GET(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const search = searchParams.get("search")?.trim();

    let query = db
      .from("v_purchase_orders")
      .select(
        `
        id,
        nomor_po,
        tanggal_po,
        status,
        nama_supplier,
        payable_amount,
        paid_amount,
        outstanding_amount,
        payment_status,
        payment_progress_pct,
        payment_term_count,
        next_due_date,
        received_percentage
      `
      )
      .in("status", INVOICE_PO_STATUSES)
      .gt("payable_amount", 0)
      .order("next_due_date", { ascending: true, nullsFirst: false });

    const scope = await getApiUserScope();
    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    if (search) {
      query = query.or(`nomor_po.ilike.%${search}%,nama_supplier.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const poIds = (data || []).map((row) => row.id).filter(Boolean) as string[];
    const [returnCredits, rejectCredits] = await Promise.all([
      getReturnCreditsByPoIds(db, poIds),
      getVendorCreditsByPoIds(db, poIds),
    ]);

    const mapped = (data || []).map((row) => {
      const grossPayable = Number(row.payable_amount || 0);
      const returnCredit = returnCredits.get(row.id) || 0;
      const rejectCredit = rejectCredits.get(row.id) || 0;
      const amounts = computePoInvoiceAmounts({
        grossPayable,
        returnCredit,
        rejectCredit,
        paidAmount: Number(row.paid_amount || 0),
        nextDueDate: row.next_due_date,
      });

      return {
        purchase_order_id: row.id,
        nomor_po: row.nomor_po,
        tanggal_po: row.tanggal_po,
        nama_supplier: row.nama_supplier,
        po_status: row.status,
        gross_payable_amount: amounts.gross_payable_amount,
        return_credit_amount: amounts.return_credit_amount,
        reject_credit_amount: amounts.reject_credit_amount,
        total_credit_amount: amounts.total_credit_amount,
        payable_amount: amounts.payable_amount,
        paid_amount: amounts.paid_amount,
        outstanding_amount: amounts.outstanding_amount,
        payment_term_count: Number(row.payment_term_count || 0),
        payment_progress_pct: amounts.payment_progress_pct,
        received_percentage: Number(row.received_percentage || 0),
        next_due_date: row.next_due_date,
        payment_status: amounts.payment_status,
        can_pay: amounts.outstanding_amount > 0.01,
      };
    });

    const filtered =
      status && status !== "all"
        ? mapped.filter((row) => row.payment_status === status)
        : mapped;

    return NextResponse.json({ success: true, data: filtered });
  } catch (error: unknown) {
    console.error("Error fetching purchase invoices:", error);
    return NextResponse.json(
      { success: false, message: getErrorMessage(error, "Failed to load purchase invoices") },
      { status: 500 }
    );
  }
}
