import { NextResponse } from "next/server";
import { createSupabaseAdmin, createUserSupabase } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createUserSupabase();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ connected: false, error: "Sign in to check Google connection status." }, { status: 401 });

    const admin = createSupabaseAdmin();
    const { data, error } = await admin.from("google_connections")
      .select("google_email,scopes,connected_at,last_sync_at,study_calendar_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(`Could not load Google connection: ${error.message}`);
    return NextResponse.json({
      connected: Boolean(data),
      configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI && process.env.GOOGLE_TOKEN_ENCRYPTION_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY),
      email: data?.google_email ?? null,
      scopes: data?.scopes ?? [],
      connectedAt: data?.connected_at ?? null,
      lastSyncAt: data?.last_sync_at ?? null,
      calendarSelected: Boolean(data?.study_calendar_id),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ connected: false, error: error instanceof Error ? error.message : "Could not load Google connection." }, { status: 503 });
  }
}
