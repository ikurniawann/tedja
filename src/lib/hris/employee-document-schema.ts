import { z } from "zod";

/**
 * Field metadata dokumen karyawan yang BOLEH diubah manual lewat PATCH.
 * Sengaja allowlist (bukan spread body mentah) — kolom verifikasi
 * (is_verified/verified_by/verified_at), kepemilikan (employee_id), dan
 * uploader tidak boleh dipaksa lewat body (audit 2026-09-17).
 */
export const employeeDocumentPatchSchema = z
  .object({
    document_type: z.string().max(120).optional(),
    document_name: z.string().max(255).optional(),
    issue_date: z.string().optional().nullable(),
    expiry_date: z.string().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .strip();
