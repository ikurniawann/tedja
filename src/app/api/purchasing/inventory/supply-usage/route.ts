// EPIC-026 C2 — Pemakaian/pengeluaran barang operasional (stok keluar).
// GET  /api/purchasing/inventory/supply-usage  → daftar
// POST /api/purchasing/inventory/supply-usage  → buat pemakaian (kurangi stok)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  getApiUserScope,
  effectiveCompanyId,
  effectiveBranchId,
} from "@/lib/api/scope";
import { reduceSupplyStock } from "@/lib/purchasing/supply-inventory";

const WRITE_ROLES = [
  "super_admin",
  "purchasing_admin",
  "purchasing_manager",
  "purchasing_staff",
  "warehouse_admin",
  "warehouse_staff",
] as const;

const usageSchema = z.object({
  warehouse_id: z.string().uuid("Gudang wajib dipilih"),
  tanggal: z.string().optional(),
  divisi: z.string().optional(),
  keperluan: z.string().optional(),
  catatan: z.string().optional(),
  items: z
    .array(
      z.object({
        supply_item_id: z.string().uuid(),
        qty: z.number().positive("Qty harus lebih dari 0"),
        catatan: z.string().optional(),
      })
    )
    .min(1, "Minimal satu barang"),
});

async function generateUsageNumber(): Promise<string> {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM supply_usages WHERE nomor LIKE $1`,
    [`PMK-${ymd}-%`]
  );
  const seq = Number(rows[0]?.n ?? 0) + 1;
  return `PMK-${ymd}-${String(seq).padStart(4, "0")}`;
}

export async function GET() {
  try {
    const scope = await getApiUserScope();
    if (!scope) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }
    const branchFilter = scope.isUnscoped ? null : scope.branchId;

    const rows = await query(
      `SELECT su.id, su.nomor, su.tanggal, su.warehouse_id, w.name AS warehouse_nama,
              su.divisi, su.keperluan, su.total_items, su.created_at
       FROM supply_usages su
       LEFT JOIN configuration.warehouses w ON w.id = su.warehouse_id
       WHERE ($1::uuid IS NULL OR su.branch_id = $1 OR su.branch_id IS NULL)
       ORDER BY su.tanggal DESC, su.created_at DESC
       LIMIT 100`,
      [branchFilter]
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error("Error listing supply usage:", error);
    return NextResponse.json(
      { success: false, message: "Gagal memuat pemakaian barang" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const validated = usageSchema.parse(await request.json());

    const companyId = effectiveCompanyId(scope);
    const branchId = effectiveBranchId(scope);

    // Pra-validasi: pastikan semua item punya saldo cukup sebelum mengurangi apa pun.
    for (const item of validated.items) {
      const rows = await query<{ qty: string; warehouse_id: string | null }>(
        `SELECT COALESCE(qty_available,0)::text AS qty, warehouse_id
         FROM supply_inventory
         WHERE supply_item_id = $1
           AND COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
           AND is_active = true`,
        [item.supply_item_id, validated.warehouse_id]
      );
      const available = Number(rows[0]?.qty ?? 0);
      if (item.qty > available) {
        return NextResponse.json(
          {
            success: false,
            message: `Stok tidak cukup untuk salah satu barang (tersedia ${available}, diminta ${item.qty})`,
          },
          { status: 400 }
        );
      }
    }

    const nomor = await generateUsageNumber();

    const { data: header, error: headerError } = await db
      .from("supply_usages")
      .insert({
        nomor,
        tanggal: validated.tanggal || new Date().toISOString().split("T")[0],
        warehouse_id: validated.warehouse_id,
        divisi: validated.divisi || null,
        keperluan: validated.keperluan || null,
        catatan: validated.catatan || null,
        total_items: validated.items.length,
        company_id: companyId,
        branch_id: branchId,
        created_by: user.id,
      })
      .select("id, nomor")
      .single();

    if (headerError || !header) {
      throw ApiError.server(headerError?.message || "Gagal menyimpan pemakaian");
    }

    for (const item of validated.items) {
      const { unitCost } = await reduceSupplyStock(db, {
        supplyItemId: item.supply_item_id,
        warehouseId: validated.warehouse_id,
        qty: item.qty,
        referenceType: "usage",
        referenceId: header.id,
        referenceNumber: header.nomor,
        alasan: validated.keperluan || `Pemakaian ${header.nomor}`,
        catatan: item.catatan || null,
        companyId,
        branchId,
        userId: user.id,
      });

      await db.from("supply_usage_items").insert({
        usage_id: header.id,
        supply_item_id: item.supply_item_id,
        qty: item.qty,
        unit_cost: unitCost,
        catatan: item.catatan || null,
      });
    }

    return NextResponse.json({
      success: true,
      data: header,
      message: `Pemakaian ${header.nomor} tercatat`,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, message: "Validasi gagal", errors: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    console.error("Error creating supply usage:", error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Gagal menyimpan pemakaian" },
      { status: 500 }
    );
  }
}
