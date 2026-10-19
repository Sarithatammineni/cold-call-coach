export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:10000').replace(/\/$/, '');

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
  } catch {
    const err = new Error('Cannot reach the server.');
    err.code = 'NETWORK';
    throw err;
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body (sleeping instance, proxy page) falls through below */
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status}).`);
    err.code = data?.code || `HTTP_${res.status}`;
    err.status = res.status;
    throw err;
  }
  if (!data) {
    const err = new Error('The server returned an empty response.');
    err.code = 'EMPTY_RESPONSE';
    throw err;
  }
  return data;
}

export const api = {
  health: () => request('/health'),
  stages: () => request('/api/stages'),
  startCall: (payload) =>
    request('/api/calls', { method: 'POST', body: JSON.stringify(payload) }),
  saveStage: (payload) =>
    request('/api/stages/result', { method: 'POST', body: JSON.stringify(payload) }),
  closeCall: (id, payload) =>
    request(`/api/calls/${id}/close`, { method: 'POST', body: JSON.stringify(payload) }),
  listCalls: (limit = 50) => request(`/api/calls?limit=${limit}`),
  getCall: (id) => request(`/api/calls/${id}`),
  coach: (payload) => request('/api/coach', { method: 'POST', body: JSON.stringify(payload) }),
};
