import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";

const querySchema = z.object({
  item_type: z.enum(["raw_material", "product"]).default("raw_material"),
  material_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
  warehouse_id: z.string().uuid().optional(),
  search: z.string().optional(),
  tipe: z.enum(["all", "in", "out", "adjustment", "transfer", "return"]).default("all"),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  limit: z.coerce.number().min(1).max(500).default(200),
});

type StockItemRow = {
  id: string;
  kode?: string | null;
  nama?: string | null;
  kategori?: string | null;
  satuan?: string | null;
  lokasi_rak?: string | null;
  qty_onhand?: number | string | null;
  avg_cost?: number | string | null;
  min_stock?: number | string | null;
  max_stock?: number | string | null;
  status_stok?: string | null;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
};

type MovementRow = {
  id: string;
  item_id: string;
  tipe: "in" | "out" | "adjustment" | "transfer" | "return";
  jumlah?: number | string | null;
  qty_before?: number | string | null;
  qty_after?: number | string | null;
  unit_cost?: number | string | null;
  total_cost?: number | string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  reference_number?: string | null;
  alasan?: string | null;
  catatan?: string | null;
  created_at?: string | null;
  warehouse_id?: string | null;
  item?: {
    id?: string | null;
    kode?: string | null;
    nama?: string | null;
    kategori?: string | null;
  } | null;
};

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function endOfDay(date: string) {
  return `${date}T23:59:59.999Z`;
}

function startOfDay(date: string) {
  return `${date}T00:00:00.000Z`;
}

function normalizeItem(row: StockItemRow) {
  return {
    id: row.id,
    kode: row.kode || "",
    nama: row.nama || row.id,
    kategori: row.kategori || "-",
    satuan: row.satuan || "",
    lokasi_rak: row.lokasi_rak || row.warehouse_name || "-",
    qty_onhand: toNumber(row.qty_onhand),
    avg_cost: toNumber(row.avg_cost),
    min_stock: toNumber(row.min_stock),
    max_stock: row.max_stock == null ? null : toNumber(row.max_stock),
    status_stok: row.status_stok || "AMAN",
    warehouse_id: row.warehouse_id || null,
    warehouse_name: row.warehouse_name || null,
  };
}

function normalizeMovement(row: MovementRow, fallbackCostByItem: Map<string, number>) {
  const unitCost = toNumber(row.unit_cost) || fallbackCostByItem.get(row.item_id) || 0;
  const totalCost = toNumber(row.total_cost) || Math.abs(toNumber(row.jumlah)) * unitCost;

  return {
    id: row.id,
    item_id: row.item_id,
    raw_material_id: row.item_id,
    material_kode: row.item?.kode || "",
    material_nama: row.item?.nama || row.item_id,
    material_kategori: row.item?.kategori || "-",
    item_kode: row.item?.kode || "",
    item_nama: row.item?.nama || row.item_id,
    item_kategori: row.item?.kategori || "-",
    tipe: row.tipe,
    jumlah: toNumber(row.jumlah),
    qty_before: toNumber(row.qty_before),
    qty_after: toNumber(row.qty_after),
    unit_cost: unitCost,
    total_cost: totalCost,
    reference_type: row.reference_type || "-",
    reference_id: row.reference_id || null,
    reference_number: row.reference_number || "-",
    alasan: row.alasan || "-",
    catatan: row.catatan || "",
    created_at: row.created_at,
    warehouse_id: row.warehouse_id || null,
  };
}

function buildSummary(
  movements: ReturnType<typeof normalizeMovement>[],
  openingBalance: number,
  fallbackClosing: number
) {
  return movements.reduce(
    (acc, movement) => {
      if (movement.tipe === "in") acc.total_in += movement.jumlah;
      if (movement.tipe === "out") acc.total_out += movement.jumlah;
      if (movement.tipe === "return") acc.total_return += movement.jumlah;
      if (movement.tipe === "transfer") acc.total_transfer += movement.jumlah;
      if (movement.tipe === "adjustment") {
        const diff = movement.qty_after - movement.qty_before;
        if (diff >= 0) acc.total_adjustment_in += diff;
        else acc.total_adjustment_out += Math.abs(diff);
      }
      acc.total_value += movement.total_cost || movement.jumlah * movement.unit_cost;
      acc.closing_balance = movement.qty_after;
      return acc;
    },
    {
      opening_balance: openingBalance,
      closing_balance: movements.at(-1)?.qty_after ?? fallbackClosing,
      total_in: 0,
      total_out: 0,
      total_adjustment_in: 0,
      total_adjustment_out: 0,
      total_return: 0,
      total_transfer: 0,
      total_value: 0,
      movement_count: movements.length,
    }
  );
}

async function getRawMaterialStockCard(
  db: ReturnType<typeof createPgClient>,
  params: z.infer<typeof querySchema>,
  dateFrom?: string,
  dateTo?: string
) {
  const selectedId = params.item_id || params.material_id;

  let materialsQuery = db
    .from("v_raw_materials_stock")
    .select("*")
    .eq("is_active", true)
    .order("nama", { ascending: true });

  if (params.search) {
    materialsQuery = materialsQuery.or(
      `nama.ilike.%${params.search}%,kode.ilike.%${params.search}%`
    );
  }

  const { data: materialsData, error: materialsError } = await materialsQuery;
  if (materialsError) throw materialsError;

  let materials = ((materialsData || []) as StockItemRow[]).map(normalizeItem);

  if (params.warehouse_id) {
    const { data: invRows, error: invError } = await db
      .from("inventory")
      .select("raw_material_id")
      .eq("warehouse_id", params.warehouse_id)
      .eq("is_active", true);
    if (invError) throw invError;
    const allowed = new Set(
      ((invRows || []) as { raw_material_id: string }[]).map((r) => r.raw_material_id)
    );
    materials = materials.filter((m) => allowed.has(m.id));
  }

  const selectedItem = selectedId
    ? materials.find((material) => material.id === selectedId) || null
    : null;

  let movementsQuery = db
    .from("inventory_movements")
    .select(`
      id,
      raw_material_id,
      warehouse_id,
      tipe,
      jumlah,
      qty_before,
      qty_after,
      unit_cost,
      total_cost,
      reference_type,
      reference_id,
      reference_number,
      alasan,
      catatan,
      created_at
    `)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(params.limit);

  if (selectedId) movementsQuery = movementsQuery.eq("raw_material_id", selectedId);
  if (params.warehouse_id) movementsQuery = movementsQuery.eq("warehouse_id", params.warehouse_id);
  if (params.tipe !== "all") movementsQuery = movementsQuery.eq("tipe", params.tipe);
  if (dateFrom) movementsQuery = movementsQuery.gte("created_at", dateFrom);
  if (dateTo) movementsQuery = movementsQuery.lte("created_at", dateTo);

  const { data: movementsData, error: movementsError } = await movementsQuery;
  if (movementsError) throw movementsError;

  const rawMovementRows = (movementsData || []) as Array<Record<string, unknown>>;
  const movementItemIds = Array.from(
    new Set(rawMovementRows.map((row) => String(row.raw_material_id)).filter(Boolean))
  );

  const materialById = new Map(
    materials.map((material) => [material.id, material])
  );

  if (movementItemIds.length > 0) {
    const missingIds = movementItemIds.filter((id) => !materialById.has(id));
    if (missingIds.length > 0) {
      const { data: extraMaterials, error: extraError } = await db
        .from("raw_materials")
        .select("id, kode, nama, kategori")
        .in("id", missingIds)
        .is("deleted_at", null);
      if (extraError) throw extraError;
      for (const row of (extraMaterials || []) as Array<Record<string, unknown>>) {
        materialById.set(String(row.id), {
          id: String(row.id),
          kode: String(row.kode || ""),
          nama: String(row.nama || row.id),
          kategori: String(row.kategori || "-"),
          satuan: "",
          lokasi_rak: "-",
          qty_onhand: 0,
          avg_cost: 0,
          min_stock: 0,
          max_stock: null,
          status_stok: "AMAN",
          warehouse_id: null,
          warehouse_name: null,
        });
      }
    }
  }

  const movementRows = rawMovementRows.map((row) => {
    const itemId = String(row.raw_material_id);
    const material = materialById.get(itemId);
    return {
      id: String(row.id),
      item_id: itemId,
      warehouse_id: (row.warehouse_id as string | null) || null,
      tipe: row.tipe as MovementRow["tipe"],
      jumlah: row.jumlah,
      qty_before: row.qty_before,
      qty_after: row.qty_after,
      unit_cost: row.unit_cost,
      total_cost: row.total_cost,
      reference_type: row.reference_type as string | null,
      reference_id: row.reference_id as string | null,
      reference_number: row.reference_number as string | null,
      alasan: row.alasan as string | null,
      catatan: row.catatan as string | null,
      created_at: row.created_at as string | null,
      item: material
        ? {
            id: material.id,
            kode: material.kode,
            nama: material.nama,
            kategori: material.kategori,
          }
        : { id: itemId, kode: "", nama: itemId, kategori: "-" },
    };
  });

  let fallbackCostByItem = new Map<string, number>();

  if (movementItemIds.length > 0) {
    const { data: inventoryCosts, error: inventoryCostError } = await db
      .from("inventory")
      .select("raw_material_id, unit_cost")
      .in("raw_material_id", movementItemIds)
      .eq("is_active", true);
    if (inventoryCostError) throw inventoryCostError;
    fallbackCostByItem = new Map(
      ((inventoryCosts || []) as { raw_material_id: string; unit_cost?: number | string | null }[]).map(
        (item) => [item.raw_material_id, toNumber(item.unit_cost)]
      )
    );
  }

  const movements = movementRows.map((movement) => normalizeMovement(movement, fallbackCostByItem));

  let openingBalance = movements[0]?.qty_before || 0;
  if (selectedId && dateFrom) {
    let previousQuery = db
      .from("inventory_movements")
      .select("qty_after")
      .eq("raw_material_id", selectedId)
      .eq("is_active", true)
      .lt("created_at", dateFrom)
      .order("created_at", { ascending: false })
      .limit(1);
    if (params.warehouse_id) previousQuery = previousQuery.eq("warehouse_id", params.warehouse_id);
    const { data: previousMovement, error: previousError } = await previousQuery.maybeSingle();
    if (previousError) throw previousError;
    openingBalance = previousMovement ? toNumber(previousMovement.qty_after) : openingBalance;
  }

  return {
    items: materials,
    materials,
    selected_item: selectedItem,
    selected_material: selectedItem,
    movements,
    summary: buildSummary(movements, openingBalance, selectedItem?.qty_onhand || 0),
  };
}

async function getProductStockCard(
  db: ReturnType<typeof createPgClient>,
  params: z.infer<typeof querySchema>,
  dateFrom?: string,
  dateTo?: string
) {
  const selectedId = params.item_id || params.product_id;

  let productsQuery = db
    .from("v_finished_goods_stock")
    .select("*")
    .eq("is_active", true)
    .order("product_nama", { ascending: true });

  if (params.warehouse_id) {
    productsQuery = productsQuery.eq("warehouse_id", params.warehouse_id);
  }
  if (params.search) {
    productsQuery = productsQuery.or(
      `product_nama.ilike.%${params.search}%,product_kode.ilike.%${params.search}%`
    );
  }

  const { data: productsData, error: productsError } = await productsQuery;
  if (productsError) throw productsError;

  const items = ((productsData || []) as Array<Record<string, unknown>>).map((row) =>
    normalizeItem({
      id: String(row.product_id || row.id),
      kode: row.product_kode as string | null,
      nama: row.product_nama as string | null,
      kategori: row.product_kategori as string | null,
      satuan: row.satuan_nama as string | null,
      lokasi_rak: row.warehouse_name as string | null,
      qty_onhand: row.qty_available as number | string | null,
      avg_cost: row.unit_cost as number | string | null,
      min_stock: 0,
      max_stock: null,
      status_stok: "AMAN",
      warehouse_id: row.warehouse_id as string | null,
      warehouse_name: row.warehouse_name as string | null,
    })
  );

  const selectedItem = selectedId ? items.find((item) => item.id === selectedId) || null : null;

  let movementsQuery = db
    .from("finished_goods_movements")
    .select(`
      id,
      product_id,
      warehouse_id,
      tipe,
      jumlah,
      qty_before,
      qty_after,
      unit_cost,
      total_cost,
      reference_type,
      reference_id,
      reference_number,
      alasan,
      catatan,
      created_at
    `)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(params.limit);

  if (selectedId) movementsQuery = movementsQuery.eq("product_id", selectedId);
  if (params.warehouse_id) movementsQuery = movementsQuery.eq("warehouse_id", params.warehouse_id);
  if (params.tipe !== "all") movementsQuery = movementsQuery.eq("tipe", params.tipe);
  if (dateFrom) movementsQuery = movementsQuery.gte("created_at", dateFrom);
  if (dateTo) movementsQuery = movementsQuery.lte("created_at", dateTo);

  const { data: movementsData, error: movementsError } = await movementsQuery;
  if (movementsError) throw movementsError;

  const productById = new Map(items.map((item) => [item.id, item]));
  const movementRows = ((movementsData || []) as Array<Record<string, unknown>>).map((row) => {
    const itemId = String(row.product_id);
    const product = productById.get(itemId);
    return {
      id: String(row.id),
      item_id: itemId,
      warehouse_id: (row.warehouse_id as string | null) || null,
      tipe: row.tipe as MovementRow["tipe"],
      jumlah: row.jumlah,
      qty_before: row.qty_before,
      qty_after: row.qty_after,
      unit_cost: row.unit_cost,
      total_cost: row.total_cost,
      reference_type: row.reference_type as string | null,
      reference_id: row.reference_id as string | null,
      reference_number: row.reference_number as string | null,
      alasan: row.alasan as string | null,
      catatan: row.catatan as string | null,
      created_at: row.created_at as string | null,
      item: product
        ? {
            id: product.id,
            kode: product.kode,
            nama: product.nama,
            kategori: product.kategori,
          }
        : { id: itemId, kode: "", nama: itemId, kategori: "-" },
    };
  });

  const fallbackCostByItem = new Map(items.map((item) => [item.id, item.avg_cost]));
  const movements = movementRows.map((movement) => normalizeMovement(movement, fallbackCostByItem));

  let openingBalance = movements[0]?.qty_before || 0;
  if (selectedId && dateFrom) {
    let previousQuery = db
      .from("finished_goods_movements")
      .select("qty_after")
      .eq("product_id", selectedId)
      .eq("is_active", true)
      .lt("created_at", dateFrom)
      .order("created_at", { ascending: false })
      .limit(1);
    if (params.warehouse_id) previousQuery = previousQuery.eq("warehouse_id", params.warehouse_id);
    const { data: previousMovement, error: previousError } = await previousQuery.maybeSingle();
    if (previousError) throw previousError;
    openingBalance = previousMovement ? toNumber(previousMovement.qty_after) : openingBalance;
  }

  return {
    items,
    materials: items,
    selected_item: selectedItem,
    selected_material: selectedItem,
    movements,
    summary: buildSummary(movements, openingBalance, selectedItem?.qty_onhand || 0),
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.items);
    const db = createPgClient();
    const { searchParams } = new URL(request.url);
    const params = querySchema.parse(Object.fromEntries(searchParams));
    const dateFrom = params.date_from ? startOfDay(params.date_from) : undefined;
    const dateTo = params.date_to ? endOfDay(params.date_to) : undefined;

    const data =
      params.item_type === "product"
        ? await getProductStockCard(db, params, dateFrom, dateTo)
        : await getRawMaterialStockCard(db, params, dateFrom, dateTo);

    return NextResponse.json({
      success: true,
      data: {
        item_type: params.item_type,
        ...data,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Invalid query params", error.issues).toResponse();
    }
    console.error("Error fetching stock card:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Gagal mengambil stock card",
      },
      { status: 500 }
    );
  }
}
