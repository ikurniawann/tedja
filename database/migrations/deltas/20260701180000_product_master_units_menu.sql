-- =============================================================================
-- Product Master Data — menu Satuan (Unit) under items.product.master
-- =============================================================================

INSERT INTO iam.menus (code, menu_name, route_path, module, menu_type, icon, order_number, permission_context)
VALUES (
  'items.product.master.units',
  'Unit',
  '/dashboard/product/units',
  'items',
  'sidebar',
  'database',
  10,
  '{"actions": ["read","create","update","delete"]}'::jsonb
)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  route_path = EXCLUDED.route_path,
  menu_type = EXCLUDED.menu_type,
  icon = EXCLUDED.icon,
  order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true,
  is_visible = true,
  deleted_at = NULL,
  updated_at = now();

-- Re-order master data leaves: Unit → Category → Product
UPDATE iam.menus SET order_number = 20, updated_at = now()
WHERE code = 'items.product.master.categories' AND deleted_at IS NULL;

UPDATE iam.menus SET order_number = 30, updated_at = now()
WHERE code = 'items.product.master.products' AND deleted_at IS NULL;

UPDATE iam.menus child
SET parent_id = parent.id, level = 4, module = 'items', updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'items.product.master'
  AND child.code IN (
    'items.product.master.units',
    'items.product.master.categories',
    'items.product.master.products'
  )
  AND child.deleted_at IS NULL;

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
AND m.code = 'items.product.master.units'
AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions;
