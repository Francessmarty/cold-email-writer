// Research engine — uses Tavily for fast web search (1-3s per query).
// No Anthropic calls here; signal is extracted locally from search results.

const TAVILY_URL = 'http://localhost:3001/api/tavily/search';

// ── Signal keyword matchers ───────────────────────────────────────────────────
const SIGNAL_MATCHERS = [
  {
    type: 'funding',
    patterns: [/series [a-z]/i, /raised \$/, /\$\d+[mk]/i, /funding round/i,
               /seed round/i, /venture capital/i, /investors/i, /investment of/i],
  },
  {
    type: 'product launch',
    patterns: [/launched?/i, /introducing/i, /new product/i, /new feature/i,
               /now available/i, /general availability/i, /releases?/i, /ships?/i],
  },
  {
    type: 'new hire',
    patterns: [/appointed/i, /joins as/i, /new cro\b/i, /new cso\b/i, /new cmo\b/i,
               /vp.{0,10}sales/i, /head of sales/i, /chief revenue/i,
               /director of (sales|revenue|growth)/i, /revenue leader/i],
  },
  {
    type: 'SDR job posting',
    patterns: [/hiring.{0,30}sdr/i, /sales development rep/i, /\bsdr\b.{0,20}(role|position|job)/i,
               /outbound.{0,20}(role|rep|hire)/i, /\bbdr\b/i],
  },
  {
    type: 'partnership',
    patterns: [/partnership/i, /partners with/i, /integrates? with/i,
               /collaborat/i, /teams up/i, /strategic alliance/i],
  },
  {
    type: 'expansion',
    patterns: [/expand/i, /new market/i, /opens?.{0,10}office/i,
               /international/i, /global launch/i, /new region/i],
  },
  {
    type: 'GTM motion',
    patterns: [/go.to.market/i, /gtm/i, /revenue motion/i, /sales motion/i,
               /outbound strategy/i, /pipeline/i],
  },
];

function detectSignalType(text) {
  for (const { type, patterns } of SIGNAL_MATCHERS) {
    if (patterns.some(p => p.test(text))) return type;
  }
  return null;
}

function extractDomain(url) {
  try {
    const u = url.startsWith('http') ? url : `https://${url}`;
    return new URL(u).hostname.replace(/^www\./, '');
  } catch { return url; }
}

function companyFromDomain(domain) {
  return domain.split('.')[0].replace(/-/g, ' ');
}

// Try three sources for a publication date, returning an ISO string or null.
function extractDate(result) {
  // 1. Tavily's own published_date field
  if (result.published_date && result.published_date !== 'None') {
    const d = new Date(result.published_date);
    if (!isNaN(d.getTime())) return result.published_date;
  }

  const text = `${result.title ?? ''} ${result.content ?? ''}`;

  // 2. ISO date in the text: 2025-05-13
  const iso = text.match(/\b(202[4-9])-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];

  // 3. Written month name: "May 13, 2025" or "13 May 2025"
  const mo = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
  const mdy = text.match(new RegExp(`\\b(${mo})\\s+(\\d{1,2}),?\\s+(202[4-9])\\b`, 'i'));
  if (mdy) { const d = new Date(mdy[0]); if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]; }
  const dmy = text.match(new RegExp(`\\b(\\d{1,2})\\s+(${mo})\\s+(202[4-9])\\b`, 'i'));
  if (dmy) { const d = new Date(dmy[0]); if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]; }

  // 4. Relative phrases — calculate backwards from today
  const hoursAgo = text.match(/(\d+)\s+hours?\s+ago/i);
  if (hoursAgo) return new Date().toISOString().split('T')[0];

  const daysAgo = text.match(/(\d+)\s+days?\s+ago/i);
  if (daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(daysAgo[1], 10));
    return d.toISOString().split('T')[0];
  }

  if (/\byesterday\b/i.test(text)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  if (/\b(today|just now|moments?\s+ago|an?\s+hour\s+ago)\b/i.test(text)) {
    return new Date().toISOString().split('T')[0];
  }

  return null;
}

async function tavilySearch(query, apiKey, signal) {
  let res;
  try {
    res = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, apiKey, days: 14 }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(`Cannot reach local server: ${err.message}`);
  }

  // Always parse as text first so a bad response gives a clear message
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`Server returned non-JSON (${res.status}): ${raw.slice(0, 120)}`); }

  if (!res.ok) {
    // Tavily wraps auth errors as { detail: { error: "..." } }
    const msg = data?.detail?.error || data?.error || `Tavily ${res.status}`;
    if (res.status === 401) throw new Error(`401 ${msg}`);
    throw new Error(msg);
  }

  return data.results || [];
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function researchLead(lead, tavilyKey, signal) {
  const domain  = extractDomain(lead.website || lead.linkedin || '');
  const company = companyFromDomain(domain) || 'company';

  // Fix 3: include both company name and full domain in every query
  // so results are anchored to this specific company, not a name collision.
  const queries = [
    `"${company}" ${domain} news announcement`,
    `"${company}" ${domain} hiring funding launch partnership expansion`,
  ];

  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;

  for (const query of queries) {
    const results = await tavilySearch(query, tavilyKey, signal);

    for (const r of results) {
      const text = `${r.title ?? ''} ${r.content ?? ''}`;

      // Fix 2: extract a real date — if none found, skip this result (date unknown = can't qualify)
      const dateStr = extractDate(r);
      if (!dateStr) continue;

      // Fix 1: skip anything older than 14 days
      const pub = new Date(dateStr).getTime();
      if (isNaN(pub) || pub < cutoff) continue;

      const signalType = detectSignalType(text);
      if (!signalType) continue;

      return {
        signal_found:   true,
        signal_type:    signalType,
        signal_summary: (r.title ?? '').slice(0, 140),
        signal_date:    dateStr,
        signal_source:  r.url,
      };
    }
  }

  return { signal_found: false };
}
