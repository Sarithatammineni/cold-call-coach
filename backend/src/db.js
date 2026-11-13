import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

export const dbConfigured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

export const supabase = dbConfigured
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

/** Throws a clean, non-leaky error when the database was not configured. */
export function requireDb() {
  if (!dbConfigured) {
    const err = new Error('Database is not configured on this server.');
    err.status = 503;
    err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
}

/** Normalises a Supabase error into an Error with an HTTP status. */
export function dbError(error, fallbackMessage = 'Database request failed.') {
  const raw = error?.message || '';
  const err = new Error(raw || fallbackMessage);
  err.status = error?.code === 'PGRST116' ? 404 : 500;
  err.code = error?.code || 'DB_ERROR';

  // A database that cannot be reached is not an internal mystery: say so, and
  // do not put a stack-flavoured string like "fetch failed" in front of a user.
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(raw)) {
    err.status = 503;
    err.code = 'DB_UNAVAILABLE';
    err.message = 'The database is not reachable right now.';
  }
  return err;
}

/**
 * Lightweight readiness probe used by /health.
 *
 * It is bounded: a database host that resolves badly or not at all could hang
 * the request for minutes, and the platform reads a slow /health as "this
 * service is down" and throws the deploy away. A health check answers in
 * seconds or says it cannot reach the database, which is the truth either way.
 */
const PING_TIMEOUT_MS = 2500;

export async function pingDb() {
  if (!dbConfigured) return { ok: false, configured: false, detail: 'not configured' };
  const giveUp = new Promise((resolve) =>
    setTimeout(() => resolve({ error: { message: `no answer in ${PING_TIMEOUT_MS}ms` } }), PING_TIMEOUT_MS)
  );
  try {
    const { error } = await Promise.race([
      supabase.from('calls').select('id').limit(1),
      giveUp,
    ]);
    if (error) return { ok: false, configured: true, detail: error.message };
    return { ok: true, configured: true, detail: 'reachable' };
  } catch (e) {
    return { ok: false, configured: true, detail: e.message };
  }
}
