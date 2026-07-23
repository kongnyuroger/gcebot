# Admin Portal — Developer Documentation

This documents everything built on the `feature/admin-portal` branch: a Next.js
admin web app (`apps/admin`) plus the admin-only NestJS endpoints it consumes
(`apps/api/src/admin`). It's a deeper companion to the "Admin portal" section
in the root [README.md](README.md), meant for whoever picks up this branch's
code next.

## Contents

- [Why it exists](#why-it-exists)
- [Architecture](#architecture)
- [Data model](#data-model)
- [Auth model](#auth-model)
- [Features](#features)
- [Module wiring notes](#module-wiring-notes)
- [Known limitations / follow-ups](#known-limitations--follow-ups)
- [Bugs found and fixed during development](#bugs-found-and-fixed-during-development)
- [Testing](#testing)
- [Local dev troubleshooting](#local-dev-troubleshooting)
- [Branch history](#branch-history)

## Why it exists

Staff need to upload textbooks/syllabuses/past papers, manage user tiers,
monitor usage, and broadcast announcements — without touching the database or
the bot's internal APIs directly. Document upload was the priority ("the key
feature") since content ingestion previously required a manual script.

## Architecture

```
apps/admin/                      # Next.js 14, App Router
├── src/app/
│   ├── login/                   # Two-step credentials + TOTP login
│   └── admin/
│       ├── documents/           # Upload UI + ingestion queue table
│       ├── users/               # User list + detail drawer + tier editor
│       ├── analytics/           # Dashboard (recharts)
│       └── broadcast/           # Composer + history
├── src/components/              # Feature components + shadcn-style ui/ primitives
├── src/lib/                     # api-client, typed DTOs mirroring the API's shapes
└── src/middleware.ts            # next-auth route protection

apps/api/src/admin/               # All admin-only backend code
├── auth/                         # AdminAuthService, AdminJwtGuard, AdminRoleGuard, Roles()
├── controllers/                  # documents, users, analytics, broadcast
├── services/                     # admin-users, analytics, broadcast
├── processors/                   # broadcast.processor (Bull consumer)
└── queues/                       # broadcast.queue (queue/job name + payload type)
```

The admin app is a **separate origin** from the student-facing API (different
port, different auth mechanism — NextAuth session vs. WhatsApp phone number).
It talks to the API over plain HTTP via `apps/admin/src/lib/api-client.ts`,
attaching a bearer token read from the NextAuth session
(`apps/admin/src/lib/use-api-client.ts` for Client Components,
`getServerSession()` directly for Server Components).

## Data model

Two new models, added in migrations `20260720164627_add_admin_users` and
`20260721122314_add_broadcasts`:

```prisma
enum AdminRole { SUPER_ADMIN  CONTENT_MANAGER  VIEWER }

model AdminUser {
  id           String    @id @default(cuid())
  email        String    @unique
  passwordHash String
  totpSecret   String?   // null = 2FA not configured; login() refuses to issue
                         // even a tempToken in that case (never a password-only session)
  role         AdminRole
  createdAt    DateTime  @default(now())
  lastLoginAt  DateTime?
}

enum BroadcastTarget { ALL  TIER  SUBJECT  LEVEL }
enum BroadcastStatus { SCHEDULED  PROCESSING  COMPLETE  FAILED }

model Broadcast {
  id              String          @id @default(cuid())
  message         String
  target          BroadcastTarget
  targetValue     String?         // e.g. "PREMIUM" / "Biology" / "O_LEVEL"; null for ALL
  scheduleAt      DateTime?
  status          BroadcastStatus @default(SCHEDULED)
  totalRecipients Int             @default(0)
  sentCount       Int             @default(0)
  failedCount     Int             @default(0)
  createdBy       String
  createdAt       DateTime        @default(now())
  completedAt     DateTime?
}
```

> **Prisma + pgvector gotcha:** every `prisma migrate dev --create-only` run
> against this schema generates a spurious
> `DROP INDEX "embedding_chunks_embedding_idx"` line, because Prisma can't see
> indexes on the `Unsupported("vector(n)")` column. Always inspect generated
> migration SQL and strip that line by hand before applying. Also,
> `prisma migrate dev` (without `--create-only`) hangs waiting on interactive
> stdin in sandboxed environments — use `prisma migrate deploy` to apply a
> pre-generated, cleaned migration non-interactively.

## Auth model

Two-step login — a single password isn't enough for an account that can
upload content or message every user:

1. `POST /admin/auth/login` `{ email, password }` → on success, returns
   `{ requiresTotp: true, tempToken }`. `tempToken` expires in 5 minutes and
   carries only a `{ adminId, purpose: 'totp' }` claim — it cannot be used as
   a session token even if leaked, and `AdminJwtGuard` explicitly rejects any
   token whose `purpose` is `'totp'`.
2. `POST /admin/auth/verify-totp` `{ tempToken, code }` → verifies the 6-digit
   TOTP code (±1 step / 30s clock-drift tolerance) against the admin's stored
   `totpSecret`, then returns a real 4h session JWT.

On the frontend, this is **one Credentials provider in NextAuth whose
`authorize()` only ever handles the second half** (`{ tempToken, code }`). The
first half (email + password → tempToken) is a plain unauthenticated `fetch()`
the login page makes directly to the API before `signIn()` is ever called —
there's no session to create until TOTP is verified.

**Guards, in order:** `@UseGuards(AdminJwtGuard, AdminRoleGuard)`.
`AdminJwtGuard` validates the session JWT and populates `request.admin`;
`AdminRoleGuard` (paired with `@Roles(AdminRole.X, ...)`) must run *after* it,
since it reads `request.admin.role`. No `@Roles()` at all means any
authenticated admin (including `VIEWER`) may proceed.

**Creating the first admin:** `prisma/seed-admin.ts`, run via
`ADMIN_SEED_EMAIL=... ADMIN_SEED_PASSWORD=... npm run db:seed:admin` (password
≥ 12 chars). It's deliberately kept out of the normal `db:seed` — creating a
real admin with a real password shouldn't happen automatically alongside
throwaway dev fixtures. It always creates a `SUPER_ADMIN` and prints both an
`otpauth://` URL (scan as a QR code) and the raw base32 secret (for manual
entry) — manual entry is error-prone since base32 secrets mix visually
similar characters (`2`/`Z`, `I`/`1`, `O`/`0`, `S`/`5`); prefer scanning a QR
code generated from the URL if your terminal can't render one directly.

## Features

### Document upload — `/admin/documents`

The priority feature. Dropzone (PDF-only, multi-file) → shared metadata form
(level, subject, doc type, shared year) with **per-file year override** (so
one batch can cover several years of the same subject/past-paper series) →
upload with a real progress bar per file (`XMLHttpRequest.upload.onprogress`
— `fetch()` has no upload-progress event, see `lib/upload-with-progress.ts`)
→ ingestion queue table, polling for status.

| Endpoint | Access | Notes |
|---|---|---|
| `POST /admin/documents/ingest` | `CONTENT_MANAGER`, `SUPER_ADMIN` | Multipart upload; validates real magic bytes (`%PDF-`), not just the client-supplied mimetype (trivially spoofable); 50MB limit via `MaxFileSizeValidator` |
| `GET /admin/documents` | any admin | Paginated, filterable by status/subject |
| `GET /admin/documents/:id` | any admin | |
| `POST /admin/documents/:id/retry` | `CONTENT_MANAGER`, `SUPER_ADMIN` | |
| `DELETE /admin/documents/:id` | `CONTENT_MANAGER`, `SUPER_ADMIN` | |

Ingestion re-uses the RAG pipeline documented in the root README's
"Architecture notes" (`IngestionProcessor`: PDF extraction → chunking →
embeddings → pgvector storage) — uploading here is equivalent to running that
pipeline directly.

### User management — `/admin/users`

Paginated/searchable (by phone)/filterable (by tier) user list → detail
drawer (subjects, streak, subscription, per-topic accuracy, recent
interactions) → inline tier editor, **`SUPER_ADMIN` only**.

| Endpoint | Access |
|---|---|
| `GET /admin/users` | any admin |
| `GET /admin/users/:phone` | any admin |
| `PATCH /admin/users/:phone/tier` | `SUPER_ADMIN` only |

Phone numbers are masked in the UI (`maskPhone()` — keeps country code + last
2 digits, e.g. `2376******34`) except when searching, which goes straight to
the backend on the unmasked value.

### Analytics dashboard — `/admin/analytics`

`GET /admin/analytics?from=&to=` (any admin) returns one payload scoped
consistently to `[from, to]`: DAU + messages-per-day time series, total
messages, new/active users, revenue, questions-per-subject, a conversion
funnel (registered → activated → paying, all in the *same* cohort window),
and top topics.

> **Known limitation:** only `PracticeModeHandler` and `MilestoneService`
> currently persist `Interaction` rows — QA-mode questions and individual
> mock-exam questions are never logged as interactions. Every metric derived
> from the `Interaction` table (`dau`, `messagesPerDay`, `totalMessages`,
> `questionsPerSubject`, `topTopics`) therefore **undercounts** real usage
> until that logging gap is closed in a later branch. This is documented
> in-code (`analytics.service.ts`) — it's the best available real signal
> today, not a synthetic one invented for the dashboard.

Charts use `recharts` with `isAnimationActive={false}` (see
[Bugs found and fixed](#bugs-found-and-fixed-during-development)) and a
single-hue sequential palette for magnitude comparisons, an ordinal ramp for
the funnel — built following the project's `dataviz` skill methodology.

### Broadcast messaging — `/admin/broadcast`

Compose a message → pick a target (All / Tier / Subject / Level) → live
recipient estimate → optional schedule → confirmation modal → send. Sending
and viewing history both live on the same page; sending is gated to
`CONTENT_MANAGER`/`SUPER_ADMIN`, viewing is open to any admin.

| Endpoint | Access |
|---|---|
| `POST /admin/broadcast` | `CONTENT_MANAGER`, `SUPER_ADMIN` |
| `GET /admin/broadcast/history?page=` | any admin |
| `GET /admin/broadcast/estimate?target=&targetValue=` | any admin |

Mechanics:

- Creating a broadcast enqueues a Bull job (`BROADCAST_QUEUE_NAME`) carrying
  only `{ broadcastId }` — the processor re-reads the message/target from the
  DB row at send time rather than freezing them into the job payload. This
  matters for **scheduled** broadcasts: a user's tier/subjects can change
  between scheduling and send time, and re-reading the row means the send
  always reflects who currently matches, not who matched when it was
  scheduled.
- `BroadcastService.buildTargetWhere()` is the single, shared source of truth
  for "which users match this target" — it's `public` (not `private`)
  specifically so `BroadcastProcessor` (which lives in a different module,
  see below) can reuse it instead of duplicating the filter logic.
- Sends run in batches of 50, 100ms apart, via `WhatsappSendService`, and
  update `Broadcast.sentCount` / `failedCount` / `status` / `completedAt`
  when done.
- **Production gap:** broadcasts currently call `sendText()` — a plain text
  message. WhatsApp requires an approved message template for
  business-initiated messages outside the 24h customer-service window. This
  must be swapped for a registered template before broadcasts can actually
  deliver at scale in production (same requirement already noted against
  `WeeklyReportService`).

## Module wiring notes

`BroadcastProcessor` needs `WhatsappSendService`, which only exists in
`WhatsappModule` — but `BroadcastService` (and `buildTargetWhere()`) live in
`AdminModule`. The dependency direction matters:

- `WhatsappModule` importing `AdminModule` is **safe** (one-way): `AdminModule`
  and everything it imports (`JwtModule`, `RagModule` → `SessionModule`/
  `UsersModule`) never import `WhatsappModule` back.
- This is the *opposite* situation from `MockExamTimerProcessor` /
  `WeeklyReportService` / `MilestoneService`, which must live directly in
  `WhatsappModule`'s own `providers` array instead — importing *their* home
  modules into `WhatsappModule` would be circular, since `WhatsappModule`
  already imports those modules for other reasons.

So: `AdminModule` exports `BroadcastService`; `WhatsappModule` imports
`AdminModule` and lists `BroadcastProcessor` in its own `providers`. The Bull
queue itself is registered in **both** modules
(`BullModule.registerQueue({ name: BROADCAST_QUEUE_NAME })`) — producer side
in `AdminModule`, consumer side in `WhatsappModule` — since they share one
underlying Redis connection configured once via `BullModule.forRootAsync()`
in `RagModule`. This dual-registration pattern mirrors the existing
`MOCK_EXAM_TIMER_QUEUE_NAME` setup. Verified with a direct
`NestFactory.createApplicationContext(AppModule)` boot-check — no
circular-dependency errors.

## Known limitations / follow-ups

- **Broadcast sends need a WhatsApp message template** before they'll work
  outside the 24h customer service window (see above).
- **Analytics undercounts usage** until QA-mode and mock-exam questions are
  also logged as `Interaction` rows (see above).
- **File storage is still local disk**, not Cloudflare R2 as the README's
  stack table implies — R2 integration hasn't been implemented yet.
- **No dark-mode chart palette.** The shadcn `.dark` CSS class exists but
  nothing in the app ever applies it (no theme toggle wired up anywhere), so
  a dark-mode-specific chart palette was deliberately skipped as dead code.
- **Step 8 test coverage is representative, not exhaustive** — it covers
  auth, document validation, and analytics aggregation on the backend, and
  upload-form validation on the frontend, but not every controller/component
  in the portal.

## Bugs found and fixed during development

All of these were caught by *live* verification (real Postgres/Redis, real
browser via Playwright) — never by typecheck/lint/build/unit-tests alone,
which all passed cleanly in every case below:

- **No CORS on the API.** Browser fetches from the admin app (port 3001) to
  the API (port 3000-ish) were silently blocked; Node-`fetch()`-based scripts
  never caught it since Node isn't subject to browser CORS. Fixed with
  `app.enableCors({ origin: ADMIN_PORTAL_URL })` + a new validated
  `ADMIN_PORTAL_URL` env var.
- **`next-auth/middleware`'s `withAuth()` ignores `authOptions.pages.signIn`.**
  It runs in the Edge runtime, separate from the Node runtime serving the
  NextAuth API route, and silently fell back to the default
  `/api/auth/signin` page. Fixed with an explicit
  `withAuth({ pages: { signIn: '/login' } })`.
- **Bare-date UTC-midnight parsing in analytics.** `new Date("YYYY-MM-DD")`
  parses as midnight UTC, so a bare-date `to` in `createdAt <= to` silently
  excluded that entire day's activity. Fixed with an `endOfDayIfBareDate()`
  helper plus having the frontend send precise ISO timestamps for preset
  ranges.
- **Recharts mount-animation stuck at its invisible initial frame.** Real
  data, permanently blank chart — confirmed via direct SVG DOM inspection
  (`stroke-dasharray="0px 1016px"`, empty `<g class="recharts-inactive-bar">`
  groups). Fixed with `isAnimationActive={false}` on `<Line>`/`<Bar>` —
  treated as a genuine reliability fix, not a test-only workaround.
- **`.next` build/dev directory collision.** Running `next build` while
  `next dev` was still live on the same `.next` directory corrupted it,
  causing chunk 404s → 500s. Fix: always stop the dev server before running a
  production build check, `rm -rf .next` if it happens anyway.

## Testing

Backend (`apps/api`, Jest, plain `jest.fn()` mocks — no
`Test.createTestingModule`, matching this codebase's existing convention):

- `admin/auth/admin-auth.service.spec.ts` — login + TOTP verification
- `admin/auth/admin-jwt.guard.spec.ts`, `admin/auth/admin-role.guard.spec.ts`
- `admin/controllers/documents.controller.spec.ts` — valid PDF, spoofed
  mimetype, missing/invalid metadata, the `MaxFileSizeValidator` boundary
  (its real semantics are strict `<`, not `<=`)
- `admin/services/analytics.service.spec.ts` — day-range zero-filling,
  revenue null-handling, groupBy mapping, conversion-funnel cohort scoping

Frontend (`apps/admin`) — **Jest + React Testing Library set up from scratch**
for this branch (no prior frontend test infra existed in the monorepo):
`jest.config.js` (via `next/jest`), `jest.setup.ts`
(`@testing-library/jest-dom`), and
`components/documents/document-upload-form.test.tsx` covering the upload
button's enablement rules, non-PDF rejection, level-change resetting the
subject, and a full submit-flow assertion on the resulting `FormData`.

Run everything: `npm run test` from the repo root (Turborepo fans it out to
both `api` and `admin`), or scope to one workspace with `--workspace=`.

## Local dev troubleshooting

Real issues hit while setting this up locally — worth checking first before
assuming something's actually broken:

- **"Could not reach the server" on login.** The login page's error handling
  collapses "server not running", "CORS blocked", and "wrong port" into one
  generic message. Check, in order: is the API process actually running
  (`ss -tlnp | grep <port>`)? Does `apps/admin/.env.local`'s
  `NEXT_PUBLIC_API_URL` match the port the API is *actually* listening on
  (check `PORT` in the root `.env` — it may not be `3000` if you're also
  tunneling it for WhatsApp webhook testing, e.g. `8081` via ngrok)? Is
  `ADMIN_PORTAL_URL` in the API's `.env` set to wherever the admin app
  actually runs?
- **The API's `.env` lives at the repo root**, not `apps/api/.env` — see
  `envFilePath: join(__dirname, '../../../.env')` in `apps/api/src/app.module.ts`.
- **"Invalid authentication code" on TOTP.** Before suspecting a real bug,
  rule out simple code expiry: TOTP codes are valid for ~30–90s
  (30s step × ±1 step drift tolerance). If you're relaying a code through any
  kind of intermediary (chat, a teammate, copy-paste across devices with
  delay), it's very likely just expired by the time it's submitted — test by
  generating a code the moment you're about to submit it, ideally straight
  off a real authenticator app enrolled via the `otpauth://` QR code, not by
  hand-typing the base32 secret (which mixes visually similar characters:
  `2`/`Z`, `I`/`1`, `O`/`0`, `S`/`5`).

## Branch history

Commits on `feature/admin-portal` (off `dev`), in order:

1. `feat(admin): add admin auth (jwt+totp) and document ingestion api endpoints`
2. `feat(admin): init nextjs admin app with nextauth and app shell`
3. `feat(admin): add document upload and ingestion queue ui`
4. `feat(admin): add user management ui and endpoints`
5. `feat(admin): add analytics dashboard`
6. `feat(admin): add broadcast messaging ui and endpoints`
7. `test(admin): add backend and frontend test coverage`
