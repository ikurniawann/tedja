-- =============================================================================
-- Pindahkan grup menu "Inventory" & "Purchasing" ke dalam grup "Items".
--
-- Urutan akhir di dalam Items:
--   1. Raw Material  (items.raw-material, order 10)
--   2. Product       (items.product,      order 20)
--   3. Inventory     (inventory,          order 30)  <- dipindah ke dalam Items
--   4. Purchasing    (purchasing,         order 40)  <- dipindah ke dalam Items
--
-- Tree menu dibangun via parent_id (rekursif), jadi kedalaman tambahan
-- (Items > Purchasing > Procurement > ...) tetap ter-render. Kolom level
-- diselaraskan agar konsisten. Permission tidak berubah (ancestor otomatis
-- disertakan oleh getUserMenus).
-- =============================================================================

-- Re-parent Inventory ke dalam Items
UPDATE iam.menus
SET parent_id    = (SELECT id FROM iam.menus WHERE code = 'items' AND deleted_at IS NULL),
    level        = 2,
    order_number = 30,
    updated_at   = now()
WHERE code = 'inventory' AND deleted_at IS NULL;

-- Re-parent Purchasing ke dalam Items
UPDATE iam.menus
SET parent_id    = (SELECT id FROM iam.menus WHERE code = 'items' AND deleted_at IS NULL),
    level        = 2,
    order_number = 40,
    updated_at   = now()
WHERE code = 'purchasing' AND deleted_at IS NULL;

-- Pastikan posisi Raw Material & Product di dalam Items sesuai urutan.
UPDATE iam.menus SET order_number = 10, updated_at = now()
WHERE code = 'items.raw-material' AND deleted_at IS NULL;

UPDATE iam.menus SET order_number = 20, updated_at = now()
WHERE code = 'items.product' AND deleted_at IS NULL;

-- Selaraskan kolom level untuk seluruh keturunan Inventory & Purchasing.
-- level = 2 + kedalaman relatif terhadap root yang dipindah (idempoten).
WITH RECURSIVE roots AS (
    SELECT id
    FROM iam.menus
    WHERE code IN ('inventory', 'purchasing') AND deleted_at IS NULL
),
descendants AS (
    SELECT m.id, 1 AS depth
    FROM iam.menus m
    WHERE m.parent_id IN (SELECT id FROM roots) AND m.deleted_at IS NULL
    UNION ALL
    SELECT c.id, d.depth + 1
    FROM iam.menus c
    JOIN descendants d ON c.parent_id = d.id
    WHERE c.deleted_at IS NULL
)
UPDATE iam.menus AS m
SET level = 2 + d.depth,
    updated_at = now()
FROM descendants d
WHERE m.id = d.id;
