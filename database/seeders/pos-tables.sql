-- POS tables seeder: 10 tables per floor (B, GF, 1–5).
-- Idempotent on table_number.

WITH floors AS (
  SELECT *
  FROM (
    VALUES
      (0, 'B'::text,  'Basement'::text,     'Indoor'::text),
      (1, 'GF',       'Ground Floor',       'Indoor'),
      (2, '1',        'Floor 1',            'Indoor'),
      (3, '2',        'Floor 2',            'Outdoor'),
      (4, '3',        'Floor 3',            'VIP'),
      (5, '4',        'Floor 4',            'Terrace'),
      (6, '5',        'Floor 5',            'Rooftop')
  ) AS f(floor_idx, floor_code, floor_label, default_area)
),
nums AS (
  SELECT generate_series(1, 10) AS n
),
seed AS (
  SELECT
    f.floor_idx,
    f.floor_code,
    f.floor_label,
    f.default_area,
    n.n,
    f.floor_code || '-' || lpad(n.n::text, 2, '0') AS table_number,
    CASE
      WHEN n.n <= 6 THEN f.default_area
      WHEN n.n <= 8 THEN 'Outdoor'
      ELSE 'VIP'
    END AS area,
    (ARRAY[2, 4, 4, 6, 4, 4, 6, 8, 2, 4])[n.n] AS capacity,
    -- Local layout within each floor canvas (5 cols × 2 rows)
    round((4 + ((n.n - 1) % 5) * 18)::numeric, 2) AS pos_x,
    round((8 + ((n.n - 1) / 5) * 42)::numeric, 2) AS pos_y
  FROM floors f
  CROSS JOIN nums n
)
INSERT INTO pos.pos_tables (
  table_number,
  name,
  floor,
  area,
  capacity,
  status,
  qr_code,
  notes,
  is_active,
  pos_x,
  pos_y
)
SELECT
  s.table_number,
  'Table ' || s.table_number,
  s.floor_code,
  s.area,
  s.capacity,
  'available'::pos_table_status,
  'TBL-' || replace(s.table_number, '-', '') || '-SEED',
  s.floor_label || ' seed table',
  true,
  s.pos_x,
  s.pos_y
FROM seed s
ON CONFLICT (table_number) DO UPDATE SET
  name = EXCLUDED.name,
  floor = EXCLUDED.floor,
  area = EXCLUDED.area,
  capacity = EXCLUDED.capacity,
  qr_code = EXCLUDED.qr_code,
  notes = EXCLUDED.notes,
  is_active = true,
  status = 'available'::pos_table_status,
  pos_x = EXCLUDED.pos_x,
  pos_y = EXCLUDED.pos_y,
  updated_at = now();
