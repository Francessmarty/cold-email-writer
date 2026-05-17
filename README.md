# Cold Email Writer

A browser-based tool that researches GTM signals for a list of leads and automatically generates personalised cold emails, no manual steps between upload and download.

![Cold Email Writer screenshot](screenshot/Screenshot%202026-05-16%20125324.png)

---

## What it does

1. **Upload** a CSV of leads (needs a LinkedIn URL column and a company website column)
2. **Auto-detects** the right columns and lets you confirm or correct the mapping
3. **Researches** each lead using Tavily web search, looking for GTM signals from the last 14 days: funding rounds, product launches, new hires, SDR job postings, partnerships, expansions, and GTM motion signals
4. **Qualifies or skips** - leads with no signal in the last 14 days are marked Not Qualified automatically
5. **Generates** a personalised cold email for every qualified lead using Claude, with a specific first line tied to the signal and a natural CTA offering a demo
6. **Downloads** a CSV with all original columns plus signal data and the generated email appended

The full flow is: upload CSV, confirm columns, click Run, wait, download CSV. No manual steps in between.

---

## Writing rules baked into every email

- 70 to 95 words total
- No em dashes anywhere
- No flattery or filler ("I noticed", "I came across your profile", "congrats", "exciting")
- Plain conversational English
- Founder-to-founder tone, direct, peer-level, no selling
- Always first person ("I build", "I work with") - never third person
- First line hooks directly on the signal; body flows from it as one connected thought
- CTA offers a demo, not a call, tied naturally to the signal
- Sign-off: Best, / Frances (two lines)

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite |
| Backend proxy | Express.js (Node) |
| CSV parsing and export | PapaParse |
| Signal research | Tavily Search API |
| Email generation | Anthropic Claude API (claude-sonnet-4-6) |
| Styling | Plain CSS (dark theme) |
| Dev runner | concurrently |

The Express server exists solely to proxy Anthropic and Tavily API calls server-side, avoiding CORS restrictions when calling those APIs from a browser.

---

## How to run locally

### Prerequisites

- Node.js 18 or higher
- A Tavily API key - [app.tavily.com](https://app.tavily.com)
- An Anthropic API key - [console.anthropic.com](https://console.anthropic.com)

### Steps

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd cold-email-writer

# 2. Install dependencies
npm install

# 3. Start both the Vite frontend and Express proxy together
npm run dev
```

This starts:
- Vite dev server at `http://localhost:5173` (the app)
- Express proxy server at `http://localhost:3001` (API relay)

Open `http://localhost:5173` in your browser. On first load you will be prompted to enter your API keys. Both keys are stored in your browser's localStorage only and never leave your machine.

---

## Environment variables

This project does not use a `.env` file at runtime - API keys are entered through the in-app key gate and stored in localStorage.

If you want to extend the Express server to read keys from the environment instead, copy `.env.example` and fill in your values:

```bash
cp .env.example .env
```

```
TAVILY_API_KEY=your_tavily_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
```

---

## Project structure

```
cold-email-writer/
├── server/
│   └── index.js              # Express proxy for Tavily and Anthropic APIs
├── src/
│   ├── components/
│   │   ├── ApiKeyGate.jsx    # Key entry screen (localStorage persistence)
│   │   ├── ColumnMapper.jsx  # LinkedIn + website column confirmation
│   │   └── CSVUpload.jsx     # Drag-and-drop CSV uploader
│   ├── services/
│   │   ├── emailGenerator.js # Calls Claude to generate personalised emails
│   │   └── researchEngine.js # Tavily search + signal detection logic
│   ├── utils/
│   │   ├── csvParser.js      # CSV parsing with auto column detection
│   │   └── csvExport.js      # PapaParse CSV download with appended columns
│   ├── App.jsx               # Main app - research and generation loop
│   └── index.css             # Dark theme styles
├── .env.example              # Environment variable template
└── package.json
```

---

## Signals detected

| Signal type | What it looks for |
|---|---|
| Funding | Series A/B/C, seed rounds, raised $, investment announcements |
| Product launch | Launch, new feature, general availability, ships |
| New hire | New CRO, VP Sales, Head of Sales, Chief Revenue Officer |
| SDR job posting | Hiring SDR, BDR, sales development rep, outbound role |
| Partnership | Partners with, integrates with, strategic alliance |
| Expansion | New market, opens office, international, global launch |
| GTM motion | Go-to-market, revenue motion, outbound strategy, pipeline |

Only signals from the last 14 days qualify a lead. No signal = Not Qualified, no email generated.
