-- Items menu: keluarkan dari Purchasing → level atas (sejajar Purchasing / Inventory)

-- 0) Upsert menu Items (jika belum pernah ada purchasing.items)
INSERT INTO iam.menus (
  code, menu_name, route_path, module, menu_type, icon, order_number, permission_context
) VALUES
  ('items', 'Items', '/dashboard/purchasing/items', 'items', 'group', 'cube', 35, '{"actions": ["read"]}'),
  ('items.raw-material', 'Raw Material', '/dashboard/purchasing/items/raw-material', 'items', 'group', 'cube', 10, '{"actions": ["read"]}'),
  ('items.raw-material.units', 'Unit', '/dashboard/items/units', 'items', 'sidebar', 'database', 10, '{"actions": ["read","create","update","delete"]}'),
  ('items.raw-material.categories', 'Kategori', '/dashboard/items/raw-material/categories', 'items', 'sidebar', 'clipboard', 20, '{"actions": ["read","create","update","delete"]}'),
  ('items.raw-material.storage', 'Storage', '/dashboard/items/raw-material/storage', 'items', 'sidebar', 'database', 30, '{"actions": ["read","create","update","delete"]}'),
  ('items.raw-material.materials', 'Raw Material', '/dashboard/items/raw-materials', 'items', 'sidebar', 'cube', 40, '{"actions": ["read","create","update","delete"]}'),
  ('items.product', 'Product', '/dashboard/purchasing/items/product', 'items', 'group', 'cube', 20, '{"actions": ["read"]}'),
  ('items.product.categories', 'Kategori', '/dashboard/purchasing/items/product/categories', 'items', 'sidebar', 'clipboard', 10, '{"actions": ["read","create","update","delete"]}'),
  ('items.product.products', 'Product', '/dashboard/purchasing/products', 'items', 'sidebar', 'cube', 20, '{"actions": ["read","create","update","delete"]}')
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  route_path = EXCLUDED.route_path,
  module = EXCLUDED.module,
  menu_type = EXCLUDED.menu_type,
  icon = EXCLUDED.icon,
  order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true,
  deleted_at = NULL;

-- 1) Rename codes purchasing.items* → items* (DB yang sudah punya hierarchy lama)
UPDATE iam.menus SET code = 'items.product.products' WHERE code = 'purchasing.items.product.products';
UPDATE iam.menus SET code = 'items.product.categories' WHERE code = 'purchasing.items.product.categories';
UPDATE iam.menus SET code = 'items.product' WHERE code = 'purchasing.items.product';
UPDATE iam.menus SET code = 'items.raw-material.materials' WHERE code = 'purchasing.items.raw-material.materials';
UPDATE iam.menus SET code = 'items.raw-material.storage' WHERE code = 'purchasing.items.raw-material.storage';
UPDATE iam.menus SET code = 'items.raw-material.categories' WHERE code = 'purchasing.items.raw-material.categories';
UPDATE iam.menus SET code = 'items.raw-material.units' WHERE code = 'purchasing.items.raw-material.units';
UPDATE iam.menus SET code = 'items.raw-material' WHERE code = 'purchasing.items.raw-material';
UPDATE iam.menus SET code = 'items' WHERE code = 'purchasing.items';

-- 2) Root Items = top-level module (sibling Purchasing)
UPDATE iam.menus
SET parent_id = NULL,
    module = 'items',
    menu_type = 'group',
    level = 1,
    order_number = 35
WHERE code = 'items';

-- 3) Submodule Items
UPDATE iam.menus SET module = 'items', level = 2
WHERE code IN ('items.raw-material', 'items.product');

UPDATE iam.menus SET module = 'items', level = 3
WHERE code IN (
  'items.raw-material.units',
  'items.raw-material.categories',
  'items.raw-material.storage',
  'items.raw-material.materials',
  'items.product.categories',
  'items.product.products'
);

-- 4) Parent hierarchy di bawah Items (bukan Purchasing)
UPDATE iam.menus child SET parent_id = parent.id FROM iam.menus parent
WHERE child.code IN ('items.raw-material', 'items.product')
  AND parent.code = 'items';

UPDATE iam.menus child SET parent_id = parent.id FROM iam.menus parent
WHERE child.code IN (
  'items.raw-material.units',
  'items.raw-material.categories',
  'items.raw-material.storage',
  'items.raw-material.materials'
) AND parent.code = 'items.raw-material';

UPDATE iam.menus child SET parent_id = parent.id FROM iam.menus parent
WHERE child.code IN (
  'items.product.categories',
  'items.product.products'
) AND parent.code = 'items.product';

-- 5) Pastikan tidak lagi child Purchasing
UPDATE iam.menus SET parent_id = NULL WHERE code = 'items' AND parent_id IS NOT NULL;

-- 6) Role permissions untuk modul Items
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN (
  'super_admin', 'admin',
  'purchasing_manager', 'purchasing_staff', 'purchasing_admin',
  'warehouse_staff', 'warehouse_admin', 'qc_staff'
)
AND m.code LIKE 'items%'
AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true;
