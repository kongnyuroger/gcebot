# GCEBot Cameroon — Project Documentation

A deep, developer-facing reference for the whole system: the WhatsApp bot
backend, its data model, and the infrastructure it runs on. For the Next.js
admin portal specifically (auth, document upload, user management, analytics,
broadcast), see **[ADMIN_PORTAL.md](ADMIN_PORTAL.md)** — that's a separate,
already-documented subsystem and isn't repeated here. For quick-start setup
instructions, see **[README.md](README.md)**.

## Contents

- [System overview](#system-overview)
- [Conversation state machine](#conversation-state-machine)
- [WhatsApp integration](#whatsapp-integration)
- [AI orchestrator](#ai-orchestrator)
- [RAG (retrieval-augmented generation)](#rag-retrieval-augmented-generation)
- [Users & quota](#users--quota)
- [Practice mode](#practice-mode)
- [Mock exams](#mock-exams)
- [Progress tracking](#progress-tracking)
- [Payments](#payments)
- [i18n](#i18n)
- [Config](#config)
- [`packages/shared`](#packagesshared)
- [Data model](#data-model)
- [Infrastructure & scripts](#infrastructure--scripts)

## System overview

A student messages the bot on WhatsApp. Every inbound message flows through
one webhook (`POST /webhook`), gets parsed and routed based on the student's
current conversation state (held in Redis, not the database), and lands in
one of two regimes: the original per-feature **button/state-machine handlers**
(Q&A, practice questions, mock exams, progress — still fully intact and
reachable via buttons/commands), or, for free text typed from the main menu,
the **AI orchestrator** (OpenAI function-calling over the same underlying
services — see [AI orchestrator](#ai-orchestrator)). A separate Next.js admin
portal manages content and monitors usage — see [ADMIN_PORTAL.md](ADMIN_PORTAL.md).

```
Student (WhatsApp) ──▶ POST /webhook ──▶ SignatureGuard (HMAC-SHA256)
                                              │
                                              ▼
                                    MessageParserService
                                              │
                                              ▼
                                    MessageRouterService
                              (new user? /menu? command? free text?)
                                              │
        ┌──────────┬─────────────┬───────────┼───────────┬──────────┐
        ▼          ▼             ▼           ▼           ▼          ▼
  Onboarding   QA Mode    Practice Mode  Mock Exam   Progress   Orchestrator
  Handler      Handler    Handler        Handler     Handler    Service
  (buttons)    (buttons)  (buttons)      (buttons)   (buttons)  (free text
        │          │             │           │           │      from MAIN_MENU)
        └──────────┴──────┬──────┴───────────┴───────────┴──────────┘
                                       ▼
                         SessionService (Redis: session:{phone}, 2h TTL)
```

The orchestrator is deliberately additive, not a replacement: every button,
slash command, and their old sub-flows still work exactly as before. Only one
path changed — typing free text while at the main menu, which used to fall
through to a generic "I didn't understand" message, now reaches the
orchestrator instead. See [AI orchestrator](#ai-orchestrator) for why, and
exactly what is/isn't in scope.

## Conversation state machine

Every user's in-progress flow is a `SessionContext` — **not** stored in
Postgres, but in Redis under key `` `session:{phone}` `` with a 2-hour TTL
(`SessionService`, `apps/api/src/session/session.service.ts`), refreshed on
every write.

```ts
interface SessionContext {
  state: ConversationState;
  subject?: string;
  topic?: string;
  currentQuestionId?: string;
  currentQuestionText?: string;   // also used by /hint
  examId?: string;
  pendingPaymentId?: string;
  conversationHistory?: ConversationMessage[]; // shared by QaService and the orchestrator
  pendingSubjects?: string[];     // legacy field, unused by the current onboarding flow (see below)
  practice?: PracticeFilterState; // { subject?, topic?, yearRange?, type?, seenIds? }
  questionType?: string;
  markingSchemeChunkId?: string;
  currentQuestionTopic?: string;
  mockExam?: MockExamSessionState;
}
```

**All 18 `ConversationState` values** (`packages/shared/src/enums/conversation-state.enum.ts`):
`ONBOARDING`, `LEVEL_SELECTION`, `SUBJECT_SELECTION`, `MAIN_MENU`, `QA_MODE`,
`AWAITING_QUESTION`, `PRACTICE_FILTER`, `PRACTICE_TOPIC`, `PRACTICE_YEAR`,
`PRACTICE_TYPE`, `QUESTION_DELIVERY`, `ANSWER_EVALUATION`, `MOCK_EXAM_SETUP`,
`MOCK_EXAM_ACTIVE`, `MOCK_EXAM_REPORT`, `SUBSCRIBE`, `PAYMENT_INIT`,
`PAYMENT_PENDING`.

`StateTransitionService.transition(phone, to)` validates every state change
against an explicit graph (`VALID_TRANSITIONS: Map<ConversationState,
ConversationState[]>`), throwing `BadRequestException` on an invalid edge or
missing session:

```
ONBOARDING            -> LEVEL_SELECTION
LEVEL_SELECTION       -> SUBJECT_SELECTION
SUBJECT_SELECTION     -> MAIN_MENU
MAIN_MENU             -> QA_MODE, PRACTICE_FILTER, MOCK_EXAM_SETUP, SUBSCRIBE, SUBJECT_SELECTION
QA_MODE               -> AWAITING_QUESTION, MAIN_MENU
AWAITING_QUESTION     -> QA_MODE, MAIN_MENU
PRACTICE_FILTER       -> PRACTICE_TOPIC, PRACTICE_YEAR, PRACTICE_TYPE, MAIN_MENU
PRACTICE_TOPIC        -> PRACTICE_YEAR, PRACTICE_TYPE, QUESTION_DELIVERY, MAIN_MENU
PRACTICE_YEAR         -> PRACTICE_TOPIC, PRACTICE_TYPE, QUESTION_DELIVERY, MAIN_MENU
PRACTICE_TYPE         -> QUESTION_DELIVERY, MAIN_MENU
QUESTION_DELIVERY     -> ANSWER_EVALUATION, MAIN_MENU
ANSWER_EVALUATION     -> QUESTION_DELIVERY, MAIN_MENU
MOCK_EXAM_SETUP       -> MOCK_EXAM_ACTIVE, MAIN_MENU
MOCK_EXAM_ACTIVE      -> MOCK_EXAM_REPORT
MOCK_EXAM_REPORT      -> MAIN_MENU
SUBSCRIBE             -> PAYMENT_INIT, MAIN_MENU
PAYMENT_INIT          -> PAYMENT_PENDING, SUBSCRIBE
PAYMENT_PENDING       -> MAIN_MENU, SUBSCRIBE
```

**Escape hatches** — a handful of user-initiated commands bypass the graph
entirely by writing `session.state` directly, since they need to work from
*any* state: `/menu` (checked in `MessageRouterService.route()` before intent
classification, resets to `MAIN_MENU`), `/settings` (`CommandHandler`, resets
to `LEVEL_SELECTION`), and the mode-entry commands `/ask`, `/practice`,
`/mock` (each resets the whole session directly into its own entry state).

## WhatsApp integration

**Inbound**: `POST /webhook` (also `GET /webhook` for Meta's verification
handshake). Verified via `SignatureGuard` — HMAC-SHA256 over the *raw* request
body (`main.ts` boots Nest with `rawBody: true` specifically so the exact
bytes Meta signed are available; a re-serialized JSON body would not match
byte-for-byte), compared with `timingSafeEqual`. The controller acks
immediately (`{received:true}`) and routes asynchronously (fire-and-forget,
errors logged) to avoid webhook timeout/retry storms. Rate-limited via
`WhatsappRateLimitGuard` (tracks by sender phone, falling back to IP) plus
`@Throttle({ default: { limit: 30, ttl: 60_000 } })`.

**`MessageParserService`** recognizes: plain `text`, `interactive.button_reply`,
`interactive.list_reply`. Anything else — no `messages` array (a status
webhook) or an unrecognized interactive subtype — returns `null` or
`{type:'unknown'}` respectively, logged at debug level, never thrown.

**`MessageRouterService.route()`**:
1. New user (`UsersService.isNewUser`) → `OnboardingHandler`.
2. Global `/menu` → resets to `MAIN_MENU` (bypasses everything below).
3. Intent classification: `/`-prefixed text → `COMMAND`; button/list reply →
   `MENU_SELECTION`; else → `FREE_TEXT`.
4. `COMMAND` → `CommandHandler` (`/settings`, `/en`, `/fr`, `/help`, `/ask`,
   `/hint`, `/practice`, `/mock`, `/skip`, `/submit`, `/progress`; unknown
   command → fallback message).
5. `MENU_SELECTION` → a big switch on `session.state` dispatching to the
   state-appropriate handler (falls back to `MenuHandler` for unmapped
   states).
6. `FREE_TEXT` → routed by state: `SUBJECT_SELECTION` → `OnboardingHandler`;
   `AWAITING_QUESTION` → `QaModeHandler`; `ANSWER_EVALUATION` →
   `PracticeModeHandler`; `MOCK_EXAM_ACTIVE` → `MockExamHandler`; **every
   other case — `MAIN_MENU`, any other mid-flow state left stranded with no
   free-text handler of its own (`QA_MODE` before a subject is picked,
   `PRACTICE_FILTER`/`PRACTICE_TOPIC`/`PRACTICE_YEAR`/`PRACTICE_TYPE`,
   `MOCK_EXAM_SETUP`, `MOCK_EXAM_REPORT`, `SUBSCRIBE`,
   `PAYMENT_INIT`/`PAYMENT_PENDING`), or a stale/expired session (session is
   `null` but the user is real, not new) — reaches `OrchestratorService`**
   (see [AI orchestrator](#ai-orchestrator)). The four states listed first
   are the only ones kept on their own deterministic handler: a bare reply
   like "B" carries no context of its own for an LLM to infer intent from -
   the *state* is what says "this is an answer to grade," not the text.
   `FreeTextHandler` (sends `errors.unknownCommand`) is no longer called by
   this router at all - still registered/reachable in principle, but with no
   remaining call site here.

**Handlers** (`apps/api/src/handlers/`, plus a few in `whatsapp/handlers/`):

| Handler | Responsibility |
|---|---|
| `OnboardingHandler` | New-user flow: upsert user, greet, level buttons → conversational subject reply (see below) → persist, → `MAIN_MENU`. |
| `MainMenuHandler` | The 4-row list menu (ask/practice/mock/progress), dispatches taps. |
| `QaModeHandler` | Subject picker → `AWAITING_QUESTION` → forwards to `QaService`; quota-checks first; handles `/hint` and post-answer nav buttons. |
| `PracticeModeHandler` | Subject → topic (incl. weighted "Surprise Me") → year range → MCQ/Structured/Any → delivers a question, delegates grading to `PracticeGradingService`, records the result, offers next-question nav. |
| `MockExamHandler` | Premium-gated entry, assembles a paper, Start/Cancel, schedules timers, delivers questions, handles `/skip`/`/submit`, grades + reports. |
| `ProgressHandler` | Per-topic accuracy + streak report (delegates the aggregation to `ProgressStatsService`), flags weak topics (<60%). |
| `CommandHandler` | Dispatches all `/`-prefixed commands. |
| `MenuHandler` | Catch-all for unrouted button/list replies. |
| `FreeTextHandler` | Default fallback for free text outside any active flow (and outside the orchestrator's one carved-out case — see [AI orchestrator](#ai-orchestrator)). |

**Onboarding's subject step** (`OnboardingHandler.handleSubjectTextReply`) is
conversational, not a numbered-list-plus-Confirm-button flow: an exact
numbers/names reply (`parseSubjectSelections` in `subjects.constants.ts`)
resolves instantly with no LLM call; anything looser ("doing bio, chem and
add maths") falls back to `OnboardingSubjectParserService`, a small dedicated
`generateWithTools` call that maps free text onto the valid subject list for
the student's level and language. Either way, the first confidently-parsed
reply commits immediately and moves to `MAIN_MENU` — there's no separate
confirmation step; fixing a mis-parse afterward is an ordinary conversation
with the orchestrator's `update_profile` tool, not a second onboarding
round-trip. `SessionContext.pendingSubjects` is unused by this flow (kept in
the shared type for backward compatibility, not currently written to).

**`PracticeGradingService`** (`apps/api/src/practice/`) owns MCQ/essay grading
end to end (marking-scheme lookup, LLM explanations for wrong MCQ answers or
essay feedback, `Interaction`/topic-score persistence) — extracted out of
`PracticeModeHandler` so both it and the orchestrator's `grade_answer` tool
share one grading implementation instead of two that could drift.

**Outbound (`WhatsappSendService`)**: `sendText`, `sendButtons` (hard cap
`MAX_BUTTONS = 3`, throws if exceeded), `sendList`, `markAsRead` — all POST to
`https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages`. The 10-row list
cap is enforced by *callers*, not the send service itself
(`MAX_LIST_ROWS_PER_MESSAGE = 10` in `handlers/subjects.constants.ts`, used by
`OnboardingHandler`/`PracticeModeHandler` to chunk longer option lists across
multiple messages). Retries on `429`/`5xx` via an axios interceptor, up to 3
attempts with exponential backoff (`2^attempt * 1000ms`).

## AI orchestrator

Built to replace the frustration of the button/menu-tree flow for anyone who
would rather just type — user testing showed students typing "can I practice
biology" instead of tapping through Main Menu → Practice → subject → topic →
year → type, and getting an unhelpful "I didn't understand" in return. The
orchestrator (`apps/api/src/orchestrator/`) is OpenAI function-calling over
the exact same underlying services the button flows already use — not a
parallel implementation of practice/mock-exam/progress logic.

**Scope.** Started narrower (only `MAIN_MENU` free text), then widened after
live testing kept showing the old generic "I didn't understand" fallback: a
stale/expired session or one left stranded mid an old button flow both
dead-ended there regardless of what the student actually typed. Free text now
reaches `OrchestratorService` from every state *except* `SUBJECT_SELECTION`
(needs `OnboardingHandler`'s own conversational subject parser),
`AWAITING_QUESTION`/`ANSWER_EVALUATION` (a bare reply like "B" has no context
of its own for an LLM to infer intent from — the *state* is what says "this
is an answer to grade," not the text), and `MOCK_EXAM_ACTIVE` (a real-time
timed exam with its own answer-recording/index-advancing logic). Every
button tap and every slash command is untouched and dispatches exactly as
before. Onboarding's *level* selection (a 2-button tap) is also untouched —
it was never the friction being addressed; only onboarding's *subject* step
became conversational (see above).

Since the orchestrator is reachable from states other than `MAIN_MENU` now,
`ToolExecutorService`'s `start_mock_exam` writes `session.state` directly
rather than going through `StateTransitionService.transition()` -
`VALID_TRANSITIONS` only has a `MAIN_MENU → MOCK_EXAM_SETUP` edge, and a
strict transition would throw if the student's session was actually
somewhere else. Same escape-hatch pattern `/menu` and `/settings` already
use for the same reason.

**`OrchestratorService.handleMessage`** (`orchestrator.service.ts`) — the
loop, run once per qualifying inbound message:

1. Sends a WhatsApp "thinking" ack (`markAsRead` + `qa.thinking`) — a
   tool-using turn can take a couple of real LLM round trips.
2. `SystemPromptBuilderService.build(phone)` composes the system prompt fresh
   every turn (never cached — quota/streak/tier can all change between
   messages).
3. Replays `session.conversationHistory` (the same field `QaService` uses —
   see below), appends the new user message, and calls
   `LlmService.generateWithTools(messages, ORCHESTRATOR_TOOLS, {complexity:
   'complex'})`.
4. If the response has no tool calls, its `content` is the final reply. If it
   does, each call is dispatched through `ToolExecutorService.execute`, and
   the JSON-stringified result is pushed back as a `role: 'tool'` message for
   the next round — capped at **5 rounds** (`MAX_TOOL_ROUNDS`) as a safety net
   against a pathological loop that never produces a final answer.
5. The final reply is chunked via `ResponseFormatterService` and sent; the
   turn's `{user, assistant}` pair (the original message and the final reply
   — not the intermediate tool-call transcript) is appended to
   `conversationHistory`, capped at the last 10 messages.
6. Any thrown error (LLM failure, round-cap exhaustion) falls back to
   `errors.tryAgain` rather than ever propagating a raw failure to the
   student.

**`SystemPromptBuilderService`** (`system-prompt-builder.service.ts`) builds
GCEBot's identity, the student's real profile (level, subjects, tier, streak,
language), an instruction to reply in whichever language the student is
*actually* writing in (LLM-generated content — QA answers, practice/mock
feedback — has otherwise been English-only regardless of the student's
`language` setting), a map of when to use which tool, and a quota heads-up
that only appears once a FREE-tier student is within 3 questions of the daily
limit (to avoid noise on every single message).

**Tools** (`tools/tool-definitions.ts`, dispatched by `ToolExecutorService`):

| Tool | Maps to | Server-side gate |
|---|---|---|
| `answer_question` | `QaService.answerQuestion(..., { updateHistory: false })` | FREE-tier daily quota (`QuotaService`) |
| `get_practice_question` | `PastQuestionService.getQuestion` | — (persists the delivered question into session for `grade_answer` to read back) |
| `grade_answer` | `PracticeGradingService.gradeAnswer` | Reads the *session's* active question, never a model-supplied id — grading always targets whatever was last actually served |
| `start_mock_exam` | `MockPaperService.assemblePaper` | PREMIUM/FAMILY tier |
| `show_progress` | `ProgressStatsService.getTopicStats` (+ streak) | — |
| `update_profile` | `UsersService.updateLevel`/`updateSubjects`/`updateLanguage` | — (only the fields actually provided are updated) |
| `start_subscription` | *(no real service — payments aren't built, see [Payments](#payments))* | Always returns an honest "not available yet", never fakes success |

The model is instructed to **always call through** rather than guess a
student's tier or quota from context (e.g. never self-declare "you need to
upgrade" without calling `start_mock_exam` first) — every gate above lives in
`ToolExecutorService`, not in the prompt, and a gated result
(`requiresUpgrade`/`quotaExceeded`) is relayed as an upgrade opportunity, not
a failure. Every branch of `ToolExecutorService.execute` catches its own
errors and returns a plain `{ error: string }` instead of throwing — a
malformed tool call or a stale session must never surface a raw exception
into the tool-calling loop.

`answer_question` vs. `get_practice_question` needed explicit disambiguation
after live testing showed the model sometimes calling `answer_question` for
practice-shaped requests it should have routed to `get_practice_question` -
e.g. "do you have any csc questions available?" - relaying the raw retrieved
chunk verbatim (which, since a chunk can hold multiple short questions back
to back, looked like the bot dumping several questions at once instead of
serving one to attempt). Both tool descriptions and the system prompt's "how
to help" section now explicitly route indirect/loosely-worded practice
requests to `get_practice_question` and say to prefer it whenever a message
could reasonably mean either "explain something" or "give me something to
attempt."

**Known rough edge, not yet resolved:** `start_mock_exam`'s success path
hands the session over to the *existing* `MockExamHandler` (sets
`session.state = MOCK_EXAM_SETUP` and populates `session.mockExam`, mirroring
`MockExamHandler.assembleAndPromptReady` exactly) so the pre-existing
timed-exam flow can take over. But `MockExamHandler.handleSetupSelection`
only recognizes a WhatsApp button tap (`MOCK_START_EXAM`/`MOCK_CANCEL_EXAM`
ids), not free text — if the orchestrator's own composed reply doesn't
happen to result in the student tapping a real button, their first free-text
"yes start it" hits the handler's "unrecognized" branch, which harmlessly
re-sends the real Start/Cancel buttons. Not broken, just one avoidable extra
round-trip; worth revisiting if it proves annoying in practice.

**`QaService.answerQuestion`'s `updateHistory` option**: `QaService` itself
persists a `{question, answer}` pair into `session.conversationHistory` as a
side effect — needed by the older `QaModeHandler` flow, which has no other
layer managing history. The orchestrator now owns history for its own turns
(step 5 above), so `ToolExecutorService` calls `answerQuestion` with
`{ updateHistory: false }` to avoid two conflicting versions of the same
exchange (the raw RAG answer vs. the orchestrator's own, possibly
paraphrased, final reply) being written for one turn.

## RAG (retrieval-augmented generation)

### Ingestion pipeline

`Document` → `IngestionProcessor` (Bull, queue `document-ingestion`), status
tracked via `Document.ingestionStatus` (`QUEUED → PROCESSING → COMPLETE`/`FAILED`,
with `errorMessage` set on failure):

1. **`PdfExtractorService`** — `pdf-parse`. Strips running headers/footers (a
   line counts as boilerplate if it repeats on ≥60% of pages) and page-number
   lines. Throws distinct errors for password-protected/invalid/scanned
   (no-extractable-text) PDFs.
2. **`ChunkingService`** — token-counts via `tiktoken` (`cl100k_base`).
   Target 500–800 tokens per chunk (`TARGET_MAX_TOKENS = 800`), ~65-token
   overlap between consecutive chunks (`OVERLAP_TOKENS = 65`). Splits into
   paragraphs, auto-detects topic headers (`SECTION X`, `Question N`,
   ALL-CAPS lines), falls back paragraph→sentence→word-budget for oversized
   units.
3. **`EmbeddingService`** — OpenAI `text-embedding-3-small`, 1536 dimensions,
   batched 100 at a time, up to 3 retries.
4. **`VectorStoreService`** — batches of 50, raw `$executeRaw` inserts into
   `embedding_chunks` (pgvector's `Unsupported("vector(n)")` column type can't
   go through normal Prisma Client), then updates `Document.chunkCount`.

Document upload from the admin portal (see ADMIN_PORTAL.md) feeds this exact
same pipeline — there's no separate ingestion path.

### Query engine

`QaService.answerQuestion(phone, question, subjectOverride?)`:

1. **Resolve subject**: explicit override → session's current subject →
   keyword inference (`SUBJECT_KEYWORDS`, e.g. Biology/Chemistry/Mathematics/
   Physics/Economics) → the user's first enrolled subject.
2. Detect **follow-up** questions (`FOLLOW_UP_PATTERNS` — bare "why?",
   "explain more", etc.) and **diagram** questions (`DIAGRAM_KEYWORDS`).
3. Non-follow-ups check **`ResponseCacheService`** first — Redis, 24h TTL,
   key = SHA-256 of the normalized question + sorted filter object. Skipped
   entirely (read and write) if the question mentions "latest", "recent",
   "new", or the current/last calendar year (`SKIP_CACHE_KEYWORDS`) — those
   are time-sensitive and shouldn't serve a stale cached answer.
4. **`VectorSearchService`** — cosine similarity via pgvector's `<=>`
   operator, `topK = 5`, similarity floor `0.3`. Follow-ups get their
   retrieval query (only, not the LLM prompt) augmented with the prior user
   message. Zero results → a canned `NO_RESULTS_MESSAGE`, no LLM call.
5. **`PromptAssemblerService`** — numbered, cited CONTEXT block
   (`[1] {content} [Source: {docType}, {year}]`) plus a 7-rule system prompt
   (context-only answers, plain language, Cameroonian examples, cite source,
   respond in the user's language, no math symbols, phone-screen-concise).
6. **`LlmService`** — OpenAI, model chosen by complexity:
   `{ simple: 'gpt-4o-mini', complex: 'gpt-4o' }`. QA calls always use
   `complexity: 'complex'`. History trimmed to the last 5 exchanges (10
   messages). 30s timeout, 3 retries. `generateWithTools(messages, tools,
   options)` is a separate method on the same service for OpenAI
   function-calling (the AI orchestrator's tool-calling loop, and
   `OnboardingSubjectParserService`'s subject-matching call) — `generate()`
   itself is unchanged and every existing caller keeps working as before.
7. **`ResponseFormatterService`** — markdown → WhatsApp formatting, splits
   anything over 4096 chars (budget: 4076 content + 20 reserved for a
   `(N/M)` prefix) paragraph-first, then sentence-first, then hard
   character-slicing as a last resort.
8. Logs an `Interaction` (`type: QA`), updates the session's
   `conversationHistory` (capped at 10 messages), caches the formatted result
   (unless it was a follow-up), and appends a Premium-only diagram tip if
   applicable.

## Users & quota

`User` (see [Data model](#data-model) for full fields) is upserted on first
contact (`UsersService.upsertUser`) with placeholder `level: O_LEVEL`,
`subjects: []`, `tier: FREE`, and a random 8-hex-character `referralCode`
(retried up to 5 times on a unique-constraint collision).

**Quota** (`QuotaService`) only gates the `FREE` tier: **10 QA questions per
Cameroon day** (`Africa/Douala`, UTC+1, no DST — day boundary computed by
shifting into that offset before taking UTC midnight). `BASIC`/`PREMIUM`/
`FAMILY` currently have **no enforced numeric quota** at all — the code
returns `{allowed: true, limit: Infinity}` unconditionally for those tiers.
Exceeding the FREE limit sends `qa.quotaExceeded` and returns before touching
`QaService` — no LLM call, no `Interaction` logged.

## Practice mode

`PastQuestionService.getQuestion(filter, excludeIds)` queries `EmbeddingChunk`
rows from `PAST_PAPER`-type documents matching subject/level/topic/year-range,
excludes already-seen chunk ids, filters to chunks that look like an actual
question (`QUESTION_START_PATTERN`), classifies MCQ vs. structured by option
patterns (`MIN_MCQ_OPTIONS = 2` lettered options), and picks **uniformly at
random** from the candidate pool — then looks up the matching
`MARKING_SCHEME`-type chunk by subject/year/question-number.

**PDF extraction reality, and why several patterns exist in pairs.** Real
ingested past papers extract with no line breaks between questions at all -
everything runs on as one flat line - and `ChunkingService`'s 500-800 token
target routinely packs 2-3 short MCQs into a single chunk. This was confirmed
live (a chunk containing "...D Last in last out approach. 19. Which of the
following..." was originally served as one "question") and is why several
things aren't as simple as they look:
- `getQuestion` doesn't return a chunk's content verbatim - it trims to just
  the *first* question, cutting at the next question's boundary
  (`NEXT_QUESTION_PATTERN`: terminal punctuation + a space + the next
  number, since there's no newline to anchor on).
- `MCQ_OPTION_PATTERN` (question-type detection, in this file) and
  `OPTION_LINE_PATTERN` (actual answer parsing, in `mcq-grading.util.ts`)
  both accept an option preceded by a colon/period/question-mark + a space,
  not only a newline - real options are often "A MDR. B IR." with no
  punctuation after the letter at all. Both require a `\b` word boundary
  around the letter, since without it a capital letter starting an ordinary
  word right after a sentence (". Decoded") would otherwise be mistaken for
  an option marker. Neither pattern tries to catch a first option separated
  from the question stem by nothing but a bare space (e.g. "...network A
  reliability.") - too common in ordinary English to use safely - but
  option B onward are reliably punctuation-preceded either way, which alone
  is enough to classify correctly and to grade a full-text (not just
  bare-letter) answer.

**Marking schemes aren't always one entry per question either.** Some are
ingested as a single compact answer-key table for the whole paper -
`"1. B 11. D 21. A ... 50. C"` - rather than prose like `"Correct answer:
B"` per question (confirmed live against a real ingested GCE Computer
Science marking scheme). Neither `findMarkingSchemeChunkId` (which normally
needs the marking-scheme chunk to itself start with the target question's
number) nor `extractCorrectAnswerLetter` (which normally looks for
`"Correct/Ans(wer) is/: X"` phrasing) can recognize that shape on their own,
so both fall back to `mcq-grading.util.ts`'s `extractAnswerKeyLetter`, which
scans a chunk for `"N. <letter>"` entries and looks up one specific
question. The question's own number is recovered from its text via
`extractQuestionNumber` where it isn't already on hand (`MockGradingService`
already has `questionNumber` on its `MockExamQuestion`, so needs no extra
derivation). `extractSchemeExplanation` also recognizes this table shape
(5+ `"N. <letter>"` matches) and falls back to a generic message instead of
showing the entire raw table as a correct answer's "explanation."

**Topic selection**: `TopicWeaknessService` aggregates graded `Interaction`
rows by topic into an accuracy ranking; `pickWeightedRandomTopic` weights
topics under 60% accuracy 3× more than others when picking "Surprise Me" —
falls back to a plain random topic if the user has no history yet.

**Grading**: MCQ answers are graded deterministically (letter match against
the marking scheme, with fuzzy substring matching against option text too);
wrong MCQ answers get a cheap `gpt-4o-mini` explanation. Structured/essay
answers always get full LLM feedback (`gpt-4o`), formatted with ✅/⚠️/📊/💡
sections, with a parsed "X out of Y" mark used to derive pass/fail at a 50%
threshold. Every result updates both the durable `Interaction` log (used for
weakness analysis) and a denormalized `User.topicScores` JSON counter (used
for quick per-topic accuracy display).

## Mock exams

Premium/Family-gated. Full flow:

1. `/mock` or menu tap → subject pick (auto-skipped if the user has exactly
   one subject).
2. **`MockPaperService.assemblePaper`**: picks the year with the most
   past-paper chunks for that subject+level (ties broken by most recent),
   pulls up to 50 unique questions from `PastQuestionService`, determines
   paper type by majority-voting any "Paper N" label found in the questions
   (`Paper 1` → MCQ/90min, `Paper 2` → Structured/120min, `Paper 3` →
   Essay/150min; falls back to an MCQ-majority heuristic if no label is
   found), extracts per-question marks (`[N marks]` pattern, or defaults: 1
   for MCQ, 10 for structured). A `MockExam` row is created immediately (even
   before the user presses Start) — `discardExam` deletes it if they cancel.
3. Start → **`MockTimerService`** schedules 3 Bull-delayed jobs relative to
   the end time (30-min warning, 10-min warning, auto-submit), transitions to
   `MOCK_EXAM_ACTIVE`, delivers question 1.
4. Free-text answers advance through the paper (questions/answers live in the
   **session**, not the database, until grading); `/skip` and `/submit` are
   available mid-exam.
5. On submit (manual or timer-triggered auto-submit) — **`MockGradingService.gradeExam`**
   grades MCQs deterministically and essays via LLM (prompt demands *only*
   `"X out of {maxMarks}"` as the response), accumulates a per-topic
   `topicBreakdown`, writes `MockExam.score/maxScore/topicBreakdown/submittedAt`.
6. **`MockReportService.generateReport`** computes pass/fail (50% threshold,
   same as practice mode), per-topic lines, the single weakest topic, and an
   LLM study tip (falls back to a canned message on LLM failure) — sent as
   the final report, then the session returns to `MAIN_MENU`.

`MockExamTimerProcessor` lives in `WhatsappModule` (not the mock module
itself) because it needs `WhatsappSendService` — importing `WhatsappModule`
into the mock module would be circular, since `WhatsappModule` already
imports the mock module for `MockPaperService` etc. This is the same
constraint documented for `BroadcastProcessor` in ADMIN_PORTAL.md, just in
the opposite direction (there, `WhatsappModule` safely imports `AdminModule`;
here, the timer processor has to live inside `WhatsappModule` directly).

## Progress tracking

- **`StreakService.recordActivity`**: idempotent per Cameroon-day. Increments
  `streakDays` by 1 only if exactly one day has elapsed since
  `lastActiveDate`; otherwise resets to 1 (no-op if already recorded today,
  or if `lastActiveDate` looks clock-skewed into the future).
- **`MilestoneService.checkMilestone`**: exactly 4 thresholds —
  **7, 30, 60, 100 days**. On hit: sends a celebration message and grants a
  **7-day bonus PREMIUM subscription** (`PaymentMethod.MILESTONE_BONUS`).
  Grant logic: extends an existing *active* subscription's `endDate` by 7
  days in place (preserving its tier — won't downgrade an existing FAMILY
  subscriber to PREMIUM); resets an *expired* one to a fresh 7-day PREMIUM
  window; creates a new one if none exists. There's no "already celebrated"
  bookkeeping — it relies on `streakDays` passing each threshold exactly once
  as it increments.
- **`WeeklyReportService.runWeeklyReport`**: cron `0 8 * * 0` (Sundays 8am,
  `Africa/Douala`). Eligible: any non-FREE user, or a FREE user active in the
  last 7 days. Sent in batches of 50, 100ms apart. Content: questions
  answered this week, best subject, weakest topic, current streak, an LLM
  study tip. **Caveat flagged in-code**: this is a business-initiated message
  requiring an approved WhatsApp template outside the 24h customer-service
  window — it currently calls plain `sendText()`, which the Graph API will
  reject in production until a template is registered (the same gap noted
  for broadcast messaging in ADMIN_PORTAL.md).

## Payments

**Designed but not yet built.** The schema and env-var contract exist; there
is no `payments/` module, no MTN MoMo/Orange Money API client, and no webhook
receiver anywhere in `apps/api/src`.

What exists:
- `PendingPayment` model (`userId`, `tier`, `amount`, `currency` default
  `"XAF"`, `provider: PaymentMethod`, `externalId` unique, `status:
  PaymentStatus` default `PENDING`).
- `PaymentStatus { PENDING, SUCCESSFUL, FAILED }`.
- `PaymentMethod { MTN_MOMO, ORANGE_MONEY, MILESTONE_BONUS }` — the last is
  the streak-bonus tag, not a real payment (needed because `Subscription`'s
  `paymentMethod`/`paymentReference` are non-nullable).
- `Subscription` model (`userId` unique, `tier`, `startDate`, `endDate`,
  `paymentMethod`, `paymentReference`).
- Conversation states `SUBSCRIBE → PAYMENT_INIT → PAYMENT_PENDING` exist in
  the state graph, and `MAIN_MENU → SUBSCRIBE` is a valid edge, but **no
  handler implements entry into `SUBSCRIBE`** — the main menu's rows only
  cover ask/practice/mock/progress.
- `MOMO_API_USER`/`MOMO_API_KEY` are required env vars (validated at boot),
  but nothing reads them yet. There's no Orange Money env var at all.
- The only current reader of `PendingPayment` is the admin portal's analytics
  service (`SUCCESSFUL` payments are the source of truth for revenue —
  deliberately not `Subscription`, which has no amount/currency fields).

**Next steps for whoever picks this up**: a `SubscribeHandler` (or similar)
to enter `SUBSCRIBE` from the main menu, an MTN MoMo Collections API client
+ webhook receiver to move a `PendingPayment` from `PENDING` to
`SUCCESSFUL`/`FAILED` and grant the `Subscription` on success, and the
equivalent for Orange Money (including adding its env vars to
`env.validation.ts`/`.env.example`).

## i18n

`I18nService.t(key, lang, params?)` — dot-path lookup into a JSON catalog
(`apps/api/src/i18n/locales/{en,fr}.json}`, statically imported, not loaded
from disk at runtime). Falls back to the `EN` catalog if a key is missing in
the requested language, then to the raw key string if missing everywhere.
`{{paramName}}` placeholders are replaced from `params`, left untouched if
not supplied. **Supported languages: EN and FR only** (`Language` enum).
Every outbound WhatsApp string goes through this — no hardcoded user-facing
text anywhere in the handlers.

## Config

All environment variables are validated with Zod at boot
(`apps/api/src/config/env.validation.ts`) — the app refuses to start if
anything is missing or malformed:

| Var | Required? | Notes |
|---|---|---|
| `NODE_ENV` | no | `development` \| `production` \| `test`, default `development` |
| `PORT` | no | default `3000` |
| `DATABASE_URL` | yes | must be a valid URL |
| `REDIS_URL` | yes | must be a valid URL |
| `WHATSAPP_TOKEN` | yes | |
| `WHATSAPP_PHONE_NUMBER_ID` | yes | |
| `WHATSAPP_VERIFY_TOKEN` | yes | |
| `WHATSAPP_APP_SECRET` | yes | used for inbound HMAC verification |
| `OPENAI_API_KEY` | yes | |
| `MOMO_API_USER` | yes | validated, but not yet consumed anywhere (see Payments) |
| `MOMO_API_KEY` | yes | same caveat |
| `ADMIN_JWT_SECRET` | yes | ≥ 32 chars |
| `ADMIN_PORTAL_URL` | no | default `http://localhost:3001`, used for CORS |
| `SENTRY_DSN` | no | optional URL |

This list matches `.env.example` exactly.

## `packages/shared`

A plain TypeScript library (no runtime deps beyond `typescript`), consumed as
`@gcebot/shared` via npm workspaces, re-exporting everything from three files:

- **`types.ts`**: `ExamLevel`, `Subject`, `ConversationMessage`,
  `PracticeFilterState`, `MockExamQuestion` (deliberately not the same as the
  API's own `PastQuestion` type — keeps this package app-agnostic),
  `MockExamSessionState`, `SessionContext`.
- **`constants.ts`**: `SUPPORTED_EXAM_LEVELS`, and `SUBJECTS_BY_LEVEL` — the
  canonical subject catalog shared between the bot's onboarding flow and the
  admin portal's document-upload subject dropdown (**10 O-Level subjects**:
  biology, chemistry, mathematics, physics, english_language,
  literature_in_english, economics, geography, history, computer_science;
  **11 A-Level subjects**: same list minus english_language, plus
  additional_mathematics and food_nutrition).
- **`enums/conversation-state.enum.ts`**: the `ConversationState` enum.

## Data model

Full `prisma/schema.prisma` inventory (`AdminUser`/`Broadcast` are documented
in ADMIN_PORTAL.md and omitted here for brevity):

**Enums**: `Level {O_LEVEL, A_LEVEL}`, `SubscriptionTier {FREE, BASIC,
PREMIUM, FAMILY}`, `Language {EN, FR}`, `PaymentMethod {MTN_MOMO,
ORANGE_MONEY, MILESTONE_BONUS}`, `DocType {SYLLABUS, PAST_PAPER, TEXTBOOK,
MARKING_SCHEME}`, `IngestionStatus {QUEUED, PROCESSING, COMPLETE, FAILED}`,
`InteractionType {QA, PRACTICE, MOCK_EXAM, MILESTONE}`, `PaymentStatus
{PENDING, SUCCESSFUL, FAILED}`.

**Models**:

| Model | Key fields |
|---|---|
| `User` | `phone_number` (PK), `level`, `subjects: String[]`, `tier`, `language`, `streakDays`, `lastActiveDate`, `referralCode` (unique), `referredBy`, `topicScores: Json?` (denormalized `{subject: {topic: {correct, total}}}`) |
| `Subscription` | `userId` (unique FK), `tier`, `startDate`, `endDate`, `paymentMethod`, `paymentReference` |
| `Document` | `filename`, `subject`, `level`, `docType`, `year?`, `ingestionStatus`, `errorMessage?`, `chunkCount` |
| `EmbeddingChunk` | `documentId` (FK, cascade delete), `content`, `embedding Unsupported("vector(1536)")`, `subject`, `level`, `topic?`, `year?`, `chunkIndex` |
| `Interaction` | `userId` (FK), `type`, `subject`, `topic`, `questionText`, `userAnswer`, `correct: Boolean?` |
| `MockExam` | `userId` (FK), `subject`, `level`, `startedAt`, `submittedAt?`, `score?`, `maxScore?`, `topicBreakdown: Json?` |
| `ReferralConversion` | `referrerId` (FK→User), `newUserId` (unique FK→User), `rewardGrantedAt?` |
| `PendingPayment` | `userId` (FK), `tier`, `amount`, `currency` (default `"XAF"`), `provider`, `externalId` (unique), `status` |

Prisma client generates to `apps/api/generated/prisma` (imported as
`'../../generated/prisma'` or similar relative paths throughout — this is
**not** the default `node_modules/@prisma/client` location).
`previewFeatures = ["postgresqlExtensions"]`, datasource `extensions =
[vector]`. All vector operations use raw SQL (`$queryRaw`/`$executeRaw`)
since Prisma can't read/write the `Unsupported("vector(n)")` column type
through its normal query API — this includes every insert into
`embedding_chunks` and every similarity search.

**Migration history** (chronological): `init_pgvector` → `init_all_models` →
`add_embedding_chunks_ivfflat_index` → `add_user_topic_scores` (a JSON
column, despite the name — not a separate table) →
`restore_embedding_chunks_ivfflat_index` → `add_milestone_bonus_payment_method`
→ `add_admin_users` → `add_broadcasts`.

> Every `prisma migrate dev --create-only` run against this schema generates
> a spurious `DROP INDEX "embedding_chunks_embedding_idx"` line, because
> Prisma can't see indexes on the `vector` column type. Always inspect
> generated migration SQL and strip that line before applying — this is why
> there's a `restore_embedding_chunks_ivfflat_index` migration in the history
> at all (recovering from a Prisma-generated migration that hadn't yet had
> this stripped). Also, `prisma migrate dev` (no `--create-only`) hangs
> waiting on interactive stdin in sandboxed environments — use `prisma
> migrate deploy` to apply a pre-generated, cleaned migration non-interactively.

## Infrastructure & scripts

**`docker-compose.yml`** — local dev only, 2 services:
- `postgres` (`pgvector/pgvector:pg16`), host port **5433** → container 5432.
- `redis` (`redis:7-alpine`), host port **6380** → container 6379.

**`turbo.json`** tasks: `build`, `dev` (uncached, persistent), `lint`,
`typecheck`, `test` — all fan out per-workspace via npm workspaces
(`apps/*`, `packages/*`).

**Root `package.json` scripts**: `build`/`dev`/`lint`/`test`/`typecheck` →
`turbo run <task>`; `postinstall` → `prisma generate`; `db:generate`,
`db:migrate:dev`, `db:migrate:deploy`, `db:studio`, `db:seed`; `db:seed:admin`
→ the admin-account seed script (see ADMIN_PORTAL.md).

**`prisma/seed.ts`** (runs via `npm run db:seed`, normal dev setup) creates 2
fixture users — a FREE-tier user (`+237670000001`, Biology/Chemistry,
O-Level) and a PREMIUM-tier user (`+237680000002`, Mathematics/Physics,
A-Level, with an active `Subscription`) — plus one seed `Document` with 3
dummy embedding chunks (all-`0.01` vectors, inserted via raw SQL). **Note:**
this PREMIUM fixture user's phone number will match any admin-portal
broadcast targeted at `TIER=PREMIUM` — expect it to show up in recipient
estimates/sends during local testing, it's not a bug.

**`prisma/seed-admin.ts`** — manual, one-off, deliberately not part of
`db:seed`/`postinstall` (see ADMIN_PORTAL.md for full details).
