import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import sheet from './stageSheet.json';

const pad = (n) => String(n).padStart(2, '0');
const clock = (secs) => `${pad(Math.floor(secs / 60))}:${pad(Math.max(0, secs % 60))}`;

function useTicker(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export default function LiveCall({ initial, stages, onChange, onFinished }) {
  const call = initial.call;
  const [stageIndex, setStageIndex] = useState(initial.stageIndex ?? 0);
  const [answers, setAnswers] = useState(initial.answers ?? {});
  const [saved, setSaved] = useState(initial.saved ?? []);
  const [coach, setCoach] = useState({ lines: [], watch: '', busy: false, error: null });
  const [note, setNote] = useState(null);
  const [ending, setEnding] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(null);
  const [liveSheet, setLiveSheet] = useState(stages);

  const stageEnteredAt = useRef(Date.now());
  const wordsRef = useRef(null);

  useEffect(() => {
    if (stages?.length) setLiveSheet(stages);
  }, [stages]);

  const now = useTicker(!closed);
  const startedAt = useMemo(() => new Date(call.started_at).getTime(), [call.started_at]);
  const onCall = Math.max(0, Math.floor((now - startedAt) / 1000));

  const stage = liveSheet[stageIndex] || liveSheet[liveSheet.length - 1];
  const nextStage = liveSheet[stageIndex + 1] || null;
  const answer = answers[stage?.number] || { taps: [], words: '' };

  // Push every change up so a refresh drops the caller back into the same place.
  useEffect(() => {
    onChange({ call, stageIndex, answers, saved });
  }, [stageIndex, answers, saved, call, onChange]);

  const setAnswer = (patch) =>
    setAnswers((prev) => ({
      ...prev,
      [stage.number]: { taps: [], words: '', ...(prev[stage.number] || {}), ...patch },
    }));

  const toggleTap = (label) =>
    setAnswer({
      taps: answer.taps.includes(label)
        ? answer.taps.filter((t) => t !== label)
        : [...answer.taps, label],
    });

  async function saveStage({ advance = true, skipped = false } = {}) {
    const seconds = Math.round((Date.now() - stageEnteredAt.current) / 1000);
    setNote({ kind: 'busy', text: 'Saving…' });
    try {
      await api.saveStage({
        call_id: call.id,
        stage_number: stage.number,
        what_happened: answer.taps,
        prospect_words: answer.words,
        seconds_on_stage: seconds,
        skipped,
      });
      setSaved((prev) => (prev.includes(stage.number) ? prev : [...prev, stage.number]));
      setNote(
        skipped
          ? { kind: 'ok', text: `Stage ${stage.number} skipped.` }
          : { kind: 'ok', text: `Stage ${stage.number} saved.` }
      );
      if (advance && nextStage) {
        setStageIndex((i) => i + 1);
        stageEnteredAt.current = Date.now();
      }
    } catch (err) {
      setNote({
        kind: 'error',
        text:
          err.code === 'NETWORK'
            ? 'Could not reach the server — your tap is kept on this screen. Tap Save again.'
            : `Not saved: ${err.message}`,
      });
    }
  }

  function goToStage(i) {
    if (i < 0 || i >= liveSheet.length) return;
    setStageIndex(i);
    stageEnteredAt.current = Date.now();
    setNote(null);
  }

  async function askCoach() {
    setCoach({ lines: [], watch: '', busy: true, error: null });
    try {
      const priorWords = Object.entries(answers)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, v]) => v.words)
        .filter(Boolean)
        .join(' | ');

      const res = await api.coach({
        stage: `${stage.number}. ${stage.name} — ${stage.purpose}`,
        purpose: stage.purpose,
        prospect_says: (stage.prospects_say || []).map((s) => s.line).join(' / '),
        happened: answer.taps.join(', '),
        prospect_words: answer.words || priorWords,
        next_stage: nextStage ? `${nextStage.number}. ${nextStage.name} — ${nextStage.purpose}` : 'end of call',
      });
      setCoach({ lines: res.coach.say || [], watch: res.coach.watch || '', busy: false, error: null });
    } catch (err) {
      setCoach({
        lines: [],
        watch: '',
        busy: false,
        error:
          err.code === 'LLM_NOT_CONFIGURED'
            ? 'No LLM key on the server, so no coaching line.'
            : err.message,
      });
    }
  }

  async function closeCall() {
    if (!outcome) return;
    setClosing(true);
    setNote(null);
    const reached = saved.length ? Math.max(...saved) : stage.number;
    try {
      const res = await api.closeCall(call.id, {
        outcome: outcome.key,
        reached_stage: reached,
        outcome_note: outcome.label,
        include_debrief: true,
      });
      setClosed(res);
    } catch (err) {
      setNote({ kind: 'error', text: `Could not close the call: ${err.message}` });
      setClosing(false);
    }
  }

  /* ------------------------------------------------------------- after the call */

  if (closed) {
    return (
      <>
        <section className="card" style={{ marginTop: 8 }}>
          <div className="card__eyebrow">
            <span>Saved</span>
            <span>{clock(onCall)} on the call</span>
          </div>
          <h2 className="stage-name">{outcome.label}</h2>
          <p className="purpose">
            {call.prospect_name}
            {call.company ? ` · ${call.company}` : ''}
          </p>
          <div className="callrow__meta">
            <span className="badge badge--stage">
              Reached stage {closed.call.reached_stage} ·{' '}
              {liveSheet.find((s) => s.number === closed.call.reached_stage)?.name || '—'}
            </span>
            <span className="badge">{saved.length} stages recorded</span>
          </div>
        </section>

        {closed.debrief && (
          <section className="card">
            <div className="section__label">After the call</div>
            <p className="purpose" style={{ marginTop: 0 }}>{closed.debrief.summary}</p>
            {closed.debrief.next && (
              <div className="coach-out">
                <p className="coach-out__line">{closed.debrief.next}</p>
              </div>
            )}
          </section>
        )}

        <div className="btn-row">
          <button className="btn btn--primary btn--block" onClick={onFinished}>
            See past calls
          </button>
        </div>
      </>
    );
  }

  /* ------------------------------------------------------------- end the call */

  if (ending) {
    return (
      <>
        <section className="card" style={{ marginTop: 8 }}>
          <div className="card__eyebrow">
            <span>Close the call</span>
            <span className="timer">{clock(onCall)}</span>
          </div>
          <h2 className="stage-name">How did it end?</h2>
          <p className="purpose">
            Picking one is what makes the history screen useful: it is the only way to see which
            stages actually turn into meetings.
          </p>

          <div className="section">
            <div className="outcomes">
              {sheet.outcomes.map((o) => (
                <button
                  key={o.key}
                  className={`outcome${outcome?.key === o.key ? ' is-on' : ''}`}
                  onClick={() => setOutcome(o)}
                  type="button"
                >
                  <span className="outcome__mark" />
                  <span>
                    {o.label}
                    <span className="outcome__meta">{o.meta}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {note && <div className={`note note--${note.kind === 'ok' ? 'ok' : 'error'}`}>{note.text}</div>}

          <div className="btn-row">
            <button className="btn btn--ghost" onClick={() => setEnding(false)} disabled={closing}>
              Back
            </button>
            <button
              className="btn btn--primary"
              onClick={closeCall}
              disabled={!outcome || closing}
            >
              {closing ? 'Saving…' : 'Save the call'}
            </button>
          </div>
        </section>
      </>
    );
  }

  /* -------------------------------------------------------------- the live call */

  return (
    <>
      <header className="topbar">
        <div className="topbar__title">
          <div className="brand">
            <span className="brand__dot brand__dot--live" /> On a call
          </div>
          <h1 style={{ marginTop: 4 }}>{call.prospect_name}</h1>
          {call.company && <p className="topbar__sub">{call.company}</p>}
        </div>
        <span className="timer">{clock(onCall)}</span>
      </header>

      <nav className="stagebar" aria-label="Stages of the call">
        {liveSheet.map((s, i) => (
          <button
            key={s.number}
            type="button"
            className={`stagechip${i === stageIndex ? ' is-current' : ''}${
              saved.includes(s.number) && i !== stageIndex ? ' is-done' : ''
            }`}
            onClick={() => goToStage(i)}
            title={s.name}
          >
            <span className="stagechip__n">{s.number}</span>
            <span className="stagechip__tick">{saved.includes(s.number) ? '✓' : i === stageIndex ? '●' : ''}</span>
          </button>
        ))}
      </nav>

      <section className="card">
        <div className="card__eyebrow">
          <span>
            Stage {stage.number} of {liveSheet.length}
          </span>
          <span>{saved.includes(stage.number) ? 'Saved' : 'In progress'}</span>
        </div>

        <h2 className="stage-name">
          <span className="stage-name__n">{stage.number}</span>
          {stage.name}
        </h2>
        <p className="purpose">
          <b style={{ color: 'var(--text-faint)', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', marginRight: 8 }}>
            For
          </b>
          {stage.purpose}
        </p>

        {(stage.prospects_say || []).length > 0 && (
          <div className="section">
            <div className="section__label">
              What they <b>tend to say</b>
            </div>
            <ul className="say">
              {stage.prospects_say.map((s, i) => (
                <li key={i}>
                  {s.line}
                  {s.mean && (
                    <span className="say__mean">
                      <b>Means:</b> {s.mean}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {stage.watch_out && (
              <div className="watchout">
                <b>How it goes wrong</b>
                {stage.watch_out}
              </div>
            )}
          </div>
        )}

        <div className="section">
          <div className="section__label">What happened here</div>
          <div className="taps">
            {(stage.tap_options || []).map((t) => (
              <button
                key={t}
                type="button"
                className={`tap${answer.taps.includes(t) ? ' is-on' : ''}`}
                onClick={() => toggleTap(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="section">
          <div className="section__label">Their own words</div>
          <textarea
            ref={wordsRef}
            className="words"
            value={answer.words}
            onChange={(e) => setAnswer({ words: e.target.value })}
            placeholder="Type what they actually said — the exact phrase, not your summary."
            rows={4}
          />
          <p className="hint">Saved against stage {stage.number} when you tap Save.</p>
        </div>

        {note && note.kind !== 'busy' && (
          <div className={`note note--${note.kind === 'ok' ? 'ok' : 'error'}`}>{note.text}</div>
        )}

        <div className="btn-row">
          <button className="btn btn--ghost" onClick={() => saveStage({ skipped: true })} disabled={coach.busy}>
            Skip
          </button>
          <button
            className="btn btn--primary"
            onClick={() => saveStage()}
            disabled={coach.busy}
          >
            {nextStage ? 'Save & next stage' : 'Save this stage'}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="section__label" style={{ marginBottom: 12 }}>
          Next
        </div>
        {nextStage ? (
          <button className="next-up" type="button" onClick={() => goToStage(stageIndex + 1)}>
            <span>
              <span className="next-up__k">Stage {nextStage.number}</span>
              <span className="next-up__v">
                {nextStage.name} — {nextStage.purpose}
              </span>
            </span>
            <span className="next-up__arrow">›</span>
          </button>
        ) : (
          <p className="purpose" style={{ marginTop: 0 }}>
            This is the last stage. Ask for the slot, then close the call and pick the outcome.
          </p>
        )}

        <div className="btn-row">
          <button className="btn btn--ghost" onClick={askCoach} disabled={coach.busy}>
            {coach.busy ? 'Asking…' : 'What do I say now?'}
          </button>
          <button className="btn btn--danger" onClick={() => { setNote(null); setEnding(true); }}>
            End call
          </button>
        </div>

        {coach.busy && <div className="skeleton" style={{ marginTop: 12 }} />}

        {coach.error && <div className="note note--error">{coach.error}</div>}

        {coach.lines.length > 0 && (
          <div className="coach-out">
            {coach.lines.map((l, i) => (
              <p className="coach-out__line" key={i}>
                {l}
              </p>
            ))}
            {coach.watch && (
              <p className="coach-out__watch">
                <b>Watch</b>
                {coach.watch}
              </p>
            )}
          </div>
        )}
      </section>
    </>
  );
}

