// ============================================
// API ROUTE: /api/purchasing/suppliers/[id]/price-history
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";

interface RouteParams {
  params: Promise<{ id: string }>;
}

type GrnRow = {
  id: string;
  nomor_grn: string | null;
  tanggal_penerimaan: string | null;
};

type MovementRow = {
  id: string;
  raw_material_id: string;
  jumlah: number | null;
  unit_cost: number | null;
  reference_id: string | null;
  reference_number: string | null;
  created_at: string;
};

type MaterialRow = {
  id: string;
  nama: string | null;
  satuan_besar_id: string | null;
  satuan_kecil_id: string | null;
};

const GRN_SCAN_LIMIT = 1000;
const MOVEMENT_SCAN_LIMIT = 1000;

/**
 * Purchase price history is derived from what was actually received from this
 * supplier (GRN), so the numbers reflect real spending instead of a maintained
 * price list. Costs are stored per material base unit.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const db = await createServerPgClient();
    const { id: supplierId } = await params;
    const { searchParams } = new URL(request.url);

    const materialId = searchParams.get("material_id");
    const months = Math.max(1, parseInt(searchParams.get("months") || "6", 10));
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const { data: grnRows, error: grnError } = await db
      .from("grn")
      .select("id, nomor_grn, tanggal_penerimaan")
      .eq("supplier_id", supplierId)
      .gte("tanggal_penerimaan", startDate.toISOString().split("T")[0])
      .order("tanggal_penerimaan", { ascending: false })
      .limit(GRN_SCAN_LIMIT);

    if (grnError) throw grnError;

    const grns = (grnRows || []) as GrnRow[];
    const grnMap = new Map(grns.map((grn) => [grn.id, grn]));

    if (grns.length === 0) {
      return Response.json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, total_pages: 0 },
      });
    }

    let movementQuery = db
      .from("inventory_movements")
      .select(
        "id, raw_material_id, jumlah, unit_cost, reference_id, reference_number, created_at"
      )
      .eq("tipe", "in")
      .eq("reference_type", "grn")
      .in("reference_id", Array.from(grnMap.keys()))
      .order("created_at", { ascending: false })
      .limit(MOVEMENT_SCAN_LIMIT);

    if (materialId) {
      movementQuery = movementQuery.eq("raw_material_id", materialId);
    }

    const { data: movementRows, error: movementError } = await movementQuery;
    if (movementError) throw movementError;

    const movements = ((movementRows || []) as MovementRow[]).filter(
      (movement) => Number(movement.unit_cost || 0) > 0
    );

    const materialIds = Array.from(new Set(movements.map((movement) => movement.raw_material_id)));
    const [{ data: materialRows }, { data: supplierRow }] = await Promise.all([
      materialIds.length > 0
        ? db
            .from("raw_materials")
            .select("id, nama, satuan_besar_id, satuan_kecil_id")
            .in("id", materialIds)
        : Promise.resolve({ data: [] as MaterialRow[] }),
      db.from("suppliers").select("nama_supplier").eq("id", supplierId).maybeSingle(),
    ]);

    const materials = (materialRows || []) as MaterialRow[];
    const unitIds = Array.from(
      new Set(
        materials
          .map((material) => material.satuan_kecil_id || material.satuan_besar_id)
          .filter(Boolean) as string[]
      )
    );

    const { data: unitRows } = unitIds.length > 0
      ? await db.from("units").select("id, nama").in("id", unitIds)
      : { data: [] as { id: string; nama: string | null }[] };

    const unitMap = new Map(
      ((unitRows || []) as { id: string; nama: string | null }[]).map((unit) => [unit.id, unit.nama])
    );
    const materialMap = new Map(materials.map((material) => [material.id, material]));
    const supplierName =
      (supplierRow as { nama_supplier?: string } | null)?.nama_supplier || "";

    // Oldest first so each receipt can be compared with the previous one.
    const ascending = [...movements].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const lastPriceByMaterial = new Map<string, number>();

    const enriched = ascending.map((movement) => {
      const material = materialMap.get(movement.raw_material_id);
      const grn = movement.reference_id ? grnMap.get(movement.reference_id) : undefined;
      const harga = Number(movement.unit_cost || 0);
      const previousPrice = lastPriceByMaterial.get(movement.raw_material_id) ?? null;
      lastPriceByMaterial.set(movement.raw_material_id, harga);

      const baseUnitId = material?.satuan_kecil_id || material?.satuan_besar_id || null;

      return {
        id: movement.id,
        supplier_id: supplierId,
        nama_supplier: supplierName,
        bahan_baku_id: movement.raw_material_id,
        bahan_baku_nama: material?.nama || "-",
        harga,
        qty: Number(movement.jumlah || 0),
        satuan_nama: (baseUnitId ? unitMap.get(baseUnitId) : null) || "",
        tanggal: grn?.tanggal_penerimaan || movement.created_at,
        reference_number: movement.reference_number || grn?.nomor_grn || null,
        previous_price: previousPrice,
        price_change_percent:
          previousPrice && previousPrice > 0
            ? ((harga - previousPrice) / previousPrice) * 100
            : null,
      };
    });

    const history = enriched.reverse();
    const from = (page - 1) * limit;

    return Response.json({
      success: true,
      data: history.slice(from, from + limit),
      pagination: {
        page,
        limit,
        total: history.length,
        total_pages: Math.ceil(history.length / limit),
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching supplier purchase price history:", error);
    return Response.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "Gagal mengambil histori harga pembelian",
      },
      { status: 500 }
    );
  }
}
