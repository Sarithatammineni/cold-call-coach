import { Router } from 'express';
import { supabase, requireDb, dbError, pingDb, dbConfigured } from './db.js';
import { coach, debrief, llmConfigured } from './llm.js';

const router = Router();
const startedAt = Date.now();

/** Wrap async handlers so rejected promises reach the error middleware. */
const asyn = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'BAD_REQUEST';
  return err;
}

/* ------------------------------------------------------------------ health */

router.get(
  '/health',
  asyn(async (_req, res) => {
    const db = await pingDb();
    res.json({
      status: db.ok ? 'ok' : 'degraded',
      service: 'cold-call-coach-api',
      uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
      time: new Date().toISOString(),
      db,
      llm: { configured: llmConfigured, model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' },
    });
  })
);

/* ------------------------------------------------------------------ stages */

router.get(
  '/api/stages',
  asyn(async (_req, res) => {
    requireDb();
    const { data, error } = await supabase
      .from('stages')
      .select('*')
      .order('number', { ascending: true });
    if (error) throw dbError(error);
    res.json({ stages: data || [] });
  })
);

/* ------------------------------------------------------------------- calls */

router.post(
  '/api/calls',
  asyn(async (req, res) => {
    requireDb();
    const body = req.body || {};
    if (!isNonEmptyString(body.prospect_name)) {
      throw badRequest('prospect_name is required.');
    }

    const { data, error } = await supabase
      .from('calls')
      .insert({
        prospect_name: body.prospect_name.trim().slice(0, 120),
        company: isNonEmptyString(body.company) ? body.company.trim().slice(0, 120) : null,
        phone: isNonEmptyString(body.phone) ? body.phone.trim().slice(0, 40) : null,
        started_at: new Date().toISOString(),
        created_by: isNonEmptyString(body.caller) ? body.caller.trim().slice(0, 120) : null,
      })
      .select()
      .single();
    if (error) throw dbError(error, 'Could not start the call.');

    const { data: stages, error: stageError } = await supabase
      .from('stages')
      .select('*')
      .order('number', { ascending: true });
    if (stageError) throw dbError(stageError);

    res.status(201).json({ call: data, stages: stages || [] });
  })
);

router.get(
  '/api/calls',
  asyn(async (req, res) => {
    requireDb();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const { data, error, count } = await supabase
      .from('calls')
      .select('*', { count: 'exact' })
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw dbError(error);

    // Stage names come from the reference table; a missing row must not break the list.
    const { data: stageRows } = await supabase.from('stages').select('number, key, name');

    const byNumber = new Map((stageRows || []).map((s) => [s.number, s]));
    const calls = (data || []).map((c) => ({
      ...c,
      reached_stage_name: byNumber.get(c.reached_stage)?.name || null,
      reached_stage_key: byNumber.get(c.reached_stage)?.key || null,
    }));

    res.json({ calls, total: count ?? calls.length, limit, offset });
  })
);

router.get(
  '/api/calls/:id',
  asyn(async (req, res) => {
    requireDb();
    const { data: call, error } = await supabase
      .from('calls')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw dbError(error);
    if (!call) {
      const err = new Error('Call not found.');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const { data: results, error: resultsError } = await supabase
      .from('stage_results')
      .select('*')
      .eq('call_id', call.id)
      .order('stage_number', { ascending: true });
    if (resultsError) throw dbError(resultsError);

    const { data: stages } = await supabase
      .from('stages')
      .select('*')
      .order('number', { ascending: true });

    res.json({ call, stage_results: results || [], stages: stages || [] });
  })
);

/* ---------------------------------------------------------- stage results */

router.post(
  '/api/stages/result',
  asyn(async (req, res) => {
    requireDb();
    const body = req.body || {};
    if (!isNonEmptyString(body.call_id)) throw badRequest('call_id is required.');

    const stageNumber = Number.parseInt(body.stage_number, 10);
    if (!Number.isInteger(stageNumber) || stageNumber < 1) {
      throw badRequest('stage_number must be a positive integer.');
    }

    const whatHappened = Array.isArray(body.what_happened)
      ? body.what_happened.filter(isNonEmptyString).slice(0, 12).map((s) => s.trim().slice(0, 160))
      : [];

    const row = {
      call_id: body.call_id,
      stage_number: stageNumber,
      what_happened: whatHappened,
      prospect_words: isNonEmptyString(body.prospect_words)
        ? body.prospect_words.trim().slice(0, 4000)
        : null,
      seconds_on_stage:
        Number.isFinite(Number(body.seconds_on_stage)) && Number(body.seconds_on_stage) >= 0
          ? Math.round(Number(body.seconds_on_stage))
          : null,
      skipped: body.skipped === true,
      saved_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('stage_results')
      .upsert(row, { onConflict: 'call_id,stage_number' })
      .select()
      .single();
    if (error) throw dbError(error, 'Could not save this stage.');

    // The furthest stage the call reached is derived, not guessed by the client.
    await supabase.rpc('advance_reached_stage', {
      p_call_id: row.call_id,
      p_stage: stageNumber,
    });

    res.status(201).json({ stage_result: data });
  })
);

/* -------------------------------------------------------------- close call */

router.post(
  '/api/calls/:id/close',
  asyn(async (req, res) => {
    requireDb();
    const body = req.body || {};
    if (!isNonEmptyString(body.outcome)) throw badRequest('outcome is required.');

    const reachedStage = Number.parseInt(body.reached_stage, 10);
    const patch = {
      outcome: body.outcome.trim().slice(0, 80),
      outcome_note: isNonEmptyString(body.outcome_note)
        ? body.outcome_note.trim().slice(0, 2000)
        : null,
      ended_at: new Date().toISOString(),
    };
    if (Number.isInteger(reachedStage) && reachedStage > 0) patch.reached_stage = reachedStage;

    const { data: call, error } = await supabase
      .from('calls')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();
    if (error) throw dbError(error, 'Could not close the call.');
    if (!call) {
      const err = new Error('Call not found.');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    let debriefResult = null;
    if (body.include_debrief === true && llmConfigured) {
      try {
        const { data: results } = await supabase
          .from('stage_results')
          .select('stage_number, prospect_words, what_happened')
          .eq('call_id', call.id)
          .order('stage_number', { ascending: true });

        const stageTrail = (results || [])
          .map((r) => `stage ${r.stage_number}: ${r.what_happened?.join(', ') || 'nothing tapped'}`)
          .join('; ');
        const words = (results || [])
          .map((r) => r.prospect_words)
          .filter(Boolean)
          .join(' | ');

        debriefResult = await debrief({
          stageTrail,
          prospectWords: words,
          outcome: call.outcome,
        });
      } catch {
        debriefResult = null; // a slow or missing LLM must never fail the save
      }
    }

    res.json({ call, debrief: debriefResult });
  })
);

/* -------------------------------------------------------------- LLM coach */

router.post(
  '/api/coach',
  asyn(async (req, res) => {
    const body = req.body || {};
    if (!isNonEmptyString(body.stage)) throw badRequest('stage is required.');

    const result = await coach({
      stage: body.stage,
      purpose: body.purpose,
      prospectSays: body.prospect_says,
      happened: Array.isArray(body.happened) ? body.happened.join(', ') : body.happened,
      prospectWords: body.prospect_words,
      nextStage: body.next_stage,
    });

    res.json({ coach: result });
  })
);

/* ---------------------------------------------------------------- 404 + errors */

router.use((_req, res) => {
  res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
});

// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: err.status >= 500 && err.code !== 'DB_NOT_CONFIGURED' && err.code !== 'LLM_NOT_CONFIGURED'
      ? 'Something went wrong on the server.'
      : err.message,
    code: err.code || 'INTERNAL_ERROR',
    db_configured: dbConfigured,
  });
});

export default router;
