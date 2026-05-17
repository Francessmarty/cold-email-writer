const API_URL = 'http://localhost:3001/api/anthropic/messages';
const MODEL   = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You write cold emails for Frances Ehinor. Follow every rule below without exception.

RULES:
- Total word count: 70 to 95 words (count carefully — reject and rewrite if outside this range)
- No em dashes (—) anywhere in the email
- No flattery or filler: never write "I love what you're doing", "I noticed", "I came across your profile", "I hope this finds you well", "congrats", "impressive", "exciting"
- No generic transitions or openers
- Plain conversational English
- Tone: founder to founder, operator to operator — direct, peer-level, no selling
- Always write in first person: "I build", "I work with", "I've seen" — never refer to Frances in third person
- The first line references the specific signal directly and concisely
- The email body flows naturally from the first line as one connected thought — no paragraph break between them

CTA RULES (the closing 1-2 sentences before the sign-off):
- The CTA must feel like it grew naturally from the body — never bolted on
- It must do both of these things:
  1. Reference in first person what I build that is relevant to their exact situation (outbound systems, SDR infrastructure, GTM tooling, pipeline automation — match it to the signal)
  2. Offer a demo naturally — say "demo" not "call" or "chat"
- No URLs, no links, no website mentions anywhere in the email
- Never use a template line. Rewrite the CTA to fit the specific signal and email every time.

SIGN-OFF:
- End with exactly these two lines, on separate lines:
  Best,
  Frances

Return ONLY this JSON — no markdown, no extra text:
{"first_line":"<opening sentence only>","full_email":"<complete email from first line through sign-off>"}`;

export async function generateEmail(lead, anthropicKey) {
  const { signal } = lead;

  const userMsg =
    `Signal type: ${signal.signal_type}\n` +
    `Signal: ${signal.signal_summary}\n` +
    `Signal date: ${signal.signal_date}\n` +
    `Company website: ${lead.website || '(not provided)'}\n` +
    `LinkedIn: ${lead.linkedin || '(not provided)'}\n\n` +
    `Write the cold email. First line must hook directly on the signal above. ` +
    `Full email must be 70-95 words total. Return JSON only.`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key':         anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`Non-JSON from Anthropic (${res.status})`); }

  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
  }

  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock?.text) throw new Error('No text block in response');

  const match = textBlock.text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in response');

  let result;
  try { result = JSON.parse(match[0]); }
  catch { throw new Error('Could not parse email JSON'); }

  if (!result.first_line || !result.full_email) {
    throw new Error('Response missing first_line or full_email');
  }

  return { firstLine: result.first_line, fullEmail: result.full_email };
}
