# Task: Appearance studio (company theme)

## Goal
Page `/dashboard/settings/appearance`: live preview dashboard, Apply ke company, Reset default. Tema per company.

## Plan
- [x] Token model + parse/apply CSS vars + unit test
- [x] Migrasi `configuration.company_appearance` + API GET/PUT
- [x] ThemeProvider/ThemeScript load cache + fetch company theme
- [x] Wire sidebar/navbar/font ke CSS vars
- [x] UI studio: preview + tab Base/Sidebar/Navbar/Font + company select
- [x] Apply migrasi + test

## Review
- Preview live (draft), Apply persist per company, Reset = draft default
- Mode light/dark tetap preferensi user (localStorage)
- Mapping tema: `configuration.company_appearance.theme` jsonb per company_id
