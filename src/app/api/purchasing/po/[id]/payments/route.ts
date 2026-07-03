import { NextRequest } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import {
  getPoPayableContext,
  resolvePaymentTermId,
} from "@/lib/purchasing/po-payments";
import { z } from "zod";

const PAYMENT_ROLES = ["super_admin", "purchasing_admin", "finance_staff"] as const;

const paymentSchema = z.object({
  payment_term_id: z.string().uuid().optional().nullable(),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amount: z.number().positive(),
  method: z.enum(["cash", "bank_transfer", "giro", "qris", "other"]).default("bank_transfer"),
  reference_number: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function generatePaymentNumber(db: import("@/lib/pg/types").DbClient) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const prefix = `VP-${year}${month}${day}`;

  const { data, error } = await db
    .from("vendor_payments")
    .select("payment_number")
    .ilike("payment_number", `${prefix}-%`)
    .order("payment_number", { ascending: false })
    .limit(1);

  if (error) throw error;

  const lastNumber = data?.[0]?.payment_number?.split("-").pop();
  const nextNumber = Number(lastNumber || 0) + 1;
  return `${prefix}-${String(nextNumber).padStart(4, "0")}`;
}

async function recalculateTerm(db: import("@/lib/pg/types").DbClient, termId: string) {
  const { data: term, error: termError } = await db
    .from("purchase_order_payment_terms")
    .select("id, amount, due_date")
    .eq("id", termId)
    .single();

  if (termError || !term) return;

  const { data: payments, error: paymentsError } = await db
    .from("vendor_payments")
    .select("amount")
    .eq("payment_term_id", termId)
    .eq("status", "posted");

  if (paymentsError) throw paymentsError;

  const paidAmount = (payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const termAmount = Number(term.amount || 0);
  const dueDate = term.due_date ? new Date(`${term.due_date}T00:00:00`) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const status =
    paidAmount >= termAmount
      ? "paid"
      : paidAmount > 0
      ? "partial"
      : dueDate && dueDate < today
      ? "overdue"
      : "unpaid";

  const { error } = await db
    .from("purchase_order_payment_terms")
    .update({ paid_amount: paidAmount, status, updated_at: new Date().toISOString() })
    .eq("id", termId);

  if (error) throw error;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiRole([...PAYMENT_ROLES]);
    const { id } = await params;
    const db = createPgClient();
    const body = await request.json();
    const validated = paymentSchema.parse(body);
    const paymentDate = validated.payment_date || new Date().toISOString().slice(0, 10);

    const ctx = await getPoPayableContext(db, id);
    if (!ctx) {
      return Response.json({ success: false, message: "Purchase order not found" }, { status: 404 });
    }

    if (ctx.outstandingAmount <= 0) {
      return Response.json(
        { success: false, message: "This purchase order is already fully paid" },
        { status: 400 }
      );
    }

    const termId = await resolvePaymentTermId(
      db,
      id,
      ctx.supplierId,
      validated.amount,
      paymentDate,
      validated.payment_term_id
    );

    const paymentNumber = await generatePaymentNumber(db);
    const { data, error } = await db
      .from("vendor_payments")
      .insert({
        payment_number: paymentNumber,
        purchase_order_id: id,
        payment_term_id: termId,
        supplier_id: ctx.supplierId,
        payment_date: paymentDate,
        amount: validated.amount,
        method: validated.method,
        reference_number: validated.reference_number || null,
        notes: validated.notes || null,
        status: "posted",
      })
      .select()
      .single();

    if (error) throw error;

    await recalculateTerm(db, termId);

    const isFullPayment = validated.amount >= ctx.outstandingAmount - 0.01;

    return Response.json(
      {
        success: true,
        data,
        message: isFullPayment
          ? "Full payment recorded. Purchase order is now paid."
          : "Payment recorded successfully",
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error creating vendor payment:", error);
    if (error instanceof z.ZodError) {
      return Response.json(
        { success: false, message: "Validation failed", errors: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const message = getErrorMessage(error, "Failed to record payment");
    const status = message.includes("cannot exceed") ? 400 : 500;
    return Response.json({ success: false, message }, { status });
  }
}
