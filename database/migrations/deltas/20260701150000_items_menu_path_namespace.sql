-- =============================================================================
-- Update IAM menu route_path → /dashboard/raw-material/* & /dashboard/product/*
-- =============================================================================

-- Raw Material — Master Data
UPDATE iam.menus SET route_path = '/dashboard/raw-material/units', updated_at = now()
WHERE code = 'items.raw-material.master.units';

UPDATE iam.menus SET route_path = '/dashboard/raw-material/categories', updated_at = now()
WHERE code = 'items.raw-material.master.categories';

UPDATE iam.menus SET route_path = '/dashboard/raw-material/storage', updated_at = now()
WHERE code = 'items.raw-material.master.storage';

UPDATE iam.menus SET route_path = '/dashboard/raw-material/materials', updated_at = now()
WHERE code = 'items.raw-material.master.materials';

-- Raw Material — Inventory
UPDATE iam.menus SET route_path = '/dashboard/raw-material/inventory/stock', updated_at = now()
WHERE code = 'items.raw-material.inventory.stock';

UPDATE iam.menus SET route_path = '/dashboard/raw-material/inventory/opname', updated_at = now()
WHERE code = 'items.raw-material.inventory.opname';

UPDATE iam.menus SET route_path = '/dashboard/raw-material/inventory/adjustment', updated_at = now()
WHERE code = 'items.raw-material.inventory.adjustment';

UPDATE iam.menus SET route_path = '/dashboard/raw-material/inventory/transfers', updated_at = now()
WHERE code = 'items.raw-material.inventory.transfer';

-- Raw Material — Purchasing
UPDATE iam.menus SET route_path = '/dashboard/raw-material/purchasing/suppliers', updated_at = now()
WHERE code = 'items.raw-material.purchasing.suppliers';

UPDATE iam.menus SET route_path = '/dashboard/raw-material/purchasing/price-list', updated_at = now()
WHERE code = 'items.raw-material.purchasing.price-list';

UPDATE iam.menus SET route_path = '/dashboard/raw-material/purchasing/pr', updated_at = now()
WHERE code = 'items.raw-material.purchasing.pr';

UPDATE iam.menus SET route_path = '/dashboard/raw-material/purchasing/po', updated_at = now()
WHERE code = 'items.raw-material.purchasing.po';

UPDATE iam.menus SET route_path = '/dashboard/raw-material/purchasing/delivery', updated_at = now()
WHERE code = 'items.raw-material.purchasing.delivery';

UPDATE iam.menus SET route_path = '/dashboard/raw-material/purchasing/grn', updated_at = now()
WHERE code = 'items.raw-material.purchasing.grn';

UPDATE iam.menus SET route_path = '/dashboard/raw-material/purchasing/returns', updated_at = now()
WHERE code = 'items.raw-material.purchasing.returns';

UPDATE iam.menus SET route_path = '/dashboard/raw-material/purchasing/invoice', updated_at = now()
WHERE code = 'items.raw-material.purchasing.invoice';

-- Raw Material — Approval & Production
UPDATE iam.menus SET route_path = '/dashboard/raw-material/approval/pr', updated_at = now()
WHERE code = 'items.raw-material.approval.pr';

UPDATE iam.menus SET route_path = '/dashboard/raw-material/approval/po', updated_at = now()
WHERE code = 'items.raw-material.approval.po';

UPDATE iam.menus SET route_path = '/dashboard/raw-material/production/recipes', updated_at = now()
WHERE code = 'items.raw-material.production.bom';

UPDATE iam.menus SET route_path = '/dashboard/raw-material/production', updated_at = now()
WHERE code = 'items.raw-material.production.hub';

-- Product — Master Data
UPDATE iam.menus SET route_path = '/dashboard/product/categories', updated_at = now()
WHERE code = 'items.product.master.categories';

UPDATE iam.menus SET route_path = '/dashboard/product/products', updated_at = now()
WHERE code = 'items.product.master.products';

-- Product — Inventory
UPDATE iam.menus SET route_path = '/dashboard/product/inventory/stock', updated_at = now()
WHERE code = 'items.product.inventory.stock';

UPDATE iam.menus SET route_path = '/dashboard/product/inventory/opname', updated_at = now()
WHERE code = 'items.product.inventory.opname';

UPDATE iam.menus SET route_path = '/dashboard/product/inventory/adjustment', updated_at = now()
WHERE code = 'items.product.inventory.adjustment';

UPDATE iam.menus SET route_path = '/dashboard/product/inventory/transfer', updated_at = now()
WHERE code = 'items.product.inventory.transfer';

-- Product — Purchasing
UPDATE iam.menus SET route_path = '/dashboard/product/purchasing/vendor', updated_at = now()
WHERE code = 'items.product.purchasing.vendor';

UPDATE iam.menus SET route_path = '/dashboard/product/purchasing/price-list', updated_at = now()
WHERE code = 'items.product.purchasing.price-list';

UPDATE iam.menus SET route_path = '/dashboard/product/purchasing/pr', updated_at = now()
WHERE code = 'items.product.purchasing.pr';

UPDATE iam.menus SET route_path = '/dashboard/product/purchasing/po', updated_at = now()
WHERE code = 'items.product.purchasing.po';

UPDATE iam.menus SET route_path = '/dashboard/product/purchasing/delivery', updated_at = now()
WHERE code = 'items.product.purchasing.delivery';

UPDATE iam.menus SET route_path = '/dashboard/product/purchasing/receive', updated_at = now()
WHERE code = 'items.product.purchasing.grn';

UPDATE iam.menus SET route_path = '/dashboard/product/purchasing/returns', updated_at = now()
WHERE code = 'items.product.purchasing.returns';

UPDATE iam.menus SET route_path = '/dashboard/product/purchasing/invoice', updated_at = now()
WHERE code = 'items.product.purchasing.invoice';

-- Product — Approval & Production
UPDATE iam.menus SET route_path = '/dashboard/product/approval/pr', updated_at = now()
WHERE code = 'items.product.approval.pr';

UPDATE iam.menus SET route_path = '/dashboard/product/approval/po', updated_at = now()
WHERE code = 'items.product.approval.po';

UPDATE iam.menus SET route_path = '/dashboard/product/production/recipes', updated_at = now()
WHERE code = 'items.product.production.bom';

UPDATE iam.menus SET route_path = '/dashboard/product/production', updated_at = now()
WHERE code = 'items.product.production.hub';
