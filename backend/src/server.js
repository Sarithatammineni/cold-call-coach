import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import router from './routes.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const PORT = Number(process.env.PORT) || 10000;

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Non-browser callers (curl, health checks) have no Origin header.
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      const err = new Error('Origin not allowed.');
      err.status = 403;
      err.code = 'ORIGIN_FORBIDDEN';
      cb(err);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
  })
);

app.use(express.json({ limit: '64kb' }));

// Request log that never includes bodies (they contain the prospect's words).
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    if (req.path === '/health') return;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - t}ms`);
  });
  next();
});

app.use(router);

app.listen(PORT, () => {
  console.log(`cold-call-coach api listening on :${PORT}`);
});
