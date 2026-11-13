/**
 * Server-sent events fan-out.
 *
 * Every write to the API is broadcast to every screen that is listening, so a
 * call started on one device shows up in another's history without a refresh.
 * No polling and no extra service: the API is the only writer, so it already
 * knows when something changed.
 */

const clients = new Set();

/** Comments keep proxies and the Render idle timeout from closing the pipe. */
const HEARTBEAT_MS = 20_000;
const heartbeat = setInterval(() => {
  for (const res of clients) {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      clients.delete(res);
    }
  }
}, HEARTBEAT_MS);
heartbeat.unref?.();

export function openStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Stops nginx-style proxies (Render's included) from buffering the stream.
    'X-Accel-Buffering': 'no',
  });
  // A browser reconnects on its own after this delay if the pipe drops.
  res.write('retry: 2000\n\n');
  clients.add(res);

  let closed = false;
  const drop = () => {
    if (closed) return;
    closed = true;
    clients.delete(res);
    try {
      res.end();
    } catch {
      /* the socket is already gone */
    }
  };

  req.on('close', drop);
  res.on('close', drop);
  return drop;
}

export function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of [...clients]) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

export const streamClients = () => clients.size;
