-- =============================================================================
-- Demo Sulu Dago (demo@sulu.id): Items + Inventory + POS only.
-- Hide Laporan (purchasing.reports), Finance, and Accounting.
--
-- Note: configuration.users.role stays purchasing_admin for API access;
-- sidebar menus come from iam.user_roles → sulu_dago_demo.
-- =============================================================================

-- 1) Dedicated demo role (menu permissions only)
INSERT INTO iam.roles (code, name, description, is_system, is_active)
VALUES (
  'sulu_dago_demo',
  'Sulu Dago Demo',
  'Demo cabang Sulu Dago: Items, Inventory, Point of Sales (tanpa Finance/Accounting/Laporan)',
  false,
  true
)
ON CONFLICT (code) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active   = true,
  updated_at  = now();

-- 2) Display label for POS top-level menu
UPDATE iam.menus
SET menu_name = 'Point of Sales', updated_at = now()
WHERE code = 'pos' AND deleted_at IS NULL;

-- 3) Items + Inventory (exclude Laporan subtree)
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code = 'sulu_dago_demo'
  AND m.deleted_at IS NULL
  AND (
    m.code = 'dashboard'
    OR (
      m.module IN ('items', 'inventory')
      AND m.code NOT LIKE 'purchasing.reports%'
    )
  )
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();

-- 4) Point of Sales module
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code = 'sulu_dago_demo'
  AND m.deleted_at IS NULL
  AND m.module = 'pos'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();

-- 5) Demo user: IAM menu role only (keep purchasing_admin on configuration.users)
DELETE FROM iam.user_roles ur
USING iam.roles r, configuration.users cu
WHERE ur.user_id = cu.id
  AND ur.role_id = r.id
  AND lower(cu.email) = 'demo@sulu.id'
  AND r.code = 'purchasing_admin';

INSERT INTO iam.user_roles (user_id, role_id, is_primary)
SELECT cu.id, r.id, true
FROM configuration.users cu
JOIN iam.roles r ON r.code = 'sulu_dago_demo'
WHERE lower(cu.email) = 'demo@sulu.id'
ON CONFLICT (user_id, role_id) DO UPDATE SET
  is_primary = true;
