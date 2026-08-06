// api/passage.js
// -----------------------------------------------------------------------------
// Lifelight ESV proxy — Vercel Serverless Function
//
// WHY THIS EXISTS:
//   The ESV API key must NEVER live in the browser (anyone could read it and
//   get it revoked). This function runs on Vercel's server, holds the key in a
//   private environment variable, calls Crossway on the app's behalf, and hands
//   back clean verse text. The Lifelight app talks to THIS endpoint, not to
//   Crossway directly.
//
// HOW THE APP CALLS IT:
//   /api/passage?q=John+3:16
//   /api/passage?q=Proverbs+3:5-6&numbers=true
//
// QUERY PARAMS:
//   q        (required) the passage reference, e.g. "John 3:16"
//   numbers  (optional) "true" to keep verse numbers in the text; default off
//
// RETURNS (JSON):
//   { ok: true, reference: "John 3:16", text: "For God so loved the world...",
//     query: "John 3:16" }
//   or on error:
//   { ok: false, error: "..." }
// -----------------------------------------------------------------------------

const ESV_ENDPOINT = "https://api.esv.org/v3/passage/text/";

export default async function handler(req, res) {
  // The key is read from Vercel's environment — it is never in the code.
  const API_KEY = process.env.ESV_API_KEY;

  if (!API_KEY) {
    // This only happens if the env var wasn't set in Vercel yet.
    res.status(500).json({
      ok: false,
      error: "Server is missing ESV_API_KEY. Set it in Vercel project settings.",
    });
    return;
  }

  // Accept either ?q= or ?ref= for convenience.
  const q = (req.query.q || req.query.ref || "").toString().trim();
  if (!q) {
    res.status(400).json({
      ok: false,
      error: "Missing passage. Use ?q=John+3:16",
    });
    return;
  }

  const keepNumbers = String(req.query.numbers) === "true";

  // Build the ESV request. We strip everything that would clutter a game or
  // reader view: headings, footnotes, cross-refs, the reference line, and the
  // ESV's own inline copyright line (Lifelight shows the required notice in the
  // app UI instead). Verse numbers are off by default; the app can ask for them.
  const params = new URLSearchParams({
    q,
    "include-passage-references": "false",
    "include-verse-numbers": keepNumbers ? "true" : "false",
    "include-first-verse-numbers": keepNumbers ? "true" : "false",
    "include-footnotes": "false",
    "include-footnote-body": "false",
    "include-headings": "false",
    "include-short-copyright": "false",
    "include-copyright": "false",
    "include-passage-horizontal-lines": "false",
    "include-heading-horizontal-lines": "false",
    "indent-paragraphs": "0",
    "indent-poetry": "false",
  });

  try {
    const esvResp = await fetch(`${ESV_ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Token ${API_KEY}` },
    });

    if (!esvResp.ok) {
      // Pass Crossway's status through so we can see rate-limit (429) etc.
      const detail = await esvResp.text().catch(() => "");
      res.status(esvResp.status).json({
        ok: false,
        error: `ESV API returned ${esvResp.status}`,
        detail: detail.slice(0, 300),
      });
      return;
    }

    const data = await esvResp.json();
    const passages = Array.isArray(data.passages) ? data.passages : [];
    const text = passages.join("\n\n").trim();

    if (!text) {
      res.status(404).json({
        ok: false,
        error: `No passage found for "${q}". Check the reference.`,
      });
      return;
    }

    // Let Vercel's CDN briefly cache identical requests. This cuts down on
    // calls to Crossway without holding text long-term (well within limits).
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");

    res.status(200).json({
      ok: true,
      reference: data.canonical || q,
      text,
      query: q,
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: "Could not reach the ESV API.",
      detail: String(err).slice(0, 300),
    });
  }
}
