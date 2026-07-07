import { NextRequest, NextResponse } from "next/server";

const DEPRECATED_MESSAGE =
  "API legacy /api/purchasing/return sudah tidak dipakai. Gunakan /api/purchasing/returns untuk purchase return workflow.";

function deprecatedResponse() {
  return NextResponse.json(
    { success: false, message: DEPRECATED_MESSAGE },
    { status: 410 }
  );
}

export async function GET(_request: NextRequest) {
  return deprecatedResponse();
}

export async function POST(_request: NextRequest) {
  return deprecatedResponse();
}
