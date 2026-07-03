-- POS Stock Alerts display page (KDS-style monitor for low stock)
INSERT INTO iam.menus (
  code, menu_name, route_path, module, menu_type, icon, order_number, permission_context
) VALUES (
  'pos.stock-alerts',
  'Stok Alert',
  '/dashboard/pos/stock-alerts',
  'pos',
  'sidebar',
  'alert-triangle',
  95,
  '{"actions": ["read"]}'::jsonb
)
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
SET parent_id = parent.id, module = 'pos', level = 2, updated_at = now()
FROM iam.menus parent
WHERE child.code = 'pos.stock-alerts'
  AND parent.code = 'pos'
  AND child.deleted_at IS NULL;

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('pos', 'pos_supervisor', 'sulu_dago_demo')
  AND m.code = 'pos.stock-alerts'
  AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();
