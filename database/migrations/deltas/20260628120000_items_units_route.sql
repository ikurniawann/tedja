-- Pindahkan route menu Unit ke modul Items: /dashboard/items/units

UPDATE iam.menus
SET route_path = '/dashboard/items/units',
    updated_at = NOW()
WHERE code = 'items.raw-material.units';
