import { NextRequest, NextResponse } from "next/server";
import { encryptGoogleToken, validateOAuthState } from "@/lib/google/token-vault";
import { makeOAuthClient } from "@/lib/google/oauth";
import { createSupabaseAdmin, createUserSupabase } from "@/lib/supabase/server";

function appRedirect(request: NextRequest, result: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("google", result);
  const response = NextResponse.redirect(url);
  response.cookies.set("studyflow_google_oauth_state", "", {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/api/google/callback", maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) return appRedirect(request, "cancelled");
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const storedState = request.cookies.get("studyflow_google_oauth_state")?.value;
  if (!code || !state || !storedState || state !== storedState) return appRedirect(request, "invalid-state");

  try {
    const supabase = await createUserSupabase();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user || !validateOAuthState(state, user.id)) return appRedirect(request, "invalid-state");

    const oauth = makeOAuthClient();
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token || !tokens.id_token) return appRedirect(request, "missing-refresh-token");

    const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const identity = ticket.getPayload();
    if (!identity?.sub || identity.email_verified !== true) return appRedirect(request, "identity-error");
    const { ciphertext, keyVersion } = encryptGoogleToken(tokens.refresh_token);
    const admin = createSupabaseAdmin();
    const { error } = await admin.from("google_connections").upsert({
      user_id: user.id,
      google_subject: identity.sub,
      google_email: identity.email ?? null,
      refresh_token_ciphertext: ciphertext,
      token_key_version: keyVersion,
      scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) {
      console.error("Could not persist Google connection.", error);
      return appRedirect(request, "storage-error");
    }
    return appRedirect(request, "connected");
  } catch (error) {
    console.error("Google OAuth callback failed.");
    return appRedirect(request, "oauth-error");
  }
}
