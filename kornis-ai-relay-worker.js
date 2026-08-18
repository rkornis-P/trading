// KORNIS AI RELAY — v4.2
// Routes:
//   GET  ?chain=TICKER  -> CBOE 15-min-delayed option chain (unchanged)
//   GET  ?hist=TICKER&i=5m&r=5d -> price bars (intraday or daily) for auto-computed RSI/MACD/ATR  (NEW)
//   GET  ?quotes=1      -> Overnight tape + full vol complex (VIX, VIX9D, VIX3M, VVIX, SKEW)
//   GET  ?scan=SYM,SYM  -> Batch daily closes (3mo) for the Decision Engine scanner  (NEW)
//   POST /              -> Anthropic AI relay (unchanged)
// Your ANTHROPIC_API_KEY secret is untouched by pasting this code.

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);

    // ---------- Option chain proxy (CBOE delayed) ----------
    const chain = url.searchParams.get("chain");
    if (request.method === "GET" && chain) {
      const t = chain.toUpperCase().replace(/[^A-Z0-9._-]/g, "");
      const r = await fetch("https://cdn.cboe.com/api/global/delayed_quotes/options/" + t + ".json");
      return new Response(await r.text(), {
        status: r.status,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ---------- Daily price history (Yahoo Finance) for auto-fill ----------
    const hist = url.searchParams.get("hist");
    if (request.method === "GET" && hist) {
      const s = hist.toUpperCase().replace(/[^A-Z0-9.^=_-]/g, "");
      const OK_I = ["1m","5m","15m","30m","1h","1d"], OK_R = ["1d","5d","1mo","3mo","6mo","1y"];
      const iv = OK_I.includes(url.searchParams.get("i")) ? url.searchParams.get("i") : "1d";
      const rg = OK_R.includes(url.searchParams.get("r")) ? url.searchParams.get("r") : "6mo";
      const r = await fetch(
        "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?interval=" + iv + "&range=" + rg + "&includePrePost=false",
        { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } }
      );
      return new Response(await r.text(), {
        status: r.status,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ---------- Scanner batch (per-symbol daily closes, 3mo) ----------
    const scan = url.searchParams.get("scan");
    if (request.method === "GET" && scan) {
      const list = scan.split(",").map(s => s.trim().toUpperCase().replace(/[^A-Z0-9.^=_-]/g, "")).filter(Boolean).slice(0, 45);
      const out = {};
      await Promise.all(list.map(async (s) => {
        try {
          const r = await fetch(
            "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?interval=1d&range=3mo",
            { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } }
          );
          const j = await r.json();
          const rr = j && j.chart && j.chart.result && j.chart.result[0];
          const closes = rr && rr.indicators && rr.indicators.quote && rr.indicators.quote[0] && rr.indicators.quote[0].close;
          if (closes && closes.length) {
            out[s] = { c: closes.filter(x => x != null), last: rr.meta ? rr.meta.regularMarketPrice : null };
          }
        } catch (e) { /* symbol skipped */ }
      }));
      return new Response(JSON.stringify({ scan: out, asOf: new Date().toISOString() }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ---------- Overnight tape (Yahoo Finance) ----------
    if (request.method === "GET" && url.searchParams.get("quotes")) {
      const syms = ["ES=F", "^FTSE", "^GDAXI", "^N225", "JPY=X", "^VIX", "^VIX9D", "^VIX3M", "^VVIX", "^SKEW"];
      const out = {};
      await Promise.all(syms.map(async (s) => {
        try {
          const r = await fetch(
            "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?interval=1d&range=5d",
            { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } }
          );
          const j = await r.json();
          const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
          if (m && m.regularMarketPrice != null) {
            const prev = (m.chartPreviousClose != null) ? m.chartPreviousClose
                       : (m.previousClose != null) ? m.previousClose : null;
            out[s] = {
              price: m.regularMarketPrice,
              prev: prev,
              chgPct: prev ? (m.regularMarketPrice - prev) / prev * 100 : null
            };
          }
        } catch (e) { /* symbol skipped; page handles gaps */ }
      }));
      // Extended-hours price for the user's ticker (pre-market / overnight sessions)
      const sym = url.searchParams.get("sym");
      if (sym) {
        try {
          const t = sym.toUpperCase().replace(/[^A-Z0-9.^=_-]/g, "");
          const r = await fetch(
            "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(t) + "?interval=5m&range=1d&includePrePost=true",
            { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } }
          );
          const j = await r.json();
          const res = j && j.chart && j.chart.result && j.chart.result[0];
          const m = res && res.meta;
          const closes = res && res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close || [];
          let last = null;
          for (let i = closes.length - 1; i >= 0; i--) { if (closes[i] != null) { last = closes[i]; break; } }
          const regClose = m ? m.regularMarketPrice : null;
          if (last != null && regClose != null) {
            out.EXT = {
              ticker: t,
              price: last,
              regularClose: regClose,
              chgPct: (last - regClose) / regClose * 100
            };
          }
        } catch (e) { /* extended quote skipped */ }
      }
      return new Response(JSON.stringify({ quotes: out, asOf: new Date().toISOString() }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ---------- AI relay (Anthropic) ----------
    if (request.method === "POST") {
      const body = await request.text();
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: body
      });
      return new Response(await r.text(), {
        status: r.status,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: true, routes: ["?chain=TICKER", "?hist=TICKER", "?quotes=1", "?scan=SYM,SYM", "POST /"] }), {
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
};
