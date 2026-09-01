// api/esv.js
// Vercel serverless function — a secure proxy for the Crossway ESV API.
// Your ESV API key lives in a Vercel Environment Variable named ESV_API_KEY
// and is NEVER sent to the browser. The app calls /api/esv?passage=John+3
// and gets back clean JSON: { reference, verses: [{ verse, text }, ...] }.

export default async function handler(req, res) {
  // --- CORS (lets your app call this; we can lock this down to your domain later) ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.ESV_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'ESV_API_KEY is not set in Vercel environment variables.' });
  }

  // Accept ?passage=John+3  OR  ?book=John&chapter=3
  let passage = (req.query.passage || req.query.q || '').toString().trim();
  if (!passage && req.query.book) {
    passage = `${req.query.book} ${req.query.chapter || ''}`.trim();
  }
  if (!passage) return res.status(400).json({ error: 'Missing ?passage (e.g. ?passage=John+3)' });

  // Ask the ESV API for clean text with verse numbers and nothing else.
  const params = new URLSearchParams({
    q: passage,
    'include-passage-references': 'false',
    'include-verse-numbers': 'true',
    'include-first-verse-numbers': 'true',
    'include-footnotes': 'false',
    'include-footnote-body': 'false',
    'include-headings': 'false',
    'include-short-copyright': 'false',
    'include-copyright': 'false',
    'include-audio-link': 'false',
    'include-passage-horizontal-lines': 'false',
    'include-heading-horizontal-lines': 'false',
    'indent-poetry': 'false',
    'indent-paragraphs': '0'
  });

  try {
    const r = await fetch('https://api.esv.org/v3/passage/text/?' + params.toString(), {
      headers: { Authorization: 'Token ' + key }
    });

    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'ESV API returned ' + r.status, detail: body.slice(0, 300) });
    }

    const data = await r.json();
    const raw = (data.passages && data.passages[0]) || '';

    // Split "[1] In the beginning... [2] ..." into { verse, text } objects.
    const verses = [];
    const parts = raw.split(/\[(\d+)\]/);
    for (let i = 1; i < parts.length; i += 2) {
      const verse = parseInt(parts[i], 10);
      const text = (parts[i + 1] || '').replace(/\s+/g, ' ').trim();
      if (text) verses.push({ verse, text });
    }

    // Cache at the CDN edge for a day; the browser keeps its own small cache too.
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({ reference: data.canonical || passage, verses });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach the ESV API.' });
  }
}
