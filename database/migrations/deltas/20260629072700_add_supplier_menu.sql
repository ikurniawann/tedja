-- =============================================================================
-- Tambah menu "Supplier" ke dalam grup Purchasing di sidebar.
-- =============================================================================

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, parent_id, level, module, is_active, is_visible)
VALUES (
  'purchasing.suppliers',
  'Supplier',
  '/dashboard/purchasing/suppliers',
  'building',
  'sidebar',
  25,
  (SELECT id FROM iam.menus WHERE code = 'purchasing' AND deleted_at IS NULL),
  2,
  'purchasing',
  true,
  true
)
ON CONFLICT (code) DO UPDATE SET
  menu_name    = EXCLUDED.menu_name,
  route_path   = EXCLUDED.route_path,
  icon         = EXCLUDED.icon,
  menu_type    = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number,
  parent_id    = EXCLUDED.parent_id,
  level        = EXCLUDED.level,
  module       = EXCLUDED.module,
  is_active    = true,
  is_visible   = true,
  deleted_at   = NULL;
