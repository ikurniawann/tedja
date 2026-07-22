// Klien Xendit Invoice minimal untuk website booking (EPIC-023 Fase D).
// Sadar-konfigurasi: tanpa XENDIT_SECRET_KEY route pembuatan booking
// menolak rapi (503), TIDAK melempar saat import. Mode mock
// (XENDIT_MOCK=1, khusus dev) mengembalikan invoice palsu yang menunjuk
// halaman status booking sendiri supaya alur bisa diuji end-to-end
// sebelum key tersedia.

const XENDIT_INVOICE_URL = "https://api.xendit.co/v2/invoices";
const INVOICE_EXPIRY_HOURS = 2;

export interface CreateInvoiceInput {
  /** external_id Xendit — pakai id booking, prefiks jelas. */
  externalId: string;
  amount: number;
  payerName: string;
  description: string;
  /** URL absolut halaman status booking (redirect sukses/gagal). */
  redirectUrl: string;
}

export interface CreatedInvoice {
  invoiceId: string;
  invoiceUrl: string;
  expiresAt: Date;
}

export function isXenditConfigured(): boolean {
  return Boolean(process.env.XENDIT_SECRET_KEY) || isXenditMock();
}

export function isXenditMock(): boolean {
  const mock = process.env.XENDIT_MOCK === "1";
  // Mock tertinggal nyala di produksi = booking dibuat tapi pelanggan tak
  // pernah bisa bayar sungguhan — teriak keras di log, jangan diam-diam.
  if (mock && process.env.NODE_ENV === "production") {
    console.error(
      "[xendit] PERINGATAN: XENDIT_MOCK=1 aktif di NODE_ENV=production — " +
        "invoice palsu, pembayaran nyata TIDAK berjalan"
    );
  }
  return mock;
}

export function getInvoiceExpiryHours(): number {
  return INVOICE_EXPIRY_HOURS;
}

/**
 * Buat invoice Xendit. Pemanggil bertanggung jawab cek
 * `isXenditConfigured()` dulu; di sini tetap dijaga (defense in depth).
 */
export async function createInvoice(
  input: CreateInvoiceInput
): Promise<CreatedInvoice> {
  const expiresAt = new Date(
    Date.now() + INVOICE_EXPIRY_HOURS * 60 * 60 * 1000
  );

  if (isXenditMock()) {
    return {
      invoiceId: `mock-${input.externalId}`,
      invoiceUrl: input.redirectUrl,
      expiresAt,
    };
  }

  const secretKey = process.env.XENDIT_SECRET_KEY;
  if (!secretKey) {
    throw new Error("XENDIT_SECRET_KEY belum dikonfigurasi");
  }

  const response = await fetch(XENDIT_INVOICE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
    },
    body: JSON.stringify({
      external_id: input.externalId,
      amount: input.amount,
      payer_email: undefined,
      description: input.description,
      invoice_duration: INVOICE_EXPIRY_HOURS * 60 * 60,
      success_redirect_url: input.redirectUrl,
      failure_redirect_url: input.redirectUrl,
      currency: "IDR",
      customer: { given_names: input.payerName },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // Jangan bocorkan body Xendit ke klien — log server saja di pemanggil
    throw new Error(`Xendit menolak pembuatan invoice (HTTP ${response.status}): ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    id: string;
    invoice_url: string;
    expiry_date?: string;
  };
  return {
    invoiceId: data.id,
    invoiceUrl: data.invoice_url,
    expiresAt: data.expiry_date ? new Date(data.expiry_date) : expiresAt,
  };
}

/** Verifikasi callback webhook Xendit via header x-callback-token. */
export function isValidWebhookToken(headerToken: string | null): boolean {
  const expected = process.env.XENDIT_WEBHOOK_TOKEN;
  if (!expected) return false;
  return headerToken === expected;
}
