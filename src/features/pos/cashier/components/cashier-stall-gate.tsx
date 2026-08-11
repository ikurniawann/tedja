"use client";

/**
 * Banner only — stall selection stays in the sidebar switcher (single source).
 * Avoids a second stall list on the cashier canvas.
 */
export function CashierStallGate({ reason }: { reason: string }) {
  const title =
    reason === "no_stall"
      ? "Tidak ada stall penempatan"
      : "Pilih stall aktif untuk berjualan";
  const hint =
    reason === "no_stall"
      ? "Hubungi admin untuk assign stall ke akun Anda."
      : "Mode Semua Stall tidak diizinkan di kasir. Ganti lewat switcher stall di sidebar (klik nama stall di kiri atas), pilih satu stall — bukan Semua Stall.";

  return (
    <div className="absolute inset-x-0 top-16 z-40 mx-auto max-w-lg px-4">
      <div className="rounded-xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm">
        <p className="font-medium text-amber-950">{title}</p>
        <p className="mt-1 text-amber-900/90">{hint}</p>
      </div>
    </div>
  );
}
