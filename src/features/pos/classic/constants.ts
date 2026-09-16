/**
 * POS Classic — kasir gaya klasik (tombol besar, keypad angka) untuk layar
 * sentuh. Skin baru di atas engine kasir yang sama; tidak menyentuh POS utama.
 */

export const POS_CLASSIC_ROUTE = "/dashboard/pos/classic";

/** Warna ubin kategori — dipetakan urut per nama kategori, berulang bila habis. */
export const CLASSIC_PALETTE = [
  { tile: "bg-amber-500 hover:bg-amber-400", chip: "bg-amber-500 text-white" },
  { tile: "bg-emerald-600 hover:bg-emerald-500", chip: "bg-emerald-600 text-white" },
  { tile: "bg-sky-600 hover:bg-sky-500", chip: "bg-sky-600 text-white" },
  { tile: "bg-rose-600 hover:bg-rose-500", chip: "bg-rose-600 text-white" },
  { tile: "bg-violet-600 hover:bg-violet-500", chip: "bg-violet-600 text-white" },
  { tile: "bg-orange-600 hover:bg-orange-500", chip: "bg-orange-600 text-white" },
  { tile: "bg-teal-600 hover:bg-teal-500", chip: "bg-teal-600 text-white" },
  { tile: "bg-fuchsia-600 hover:bg-fuchsia-500", chip: "bg-fuchsia-600 text-white" },
  { tile: "bg-lime-600 hover:bg-lime-500", chip: "bg-lime-600 text-white" },
  { tile: "bg-cyan-600 hover:bg-cyan-500", chip: "bg-cyan-600 text-white" },
] as const;

export const CLASSIC_ORDER_TYPES = [
  { value: "dine_in", label: "Dine In" },
  { value: "takeaway", label: "Take Away" },
  { value: "delivery", label: "Delivery" },
] as const;

/** Tata letak keypad 3 kolom, kiri→kanan, atas→bawah. */
export const CLASSIC_KEYPAD = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "C", "0", "00"] as const;
