-- EPIC-043: Complimentary orders (KOL & Owner) — keputusan owner 2026-08-23.
-- KOL: customer bertanda is_kol mendapat gratis OTOMATIS (tercatat penuh,
-- total 0), dengan kuota bulanan opsional. Owner: open bill diselesaikan
-- sebagai gratis dengan persetujuan PIN supervisor (padanan tanda tangan
-- di struk) — siapa yang menyetujui tercatat di order.

ALTER TABLE pos.pos_customers
  ADD COLUMN IF NOT EXISTS is_kol boolean NOT NULL DEFAULT false;
-- NULL = tanpa batas; angka = plafon nilai GROSS (subtotal) komplimen/bulan.
ALTER TABLE pos.pos_customers
  ADD COLUMN IF NOT EXISTS kol_monthly_limit_idr numeric(14,2);

-- 'kol_comp' | 'owner_comp' | NULL (order berbayar biasa)
ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS comp_type varchar(20);
ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS comp_approved_by uuid;
ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS comp_approved_name varchar(120);

CREATE INDEX IF NOT EXISTS idx_pos_orders_comp
  ON pos.pos_orders(comp_type) WHERE comp_type IS NOT NULL;

-- Contoh menandai KOL (dijalankan manual/oleh agent, bukan dari kasir):
-- UPDATE pos.pos_customers SET is_kol = true, kol_monthly_limit_idr = 500000
-- WHERE phone = '628xxxxxxxxx';
