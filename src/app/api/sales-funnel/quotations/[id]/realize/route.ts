import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { queryOne, withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

const realizeSchema = z.object({
  // Modifikasi owner: stok kurang → boleh lanjut TANPA memotong BOM,
  // quotation ditandai bom_status = 'tidak-terpotong'
  force_skip_bom: z.boolean().default(false),
});

interface Shortage {
  raw_material_id: string;
  kode: string | null;
  nama: string;
  satuan: string | null;
  needed: number;
  available: number;
}

/** Error khusus pembawa detail kekurangan stok — jadi respons 409. */
class InsufficientStockError extends Error {
  constructor(
    public shortages: Shortage[],
    public warnings: string[]
  ) {
    super("Stok bahan baku tidak mencukupi");
  }
}

/**
 * Realisasi quotation (EPIC-022 Fase F3) — dipanggil ops menjelang acara.
 * Menghitung kebutuhan bahan baku dari resep produk (pos_recipes ×
 * qty pax × waste), mengunci baris stok gudang venue (FOR UPDATE),
 * memotong via inventory_movements tipe 'out', lalu membekukan quotation
 * (stock_deducted_at + bom_status). Idempoten: baris quotation dikunci
 * FOR UPDATE dan hanya bisa direalisasi sekali.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  // Endpoint berat (mengunci baris quotation + inventory) — rem per user
  const rate = checkRateLimit(`sales-funnel-realize:${user.id}`, 10);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak percobaan realisasi — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const { id } = await params;
    const ref = await queryOne<{ id: string; deal_id: string }>(
      `SELECT id, deal_id FROM crm.crm_sales_quotations
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!ref) {
      return NextResponse.json(
        { success: false, error: "Quotation tidak ditemukan" },
        { status: 404 }
      );
    }
    const { deal, forbidden } = await findAccessibleDeal(ref.deal_id, user);
    if (forbidden || !deal) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const parsed = realizeSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const forceSkipBom = parsed.data.force_skip_bom;

    const result = await withTransaction(async (client) => {
      // Kunci quotation — serialisasi dua klik Realisasi bersamaan
      const locked = await client.query<{
        id: string;
        status: string;
        stock_deducted_at: string | null;
        quote_number: string;
      }>(
        `SELECT id, status, stock_deducted_at, quote_number
         FROM crm.crm_sales_quotations
         WHERE id = $1 AND deleted_at IS NULL
         FOR UPDATE`,
        [id]
      );
      const quotation = locked.rows[0];
      if (!quotation) throw new Error("Quotation tidak ditemukan");
      if (quotation.stock_deducted_at) {
        throw new Error("Quotation sudah direalisasi sebelumnya");
      }
      if (quotation.status !== "diterima") {
        throw new Error(
          "Hanya quotation berstatus Diterima yang bisa direalisasi"
        );
      }

      // Kebutuhan bahan: baris produk × resep aktif (+ waste)
      const requirements = await client.query<{
        raw_material_id: string;
        needed: string;
      }>(
        `SELECT r.raw_material_id,
                SUM(i.qty * r.quantity_per_unit *
                    (1 + COALESCE(r.waste_percentage, 0) / 100)) AS needed
         FROM crm.crm_sales_quotation_items i
         JOIN pos.pos_recipes r ON r.product_id = i.product_id AND r.is_active = true
         WHERE i.quotation_id = $1 AND i.item_type = 'produk'
         GROUP BY r.raw_material_id`,
        [id]
      );

      // Produk tanpa resep — peringatan, bukan pemblokir potong stok
      const noRecipe = await client.query<{ name: string }>(
        `SELECT DISTINCT p.name
         FROM crm.crm_sales_quotation_items i
         JOIN pos.pos_products p ON p.id = i.product_id
         WHERE i.quotation_id = $1 AND i.item_type = 'produk'
           AND NOT EXISTS (
             SELECT 1 FROM pos.pos_recipes r
             WHERE r.product_id = i.product_id AND r.is_active = true
           )`,
        [id]
      );
      const warnings = noRecipe.rows.map(
        (row) => `Produk "${row.name}" belum punya resep — tidak ada bahan yang dipotong untuknya`
      );

      let bomStatus: "terpotong" | "tidak-terpotong";
      let movedCount = 0;

      if (forceSkipBom) {
        bomStatus = "tidak-terpotong";
      } else if (requirements.rows.length === 0) {
        // Tidak ada resep sama sekali → tidak ada yang bisa dipotong;
        // wajib konfirmasi eksplisit (force) agar status jujur
        throw new InsufficientStockError([], [
          ...warnings,
          "Tidak ada resep produk yang bisa dipotong — lanjutkan tanpa potong BOM?",
        ]);
      } else {
        // Kunci baris stok gudang venue & hitung ketersediaan
        const materialIds = requirements.rows.map((r) => r.raw_material_id);
        // Lock berurutan DETERMINISTIK by id — ORDER BY qty punya seri
        // (nilai kembar) sehingga dua realisasi bersamaan bisa saling
        // kunci terbalik = deadlock (temuan HIGH gate F3). Urutan bisnis
        // "gudang terbesar dulu" diterapkan di aplikasi SETELAH terkunci.
        const stock = await client.query<{
          id: string;
          raw_material_id: string;
          warehouse_id: string | null;
          qty_available: string;
        }>(
          `SELECT id, raw_material_id, warehouse_id, qty_available
           FROM inventory.inventory
           WHERE raw_material_id = ANY($1::uuid[])
             AND branch_id = $2 AND is_active = true
           ORDER BY id ASC
           FOR UPDATE`,
          [materialIds, deal.branch_id]
        );

        const availableByMaterial = new Map<string, number>();
        for (const row of stock.rows) {
          availableByMaterial.set(
            row.raw_material_id,
            (availableByMaterial.get(row.raw_material_id) ?? 0) +
              Number(row.qty_available)
          );
        }

        // Bandingkan pada presisi kolom stok numeric(15,3) — drift float
        // dari string→Number bisa memblokir stok yang persis cukup
        const to3dp = (value: number) => Math.round(value * 1000) / 1000;
        const shortages: Shortage[] = [];
        for (const req of requirements.rows) {
          const needed = to3dp(Number(req.needed));
          const available = to3dp(
            availableByMaterial.get(req.raw_material_id) ?? 0
          );
          if (available < needed) {
            const info = await client.query<{
              kode: string | null;
              nama: string;
              satuan: string | null;
            }>(
              `SELECT rm.kode, rm.nama, u.nama AS satuan
               FROM item.raw_materials rm
               LEFT JOIN item.units u ON u.id = rm.satuan_kecil_id
               WHERE rm.id = $1`,
              [req.raw_material_id]
            );
            shortages.push({
              raw_material_id: req.raw_material_id,
              kode: info.rows[0]?.kode ?? null,
              nama: info.rows[0]?.nama ?? req.raw_material_id,
              satuan: info.rows[0]?.satuan ?? null,
              needed: Math.round(needed * 100) / 100,
              available: Math.round(available * 100) / 100,
            });
          }
        }
        if (shortages.length > 0) {
          throw new InsufficientStockError(shortages, warnings);
        }

        // Potong stok: greedy per baris gudang (terbesar dulu), ledger
        // qty_before/after per movement — pola adjustment purchasing
        for (const req of requirements.rows) {
          let remaining = to3dp(Number(req.needed));
          const rows = stock.rows
            .filter((row) => row.raw_material_id === req.raw_material_id)
            .sort((a, b) => Number(b.qty_available) - Number(a.qty_available));
          for (const row of rows) {
            if (remaining <= 0) break;
            const before = Number(row.qty_available);
            const take = Math.min(before, remaining);
            if (take <= 0) continue;
            const after = Math.round((before - take) * 10000) / 10000;

            await client.query(
              `UPDATE inventory.inventory
               SET qty_available = $1, last_movement_at = now(),
                   updated_at = now(), updated_by = $2
               WHERE id = $3`,
              [after, user.id, row.id]
            );
            await client.query(
              `INSERT INTO inventory.inventory_movements
                 (inventory_id, raw_material_id, tipe, jumlah, qty_before,
                  qty_after, reference_type, reference_id, reference_number,
                  alasan, created_by, branch_id, warehouse_id)
               VALUES ($1, $2, 'out', $3, $4, $5, 'sales_realization', $6,
                       $7, $8, $9, $10, $11)`,
              [
                row.id,
                req.raw_material_id,
                take,
                before,
                after,
                id,
                quotation.quote_number,
                `Realisasi quotation ${quotation.quote_number}`,
                user.id,
                deal.branch_id,
                row.warehouse_id,
              ]
            );
            movedCount += 1;
            remaining = Math.round((remaining - take) * 10000) / 10000;
          }
        }
        bomStatus = "terpotong";
      }

      await client.query(
        `UPDATE crm.crm_sales_quotations
         SET stock_deducted_at = now(), bom_status = $1, realized_by = $2,
             updated_at = now()
         WHERE id = $3`,
        [bomStatus, user.id, id]
      );

      return { bomStatus, movedCount, warnings };
    });

    return successResponse(
      result,
      result.bomStatus === "terpotong"
        ? `Realisasi selesai — ${result.movedCount} pergerakan stok dicatat`
        : "Realisasi dicatat TANPA memotong BOM"
    );
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return NextResponse.json(
        {
          success: false,
          error: err.message,
          shortages: err.shortages,
          warnings: err.warnings,
        },
        { status: 409 }
      );
    }
    const raw = err instanceof Error ? err.message : "";
    const isKnown =
      raw.startsWith("Quotation") || raw.startsWith("Hanya quotation");
    console.error("[sales-funnel] realize quotation error:", err);
    return NextResponse.json(
      { success: false, error: isKnown ? raw : "Gagal merealisasi quotation" },
      { status: isKnown ? 409 : 500 }
    );
  }
}
