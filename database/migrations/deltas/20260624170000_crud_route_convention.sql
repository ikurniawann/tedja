-- Update IAM menu routes to CRUD URL convention (/insert, /edit/*) and employees base path.
-- Kolom rute pada iam.menus bernama `route_path`.

UPDATE iam.menus
SET route_path = '/dashboard/employees'
WHERE route_path = '/dashboard/hris/employees';

UPDATE iam.menus
SET route_path = REPLACE(route_path, '/new', '/insert')
WHERE route_path LIKE '%/new';

UPDATE iam.menus
SET route_path = REGEXP_REPLACE(route_path, '^(.+)/([^/]+)/edit$', '\1/edit/\2')
WHERE route_path ~ '/[^/]+/edit$'
  AND route_path NOT LIKE '%/edit/%';
