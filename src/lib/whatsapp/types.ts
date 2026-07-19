/**
 * Lapisan pengiriman WhatsApp — netral terhadap penyedia.
 *
 * Dua penyedia didukung:
 * - `meta`   : WhatsApp Business Cloud API resmi (Meta). Pesan yang diinisiasi
 *              bisnis WAJIB memakai template yang sudah disetujui; teks bebas
 *              hanya boleh dalam jendela layanan 24 jam setelah member membalas.
 * - `fonnte` : gateway tidak resmi. Bebas kirim teks, tapi nomor berisiko
 *              diblokir WhatsApp.
 */

export type WhatsAppProvider = "meta" | "fonnte";

export interface WhatsAppResult {
  success: boolean;
  /** Alasan kegagalan yang aman ditampilkan di log (tanpa isi pesan). */
  reason?: string;
  provider?: WhatsAppProvider;
  messageId?: string;
}

export interface TextMessage {
  /** Nomor tujuan, digit saja, format 62xxx. */
  target: string;
  message: string;
}

export interface TemplateMessage {
  target: string;
  templateName: string;
  languageCode: string;
  /** Nilai untuk placeholder {{1}}, {{2}}, ... pada badan template. */
  bodyParameters: string[];
  /**
   * Template kategori AUTHENTICATION di Meta wajib punya tombol salin-kode,
   * dan tombol itu menerima kode yang sama seperti badan pesan.
   */
  copyCodeButton?: string;
}
