const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const TIMEOUT_MS = 12000;

export const llmConfigured = Boolean(process.env.GEMINI_API_KEY);

/**
 * One-call helper around the Gemini generateContent REST API.
 * Kept dependency-free so the Render free instance stays light.
 */
async function generate(systemInstruction, parts, generationConfig = {}) {
  if (!llmConfigured) {
    const err = new Error('LLM is not configured on this server.');
    err.status = 503;
    err.code = 'LLM_NOT_CONFIGURED';
    throw err;
  }

  const url = GEMINI_URL.replace('{model}', encodeURIComponent(DEFAULT_MODEL));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 400,
          ...generationConfig,
        },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data?.error?.message || `LLM request failed (${res.status}).`);
      err.status = res.status === 429 ? 429 : 502;
      err.code = 'LLM_ERROR';
      throw err;
    }

    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('')
      .trim();

    if (!text) {
      const err = new Error('LLM returned an empty response.');
      err.status = 502;
      err.code = 'LLM_EMPTY';
      throw err;
    }
    return text;
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('LLM timed out.');
      err.status = 504;
      err.code = 'LLM_TIMEOUT';
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text) {
  const fenced = text.replace(/```(?:json)?/gi, '').trim();
  const start = fenced.search(/[[{]/);
  if (start === -1) return null;
  try {
    return JSON.parse(fenced.slice(start));
  } catch {
    const firstArray = fenced.slice(fenced.indexOf('['));
    try {
      return JSON.parse(firstArray);
    } catch {
      return null;
    }
  }
}

/**
 * In-call coach: given where the call is and what the prospect just said,
 * return short lines the caller can say now, plus the likely next turn.
 */
export async function coach({ stage, purpose, prospectSays, happened, prospectWords, nextStage }) {
  const system = [
    'You are a cold-call coach sitting beside a salesperson who has a prospect on the phone right now.',
    'Be blunt and practical. Maximum 60 words total. No preamble, no headings, no emoji.',
    'Answer in strict JSON: {"say":["line","line","line"],"watch":"one short risk"}',
    'Give at most 3 short "say" lines that can be spoken verbatim.',
    'If the prospect has not said anything yet, describe what to listen for instead of scripting a monologue.',
  ].join(' ');

  const user = [
    `STAGE: ${stage}`,
    `WHAT THIS STAGE IS FOR: ${purpose || 'n/a'}`,
    `WHAT PROSPECTS USUALLY SAY HERE: ${prospectSays || 'n/a'}`,
    `WHAT THE CALLER TAPPED AS HAPPENING: ${happened || 'not recorded yet'}`,
    `PROSPECT'S OWN WORDS SO FAR: ${prospectWords || 'not recorded yet'}`,
    `NEXT STAGE: ${nextStage || 'end of call'}`,
    'Coach the caller for the next 20 seconds.',
  ].join('\n');

  const text = await generate(system, [{ text: user }], { temperature: 0.5 });
  const parsed = parseJson(text);
  if (parsed && Array.isArray(parsed.say)) {
    return {
      say: parsed.say.filter((s) => typeof s === 'string').slice(0, 3),
      watch: typeof parsed.watch === 'string' ? parsed.watch : '',
      raw: text,
    };
  }
  return { say: [text], watch: '', raw: text };
}

/**
 * Turn a finished call into a short debrief: what happened, the prospect's
 * own words, and what to do next with this account.
 */
export async function debrief({ stageTrail, prospectWords, outcome }) {
  const system = [
    'You are debriefing a salesperson two minutes after a cold call ended.',
    'Return strict JSON {"summary":"2 sentences","next":"1 actionable sentence","risk":"one word: warm|lukewarm|cold"}',
    'Plain language. No headings, no markdown, no emoji.',
  ].join(' ');

  const user = [
    `OUTCOME: ${outcome || 'not recorded'}`,
    `STAGES REACHED: ${stageTrail || 'not recorded'}`,
    `PROSPECT'S OWN WORDS: ${prospectWords || 'none recorded'}`,
  ].join('\n');

  const text = await generate(system, [{ text: user }], { temperature: 0.4 });
  const parsed = parseJson(text);
  if (parsed && parsed.summary) {
    return {
      summary: String(parsed.summary),
      next: parsed.next ? String(parsed.next) : '',
      risk: parsed.risk ? String(parsed.risk) : '',
      raw: text,
    };
  }
  return { summary: text, next: '', risk: '', raw: text };
}
