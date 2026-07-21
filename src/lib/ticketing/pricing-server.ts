// Jembatan resolver harga murni (pricing.ts) ke data master ber-tenant.
// Dipakai gate tap-charge (Fase B) dan booking website (Fase D).

import type { PoolClient } from "pg";
import {
  resolvePrice,
  resolveSeasonKind,
  type PriceEntry,
  type SeasonKind,
  type SeasonRange,
} from "./pricing";

/** Tanggal hari ini menurut operasional venue (WIB). */
export function todayJakartaDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
  }).format(new Date());
}

export interface ResolvedTicketPrice {
  price: number;
  seasonKind: SeasonKind;
}

/**
 * Resolve harga tiket untuk satu tanggal kunjungan di dalam transaksi:
 * kalender musim venue → season kind → baris matriks harga. Null bila
 * matriks berlubang — pemanggil WAJIB menolak, jangan menebak harga.
 */
export async function resolveTicketPriceOnDate(
  client: PoolClient,
  input: {
    companyId: string;
    branchId: string;
    ticketTypeId: string;
    channelId: string;
    visitDate: string;
  }
): Promise<ResolvedTicketPrice | null> {
  const seasonsResult = await client.query<SeasonRange>(
    `SELECT season_kind, start_date::text AS start_date,
            end_date::text AS end_date, is_active
     FROM ticketing.ticket_seasons
     WHERE branch_id = $1 AND company_id = $2`,
    [input.branchId, input.companyId]
  );
  const seasonKind = resolveSeasonKind(input.visitDate, seasonsResult.rows);

  const priceResult = await client.query<{
    ticket_type_id: string;
    season_kind: SeasonKind;
    channel_id: string;
    price: string;
  }>(
    `SELECT ticket_type_id, season_kind, channel_id, price
     FROM ticketing.ticket_prices
     WHERE branch_id = $1 AND company_id = $2
       AND ticket_type_id = $3 AND channel_id = $4`,
    [input.branchId, input.companyId, input.ticketTypeId, input.channelId]
  );
  const entries: PriceEntry[] = priceResult.rows.map((row) => ({
    ticket_type_id: row.ticket_type_id,
    season_kind: row.season_kind,
    channel_id: row.channel_id,
    price: Number(row.price),
  }));

  const price = resolvePrice(entries, {
    ticketTypeId: input.ticketTypeId,
    seasonKind,
    channelId: input.channelId,
  });
  return price === null ? null : { price, seasonKind };
}
