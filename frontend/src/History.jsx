import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import sheet from './stageSheet.json';

const OUTCOME_TONE = new Map(sheet.outcomes.map((o) => [o.key, o.tone]));
const OUTCOME_LABEL = new Map(sheet.outcomes.map((o) => [o.key, o.label]));

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(call) {
  if (!call.started_at || !call.ended_at) return null;
  const secs = Math.round((new Date(call.ended_at) - new Date(call.started_at)) / 1000);
  if (!Number.isFinite(secs) || secs < 0) return null;
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`;
}

export default function History({ stages }) {
  const [calls, setCalls] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');

  const stageName = useMemo(
    () => new Map((stages || []).map((s) => [s.number, s.name])),
    [stages]
  );

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const res = await api.listCalls(100);
      setCalls(res.calls || []);
      setStatus('ready');
    } catch (err) {
      setError(err);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'all') return calls;
    return calls.filter((c) => (c.outcome || 'open') === filter);
  }, [calls, filter]);

  const counts = useMemo(() => {
    const m = new Map();
    for (const c of calls) m.set(c.outcome || 'open', (m.get(c.outcome || 'open') || 0) + 1);
    return m;
  }, [calls]);

  if (status === 'error') {
    return (
      <section className="card" style={{ marginTop: 8 }}>
        <h2 className="stage-name">Could not load the calls</h2>
        <p className="purpose">
          {error?.code === 'NETWORK'
            ? 'The server is not answering. Render free instances sleep and wake on the first request, which can take up to a minute.'
            : error?.message}
        </p>
        <div className="btn-row">
          <button className="btn btn--primary btn--block" onClick={load}>
            Try again
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="filters">
        <button
          className={`filter${filter === 'all' ? ' is-on' : ''}`}
          onClick={() => setFilter('all')}
        >
          All {calls.length}
        </button>
        {sheet.outcomes
          .filter((o) => counts.get(o.key))
          .map((o) => (
            <button
              key={o.key}
              className={`filter${filter === o.key ? ' is-on' : ''}`}
              onClick={() => setFilter(o.key)}
            >
              {o.label} {counts.get(o.key)}
            </button>
          ))}
      </div>

      {status === 'loading' && calls.length === 0 && (
        <>
          <div className="skeleton" style={{ height: 62, borderRadius: 14 }} />
          <div className="skeleton" style={{ height: 62, borderRadius: 14, marginTop: 10 }} />
        </>
      )}

      {status === 'ready' && filtered.length === 0 && (
        <section className="card">
          <h2 className="stage-name">
            {calls.length === 0 ? 'No calls yet' : 'Nothing with that outcome'}
          </h2>
          <p className="purpose">
            {calls.length === 0
              ? 'Start a call and every stage you reach gets saved here — what happened, their words, and where it ended.'
              : 'Pick another outcome above.'}
          </p>
        </section>
      )}

      {filtered.map((c) => (
        <CallRow key={c.id} call={c} stageName={stageName} />
      ))}

      {filtered.length > 0 && (
        <div className="btn-row">
          <button className="btn btn--ghost btn--block" onClick={load}>
            Refresh
          </button>
        </div>
      )}
    </>
  );
}

function CallRow({ call, stageName }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  const tone = OUTCOME_TONE.get(call.outcome) || 'warm';
  const duration = fmtDuration(call);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !detail && !busy) {
      setBusy(true);
      try {
        const res = await api.getCall(call.id);
        setDetail(res);
      } catch {
        setDetail({ error: true });
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <div>
      <button className="callrow" onClick={toggle} type="button">
        <div className="callrow__top">
          <span className="callrow__name">{call.prospect_name}</span>
          <span className="callrow__date">{fmtDate(call.started_at)}</span>
        </div>
        {call.company && <p className="topbar__sub">{call.company}</p>}
        <div className="callrow__meta">
          <span className="badge badge--stage">
            Reached {call.reached_stage ? `stage ${call.reached_stage}` : 'no stage'}
            {call.reached_stage && stageName.get(call.reached_stage)
              ? ` · ${stageName.get(call.reached_stage)}`
              : ''}
          </span>
          <span className={`badge badge--${tone}`}>
            {OUTCOME_LABEL.get(call.outcome) || (call.outcome ? call.outcome : 'Still open')}
          </span>
          {duration && <span className="badge">{duration}</span>}
        </div>
      </button>

      {open && (
        <div className="card" style={{ marginTop: 10 }}>
          {busy && <div className="skeleton" style={{ height: 40 }} />}

          {detail?.error && (
            <p className="purpose" style={{ margin: 0 }}>
              This call could not be loaded.
            </p>
          )}

          {detail && !detail.error && (
            <div className="trail">
              {detail.stage_results.length === 0 && (
                <p className="hint" style={{ margin: 0 }}>
                  Nothing was recorded at any stage — the call was closed straight away.
                </p>
              )}
              {detail.stage_results.map((r) => (
                <div className="trail__item" key={r.id}>
                  <div className="trail__head">
                    <span className="trail__n">{String(r.stage_number).padStart(2, '0')}</span>
                    <span>
                      {detail.stages.find((s) => s.number === r.stage_number)?.name || 'Stage'}
                    </span>
                    {r.skipped && <span className="badge">skipped</span>}
                    {r.seconds_on_stage != null && (
                      <span className="badge">{r.seconds_on_stage}s</span>
                    )}
                  </div>
                  {r.what_happened?.length > 0 && (
                    <div className="trail__tags">
                      {r.what_happened.map((h) => (
                        <span className="badge" key={h}>
                          {h}
                        </span>
                      ))}
                    </div>
                  )}
                  {r.prospect_words && <div className="trail__words">“{r.prospect_words}”</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
