import { useCallback, useEffect, useState } from 'react';
import sheet from './stageSheet.json';
import { api, API_URL } from './api.js';
import LiveCall from './LiveCall.jsx';
import History from './History.jsx';

const ACTIVE_KEY = 'ccc:active:v1';

/** The live call survives a refresh, a lock screen and a browser crash. */
function loadActive() {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.call?.id ? parsed : null;
  } catch {
    return null;
  }
}

function persistActive(state) {
  try {
    if (state) localStorage.setItem(ACTIVE_KEY, JSON.stringify(state));
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* private mode / quota — the server copy is the one that matters */
  }
}

export default function App() {
  const [stages, setStages] = useState(sheet.stages);
  const [stagesFromDb, setStagesFromDb] = useState(false);
  const [active, setActive] = useState(loadActive);
  const [view, setView] = useState(() => (loadActive() ? 'live' : 'start'));
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .stages()
      .then((res) => {
        if (!cancelled && Array.isArray(res.stages) && res.stages.length) {
          setStages(res.stages);
          setStagesFromDb(true);
        }
      })
      .catch(() => {
        /* bundled sheet stays on screen; nothing here is worth interrupting for */
      });

    api
      .health()
      .then((h) => !cancelled && setHealth(h))
      .catch(() => !cancelled && setHealth({ status: 'unreachable' }));

    return () => {
      cancelled = true;
    };
  }, []);

  const startCall = useCallback(async (payload) => {
    const res = await api.startCall(payload);
    const next = { call: res.call, stageIndex: 0, answers: {}, saved: [] };
    setActive(next);
    persistActive(next);
    setView('live');
    return res;
  }, []);

  const updateActive = useCallback((next) => {
    setActive(next);
    persistActive(next);
  }, []);

  const finishCall = useCallback(() => {
    setActive(null);
    persistActive(null);
    setView('history');
  }, []);

  const dbLive = health?.db?.ok && health?.llm?.configured;

  return (
    <div className={`app${view === 'history' ? ' app--wide' : ''}`}>
      {view !== 'live' && (
        <header className="topbar">
          <div className="topbar__title">
            <div className="brand">
              <span className={`brand__dot${dbLive ? ' brand__dot--live' : ''}`} />
              {stagesFromDb ? 'Cold call coach' : 'Cold call coach'}
            </div>
            <h1 style={{ marginTop: 4 }}>
              {view === 'history' ? 'Past calls' : 'Start a call'}
            </h1>
          </div>
          {view === 'history' ? (
            <button className="btn btn--ghost" onClick={() => setView('start')}>
              New call
            </button>
          ) : (
            <button className="btn btn--ghost" onClick={() => setView('history')}>
              Past calls
            </button>
          )}
        </header>
      )}

      {view === 'live' && active && (
        <LiveCall
          initial={active}
          stages={stages}
          onChange={updateActive}
          onFinished={finishCall}
        />
      )}

      {view === 'start' && <StartScreen onStart={startCall} />}

      {view === 'history' && <History stages={stages} />}

      <footer className="footer-note">
        {health?.status === 'ok' ? (
          <>
            Connected · {API_URL}
            <br />
            LLM {health.llm?.configured ? health.llm.model : 'not configured'} ·{' '}
            {stagesFromDb ? 'stages from Supabase' : 'stages bundled (Supabase not reachable)'}
          </>
        ) : health === null ? (
          'Checking the server…'
        ) : (
          <>
            Server asleep or unreachable — {API_URL}
            <br />
            Render free instances wake on the first request, up to about a minute.
          </>
        )}
      </footer>
    </div>
  );
}

function StartScreen({ onStart }) {
  const [form, setForm] = useState({ prospect_name: '', company: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.prospect_name.trim()) {
      setError('A name is enough. It is what the history screen is sorted by.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onStart(form);
    } catch (err) {
      setError(
        err.code === 'NETWORK' || err.status >= 500
          ? 'The server did not answer. The first request after idle can take up to a minute — try again.'
          : err.message
      );
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card" style={{ marginTop: 8 }}>
        <p className="big-lead">
          Dial, then start the call here. The screen keeps you on the eight stages: what this one
          is for, what prospects tend to say, what happened, their own words, and what comes next.
        </p>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="prospect">Prospect</label>
            <input
              id="prospect"
              value={form.prospect_name}
              onChange={set('prospect_name')}
              placeholder="Who is on the phone?"
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="company">Company</label>
            <input
              id="company"
              value={form.company}
              onChange={set('company')}
              placeholder="Optional"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="phone">Number</label>
            <input
              id="phone"
              value={form.phone}
              onChange={set('phone')}
              placeholder="Optional — kept out of the history screen"
              autoComplete="off"
              inputMode="tel"
            />
          </div>

          {error && <div className="note note--error">{error}</div>}

          <div className="btn-row">
            <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
              {busy ? 'Starting…' : 'Start the call'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="section__label">The eight stages</div>
        <ol className="say" style={{ counterReset: 's' }}>
          {sheet.stages.map((s) => (
            <li key={s.number} style={{ borderLeftColor: 'var(--accent)' }}>
              <b>{s.name}</b>
              <span className="say__mean">{s.purpose}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
