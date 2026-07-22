// Fase D — kirim WA kode booking terbayar. Dipakai dua jalur: webhook
// Xendit (otomatis saat PAID) dan tombol "Kirim ulang WA" di dashboard
// Booking (D5). Best-effort: kegagalan WA tidak boleh menggagalkan
// transaksi pemanggil — pemanggil memutus sendiri apa arti hasil false.

import { readGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";

export interface PaidBookingWaInput {
  booking_code: string;
  access_token: string;
  visit_date: string;
  customer_name: string;
  customer_phone: string;
  total: string | number;
}

export async function sendBookingPaidWa(
  booking: PaidBookingWaInput
): Promise<{ success: boolean; reason?: string }> {
  const config = readGatewayConfig();
  if (!config) {
    console.error(
      "[booking] WA gateway belum dikonfigurasi — kode booking tidak terkirim"
    );
    return { success: false, reason: "gateway-belum-dikonfigurasi" };
  }
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const statusUrl = `${baseUrl}/booking/status/${booking.access_token}`;
  const message =
    `*Pembayaran diterima* ✅\n\n` +
    `Kode booking: *${booking.booking_code}*\n` +
    `Tanggal kunjungan: ${booking.visit_date}\n` +
    `Atas nama: ${booking.customer_name}\n` +
    `Total: Rp${Number(booking.total).toLocaleString("id-ID")}\n\n` +
    `Tunjukkan QR di halaman ini ke petugas loket:\n${statusUrl}`;

  const result = await sendGatewayText(config, {
    target: booking.customer_phone,
    message,
  });
  if (!result.success) {
    console.error("[booking] kirim WA gagal:", result.reason);
    return { success: false, reason: result.reason };
  }
  return { success: true };
}
