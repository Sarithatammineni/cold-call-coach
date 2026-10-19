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
| **Vercel app (the screen)** | `TBD — after deploy` |
| **Render health endpoint** | `TBD — after deploy` (`GET /health`) |
| **GitHub repo** | `TBD — after publish` |

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

**Google Gemini (`gemini-2.5-flash`)** on the AI Studio free tier, called from the Render
backend only — the key never reaches the browser. It is used for two things:

1. **In-call coach** — `POST /api/coach`. Given the current stage, what that stage is for,
   what prospects tend to say there, what the caller has tapped as happening and the
   prospect's own words so far, it returns up to three short lines the caller can say in
   the next twenty seconds, plus one thing to watch for.
2. **End-of-call debrief** — `POST /api/calls/:id/close` with `include_debrief: true`
   turns the stage trail and the outcome into a two-sentence summary and a next action.

If no key is configured the endpoints answer `503` with a clear message and the rest of
the product keeps working — no screen depends on the model.

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
