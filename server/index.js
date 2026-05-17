import express from 'express';
import cors from 'cors';

const app  = express();
const PORT = 3001;

// ── CORS: localhost only, explicit methods and headers ────────────────────────
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['content-type', 'x-api-key', 'anthropic-version', 'anthropic-beta'],
}));

// ── Request size limit: 1MB ───────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ── Rate limiter: 10 requests per minute per IP (no external package) ─────────
const rateLimitMap = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT  = 10;
const RATE_WINDOW = 60 * 1000; // ms

function rateLimit(req, res, next) {
  const ip  = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return next();
  }
  if (entry.count >= RATE_LIMIT) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: `Rate limit exceeded. Try again in ${retryAfter}s.` });
  }
  entry.count += 1;
  next();
}

// Purge stale entries every 5 minutes to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Tavily search ─────────────────────────────────────────────────────────────
// Receives: { query, apiKey, days }
// Logs full Tavily response to terminal so you can verify the key is working.
app.post('/api/tavily/search', rateLimit, async (req, res) => {
  const { query, apiKey, days = 14 } = req.body;

  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ error: 'Missing or invalid apiKey' });
  }
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Missing or empty query' });
  }
  if (query.length > 500) {
    return res.status(400).json({ error: 'Query exceeds 500 character limit' });
  }
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 30) {
    return res.status(400).json({ error: 'days must be an integer between 1 and 30' });
  }

  console.log(`\n[tavily] ▶ query: "${query}"`);

  let upstream;
  try {
    upstream = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 5,
        days,
        include_raw_content: false,
        include_answer: false,
      }),
    });
  } catch (err) {
    console.error('[tavily] Network error:', err.message);
    return res.status(502).json({ error: `Cannot reach Tavily: ${err.message}` });
  }

  const raw = await upstream.text();
  let data;
  try { data = JSON.parse(raw); }
  catch {
    console.error('[tavily] Non-JSON response:', raw.slice(0, 300));
    return res.status(502).json({ error: 'Non-JSON from Tavily' });
  }

  if (!upstream.ok) {
    console.error(`[tavily] ✗ ${upstream.status}:`, data);
  } else {
    const results = data.results || [];
    console.log(`[tavily] ✓ ${results.length} result(s) in ${data.response_time ?? '?'}s`);
    results.forEach((r, i) => {
      console.log(`  [${i + 1}] ${r.title}`);
      console.log(`       url:  ${r.url}`);
      console.log(`       date: ${r.published_date ?? 'unknown'}`);
      console.log(`       ${(r.content ?? '').slice(0, 120).replace(/\n/g, ' ')}…`);
    });
  }

  res.status(upstream.status).json(data);
});

// ── Anthropic /v1/messages proxy ──────────────────────────────────────────────
app.post('/api/anthropic/messages', rateLimit, async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ error: { message: 'Missing or invalid x-api-key header' } });
  }

  const { model, messages, max_tokens } = req.body;
  if (!model || typeof model !== 'string') {
    return res.status(400).json({ error: { message: 'Missing or invalid model field' } });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: 'messages must be a non-empty array' } });
  }
  if (typeof max_tokens !== 'number' || max_tokens < 1 || max_tokens > 4096) {
    return res.status(400).json({ error: { message: 'max_tokens must be a number between 1 and 4096' } });
  }

  const forwardHeaders = {
    'x-api-key':         apiKey,
    'anthropic-version': '2023-06-01',
    'content-type':      'application/json',
  };
  const beta = req.headers['anthropic-beta'];
  if (beta) forwardHeaders['anthropic-beta'] = beta;

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: forwardHeaders, body: JSON.stringify(req.body),
    });
  } catch (err) {
    console.error('[anthropic] Network error:', err.message);
    return res.status(502).json({ error: { message: `Cannot reach Anthropic: ${err.message}` } });
  }

  const text = await upstream.text();
  let data;
  try { data = JSON.parse(text); }
  catch {
    console.error('[anthropic] Non-JSON:', text.slice(0, 300));
    return res.status(502).json({ error: { message: 'Non-JSON from Anthropic' } });
  }

  if (!upstream.ok) console.error(`[anthropic] ${upstream.status}:`, data);

  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) res.set('retry-after', retryAfter);

  res.status(upstream.status).json(data);
});

app.listen(PORT, () => {
  console.log(`[server] proxy ready → http://localhost:${PORT}`);
  console.log('[server] Tavily searches will be logged here in full.\n');
});
