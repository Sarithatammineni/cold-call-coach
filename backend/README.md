# Backend

Express API for the cold-call screen. Runs on **Render** (free web service),
talks to **Supabase** with the service_role key, and calls **Gemini** for the
in-call coach and the end-of-call debrief.

## Endpoints

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/health` | Liveness + database reachability. The URL that goes in the README. |
| `GET` | `/api/stages` | The eight stages: purpose, what prospects say, tap options. |
| `POST` | `/api/calls` | Start a call → returns the call row **and** the stage sheet. |
| `POST` | `/api/stages/result` | Save what happened + the prospect's words at a stage. |
| `POST` | `/api/calls/:id/close` | Close the call with an outcome (optionally LLM debrief). |
| `GET` | `/api/calls` | List past calls with the stage each one reached. |
| `GET` | `/api/calls/:id` | One call with its stage results. |
| `POST` | `/api/coach` | LLM: what to say in the next 20 seconds of this stage. |

## Run locally

```bash
cd backend
cp .env.example .env      # fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY
npm install
npm run dev               # http://localhost:10000
```

```bash
curl -s localhost:10000/health | jq
```
