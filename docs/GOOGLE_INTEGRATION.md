# Google integration implementation notes

## Classroom endpoints

Use the signed-in user's OAuth client:
- List courses: `classroom.courses.list`
- List announcements: `classroom.courses.announcements.list`
- List coursework: `classroom.courses.courseWork.list`
- List course materials if needed: `classroom.courses.courseWorkMaterials.list`

The authenticated `/api/google/sync` route and Vercel cron use bounded page sizes. Course, announcement, and coursework records are upserted by provider/external identity with source hashes and update times. CourseWork creates pending-review tasks only once; sync refreshes source content without resetting a user's task status, notes, or completion.

## Gmail strategy

The importer uses a 30-day Gmail query for Classroom sender/subject patterns and caps results at 20 messages. It stores bounded plain text/snippets, filters obvious coursework duplicates against Classroom titles, and uses Gmail message ID as the provider external ID. Gmail's OAuth read scope is still broad; explain that permission and obtain consent before connecting. Message-format variability means verify the importer with the student's actual notification patterns.

## Calendar strategy

The user can select a writable calendar or create `StudyFlow Study Planner` (the dedicated `calendar.app.created` permission is requested for app-created calendars). The explicit Calendar sync action writes all-day events for approved, dated tasks and timed events for saved study blocks. It persists event mappings and uses private StudyFlow item IDs to recover safely if an event was written but a mapping save failed. It only deletes a previously synced event after the user dismisses/deletes its task and explicitly runs calendar sync. It does not import class timetable events or perform conflict checking in this milestone.

## OAuth token vault

The current implementation:
1. Requires a signed-in Supabase user before starting OAuth.
2. Binds the state to that user with an HMAC and a 10-minute HttpOnly, SameSite=Lax cookie.
3. Exchanges the code server-side and verifies the Google ID token.
4. Encrypts refresh tokens with AES-256-GCM using `GOOGLE_TOKEN_ENCRYPTION_KEY`.
5. Stores ciphertext and key version in a server-only `google_connections` table; no browser read policy is granted.
6. Refreshes access tokens server-side and supports disconnect/revocation.

Rotate the encryption key only with a migration that decrypts/re-encrypts every stored token. A lost key requires users to reconnect. Never expose the service-role key or encryption key.

## Scheduled sync

The cron route authenticates with `CRON_SECRET`, loads at most 20 connected accounts, and runs bounded syncs concurrently. A five-minute database lease prevents overlapping syncs for one user. Each run stores status/counts and a sanitized error summary. Provider failures are surfaced per run; transient exponential retries are not implemented, so the next scheduled/manual sync is the retry mechanism.

Apply the base schema to a new project, or apply both dated migrations after the original schema before connecting Google. The configured 30-minute schedule is subject to the selected Vercel plan.
