-- Pindahkan route menu Product ke modul Items:
--   items.product.categories → /dashboard/items/product/categories
--   items.product.products   → /dashboard/items/products

UPDATE iam.menus
SET route_path = '/dashboard/items/product/categories',
    updated_at = NOW()
WHERE code = 'items.product.categories';

UPDATE iam.menus
SET route_path = '/dashboard/items/products',
    updated_at = NOW()
WHERE code = 'items.product.products';
