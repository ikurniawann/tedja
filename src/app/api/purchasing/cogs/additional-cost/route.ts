import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, successResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// POST /api/purchasing/cogs/additional-cost
// Input biaya tambahan (freight, handling, dll) per PO/GRN
// and allocate proportionally to items

const additionalCostSchema = z.object({
  po_id: z.string().uuid().optional(),
  grn_id: z.string().uuid().optional(),
  jenis_biaya: z.enum(["freight", "handling", "asuransi", "loading", "lainnya"]),
  jumlah: z.number().positive("Jumlah harus positif"),
  mata_uang: z.string().default("IDR"),
  keterangan: z.string().optional(),
  metode_alokasi: z.enum(["by_value", "by_weight", "equal"]).default("by_value"),
  items: z
    .array(
      z.object({
        po_item_id: z.string().uuid().optional(),
        grn_item_id: z.string().uuid().optional(),
        amount: z.number().positive().optional(),
      })
    )
    .optional(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const db = await createServerPgClient();

    const body = await request.json();
    const validated = additionalCostSchema.parse(body);

    if (!validated.po_id && !validated.grn_id) {
      throw ApiError.badRequest("po_id atau grn_id wajib diisi");
    }

    // Calculate proportional allocation
    let allocatedItems: Array<{
      po_item_id?: string;
      grn_item_id?: string;
      jumlah_alokasi: number;
      proportion: number;
    }> = [];

    if (validated.items && validated.items.length > 0) {
      // Manual allocation by items
      const totalAmount = validated.items.reduce(
        (sum: number, item: any) => sum + (item.amount || 0),
        0
      );
      allocatedItems = validated.items.map((item: any) => ({
        po_item_id: item.po_item_id,
        grn_item_id: item.grn_item_id,
        jumlah_alokasi: item.amount || 0,
        proportion: totalAmount > 0 ? (item.amount || 0) / totalAmount : 0,
      }));
    } else {
      // Auto allocation based on PO/GRN items
      if (validated.po_id) {
        const { data: poItems } = await db
          .from("purchase_order_items")
          .select("id, jumlah, harga_satuan, produk_id")
          .eq("purchase_order_id", validated.po_id);

        if (!poItems || poItems.length === 0) {
          throw ApiError.notFound("PO tidak ditemukan atau tidak memiliki items");
        }

        if (validated.metode_alokasi === "by_value") {
          const totalValue = poItems.reduce(
            (sum: number, item: any) => sum + item.jumlah * item.harga_satuan,
            0
          );
          allocatedItems = poItems.map((item: any) => {
            const itemValue = item.jumlah * item.harga_satuan;
            const proportion = totalValue > 0 ? itemValue / totalValue : 0;
            return {
              po_item_id: item.id,
              jumlah_alokasi:
                Math.round((proportion * validated.jumlah) * 100) / 100,
              proportion,
            };
          });
        } else if (validated.metode_alokasi === "equal") {
          const portion = 1 / poItems.length;
          allocatedItems = poItems.map((item: any) => ({
            po_item_id: item.id,
            jumlah_alokasi:
              Math.round((validated.jumlah / poItems.length) * 100) / 100,
            proportion: portion,
          }));
        }
      } else if (validated.grn_id) {
        const { data: grnItems } = await db
          .from("goods_receipt_items")
          .select("id, jumlah_diterima, po_item_id")
          .eq("goods_receipt_id", validated.grn_id);

        if (!grnItems || grnItems.length === 0) {
          throw ApiError.notFound("GRN tidak ditemukan");
        }

        if (validated.metode_alokasi === "by_value") {
          const { data: poItems } = await db
            .from("purchase_order_items")
            .select("id, jumlah, harga_satuan")
            .in(
              "id",
              grnItems.map((g: any) => g.po_item_id)
            );

          const totalValue = (poItems || []).reduce(
            (sum: number, item: any) => sum + item.jumlah * item.harga_satuan,
            0
          );

          allocatedItems = grnItems.map((gi: any) => {
            const poItem = (poItems || []).find((p: any) => p.id === gi.po_item_id);
            const itemValue = poItem
              ? gi.jumlah_diterima * poItem.harga_satuan
              : 0;
            const proportion = totalValue > 0 ? itemValue / totalValue : 0;
            return {
              grn_item_id: gi.id,
              jumlah_alokasi:
                Math.round((proportion * validated.jumlah) * 100) / 100,
              proportion,
            };
          });
        } else if (validated.metode_alokasi === "equal") {
          const portion = 1 / grnItems.length;
          allocatedItems = grnItems.map((gi: any) => ({
            grn_item_id: gi.id,
            jumlah_alokasi:
              Math.round((validated.jumlah / grnItems.length) * 100) / 100,
            proportion: portion,
          }));
        }
      }
    }

    // Insert additional cost record
    const { data: costRecord, error: costError } = await db
      .from("additional_costs")
      .insert({
        po_id: validated.po_id,
        grn_id: validated.grn_id,
        jenis_biaya: validated.jenis_biaya,
        jumlah: validated.jumlah,
        mata_uang: validated.mata_uang,
        keterangan: validated.keterangan,
        metode_alokasi: validated.metode_alokasi,
        created_by: user.id,
      })
      .select()
      .single();

    if (costError) throw costError;

    // Insert allocations
    if (allocatedItems.length > 0) {
      const allocationInserts = allocatedItems.map((item: any) => ({
        additional_cost_id: costRecord.id,
        po_item_id: item.po_item_id || null,
        grn_item_id: item.grn_item_id || null,
        jumlah_alokasi: item.jumlah_alokasi,
        proportion: item.proportion,
      }));

      await db.from("additional_cost_allocations").insert(allocationInserts);
    }

    // Fetch complete record
    const { data: complete } = await db
      .from("additional_costs")
      .select(
        `*,
        po:purchase_order_id(id, po_number),
        grn:goods_receipt_id(id, nomor_gr),
        allocations:additional_cost_allocations(
          *,
          po_item:po_item_id(id),
          grn_item:grn_item_id(id)
        ),
        creator:created_by(full_name)
      `
      )
      .eq("id", costRecord.id)
      .single();

    return successResponse(complete, "Biaya tambahan berhasil dialokasikan");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validation failed", error.issues).toResponse();
    }
    console.error("Error creating additional cost:", error);
    return ApiError.server("Failed to create additional cost").toResponse();
  }
}

// GET /api/purchasing/cogs/additional-cost
export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.items);
    const db = await createServerPgClient();

    const { searchParams } = new URL(request.url);
    const po_id = searchParams.get("po_id");
    const grn_id = searchParams.get("grn_id");
    const jenis_biaya = searchParams.get("jenis_biaya");

    let query = db
      .from("additional_costs")
      .select(
        `*,
        po:purchase_order_id(id, po_number),
        grn:goods_receipt_id(id, nomor_gr),
        creator:created_by(full_name)
      `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false });

    if (po_id) query = query.eq("po_id", po_id);
    if (grn_id) query = query.eq("grn_id", grn_id);
    if (jenis_biaya) query = query.eq("jenis_biaya", jenis_biaya);

    const { data, error, count } = await query;

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        total: count || 0,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Invalid query params", error.issues).toResponse();
    }
    console.error("Error fetching additional costs:", error);
    return ApiError.server("Failed to fetch additional costs").toResponse();
  }
}
