# Askar Mujhib — Portfolio

Personal portfolio for my work in infrastructure and networking, alongside the applications I build to support it.

**Website:** [askarmujhib.com](https://askarmujhib.com)

## About the project

I built this site to bring my experience, projects and practical tools into one place. It includes sections for my background, experience, featured projects and contact links. Published project details are loaded from Supabase.

The site is built with React and Vite, styled with Tailwind CSS, and deployed to Cloudflare Pages through GitHub.

## AP Survey

[AP Survey](https://askarmujhib.com/ap-survey/) is a tool I developed for recording wireless access point details during school site surveys. It replaces repeated manual entry and keeps survey records available across devices.

The app supports:

- Building, floor, room and category details.
- Existing AP model, hostname, serial number and MAC address.
- LAN or server room selection and network ownership.
- Multiple TR and expansion AP jobs under one location, without repeating room details.
- CSV AP-inventory import and hostname lookup to fill model, serial and MAC.
- Per-AP cabling, access equipment and L-bracket requirements, with quantity totals.
- One optional wide-angle photo and optional remarks per location.
- School workspaces for Primary (Alcatel) and Secondary (Cisco) AP surveys.
- Building and LAN room filters, record editing and photo downloads.
- CSV export, JSON backups and browser print-to-PDF.
- Local offline drafts, with syncing when the selected school is open and connectivity returns.

Access uses a six-digit PIN checked by Cloudflare Pages Functions. Survey records are stored in Supabase, with photos in a private storage bucket. The app distinguishes between records saved on the device and records confirmed by the server.

See [AP_SURVEY_SETUP.md](AP_SURVEY_SETUP.md) for database migrations, deployment settings and operational notes.

## Technology

| Component | Technology |
| --- | --- |
| Portfolio interface | React |
| Build tooling | Vite |
| Styling | Tailwind CSS |
| Icons | Lucide React and React Icons |
| Hosting and survey API | Cloudflare Pages and Pages Functions |
| Database and photo storage | Supabase |
| Offline drafts | IndexedDB |
| Offline survey page | Service worker |

## Local development

Use Node.js 22 or later.

```sh
git clone https://github.com/Askarmujhib17/askar-portfolio.git
cd askar-portfolio
npm ci
```

Create `.env.local` in the repository root:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

These settings connect the portfolio to the Supabase project list. They are browser-facing values; do not put a Supabase secret key in either variable.

Start the development server:

```sh
npm run dev
```

Build the site:

```sh
npm run build
```

The build output is written to `dist/`. Vite's development server does not run the survey's Pages Functions. Follow the survey setup guide for full-stack local testing.

## Checks

Run the survey tests:

```sh
node --test tests/ap-survey*.test.js
```

The tests cover PIN sessions, validation, photo handling, conflicting edits, offline drafts and sync feedback. They use mocked database and browser responses; live cross-device testing is performed separately.

## Deployment

Changes merged into `main` are deployed through the existing Cloudflare Pages Git integration.

The portfolio uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at build time. The survey backend uses separate runtime settings:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `AP_SURVEY_PIN`
- `AP_SURVEY_SESSION_SECRET`

Store private values in Cloudflare's secret settings. Database migrations are applied in Supabase before deploying changes that depend on them.

## Repository layout

```text
src/                  Portfolio components and styles
public/ap-survey/     Survey interface and offline support
functions/            Cloudflare Pages API routes
server/               Survey backend logic
supabase/migrations/  Database changes
tests/                Survey API and client tests
```
