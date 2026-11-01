# TradingAgents (fork): project instructions

Two products live in this repo:
- `tradingagents/`, `cli/`, `tests/`: the upstream multi-agent research engine (Python, LangGraph). Touch it only to fix
  something the web app hits; keep its style (`ruff check .`, `pytest -q` from the repo root).
- `web/`: the Indonesian trading-research SaaS built on that engine. Most work happens here.

## Web stack
- Server `web/server/src`: Bun + Hono, Drizzle ORM on PostgreSQL, zod at every input boundary.
- Client `web/client/src`: Svelte 5 (runes) + Vite multi-page (landing, /harga, /status, /c/<user>, /app) + Tailwind 4 + daisyUI 5.
- Worker `web/worker`: Python scripts the server spawns per job (JSON lines over stdio). `ta_worker.py` dispatches
  `catalog`, `run`, `backtest`, `agent`, `signals`, `translate`, `lab`, `brief`.
- `web/shared`: TypeScript used by both sides (plans and limits, the QuickJS script sandbox, brand).

## Commands (from `web/`)
- Database: `bun run db:up` · dev servers: `bun run dev` · without LLM cost: `bun run dev:demo`
- Type-check: `cd client && bun run check` and `cd server && bunx tsc --noEmit` (both must stay at 0 errors)
- Tests: `cd server && bun run test` (needs the database; recreates `tradingagents_test` each run) and
  `cd client && bun run test` (indicator parity; Python with pandas). Lint the worker from the repo root: `ruff check web`.
  CI (`.github/workflows/web.yml`) runs all of these, plus the client build, on every push.
- Build the client: `bun run build`
- Schema change: edit `server/src/db/schema.ts`, then `cd server && bunx drizzle-kit generate --name <what>`;
  migrations apply at server start in dev, and in production in the compose `migrate` service before the app is
  replaced. The running version must keep working on the new schema: add first, remove in a later release.

## Code style (match what is there)
- Every module opens with a prose comment: what it is for and why it works that way. Exported functions get a one-line
  `/** … */`. Comments explain why, never restate the code.
- English for identifiers and comments. Indonesian, in plain words and sentence case, for everything a user reads:
  UI text, API `{ error }` messages, Telegram and e-mail messages.
- Server: one Hono router per feature module (`export const fooApi = new Hono<AppEnv>()`), mounted in `app.ts`
  before or after `requireAuth` on purpose. Parse bodies with zod `safeParse`; answer `c.json({ error }, status)`.
  `index.ts` only migrates, starts the schedulers and serves `app`, so tests import `app` without side effects.
- Logs are JSON lines through `log.ts` (`log.warn("event_name", { fields })`), never `console.*`. A background failure
  goes to `recordError(source, err)` (`errors.ts`): logged and listed for admins. A 500 shows the user only a code.
- Settings read at start belong in `readSettings` (`config.ts`), so a wrong value stops the server with its name.
- Make work idempotent in the database: unique indexes and conditional updates (`… where active = true returning`)
  so two server instances never double-send or double-run (see `jobs.ts`, `alerts.ts`, `price-alerts.ts`).
- Members always run on the server's provider and models (`models.ts`); env-var names and backend URLs show to admins only.
- Plan limits come from `shared/plans.ts` through `limitsOf()`; never hard-code a number of seats, alerts or analyses.
- Client: stores are singleton classes with `$state`/`$derived` in `lib/stores/*.svelte.ts`; the workspace state lives in
  the URL hash (`stores/workspace.svelte.ts`); every request goes through `lib/api.ts` (typed).
- UI: daisyUI components first, colours from theme tokens only, no text under 12px, one primary action per area.
- The indicator engines exist twice (TypeScript in `client/src/lib/indicators`, Python in `web/worker`): change both
  in the same commit and say so; the parity test (`cd client && bun run test`) must still pass.

## Where things live
| Need | Look at |
| --- | --- |
| A new API route | a feature module in `server/src`, mounted in `server/src/app.ts` |
| A server test | `server/test/*.test.ts` with `test/helpers.ts` (`call`, `admin`, `member`, `lastMail`) |
| A table or column | `server/src/db/schema.ts` + a generated migration in `server/drizzle/` |
| Background work | the `start*` schedulers in `alerts.ts`, `watch.ts`, `ledger.ts`, `reminders.ts`, `site.ts`, `status.ts` |
| Analysis jobs | `server/src/jobs.ts` (queue, claim, heartbeat) and `server/src/worker.ts` (spawn) |
| Sign-in, sessions, 2FA | `server/src/auth.ts`, `server/src/totp.ts` |
| Pro workspace | `client/src/lib/workspace/`, chart in `client/src/lib/DecisionChart.svelte` |
| Pemula screen | `client/src/lib/beginner/` |
| Admin console | `client/src/lib/admin/` |
| Public pages | `client/index.html`, `client/<page>/index.html`, `client/src/site/` |
| Backups, restore drill | `web/deploy/backup.sh`, `web/deploy/restore-check.sh` (run on the VPS) |

## Rules
- The fork is public: never commit secrets, `.env` files, `.serena/`, server addresses, keys or production URLs of LLM
  backends. Stage files by name and scan them before every commit.
- Test on local servers (two instances on one database: one without sign-in, one with); never type production
  credentials into a browser. Verify production through its database and logs.
- Commit each finished feature: subject `web: <what users get>`, body explaining why. Update `web/README.md` in the
  same commit when behaviour, routes or settings change.
- A server change comes with a test in `server/test`: in-process through `app.request`, with the seams for what
  leaves the process (`outbox` in `mail.ts`, `useQuotes` in `price-alerts.ts`, `forgetCache` in `site.ts`).
- Known gaps, not conventions: schedulers and caches are in-process (one server instance), and the content policy
  is report-only. Do not add more in-memory state that must be shared across instances.
