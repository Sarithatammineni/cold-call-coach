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
  const err = new Error(error?.message || fallbackMessage);
  err.status = error?.code === 'PGRST116' ? 404 : 500;
  err.code = error?.code || 'DB_ERROR';
  return err;
}

/** Lightweight readiness probe used by /health. */
export async function pingDb() {
  if (!dbConfigured) return { ok: false, configured: false, detail: 'not configured' };
  try {
    const { error } = await supabase.from('calls').select('id').limit(1);
    if (error) return { ok: false, configured: true, detail: error.message };
    return { ok: true, configured: true, detail: 'reachable' };
  } catch (e) {
    return { ok: false, configured: true, detail: e.message };
  }
}
