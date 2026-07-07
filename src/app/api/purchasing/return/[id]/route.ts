import { NextRequest, NextResponse } from "next/server";

const DEPRECATED_MESSAGE =
  "API legacy /api/purchasing/return/:id sudah tidak dipakai. Gunakan /api/purchasing/returns/:id.";

function deprecatedResponse() {
  return NextResponse.json(
    { success: false, message: DEPRECATED_MESSAGE },
    { status: 410 }
  );
}

export async function GET(_request: NextRequest) {
  return deprecatedResponse();
}

export async function PUT(_request: NextRequest) {
  return deprecatedResponse();
}

export async function DELETE(_request: NextRequest) {
  return deprecatedResponse();
}
