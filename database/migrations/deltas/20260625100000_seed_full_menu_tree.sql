-- =============================================================================
-- Seed FULL menu tree ke iam.menus + iam.roles + iam.role_menu_permissions.
-- Menggantikan navigasi hardcode (src/lib/iam/hardcoded-nav.ts) menjadi DB-driven.
-- Idempoten: UPSERT by code, parent/level diturunkan dari konvensi kode (titik).
-- =============================================================================

-- 0) Upsert seluruh node menu (parent_id & level di-wire belakangan via kode).
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number) VALUES
  -- Top-level modules ---------------------------------------------------------
  ('dashboard',   'Beranda',      '/dashboard',              'home',     'sidebar', 0),
  ('hris',        'HRIS Modules', '/dashboard/hris',         'users',    'group',   10),
  ('purchasing',  'Purchasing',   '/dashboard/purchasing',   'shopping', 'group',   30),
  ('items',       'Items',        '/dashboard/purchasing/items', 'cube', 'group',   35),
  ('inventory',   'Inventory',    '/dashboard/inventory',    'database', 'group',   40),
  ('finance',     'Finance',      '/dashboard/finance',      'money',    'group',   50),
  ('accounting',  'Accounting',   '/dashboard/accounting',   'reports',  'group',   60),
  ('pos',         'POS',          '/dashboard/pos',          'shopping', 'group',   70),
  ('crm',         'CRM',          '/dashboard/crm',          'star',     'group',   80),
  ('master',      'Master Data',  '/dashboard/master',       'database', 'group',   90),
  ('settings',    'Pengaturan',   NULL,                      'settings', 'group',   100),

  -- HRIS ----------------------------------------------------------------------
  ('hris.candidates',   'Kandidat',           '/dashboard/hris/candidates',  'user-plus', 'sidebar', 10),
  ('hris.pipeline',     'Pipeline',           '/dashboard/hris/pipeline',    'clipboard', 'sidebar', 20),
  ('hris.talent-pool',  'Talent Pool',        '/dashboard/hris/talent-pool', 'star',      'sidebar', 30),
  ('hris.job-portal',   'Job Portal',         '/dashboard/hris/job-portal',  'briefcase', 'sidebar', 40),
  ('hris.analytics',    'Analytics',          '/dashboard/hris/analytics',   'chart',     'sidebar', 50),
  ('hris.attendance',   'Absensi',            '/dashboard/hris/attendance',  'calendar',  'sidebar', 60),
  ('hris.leaves',       'Cuti & Izin',        '/dashboard/hris/leaves',      'file-text', 'sidebar', 70),
  ('hris.schedules',    'Schedules',          '/dashboard/hris/schedules',   'calendar',  'sidebar', 80),
  ('hris.sections',     'Sections',           '/dashboard/hris/sections',    'building',  'sidebar', 90),
  ('hris.org-chart',    'Struktur Org',       '/dashboard/hris/org-chart',   'sitemap',   'sidebar', 100),
  ('hris.reports',      'Laporan HRIS',       '/dashboard/hris/reports',     'reports',   'sidebar', 110),
  ('hris.payroll',      'Penggajian',         '/dashboard/hris/payroll',     'dollar-sign','sidebar',120),
  ('hris.salary',       'Salary',             '/dashboard/hris/salary',      'money',     'sidebar', 130),
  ('hris.kpi-templates','KPI Templates',      '/dashboard/hris/kpi-templates','clipboard','sidebar', 140),
  ('hris.logbook',      'Logbook',            '/dashboard/hris/logbook',     'clipboard', 'sidebar', 150),
  ('hris.logbook-list', 'Logbook List',       '/dashboard/hris/logbook-list','clipboard', 'sidebar', 160),
  ('hris.performance',  'Performance Review', '/dashboard/hris/performance', 'chart',     'sidebar', 170),

  -- Purchasing ----------------------------------------------------------------
  ('purchasing.procurement',                'Procurement',         '/dashboard/purchasing/procurement',            'shopping',               'group',   10),
  ('purchasing.procurement.pr',             'Purchase Request',    '/dashboard/purchasing/pr',                     'file-text',              'sidebar', 10),
  ('purchasing.procurement.po',             'Purchase Order',      '/dashboard/purchasing/po',                     'clipboard-document-check','sidebar', 20),
  ('purchasing.procurement.delivery',       'Pengiriman',          '/dashboard/purchasing/delivery',               'truck',                  'sidebar', 30),
  ('purchasing.procurement.grn',            'Barang Masuk',        '/dashboard/purchasing/grn',                    'arrow-down-on-square',   'sidebar', 40),
  ('purchasing.procurement.vendor-payments','Pembayaran Vendor',   '/dashboard/purchasing/vendor-payments',        'money',                  'sidebar', 50),
  ('purchasing.procurement.production',     'Produksi',            '/dashboard/purchasing/production',             'cube',                   'sidebar', 60),
  ('purchasing.procurement.recipes',        'Recipe/BOM',          '/dashboard/purchasing/production/recipes',     'cube',                   'sidebar', 70),
  ('purchasing.procurement.qc',             'QC',                  '/dashboard/purchasing/qc',                     'check-circle',           'sidebar', 80),
  ('purchasing.procurement.returns',        'Retur',               '/dashboard/purchasing/returns',                'truck',                  'sidebar', 90),
  ('purchasing.approval',                   'Approval',            '/dashboard/purchasing/approval',               'check-circle',           'group',   20),
  ('purchasing.approval.pr',                'Approval PR',         '/dashboard/purchasing/approval/pr',            'file-text',              'sidebar', 10),
  ('purchasing.approval.po',                'Approval PO',         '/dashboard/purchasing/approval/po',            'clipboard-document-check','sidebar', 20),
  ('purchasing.reports',                    'Laporan',             '/dashboard/purchasing/reports',                'reports',                'group',   30),
  ('purchasing.reports.stock-card',         'Stock Card',          '/dashboard/purchasing/reports/stock-card',     'clipboard',              'sidebar', 10),
  ('purchasing.reports.inventory-valuation','Valuasi Inventori',   '/dashboard/purchasing/reports/inventory-valuation','database',           'sidebar', 20),
  ('purchasing.reports.po-summary',         'Ringkasan PO',        '/dashboard/purchasing/reports/po-summary',     'shopping',               'sidebar', 30),
  ('purchasing.reports.po-detail',          'Detail PO',           '/dashboard/purchasing/reports/po-detail',      'document-text',          'sidebar', 40),
  ('purchasing.reports.supplier-performance','Performa Supplier',  '/dashboard/purchasing/reports/supplier-performance','building',          'sidebar', 50),

  -- Inventory -----------------------------------------------------------------
  ('inventory.dashboard',  'Dashboard Inventory',  '/dashboard/inventory',            'home',                    'sidebar', 10),
  ('inventory.stock',      'Inventory Stock',      '/dashboard/inventory/stock',      'circle-stack',            'sidebar', 20),
  ('inventory.transfers',  'Transfer Out / In',    '/dashboard/inventory/transfers',  'paper-airplane',          'sidebar', 30),
  ('inventory.production', 'Production / WIP',      '/dashboard/purchasing/production','cube',                    'sidebar', 40),
  ('inventory.scrap',      'Scrap Item',           '/dashboard/inventory/scrap',      'truck',                   'sidebar', 50),
  ('inventory.adjustment', 'Inventory Adjustment', '/dashboard/inventory/adjustment', 'clipboard-document-check','sidebar', 60),

  -- Finance -------------------------------------------------------------------
  ('finance.cash-received',           'Cash Received',           '/dashboard/finance/cash-received',           'money',                    'sidebar', 10),
  ('finance.receipt',                 'Receipt',                 '/dashboard/finance/receipt',                 'document-text',            'sidebar', 20),
  ('finance.cash-payment',            'Cash Payment',            '/dashboard/finance/cash-payment',            'money',                    'sidebar', 30),
  ('finance.intercash',               'Intercash',               '/dashboard/finance/intercash',               'paper-airplane',           'sidebar', 40),
  ('finance.petty-cash-request',      'Petty Cash Request',      '/dashboard/finance/petty-cash-request',      'clipboard',                'sidebar', 50),
  ('finance.petty-cash-fulfillment',  'Petty Cash Fulfillment',  '/dashboard/finance/petty-cash-fulfillment',  'check-circle',             'sidebar', 60),
  ('finance.member-balance',          'Member Balance',          '/dashboard/finance/member-balance',          'users',                    'sidebar', 70),
  ('finance.member-deposit',          'Member Deposit',          '/dashboard/finance/member-deposit',          'money',                    'sidebar', 80),
  ('finance.member-withdrawal',       'Member Withdrawal',       '/dashboard/finance/member-withdrawal',       'money',                    'sidebar', 90),
  ('finance.supplier-payable',        'Supplier Payable',        '/dashboard/finance/supplier-payable',        'clipboard-document-check', 'sidebar', 100),
  ('finance.supplier-settlement',     'Supplier Settlement',     '/dashboard/finance/supplier-settlement',     'check-circle',             'sidebar', 110),
  ('finance.supplier-advance',        'Supplier Advance',        '/dashboard/finance/supplier-advance',        'paper-airplane',           'sidebar', 120),
  ('finance.customer-settlement',     'Customer Settlement',     '/dashboard/finance/customer-settlement',     'check-circle',             'sidebar', 130),
  ('finance.account-mapping',         'Account Mapping',         '/dashboard/finance/account-mapping',         'database',                 'sidebar', 140),
  ('finance.customer-receivable',     'Customer Receivable',     '/dashboard/finance/customer-receivable',     'clipboard',                'sidebar', 150),
  ('finance.customer-advance',        'Customer Advance',        '/dashboard/finance/customer-advance',        'paper-airplane',           'sidebar', 160),
  ('finance.pos-settlement',          'POS Settlement',          '/dashboard/finance/pos-settlement',          'shopping',                 'sidebar', 170),
  ('finance.tenant-reconciliation',   'Tenant Reconciliation',   '/dashboard/finance/tenant-reconciliation',   'building',                 'sidebar', 180),
  ('finance.employee-advance-payment','Employee Advance Payment','/dashboard/finance/employee-advance-payment','users',                    'sidebar', 190),
  ('finance.employee-reimbursement',  'Employee Reimbursement',  '/dashboard/finance/employee-reimbursement',  'document-text',            'sidebar', 200),
  ('finance.disbursement',            'Disbursement',            '/dashboard/finance/disbursement',            'paper-airplane',           'sidebar', 210),

  -- Accounting ----------------------------------------------------------------
  ('accounting.release-payment',    'Release Payment',    '/dashboard/accounting/release-payment',    'check-circle', 'sidebar', 10),
  ('accounting.bank-reconcile',     'Bank Reconcile',     '/dashboard/accounting/bank-reconcile',     'database',     'sidebar', 20),
  ('accounting.cash-count',         'Cash Count',         '/dashboard/accounting/cash-count',         'money',        'sidebar', 30),
  ('accounting.gl-reconciliation',  'GL Reconciliation',  '/dashboard/accounting/gl-reconciliation',  'chart',        'sidebar', 40),
  ('accounting.general-journal',    'General Journal',    '/dashboard/accounting/general-journal',    'document-text','sidebar', 50),
  ('accounting.general-ledger',     'General Ledger',     '/dashboard/accounting/general-ledger',     'reports',      'sidebar', 60),
  ('accounting.memorial-journal',   'Memorial Journal',   '/dashboard/accounting/memorial-journal',   'clipboard',    'sidebar', 70),
  ('accounting.close-period-stock', 'Close Period Stock', '/dashboard/accounting/close-period-stock', 'circle-stack', 'sidebar', 80),
  ('accounting.close-period',       'Close Period',       '/dashboard/accounting/close-period',       'calendar',     'sidebar', 90),

  -- POS -----------------------------------------------------------------------
  ('pos.dashboard',        'Dashboard',   '/dashboard/pos',                 'home',          'sidebar', 10),
  ('pos.products',         'Produk',      '/dashboard/pos/products',        'cube',          'sidebar', 20),
  ('pos.cashier',          'Kasir',       '/dashboard/pos/cashier-new',     'shopping',      'sidebar', 30),
  ('pos.open-bills',       'Open Bills',  '/dashboard/pos/open-bills',      'clipboard',     'sidebar', 40),
  ('pos.orders',           'Pesanan',     '/dashboard/pos/orders',          'clipboard',     'sidebar', 50),
  ('pos.profit',           'Profit',      '/dashboard/pos/reports/profit',  'chart',         'sidebar', 60),
  ('pos.reservation',      'Reservasi',   '/dashboard/pos/reservation',     'calendar',      'sidebar', 70),
  ('pos.topup',            'Topup',       '/dashboard/pos/topup',           'money',         'sidebar', 80),
  ('pos.kds',              'KDS',         '/dashboard/pos/kds',             'cube',          'sidebar', 90),
  ('pos.print-queue',      'Print Queue', '/dashboard/pos/print-queue',     'document-text', 'sidebar', 100),
  ('pos.printer-settings', 'Printer',     '/dashboard/pos/printer-settings','settings',      'sidebar', 110),

  -- CRM -----------------------------------------------------------------------
  ('crm.membership', 'Membership', '/dashboard/crm',         'users', 'sidebar', 10),
  ('crm.members',    'Members',    '/dashboard/crm/members', 'users', 'sidebar', 20),
  ('crm.rewards',    'Rewards',    '/dashboard/crm/rewards', 'star',  'sidebar', 30),

  -- Master Data ---------------------------------------------------------------
  ('master.departments',         'Departemen',         '/dashboard/master/departments',         'building',       'sidebar', 10),
  ('master.positions',           'Jabatan',            '/dashboard/master/positions',           'briefcase',      'sidebar', 20),
  ('master.employment-statuses', 'Status Kepegawaian', '/dashboard/master/employment-statuses', 'identification', 'sidebar', 30),

  -- Settings (Pengaturan) -----------------------------------------------------
  ('settings.business', 'Business',          '/dashboard/settings/business', 'building',    'sidebar', 10),
  ('settings.users',    'Users Management',  '/dashboard/employees',      'users',          'sidebar', 20),
  ('settings.menus',    'Menu Configuration','/dashboard/settings/menus', 'sitemap',        'sidebar', 30),
  ('settings.roles',    'Role & Permission', '/dashboard/settings/roles', 'identification', 'sidebar', 40)
ON CONFLICT (code) DO UPDATE SET
  menu_name    = EXCLUDED.menu_name,
  route_path   = EXCLUDED.route_path,
  icon         = EXCLUDED.icon,
  menu_type    = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number,
  is_active    = true,
  is_visible   = true,
  deleted_at   = NULL;

-- 1) module = segmen pertama kode; level = jumlah titik + 1.
UPDATE iam.menus
SET module = split_part(code, '.', 1),
    level  = (length(code) - length(replace(code, '.', ''))) + 1
WHERE deleted_at IS NULL;

-- 2) parent_id diturunkan dari kode: parent = kode tanpa segmen terakhir.
UPDATE iam.menus child
SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code LIKE '%.%'
  AND parent.code = left(child.code, length(child.code) - position('.' in reverse(child.code)))
  AND child.deleted_at IS NULL;

UPDATE iam.menus SET parent_id = NULL WHERE code NOT LIKE '%.%';

-- 3) Roles (idempoten).
INSERT INTO iam.roles (code, name, description, is_system, is_active) VALUES
  ('super_admin',        'Super Admin',        'Akses penuh ke seluruh sistem', true,  true),
  ('admin',              'Administrator',      'Akses administrasi sistem',     true,  true),
  ('hrd',                'HRD',                'HR & Recruitment',              false, true),
  ('hiring_manager',     'Hiring Manager',     'Rekrutmen / interview',         false, true),
  ('direksi',            'Direksi',            'Eksekutif / overview',          false, true),
  ('purchasing_admin',   'Purchasing Admin',   'Administrasi pembelian',        false, true),
  ('purchasing_manager', 'Purchasing Manager', 'Manajemen pembelian',           false, true),
  ('purchasing_staff',   'Purchasing Staff',   'Staf pembelian',                false, true),
  ('finance_staff',      'Finance Staff',      'Keuangan & akuntansi',          false, true),
  ('warehouse_staff',    'Warehouse Staff',    'Gudang',                        false, true),
  ('warehouse_admin',    'Warehouse Admin',    'Administrasi gudang',           false, true),
  ('pos',                'POS Cashier',        'Kasir POS',                     false, true),
  ('pos_supervisor',     'POS Supervisor',     'Supervisor POS',                false, true),
  ('qc_staff',           'QC Staff',           'Quality control',               false, true)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = true;

-- 4) Role -> menu permissions. granted_actions mengikuti permission_context menu.
--    CATATAN: getUserMenus berhenti fallback begitu role punya >=1 baris di sini,
--    jadi grant tiap role harus lengkap.

-- 4a) super_admin & admin -> SEMUA menu.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin') AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions;

-- 4b) hrd -> HRIS + Master Data + Pengaturan.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'hrd' AND m.deleted_at IS NULL
  AND (m.code = 'dashboard' OR m.module IN ('hris', 'master', 'settings'))
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions;

-- 4c) hiring_manager -> subset HRIS (rekrutmen).
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'hiring_manager' AND m.deleted_at IS NULL
  AND m.code IN ('dashboard', 'hris', 'hris.candidates', 'hris.pipeline', 'hris.job-portal', 'hris.analytics')
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions;

-- 4d) Purchasing / warehouse / QC -> Purchasing, Items, Inventory, Finance, Accounting.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('purchasing_admin', 'purchasing_manager', 'purchasing_staff', 'warehouse_staff', 'warehouse_admin', 'qc_staff')
  AND m.deleted_at IS NULL
  AND (m.code = 'dashboard' OR m.module IN ('purchasing', 'items', 'inventory', 'finance', 'accounting'))
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions;

-- 4e) finance_staff -> Finance + Accounting.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'finance_staff' AND m.deleted_at IS NULL
  AND (m.code = 'dashboard' OR m.module IN ('finance', 'accounting'))
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions;

-- 4f) pos & pos_supervisor -> POS.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('pos', 'pos_supervisor') AND m.deleted_at IS NULL
  AND (m.code = 'dashboard' OR m.module = 'pos')
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions;

-- 4g) direksi -> overview lintas modul (read-only oriented).
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'direksi' AND m.deleted_at IS NULL
  AND (
    m.code IN ('dashboard', 'hris', 'hris.analytics', 'hris.reports', 'pos', 'pos.dashboard', 'pos.profit')
    OR m.module IN ('finance', 'accounting', 'crm')
  )
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions;
