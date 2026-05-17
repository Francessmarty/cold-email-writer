import Papa from 'papaparse';

// Column name patterns to detect LinkedIn URL column
const LINKEDIN_PATTERNS = [
  /linkedin/i,
  /li_url/i,
  /li url/i,
  /profile.?url/i,
  /person.?url/i,
];

// Column name patterns to detect company website column
const WEBSITE_PATTERNS = [
  /website/i,
  /company.?url/i,
  /company.?site/i,
  /web.?url/i,
  /homepage/i,
  /domain/i,
  /site/i,
  /url/i,
];

export function detectColumns(headers) {
  let linkedinCol = null;
  let websiteCol = null;

  for (const header of headers) {
    if (!linkedinCol && LINKEDIN_PATTERNS.some(p => p.test(header))) {
      linkedinCol = header;
    }
  }

  for (const header of headers) {
    // Don't re-use the same column as linkedin
    if (header === linkedinCol) continue;
    if (!websiteCol && WEBSITE_PATTERNS.some(p => p.test(header))) {
      websiteCol = header;
    }
  }

  return { linkedinCol, websiteCol };
}

function isValidLinkedIn(url) {
  if (!url || typeof url !== 'string' || !url.trim()) return false;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname === 'linkedin.com' || u.hostname.endsWith('.linkedin.com');
  } catch { return false; }
}

function isValidUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) return false;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

// Validates a row's LinkedIn and website values.
// Returns null if both are missing (row may still be processable with partial data),
// or an error string describing what failed.
export function validateRow(row, linkedinCol, websiteCol) {
  const linkedin = linkedinCol ? row[linkedinCol] : '';
  const website  = websiteCol  ? row[websiteCol]  : '';

  if (linkedin && !isValidLinkedIn(linkedin)) {
    return `LinkedIn URL must be a linkedin.com URL (got: ${linkedin})`;
  }
  if (website && !isValidUrl(website)) {
    return `Company website must be a valid URL (got: ${website})`;
  }
  return null;
}

export function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          const fatal = results.errors.find(e => e.type === 'Delimiter' || e.type === 'Quotes');
          if (fatal) {
            reject(new Error(`CSV parse error: ${fatal.message}`));
            return;
          }
        }
        const headers = results.meta.fields || [];
        const rows = results.data;
        const { linkedinCol, websiteCol } = detectColumns(headers);
        resolve({ headers, rows, linkedinCol, websiteCol });
      },
      error: (err) => reject(new Error(err.message)),
    });
  });
}
