const MAX_BODY_BYTES = 16 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function validateBrowserUrl(value) {
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("Provide a valid website URL.");
  }
  let url;
  try { url = new URL(value); } catch { throw new Error("The website URL is invalid."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Only public HTTP and HTTPS website URLs are supported.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" || host.endsWith(".localhost") ||
    host.endsWith(".local") || host.endsWith(".internal") ||
    host === "metadata.google.internal" || host === "169.254.169.254" ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")
  ) {
    throw new Error("Private, local, and link-local network destinations are blocked.");
  }
  url.hash = "";
  return url;
}

export async function handleBrowserRequest(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!env.BROWSER || typeof env.BROWSER.quickAction !== "function") {
    return json({ error: "Cloudflare Browser Run is not configured. Add the BROWSER binding and deploy the gateway." }, 503);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json({ error: "Browser request is too large." }, 413);
  }

  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "A valid JSON body is required." }, 400); }
  const action = body?.action;
  if (!["read", "links", "screenshot", "click"].includes(action)) {
    return json({ error: "Supported actions are read, links, screenshot, and click." }, 400);
  }

  let target;
  try { target = validateBrowserUrl(action === "click" ? body.href : body.url); }
  catch (error) { return json({ error: error.message }, 400); }

  try {
    const quickAction = action === "read" || action === "click" ? "markdown" : action;
    const result = await env.BROWSER.quickAction(quickAction, { url: target.toString() });
    if (!(result instanceof Response)) {
      return json({ action, url: target.toString(), result });
    }
    if (!result.ok) {
      return json({ error: "Browser Run returned HTTP " + result.status + ".", url: target.toString() }, 502);
    }
    if (action === "screenshot") {
      const bytes = new Uint8Array(await result.arrayBuffer());
      if (bytes.byteLength > 5 * 1024 * 1024) return json({ error: "Screenshot exceeded the 5 MB limit." }, 502);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return json({ action, url: target.toString(), contentType: result.headers.get("content-type") || "image/png", dataUrl: "data:image/png;base64," + btoa(binary) });
    }
    const text = await result.text();
    let data = text;
    try { data = JSON.parse(text); } catch {}
    return json({ action, url: target.toString(), result: data });
  } catch (error) {
    console.error("ATLAS Browser Run failed", error?.message || "unknown error");
    return json({ error: "The browser could not complete that request. The site may block automated access or Browser Run may be unavailable." }, 502);
  }
}
