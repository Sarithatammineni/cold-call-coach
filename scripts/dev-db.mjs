/**
 * Local stand-in for Supabase, used only when real keys are not available.
 *
 * It implements the small slice of PostgREST that backend/src/db.js touches:
 * select / insert / upsert / update with filters, single-row reads and the
 * advance_reached_stage RPC. Data lives in memory and is seeded from
 * frontend/src/stageSheet.json so the stage sheet on screen is the real one.
 *
 *   node scripts/dev-db.mjs            # http://localhost:54321
 *   SUPABASE_URL=http://localhost:54321 npm run dev   # in backend/
 *
 * Production never runs this file: backend/src/db.js talks to real Supabase.
 */
import express from 'express';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sheet = JSON.parse(
  readFileSync(resolve(here, '../frontend/src/stageSheet.json'), 'utf8')
);

const PORT = Number(process.env.PORT) || 54321;

const db = {
  stages: sheet.stages.map((s) => ({
    number: s.number,
    key: s.key,
    name: s.name,
    purpose: s.purpose,
    caller_does: s.caller_does || [],
    prospects_say: s.prospects_say || [],
    prospects_mean: s.prospects_mean || [],
    tap_options: s.tap_options || [],
    watch_out: s.watch_out || null,
    median_seconds: s.median_seconds ?? null,
    exit_pct: s.exit_pct ?? null,
    updated_at: new Date().toISOString(),
  })),
  calls: [],
  stage_results: [],
};

const app = express();
app.use(express.json({ limit: '64kb' }));

/** Parses the tiny query surface supabase-js generates. */
function parseQuery(req) {
  const q = req.query;
  const filters = [];
  for (const [k, v] of Object.entries(q)) {
    if (k === 'select' || k === 'order' || k === 'on_conflict') continue;
    const m = /^(eq|neq|gt|lt|gte|lte)$/.exec(String(v).split('.')[0]);
    if (!m) continue;
    const op = m[0];
    const value = String(v).slice(op.length + 1);
    filters.push({ col: k, op, value });
  }
  const order = q.order
    ? String(q.order).split(',').map((part) => {
        const [col, dir] = part.split('.');
        return { col, dir: dir === 'asc' ? 1 : -1 };
      })
    : [];

  const rangeHeader = req.headers.range; // "0-49"
  let range = null;
  if (rangeHeader) {
    const [a, b] = String(rangeHeader).split('-').map((n) => Number(n));
    range = { from: a || 0, to: Number.isFinite(b) ? b : a || 0 };
  }
  return { filters, order, range, wantsCount: /count=exact/.test(req.headers.prefer || '') };
}

function applyFilters(rows, filters) {
  return rows.filter((r) =>
    filters.every(({ col, op, value }) => {
      const a = r[col];
      const b = value;
      switch (op) {
        case 'eq':
          return String(a ?? '') === String(b ?? '');
        case 'neq':
          return String(a ?? '') !== String(b ?? '');
        case 'gt':
          return a > b;
        case 'lt':
          return a < b;
        case 'gte':
          return a >= b;
        case 'lte':
          return a <= b;
        default:
          return true;
      }
    })
  );
}

function applyOrder(rows, order) {
  if (!order.length) return rows;
  return [...rows].sort((a, b) => {
    for (const { col, dir } of order) {
      if (a[col] === b[col]) continue;
      return a[col] > b[col] ? dir : -dir;
    }
    return 0;
  });
}

const single = (req) => /pgrst\.object/.test(req.headers.accept || '');

function sendRows(req, res, rows) {
  if (single(req)) {
    if (rows.length === 0) {
      res.status(406).json({
        code: 'PGRST116',
        details: 'The result contains 0 rows',
        hint: null,
        message: 'JSON object requested, multiple (or no) rows returned',
      });
      return;
    }
    res.json(rows[0]);
    return;
  }
  res.json(rows);
}

for (const table of ['calls', 'stage_results', 'stages']) {
  const rows = () => db[table];

  app.get(`/rest/v1/${table}`, (req, res) => {
    const { filters, order, range, wantsCount } = parseQuery(req);
    let out = applyOrder(applyFilters(rows(), filters), order);
    const total = out.length;
    if (range) out = out.slice(range.from, range.to + 1);
    if (wantsCount) res.set('Content-Range', `${range?.from ?? 0}-${(range?.from ?? 0) + out.length - 1}/${total}`);
    sendRows(req, res, out);
  });

  app.post(`/rest/v1/${table}`, (req, res) => {
    const body = Array.isArray(req.body) ? req.body : [req.body];
    const onConflict = req.query.on_conflict;
    const inserted = [];

    for (const row of body) {
      if (onConflict) {
        const keys = String(onConflict).split(',');
        const idx = rows().findIndex((r) => keys.every((k) => String(r[k]) === String(row[k])));
        if (idx >= 0) {
          rows()[idx] = { ...rows()[idx], ...row };
          inserted.push(rows()[idx]);
          continue;
        }
      }
      const record = { id: randomUUID(), ...row };
      rows().push(record);
      inserted.push(record);
    }

    res.status(201);
    sendRows(req, res, inserted);
  });

  app.patch(`/rest/v1/${table}`, (req, res) => {
    const { filters } = parseQuery(req);
    const matched = applyFilters(rows(), filters);
    matched.forEach((r) => Object.assign(r, req.body));
    sendRows(req, res, matched);
  });
}

app.post('/rest/v1/rpc/advance_reached_stage', (req, res) => {
  const { p_call_id: callId, p_stage: stage } = req.body || {};
  const call = db.calls.find((c) => c.id === callId);
  if (call && (call.reached_stage == null || call.reached_stage < stage)) {
    call.reached_stage = stage;
  }
  res.json(null);
});

app.get('/auth/v1/health', (_req, res) => res.json({ date: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`dev db (PostgREST stand-in) on http://localhost:${PORT}`);
  console.log(`seeded ${db.stages.length} stages from stageSheet.json`);
});
