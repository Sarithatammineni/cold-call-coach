#!/usr/bin/env node
/**
 * Creates (or reuses) the Supabase project, applies the schema and the stage
 * seed through the Management API, then points the live Render service at it
 * and waits for /health to report a reachable database.
 *
 * Needs SUPABASE_ACCESS_TOKEN (or a .supabase-token file holding just the
 * token) and RENDER_API_KEY. Secrets are written where they belong and never
 * printed; only names, ids and statuses reach stdout.
 *
 *   node scripts/provision-supabase.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SUPABASE_API = 'https://api.supabase.com/v1';
const RENDER_API = 'https://api.render.com/v1';
const RENDER_SERVICE = process.env.RENDER_SERVICE_ID || 'srv-dbqvu7utlv9c73da597g';
const API_URL = 'https://cold-call-coach-api.onrender.com';
const PROJECT_NAME = process.env.SUPABASE_PROJECT_NAME || 'cold-call-coach';
const REGION = process.env.SUPABASE_REGION || 'us-east-1';

const token = (
  process.env.SUPABASE_ACCESS_TOKEN ||
  (existsSync('.supabase-token') ? readFileSync('.supabase-token', 'utf8') : '')
).trim();
const renderKey = (process.env.RENDER_API_KEY || '').trim();
// The database and the service config move independently: when the service
// already points at the right project, applying SQL needs no redeploy.
const sqlOnly = process.argv.includes('--sql-only');

if (!token) {
  console.error('No Supabase access token. Set SUPABASE_ACCESS_TOKEN or create .supabase-token.');
  process.exit(1);
}
if (!renderKey && !sqlOnly) {
  console.error('No Render API key. Set RENDER_API_KEY (or pass --sql-only).');
  process.exit(1);
}

const sb = (path, opts) => call(SUPABASE_API, path, { Authorization: `Bearer ${token}` }, opts);
const rd = (path, opts) => call(RENDER_API, path, { Authorization: `Bearer ${renderKey}` }, opts);

async function call(base, path, auth, { method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const detail = typeof json === 'string' ? json : JSON.stringify(json);
    throw new Error(`${method} ${path} → ${res.status} ${detail}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('•', ...a);

function projectBehindEnv() {
  if (!existsSync('backend/.env')) return '';
  const m = readFileSync('backend/.env', 'utf8').match(/^SUPABASE_URL=https:\/\/([a-z0-9]+)\.supabase\.co/m);
  return m ? m[1] : '';
}

async function findOrCreateProject() {
  // The project the deployed backend already talks to wins over everything:
  // creating a second one would strand the live service on the old URL.
  const pinned = projectBehindEnv();
  if (pinned) {
    try {
      const p = await sb(`/projects/${pinned}`);
      log(`using the project backend/.env already points at (${pinned}, ${p.status})`);
      return pinned;
    } catch (e) {
      log(`project ${pinned} is not visible to this token (${e.status || 'error'}); looking for another`);
    }
  }

  const projects = await sb('/projects');
  const existing = (projects || []).find((p) => p.name === PROJECT_NAME);
  if (existing) {
    log(`reusing project ${PROJECT_NAME} (${existing.id}, status ${existing.status})`);
    return existing.id;
  }

  const orgs = await sb('/organizations');
  if (!orgs?.length) throw new Error('This token can see no Supabase organization to create a project in.');
  log(`creating project ${PROJECT_NAME} in ${orgs[0].name || orgs[0].id} (${REGION})`);

  const dbPass = randomBytes(24).toString('base64url') + 'Aa1!';
  const created = await sb('/projects', {
    method: 'POST',
    body: {
      organization_id: orgs[0].id,
      name: PROJECT_NAME,
      db_pass: dbPass,
      region: REGION,
      plan: 'free',
    },
  });
  return created.id;
}

async function waitForProject(ref) {
  const deadline = Date.now() + 12 * 60 * 1000;
  let last = '';
  while (Date.now() < deadline) {
    const p = await sb(`/projects/${ref}`);
    if (p.status !== last) {
      log(`project status: ${p.status}`);
      last = p.status;
    }
    if (p.status === 'ACTIVE_HEALTHY') return p;
    if (['INIT_FAILED', 'PAUSED', 'REMOVED'].includes(p.status)) {
      throw new Error(`project is ${p.status}; it needs attention in the dashboard`);
    }
    await sleep(10_000);
  }
  throw new Error('project did not become ACTIVE_HEALTHY within 12 minutes');
}

async function runSql(ref, file) {
  const query = readFileSync(file, 'utf8');
  await sb(`/projects/${ref}/database/query`, { method: 'POST', body: { query } });
  log(`applied ${file}`);
}

async function serviceKey(ref) {
  const keys = await sb(`/projects/${ref}/api-keys?reveal=true`);
  const service = (keys || []).find((k) => k.name === 'service_role' || k.type === 'secret');
  if (!service?.api_key) throw new Error('No service_role key returned for the new project.');
  return service.api_key;
}

async function pointRender(url, key) {
  const current = await rd(`/services/${RENDER_SERVICE}/env-vars?limit=100`);
  const vars = new Map();
  for (const item of current || []) {
    const v = item.envVar || item;
    vars.set(v.key, v.value);
  }
  vars.set('SUPABASE_URL', url);
  vars.set('SUPABASE_SERVICE_KEY', key);
  const body = [...vars].map(([k, value]) => ({ key: k, value }));
  await rd(`/services/${RENDER_SERVICE}/env-vars`, { method: 'PUT', body });
  log(`Render env updated (${body.map((b) => b.key).join(', ')})`);

  const deploy = await rd(`/services/${RENDER_SERVICE}/deploys`, {
    method: 'POST',
    body: { clearCache: 'do_not_clear' },
  });
  log(`redeploying ${deploy.id}`);
  return deploy.id;
}

async function waitForDeploy(id) {
  const deadline = Date.now() + 15 * 60 * 1000;
  let last = '';
  while (Date.now() < deadline) {
    const d = await rd(`/services/${RENDER_SERVICE}/deploys/${id}`);
    if (d.status !== last) {
      log(`deploy status: ${d.status}`);
      last = d.status;
    }
    if (d.status === 'live') return;
    if (['build_failed', 'update_failed', 'canceled', 'deactivated'].includes(d.status)) {
      throw new Error(`deploy ended as ${d.status}`);
    }
    await sleep(10_000);
  }
  throw new Error('deploy did not go live within 15 minutes');
}

async function health() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(20_000) });
      const j = await res.json();
      if (j.db?.ok) return j;
      log(`health: db ${j.db?.detail || 'unknown'} — retrying`);
    } catch (e) {
      log(`health: ${e.message} — retrying`);
    }
    await sleep(8_000);
  }
  return null;
}

const ref = await findOrCreateProject();
await waitForProject(ref);

const url = `https://${ref}.supabase.co`;
log(`project ready at ${url}`);

await runSql(ref, 'schema/supabase_schema.sql');
await runSql(ref, 'schema/seed_stages.sql');

const rows = await sb(`/projects/${ref}/database/query`, {
  method: 'POST',
  body: { query: 'select (select count(*) from stages) as stages, (select count(*) from calls) as calls' },
});
log(`tables answer: ${JSON.stringify(rows?.[0] ?? rows)}`);

if (sqlOnly) {
  console.log(`\nSchema and seed applied to ${url}. Render already points here, so no redeploy.`);
  process.exit(0);
}

const key = await serviceKey(ref);
const deployId = await pointRender(url, key);
await waitForDeploy(deployId);

const h = await health();
if (!h) {
  console.error('Database created and schema applied, but /health still reports it unreachable.');
  process.exit(2);
}
console.log('\nDone.');
console.log(JSON.stringify({ project: ref, url, db: h.db, llm: h.llm }, null, 2));
