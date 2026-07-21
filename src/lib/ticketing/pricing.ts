// Resolver harga tiket (EPIC-023): jenis tiket × musim × kanal → satu harga
// pasti. Fungsi murni tanpa akses DB agar mudah diuji — API/gate memanggil
// dengan data master yang sudah ter-scope venue.

export type SeasonKind = "regular" | "high";

export interface SeasonRange {
  season_kind: SeasonKind;
  start_date: string; // YYYY-MM-DD inklusif
  end_date: string; // YYYY-MM-DD inklusif
  is_active: boolean;
}

export interface PriceEntry {
  ticket_type_id: string;
  season_kind: SeasonKind;
  channel_id: string;
  price: number;
}

/** Valid bila string YYYY-MM-DD adalah tanggal kalender sungguhan. */
export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/**
 * Musim untuk sebuah tanggal kunjungan. Aturan (keputusan owner 2026-07-21,
 * kalender manual): rentang `high` yang aktif dan memuat tanggal → `high`;
 * di luar semua rentang → `regular`. Bila rentang high dan regular
 * bertumpuk, `high` menang.
 */
export function resolveSeasonKind(
  visitDate: string,
  seasons: readonly SeasonRange[]
): SeasonKind {
  if (!isValidCalendarDate(visitDate)) {
    throw new Error(`Tanggal kunjungan tidak valid: ${visitDate}`);
  }
  const matches = seasons.filter(
    (s) =>
      s.is_active && s.start_date <= visitDate && visitDate <= s.end_date
  );
  return matches.some((s) => s.season_kind === "high") ? "high" : "regular";
}

/**
 * Harga pasti untuk kombinasi jenis tiket + musim + kanal, atau null bila
 * matriks berlubang (harga belum diisi) — pemanggil WAJIB menolak transaksi,
 * jangan menebak harga.
 */
export function resolvePrice(
  prices: readonly PriceEntry[],
  key: { ticketTypeId: string; seasonKind: SeasonKind; channelId: string }
): number | null {
  const found = prices.find(
    (p) =>
      p.ticket_type_id === key.ticketTypeId &&
      p.season_kind === key.seasonKind &&
      p.channel_id === key.channelId
  );
  return found ? found.price : null;
}

export interface PriceGap {
  ticket_type_id: string;
  season_kind: SeasonKind;
  channel_id: string;
}

/**
 * Lubang matriks harga: kombinasi (tipe aktif × regular/high × kanal aktif)
 * yang belum punya baris harga. Dipakai validasi UI — kanal aktif tidak
 * boleh punya lubang harga.
 */
export function findPriceGaps(
  activeTicketTypeIds: readonly string[],
  activeChannelIds: readonly string[],
  prices: readonly PriceEntry[]
): PriceGap[] {
  const filled = new Set(
    prices.map((p) => `${p.ticket_type_id}|${p.season_kind}|${p.channel_id}`)
  );
  const gaps: PriceGap[] = [];
  for (const typeId of activeTicketTypeIds) {
    for (const seasonKind of ["regular", "high"] as const) {
      for (const channelId of activeChannelIds) {
        if (!filled.has(`${typeId}|${seasonKind}|${channelId}`)) {
          gaps.push({
            ticket_type_id: typeId,
            season_kind: seasonKind,
            channel_id: channelId,
          });
        }
      }
    }
  }
  return gaps;
}
