-- Pindahkan route menu Raw Material ke modul Items: /dashboard/items/raw-materials

UPDATE iam.menus
SET route_path = '/dashboard/items/raw-materials',
    updated_at = NOW()
WHERE code = 'items.raw-material.materials';
