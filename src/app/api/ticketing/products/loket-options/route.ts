import { NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import {
  TICKETING_OPERATOR_ROLES,
  requireTicketingContext,
} from "@/lib/ticketing/server";

interface LoketOptionRow {
  variant_id: string;
  variant_name: string;
  ticket_product_id: string;
  ticket_code: string;
  ticket_name: string;
  product_kind: "single" | "bundle";
  price_regular: string | null;
  price_high: string | null;
}

interface BundleMemberRow {
  bundle_product_id: string;
  component_variant_id: string;
  qty: number;
  product_name: string;
  variant_name: string;
  component_status: string;
  component_kind: string;
  variant_is_active: boolean;
}

/**
 * Opsi ticket utk registrasi loket: hanya produk Active yang
 * terdistribusi ke kanal walk-in, per varian aktif. Paket (Fase P)
 * menyertakan komposisinya — UI butuh tahu berapa gelang per unit;
 * paket berkomposisi tak layak (kosong/komponen nonaktif) disembunyikan.
 */
export async function GET() {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  try {
    const rows = await query<LoketOptionRow>(
      `SELECT pv.id AS variant_id, pv.name AS variant_name,
              tp.id AS ticket_product_id, tp.code AS ticket_code,
              tp.name AS ticket_name, tp.product_kind,
              pv.price_regular, pv.price_high
       FROM ticketing.ticket_product_variants pv
       JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
       JOIN ticketing.ticket_product_channels pc
         ON pc.ticket_product_id = tp.id AND pc.is_distributed = true
       JOIN ticketing.ticket_channels ch
         ON ch.id = pc.channel_id AND ch.code = 'walk-in'
       WHERE tp.branch_id = $1 AND tp.company_id = $2
         AND tp.status = 'active' AND pv.is_active = true
       ORDER BY tp.name, pv.sort_order`,
      [ctx.branchId, ctx.companyId]
    );

    const bundleIds = rows
      .filter((r) => r.product_kind === "bundle")
      .map((r) => r.ticket_product_id);
    const memberRows =
      bundleIds.length > 0
        ? await query<BundleMemberRow>(
            `SELECT bi.bundle_product_id, bi.component_variant_id, bi.qty,
                    tp.name AS product_name, pv.name AS variant_name,
                    tp.status AS component_status,
                    tp.product_kind AS component_kind,
                    pv.is_active AS variant_is_active
             FROM ticketing.ticket_bundle_items bi
             JOIN ticketing.ticket_product_variants pv
               ON pv.id = bi.component_variant_id
             JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
             WHERE bi.bundle_product_id = ANY($1)
               AND bi.branch_id = $2 AND bi.company_id = $3
             ORDER BY bi.sort_order, bi.created_at`,
            [bundleIds, ctx.branchId, ctx.companyId]
          )
        : [];
    const membersByBundle = new Map<string, BundleMemberRow[]>();
    for (const m of memberRows) {
      const list = membersByBundle.get(m.bundle_product_id) ?? [];
      list.push(m);
      membersByBundle.set(m.bundle_product_id, list);
    }
    const isSellableBundle = (members: BundleMemberRow[] | undefined) =>
      !!members &&
      members.length > 0 &&
      members.every(
        (m) =>
          m.component_status === "active" &&
          m.component_kind === "single" &&
          m.variant_is_active
      );

    const data = rows
      .filter(
        (row) =>
          row.product_kind !== "bundle" ||
          isSellableBundle(membersByBundle.get(row.ticket_product_id))
      )
      .map((row) => {
        const members =
          row.product_kind === "bundle"
            ? (membersByBundle.get(row.ticket_product_id) ?? [])
            : [];
        return {
          ...row,
          price_regular:
            row.price_regular === null ? null : Number(row.price_regular),
          price_high: row.price_high === null ? null : Number(row.price_high),
          members: members.map((m) => ({
            component_variant_id: m.component_variant_id,
            qty: m.qty,
            label: `${m.product_name} — ${m.variant_name}`,
          })),
          members_per_unit: members.reduce((sum, m) => sum + m.qty, 0),
        };
      });
    return successResponse(data);
  } catch (err) {
    console.error("[ticketing] loket options error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat opsi ticket" },
      { status: 500 }
    );
  }
}
