-- Insiden 2026-08-23 (POS-20260823-0132/0138): item berpindah antar bill yang
-- SUDAH DIBAYAR via transfer-meja/merge — totals dihitung ulang, amount_paid
-- tidak, dan tidak ada jejak siapa/kapan. Tabel ini = audit trail setiap
-- pemindahan item antar order (transfer meja & merge bill).

CREATE TABLE IF NOT EXISTS pos.pos_order_item_move_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- 'transfer' (pindah item antar meja) | 'merge' (gabung bill)
  action varchar(20) NOT NULL,
  source_order_id uuid NOT NULL,
  source_order_number varchar(50),
  target_order_id uuid NOT NULL,
  target_order_number varchar(50),
  -- Snapshot item yang pindah: [{id, product_name, quantity, unit_price, total_amount}]
  items jsonb NOT NULL DEFAULT '[]',
  moved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_move_logs_source
  ON pos.pos_order_item_move_logs(source_order_id);
CREATE INDEX IF NOT EXISTS idx_item_move_logs_target
  ON pos.pos_order_item_move_logs(target_order_id);
