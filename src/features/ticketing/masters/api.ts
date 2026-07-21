import type {
  BandFilters,
  BandListResponse,
  PriceEntry,
  PriceMatrixResponse,
  SeasonFormValues,
  SettingsFormValues,
  TicketBand,
  TicketChannel,
  TicketSeason,
  TicketType,
  TicketTypeFormValues,
  TicketingSettings,
} from "./types";

async function parseError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    message = body.error ?? body.message ?? fallback;
  } catch {
    // body bukan JSON — pakai fallback
  }
  throw new Error(message);
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) await parseError(res, fallback);
  const body = (await res.json()) as { data: T };
  return body.data;
}

async function sendJson<T>(
  url: string,
  method: "POST" | "PATCH" | "PUT",
  payload: unknown,
  fallback: string
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) await parseError(res, fallback);
  const body = (await res.json()) as { data: T };
  return body.data;
}

// ── Settings (GET men-bootstrap default venue: adult/child + kanal) ──
export const fetchSettings = () =>
  getJson<TicketingSettings>("/api/ticketing/settings", "Gagal memuat pengaturan");

export const updateSettings = (values: SettingsFormValues) =>
  sendJson<TicketingSettings>(
    "/api/ticketing/settings",
    "PUT",
    values,
    "Gagal menyimpan pengaturan"
  );

// ── Jenis tiket ──
export const fetchTicketTypes = () =>
  getJson<TicketType[]>("/api/ticketing/ticket-types", "Gagal memuat jenis tiket");

export const createTicketType = (values: TicketTypeFormValues) =>
  sendJson<TicketType>(
    "/api/ticketing/ticket-types",
    "POST",
    values,
    "Gagal membuat jenis tiket"
  );

export const updateTicketType = (
  id: string,
  values: Partial<TicketTypeFormValues> & { is_active?: boolean }
) =>
  sendJson<TicketType>(
    `/api/ticketing/ticket-types/${id}`,
    "PATCH",
    values,
    "Gagal memperbarui jenis tiket"
  );

// ── Kalender musim ──
export const fetchSeasons = () =>
  getJson<TicketSeason[]>("/api/ticketing/seasons", "Gagal memuat kalender musim");

export const createSeason = (values: SeasonFormValues) =>
  sendJson<TicketSeason>("/api/ticketing/seasons", "POST", values, "Gagal menambah musim");

export const updateSeason = (
  id: string,
  values: Partial<SeasonFormValues> & { is_active?: boolean }
) =>
  sendJson<TicketSeason>(
    `/api/ticketing/seasons/${id}`,
    "PATCH",
    values,
    "Gagal memperbarui musim"
  );

export async function deleteSeason(id: string): Promise<void> {
  const res = await fetch(`/api/ticketing/seasons/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) await parseError(res, "Gagal menghapus musim");
}

// ── Kanal ──
export const fetchChannels = () =>
  getJson<TicketChannel[]>("/api/ticketing/channels", "Gagal memuat kanal");

export const updateChannel = (
  id: string,
  values: { name?: string; is_active?: boolean }
) =>
  sendJson<TicketChannel>(
    `/api/ticketing/channels/${id}`,
    "PATCH",
    values,
    "Gagal memperbarui kanal"
  );

// ── Matriks harga ──
export const fetchPriceMatrix = () =>
  getJson<PriceMatrixResponse>("/api/ticketing/prices", "Gagal memuat matriks harga");

export const savePriceMatrix = (entries: PriceEntry[]) =>
  sendJson<{ saved: number }>(
    "/api/ticketing/prices",
    "PUT",
    { entries },
    "Gagal menyimpan matriks harga"
  );

// ── Registry gelang ──
export async function fetchBands(filters: BandFilters): Promise<BandListResponse> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  params.set("page", String(filters.page));
  params.set("limit", "20");

  const res = await fetch(`/api/ticketing/bands?${params.toString()}`);
  if (!res.ok) await parseError(res, "Gagal memuat registry gelang");
  return res.json();
}

export const registerBand = (values: { nfc_uid: string; label: string | null }) =>
  sendJson<TicketBand>("/api/ticketing/bands", "POST", values, "Gagal mendaftarkan gelang");

export const updateBand = (
  id: string,
  values: { label?: string | null; status?: TicketBand["status"] }
) =>
  sendJson<TicketBand>(
    `/api/ticketing/bands/${id}`,
    "PATCH",
    values,
    "Gagal memperbarui gelang"
  );
