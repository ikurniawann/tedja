import { query, queryOne } from "@/lib/db";
import {
  buildDesktopOverview,
  todayJakarta,
  type DesktopOverview,
} from "@/lib/desktop/overview";

/**
 * Data dashboard eksekutif /dashboard (EPIC-021) — untuk super_admin + direksi.
 *
 * Menumpang penuh pada `buildDesktopOverview` (denyut hari ini) lalu menambah
 * lapisan insight yang tidak dibutuhkan desktop: tren 14 hari, produk terlaris,
 * nilai persediaan, purchasing bulan berjalan, payroll terakhir, dan kontrak
 * yang mendekati habis. Prinsipnya sama: definisi angka mengikuti modul
 * aslinya, dan tiap seksi gagal-aman.
 */

export interface TrendPoint {
  tanggal: string;
  omzet: number;
  pesanan: number;
}

export interface TopProduct {
  produk: string;
  qty: number;
  omzet: number;
}

export interface PurchasingMonth {
  jumlahPo: number;
  nilaiTotal: number;
  perStatus: Array<{ status: string; jumlah: number }>;
}

export interface PayrollLast {
  runName: string;
  periode: string;
  status: string;
  totalNet: number;
  paidAt: string | null;
}

export interface ExecutiveDashboard {
  dibuatPada: string;
  /** Denyut hari ini — struktur identik dengan papan desktop. */
  overview: DesktopOverview;
  tren14Hari: TrendPoint[] | null;
  topProduk7Hari: TopProduct[] | null;
  nilaiPersediaan: number | null;
  purchasingBulanIni: PurchasingMonth | null;
  payrollTerakhir: PayrollLast | null;
  kontrakHabis30Hari: number | null;
  gagal: string[];
}

async function fetchTrend14(): Promise<TrendPoint[]> {
  const today = todayJakarta();
  const rows = await query<{ tanggal: string; omzet: number; pesanan: number }>(
    `SELECT (created_at AT TIME ZONE 'Asia/Jakarta')::date::text AS tanggal,
            COALESCE(sum(total_amount), 0)::float8 AS omzet,
            count(*)::int AS pesanan
       FROM pos.pos_orders
      WHERE created_at >= ($1::date - interval '13 days')
        AND created_at < ($1::date + interval '1 day')
        AND status <> 'cancelled'
        AND voided_at IS NULL
      GROUP BY 1
      ORDER BY 1`,
    [today]
  );
  const byDate = new Map(rows.map((r) => [r.tanggal, r]));
  const out: TrendPoint[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(new Date(`${today}T00:00:00Z`).getTime() - i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const row = byDate.get(d);
    out.push({ tanggal: d, omzet: Number(row?.omzet ?? 0), pesanan: Number(row?.pesanan ?? 0) });
  }
  return out;
}

async function fetchTopProducts(): Promise<TopProduct[]> {
  const today = todayJakarta();
  // total_amount item sudah bersih diskon per baris; pesanan batal/void ikut
  // aturan yang sama dengan seluruh angka penjualan.
  const rows = await query<{ produk: string; qty: number; omzet: number }>(
    `SELECT i.product_name AS produk,
            COALESCE(sum(i.quantity), 0)::float8 AS qty,
            COALESCE(sum(i.total_amount), 0)::float8 AS omzet
       FROM pos.pos_order_items i
       JOIN pos.pos_orders o ON o.id = i.order_id
      WHERE o.created_at >= ($1::date - interval '6 days')
        AND o.created_at < ($1::date + interval '1 day')
        AND o.status <> 'cancelled'
        AND o.voided_at IS NULL
      GROUP BY 1
      ORDER BY omzet DESC
      LIMIT 5`,
    [today]
  );
  return rows.map((r) => ({ produk: r.produk, qty: Number(r.qty), omzet: Number(r.omzet) }));
}

async function fetchInventoryValue(): Promise<number> {
  const row = await queryOne<{ nilai: number }>(
    `SELECT COALESCE(sum(qty_available * unit_cost), 0)::float8 AS nilai
       FROM inventory.inventory
      WHERE is_active`
  );
  return Number(row?.nilai ?? 0);
}

async function fetchPurchasingMonth(): Promise<PurchasingMonth> {
  const today = todayJakarta();
  const perStatus = await query<{ status: string; jumlah: number; nilai: number }>(
    `SELECT status, count(*)::int AS jumlah,
            COALESCE(sum(total), 0)::float8 AS nilai
       FROM purchase_orders
      WHERE created_at >= date_trunc('month', $1::date)
        AND created_at < (date_trunc('month', $1::date) + interval '1 month')
        AND status <> 'cancelled'
      GROUP BY status
      ORDER BY jumlah DESC`,
    [today]
  );
  return {
    jumlahPo: perStatus.reduce((a, r) => a + Number(r.jumlah), 0),
    nilaiTotal: perStatus.reduce((a, r) => a + Number(r.nilai), 0),
    perStatus: perStatus.map((r) => ({ status: r.status, jumlah: Number(r.jumlah) })),
  };
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

async function fetchPayrollLast(): Promise<PayrollLast | null> {
  const row = await queryOne<{
    run_name: string;
    period_month: number;
    period_year: number;
    status: string;
    total_net: number;
    paid_at: string | null;
  }>(
    `SELECT run_name, period_month, period_year, status,
            COALESCE(total_net, 0)::float8 AS total_net, paid_at::text
       FROM payroll_runs
      ORDER BY period_year DESC, period_month DESC, created_at DESC
      LIMIT 1`
  );
  if (!row) return null;
  return {
    runName: row.run_name,
    periode: `${MONTH_NAMES[(row.period_month - 1 + 12) % 12]} ${row.period_year}`,
    status: row.status,
    totalNet: Number(row.total_net),
    paidAt: row.paid_at,
  };
}

async function fetchExpiringContracts(): Promise<number> {
  const today = todayJakarta();
  const row = await queryOne<{ jumlah: number }>(
    `SELECT count(*)::int AS jumlah
       FROM hris.employment_contracts
      WHERE status = 'active'
        AND end_date IS NOT NULL
        AND end_date BETWEEN $1::date AND ($1::date + interval '30 days')`,
    [today]
  );
  return Number(row?.jumlah ?? 0);
}

async function safe<T>(name: string, gagal: string[], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    console.error(`[dashboard:executive] seksi ${name} gagal:`, error);
    gagal.push(name);
    return null;
  }
}

export async function buildExecutiveDashboard(): Promise<ExecutiveDashboard> {
  const gagal: string[] = [];
  const [overview, tren14Hari, topProduk7Hari, nilaiPersediaan, purchasingBulanIni, payrollTerakhir, kontrakHabis30Hari] =
    await Promise.all([
      buildDesktopOverview(), // punya gagal-aman internalnya sendiri
      safe("tren14", gagal, fetchTrend14),
      safe("topProduk", gagal, fetchTopProducts),
      safe("nilaiPersediaan", gagal, fetchInventoryValue),
      safe("purchasing", gagal, fetchPurchasingMonth),
      safe("payroll", gagal, fetchPayrollLast),
      safe("kontrak", gagal, fetchExpiringContracts),
    ]);

  return {
    dibuatPada: new Date().toISOString(),
    overview,
    tren14Hari,
    topProduk7Hari,
    nilaiPersediaan,
    purchasingBulanIni,
    payrollTerakhir,
    kontrakHabis30Hari,
    gagal: [...gagal, ...overview.gagal.map((g) => `overview:${g}`)],
  };
}

export const EXECUTIVE_DASHBOARD_ROLES = ["super_admin", "direksi"] as const;
