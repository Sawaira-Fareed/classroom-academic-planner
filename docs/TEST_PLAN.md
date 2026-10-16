# Test plan

## Local smoke tests
- [ ] `npm install` succeeds.
- [ ] `npm run dev` starts the app.
- [ ] `/` loads at desktop and mobile widths without horizontal overflow.
- [ ] Dashboard, Calendar, Courses, Tasks, Announcements, Study Planner, Progress, and Settings navigation works.
- [ ] Add/edit task, mark complete, search, filter by course, and delete task work.
- [ ] Add/edit/archive/restore/delete a custom course; linked tasks survive course deletion with no course assigned.
- [ ] A task can be linked to a custom course and remains linked after refresh.
- [ ] Tasks, study blocks, and theme preference survive a browser refresh in local-device mode.
- [ ] Light and dark themes retain the colored glass visual identity.
- [ ] Classroom remains visibly disconnected until OAuth successfully stores an encrypted connection.
- [ ] Task dialog controls remain reachable on short/mobile viewports.
- [ ] `/api/health` returns configuration-presence status without secrets.
- [ ] `/api/cron/sync` without authorization returns HTTP 401.
- [ ] `/api/cron/sync` with a configured correct secret runs bounded connected-account sync and records per-account results.
- [ ] Dot Buddy does not claim to be AI-connected or change a study block when AI or Supabase is unavailable.
- [ ] `/api/ai/chat` rejects malformed/oversized input and signed-out requests.
- [ ] Authenticated Dot Buddy responses use only the current user's bounded planner context; suggestions never mutate planner data.
- [ ] AI rate limit rejects the 21st request in a minute for a user and allows a new minute window.
- [ ] Cloud study blocks survive refresh and are isolated by user.
- [ ] Progress history records one Asia/Karachi snapshot per day and excludes pending-review suggestions.

## Supabase security
- [ ] Apply `supabase/schema.sql` to a new database or both dated migrations to an existing original-schema database.
- [ ] Anonymous users cannot read user records.
- [ ] User A cannot read or modify User B's courses/tasks/schedule blocks.
- [ ] Updates and deletes affecting zero rows are reported as failures, not local success.
- [ ] Browser cannot query token vault records.
- [ ] Service role key is absent from browser bundles and Git history.

## Google OAuth
- [ ] OAuth state cookie is set and validated.
- [ ] Callback rejects missing, mismatched, or expired state.
- [ ] Tokens never appear in response bodies or logs.
- [ ] Refresh token is AES-256-GCM encrypted before persistence and never returned to the browser.
- [ ] Disconnect revokes grant and deletes token material.

## Import pipeline
- [ ] Duplicate source ID does not create duplicate source/task.
- [ ] Edited announcement updates source content without overwriting user notes/completion.
- [ ] Missing or ambiguous deadline produces `due_at = null` and `pending_review`.
- [ ] Source URL and source quote are preserved.
- [ ] Gmail and Classroom versions of the same assignment deduplicate.
- [ ] API failure creates sanitized sync log and does not corrupt prior data.
- [ ] Imported coursework stays pending review; repeated sync preserves task notes/status/completion.
- [ ] AI extraction requires exact evidence, validates model output, and creates pending-review tasks.

## Calendar
- [ ] No event is created before approval.
- [ ] Re-running sync updates existing event instead of creating a duplicate.
- [ ] Existing lectures are not overwritten.
- [ ] All timestamps display in Asia/Karachi.
- [ ] Failed calendar write can be retried safely.
