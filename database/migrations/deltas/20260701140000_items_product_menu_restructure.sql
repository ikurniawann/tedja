-- =============================================================================
-- Restructure Items → Product menu tree (IAM).
--
--   items.product
--   ├── items.product.master       (Category, Product)
--   ├── items.product.inventory    (Stock, Opname, Adjustment, Transfer)
--   ├── items.product.purchasing   (Vendor, Price List, PR, PO, …)
--   ├── items.product.approval     (Approval PR, Approval PO)
--   └── items.product.production   (BOM, Production In-House)
-- =============================================================================

-- 1) Subgroup folders under items.product
INSERT INTO iam.menus (
  code, menu_name, route_path, module, menu_type, icon, order_number, permission_context
) VALUES
  ('items.product', 'Product', NULL, 'items', 'group', 'cube', 20, '{"actions": ["read"]}'),
  ('items.product.master', 'Master Data', NULL, 'items', 'group', 'database', 10, '{"actions": ["read"]}'),
  ('items.product.inventory', 'Inventory', NULL, 'items', 'group', 'circle-stack', 20, '{"actions": ["read"]}'),
  ('items.product.purchasing', 'Purchasing', NULL, 'items', 'group', 'shopping', 30, '{"actions": ["read"]}'),
  ('items.product.approval', 'Approval', NULL, 'items', 'group', 'check-circle', 40, '{"actions": ["read"]}'),
  ('items.product.production', 'Production', NULL, 'items', 'group', 'cube', 50, '{"actions": ["read"]}')
ON CONFLICT (code) DO UPDATE SET
  menu_name    = EXCLUDED.menu_name,
  route_path   = EXCLUDED.route_path,
  module       = EXCLUDED.module,
  menu_type    = EXCLUDED.menu_type,
  icon         = EXCLUDED.icon,
  order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active    = true,
  is_visible   = true,
  deleted_at   = NULL,
  updated_at   = now();

UPDATE iam.menus child
SET parent_id = parent.id, module = 'items', level = 2, updated_at = now()
FROM iam.menus parent
WHERE child.code = 'items.product' AND parent.code = 'items' AND child.deleted_at IS NULL;

UPDATE iam.menus child
SET parent_id = parent.id, module = 'items', level = 3, updated_at = now()
FROM iam.menus parent
WHERE child.code IN (
  'items.product.master',
  'items.product.inventory',
  'items.product.purchasing',
  'items.product.approval',
  'items.product.production'
)
AND parent.code = 'items.product'
AND child.deleted_at IS NULL;

-- 2) Master Data leaves
UPDATE iam.menus SET
  code = 'items.product.master.categories',
  menu_name = 'Category',
  route_path = '/dashboard/items/product/categories',
  menu_type = 'sidebar',
  icon = 'clipboard',
  order_number = 10,
  module = 'items',
  permission_context = '{"actions": ["read","create","update","delete"]}'::jsonb,
  deleted_at = NULL, is_active = true, updated_at = now()
WHERE code IN ('items.product.categories', 'items.product.master.categories');

UPDATE iam.menus SET
  code = 'items.product.master.products',
  menu_name = 'Product',
  route_path = '/dashboard/items/products',
  menu_type = 'sidebar',
  icon = 'cube',
  order_number = 20,
  module = 'items',
  permission_context = '{"actions": ["read","create","update","delete"]}'::jsonb,
  deleted_at = NULL, is_active = true, updated_at = now()
WHERE code IN ('items.product.products', 'items.product.master.products');

-- 3) Inventory leaves (placeholder routes)
INSERT INTO iam.menus (code, menu_name, route_path, module, menu_type, icon, order_number, permission_context) VALUES
  ('items.product.inventory.stock', 'Stock', '/dashboard/items/product/inventory/stock', 'items', 'sidebar', 'circle-stack', 10, '{"actions": ["read"]}'),
  ('items.product.inventory.opname', 'Stock Opname', '/dashboard/items/product/inventory/opname', 'items', 'sidebar', 'clipboard', 20, '{"actions": ["read","create","update"]}'),
  ('items.product.inventory.adjustment', 'Stock Adjustment', '/dashboard/items/product/inventory/adjustment', 'items', 'sidebar', 'clipboard-document-check', 30, '{"actions": ["read","create","update"]}'),
  ('items.product.inventory.transfer', 'Stock Transfer', '/dashboard/items/product/inventory/transfer', 'items', 'sidebar', 'paper-airplane', 40, '{"actions": ["read","create","update"]}')
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  route_path = EXCLUDED.route_path,
  menu_type = EXCLUDED.menu_type,
  icon = EXCLUDED.icon,
  order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

-- 4) Purchasing leaves (placeholder routes)
INSERT INTO iam.menus (code, menu_name, route_path, module, menu_type, icon, order_number, permission_context) VALUES
  ('items.product.purchasing.vendor', 'Vendor', '/dashboard/items/product/purchasing/vendor', 'items', 'sidebar', 'building', 10, '{"actions": ["read","create","update","delete"]}'),
  ('items.product.purchasing.price-list', 'Price List', '/dashboard/items/product/purchasing/price-list', 'items', 'sidebar', 'clipboard', 20, '{"actions": ["read","create","update","delete"]}'),
  ('items.product.purchasing.pr', 'Purchase Request', '/dashboard/items/product/purchasing/pr', 'items', 'sidebar', 'file-text', 30, '{"actions": ["read","create","update","delete"]}'),
  ('items.product.purchasing.po', 'Purchase Order', '/dashboard/items/product/purchasing/po', 'items', 'sidebar', 'clipboard-document-check', 40, '{"actions": ["read","create","update","delete"]}'),
  ('items.product.purchasing.delivery', 'Track Shipment', '/dashboard/items/product/purchasing/delivery', 'items', 'sidebar', 'truck', 50, '{"actions": ["read","create","update"]}'),
  ('items.product.purchasing.grn', 'Receive', '/dashboard/items/product/purchasing/receive', 'items', 'sidebar', 'arrow-down-on-square', 60, '{"actions": ["read","create","update"]}'),
  ('items.product.purchasing.returns', 'Return', '/dashboard/items/product/purchasing/returns', 'items', 'sidebar', 'truck', 70, '{"actions": ["read","create","update"]}'),
  ('items.product.purchasing.invoice', 'Invoice', '/dashboard/items/product/purchasing/invoice', 'items', 'sidebar', 'money', 80, '{"actions": ["read","create","update"]}')
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  route_path = EXCLUDED.route_path,
  menu_type = EXCLUDED.menu_type,
  icon = EXCLUDED.icon,
  order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

-- 5) Approval leaves (placeholder routes)
INSERT INTO iam.menus (code, menu_name, route_path, module, menu_type, icon, order_number, permission_context) VALUES
  ('items.product.approval.pr', 'Approval PR', '/dashboard/items/product/approval/pr', 'items', 'sidebar', 'file-text', 10, '{"actions": ["read","update"]}'),
  ('items.product.approval.po', 'Approval PO', '/dashboard/items/product/approval/po', 'items', 'sidebar', 'clipboard-document-check', 20, '{"actions": ["read","update"]}')
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  route_path = EXCLUDED.route_path,
  menu_type = EXCLUDED.menu_type,
  icon = EXCLUDED.icon,
  order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

-- 6) Production leaves (existing shared routes)
INSERT INTO iam.menus (code, menu_name, route_path, module, menu_type, icon, order_number, permission_context) VALUES
  ('items.product.production.bom', 'Bill of Materials', '/dashboard/purchasing/production/recipes', 'items', 'sidebar', 'cube', 10, '{"actions": ["read","create","update","delete"]}'),
  ('items.product.production.hub', 'Production In-House', '/dashboard/purchasing/production', 'items', 'sidebar', 'cube', 20, '{"actions": ["read","create","update"]}')
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  route_path = EXCLUDED.route_path,
  menu_type = EXCLUDED.menu_type,
  icon = EXCLUDED.icon,
  order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

-- 7) Wire parent_id for all leaves
UPDATE iam.menus child SET parent_id = parent.id, level = 4, module = 'items', updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'items.product.master'
  AND child.code IN ('items.product.master.categories', 'items.product.master.products')
  AND child.deleted_at IS NULL;

UPDATE iam.menus child SET parent_id = parent.id, level = 4, module = 'items', updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'items.product.inventory'
  AND child.code LIKE 'items.product.inventory.%'
  AND child.deleted_at IS NULL;

UPDATE iam.menus child SET parent_id = parent.id, level = 4, module = 'items', updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'items.product.purchasing'
  AND child.code LIKE 'items.product.purchasing.%'
  AND child.deleted_at IS NULL;

UPDATE iam.menus child SET parent_id = parent.id, level = 4, module = 'items', updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'items.product.approval'
  AND child.code IN ('items.product.approval.pr', 'items.product.approval.po')
  AND child.deleted_at IS NULL;

UPDATE iam.menus child SET parent_id = parent.id, level = 4, module = 'items', updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'items.product.production'
  AND child.code IN ('items.product.production.bom', 'items.product.production.hub')
  AND child.deleted_at IS NULL;

-- 8) Role permissions for product menu tree
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN (
  'super_admin', 'admin',
  'purchasing_admin', 'purchasing_manager', 'purchasing_staff',
  'warehouse_staff', 'warehouse_admin', 'qc_staff',
  'pos', 'pos_supervisor'
)
AND m.code LIKE 'items.product%'
AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions;
