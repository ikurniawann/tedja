import { NextRequest, NextResponse } from "next/server";
import { ApiError, getApiUser, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import {
  canAccessAppearanceCompany,
  getCompanyAppearance,
  listAccessibleAppearanceCompanies,
  resolveDefaultCompanyId,
  saveCompanyAppearance,
} from "@/lib/theme/company-appearance";
import { parseAppearanceTokens } from "@/lib/theme/appearance-tokens";

export async function GET(request: NextRequest) {
  try {
    const user = await getApiUser();
    if (!user) {
      return NextResponse.json({
        data: {
          company_id: null,
          company_name: null,
          companies: [],
          theme: parseAppearanceTokens(null),
        },
      });
    }
    const scope = await getApiUserScope();
    if (!scope) throw ApiError.unauthorized("Authentication required");

    const companies = await listAccessibleAppearanceCompanies(scope);
    const requested = request.nextUrl.searchParams.get("company_id");
    const companyId =
      requested && canAccessAppearanceCompany(scope, requested)
        ? requested
        : resolveDefaultCompanyId(scope, companies);

    if (!companyId) {
      return NextResponse.json({
        data: {
          company_id: null,
          company_name: null,
          companies,
          theme: parseAppearanceTokens(null),
        },
      });
    }

    if (requested && !canAccessAppearanceCompany(scope, requested)) {
      throw ApiError.forbidden("Company tidak dapat diakses");
    }

    const company = companies.find((c) => c.id === companyId) ?? null;
    const theme = await getCompanyAppearance(companyId);
    return NextResponse.json({
      data: {
        company_id: companyId,
        company_name: company?.name ?? null,
        companies,
        theme,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[settings/appearance] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.settingsAppearance);
    const scope = await getApiUserScope();
    if (!scope) throw ApiError.unauthorized("Authentication required");

    const body = (await request.json()) as {
      company_id?: unknown;
      theme?: unknown;
    };
    const companyId = typeof body.company_id === "string" ? body.company_id : "";
    if (!companyId) {
      return NextResponse.json({ error: "company_id wajib" }, { status: 400 });
    }
    if (!canAccessAppearanceCompany(scope, companyId)) {
      throw ApiError.forbidden("Company tidak dapat diakses");
    }

    const companies = await listAccessibleAppearanceCompanies(scope);
    if (!companies.some((c) => c.id === companyId)) {
      return NextResponse.json({ error: "Company tidak ditemukan" }, { status: 404 });
    }

    const theme = await saveCompanyAppearance(
      companyId,
      parseAppearanceTokens(body.theme),
      user.id
    );
    const company = companies.find((c) => c.id === companyId) ?? null;
    return NextResponse.json({
      message: "Tema perusahaan tersimpan",
      data: {
        company_id: companyId,
        company_name: company?.name ?? null,
        companies,
        theme,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[settings/appearance] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
