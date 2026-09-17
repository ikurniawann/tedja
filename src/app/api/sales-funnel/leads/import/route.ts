import { NextRequest, NextResponse } from "next/server";
import { getApiUserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import { syncLeadAccountContact } from "@/lib/sales-funnel/account-sync";
import {
  LEAD_ORG_TYPES,
  LEAD_SOURCES,
  LEAD_TEMPERATURES,
  isValidNormalizedPhone,
  normalizePhone,
  requireCompanyScope,
  requireSalesFunnelRole,
  resolveSalesVenue,
} from "@/lib/sales-funnel/server";

const EMAIL_RE = /^\S+@\S+\.\S+$/;
import {
  normalizeLeadSpreadsheetHeader,
  parseLeadSpreadsheetFile,
} from "@/lib/sales-funnel/lead-spreadsheet";

const MAX_ROWS = 500;

function pickEnum(
  value: string | undefined,
  allowed: readonly string[],
  fallback: string
): string {
  const raw = value?.trim().toLowerCase();
  return raw && allowed.includes(raw) ? raw : fallback;
}

export async function POST(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const scope = await getApiUserScope();
    const scopeError = requireCompanyScope(user, scope);
    if (scopeError) return scopeError;
    const { companyId, branchId } = await resolveSalesVenue(scope);
    if (!companyId || !branchId) {
      return NextResponse.json(
        { message: "Venue belum dikonfigurasi (default_company_id/default_branch_id)" },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ message: "File not found" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = await parseLeadSpreadsheetFile(buffer, file.name);
    if (rows.length < 2) {
      return NextResponse.json(
        { message: "File harus berisi baris header dan minimal satu baris data" },
        { status: 400 }
      );
    }
    if (rows.length - 1 > MAX_ROWS) {
      return NextResponse.json(
        { message: `Maksimal ${MAX_ROWS} baris per import` },
        { status: 400 }
      );
    }

    const headers = rows[0].map(normalizeLeadSpreadsheetHeader);
    // Duplikat = kombinasi instansi + no. WA (satu PIC boleh banyak leads)
    const existingRows = await query<{ pic_phone: string; org_name: string }>(
      `SELECT pic_phone, org_name FROM crm.crm_sales_leads
       WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId]
    );
    const dedupKey = (phone: string, org: string) =>
      `${phone}|${org.trim().toLowerCase()}`;
    const usedKeys = new Set(
      existingRows.map((r) => dedupKey(r.pic_phone, r.org_name))
    );

    let imported = 0;
    const skipped: Array<{ row: number }> = [];
    const errors: Array<{ row: number; message: string }> = [];

    for (let i = 1; i < rows.length; i++) {
      const rowNumber = i + 1;
      const rowData: Record<string, string> = {};
      headers.forEach((header, idx) => {
        rowData[header] = rows[i][idx] || "";
      });

      const isEmpty = Object.values(rowData).every((v) => !v.trim());
      if (isEmpty) continue;

      const orgName = rowData.nama_instansi?.trim();
      const picName = rowData.nama_pic?.trim();
      const picPhoneRaw = rowData.wa_pic?.trim();
      if (!orgName || !picName || !picPhoneRaw) {
        errors.push({
          row: rowNumber,
          message: "Field wajib kosong: nama_instansi / nama_pic / wa_pic",
        });
        skipped.push({ row: rowNumber });
        continue;
      }

      const phone = normalizePhone(picPhoneRaw);
      if (!isValidNormalizedPhone(phone)) {
        errors.push({ row: rowNumber, message: `No. WA tidak valid: ${picPhoneRaw}` });
        skipped.push({ row: rowNumber });
        continue;
      }
      if (usedKeys.has(dedupKey(phone, orgName))) {
        errors.push({
          row: rowNumber,
          message: `Duplikat instansi + no. WA: ${orgName} / ${picPhoneRaw}`,
        });
        skipped.push({ row: rowNumber });
        continue;
      }

      const emailRaw = rowData.email_pic?.trim() || "";
      const email = emailRaw && EMAIL_RE.test(emailRaw) ? emailRaw.slice(0, 150) : null;
      if (emailRaw && !email) {
        // baris tetap diimport; email tidak valid diabaikan + dicatat
        errors.push({ row: rowNumber, message: `Email diabaikan (tidak valid): ${emailRaw}` });
      }

      try {
        await queryOne(
          `INSERT INTO crm.crm_sales_leads
             (company_id, branch_id, org_name, org_type, pic_name, pic_title,
              pic_phone, pic_email, city, source, temperature, notes,
              owner_user_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING id`,
          [
            companyId,
            branchId,
            orgName,
            pickEnum(rowData.jenis_instansi, LEAD_ORG_TYPES, "corporate"),
            picName,
            rowData.jabatan_pic?.trim() || null,
            phone,
            email,
            rowData.kota?.trim() || null,
            pickEnum(rowData.sumber, LEAD_SOURCES, "lainnya"),
            pickEnum(rowData.suhu, LEAD_TEMPERATURES, "hangat"),
            rowData.catatan?.trim() || null,
            user.role === "sales" ? user.id : null,
            user.id,
          ]
        );
        usedKeys.add(dedupKey(phone, orgName));
        imported += 1;
      } catch (insertErr) {
        console.error("[sales-funnel] import row error:", insertErr);
        errors.push({ row: rowNumber, message: "Gagal menyimpan baris" });
        skipped.push({ row: rowNumber });
      }
    }

    // EPIC-050: tautkan lead hasil import ke Account/Contact (upsert by nama/nomor WA)
    if (imported > 0) {
      try {
        const untied = await query<{ id: string }>(
          `SELECT id FROM crm.crm_sales_leads
           WHERE company_id = $1 AND deleted_at IS NULL
             AND (account_id IS NULL OR contact_id IS NULL)
           ORDER BY created_at DESC LIMIT 1000`,
          [companyId]
        );
        for (const lead of untied) await syncLeadAccountContact(lead.id);
      } catch (e) {
        console.error("[sales-funnel] sync account/contact import gagal:", e);
      }
    }
    return NextResponse.json({
      success: true,
      imported,
      updated: 0,
      skipped: skipped.length,
      errors,
    });
  } catch (err) {
    console.error("[sales-funnel] import leads error:", err);
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
