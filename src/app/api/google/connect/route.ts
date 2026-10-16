import { NextResponse } from "next/server";
import { createOAuthState } from "@/lib/google/token-vault";
import { makeConsentUrl } from "@/lib/google/oauth";
import { createUserSupabase } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createUserSupabase();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.redirect(new URL("/?google=sign-in-required", process.env.APP_BASE_URL ?? "http://localhost:3000"));

    const state = createOAuthState(user.id);
    const response = NextResponse.redirect(makeConsentUrl(state));
    response.cookies.set("studyflow_google_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/google/callback",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    console.error("Could not start Google OAuth.", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start Google OAuth." }, { status: 503 });
  }
}
