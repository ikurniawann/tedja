import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { isValidCalendarDate } from "@/lib/ticketing/pricing";
import { todayJakartaDate } from "@/lib/ticketing/pricing-server";
import { requireTicketingContext } from "@/lib/ticketing/server";
import type { UserRole } from "@/types";

// EPIC-023 Fase E — Laporan Ticketing. Semua angka uang dihitung NET dari
// ledger ticket_visit_charges: baris void ('koreksi' kredit) di-atribusikan
// ke jenis & konteks baris ASAL via voided_by_charge_id, jadi revenue tiket
// yang di-void tidak menggelembungkan laporan. Tanggal memakai hari
// operasional venue (WIB), bukan UTC server.

const REPORT_ROLES: UserRole[] = ["super_admin", "pos_supervisor"];
const MAX_RANGE_DAYS = 92;
const HANGING_LIMIT = 50;

const addDays = (isoDate: string, days: number): string => {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const diffDays = (from: string, to: string): number => {
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
};

const round2 = (n: number) => Math.round(n * 100) / 100;

interface LedgerRow {
  day: string;
  eff_type: string;
  net: string; // signed: debit +, kredit − (deposit/pembayaran ⇒ negatif)
  qty: string; // signed count
}

interface TicketContextRow {
  variant_id: string | null;
  channel_id: string | null;
  season_kind: string | null;
  bundle_product_id: string | null;
  net: string;
  qty: string;
}

interface MethodRow {
  charge_type: string;
  method: string;
  total: string;
}

interface CountRow {
  key: string;
  n: string;
}

interface HangingRow {
  id: string;
  contact_name: string;
  payment_mode: string;
  opened_at: string;
  outstanding: string;
}

export async function GET(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext(REPORT_ROLES);
  if (error) return error;

  try {
    const sp = request.nextUrl.searchParams;
    const today = todayJakartaDate();
    const to = sp.get("to") ?? today;
    const from = sp.get("from") ?? addDays(to, -6);
    if (!isValidCalendarDate(from) || !isValidCalendarDate(to) || from > to) {
      return NextResponse.json(
        { success: false, error: "Rentang tanggal tidak valid" },
        { status: 400 }
      );
    }
    if (diffDays(from, to) > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { success: false, error: `Rentang maksimum ${MAX_RANGE_DAYS} hari` },
        { status: 400 }
      );
    }

    const scope = [ctx.branchId, ctx.companyId, from, to] as const;
    const dayExpr = (col: string) =>
      `(${col} AT TIME ZONE 'Asia/Jakarta')::date`;

    const [
      ledger,
      ticketContexts,
      methods,
      gateDaily,
      visitDaily,
      bandsRecap,
      hanging,
      variantNames,
      channelNames,
      bundleNames,
      bookingDeposit,
      bookingForfeited,
    ] = await Promise.all([
      // Net per hari × jenis efektif (void menunjuk jenis baris asal)
      query<LedgerRow>(
        `SELECT ${dayExpr("c.created_at")}::text AS day,
                COALESCE(orig.charge_type, c.charge_type) AS eff_type,
                SUM(CASE WHEN c.direction = 'debit' THEN c.amount ELSE -c.amount END) AS net,
                SUM(CASE WHEN c.direction = 'debit' THEN 1 ELSE -1 END) AS qty
         FROM ticketing.ticket_visit_charges c
         LEFT JOIN ticketing.ticket_visit_charges orig
           ON orig.id = c.voided_by_charge_id
         WHERE c.branch_id = $1 AND c.company_id = $2
           AND ${dayExpr("c.created_at")} BETWEEN $3 AND $4
         GROUP BY 1, 2`,
        [...scope]
      ),
      // Rincian tiket per konteks harga (varian/kanal/musim/paket) — net
      query<TicketContextRow>(
        `SELECT ctx.j->>'variant_id' AS variant_id,
                ctx.j->>'channel_id' AS channel_id,
                ctx.j->>'season_kind' AS season_kind,
                ctx.j->>'bundle_product_id' AS bundle_product_id,
                SUM(CASE WHEN c.direction = 'debit' THEN c.amount ELSE -c.amount END) AS net,
                SUM(CASE WHEN c.direction = 'debit' THEN 1 ELSE -1 END) AS qty
         FROM ticketing.ticket_visit_charges c
         LEFT JOIN ticketing.ticket_visit_charges orig
           ON orig.id = c.voided_by_charge_id
         CROSS JOIN LATERAL (
           SELECT COALESCE(c.price_context, orig.price_context, '{}'::jsonb) AS j
         ) ctx
         WHERE c.branch_id = $1 AND c.company_id = $2
           AND COALESCE(orig.charge_type, c.charge_type) = 'tiket'
           AND ${dayExpr("c.created_at")} BETWEEN $3 AND $4
         GROUP BY 1, 2, 3, 4`,
        [...scope]
      ),
      // Uang fisik per metode (rekonsiliasi kasir): masuk deposit +
      // pembayaran, keluar refund-deposit
      query<MethodRow>(
        `SELECT c.charge_type, COALESCE(c.payment_method, 'lainnya') AS method,
                SUM(c.amount) AS total
         FROM ticketing.ticket_visit_charges c
         WHERE c.branch_id = $1 AND c.company_id = $2
           AND c.charge_type IN ('deposit', 'pembayaran', 'refund-deposit')
           AND ${dayExpr("c.created_at")} BETWEEN $3 AND $4
         GROUP BY 1, 2
         ORDER BY 1, 2`,
        [...scope]
      ),
      // Traffic gate per hari × hasil tap
      query<CountRow & { day: string }>(
        `SELECT ${dayExpr("created_at")}::text AS day, result AS key,
                COUNT(*) AS n
         FROM ticketing.ticket_gate_events
         WHERE branch_id = $1 AND company_id = $2
           AND ${dayExpr("created_at")} BETWEEN $3 AND $4
         GROUP BY 1, 2`,
        [...scope]
      ),
      query<CountRow>(
        `SELECT ${dayExpr("opened_at")}::text AS key, COUNT(*) AS n
         FROM ticketing.ticket_visits
         WHERE branch_id = $1 AND company_id = $2
           AND ${dayExpr("opened_at")} BETWEEN $3 AND $4
         GROUP BY 1`,
        [...scope]
      ),
      // Rekap gelang = keadaan SAAT INI (bukan per rentang)
      query<CountRow>(
        `SELECT status AS key, COUNT(*) AS n
         FROM ticketing.ticket_bands
         WHERE branch_id = $1 AND company_id = $2
         GROUP BY 1`,
        [ctx.branchId, ctx.companyId]
      ),
      // Tab menggantung = visit open ber-outstanding positif (keadaan kini)
      query<HangingRow>(
        `SELECT v.id, v.contact_name, v.payment_mode, v.opened_at,
                COALESCE(SUM(CASE WHEN c.direction = 'debit' THEN c.amount
                                  ELSE -c.amount END), 0) AS outstanding
         FROM ticketing.ticket_visits v
         LEFT JOIN ticketing.ticket_visit_charges c ON c.visit_id = v.id
         WHERE v.branch_id = $1 AND v.company_id = $2 AND v.status = 'open'
         GROUP BY v.id
         HAVING COALESCE(SUM(CASE WHEN c.direction = 'debit' THEN c.amount
                                  ELSE -c.amount END), 0) > 0
         ORDER BY v.opened_at
         LIMIT ${HANGING_LIMIT}`,
        [ctx.branchId, ctx.companyId]
      ),
      query<{ id: string; variant_name: string; product_name: string }>(
        `SELECT pv.id, pv.name AS variant_name, tp.name AS product_name
         FROM ticketing.ticket_product_variants pv
         JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
         WHERE pv.branch_id = $1 AND pv.company_id = $2`,
        [ctx.branchId, ctx.companyId]
      ),
      query<{ id: string; name: string }>(
        `SELECT id, name FROM ticketing.ticket_channels
         WHERE branch_id = $1 AND company_id = $2`,
        [ctx.branchId, ctx.companyId]
      ),
      query<{ id: string; name: string }>(
        `SELECT id, name FROM ticketing.ticket_products
         WHERE branch_id = $1 AND company_id = $2 AND product_kind = 'bundle'`,
        [ctx.branchId, ctx.companyId]
      ),
      // Titipan booking = pendapatan diterima di muka (keadaan KINI):
      // terbayar & belum di-redeem → uang sudah di tangan, belum revenue
      query<{ n: string; total: string }>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
         FROM ticketing.ticket_bookings
         WHERE branch_id = $1 AND company_id = $2
           AND status = 'terbayar' AND visit_id IS NULL`,
        [ctx.branchId, ctx.companyId]
      ),
      // Pendapatan hangus dalam rentang — diakui di tanggal forfeited_at
      query<{ n: string; total: string }>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
         FROM ticketing.ticket_bookings
         WHERE branch_id = $1 AND company_id = $2
           AND status = 'hangus'
           AND ${dayExpr("forfeited_at")} BETWEEN $3 AND $4`,
        [...scope]
      ),
    ]);

    const variantById = new Map(variantNames.map((v) => [v.id, v]));
    const channelById = new Map(channelNames.map((c) => [c.id, c.name]));
    const bundleById = new Map(bundleNames.map((b) => [b.id, b.name]));

    // ── Ringkasan + deret harian dari ledger net ────────────────────
    const netByType = new Map<string, number>();
    const dailyMap = new Map<
      string,
      { tiket_net: number; fnb_net: number; uang_masuk: number }
    >();
    const dayOf = (d: string) => {
      const entry = dailyMap.get(d) ?? { tiket_net: 0, fnb_net: 0, uang_masuk: 0 };
      dailyMap.set(d, entry);
      return entry;
    };
    for (const row of ledger) {
      const net = Number(row.net);
      netByType.set(row.eff_type, (netByType.get(row.eff_type) ?? 0) + net);
      const entry = dayOf(row.day);
      if (row.eff_type === "tiket") entry.tiket_net += net;
      if (row.eff_type === "fnb") entry.fnb_net += net;
      // kredit tersimpan negatif → uang masuk = −net
      if (row.eff_type === "deposit" || row.eff_type === "pembayaran") {
        entry.uang_masuk += -net;
      }
    }

    const gateByDay = new Map<string, Record<string, number>>();
    let masuk = 0;
    let masukLagi = 0;
    let masukKaryawan = 0;
    let ditolak = 0;
    for (const row of gateDaily) {
      const perDay = gateByDay.get(row.day) ?? {};
      perDay[row.key] = Number(row.n);
      gateByDay.set(row.day, perDay);
      if (row.key === "masuk") masuk += Number(row.n);
      else if (row.key === "masuk-lagi") masukLagi += Number(row.n);
      else if (row.key === "masuk-karyawan") masukKaryawan += Number(row.n);
      else ditolak += Number(row.n);
    }
    const visitsByDay = new Map(visitDaily.map((r) => [r.key, Number(r.n)]));

    const days: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    const daily = days.map((d) => {
      const money = dailyMap.get(d);
      const gate = gateByDay.get(d) ?? {};
      return {
        date: d,
        visits: visitsByDay.get(d) ?? 0,
        masuk: gate["masuk"] ?? 0,
        masuk_lagi: gate["masuk-lagi"] ?? 0,
        tiket_net: round2(money?.tiket_net ?? 0),
        fnb_net: round2(money?.fnb_net ?? 0),
        uang_masuk: round2(money?.uang_masuk ?? 0),
      };
    });

    // ── Rincian tiket per produk / kanal / musim / paket ────────────
    type Agg = { label: string; qty: number; net: number };
    const aggInto = (map: Map<string, Agg>, key: string, label: string, row: TicketContextRow) => {
      const entry = map.get(key) ?? { label, qty: 0, net: 0 };
      entry.qty += Number(row.qty);
      entry.net += Number(row.net);
      map.set(key, entry);
    };
    const byProduct = new Map<string, Agg>();
    const byChannel = new Map<string, Agg>();
    const bySeason = new Map<string, Agg>();
    const byBundle = new Map<string, Agg>();
    for (const row of ticketContexts) {
      const variant = row.variant_id ? variantById.get(row.variant_id) : null;
      aggInto(
        byProduct,
        row.variant_id ?? "-",
        variant ? `${variant.product_name} — ${variant.variant_name}` : "(tanpa konteks)",
        row
      );
      aggInto(
        byChannel,
        row.channel_id ?? "-",
        (row.channel_id && channelById.get(row.channel_id)) ?? "(tanpa kanal)",
        row
      );
      aggInto(
        bySeason,
        row.season_kind ?? (row.bundle_product_id ? "paket" : "-"),
        row.season_kind ?? (row.bundle_product_id ? "alokasi paket" : "(tanpa musim)"),
        row
      );
      if (row.bundle_product_id) {
        aggInto(
          byBundle,
          row.bundle_product_id,
          bundleById.get(row.bundle_product_id) ?? "(paket terhapus)",
          row
        );
      }
    }
    const finishAgg = (map: Map<string, Agg>) =>
      [...map.values()]
        .map((a) => ({ ...a, net: round2(a.net) }))
        .sort((a, b) => b.net - a.net);

    const uangMasuk =
      -(netByType.get("deposit") ?? 0) - (netByType.get("pembayaran") ?? 0);

    return successResponse({
      range: { from, to },
      summary: {
        visits_opened: visitDaily.reduce((s, r) => s + Number(r.n), 0),
        orang_masuk: masuk,
        masuk_lagi: masukLagi,
        masuk_karyawan: masukKaryawan,
        tap_ditolak: ditolak,
        tiket_net: round2(netByType.get("tiket") ?? 0),
        fnb_net: round2(netByType.get("fnb") ?? 0),
        denda_net: round2(netByType.get("denda") ?? 0),
        uang_masuk: round2(uangMasuk),
        refund_keluar: round2(netByType.get("refund-deposit") ?? 0),
      },
      methods: methods.map((m) => ({
        charge_type: m.charge_type,
        method: m.method,
        total: Number(m.total),
      })),
      daily,
      tickets: {
        products: finishAgg(byProduct),
        channels: finishAgg(byChannel),
        seasons: finishAgg(bySeason),
        bundles: finishAgg(byBundle),
      },
      // Pengakuan revenue booking (keputusan owner 2026-07-23): terbayar
      // belum redeem = titipan (bukan revenue); hangus = revenue hangus di
      // tanggal forfeited_at
      booking: {
        titipan_count: Number(bookingDeposit[0]?.n ?? 0),
        titipan_total: round2(Number(bookingDeposit[0]?.total ?? 0)),
        hangus_count: Number(bookingForfeited[0]?.n ?? 0),
        hangus_total: round2(Number(bookingForfeited[0]?.total ?? 0)),
      },
      bands: bandsRecap.map((b) => ({ status: b.key, n: Number(b.n) })),
      hanging: {
        count: hanging.length,
        total: round2(hanging.reduce((s, h) => s + Number(h.outstanding), 0)),
        items: hanging.map((h) => ({
          id: h.id,
          contact_name: h.contact_name,
          payment_mode: h.payment_mode,
          opened_at: h.opened_at,
          outstanding: Number(h.outstanding),
        })),
      },
    });
  } catch (err) {
    console.error("[ticketing] reports error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat laporan" },
      { status: 500 }
    );
  }
}
