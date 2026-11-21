const MAX_QUERY_LENGTH = 240;
const BLOCKED_QUERY = /\b(?:gun|firearm|weapon|ammunition|explosive|bomb|knife|drug|cocaine|heroin|methamphetamine|self[- ]harm)\b/i;

function cleanMetadata(value = "") {
  return String(value)
    .replace(/<br\\s*\\/?\\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
  if (!query) return Response.json({ error: "Enter a topic to search for research images." }, { status: 400 });
  if (BLOCKED_QUERY.test(query)) return Response.json({ error: "This visual search topic is not supported." }, { status: 400 });

  const api = new URL("https://commons.wikimedia.org/w/api.php");
  api.searchParams.set("action", "query");
  api.searchParams.set("generator", "search");
  api.searchParams.set("gsrsearch", query);
  api.searchParams.set("gsrnamespace", "6");
  api.searchParams.set("gsrlimit", "8");
  api.searchParams.set("prop", "imageinfo");
  api.searchParams.set("iiprop", "url|extmetadata");
  api.searchParams.set("iiurlwidth", "900");
  api.searchParams.set("format", "json");
  api.searchParams.set("formatversion", "2");

  try {
    const response = await fetch(api.href, {
      headers: { Accept: "application/json", "User-Agent": "NEXORA-AI-Research/1.0 (visual research; attribution displayed)" },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return Response.json({ error: "Wikimedia Commons image search is temporarily unavailable." }, { status: 502 });
    const data = await response.json();
    const pages = Array.isArray(data?.query?.pages) ? data.query.pages : [];
    const images = pages.map(page => {
      const info = page?.imageinfo?.[0];
      const meta = info?.extmetadata || {};
      const imageUrl = safeHttpUrl(info?.thumburl || info?.url || "");
      const sourceUrl = safeHttpUrl(info?.descriptionurl || "");
      const license = cleanMetadata(meta.LicenseShortName?.value || "");
      const licenseUrl = safeHttpUrl(meta.LicenseUrl?.value || "");
      if (!imageUrl || !sourceUrl || !license) return null;
      return {
        title: cleanMetadata(meta.ObjectName?.value || String(page.title || "").replace(/^File:/, "")),
        imageUrl,
        sourceUrl,
        author: cleanMetadata(meta.Artist?.value || meta.Credit?.value || "Author not identified"),
        license,
        licenseUrl,
        description: cleanMetadata(meta.ImageDescription?.value || ""),
        provider: "Wikimedia Commons"
      };
    }).filter(Boolean);
    return Response.json({ query, provider: "Wikimedia Commons", count: images.length, images }, {
      headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" }
    });
  } catch {
    return Response.json({ error: "Could not retrieve research images from Wikimedia Commons. Please retry." }, { status: 502 });
  }
}

export async function onRequest() {
  return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET" } });
}
