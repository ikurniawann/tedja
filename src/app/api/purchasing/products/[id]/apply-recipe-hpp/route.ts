import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getApiUserScope, isRowInBusinessScope } from "@/lib/api/scope";
import { syncPurchasingProductToPos } from "@/lib/pos/purchasing-sync";
import { buildProductHppReview } from "@/lib/purchasing/product-hpp-review";
import { resolvePosStation } from "@/lib/pos/kitchen-station";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// POST /api/purchasing/products/:id/apply-recipe-hpp
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();
    const scope = await getApiUserScope();

    const { data: product, error: productError } = await db
      .from("v_products_cogs")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (productError || !product) {
      return Response.json(
        { success: false, message: "Produk tidak ditemukan" },
        { status: 404 }
      );
    }

    if (
      !isRowInBusinessScope(scope, {
        company_id: product.company_id,
        branch_id: product.branch_id,
      })
    ) {
      return Response.json(
        { success: false, message: "Produk tidak ditemukan" },
        { status: 404 }
      );
    }

    const review = buildProductHppReview(product);
    if (review.hpp_resep <= 0) {
      return Response.json(
        {
          success: false,
          message: "HPP seharusnya belum bisa dihitung. Lengkapi BOM dan biaya bahan dulu.",
        },
        { status: 400 }
      );
    }

    if (!review.hpp_perlu_review) {
      return Response.json(
        {
          success: false,
          message: "HPP saat ini sudah sama dengan HPP seharusnya.",
        },
        { status: 400 }
      );
    }

    const { data: updated, error: updateError } = await db
      .from("products")
      .update({
        harga_modal: review.hpp_resep,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select("*")
      .single();

    if (updateError) throw updateError;

    const outputType =
      (updated as { production_output_type?: string | null }).production_output_type ||
      product.production_output_type ||
      "FINISHED_GOOD";

    let posSync = null;
    if (outputType === "FINISHED_GOOD") {
      try {
        const row = updated as { kategori?: string | null; station?: string | null };
        posSync = await syncPurchasingProductToPos(db, id, {
          station: resolvePosStation(
            row.station ?? (product as { station?: string | null }).station,
            row.kategori || product.kategori
          ),
          costPriceOverride: review.hpp_resep,
        });
      } catch (syncError) {
        console.warn("POS sync after recipe HPP apply failed:", syncError);
      }
    }

    const refreshedReview = buildProductHppReview({
      ...product,
      ...updated,
      harga_modal: review.hpp_resep,
      hpp_estimasi: review.hpp_estimasi,
    });

    return Response.json({
      success: true,
      data: {
        ...updated,
        ...refreshedReview,
      },
      pos_sync: posSync,
      message: posSync
        ? `HPP diperbarui ke Rp ${review.hpp_resep.toLocaleString("id-ID")} dan tersinkron ke POS.`
        : `HPP diperbarui ke Rp ${review.hpp_resep.toLocaleString("id-ID")}.`,
    });
  } catch (error: unknown) {
    console.error("Error applying recipe HPP:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal memperbarui HPP") },
      { status: 500 }
    );
  }
}
