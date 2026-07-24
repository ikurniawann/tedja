import { NextRequest } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import {
  getPoPayableContext,
  normalizeTermDescription,
  resolvePoPaymentParty,
} from "@/lib/purchasing/po-payments";
import { z } from "zod";

const termSchema = z.object({
  term_no: z.number().int().min(1).optional(),
  description: z.string().min(1).default("Termin"),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().min(0),
  notes: z.string().optional().nullable(),
});

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = createPgClient();

    const [{ data: terms, error: termsError }, { data: payments, error: paymentsError }] = await Promise.all([
      db
        .from("purchase_order_payment_terms")
        .select("*")
        .eq("purchase_order_id", id)
        .eq("is_active", true)
        .order("term_no", { ascending: true }),
      db
        .from("vendor_payments")
        .select("*")
        .eq("purchase_order_id", id)
        .neq("status", "void")
        .order("payment_date", { ascending: false }),
    ]);

    if (termsError) throw termsError;
    if (paymentsError) throw paymentsError;

    return Response.json({ success: true, data: { terms: terms || [], payments: payments || [] } });
  } catch (error: unknown) {
    console.error("Error fetching PO payment terms:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal mengambil termin pembayaran PO") },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = createPgClient();
    const body = await request.json();
    const validated = termSchema.parse(body);

    const ctx = await getPoPayableContext(db, id);

    if (!ctx) {
      return Response.json({ success: false, message: "Purchase order not found" }, { status: 404 });
    }

    const party = resolvePoPaymentParty(ctx);
    const payableAmount = ctx.payableAmount ?? 0;

    const { data: existingTerms, error: existingTermsError } = await db
      .from("purchase_order_payment_terms")
      .select("amount")
      .eq("purchase_order_id", id)
      .eq("is_active", true);

    if (existingTermsError) throw existingTermsError;

    const scheduledAmount = (existingTerms || []).reduce(
      (sum, term) => sum + Number(term.amount || 0),
      0
    );
    const remainingSchedulable = Math.max(0, payableAmount - scheduledAmount);

    if (validated.amount > remainingSchedulable + 0.01) {
      return Response.json(
        {
          success: false,
          message: `Payment term amount cannot exceed remaining schedulable amount (${remainingSchedulable})`,
        },
        { status: 400 }
      );
    }

    const { data: latestTerm, error: latestError } = await db
      .from("purchase_order_payment_terms")
      .select("term_no")
      .eq("purchase_order_id", id)
      .eq("is_active", true)
      .order("term_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) throw latestError;

    const termNo = validated.term_no || Number(latestTerm?.term_no || 0) + 1;
    const description = normalizeTermDescription(
      validated.description,
      validated.amount,
      payableAmount,
      termNo
    );

    const { data, error } = await db
      .from("purchase_order_payment_terms")
      .insert({
        purchase_order_id: id,
        supplier_id: party.supplier_id,
        vendor_id: party.vendor_id,
        term_no: termNo,
        description,
        due_date: validated.due_date,
        amount: validated.amount,
        notes: validated.notes || null,
        status: validated.amount <= 0 ? "paid" : "unpaid",
      })
      .select()
      .single();

    if (error) throw error;

    return Response.json(
      { success: true, data, message: "Payment term added successfully" },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Error creating PO payment term:", error);
    if (error instanceof z.ZodError) {
      return Response.json(
        { success: false, message: "Validation failed", errors: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    return Response.json(
      { success: false, message: getErrorMessage(error, "Failed to create payment term") },
      { status: 500 }
    );
  }
}
