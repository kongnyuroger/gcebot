# GCEBot Cameroon

A WhatsApp AI tutoring system for Cameroonian students preparing for the **GCE O-Level and A-Level** exams. Students chat with the bot directly on WhatsApp to ask questions, practice with past papers, and sit mock exams — answers are grounded via RAG over embedded textbooks, syllabuses, and 10+ years of past examination papers.

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
│   │       ├── session/     # Redis-backed session store + state machine validator
│   │       ├── users/       # User upsert, profile, streaks
│   │       ├── i18n/        # EN/FR message catalogs + interpolation
│   │       ├── prisma/      # PrismaService (injectable client)
│   │       └── config/      # Zod-validated environment config
│   └── admin/                # Next.js admin portal (content mgmt, analytics)
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

All required env vars are validated with Zod at startup (`apps/api/src/config/env.validation.ts`) — the app refuses to boot if any are missing or malformed. See `.env.example` for the full list: database/Redis URLs, WhatsApp Cloud API credentials, an OpenAI API key, MTN MoMo credentials, and an optional Sentry DSN.

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

## Architecture notes

- **Conversation state machine.** Every user session is a `SessionContext` (`state` + scratch fields) stored in Redis under `session:{phone}` with a 2-hour TTL. `StateTransitionService` validates state changes against an explicit graph (`VALID_TRANSITIONS`) — most transitions must follow the graph, but a few user-initiated commands (`/menu`, `/settings`) are deliberate escape hatches that reset state directly, since they need to work from *any* state.
- **pgvector.** Raw SQL is used for all vector operations (per the project's coding standard) since Prisma can't read/write the `Unsupported("vector(n)")` column type through its normal query API.
- **i18n.** All outbound WhatsApp copy goes through `I18nService.t(key, lang, params?)` — no hardcoded user-facing strings. Catalogs live in `apps/api/src/i18n/locales/{en,fr}.json`.
- **WhatsApp message limits.** Interactive buttons cap at 3 and list messages cap at 10 rows — `WhatsappSendService` enforces the button limit, and handlers that need more options (the 4-item main menu, the 11-subject A-Level catalog) use lists instead of buttons, chunking across multiple messages where needed.
- **Signature verification.** Inbound webhooks are verified via HMAC-SHA256 over the *raw* request body (`main.ts` boots Nest with `rawBody: true` specifically so the exact bytes Meta signed are available — a re-serialized JSON body would not match byte-for-byte).

## Git workflow

- Every feature lives on its own `feature/<name>` branch off `dev`; `dev` merges to `main` for release.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- Never commit directly to `main`.

## Testing

- **Unit tests** (`npm run test`) mock external dependencies (axios, Prisma) and run in CI on every push/PR.
- **Integration tests** (`npm run test:integration --workspace=api`, after `docker compose up -d`) hit the real Postgres/Redis — run these locally before opening a PR that touches session, state-transition, or user-service logic. Not part of CI yet (no service containers provisioned there).
