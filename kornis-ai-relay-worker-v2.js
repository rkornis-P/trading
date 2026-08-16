// KORNIS AI RELAY v2 — AI relay + CBOE chain fetcher
// Secret required in Settings > Variables & Secrets:  ANTHROPIC_API_KEY

const ALLOWED_ORIGIN = "https://rkornis-p.github.io";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);

    // ---- CBOE option chain fetch:  GET ...workers.dev/?chain=SPCX ----
    if (request.method === "GET" && url.searchParams.get("chain")) {
      const tk = url.searchParams.get("chain").toUpperCase().replace(/[^A-Z.]/g, "");
      try {
        const r = await fetch(
          "https://cdn.cboe.com/api/global/delayed_quotes/options/" + tk + ".json",
          { headers: { "User-Agent": "Mozilla/5.0" } }
        );
        if (!r.ok) throw new Error("CBOE returned " + r.status);
        const body = await r.text();
        return new Response(body, {
          headers: { ...corsHeaders(), "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: { message: "Chain fetch failed: " + err.message } }), {
          status: 502, headers: corsHeaders()
        });
      }
    }

    // ---- AI relay:  POST -> Anthropic API ----
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: { message: "POST only" } }), {
        status: 405, headers: corsHeaders()
      });
    }

    const origin = request.headers.get("Origin") || "";
    if (origin && origin !== ALLOWED_ORIGIN && !origin.startsWith("http://localhost") && origin !== "null") {
      return new Response(JSON.stringify({ error: { message: "Origin not allowed" } }), {
        status: 403, headers: corsHeaders()
      });
    }

    try {
      const body = await request.text();
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: body
      });
      const result = await upstream.text();
      return new Response(result, {
        status: upstream.status,
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: { message: "Relay error: " + err.message } }), {
        status: 500, headers: corsHeaders()
      });
    }
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}
