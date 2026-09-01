/* ============================================================
   KORNIS AI RELAY v5.1 — hardened data + AI passthrough
   Paste over the existing kornis-ai-relay worker (NOT autopilot).

   Endpoints (contract unchanged — every page keeps working):
     POST /            → Anthropic /v1/messages passthrough
     GET  /?hist=TK    → price history  (&i=5m&r=5d etc)
     GET  /?chain=TK   → options chain (CBOE shape: data.options[])
     GET  /?pm=TK      → pre/post-market last price + gap vs prior close
     GET  /?hist=TK&pp=1 → history INCLUDING pre/post bars

   v5 upgrades:
     · CHAIN: CBOE primary → Yahoo options fallback (normalized
       to the same shape), each with retry + timeout
     · Yahoo cookie+crumb handshake done correctly (fixes 401
       "Invalid Crumb"), crumb cached in-memory per isolate
     · Edge caching: hist 60s, chain 10 min — plus a 24h stale
       copy served automatically if every upstream fails
     · Clear JSON errors that say which upstream failed and why
   Secrets: uses ANTHROPIC_KEY or ANTHROPIC_API_KEY or CLAUDE_KEY
   ============================================================ */

const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
let YCRUMB=null, YCOOKIE=null, YTS=0;

function cors(body, code, type){
  return new Response(body, {status:code||200, headers:{
    'Content-Type':type||'application/json',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'*',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS'}});
}
function jerr(msg, code){ return cors(JSON.stringify({error:msg}), code||502); }

async function fWithTimeout(url, opts, ms){
  return fetch(url, Object.assign({}, opts, {signal:AbortSignal.timeout(ms||8000)}));
}

/* ---------- edge cache with stale-if-error ---------- */
async function cachedFetch(cacheKeyUrl, ttl, staleTtl, producer){
  const cache = caches.default;
  const freshKey = new Request(cacheKeyUrl);
  const staleKey = new Request(cacheKeyUrl + '&__stale=1');
  const hit = await cache.match(freshKey);
  if(hit) return new Response(hit.body, hit);
  try{
    const body = await producer();                    // string on success, throws on failure
    const resp = new Response(body, {headers:{'Content-Type':'application/json','Cache-Control':'public, max-age='+ttl}});
    await cache.put(freshKey, resp.clone());
    await cache.put(staleKey, new Response(body, {headers:{'Content-Type':'application/json','Cache-Control':'public, max-age='+staleTtl}}));
    return resp;
  }catch(e){
    const stale = await cache.match(staleKey);
    if(stale){
      const r = new Response(stale.body, stale);
      r.headers.set('X-Kornis-Stale','1');
      return r;
    }
    throw e;
  }
}

/* ---------- Yahoo crumb handshake ---------- */
async function yahooAuth(force){
  if(!force && YCRUMB && Date.now()-YTS < 30*60*1000) return;
  const r1 = await fWithTimeout('https://fc.yahoo.com/', {headers:{'User-Agent':UA}}, 6000).catch(()=>null);
  let cookie = r1 && r1.headers.get('set-cookie');
  if(cookie) cookie = cookie.split(';')[0];
  if(!cookie){
    const r1b = await fWithTimeout('https://finance.yahoo.com/', {headers:{'User-Agent':UA}}, 6000).catch(()=>null);
    cookie = r1b && r1b.headers.get('set-cookie'); if(cookie) cookie=cookie.split(';')[0];
  }
  if(!cookie) throw new Error('yahoo cookie unavailable');
  const r2 = await fWithTimeout('https://query2.finance.yahoo.com/v1/test/getcrumb',
    {headers:{'User-Agent':UA,'Cookie':cookie}}, 6000);
  const crumb = (await r2.text()).trim();
  if(!crumb || crumb.length>32===false && crumb.includes('<')) throw new Error('yahoo crumb unavailable');
  YCRUMB=crumb; YCOOKIE=cookie; YTS=Date.now();
}

/* ---------- price history (Yahoo chart) ---------- */
async function histProducer(tk, iv, rng, pp){
  const path='/v8/finance/chart/'+encodeURIComponent(tk)+'?interval='+encodeURIComponent(iv)+'&range='+encodeURIComponent(rng)+'&includePrePost='+(pp?'true':'false');
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
    try{
      let r = await fWithTimeout('https://'+host+path, {headers:{'User-Agent':UA}}, 8000);
      if(r.status===401||r.status===403||r.status===429){
        await yahooAuth(true);
        r = await fWithTimeout('https://'+host+path+'&crumb='+encodeURIComponent(YCRUMB),
              {headers:{'User-Agent':UA,'Cookie':YCOOKIE}}, 8000);
      }
      const t = await r.text();
      if(r.ok && t.includes('"chart"')) return t;
    }catch(e){}
  }
  throw new Error('history feed unavailable (all hosts)');
}

/* ---------- options chain: CBOE primary, Yahoo fallback ---------- */
async function chainProducer(tk){
  /* 1) CBOE delayed quotes — native shape the platform expects */
  for(const sym of ['_'+tk, tk]){ // CBOE indexes some symbols with underscore prefix
    try{
      const r = await fWithTimeout('https://cdn.cboe.com/api/global/delayed_quotes/options/'+encodeURIComponent(sym)+'.json',
        {headers:{'User-Agent':UA,'Accept':'application/json'}}, 8000);
      if(r.ok){
        const t = await r.text();
        if(t.includes('"options"')) return t;
      }
    }catch(e){}
  }
  /* 2) Yahoo options — normalize to CBOE shape */
  await yahooAuth(false);
  const base='https://query2.finance.yahoo.com/v7/finance/options/'+encodeURIComponent(tk);
  async function yfetch(url){
    let r = await fWithTimeout(url+(url.includes('?')?'&':'?')+'crumb='+encodeURIComponent(YCRUMB),
      {headers:{'User-Agent':UA,'Cookie':YCOOKIE}}, 8000);
    if(r.status===401||r.status===403){ await yahooAuth(true);
      r = await fWithTimeout(url+(url.includes('?')?'&':'?')+'crumb='+encodeURIComponent(YCRUMB),
        {headers:{'User-Agent':UA,'Cookie':YCOOKIE}}, 8000); }
    if(!r.ok) throw new Error('yahoo options '+r.status);
    return r.json();
  }
  const first = await yfetch(base);
  const res0 = first && first.optionChain && first.optionChain.result && first.optionChain.result[0];
  if(!res0) throw new Error('yahoo options empty');
  const spot = res0.quote && (res0.quote.regularMarketPrice!=null ? res0.quote.regularMarketPrice : res0.quote.postMarketPrice);
  const expiries = (res0.expirationDates||[]).slice(0,6); // ~6 nearest expiries covers 3-21 DTE
  const opts=[];
  function eat(res){
    const o=res && res.options && res.options[0]; if(!o) return;
    for(const side of ['calls','puts']){
      for(const c of (o[side]||[])){
        if(!c.contractSymbol) continue;
        opts.push({option:c.contractSymbol, bid:c.bid||0, ask:c.ask||0,
          open_interest:c.openInterest||0, volume:c.volume||0,
          iv:c.impliedVolatility||null, last:c.lastPrice||0});
      }
    }
  }
  eat(res0);
  for(const d of expiries.slice(1)){
    try{ const j=await yfetch(base+'?date='+d); const rr=j.optionChain&&j.optionChain.result&&j.optionChain.result[0]; eat(rr); }catch(e){}
  }
  if(!opts.length) throw new Error('yahoo options: no contracts');
  return JSON.stringify({source:'yahoo-fallback', data:{current_price:spot, close:spot, options:opts}});
}

/* ---------- Anthropic passthrough ---------- */
async function anthropic(req, env){
  const key = env.ANTHROPIC_KEY || env.ANTHROPIC_API_KEY || env.CLAUDE_KEY;
  if(!key) return jerr('relay missing Anthropic key secret (name it ANTHROPIC_KEY)', 500);
  const body = await req.text();
  const r = await fWithTimeout('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
    body}, 60000);
  return cors(await r.text(), r.status);
}

export default {
  async fetch(req, env){
    if(req.method==='OPTIONS') return cors('{}');
    const u = new URL(req.url);
    if(req.method==='POST') return anthropic(req, env);

    const hist = u.searchParams.get('hist');
    const chain = u.searchParams.get('chain');
    try{
      const pm = u.searchParams.get('pm');
      if(pm){
        const key='https://kornis-cache/pm?tk='+pm.toUpperCase();
        const resp=await cachedFetch(key, 45, 3600, async()=>{
          const t=await histProducer(pm.toUpperCase(),'5m','1d',true);
          const j=JSON.parse(t);const res=j.chart&&j.chart.result&&j.chart.result[0];
          if(!res) throw new Error('no pm data');
          const q=res.indicators.quote[0];const ts=res.timestamp||[];
          let last=null,lastT=null;
          for(let i=ts.length-1;i>=0;i--){ if(q.close[i]!=null){ last=q.close[i]; lastT=ts[i]; break; } }
          const prev=res.meta.chartPreviousClose||res.meta.previousClose||null;
          const reg=res.meta.regularMarketPrice||null;
          return JSON.stringify({tk:pm.toUpperCase(), last, lastT, prevClose:prev, regular:reg,
            gapPct:(last!=null&&prev)?(last-prev)/prev*100:null, state:res.meta.currentTradingPeriod?undefined:undefined});
        });
        const out=new Response(resp.body,resp); out.headers.set('Access-Control-Allow-Origin','*'); return out;
      }
      if(hist){
        const iv = u.searchParams.get('i')||'5m';
        const rng = u.searchParams.get('r')||'5d';
        const pp = u.searchParams.get('pp')==='1';
        const key = 'https://kornis-cache/hist?tk='+hist.toUpperCase()+'&i='+iv+'&r='+rng+(pp?'&pp=1':'');
        const resp = await cachedFetch(key, 60, 86400, ()=>histProducer(hist.toUpperCase(), iv, rng, pp));
        const out = new Response(resp.body, resp);
        out.headers.set('Access-Control-Allow-Origin','*');
        return out;
      }
      if(chain){
        const key = 'https://kornis-cache/chain?tk='+chain.toUpperCase();
        const resp = await cachedFetch(key, 600, 86400, ()=>chainProducer(chain.toUpperCase()));
        const out = new Response(resp.body, resp);
        out.headers.set('Access-Control-Allow-Origin','*');
        return out;
      }
      return cors(JSON.stringify({relay:'kornis v5.1', routes:['POST / (anthropic)','GET /?hist=TK&i=5m&r=5d[&pp=1]','GET /?chain=TK','GET /?pm=TK']}));
    }catch(e){
      return jerr(String(e.message||e), 502);
    }
  }
};
