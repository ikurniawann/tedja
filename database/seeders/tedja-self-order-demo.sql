-- =============================================================================
-- Seeder: data demo ringkas utk self-order meja Tedja (EPIC-048).
--
-- Isi: 4 kategori POS, 12 produk (varian Ice/Hot & ukuran, XP, station, foto),
-- 1 produk khusus member (min_xp), 2 member demo. Meja TIDAK disentuh
-- (sudah ada 5-01…5-05 dgn qr_code). Idempotent: produk upsert by sku,
-- kategori/member by nama/nomor — aman dijalankan berulang. Transaksi diatur
-- oleh runner (run-sql-file.js / psql --single-transaction).
--
-- Jalankan: npm run db:seed:tedja-self-order
--   (atau: docker exec -i tedja-db psql -U tedja -d tedja < file ini)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Kategori
-- ---------------------------------------------------------------------------
INSERT INTO pos.pos_categories (name, display_order, is_active)
SELECT v.name, v.display_order, true
FROM (VALUES
  ('Kopi', 10),
  ('Non-Kopi', 20),
  ('Makanan', 30),
  ('Dessert & Pastry', 40)
) AS v(name, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM pos.pos_categories c WHERE lower(c.name) = lower(v.name)
);

UPDATE pos.pos_categories c
SET display_order = v.display_order, is_active = true, updated_at = now()
FROM (VALUES
  ('Kopi', 10), ('Non-Kopi', 20), ('Makanan', 30), ('Dessert & Pastry', 40)
) AS v(name, display_order)
WHERE lower(c.name) = lower(v.name);

-- ---------------------------------------------------------------------------
-- Produk (upsert by sku)
-- ---------------------------------------------------------------------------
WITH cat AS (
  SELECT id, lower(name) AS name FROM pos.pos_categories
),
seed(sku, name, category, description, base_price, cost_price, xp_points, station, prep, min_xp, image_url) AS (VALUES
  -- Kopi
  ('TDJ-KOPI-SUSU',   'Es Kopi Susu Tedja',        'kopi',
     'Espresso house blend, susu segar, gula aren. Signature Tedja.',
     25000, 9000, 25, 'bar', 5, NULL,
     'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=800&q=80'),
  ('TDJ-AMERICANO',   'Americano',                 'kopi',
     'Double shot espresso dengan air — bold dan bersih.',
     22000, 6000, 22, 'bar', 4, NULL,
     'https://images.unsplash.com/photo-1551030173-122aabc4489c?auto=format&fit=crop&w=800&q=80'),
  ('TDJ-CAPPUCCINO',  'Cappuccino',                'kopi',
     'Espresso, steamed milk, dan foam lembut.',
     28000, 8000, 28, 'bar', 5, NULL,
     'https://images.unsplash.com/photo-1572442388796-11668a67e53d?auto=format&fit=crop&w=800&q=80'),
  ('TDJ-TUBRUK',      'Kopi Tubruk',               'kopi',
     'Kopi robusta pilihan diseduh tubruk, manis atau pahit.',
     18000, 4000, 18, 'bar', 4, NULL,
     'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?auto=format&fit=crop&w=800&q=80'),
  ('TDJ-COLD-BREW',   'Tedja Signature Cold Brew', 'kopi',
     'Cold brew 18 jam, khusus member Bronze ke atas.',
     38000, 12000, 40, 'bar', 3, 100,
     'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=800&q=80'),
  -- Non-Kopi
  ('TDJ-MATCHA',      'Matcha Latte',              'non-kopi',
     'Matcha Uji premium dengan susu segar.',
     30000, 10000, 30, 'bar', 5, NULL,
     'https://images.unsplash.com/photo-1515823064-d6e0c04616a7?auto=format&fit=crop&w=800&q=80'),
  ('TDJ-TEH-LECI',    'Es Teh Leci',               'non-kopi',
     'Teh hitam dingin dengan leci dan jeruk nipis.',
     20000, 5000, 20, 'bar', 3, NULL,
     'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=800&q=80'),
  -- Makanan
  ('TDJ-NASI-AYAM',   'Nasi Ayam Sambal Matah',    'makanan',
     'Nasi hangat, ayam goreng, sambal matah, telur, dan lalapan.',
     35000, 15000, 35, 'kitchen', 15, NULL,
     'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80'),
  ('TDJ-MIE-GORENG',  'Mie Goreng Tedja',          'makanan',
     'Mie goreng ala kafe dengan telur, sayur, dan kerupuk.',
     30000, 12000, 30, 'kitchen', 12, NULL,
     'https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=800&q=80'),
  ('TDJ-ROTI-BAKAR',  'Roti Bakar Coklat Keju',    'makanan',
     'Roti bakar tebal, coklat, dan keju parut.',
     22000, 8000, 22, 'bakery', 8, NULL,
     'https://images.unsplash.com/photo-1484723091739-30a097e8f929?auto=format&fit=crop&w=800&q=80'),
  -- Dessert & Pastry
  ('TDJ-CROISSANT',   'Butter Croissant',          'dessert & pastry',
     'Croissant mentega renyah, dipanggang tiap pagi.',
     24000, 9000, 24, 'bakery', 3, NULL,
     'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=800&q=80'),
  ('TDJ-CHEESECAKE',  'Cheesecake Slice',          'dessert & pastry',
     'Cheesecake lembut dengan saus berry.',
     32000, 12000, 32, 'dessert', 3, NULL,
     'https://images.unsplash.com/photo-1464349095431-e9a21285b5f3?auto=format&fit=crop&w=800&q=80')
)
INSERT INTO pos.pos_products (
  sku, name, description, category_id, base_price, cost_price,
  is_active, is_available, inventory_tracking, xp_points, image_url,
  prep_time_minutes, station, min_xp, product_kind, created_at, updated_at
)
SELECT s.sku, s.name, s.description, cat.id, s.base_price, s.cost_price,
       true, true, false, s.xp_points, s.image_url,
       s.prep, s.station, s.min_xp, 'regular', now(), now()
FROM seed s
JOIN cat ON cat.name = s.category
ON CONFLICT (sku) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category_id = EXCLUDED.category_id,
  base_price = EXCLUDED.base_price,
  cost_price = EXCLUDED.cost_price,
  is_active = true,
  is_available = true,
  xp_points = EXCLUDED.xp_points,
  image_url = EXCLUDED.image_url,
  prep_time_minutes = EXCLUDED.prep_time_minutes,
  station = EXCLUDED.station,
  min_xp = EXCLUDED.min_xp,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Varian (reset & isi ulang utk produk seed)
-- ---------------------------------------------------------------------------
DELETE FROM pos.pos_product_variants
WHERE product_id IN (SELECT id FROM pos.pos_products WHERE sku LIKE 'TDJ-%');

WITH v(sku, group_name, name, price_adjustment, display_order) AS (VALUES
  ('TDJ-KOPI-SUSU',  'Suhu',   'Ice',           0,    1),
  ('TDJ-KOPI-SUSU',  'Suhu',   'Hot',           0,    2),
  ('TDJ-KOPI-SUSU',  'Suhu',   'Ice — Oat Milk', 8000, 3),
  ('TDJ-AMERICANO',  'Suhu',   'Hot',           0,    1),
  ('TDJ-AMERICANO',  'Suhu',   'Ice',           0,    2),
  ('TDJ-CAPPUCCINO', 'Suhu',   'Hot',           0,    1),
  ('TDJ-CAPPUCCINO', 'Suhu',   'Ice',           0,    2),
  ('TDJ-MATCHA',     'Suhu',   'Ice',           0,    1),
  ('TDJ-MATCHA',     'Suhu',   'Hot',           0,    2),
  ('TDJ-TEH-LECI',   'Gula',   'Normal',        0,    1),
  ('TDJ-TEH-LECI',   'Gula',   'Less Sugar',    0,    2),
  ('TDJ-NASI-AYAM',  'Porsi',  'Regular',       0,    1),
  ('TDJ-NASI-AYAM',  'Porsi',  'Large',         8000, 2),
  ('TDJ-MIE-GORENG', 'Level',  'Tidak Pedas',   0,    1),
  ('TDJ-MIE-GORENG', 'Level',  'Pedas',         0,    2),
  ('TDJ-CHEESECAKE', 'Topping','Original',      0,    1),
  ('TDJ-CHEESECAKE', 'Topping','Extra Berry',   5000, 2)
)
INSERT INTO pos.pos_product_variants (product_id, group_name, name, price_adjustment, display_order, is_active)
SELECT p.id, v.group_name, v.name, v.price_adjustment, v.display_order, true
FROM v JOIN pos.pos_products p ON p.sku = v.sku;

-- ---------------------------------------------------------------------------
-- Member demo (utk uji ARK Coin / privilege min_xp; nomor harus terdaftar
-- agar bisa login OTP di self-order)
-- ---------------------------------------------------------------------------
INSERT INTO pos.pos_customers (phone, name, membership_tier, member_type, total_xp, ark_coin_balance, is_active, notes)
SELECT m.phone, m.name, m.tier, 'registered', m.xp, m.ark, true, 'Seed demo self-order (EPIC-048)'
FROM (VALUES
  ('081200000001', 'Demo Member Bronze', 'bronze', 150,   100000),
  ('081200000002', 'Demo Member Gold',   'gold',   35000, 250000)
) AS m(phone, name, tier, xp, ark)
WHERE NOT EXISTS (
  SELECT 1 FROM pos.pos_customers c
  WHERE regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') = m.phone
);


-- Ringkasan
SELECT 'kategori' AS entitas, count(*) AS jumlah FROM pos.pos_categories WHERE is_active
UNION ALL SELECT 'produk seed aktif', count(*) FROM pos.pos_products WHERE sku LIKE 'TDJ-%' AND is_active AND is_available
UNION ALL SELECT 'varian seed', count(*) FROM pos.pos_product_variants v JOIN pos.pos_products p ON p.id = v.product_id WHERE p.sku LIKE 'TDJ-%'
UNION ALL SELECT 'member demo', count(*) FROM pos.pos_customers WHERE phone IN ('081200000001', '081200000002');
