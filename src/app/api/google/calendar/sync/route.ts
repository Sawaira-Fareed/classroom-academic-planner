import { calendar_v3, google } from "googleapis";
import { NextResponse } from "next/server";
import { createUserSupabase } from "@/lib/supabase/server";
import { getGoogleClient } from "@/lib/google/server";

export const runtime = "nodejs";

export async function POST() {
  try {
    const userSupabase = await createUserSupabase();
    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Sign in before syncing approved tasks to Calendar." }, { status: 401 });
    const { auth, admin, connection } = await getGoogleClient(user.id);
    if (!connection.study_calendar_id) return NextResponse.json({ error: "Create or select a StudyFlow calendar first." }, { status: 409 });
    const calendar = google.calendar({ version: "v3", auth });
    const [tasksResult, blocksResult, mappingsResult] = await Promise.all([
      admin.from("tasks").select("id,title,description,due_at,status,course_id").eq("user_id", user.id).in("status", ["approved", "in_progress", "completed"]).not("due_at", "is", null).limit(100),
      admin.from("schedule_blocks").select("id,title,block_type,start_at,end_at,timezone").eq("user_id", user.id).eq("is_deleted", false).limit(100),
      admin.from("calendar_sync").select("task_id,schedule_block_id,google_event_id,calendar_id,sync_status").eq("user_id", user.id).eq("calendar_id", connection.study_calendar_id),
    ]);
    const queryError = tasksResult.error ?? blocksResult.error ?? mappingsResult.error;
    if (queryError) throw new Error(`Could not load approved planner items: ${queryError.message}`);
    const mappings = mappingsResult.data ?? [];
    const mappingByItem = new Map(mappings.filter((mapping) => mapping.sync_status !== "deleted").map((mapping) => [`${mapping.task_id ? "task" : "block"}:${mapping.task_id ?? mapping.schedule_block_id}`, mapping]));
    const activeTaskIds = new Set((tasksResult.data ?? []).map((task) => task.id));
    let written = 0;
    let removed = 0;

    for (const mapping of mappings) {
      const isActive = mapping.task_id
        ? activeTaskIds.has(mapping.task_id)
        : mapping.schedule_block_id && (blocksResult.data ?? []).some((block) => block.id === mapping.schedule_block_id);
      if (isActive || mapping.sync_status === "deleted") continue;
      try {
        await calendar.events.delete({ calendarId: connection.study_calendar_id, eventId: mapping.google_event_id });
      } catch (error) {
        if (typeof error !== "object" || error === null || !("code" in error) || error.code !== 404) throw error;
      }
      const { error } = await admin.from("calendar_sync").update({
        sync_status: "deleted", updated_at: new Date().toISOString(),
      }).eq("user_id", user.id).eq("google_event_id", mapping.google_event_id);
      if (error) throw new Error(`Calendar event was removed but its mapping could not be updated: ${error.message}`);
      removed += 1;
    }

    const writeEvent = async (item: {
      kind: "task" | "block"; id: string; title: string; description?: string | null;
      dueAt?: string | null; startAt?: string; endAt?: string; timezone?: string;
    }) => {
      const mapping = mappingByItem.get(`${item.kind}:${item.id}`);
      const event: calendar_v3.Schema$Event = item.kind === "task" ? {
        summary: `Deadline: ${item.title}`,
        description: item.description ?? "Approved StudyFlow task deadline.",
        start: { date: item.dueAt?.slice(0, 10) },
        end: { date: new Date(new Date(`${item.dueAt?.slice(0, 10)}T12:00:00`).getTime() + 86_400_000).toISOString().slice(0, 10) },
        extendedProperties: { private: { studyflowTaskId: item.id } },
      } : {
        summary: item.title,
        description: "Study block from StudyFlow.",
        start: { dateTime: item.startAt, timeZone: item.timezone ?? "Asia/Karachi" },
        end: { dateTime: item.endAt, timeZone: item.timezone ?? "Asia/Karachi" },
        extendedProperties: { private: { studyflowBlockId: item.id } },
      };
      let response;
      if (mapping) {
        try {
          response = await calendar.events.update({ calendarId: connection.study_calendar_id!, eventId: mapping.google_event_id, requestBody: event });
        } catch (error) {
          if (typeof error !== "object" || error === null || !("code" in error) || error.code !== 404) throw error;
          response = await calendar.events.insert({ calendarId: connection.study_calendar_id!, requestBody: event });
        }
      } else {
        const privateId = item.kind === "task" ? `studyflowTaskId=${item.id}` : `studyflowBlockId=${item.id}`;
        const found = await calendar.events.list({
          calendarId: connection.study_calendar_id!,
          privateExtendedProperty: [privateId],
          maxResults: 1,
        });
        const existingEvent = found.data.items?.[0];
        response = existingEvent?.id
          ? await calendar.events.update({ calendarId: connection.study_calendar_id!, eventId: existingEvent.id, requestBody: event })
          : await calendar.events.insert({ calendarId: connection.study_calendar_id!, requestBody: event });
      }
      if (!response.data.id) throw new Error(`Google Calendar did not return an event ID for "${item.title}".`);
      const { error } = await admin.from("calendar_sync").upsert({
        user_id: user.id, task_id: item.kind === "task" ? item.id : null,
        schedule_block_id: item.kind === "block" ? item.id : null,
        google_event_id: response.data.id, calendar_id: connection.study_calendar_id,
        sync_status: "synced", last_error: null, updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,calendar_id,google_event_id" });
      if (error) throw new Error(`Calendar event was written but its mapping could not be saved: ${error.message}`);
      written += 1;
    };

    for (const task of tasksResult.data ?? []) {
      await writeEvent({ kind: "task", id: task.id, title: task.title, description: task.description, dueAt: task.due_at });
    }
    for (const block of blocksResult.data ?? []) {
      await writeEvent({ kind: "block", id: block.id, title: block.title, startAt: block.start_at, endAt: block.end_at, timezone: block.timezone });
    }
    return NextResponse.json({ synced: written, removed, message: "Approved tasks and saved study blocks are synchronized." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Calendar synchronization failed." }, { status: 502 });
  }
}
