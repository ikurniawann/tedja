-- Fix items.product group landing route
UPDATE iam.menus
SET route_path = NULL,
    menu_name = 'Product',
    updated_at = now()
WHERE code = 'items.product' AND deleted_at IS NULL;

UPDATE iam.menus
SET menu_name = 'Category',
    updated_at = now()
WHERE code = 'items.product.categories' AND deleted_at IS NULL;
