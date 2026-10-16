import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { syncGoogleForUser } from "@/lib/google/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") || "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const admin = createSupabaseAdmin();
    const { data: connections, error } = await admin.from("google_connections").select("user_id").limit(20);
    if (error) throw new Error(`Could not load connected accounts: ${error.message}`);
    const results = await Promise.allSettled((connections ?? []).map(({ user_id }) => syncGoogleForUser(user_id)));
    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.length - succeeded;
    if (failed) console.error("Scheduled Google sync had failed accounts.", { attempted: results.length, succeeded, failed });
    return NextResponse.json({ ok: failed === 0, attempted: results.length, succeeded, failed });
  } catch (error) {
    console.error("Scheduled Google sync could not run.", error);
    return NextResponse.json({ error: "Scheduled Google sync could not run. Check server logs." }, { status: 500 });
  }
}
