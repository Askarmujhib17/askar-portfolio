# AP Survey on Cloudflare Pages

The portfolio remains at `/`; the survey is served at `/ap-survey/`.
Vite copies `public/ap-survey/` into `dist/ap-survey/`. Cloudflare Pages builds
`functions/api/ap-survey/[[path]].js` separately. No credentials belong in Git.

## Before merging

1. In the existing Supabase project's SQL Editor, run
   `supabase/migrations/20261013_ap_survey_login_limits.sql`.
   This adds a private attempt counter and a server-only RPC. Without it,
   PIN login fails closed with a setup message.
2. The already-created `public.ap_survey_entries` table needs these columns:
   `id`, `building`, `floor`, `room`, `category`, `network_type`, `old_ap_model`,
   `old_ap_hostname`, `old_ap_serial`, `old_ap_mac`, `lan_room`,
   `relocation_required`, `relocation_reason`, `photo_path`, `created_at`,
   `updated_at`. Keep RLS enabled, no anon/authenticated access, and service_role
   CRUD grants. The existing update trigger supplies concurrency versions.
3. Keep `ap-survey-photos` private. Do not add public storage policies.
4. Cloudflare Pages → project → Settings → Variables and Secrets → Production:

   | Name | Type |
   | --- | --- |
   | `SUPABASE_URL` | Text; HTTPS Project URL |
   | `SUPABASE_SECRET_KEY` | Secret; Supabase `sb_secret_…` key |
   | `AP_SURVEY_PIN` | Secret; exactly six digits |
   | `AP_SURVEY_SESSION_SECRET` | Secret; random string of at least 32 characters |

   Keep existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
   Never prefix server secrets with `VITE_`.
5. Keep the existing Pages build command (`npm run build`), output (`dist`), and
   repository root. Merge the PR to trigger the existing Git deployment.
   Preview deployments require their own variable configuration. For testing,
   use a separate Supabase test project rather than granting preview branches
   access to production records.

## Verify after deployment

- Open `https://askarmujhib.com/ap-survey/` and enter the PIN.
- Save a test room with relocation No. On a second device, unlock and confirm it appears.
- Edit, filter by category/LAN room, and verify the bottom count.
- Save relocation Yes, a free-text reason and a wide-angle photo. Verify download
  from the second device, then remove the test records.
- After opening online once, disconnect and capture a draft. Reconnect: the
  unsynced count should return to zero, and the record should appear elsewhere.
- Unauthenticated `/api/ap-survey/entries` must return HTTP 401, not records.

## How data and access work

A shared PIN provides access to the entire register. Cookies are Secure,
HttpOnly and SameSite=Strict and expire after seven days. Changing either the PIN
or session secret invalidates existing sessions. PIN comparisons use keyed
hashes; the configured PIN is stored as a Cloudflare encrypted secret, not in
browser code or in the database. Login attempts are limited atomically in
Supabase: 10 per IP and 200 globally per 15-minute window. IP addresses are stored
only as keyed hashes. The global cap can temporarily prevent legitimate login
under attack; adjust the SQL limits if required.

The backend uses a Supabase server secret. Browser requests never receive it.
Photos are downloaded through authenticated API endpoints, not public URLs.
Survey/photo API responses aren't cached by the service worker. Old photos are
retained when replaced/deleted to avoid breaking concurrent requests. They consume
storage: periodically review and remove unreferenced objects through the Storage
API/dashboard, after taking a backup. Do not delete files referenced by
`ap_survey_entries.photo_path`.

The page shell is cached for offline reopening after the first successful online
visit. Drafts and photos awaiting upload persist in IndexedDB on that device.
The form resets only after the local draft has been stored. Sync runs on save,
login, reconnection and every 30 seconds while the page is open; it is not a
background guarantee after closing the browser. Entries without pending edits are
cached locally for offline viewing. Previously uploaded photos require a network
connection. Offline drafts are not yet available on other devices. Browser data
clearing loses unsynced drafts. Locking the app protects server access but does
not encrypt the device's cache; use the device lock for local protection.

Updates/deletes use the last server timestamp to reject stale edits. A conflict
keeps the draft; download a backup before discarding an unsynced change to reload
the server version. A backup captures records/photos and lists pending changes.
Import adds valid missing entries and skips existing IDs; it does not replay
pending deletions or overwrite existing server records.

To migrate prototype records: fill required LAN room/relocation fields in the
original prototype, download its JSON backup, then import on the new app. The
old browser-only prototype is a different origin, so its records are not moved
automatically. Imported records sync after PIN login.

## Local checks

```sh
npm ci
node --test tests/ap-survey*.test.js
npm run build
```

`npm run dev` serves the portfolio/static survey, not Pages Functions. To test
full-stack locally, use `npx wrangler pages dev dist` with server variables in an
ignored `.dev.vars` and a test Supabase project. Browser DOM/device testing and
live Supabase verification are still needed after configuration; the automated
tests use mocked storage and database responses.

## October survey improvements

Before deploying the cabling update, run
`supabase/migrations/20261014_ap_survey_new_cabling.sql` in SQL Editor. It is
safe to rerun and adds `new_cabling` with Yes / No / Not assessed choices.
Existing records default to Not assessed. The API returns an empty cabling
answer when relocation is No, and saves null for that case. Older drafts and
backups are normalized; requests from older clients preserve a previously
recorded cabling answer.

Network type now accepts MOE-Owned, School-Owned and Unknown. MOE-Owned remains
the form default. The featured AP Survey card links directly to `/ap-survey/`
and is visible independently of the portfolio project-list database request.

Save feedback distinguishes a durable local draft from server acknowledgement:
Saved on device / Syncing / Synced ✓ / Sync failed. It appears on both entry and
list views; saved rows also show their sync state. New entries still upload
immediately, including entries captured while a previous sync is finishing.
No batching, timestamp stamping, or school-specific PINs were added.

## Combined TR and expansion survey

Before deployment, run `supabase/migrations/20261014_ap_survey_expansion.sql`.
It adds nullable `additional_ap_required`, nullable `expansion_cabling`, and
`remarks` (empty by default). Existing records remain expansion-not-recorded;
no AP or cable quantity is inferred. Old clients preserve recorded expansion
and remarks when they omit these fields.

New Classrooms entries default to expansion Yes, with an editable No exception.
Other new categories default to No. Explicit user choices and existing records
are preserved when the category changes. Both jobs use one location section,
one LAN/server room, and a single shared image. A photo is required whenever
relocation or expansion is Yes. The image is optional otherwise and retained
when jobs are switched off, so it is not lost by changing an answer.

Relocation and expansion have separate Yes / No / Not assessed cabling answers.
The review page shows filtered and full-register totals. Each Yes means one
new cable run, and one room can count twice. Pending cabling assessments and
expansion-not-recorded rooms are shown separately. Totals include local unsynced
entries, so confirm sync state before treating them as the final shared survey.
Remarks apply to the whole room, are optional, and are included in editing,
CSV and JSON backups. Expansion filtering is available alongside category,
LAN/server-room and text filters. No additional image copy is uploaded for
expansion, and summary calculations run locally.
