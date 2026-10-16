import { NextResponse } from "next/server";
import { decryptGoogleToken } from "@/lib/google/token-vault";
import { createSupabaseAdmin, createUserSupabase } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await createUserSupabase();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "Sign in before disconnecting Google." }, { status: 401 });
    const admin = createSupabaseAdmin();
    const { data: connection, error } = await admin.from("google_connections")
      .select("refresh_token_ciphertext,token_key_version")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(`Could not load Google connection: ${error.message}`);
    if (!connection) return NextResponse.json({ disconnected: true });

    const token = decryptGoogleToken(connection.refresh_token_ciphertext, connection.token_key_version);
    const revokeResponse = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!revokeResponse.ok && revokeResponse.status !== 400) {
      return NextResponse.json({ error: "Google did not confirm token revocation. Connection was kept; try again." }, { status: 502 });
    }
    const { error: deleteError } = await admin.from("google_connections").delete().eq("user_id", user.id);
    if (deleteError) throw new Error(`Google token was revoked but local connection could not be removed: ${deleteError.message}`);
    return NextResponse.json({ disconnected: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not disconnect Google." }, { status: 503 });
  }
}
