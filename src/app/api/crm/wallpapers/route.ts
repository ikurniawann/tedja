import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { requireCrmConfigRole } from "@/lib/crm/server";

/** CRUD wallpaper collectible (EPIC-014 Task 5) — super_admin only. */

const wallpaperSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  code: z.string().min(2).max(60),
  name: z.string().min(2).max(120),
  rarity: z.enum(["common", "rare", "epic", "legendary", "limited"]).default("common"),
  image_url: z.string().min(1).max(500),
  thumbnail_url: z.string().max(500).optional().nullable(),
  min_lifetime_xp: z.number().int().min(0).optional().nullable(),
  required_tier_id: z.string().uuid().optional().nullable(),
  stock_total: z.number().int().min(1).optional().nullable(),
  is_active: z.boolean().default(true),
  starts_at: z.string().optional().nullable(),
  ends_at: z.string().optional().nullable(),
});

export async function GET() {
  const denied = await requireCrmConfigRole();
  if (denied) return denied;
  const { rows } = await getPool().query(
    `SELECT w.*, t.name AS required_tier_name
       FROM crm.crm_collectible_wallpapers w
       LEFT JOIN crm.crm_membership_tiers t ON t.id = w.required_tier_id
      ORDER BY w.created_at DESC`
  );
  return NextResponse.json({ success: true, data: rows });
}

export async function POST(request: NextRequest) {
  const denied = await requireCrmConfigRole();
  if (denied) return denied;
  try {
    const payload = wallpaperSchema.parse(await request.json());
    const pool = getPool();
    const params = [
      payload.code, payload.name, payload.rarity, payload.image_url,
      payload.thumbnail_url ?? null, payload.min_lifetime_xp ?? null,
      payload.required_tier_id ?? null, payload.stock_total ?? null,
      payload.is_active, payload.starts_at ?? null, payload.ends_at ?? null,
    ];
    const { rows } = payload.id
      ? await pool.query(
          `UPDATE crm.crm_collectible_wallpapers
              SET code=$1,name=$2,rarity=$3,image_url=$4,thumbnail_url=$5,
                  min_lifetime_xp=$6,required_tier_id=$7,stock_total=$8,
                  is_active=$9,starts_at=$10,ends_at=$11,updated_at=now()
            WHERE id=$12 RETURNING *`,
          [...params, payload.id]
        )
      : await pool.query(
          `INSERT INTO crm.crm_collectible_wallpapers
             (code,name,rarity,image_url,thumbnail_url,min_lifetime_xp,
              required_tier_id,stock_total,is_active,starts_at,ends_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          params
        );
    if (!rows[0]) return NextResponse.json({ success: false, error: "Wallpaper tidak ditemukan" }, { status: 404 });
    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: "Data tidak valid" }, { status: 400 });
    }
    console.error("Error saving wallpaper:", error);
    return NextResponse.json({ success: false, error: "Gagal menyimpan wallpaper" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await requireCrmConfigRole();
  if (denied) return denied;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ success: false, error: "ID tidak valid" }, { status: 400 });
  }
  // Nonaktifkan saja bila sudah pernah ditukar — koleksi member tidak ditarik.
  const owned = await getPool().query(
    `SELECT 1 FROM crm.crm_member_wallpaper_inventory WHERE wallpaper_id = $1 LIMIT 1`,
    [id]
  );
  if (owned.rows[0]) {
    await getPool().query(`UPDATE crm.crm_collectible_wallpapers SET is_active=false WHERE id=$1`, [id]);
    return NextResponse.json({ success: true, message: "Sudah dimiliki member — dinonaktifkan, bukan dihapus" });
  }
  await getPool().query(`DELETE FROM crm.crm_collectible_wallpapers WHERE id=$1`, [id]);
  return NextResponse.json({ success: true });
}
