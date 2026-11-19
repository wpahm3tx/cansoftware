
const decodeHTML = text => String(text || "")
  .replace(/<[^>]*>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&#x27;/gi, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ")
  .trim();

function getLink(raw) {
  try {
    const url = new URL(raw.replace(/&amp;/g, "&"),
      "https://html.duckduckgo.com");

    if (url.hostname.endsWith("duckduckgo.com")) {
      const target = url.searchParams.get("uddg");
      if (!target) return null;
      const destination = new URL(target);
      return ["http:", "https:"].includes(destination.protocol)
        ? destination.href : null;
    }

    return ["http:", "https:"].includes(url.protocol)
      ? url.href : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Yalnızca POST desteklenir."
    });
  }

  try {
    const query = req.body?.query;

    if (
      typeof query !== "string" ||
      !query.trim() ||
      query.length > 250
    ) {
      return res.status(400).json({
        error: "1-250 karakterlik arama sorgusu gir."
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    let response;
    try {
      response = await fetch(
        "https://html.duckduckgo.com/html/?q=" +
        encodeURIComponent(query.trim()),
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "text/html"
          },
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return res.status(502).json({
        error: "Arama kaynağı yanıt vermedi.",
        status: response.status
      });
    }

    const html = await response.text();

    const blocks = html.split(
      /<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>/i
    ).slice(1);

    const results = [];

    for (const block of blocks) {
      const linkMatch = block.match(
        /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
      ) || block.match(
        /<a[^>]*href="([^"]+)"[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i
      );

      if (!linkMatch) continue;

      const url = getLink(linkMatch[1]);
      const title = decodeHTML(linkMatch[2]);

      if (!url || !title) continue;

      const snippetMatch = block.match(
        /<(?:a|div)[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i
      );

      results.push({
        title,
        url,
        snippet: decodeHTML(snippetMatch?.[1] || "")
      });

      if (results.length >= 6) break;
    }

    if (!results.length) {
      return res.status(503).json({
        error: "Arama sonucu alınamadı. Kaynak erişimi engelliyor veya sayfa yapısı değişmiş olabilir."
      });
    }

    return res.status(200).json({
      query: query.trim(),
      results
    });

  } catch (error) {
    console.error("CAN WEB:", error);

    return res.status(502).json({
      error: "Web araması şu anda gerçekleştirilemedi."
    });
  }
}
