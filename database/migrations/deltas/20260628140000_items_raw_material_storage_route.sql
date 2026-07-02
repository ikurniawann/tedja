-- Pindahkan route menu Storage Bahan Baku ke modul Items: /dashboard/items/raw-material/storage

UPDATE iam.menus
SET route_path = '/dashboard/items/raw-material/storage',
    updated_at = NOW()
WHERE code = 'items.raw-material.storage';
