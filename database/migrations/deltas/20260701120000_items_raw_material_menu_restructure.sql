-- =============================================================================
-- Restructure Items → Raw Material menu tree (IAM).
--
-- Target hierarchy:
--   items
--   └── items.raw-material
--       ├── items.raw-material.master      (Unit, Category, Condition Storage, Raw Material)
--       ├── items.raw-material.inventory   (Stock, Opname, Adjustment, Transfer)
--       ├── items.raw-material.purchasing  (Supplier, Price List, PR, PO, …)
--       ├── items.raw-material.approval    (Approval PR, Approval PO)
--       └── items.raw-material.production  (BOM, Production In-House)
--
-- Soft-deletes legacy duplicate groups: purchasing.procurement, top-level inventory/purchasing
-- under items when emptied. Keeps items.product for phase 2.
-- =============================================================================

-- 0) Items root → canonical landing
UPDATE iam.menus
SET route_path   = '/dashboard/items',
    menu_name    = 'Items',
    module       = 'items',
    menu_type    = 'group',
    order_number = 35,
    parent_id    = NULL,
    level        = 1,
    is_active    = true,
    is_visible   = true,
    deleted_at   = NULL,
    updated_at   = now()
WHERE code = 'items';

-- 1) Upsert subgroup folders under items.raw-material
INSERT INTO iam.menus (
  code, menu_name, route_path, module, menu_type, icon, order_number, permission_context
) VALUES
  ('items.raw-material', 'Raw Material', NULL, 'items', 'group', 'cube', 10, '{"actions": ["read"]}'),
  ('items.raw-material.master', 'Master Data', NULL, 'items', 'group', 'database', 10, '{"actions": ["read"]}'),
  ('items.raw-material.inventory', 'Inventory', NULL, 'items', 'group', 'circle-stack', 20, '{"actions": ["read"]}'),
  ('items.raw-material.purchasing', 'Purchasing', NULL, 'items', 'group', 'shopping', 30, '{"actions": ["read"]}'),
  ('items.raw-material.approval', 'Approval', NULL, 'items', 'group', 'check-circle', 40, '{"actions": ["read"]}'),
  ('items.raw-material.production', 'Production', NULL, 'items', 'group', 'cube', 50, '{"actions": ["read"]}')
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

-- 2) Re-parent items.raw-material under items
UPDATE iam.menus child
SET parent_id = parent.id,
    module    = 'items',
    level     = 2,
    updated_at = now()
FROM iam.menus parent
WHERE child.code = 'items.raw-material'
  AND parent.code = 'items'
  AND child.deleted_at IS NULL;

-- 3) Re-parent subgroup folders under items.raw-material
UPDATE iam.menus child
SET parent_id = parent.id,
    module    = 'items',
    level     = 3,
    updated_at = now()
FROM iam.menus parent
WHERE child.code IN (
  'items.raw-material.master',
  'items.raw-material.inventory',
  'items.raw-material.purchasing',
  'items.raw-material.approval',
  'items.raw-material.production'
)
AND parent.code = 'items.raw-material'
AND child.deleted_at IS NULL;

-- 4) Rename + relocate Master Data leaves (preserve menu_id / permissions)
UPDATE iam.menus SET
  code         = 'items.raw-material.master.units',
  menu_name    = 'Unit',
  route_path   = '/dashboard/items/units',
  menu_type    = 'sidebar',
  icon         = 'database',
  order_number = 10,
  permission_context = '{"actions": ["read","create","update","delete"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('items.raw-material.units', 'items.raw-material.master.units');

UPDATE iam.menus SET
  code         = 'items.raw-material.master.categories',
  menu_name    = 'Category',
  route_path   = '/dashboard/items/raw-material/categories',
  menu_type    = 'sidebar',
  icon         = 'clipboard',
  order_number = 20,
  permission_context = '{"actions": ["read","create","update","delete"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('items.raw-material.categories', 'items.raw-material.master.categories');

UPDATE iam.menus SET
  code         = 'items.raw-material.master.storage',
  menu_name    = 'Condition Storage',
  route_path   = '/dashboard/items/raw-material/storage',
  menu_type    = 'sidebar',
  icon         = 'database',
  order_number = 30,
  permission_context = '{"actions": ["read","create","update","delete"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('items.raw-material.storage', 'items.raw-material.master.storage');

UPDATE iam.menus SET
  code         = 'items.raw-material.master.materials',
  menu_name    = 'Raw Material',
  route_path   = '/dashboard/items/raw-materials',
  menu_type    = 'sidebar',
  icon         = 'cube',
  order_number = 40,
  permission_context = '{"actions": ["read","create","update","delete"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('items.raw-material.materials', 'items.raw-material.master.materials');

-- 5) Inventory leaves — rename from inventory.* or insert new
UPDATE iam.menus SET
  code         = 'items.raw-material.inventory.stock',
  menu_name    = 'Stock',
  route_path   = '/dashboard/inventory/stock',
  menu_type    = 'sidebar',
  icon         = 'circle-stack',
  order_number = 10,
  permission_context = '{"actions": ["read"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('inventory.stock', 'items.raw-material.inventory.stock');

UPDATE iam.menus SET
  code         = 'items.raw-material.inventory.adjustment',
  menu_name    = 'Stock Adjustment',
  route_path   = '/dashboard/inventory/adjustment',
  menu_type    = 'sidebar',
  icon         = 'clipboard-document-check',
  order_number = 30,
  permission_context = '{"actions": ["read","create","update"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('inventory.adjustment', 'items.raw-material.inventory.adjustment');

UPDATE iam.menus SET
  code         = 'items.raw-material.inventory.transfer',
  menu_name    = 'Stock Transfer',
  route_path   = '/dashboard/inventory/transfers',
  menu_type    = 'sidebar',
  icon         = 'paper-airplane',
  order_number = 40,
  permission_context = '{"actions": ["read","create","update"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('inventory.transfers', 'items.raw-material.inventory.transfer');

INSERT INTO iam.menus (
  code, menu_name, route_path, module, menu_type, icon, order_number, permission_context
) VALUES (
  'items.raw-material.inventory.opname',
  'Stock Opname',
  '/dashboard/inventory/opname',
  'items',
  'sidebar',
  'clipboard',
  20,
  '{"actions": ["read","create","update"]}'::jsonb
)
ON CONFLICT (code) DO UPDATE SET
  menu_name    = EXCLUDED.menu_name,
  route_path   = EXCLUDED.route_path,
  menu_type    = EXCLUDED.menu_type,
  icon         = EXCLUDED.icon,
  order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active    = true,
  is_visible   = true,
  deleted_at   = NULL,
  updated_at   = now();

-- 6) Purchasing leaves
UPDATE iam.menus SET
  code         = 'items.raw-material.purchasing.suppliers',
  menu_name    = 'Supplier',
  route_path   = '/dashboard/purchasing/suppliers',
  menu_type    = 'sidebar',
  icon         = 'building',
  order_number = 10,
  module       = 'items',
  permission_context = '{"actions": ["read","create","update","delete"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('purchasing.suppliers', 'items.raw-material.purchasing.suppliers');

UPDATE iam.menus SET
  code         = 'items.raw-material.purchasing.pr',
  menu_name    = 'Purchase Request',
  route_path   = '/dashboard/purchasing/pr',
  menu_type    = 'sidebar',
  icon         = 'file-text',
  order_number = 30,
  module       = 'items',
  permission_context = '{"actions": ["read","create","update","delete"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('purchasing.procurement.pr', 'items.raw-material.purchasing.pr');

UPDATE iam.menus SET
  code         = 'items.raw-material.purchasing.po',
  menu_name    = 'Purchase Order',
  route_path   = '/dashboard/purchasing/po',
  menu_type    = 'sidebar',
  icon         = 'clipboard-document-check',
  order_number = 40,
  module       = 'items',
  permission_context = '{"actions": ["read","create","update","delete"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('purchasing.procurement.po', 'items.raw-material.purchasing.po');

UPDATE iam.menus SET
  code         = 'items.raw-material.purchasing.delivery',
  menu_name    = 'Track Shipment',
  route_path   = '/dashboard/purchasing/delivery',
  menu_type    = 'sidebar',
  icon         = 'truck',
  order_number = 50,
  module       = 'items',
  permission_context = '{"actions": ["read","create","update"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('purchasing.procurement.delivery', 'items.raw-material.purchasing.delivery');

UPDATE iam.menus SET
  code         = 'items.raw-material.purchasing.grn',
  menu_name    = 'Receive',
  route_path   = '/dashboard/purchasing/grn',
  menu_type    = 'sidebar',
  icon         = 'arrow-down-on-square',
  order_number = 60,
  module       = 'items',
  permission_context = '{"actions": ["read","create","update"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('purchasing.procurement.grn', 'items.raw-material.purchasing.grn');

UPDATE iam.menus SET
  code         = 'items.raw-material.purchasing.returns',
  menu_name    = 'Return',
  route_path   = '/dashboard/purchasing/returns',
  menu_type    = 'sidebar',
  icon         = 'truck',
  order_number = 70,
  module       = 'items',
  permission_context = '{"actions": ["read","create","update"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('purchasing.procurement.returns', 'items.raw-material.purchasing.returns');

UPDATE iam.menus SET
  code         = 'items.raw-material.purchasing.invoice',
  menu_name    = 'Invoice',
  route_path   = '/dashboard/purchasing/vendor-payments',
  menu_type    = 'sidebar',
  icon         = 'money',
  order_number = 80,
  module       = 'items',
  permission_context = '{"actions": ["read","create","update"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('purchasing.procurement.vendor-payments', 'items.raw-material.purchasing.invoice');

INSERT INTO iam.menus (
  code, menu_name, route_path, module, menu_type, icon, order_number, permission_context
) VALUES (
  'items.raw-material.purchasing.price-list',
  'Price List',
  '/dashboard/purchasing/price-list',
  'items',
  'sidebar',
  'clipboard',
  20,
  '{"actions": ["read","create","update","delete"]}'::jsonb
)
ON CONFLICT (code) DO UPDATE SET
  menu_name    = EXCLUDED.menu_name,
  route_path   = EXCLUDED.route_path,
  menu_type    = EXCLUDED.menu_type,
  icon         = EXCLUDED.icon,
  order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active    = true,
  is_visible   = true,
  deleted_at   = NULL,
  updated_at   = now();

-- 7) Approval leaves (merge legacy purchasing.approval group into items.raw-material.approval)
UPDATE iam.menus SET
  code         = 'items.raw-material.approval.pr',
  menu_name    = 'Approval PR',
  route_path   = '/dashboard/purchasing/approval/pr',
  menu_type    = 'sidebar',
  icon         = 'file-text',
  order_number = 10,
  module       = 'items',
  permission_context = '{"actions": ["read","update"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('purchasing.approval.pr', 'items.raw-material.approval.pr');

UPDATE iam.menus SET
  code         = 'items.raw-material.approval.po',
  menu_name    = 'Approval PO',
  route_path   = '/dashboard/purchasing/approval/po',
  menu_type    = 'sidebar',
  icon         = 'clipboard-document-check',
  order_number = 20,
  module       = 'items',
  permission_context = '{"actions": ["read","update"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('purchasing.approval.po', 'items.raw-material.approval.po');

-- 8) Production leaves
UPDATE iam.menus SET
  code         = 'items.raw-material.production.bom',
  menu_name    = 'Bill of Materials',
  route_path   = '/dashboard/purchasing/production/recipes',
  menu_type    = 'sidebar',
  icon         = 'cube',
  order_number = 10,
  module       = 'items',
  permission_context = '{"actions": ["read","create","update","delete"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('purchasing.procurement.recipes', 'items.raw-material.production.bom');

UPDATE iam.menus SET
  code         = 'items.raw-material.production.hub',
  menu_name    = 'Production In-House',
  route_path   = '/dashboard/purchasing/production',
  menu_type    = 'sidebar',
  icon         = 'cube',
  order_number = 20,
  module       = 'items',
  permission_context = '{"actions": ["read","create","update"]}'::jsonb,
  deleted_at   = NULL,
  is_active    = true,
  updated_at   = now()
WHERE code IN ('purchasing.procurement.production', 'items.raw-material.production.hub');

-- 9) Wire parent_id for all leaves under their subgroup
UPDATE iam.menus child SET parent_id = parent.id, level = 4, module = 'items', updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'items.raw-material.master'
  AND child.code IN (
    'items.raw-material.master.units',
    'items.raw-material.master.categories',
    'items.raw-material.master.storage',
    'items.raw-material.master.materials'
  )
  AND child.deleted_at IS NULL;

UPDATE iam.menus child SET parent_id = parent.id, level = 4, module = 'items', updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'items.raw-material.inventory'
  AND child.code IN (
    'items.raw-material.inventory.stock',
    'items.raw-material.inventory.opname',
    'items.raw-material.inventory.adjustment',
    'items.raw-material.inventory.transfer'
  )
  AND child.deleted_at IS NULL;

UPDATE iam.menus child SET parent_id = parent.id, level = 4, module = 'items', updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'items.raw-material.purchasing'
  AND child.code IN (
    'items.raw-material.purchasing.suppliers',
    'items.raw-material.purchasing.price-list',
    'items.raw-material.purchasing.pr',
    'items.raw-material.purchasing.po',
    'items.raw-material.purchasing.delivery',
    'items.raw-material.purchasing.grn',
    'items.raw-material.purchasing.returns',
    'items.raw-material.purchasing.invoice'
  )
  AND child.deleted_at IS NULL;

UPDATE iam.menus child SET parent_id = parent.id, level = 4, module = 'items', updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'items.raw-material.approval'
  AND child.code IN (
    'items.raw-material.approval.pr',
    'items.raw-material.approval.po'
  )
  AND child.deleted_at IS NULL;

UPDATE iam.menus child SET parent_id = parent.id, level = 4, module = 'items', updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'items.raw-material.production'
  AND child.code IN (
    'items.raw-material.production.bom',
    'items.raw-material.production.hub'
  )
  AND child.deleted_at IS NULL;

-- 10) Keep items.product under items (phase 2) — re-parent if needed
UPDATE iam.menus child SET parent_id = parent.id, module = 'items', level = 2, order_number = 20, updated_at = now()
FROM iam.menus parent
WHERE child.code = 'items.product'
  AND parent.code = 'items'
  AND child.deleted_at IS NULL;

UPDATE iam.menus child SET parent_id = parent.id, module = 'items', level = 3, updated_at = now()
FROM iam.menus parent
WHERE child.code IN ('items.product.categories', 'items.product.products')
  AND parent.code = 'items.product'
  AND child.deleted_at IS NULL;

-- 11) Move purchasing.reports under items root (avoid orphan when purchasing group removed)
UPDATE iam.menus child SET parent_id = parent.id, module = 'items', level = 2, order_number = 60, updated_at = now()
FROM iam.menus parent
WHERE child.code = 'purchasing.reports'
  AND parent.code = 'items'
  AND child.deleted_at IS NULL;

UPDATE iam.menus child SET parent_id = parent.id, module = 'items', level = 3, updated_at = now()
FROM iam.menus parent
WHERE child.code LIKE 'purchasing.reports.%'
  AND parent.code = 'purchasing.reports'
  AND child.deleted_at IS NULL;

-- 12) Soft-delete legacy duplicate / hub menus
UPDATE iam.menus
SET is_active  = false,
    is_visible = false,
    deleted_at = now(),
    updated_at = now()
WHERE code IN (
  'purchasing.procurement',
  'purchasing.procurement.qc',
  'purchasing.approval',
  'purchasing',
  'inventory',
  'inventory.dashboard',
  'inventory.scrap',
  'inventory.production'
)
AND deleted_at IS NULL;

-- 13) Grant permissions for new menu codes to operational roles
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN (
  'super_admin', 'admin',
  'purchasing_admin', 'purchasing_manager', 'purchasing_staff',
  'warehouse_staff', 'warehouse_admin', 'qc_staff'
)
AND m.code LIKE 'items.raw-material%'
AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions;

-- Deactivate permissions on soft-deleted menus
UPDATE iam.role_menu_permissions rmp
SET is_active = false
FROM iam.menus m
WHERE rmp.menu_id = m.id
  AND m.deleted_at IS NOT NULL;
