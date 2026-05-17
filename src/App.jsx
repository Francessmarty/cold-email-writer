import { useState, useRef } from 'react';
import CSVUpload from './components/CSVUpload';
import ColumnMapper from './components/ColumnMapper';
import ApiKeyGate, { loadKeys, clearKeys } from './components/ApiKeyGate';
import { researchLead } from './services/researchEngine';
import { generateEmail } from './services/emailGenerator';
import { exportCSV } from './utils/csvExport';
import { validateRow } from './utils/csvParser';
import './App.css';

const LEAD_TIMEOUT = 30; // seconds — after this a lead is marked not_qualified

export default function App() {
  const [keys, setKeys]               = useState(() => loadKeys());
  const [step, setStep]               = useState('upload');
  const [parseResult, setParseResult] = useState(null);
  const [fileName, setFileName]       = useState('');
  const [mapping, setMapping]         = useState(null);
  const [leads, setLeads]             = useState([]);
  const [researching, setResearching] = useState(false);
  const [generating, setGenerating]   = useState(false);
  const [progress, setProgress]       = useState({ current: 0, total: 0 });
  const [genProgress, setGenProgress] = useState({ current: 0, total: 0 });
  const [elapsed, setElapsed]         = useState(0);
  const [expandedEmail, setExpandedEmail] = useState(null);
  const timerRef = useRef(null);

  const { tavilyKey, anthropicKey } = keys;
  const keysReady = tavilyKey && anthropicKey;

  if (!keysReady) {
    return <ApiKeyGate onKeysSet={k => setKeys(k)} />;
  }

  // ── Helpers ──────────────────────────────────────────────
  function updateLead(id, patch) {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }

  function handleReset() {
    setStep('upload');
    setParseResult(null);
    setFileName('');
    setMapping(null);
    setLeads([]);
    setResearching(false);
    setGenerating(false);
    setProgress({ current: 0, total: 0 });
    setGenProgress({ current: 0, total: 0 });
    setExpandedEmail(null);
    stopTimer();
  }

  function startTimer() {
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
  }

  function stopTimer() {
    clearInterval(timerRef.current);
    timerRef.current = null;
    setElapsed(0);
  }

  // ── CSV upload ───────────────────────────────────────────
  function handleUploadComplete(result, name) {
    setParseResult(result);
    setFileName(name);
    setStep('map');
  }

  function handleMappingConfirmed({ linkedinCol, websiteCol }) {
    const enriched = parseResult.rows.map((row, i) => {
      const validationError = validateRow(row, linkedinCol, websiteCol);
      return {
        id: i,
        raw: row,
        linkedin: row[linkedinCol] || '',
        website:  row[websiteCol]  || '',
        status:   validationError ? 'error' : 'pending',
        signal:   validationError ? { error: validationError } : null,
        firstLine: null,
        fullEmail: null,
      };
    });
    setMapping({ linkedinCol, websiteCol });
    setLeads(enriched);
    setStep('leads');
  }

  // ── Run all: research → email generation (fully automatic) ──
  async function runAll() {
    const pending = leads.filter(l => l.status === 'pending');
    if (!pending.length) return;

    // ── Phase 1: Signal research ──────────────────────────
    setResearching(true);
    setProgress({ current: 0, total: pending.length });

    const qualifiedLeads = []; // built locally to avoid stale state reads in phase 2

    for (let i = 0; i < pending.length; i++) {
      const lead = pending[i];
      setProgress({ current: i + 1, total: pending.length });
      updateLead(lead.id, { status: 'researching' });
      startTimer();

      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), LEAD_TIMEOUT * 1000);

      try {
        const signal = await researchLead(lead, tavilyKey, controller.signal);
        clearTimeout(timeoutId);
        if (signal.signal_found) {
          updateLead(lead.id, { status: 'researched', signal });
          qualifiedLeads.push({ ...lead, signal });
        } else {
          updateLead(lead.id, { status: 'not_qualified', signal: { signal_found: false } });
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError' || err.message?.includes('aborted')) {
          updateLead(lead.id, { status: 'not_qualified', signal: { signal_found: false, timedOut: true } });
        } else if (err.message?.includes('401')) {
          stopTimer();
          clearKeys();
          setKeys({ tavilyKey: '', anthropicKey: '' });
          setResearching(false);
          return;
        } else {
          updateLead(lead.id, { status: 'error', signal: { error: err.message } });
        }
      } finally {
        stopTimer();
      }

      if (i < pending.length - 1) await new Promise(r => setTimeout(r, 2000));
    }

    setResearching(false);

    // ── Phase 2: Email generation (auto, no user action needed) ──
    if (!qualifiedLeads.length) return;

    setGenerating(true);
    setGenProgress({ current: 0, total: qualifiedLeads.length });

    for (let i = 0; i < qualifiedLeads.length; i++) {
      const lead = qualifiedLeads[i];
      setGenProgress({ current: i + 1, total: qualifiedLeads.length });
      updateLead(lead.id, { status: 'generating' });

      try {
        const { firstLine, fullEmail } = await generateEmail(lead, anthropicKey);
        updateLead(lead.id, { status: 'done', firstLine, fullEmail });
      } catch (err) {
        if (err.message?.includes('401')) {
          clearKeys();
          setKeys({ tavilyKey: '', anthropicKey: '' });
          setGenerating(false);
          return;
        }
        updateLead(lead.id, { status: 'gen_error', firstLine: null, fullEmail: null, genError: err.message });
      }

      if (i < qualifiedLeads.length - 1) await new Promise(r => setTimeout(r, 2000));
    }

    setGenerating(false);
  }

  // ── Retry generation errors ───────────────────────────────
  async function retryGenErrors() {
    const toRetry = leads.filter(l => l.status === 'gen_error');
    if (!toRetry.length) return;

    setLeads(prev => prev.map(l =>
      l.status === 'gen_error'
        ? { ...l, status: 'generating', firstLine: null, fullEmail: null, genError: null }
        : l
    ));

    setGenerating(true);
    setGenProgress({ current: 0, total: toRetry.length });

    for (let i = 0; i < toRetry.length; i++) {
      const lead = toRetry[i];
      setGenProgress({ current: i + 1, total: toRetry.length });
      updateLead(lead.id, { status: 'generating' });

      try {
        const { firstLine, fullEmail } = await generateEmail(lead, anthropicKey);
        updateLead(lead.id, { status: 'done', firstLine, fullEmail });
      } catch (err) {
        if (err.message?.includes('401')) {
          clearKeys();
          setKeys({ tavilyKey: '', anthropicKey: '' });
          setGenerating(false);
          return;
        }
        updateLead(lead.id, { status: 'gen_error', firstLine: null, fullEmail: null, genError: err.message });
      }

      if (i < toRetry.length - 1) await new Promise(r => setTimeout(r, 2000));
    }

    setGenerating(false);
  }

  function retryResearchErrors() {
    setLeads(prev => prev.map(l =>
      l.status === 'error' ? { ...l, status: 'pending', signal: null } : l
    ));
  }

  // ── Derived ──────────────────────────────────────────────
  const countPending      = leads.filter(l => l.status === 'pending').length;
  const countResearched   = leads.filter(l => l.status === 'researched').length;
  const countDisqualified = leads.filter(l => l.status === 'not_qualified').length;
  const countResearchErr  = leads.filter(l => l.status === 'error').length;
  const countGenErr       = leads.filter(l => l.status === 'gen_error').length;
  const countDone         = leads.filter(l => l.status === 'done').length;
  const isRunning         = researching || generating;
  const allDone           = leads.length > 0 && !isRunning && countPending === 0 && countResearched === 0;
  const hasEmails         = countDone > 0;

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="app">
      <header className="app-header">
        <h1>Cold Email Writer</h1>
        <div className="header-right">
          {step !== 'upload' && (
            <button className="btn-ghost" onClick={handleReset}>Start over</button>
          )}
          <button
            className="btn-ghost btn-ghost--dim"
            onClick={() => { clearKeys(); setKeys({ tavilyKey: '', anthropicKey: '' }); }}
          >
            Clear keys
          </button>
        </div>
      </header>

      <main className="app-main">

        {step === 'upload' && (
          <section className="center-panel">
            <h2>Upload your leads CSV</h2>
            <p className="subtitle">
              Needs a LinkedIn URL column and a company website column.
            </p>
            <CSVUpload onUploadComplete={handleUploadComplete} />
          </section>
        )}

        {step === 'map' && parseResult && (
          <section className="center-panel">
            <div className="file-badge">
              <span>📄</span>
              <span>{fileName}</span>
              <span className="muted">
                {parseResult.rows.length} row{parseResult.rows.length !== 1 ? 's' : ''}
              </span>
            </div>
            <ColumnMapper
              headers={parseResult.headers}
              linkedinCol={parseResult.linkedinCol}
              websiteCol={parseResult.websiteCol}
              onConfirm={handleMappingConfirmed}
            />
          </section>
        )}

        {step === 'leads' && (
          <section className="leads-panel">

            <div className="leads-header">
              <h2>Leads: {fileName}</h2>
              <div className="leads-meta">
                <span className="badge">{leads.length} lead{leads.length !== 1 ? 's' : ''}</span>
                {countDone         > 0 && <span className="badge badge--purple">{countDone} email{countDone !== 1 ? 's' : ''} ready</span>}
                {countDisqualified > 0 && <span className="badge badge--dim">{countDisqualified} not qualified</span>}
                {(countResearchErr + countGenErr) > 0 && <span className="badge badge--red">{countResearchErr + countGenErr} error{(countResearchErr + countGenErr) !== 1 ? 's' : ''}</span>}
              </div>
            </div>

            <div className="mapping-summary">
              <span>LinkedIn col: <strong>{mapping.linkedinCol || 'none'}</strong></span>
              <span>Website col: <strong>{mapping.websiteCol || 'none'}</strong></span>
            </div>

            {/* Research status bar */}
            {researching && (
              <div className="research-status">
                <div className="status-line">
                  <span className="status-dot status-dot--active" />
                  Processing {progress.current} of {progress.total} leads
                  <span className={`elapsed-timer ${elapsed >= 20 ? 'elapsed-warning' : ''}`}>
                    {elapsed}s {elapsed >= 20 ? `(auto-skip in ${LEAD_TIMEOUT - elapsed}s)` : ''}
                  </span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Email generation status bar */}
            {generating && (
              <div className="research-status">
                <div className="status-line">
                  <span className="status-dot status-dot--active" />
                  Writing email {genProgress.current} of {genProgress.total}
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill progress-fill--green"
                    style={{ width: `${(genProgress.current / genProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <div className="table-scroll">
              <table className="leads-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>LinkedIn URL</th>
                    <th>Company Website</th>
                    <th>Signal</th>
                    <th>Signal Date</th>
                    <th>Generated Email</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead, i) => (
                    <tr key={lead.id} className={lead.status === 'researching' || lead.status === 'generating' ? 'row-active' : ''}>
                      <td className="muted row-num">{i + 1}</td>
                      <td>
                        {lead.linkedin
                          ? <a href={lead.linkedin} target="_blank" rel="noreferrer" className="url-link">{truncate(lead.linkedin, 45)}</a>
                          : <span className="muted">-</span>}
                      </td>
                      <td>
                        {lead.website
                          ? <a href={lead.website} target="_blank" rel="noreferrer" className="url-link">{truncate(lead.website, 45)}</a>
                          : <span className="muted">-</span>}
                      </td>
                      <td className="signal-cell"><SignalCell lead={lead} /></td>
                      <td className="signal-date-cell">
                        {lead.signal?.signal_found
                          ? <span className="signal-date-value">{formatSignalDate(lead.signal.signal_date) ?? <span className="muted">-</span>}</span>
                          : <span className="muted">-</span>}
                      </td>
                      <td className="email-cell">
                        <EmailCell
                          lead={lead}
                          expanded={expandedEmail === lead.id}
                          onToggle={() => setExpandedEmail(expandedEmail === lead.id ? null : lead.id)}
                        />
                      </td>
                      <td><StatusBadge status={lead.status} elapsed={lead.status === 'researching' ? elapsed : null} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="action-bar">
              {countPending > 0 && (
                <button className="btn-primary" onClick={runAll} disabled={isRunning}>
                  {researching
                    ? `Processing ${progress.current} of ${progress.total} leads…`
                    : generating
                    ? `Writing email ${genProgress.current} of ${genProgress.total}…`
                    : `Run (${countPending} lead${countPending !== 1 ? 's' : ''})`}
                </button>
              )}
              {countResearchErr > 0 && !isRunning && (
                <button className="btn-ghost" onClick={retryResearchErrors}>
                  Retry {countResearchErr} research error{countResearchErr !== 1 ? 's' : ''}
                </button>
              )}
              {countGenErr > 0 && !isRunning && (
                <button className="btn-ghost" onClick={retryGenErrors}>
                  Retry {countGenErr} generation error{countGenErr !== 1 ? 's' : ''}
                </button>
              )}
              {allDone && hasEmails && (
                <button className="btn-ghost btn-ghost--accent" onClick={() => exportCSV(leads)}>
                  Download CSV
                </button>
              )}
              {allDone && !hasEmails && (
                <p className="muted next-hint">No signals found in the last 14 days.</p>
              )}
            </div>

          </section>
        )}
      </main>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────
function formatSignalDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function SignalCell({ lead }) {
  if (!lead.signal) return <span className="muted">-</span>;
  if (lead.signal.error) return <span className="signal-error">{lead.signal.error}</span>;
  if (!lead.signal.signal_found) return <span className="muted">No signal</span>;
  const s = lead.signal;
  return (
    <div className="signal-info">
      <span className="signal-type-badge">{s.signal_type}</span>
      <span className="signal-summary">{s.signal_summary}</span>
    </div>
  );
}

function EmailCell({ lead, expanded, onToggle }) {
  if (lead.status === 'generating') {
    return <span className="muted generating-pulse">Writing…</span>;
  }
  if (lead.status === 'gen_error') {
    return <span className="signal-error">{lead.genError || 'Generation failed'}</span>;
  }
  if (!lead.firstLine) return <span className="muted">-</span>;

  return (
    <div className="email-cell-inner">
      <span className="email-first-line">{lead.firstLine}</span>
      {expanded && (
        <div className="email-full">
          <pre className="email-body">{lead.fullEmail}</pre>
          <button
            className="btn-copy"
            onClick={() => navigator.clipboard.writeText(lead.fullEmail)}
          >
            Copy
          </button>
        </div>
      )}
      <button className="btn-expand" onClick={onToggle}>
        {expanded ? 'Collapse' : 'View full email'}
      </button>
    </div>
  );
}

function StatusBadge({ status, elapsed }) {
  const map = {
    pending:       { label: 'Pending',       cls: 'status-pending' },
    researching:   { label: null,            cls: 'status-active'  },
    researched:    { label: 'Signal found',  cls: 'status-done'    },
    generating:    { label: 'Generating…',   cls: 'status-active'  },
    done:          { label: 'Email ready',   cls: 'status-done'    },
    not_qualified: { label: 'Not qualified', cls: 'status-skip'    },
    error:         { label: 'Error',         cls: 'status-error'   },
    gen_error:     { label: 'Gen error',     cls: 'status-error'   },
  };
  const { label, cls } = map[status] || { label: status, cls: '' };
  const displayLabel = status === 'researching' && elapsed !== null
    ? `Researching… ${elapsed}s`
    : (label ?? status);
  return <span className={`status-badge ${cls}`}>{displayLabel}</span>;
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}
