/**
 * End-to-end smoke test against a running backend.
 *
 *   node scripts/smoke.mjs                       # http://localhost:10000
 *   BASE=https://api.onrender.com node scripts/smoke.mjs
 *
 * Walks the path a caller actually takes: start a call, record three stages
 * with taps and the prospect's words, list calls, close with an outcome,
 * then read the call back. Fails loudly on the first wrong shape.
 */
const BASE = (process.env.BASE || 'http://localhost:10000').replace(/\/$/, '');

let passed = 0;
const failures = [];
const skipped = [];
let llmEnabled = false;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* leave null */
  }
  return { status: res.status, data, text };
}

console.log(`smoke against ${BASE}\n`);

/* ------------------------------------------------------------------- health */
{
  const { status, data } = await call('/health');
  check('GET /health answers', status === 200, `status ${status}`);
  check('health reports db reachable', data?.db?.ok === true, JSON.stringify(data?.db));
  llmEnabled = data?.llm?.configured === true;
  if (llmEnabled) {
    check('health reports llm configured', true);
  } else {
    skipped.push('LLM checks — no GEMINI_API_KEY on this server');
    console.log('  skip LLM checks (no GEMINI_API_KEY on this server)');
  }
}

/* ------------------------------------------------------------- start a call */
let callId = null;
{
  const { status, data } = await call('/api/calls', {
    method: 'POST',
    body: { prospect_name: 'Dana Okoye', company: 'Ridgeline Fencing', phone: '555-0134' },
  });
  check('POST /api/calls creates a call', status === 201, `status ${status} ${JSON.stringify(data)}`);
  check('call has an id', Boolean(data?.call?.id));
  check('start returns the eight stages', data?.stages?.length === 8, `${data?.stages?.length} stages`);
  callId = data?.call?.id;
}

if (!callId) {
  console.log('\nCould not start a call — stopping before the rest of the walk.');
  process.exit(1);
}

/* ------------------------------------------------------------ stage results */
const stages = [
  {
    stage_number: 1,
    what_happened: ['Kept me on the line', 'Asked who I am'],
    prospect_words: "Who's calling? Alright, you've got a minute.",
  },
  {
    stage_number: 4,
    what_happened: ['Named a real problem'],
    prospect_words: 'We lose about a day a week chasing quotes back and forth.',
  },
  {
    stage_number: 8,
    what_happened: ['Booked a meeting'],
    prospect_words: 'Send the invite for Thursday morning.',
  },
];

for (const stage of stages) {
  const { status, data } = await call('/api/stages/result', {
    method: 'POST',
    body: { call_id: callId, ...stage, seconds_on_stage: 41 },
  });
  check(
    `POST /api/stages/result saves stage ${stage.stage_number}`,
    status === 201 && data?.stage_result?.stage_number === stage.stage_number,
    `status ${status} ${JSON.stringify(data)}`
  );
}

{
  const { data } = await call(`/api/calls/${callId}`);
  check('stage results come back in order', data?.stage_results?.map((r) => r.stage_number).join(',') === '1,4,8',
    JSON.stringify(data?.stage_results?.map((r) => r.stage_number)));
  check('prospect words are stored verbatim',
    data?.stage_results?.[1]?.prospect_words === 'We lose about a day a week chasing quotes back and forth.');
  check('taps are stored as a list', Array.isArray(data?.stage_results?.[0]?.what_happened));
}

/* ------------------------------------------------------------- list + close */
{
  const { status, data } = await call('/api/calls?limit=5');
  check('GET /api/calls lists calls', status === 200 && Array.isArray(data?.calls), `status ${status}`);
  check('list shows the furthest stage reached',
    data?.calls?.find((c) => c.id === callId)?.reached_stage === 8,
    JSON.stringify(data?.calls?.[0]?.reached_stage));
  check('list carries the stage name',
    Boolean(data?.calls?.find((c) => c.id === callId)?.reached_stage_name));
}

{
  const { status, data } = await call(`/api/calls/${callId}/close`, {
    method: 'POST',
    body: { outcome: 'meeting_booked', reached_stage: 8, include_debrief: true },
  });
  check('POST /api/calls/:id/close saves the outcome', status === 200 && data?.call?.outcome === 'meeting_booked',
    `status ${status} ${JSON.stringify(data)}`);
  check('close stamps ended_at', Boolean(data?.call?.ended_at));
  if (llmEnabled) {
    check('LLM debrief returned', Boolean(data?.debrief?.summary), JSON.stringify(data?.debrief).slice(0, 120));
  }
}

/* ----------------------------------------------------------- re-saving a stage */
{
  const { status, data } = await call('/api/stages/result', {
    method: 'POST',
    body: { call_id: callId, stage_number: 4, what_happened: ['Turned the question back'], prospect_words: 'Ask me again next quarter.' },
  });
  const { data: after } = await call(`/api/calls/${callId}`);
  check('re-tapping a stage overwrites instead of duplicating',
    status === 201 && after?.stage_results?.filter((r) => r.stage_number === 4).length === 1);
  check('overwritten words are the new ones',
    after?.stage_results?.find((r) => r.stage_number === 4)?.prospect_words === 'Ask me again next quarter.');
}

/* -------------------------------------------------------------- LLM coach */
if (llmEnabled) {
  const { status, data } = await call('/api/coach', {
    method: 'POST',
    body: {
      stage: '4. Find the problem',
      purpose: 'Get them to say what is costing them.',
      prospect_says: 'We are fine with how it works now.',
      happened: 'Named a real problem',
      prospect_words: 'We lose about a day a week chasing quotes back and forth.',
      next_stage: '5. Reframe',
    },
  });
  check('POST /api/coach answers', status === 200, `status ${status} ${JSON.stringify(data)}`);
  check('coach returns short spoken lines',
    Array.isArray(data?.coach?.say) && data.coach.say.length > 0 && data.coach.say.length <= 3,
    JSON.stringify(data?.coach?.say));
  const longest = Math.max(...(data?.coach?.say || ['']).map((s) => s.length), 0);
  check('coach lines stay speakable (<= 220 chars each)', longest <= 220, `longest ${longest}`);
}

/* ------------------------------------------------------------ failure paths */
{
  const { status } = await call('/api/calls', { method: 'POST', body: {} });
  check('POST /api/calls rejects an empty payload', status === 400, `status ${status}`);
  const { status: s2 } = await call('/api/stages/result', { method: 'POST', body: { call_id: 'nope', stage_number: 0 } });
  check('POST /api/stages/result rejects a bad stage', s2 === 400, `status ${s2}`);
  const { status: s3 } = await call('/api/calls/00000000-0000-0000-0000-000000000000/close', {
    method: 'POST',
    body: { outcome: 'not_now' },
  });
  check('closing an unknown call 404s', s3 === 404, `status ${s3}`);
}

console.log(`\n${passed} checks passed, ${failures.length} failed${skipped.length ? `, ${skipped.length} skipped` : ''}`);
if (failures.length) {
  console.log(`failed: ${failures.join(' | ')}`);
  process.exit(1);
}
