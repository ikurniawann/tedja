import type {
  BandFilters,
  BandListResponse,
  SettingsFormValues,
  TicketBand,
  TicketChannel,
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

// ── Settings (GET men-bootstrap kanal default venue) ──
export const fetchSettings = () =>
  getJson<TicketingSettings>("/api/ticketing/settings", "Gagal memuat pengaturan");

export const updateSettings = (values: SettingsFormValues) =>
  sendJson<TicketingSettings>(
    "/api/ticketing/settings",
    "PUT",
    values,
    "Gagal menyimpan pengaturan"
  );

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
