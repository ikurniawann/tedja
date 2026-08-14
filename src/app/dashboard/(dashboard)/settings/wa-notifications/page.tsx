import { requireRole } from "@/lib/auth/require-user";
import { WaNotifSettingsPanel } from "@/components/arkiv/wa-notif-settings";

/**
 * Settings → Notifikasi WA di dashboard.
 *
 * Komponennya sama dengan jendela Settings di desktop /arkiv-os (EPIC-020) —
 * satu sumber untuk recipients owner, ambang notifikasi, dan penerima laporan
 * tutup kasir. Komponen itu ditata untuk latar gelap desktop, jadi di dashboard
 * (terang) ia dibungkus panel gelap alih-alih menduplikasi seluruh form dengan
 * gaya terang — dua salinan form berarti dua tempat yang bisa saling basi.
 */
export default async function WaNotificationsSettingsPage() {
  await requireRole(["super_admin", "direksi"]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold text-gray-900">Notifikasi WA</h1>
      <p className="mt-1 text-sm text-gray-500">
        Nomor penerima notifikasi owner, ambang peringatan, dan penerima laporan
        tutup kasir.
      </p>
      <div className="mt-4 overflow-hidden rounded-3xl bg-slate-950 text-white">
        <WaNotifSettingsPanel />
      </div>
    </div>
  );
}
