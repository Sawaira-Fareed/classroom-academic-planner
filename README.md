# StudyFlow · Classroom Academic Planner

A personal academic planner built with Next.js App Router, TypeScript, Supabase, Google OAuth, Classroom, Gmail, Calendar, and Vercel Cron.

## Implemented

- Celestial glass dashboard with squared panel edges and dark Starlight/light Moonlight gradients in midnight rose, muted violet, sea-glass, and emerald
- Interactive Dashboard, Calendar, Courses, Tasks, Announcements, Study Planner, Progress, and Settings views
- Task create, edit, complete, delete, search, course filtering, and deadline sorting
- Dynamic course create, edit, archive, restore, and delete; linked tasks are retained if a course is removed
- Browser-local persistence as an explicitly disclosed fallback, plus email/password Supabase auth and user-owned cloud course/task CRUD when configured
- Supabase email/password authentication, RLS-protected user-owned courses/tasks/study blocks, and daily progress history
- AES-256-GCM encrypted server-side Google refresh-token vault, signed OAuth state, status, disconnect/revocation
- Manual and scheduled Google Classroom course, announcement, coursework, and filtered Gmail notification sync
- Idempotent source and coursework imports; AI-extracted announcement/email suggestions stay in a review queue
- Dedicated Google Calendar selection/creation and idempotent writes for approved, dated tasks and saved study blocks
- Authenticated Dot Buddy chat with bounded user-owned context and a persistent per-user AI rate limit
- A browser-local fallback when Supabase is not configured

Live external integrations still require your Google Cloud project, OAuth consent configuration, API enablement, Supabase project, and deployment secrets.

### Current data and integration limits

External providers are **not verified or connected in this checkout** because the environment has no configured Supabase, Google, or AI credentials. UI status remains disconnected until a successful OAuth flow stores an encrypted token. Local mode stores courses, tasks, study blocks, and theme in this browser only. With Supabase configured, user-owned planner data and progress snapshots use the account; theme remains local.

AI extraction is optional and only runs during Google sync when configured. Imported coursework and extracted tasks require explicit approval. Sync never writes calendar events by itself. The calendar action writes only approved dated tasks and saved study blocks to the calendar the student selects or creates. Importing lecture timetable events and conflict checking are outside this milestone.

## Requirements

- Node.js 20.9+
- npm
- Supabase project
- Google Cloud project with Classroom, Gmail, and Calendar APIs enabled
- Google OAuth web client credentials
- Vercel project for hosted scheduled sync

## 1. Install

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

## 2. Configure Supabase

1. Create a Supabase project.
2. Open SQL Editor.
3. Run `supabase/schema.sql` for a new database. For a database that already has the original schema, run `supabase/migrations/20261015_dynamic_courses.sql`, followed by `supabase/migrations/20261016_google_sync.sql`.
4. Copy the project URL and anon key into `.env.local`.
5. Set the service-role key. It is used only by server routes; never prefix it with `NEXT_PUBLIC_` or expose it to the browser.
6. Enable email/password authentication in Supabase Auth and configure allowed redirect URLs for local and production use.

## 3. Configure Google OAuth

Create an OAuth 2.0 Web application client in Google Cloud Console.
- Enable the Google Classroom API.
- Enable the Gmail API.
- Enable the Google Calendar API.
- Configure the OAuth consent screen and add yourself as a test user while testing.
- Create a Web OAuth client and configure the consent screen for the requested Classroom, Gmail, and Calendar scopes. Public deployment may require Google verification.
- Add the redirect URI:
  `http://localhost:3000/api/google/callback`
- For production, add:
  `https://YOUR-VERCEL-DOMAIN/api/google/callback`

Requested scopes are intentionally conservative:
- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/classroom.courses.readonly`
- `https://www.googleapis.com/auth/classroom.announcements.readonly`
- `https://www.googleapis.com/auth/classroom.coursework.students.readonly`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/calendar.app.created`
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
- `https://www.googleapis.com/auth/calendar.events`

Review Google’s current scope classifications and verification requirements before deployment. Gmail read-only is broad mailbox access: the application queries recent Classroom-related notification email and stores bounded message text. If that access is unacceptable, remove the Gmail scope from `src/lib/google/scopes.ts` and disable Gmail sync before connecting.

## 4. Environment variables

Fill `.env.local`. Never commit it.

For Dot Buddy, set `AI_PROVIDER=openai`, `AI_PROVIDER_API_KEY`, and optionally `AI_MODEL` (defaults to `gpt-4o-mini`). Keep the provider key server-only. The AI endpoint requires a signed-in Supabase account and fails clearly when configuration is missing.

For cron protection, set a long random `CRON_SECRET`. Vercel sends it as `Authorization: Bearer <CRON_SECRET>` for protected cron jobs when configured accordingly.

Generate a fresh `GOOGLE_TOKEN_ENCRYPTION_KEY` as a base64-encoded 32-byte value:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Store it in a secret manager and Vercel environment configuration. Losing or rotating this key without re-encrypting stored tokens requires users to reconnect Google.

## 5. Deploy

1. Push this repository to a private GitHub repository.
2. Import it into Vercel.
3. Add all required environment variables in Vercel.
4. Update the production OAuth redirect URI.
5. Apply the Supabase schema and all required migrations before enabling integrations.
6. Deploy and verify `/api/health`.
7. Verify the scheduled route logs before enabling real API sync.

`vercel.json` requests a cron every 30 minutes. Confirm the selected Vercel plan supports the configured frequency.

## Security notes

- Google access and refresh tokens must only be handled server-side.
- Google refresh tokens are stored as AES-256-GCM ciphertext in the server-only `google_connections` table. Back up the encryption key securely and plan an explicit key-rotation process.
- Use Supabase RLS and authenticated server-side ownership checks.
- Dot Buddy verifies the Supabase user server-side, loads only that user's bounded planner context, keeps the provider key on the server, and enforces 20 requests per user per minute.
- The cron endpoint requires a secret.
- Gmail search is narrowed to recent Classroom-related notifications, but Gmail read-only remains broad at the OAuth permission level. Users can disconnect and revoke Google access in Settings.
- AI treats imported text as untrusted content, requires verbatim evidence for extracted suggestions, and keeps all suggestions pending review.
- Calendar writes occur only when the user explicitly starts sync; Google event IDs and private StudyFlow item IDs make retries idempotent.
- Review retention, deletion controls, Google OAuth consent verification, and RLS isolation in your own Supabase project before production use.

## Ordered implementation milestones

1. Run the dashboard and verify local course/task CRUD, refresh persistence, theme selection, and responsive navigation.
2. Configure Supabase, apply the schema or migrations, and verify authenticated CRUD and RLS isolation.
3. Configure Google Cloud OAuth and the token key; connect a test account and verify Classroom/Gmail sync and disconnect.
4. Configure an OpenAI key and verify authenticated Dot Buddy and extraction; without credentials both report unavailable and do not mutate planner data.
5. Create/select a dedicated Google calendar and verify approved-only, retry-safe event writes.
6. Configure Vercel secrets and validate the 30-minute cron on a plan that supports that frequency.
7. Run the integration/security checklist in `docs/TEST_PLAN.md` against your own Supabase and Google test accounts.

See `docs/TEST_PLAN.md` and `docs/GOOGLE_INTEGRATION.md`.
