/**
 * Generates schema/seed_stages.sql from frontend/src/stageSheet.json.
 *
 * The JSON file is the single source of truth for what each of the eight
 * stages shows on screen; Supabase holds a copy so the API, the LLM coach
 * and any future query read the same content. Re-run after editing:
 *
 *   npm run seed:stages
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../frontend/src/stageSheet.json');
const target = resolve(here, '../schema/seed_stages.sql');

const sheet = JSON.parse(readFileSync(source, 'utf8'));

/** SQL string literal: single quotes doubled. */
const q = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;
/** JSON array/object as a text literal, cast to jsonb. */
const j = (v) => `${q(JSON.stringify(v ?? []))}::jsonb`;
const num = (v) => (v === null || v === undefined || v === '' ? 'null' : String(v));

const rows = sheet.stages
  .map(
    (s) =>
      `  (${[
        s.number,
        q(s.key),
        q(s.name),
        q(s.purpose),
        j(s.caller_does),
        j(s.prospects_say),
        j(s.prospects_mean),
        j(s.tap_options),
        q(s.watch_out),
        num(s.median_seconds),
        num(s.exit_pct),
      ].join(', ')})`
  )
  .join(',\n');

const outcomes = sheet.outcomes
  .map((o) => `  (${[q(o.key), q(o.label), q(o.tone), q(o.meta)].join(', ')})`)
  .join(',\n');

const sql = `-- ============================================================================
--  Cold Call Coach — stage and outcome seed
--
--  GENERATED FILE — do not edit by hand.
--  Source: frontend/src/stageSheet.json
--  Regenerate: npm run seed:stages
--
--  Run after supabase_schema.sql in the Supabase SQL editor.
-- ============================================================================

insert into stages (
  number, key, name, purpose,
  caller_does, prospects_say, prospects_mean, tap_options,
  watch_out, median_seconds, exit_pct
)
values
${rows}
on conflict (number) do update set
  key            = excluded.key,
  name           = excluded.name,
  purpose        = excluded.purpose,
  caller_does    = excluded.caller_does,
  prospects_say  = excluded.prospects_say,
  prospects_mean = excluded.prospects_mean,
  tap_options    = excluded.tap_options,
  watch_out      = excluded.watch_out,
  median_seconds = excluded.median_seconds,
  exit_pct       = excluded.exit_pct,
  updated_at     = now();

-- The outcome list the caller picks from when they close a call.
insert into outcomes (key, label, tone, meta)
values
${outcomes}
on conflict (key) do update set
  label = excluded.label,
  tone  = excluded.tone,
  meta  = excluded.meta;
`;

writeFileSync(target, sql, 'utf8');
console.log(`wrote ${target} (${sheet.stages.length} stages, ${sheet.outcomes.length} outcomes)`);
