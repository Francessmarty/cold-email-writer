import { useState } from 'react';

const LS_TAVILY    = 'cew_tavily_key';
const LS_ANTHROPIC = 'cew_anthropic_key';

export function loadKeys() {
  return {
    tavilyKey:    localStorage.getItem(LS_TAVILY)    || '',
    anthropicKey: localStorage.getItem(LS_ANTHROPIC) || '',
  };
}

export function saveKeys({ tavilyKey, anthropicKey }) {
  localStorage.setItem(LS_TAVILY,    tavilyKey);
  localStorage.setItem(LS_ANTHROPIC, anthropicKey);
}

export function clearKeys() {
  localStorage.removeItem(LS_TAVILY);
  localStorage.removeItem(LS_ANTHROPIC);
}

export default function ApiKeyGate({ onKeysSet }) {
  const saved = loadKeys();
  const [tavily,    setTavily]    = useState(saved.tavilyKey);
  const [anthropic, setAnthropic] = useState(saved.anthropicKey);
  const [error,     setError]     = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    const tk = tavily.trim();
    const ak = anthropic.trim();
    if (!tk) { setError('Tavily API key is required for signal research.'); return; }
    if (!ak) { setError('Anthropic API key is required for email generation.'); return; }
    saveKeys({ tavilyKey: tk, anthropicKey: ak });
    onKeysSet({ tavilyKey: tk, anthropicKey: ak });
  }

  return (
    <div className="keygate">
      <div className="keygate-card">
        <h2>API keys</h2>
        <p className="keygate-hint">
          Both keys are stored in your browser only and never leave your machine.
        </p>
        <form className="keygate-form" onSubmit={handleSubmit}>

          <div className="key-group">
            <label className="key-label">
              Tavily API key
              <span className="key-purpose">- used for signal research</span>
            </label>
            <input
              type="password"
              className="keygate-input"
              placeholder="tvly-..."
              value={tavily}
              onChange={e => { setTavily(e.target.value); setError(''); }}
              autoFocus
            />
          </div>

          <div className="key-group">
            <label className="key-label">
              Anthropic API key
              <span className="key-purpose">- used for email generation</span>
            </label>
            <input
              type="password"
              className="keygate-input"
              placeholder="sk-ant-..."
              value={anthropic}
              onChange={e => { setAnthropic(e.target.value); setError(''); }}
            />
          </div>

          {error && <p className="error-msg">{error}</p>}
          <button type="submit" className="btn-primary">Save and continue</button>
        </form>
      </div>
    </div>
  );
}
