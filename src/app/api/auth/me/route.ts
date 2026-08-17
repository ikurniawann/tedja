import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const db = await createServerPgClient();
    const { data: { user } } = await db.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 }
      );
    }

    // Jangan select `email` dari configuration.users — kolom itu opsional /
    // kadang belum ada, dan error select sebelumnya di-map ke 404 sehingga
    // desktop menganggap user logout meski sesi + profil masih valid.
    const { data: profile, error: profileError } = await db
      .from("users")
      .select("id, full_name, role, brand_id")
      .eq("id", user.id)
      .single();

    if (profileError && profileError.code !== "PGRST116") {
      console.error("Error fetching user profile:", profileError);
      return NextResponse.json(
        { success: false, message: profileError.message || "Failed to fetch profile" },
        { status: 500 }
      );
    }

    if (!profile) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        ...profile,
        id: user.id,
        email: user.email ?? "",
      },
    });
  } catch (error: any) {
    console.error("Error fetching user profile:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to fetch profile" },
      { status: 500 }
    );
  }
}
