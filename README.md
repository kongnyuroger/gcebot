# GCEBot Cameroon

A WhatsApp AI tutoring system for Cameroonian students preparing for the **GCE O-Level and A-Level** exams. Students chat with the bot directly on WhatsApp to ask questions, practice with past papers, and sit mock exams — answers are grounded via RAG over embedded textbooks, syllabuses, and 10+ years of past examination papers.

> **Further reading:** [PROJECT.md](PROJECT.md) is a deep architecture reference for the whole backend (state machine, RAG pipeline, practice/mock-exam/progress logic, payments, data model). [ADMIN_PORTAL.md](ADMIN_PORTAL.md) documents the admin web portal specifically. This README is the quick-start.

## Stack

| Layer | Technology |
|---|---|
| Backend | NestJS 10 + TypeScript (strict mode) |
| ORM / DB | Prisma + PostgreSQL with the `pgvector` extension |
| Messaging | WhatsApp Cloud API (Meta Graph API v18.0) |
| AI | OpenAI (`gpt-4o-mini` for simple queries, `gpt-4o` for complex ones) |
| Payments | MTN MoMo Collections API + Orange Money API |
| Queue | Bull (Redis-backed) |
| Cache / Session | Redis (`ioredis`) |
| Admin Portal | Next.js 14 (App Router) + NextAuth.js |
| File Storage | Cloudflare R2 |
| Hosting | Railway |

## Monorepo layout

```
gcebot/
├── apps/
│   ├── api/                 # NestJS backend
│   │   └── src/
│   │       ├── whatsapp/    # Webhook controller, signature/rate-limit guards,
│   │       │                # message parsing + routing, outbound send service
│   │       ├── handlers/    # Conversation-flow handlers (onboarding, main menu)
│   │       ├── rag/         # Ingestion (PDF -> chunks -> embeddings -> pgvector)
│   │       │                # and query engine (vector search, prompt assembly,
│   │       │                # LLM, WhatsApp formatting, response cache, QA orchestrator)
│   │       ├── session/     # Redis-backed session store + state machine validator
│   │       ├── users/       # User upsert, profile, streaks
│   │       ├── i18n/        # EN/FR message catalogs + interpolation
│   │       ├── prisma/      # PrismaService (injectable client)
│   │       └── config/      # Zod-validated environment config
│   └── admin/                 # Next.js admin portal (see "Admin portal" below)
│       └── src/
│           ├── app/admin/     # Pages: documents, users, analytics, broadcast
│           ├── components/    # Feature components + shadcn-style ui/ primitives
│           └── lib/           # api-client, typed DTOs mirroring the API's shapes
├── packages/
│   └── shared/                # Shared types/enums (ConversationState, SessionContext, etc.)
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── docker-compose.yml         # Local Postgres (pgvector) + Redis
├── turbo.json
└── package.json
```

## Prerequisites

- Node.js 20+ (see `.nvmrc`)
- Docker (for local Postgres + Redis)
- A WhatsApp Cloud API app (Meta developer account) for end-to-end testing

## Getting started

```bash
# 1. Install dependencies (also runs `prisma generate` via postinstall)
npm install

# 2. Copy env vars and fill in the real secrets
cp .env.example .env

# 3. Start local Postgres (pgvector) + Redis
docker compose up -d

# 4. Apply migrations and seed some test data
npm run db:migrate:dev
npm run db:seed

# 5. Run the API in watch mode
npm run start:dev --workspace=api
```

The API listens on `PORT` (default `3000`); the WhatsApp webhook is at `POST/GET /webhook`.

### Environment variables

All required env vars are validated with Zod at startup (`apps/api/src/config/env.validation.ts`) — the app refuses to boot if any are missing or malformed. See `.env.example` for the full list: database/Redis URLs, WhatsApp Cloud API credentials, an OpenAI API key, MTN MoMo credentials, admin-portal auth (`ADMIN_JWT_SECRET`, `ADMIN_PORTAL_URL`), and an optional Sentry DSN.

## Admin portal

A Next.js 14 (App Router) app at `apps/admin`, for staff to manage content and monitor the bot without touching the database directly. Consumes admin-only endpoints under `/admin/*` on the same NestJS API (`apps/api/src/admin`).

### Running it locally

```bash
# 1. Copy admin env vars and fill in the real secrets
cp apps/admin/.env.example apps/admin/.env.local

# 2. Create the first admin account (SUPER_ADMIN) - prints a TOTP secret/QR URL
ADMIN_SEED_EMAIL=you@example.com ADMIN_SEED_PASSWORD='a-strong-password-12+chars' \
  npm run db:seed:admin

# 3. Scan the printed otpauth:// URL into an authenticator app (Google
#    Authenticator, Authy, ...), or enter the base32 secret manually.

# 4. Run the API (port 3000) and the admin app (port 3001) in separate terminals
npm run start:dev --workspace=api
npm run dev --workspace=admin
```

Then open `http://localhost:3001/login` and sign in with the email/password from step 2, followed by the current 6-digit code from your authenticator app.

**Admin-specific env vars:**

| Var | Where | Purpose |
|---|---|---|
| `ADMIN_JWT_SECRET` | `apps/api` (`.env`) | Signs both the short-lived TOTP `tempToken` (5 min) and the 4h admin session JWT |
| `ADMIN_PORTAL_URL` | `apps/api` (`.env`) | Origin allow-listed by the API's CORS policy — must match wherever `apps/admin` actually runs |
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` | `apps/admin` (`.env.local`) | Standard NextAuth.js session config |
| `NEXT_PUBLIC_API_URL` | `apps/admin` (`.env.local`) | Base URL the admin app calls for all `/admin/*` requests |

### Auth model

Two-step login, since a single password is not enough for an account that can upload content or broadcast to every user:

1. `POST /admin/auth/login` (email + password) → if valid, returns a `tempToken` (5 min expiry, `purpose: 'totp'` claim only — cannot be used as a real session even if leaked)
2. `POST /admin/auth/verify-totp` (`tempToken` + 6-digit code) → returns a real 4h session JWT

`AdminJwtGuard` validates the session JWT on every admin route; `AdminRoleGuard` (paired with the `@Roles()` decorator) then restricts specific mutating actions to specific roles. Three roles, most-to-least privileged: `SUPER_ADMIN` → `CONTENT_MANAGER` → `VIEWER`. Routes with no `@Roles()` at all are open to any authenticated admin, including `VIEWER`.

### Features & endpoints

| Feature | Page | Key endpoints | Restricted to |
|---|---|---|---|
| Document upload | `/admin/documents` | `POST /admin/documents/ingest`, `GET /admin/documents`, `GET /admin/documents/:id`, `POST /admin/documents/:id/retry`, `DELETE /admin/documents/:id` | `CONTENT_MANAGER`, `SUPER_ADMIN` |
| User management | `/admin/users` | `GET /admin/users`, `GET /admin/users/:phone`, `PATCH /admin/users/:phone/tier` | tier edit: `SUPER_ADMIN` only; browsing: any admin |
| Analytics dashboard | `/admin/analytics` | `GET /admin/analytics` | any admin |
| Broadcast messaging | `/admin/broadcast` | `POST /admin/broadcast`, `GET /admin/broadcast/history`, `GET /admin/broadcast/estimate` | sending: `CONTENT_MANAGER`, `SUPER_ADMIN`; viewing: any admin |

Document ingestion re-uses the same Bull-queued RAG pipeline described in "Architecture notes" below — uploading via the portal is equivalent to running the pipeline directly. Broadcasts are queued (`BROADCAST_QUEUE_NAME`) and sent in batches of 50 (100ms apart) via `WhatsappSendService`; the processor re-resolves matching recipients at send time rather than trusting the count from when the broadcast was created, so a scheduled broadcast reflects who currently matches its target (tier/subject/level), not who matched at scheduling time.

> **Note:** broadcasts currently send as a plain text message via `sendText()`. WhatsApp requires an approved message template for business-initiated messages outside the 24h customer-service window — this must be swapped for a registered template before broadcasts can actually deliver in production.

## Common scripts

Run from the repo root (Turborepo fans these out to the right workspace):

| Command | Description |
|---|---|
| `npm run build` | Build all apps/packages |
| `npm run dev` | Run all apps in watch mode |
| `npm run lint` | Lint all workspaces |
| `npm run typecheck` | Type-check all workspaces |
| `npm run test` | Run unit tests |
| `npm run db:migrate:dev` | Create/apply a Prisma migration locally |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:seed` | Seed the database with test data |

API-specific (run with `--workspace=api`, or `cd apps/api`):

| Command | Description |
|---|---|
| `start:dev` | Start the NestJS API in watch mode |
| `test:integration` | Integration tests against real Postgres/Redis (**not** run in CI — requires `docker compose up -d` first) |
| `test:e2e` | End-to-end HTTP tests |

Admin-specific (run with `--workspace=admin`, or `cd apps/admin`):

| Command | Description |
|---|---|
| `dev` | Start the admin app on port 3001 in watch mode |
| `test` | Run component tests (Jest + React Testing Library) |
| `db:seed:admin` (root) | Create the first `SUPER_ADMIN` account — see "Admin portal" above |

## Architecture notes

- **Conversation state machine.** Every user session is a `SessionContext` (`state` + scratch fields) stored in Redis under `session:{phone}` with a 2-hour TTL. `StateTransitionService` validates state changes against an explicit graph (`VALID_TRANSITIONS`) — most transitions must follow the graph, but a few user-initiated commands (`/menu`, `/settings`) are deliberate escape hatches that reset state directly, since they need to work from *any* state.
- **pgvector.** Raw SQL is used for all vector operations (per the project's coding standard) since Prisma can't read/write the `Unsupported("vector(n)")` column type through its normal query API.
- **RAG ingestion.** A document goes through a Bull-queued pipeline (`IngestionProcessor`): PDF text extraction → semantic chunking (with overlap) → OpenAI embeddings → storage in `embedding_chunks` (pgvector, ivfflat index), with `Document.ingestionStatus` tracking progress and surfacing the real error on failure.
- **RAG query engine.** `QaService` orchestrates the whole answer flow per question: determine subject (explicit override → session context → keyword inference → the user's first enrolled subject) → check `ResponseCacheService` (SHA-256 of the normalized question + search filter, 24h TTL, skipped for time-sensitive questions) → `VectorSearchService` (cosine similarity via `<=>`, topK 5, similarity floor 0.3) → `PromptAssemblerService` (assembles a numbered, cited CONTEXT block) → `LlmService` (OpenAI, `gpt-4o-mini`/`gpt-4o` by complexity, last 5 exchanges of history) → `ResponseFormatterService` (markdown → WhatsApp formatting, splits responses over 4096 chars into numbered `(N/M)` parts). Every answer is logged as an `Interaction` and folded into the session's conversation history.
- **i18n.** All outbound WhatsApp copy goes through `I18nService.t(key, lang, params?)` — no hardcoded user-facing strings. Catalogs live in `apps/api/src/i18n/locales/{en,fr}.json`.
- **WhatsApp message limits.** Interactive buttons cap at 3 and list messages cap at 10 rows — `WhatsappSendService` enforces the button limit, and handlers that need more options (the 4-item main menu, the 11-subject A-Level catalog) use lists instead of buttons, chunking across multiple messages where needed.
- **Signature verification.** Inbound webhooks are verified via HMAC-SHA256 over the *raw* request body (`main.ts` boots Nest with `rawBody: true` specifically so the exact bytes Meta signed are available — a re-serialized JSON body would not match byte-for-byte).

## Git workflow

- Every feature lives on its own `feature/<name>` branch off `dev`; `dev` merges to `main` for release.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- Never commit directly to `main`.

## Testing

- **Unit tests** (`npm run test`) mock external dependencies (axios, Prisma) and run in CI on every push/PR. This includes `apps/admin`'s Jest + React Testing Library suite (`*.test.tsx`, component-level — e.g. form validation logic), separate from the API's `*.spec.ts` suite.
- **Integration tests** (`npm run test:integration --workspace=api`, after `docker compose up -d`) hit the real Postgres/Redis — run these locally before opening a PR that touches session, state-transition, user-service, or RAG (ingestion or query engine) logic. RAG integration specs mock only the OpenAI-backed embedding/LLM calls; retrieval, pgvector storage, and prompt/response formatting all run for real. Not part of CI yet (no service containers provisioned there).
