# Cold Call Coach

The screen a caller keeps open on a cold call.

A caller has a prospect on the phone and this screen open beside it. It keeps them on the
structure of the call — which stage they are in and what that stage is for, what prospects
tend to say at that point so nothing surprises them, a tap for what happened, a box for the
prospect's own words, then the next stage and, when the call ends, the outcome. Every call
is saved, and a second screen lists past calls with the stage each one reached.

## The three URLs

| | |
| --- | --- |
| **Vercel app (the screen)** | https://cold-call-coach-rose.vercel.app |
| **Render health endpoint** | https://cold-call-coach-api.onrender.com/health |
| **GitHub repo** | https://github.com/Sarithatammineni/cold_callers |

### Deploy status

| Part | State |
| --- | --- |
| The screen on Vercel | **Live** — builds clean, serves the app against the live API. |
| The API on Render | **Live** — `cold-call-coach-api`, free plan, Oregon, auto-deploy from `main`, health check `/health`. Env vars set through the API. `/health` reports `db.ok: true` and `llm.configured: true`. |
| Supabase tables | **Applied** — `supabase_schema.sql` and `seed_stages.sql` both ran against project `bfpftoceofvkuaqfkofk`; eight stages are in the table and it answers through the live API. |

The deployed API was verified with the 26-check smoke suite (`BASE=https://cold-call-coach-api.onrender.com
node scripts/smoke.mjs`): start a call, save three stage results with taps and the prospect's
words verbatim, list, close with an outcome, LLM debrief, the coach — all 26 passing. The rows
that run created were then deleted, so the live app starts with the stages and no calls.

`scripts/provision-supabase.mjs` does the database half of this from the command line: it
reuses the project `backend/.env` already points at, applies both SQL files through the
Management API, and with `RENDER_API_KEY` set also stores the service key on Render, redeploys
and waits for `/health` to report the database reachable. `--sql-only` stops after the SQL.

`VITE_API_URL` on Vercel already points at `https://cold-call-coach-api.onrender.com`,
which is the live service, so the screen needed no redeploy when it came up. CORS allows the
Vercel origin and refuses anything else with `403`.

`/health` is bounded to 2.5 s. It used to wait on the database, and an unreachable host made
it hang until Render's probe timed out and discarded the deploy; a health check that reports
"database unreachable" is worth more than one that never answers.

## The eight stages

One screen per stage, in order. Each stage carries the same five things: what it is for,
what prospects tend to say there and what those lines mean, how that stage usually goes
wrong, a tap for what happened, and a box for the prospect's own words.

| # | Stage | What it is for |
| --- | --- | --- |
| 1 | Open | Get a few seconds of attention and permission to keep talking. |
| 2 | Reason for the call | Say why them, why now, in one sentence. |
| 3 | Ask permission | Trade a question for a moment of their time. |
| 4 | Find the problem | Get them to say what is costing them, in their words. |
| 5 | Reframe | Connect their problem to a way of fixing it. |
| 6 | Handle the pushback | Let the objection be said fully, then answer the real one. |
| 7 | Prove it | One piece of evidence, sized to the seconds left. |
| 8 | Ask for the meeting | Convert the conversation into a day and a time. |

The wording above is placeholder content held in `frontend/src/stageSheet.json`; it is
regenerated into `schema/seed_stages.sql` with `npm run seed:stages`.

## The LLM

**Google Gemini (`gemini-3.5-flash`)** on the AI Studio free tier, called from the Render
backend only — the key never reaches the browser. It is used for two things:

1. **In-call coach** — `POST /api/coach`. Given the current stage, what that stage is for,
   what prospects tend to say there, what the caller has tapped as happening and the
   prospect's own words so far, it returns up to three short lines the caller can say in
   the next twenty seconds, plus one thing to watch for.
2. **End-of-call debrief** — `POST /api/calls/:id/close` with `include_debrief: true`
   turns the stage trail and the outcome into a two-sentence summary and a next action.

If no key is configured the endpoints answer `503` with a clear message and the rest of
the product keeps working — no screen depends on the model.

`gemini-3.5-flash` is a thinking model, so the coaching call sends
`thinkingConfig: { thinkingBudget: 0 }` with an 800-token cap. Without it the reasoning
tokens eat the output budget and the coaching JSON is truncated mid-string.

The free tier has a request quota. When it is spent, Gemini answers `429` — and while
throttled it sometimes stalls instead of answering, so the request hits the 18-second
ceiling. Both cases come back as `LLM_QUOTA` / `LLM_TIMEOUT` with a plain sentence the
screen shows under the button; the API never flattens them into "something went wrong".
Everything else — the stages, the taps, saving a stage, closing a call, the history —
works with no model at all. Quota returns with the provider's window, or with billing.

## Stack

| Part | Service | Tier |
| --- | --- | --- |
| The screen (`frontend/`) | **Vercel** | Free |
| The API (`backend/`) | **Render** (sleeps when idle) | Free |
| Calls, stages, stage results, outcomes | **Supabase** | Free |
| Coach and debrief | **Google Gemini** | Free |

The browser only ever talks to Render. Render is the only thing that talks to Supabase
(service-role key) or Gemini, so both secrets stay server-side.

## API

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/health` | Liveness, database reachability, LLM configuration. |
| `GET` | `/api/stages` | The eight stages with their content. |
| `POST` | `/api/calls` | Start a call → returns the call and the stage sheet. |
| `POST` | `/api/stages/result` | Save what happened + the prospect's words at a stage. |
| `POST` | `/api/calls/:id/close` | Close a call with an outcome (optionally debrief). |
| `GET` | `/api/calls` | List past calls with the stage each reached. |
| `GET` | `/api/calls/:id` | One call with its stage results. |
| `POST` | `/api/coach` | LLM: what to say in the next 20 seconds. |
| `GET` | `/api/stream` | Server-sent events: `call.opened`, `stage.saved`, `call.closed`. |

## Live updates and theme

Every write to the API is pushed to every open screen over `GET /api/stream`. A call
started on one device shows up in another's history immediately, without a refresh and
without polling: the API is the only writer, so it already knows when something changed.
The stream sends a keep-alive comment every 20 seconds so Render's proxy does not close
it, and the browser reconnects by itself; while the stream is down the history screen
falls back to a slow refresh rather than pretending to be live.

The screen has a dark and a light theme, switched from the header and remembered in
`localStorage`, with the operating system's preference used the first time. Neither
theme uses an accent colour: emphasis is white-on-black (or black-on-white) plus weight.

Errors are JSON: `{ "error": "human sentence", "code": "MACHINE_CODE" }`.
CORS allows only the origins in `CORS_ORIGINS`; a foreign `Origin` gets `403`.

## Repository layout

```
frontend/          The screen — Vite + React, deployed to Vercel
backend/           The API — Express, deployed to Render
schema/
  supabase_schema.sql   Tables, RLS, the advance_reached_stage function
  seed_stages.sql        GENERATED from frontend/src/stageSheet.json
scripts/
  gen-seed.mjs      Regenerate the seed SQL
  dev-db.mjs        Local PostgREST stand-in (no Supabase needed)
  smoke.mjs         End-to-end test against a running API
render.yaml         Render blueprint
```

## Running it locally

```bash
# 1. the API's database stand-in and the API itself
npm install
npm run dev:db                                     # http://localhost:54321
cd backend && npm install && cp .env.example .env  # fill in the three keys
SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_KEY=devkey npm run dev

# 2. the screen
cd frontend && npm install && npm run dev          # http://localhost:5173

# 3. prove the whole path
node scripts/smoke.mjs
```

## Setting it up for real

1. **Supabase** — SQL editor → run `schema/supabase_schema.sql`, then
   `schema/seed_stages.sql`. Copy the Project URL and the **secret** (`sb_secret_…`) key.
2. **Render** — New → Blueprint → this repo (reads `render.yaml`), or a Web Service with
   root directory `backend`, build `npm install`, start `npm start`, health check `/health`.
   Set `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GEMINI_API_KEY`, `CORS_ORIGINS`.
3. **Vercel** — import the repo, root directory `frontend`, set `VITE_API_URL` to the
   Render URL in Production, deploy.
4. Put the Render URL into `CORS_ORIGINS` on Render, and the Vercel URL into it too.
