
const clean = (value) =>
  String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

function validUrl(value) {
  try {
    const url = new URL(value, "https://html.duckduckgo.com");

    if (url.hostname.endsWith("duckduckgo.com")) {
      const target = url.searchParams.get("uddg");
      if (!target) return null;
      return validUrl(target);
    }

    return ["http:", "https:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

async function getPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CANSoftwareAI/1.0)",
        Accept: "text/html, application/rss+xml, application/xml",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function searchDuckDuckGo(query) {
  const html = await getPage(
    "https://html.duckduckgo.com/html/?q=" +
      encodeURIComponent(query)
  );

  const blocks = html
    .split(/<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>/i)
    .slice(1);

  const results = [];

  for (const block of blocks) {
    const match =
      block.match(
        /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
      ) ||
      block.match(
        /<a[^>]*href="([^"]+)"[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i
      );

    if (!match) continue;

    const url = validUrl(match[1]);
    const title = clean(match[2]);

    const snippet = block.match(
      /<(?:a|div)[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i
    );

    if (url && title) {
      results.push({
        title,
        url,
        snippet: clean(snippet?.[1]),
      });
    }

    if (results.length >= 6) break;
  }

  return results;
}

async function searchBingRSS(query) {
  const xml = await getPage(
    "https://www.bing.com/search?format=rss&q=" +
      encodeURIComponent(query)
  );

  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];

  return items
    .map((item) => {
      const title = item.match(/<title>([\s\S]*?)<\/title>/i);
      const link = item.match(/<link>([\s\S]*?)<\/link>/i);
      const description = item.match(
        /<description>([\s\S]*?)<\/description>/i
      );

      return {
        title: clean(title?.[1]),
        url: validUrl(clean(link?.[1])),
        snippet: clean(description?.[1]),
      };
    })
    .filter((item) => item.title && item.url)
    .slice(0, 6);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Yalnızca POST destekleniyor.",
    });
  }

  const query = req.body?.query;

  if (
    typeof query !== "string" ||
    !query.trim() ||
    query.length > 250
  ) {
    return res.status(400).json({
      error: "1-250 karakterlik arama sorgusu gir.",
    });
  }

  const errors = [];

  for (const provider of [
    { name: "DuckDuckGo", search: searchDuckDuckGo },
    { name: "Bing RSS", search: searchBingRSS },
  ]) {
    try {
      const results = await provider.search(query.trim());

      if (results.length > 0) {
        return res.status(200).json({
          query: query.trim(),
          results,
          source: provider.name,
        });
      }

      errors.push(`${provider.name}: Sonuç bulunamadı`);
    } catch (error) {
      console.error(`CAN SEARCH ${provider.name}:`, error);
      errors.push(`${provider.name}: ${error.message}`);
    }
  }

  return res.status(503).json({
    error: "Web araştırması kaynaklarına erişilemedi.",
    details: errors,
  });
}
