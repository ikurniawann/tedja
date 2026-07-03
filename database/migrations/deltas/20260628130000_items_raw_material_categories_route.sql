-- Pindahkan route menu Kategori Bahan Baku ke modul Items: /dashboard/items/raw-material/categories

UPDATE iam.menus
SET route_path = '/dashboard/items/raw-material/categories',
    updated_at = NOW()
WHERE code = 'items.raw-material.categories';
