import { NextResponse } from "next/server";
import { createUserSupabase } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { syncGoogleForUser } from "@/lib/google/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return NextResponse.json({ error: "Supabase is not configured for Google sync." }, { status: 503 });
  }

  try {
    const supabase = await createUserSupabase();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Sign in before syncing Google Classroom." }, { status: 401 });
    const admin = createSupabaseAdmin();
    const { data: connection, error: connectionError } = await admin.from("google_connections")
      .select("last_sync_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (connectionError) throw new Error(`Could not check Google sync status: ${connectionError.message}`);
    if (connection?.last_sync_at && Date.now() - new Date(connection.last_sync_at).getTime() < 60_000) {
      return NextResponse.json({ error: "A sync completed less than a minute ago. Wait before starting another." }, { status: 429 });
    }
    const result = await syncGoogleForUser(user.id);
    return NextResponse.json({ synced: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google sync failed.";
    const status = message.includes("already running") ? 409 : message.includes("not connected") ? 409 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
