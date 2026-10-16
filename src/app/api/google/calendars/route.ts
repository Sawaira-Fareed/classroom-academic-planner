import { google } from "googleapis";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGoogleClient } from "@/lib/google/server";
import { createUserSupabase } from "@/lib/supabase/server";

const calendarRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create") }),
  z.object({ action: z.literal("select"), calendarId: z.string().min(1).max(500) }),
]);

async function authenticatedUser() {
  const supabase = await createUserSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();
  return error || !user ? null : user;
}

export async function GET() {
  try {
    const user = await authenticatedUser();
    if (!user) return NextResponse.json({ error: "Sign in before choosing a study calendar." }, { status: 401 });
    const { auth, connection } = await getGoogleClient(user.id);
    const calendar = google.calendar({ version: "v3", auth });
    const response = await calendar.calendarList.list({ maxResults: 100 });
    return NextResponse.json({
      calendars: (response.data.items ?? []).map((item) => ({ id: item.id, name: item.summary, accessRole: item.accessRole })),
      selectedCalendarId: connection.study_calendar_id,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load calendars." }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const input = calendarRequest.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Choose an existing writable calendar or create a StudyFlow calendar." }, { status: 400 });
  try {
    const user = await authenticatedUser();
    if (!user) return NextResponse.json({ error: "Sign in before choosing a study calendar." }, { status: 401 });
    const { auth, admin } = await getGoogleClient(user.id);
    const calendar = google.calendar({ version: "v3", auth });
    let calendarId: string | null = null;
    if (input.data.action === "create") {
      const response = await calendar.calendars.insert({ requestBody: { summary: "StudyFlow Study Planner", timeZone: "Asia/Karachi" } });
      calendarId = response.data.id ?? null;
    } else {
      const response = await calendar.calendarList.get({ calendarId: input.data.calendarId });
      if (!response.data.id || !["owner", "writer"].includes(response.data.accessRole ?? "")) {
        return NextResponse.json({ error: "Select a calendar where your Google account has write access." }, { status: 403 });
      }
      calendarId = response.data.id;
    }
    if (!calendarId) throw new Error("Google Calendar did not return a calendar ID.");
    const { error } = await admin.from("google_connections")
      .update({ study_calendar_id: calendarId, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
    if (error) throw new Error(`Calendar was selected, but StudyFlow could not save the selection: ${error.message}`);
    return NextResponse.json({ selectedCalendarId: calendarId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not configure the study calendar." }, { status: 502 });
  }
}
