/* ============================================================
   KORNIS AUTOPILOT v1.0 — autonomous PAPER trading agent
   - Trades an Alpaca PAPER account only. Shares, not options (v1):
     validates the signal engine with clean fills before options.
   - THE LAW LIVES IN CODE: risk cap, mandatory bracket, windows,
     lunch, 2:45 flat. Claude is analyst with VETO power only —
     it can never invent a trade or change a number.
   Deploy: Cloudflare Worker + KV binding named LOG + secrets:
     ALPACA_KEY, ALPACA_SECRET, PANEL_KEY
   Cron triggers:  10,40 13-19 * * 1-5   and   45 19 * * 1-5
   ============================================================ */

const RELAY = 'https://kornis-ai-relay.rick-018.workers.dev';
const ALPACA = 'https://paper-api.alpaca.markets';
const BOARD = ['SPCX','MU','PLTR','XOM','TSLA'];
const RISK_DOLLARS = 500;          // max loss per trade if stop hits
const MAX_NOTIONAL = 25000;        // position size ceiling
const PASS_LINE = 70;              // entry score floor
const ONE_TRADE_PER_DAY = true;

/* ---------------- Alpaca ---------------- */
async function alp(env, path, method, body){
  const r = await fetch(ALPACA+path,{method:method||'GET',
    headers:{'APCA-API-KEY-ID':env.ALPACA_KEY,'APCA-API-SECRET-KEY':env.ALPACA_SECRET,'Content-Type':'application/json'},
    body: body?JSON.stringify(body):undefined});
  const t = await r.text();
  let j=null; try{j=JSON.parse(t);}catch(e){}
  if(!r.ok) throw new Error('Alpaca '+path+' '+r.status+': '+t.slice(0,140));
  return j;
}

/* ---------------- clock ---------------- */
function ct(){ return new Date(new Date().toLocaleString('en-US',{timeZone:'America/Chicago'})); }
function ctMin(){ const n=ct(); return n.getHours()*60+n.getMinutes(); }
function stampCT(){ return ct().toLocaleString('en-US',{month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'}); }

/* ---------------- journal (KV) ---------------- */
async function jlog(env, entry){
  entry.t = Date.now(); entry.ct = stampCT();
  let L=[]; try{L=JSON.parse(await env.LOG.get('journal'))||[];}catch(e){}
  L.unshift(entry); while(L.length>400) L.pop();
  await env.LOG.put('journal', JSON.stringify(L));
}
async function snapEquity(env){
  try{
    const a = await alp(env,'/v2/account');
    let E=[]; try{E=JSON.parse(await env.LOG.get('equity'))||[];}catch(e){}
    E.push({t:Date.now(), eq:+a.equity});
    while(E.length>2000) E.shift();
    await env.LOG.put('equity', JSON.stringify(E));
    return +a.equity;
  }catch(e){ return null; }
}

/* ---------------- indicators (ported from the Desk) ---------------- */
function ema(a,p){const k=2/(p+1);let e=a[0];const o=[e];for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);}return o;}
function splitS(B){const S=[];let c=[B[0]];for(let i=1;i<B.length;i++){if(B[i].t-B[i-1].t>7200)S.push(c),c=[];c.push(B[i]);}S.push(c);return S;}
async function bars(tk){
  const r = await fetch(RELAY+'/?hist='+encodeURIComponent(tk)+'&i=5m&r=5d');
  const j = await r.json();
  const res=j.chart&&j.chart.result&&j.chart.result[0]; if(!res) throw new Error('no data '+tk);
  const q=res.indicators.quote[0]; const ts=res.timestamp||[]; const B=[];
  for(let i=0;i<ts.length;i++){ if(q.close[i]==null) continue;
    B.push({t:ts[i],o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i],v:q.volume[i]||0}); }
  if(!B.length) throw new Error('empty '+tk);
  return B;
}
function analyze(B5){
  const S=splitS(B5), B=S[S.length-1], prior=S.length>1?S[S.length-2]:null;
  if(B.length<10) throw new Error('young session');
  const C=B.map(b=>b.c), n=C.length-1, px=C[n];
  const e9=ema(C,9)[n];
  const sp=Math.min(20,C.length); let s20=0; for(let i=C.length-sp;i<C.length;i++)s20+=C[i]; s20/=sp;
  let pv=0,vv=0; B.forEach(b=>{pv+=((b.h+b.l+b.c)/3)*b.v; vv+=b.v;}); const vw=vv?pv/vv:px;
  let g=0,l=0; const rp=Math.min(14,C.length-1);
  for(let i=C.length-rp;i<C.length;i++){const d=C[i]-C[i-1]; if(d>0)g+=d; else l-=d;}
  const rsi=l===0?100:100-100/(1+g/l);
  const AC=B5.map(b=>b.c), e12=ema(AC,12), e26=ema(AC,26);
  const M=AC.map((_,i)=>e12[i]-e26[i]), S9=ema(M,9), N=AC.length-1;
  const h2=M[N]-S9[N], h1=M[N-1]-S9[N-1];
  const k=B.length; let pc=[];
  for(let s=0;s<S.length-1;s++){ if(S[s].length>=k) pc.push(S[s].slice(0,k).reduce((a,b)=>a+b.v,0)); }
  const rvol=pc.length?B.reduce((a,b)=>a+b.v,0)/(pc.reduce((a,b)=>a+b,0)/pc.length):null;
  let trs=[]; for(let i=1;i<B.length;i++) trs.push(Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c)));
  const atr=trs.slice(-14).reduce((a,b)=>a+b,0)/Math.max(1,Math.min(14,trs.length));
  function res15(nn){const o=[];for(let e=B5.length;e>0&&o.length<40;e-=nn){const s=Math.max(0,e-nn);const gg=B5.slice(s,e);o.unshift(gg[gg.length-1].c);}return o;}
  const c15=res15(3), c60=res15(12);
  const up15=c15[c15.length-1]>ema(c15,9)[c15.length-1];
  const up60=c60[c60.length-1]>ema(c60,9)[c60.length-1];
  let pdh=null,pdl=null,pdc=null;
  if(prior){pdh=Math.max(...prior.map(b=>b.h)); pdl=Math.min(...prior.map(b=>b.l)); pdc=prior[prior.length-1].c;}
  const dayHi=Math.max(...B.map(b=>b.h)), dayLo=Math.min(...B.map(b=>b.l));
  const chg=pdc?(px-pdc)/pdc*100:null;
  return {px,chg,e9,s20,vw,rsi,h2,h1,rvol,atr,up15,up60,pdh,pdl,pdc,dayHi,dayLo};
}
function score(A,rs){
  function side(dir){ const L=dir>0; let s=0; const why=[];
    const add=(ok,p,lbl)=>{ if(ok){s+=p; why.push('+'+lbl);} else why.push('-'+lbl); };
    add(L?A.px>A.vw:A.px<A.vw,12,'VWAP');
    add(L?A.px>A.e9:A.px<A.e9,10,'9EMA');
    add(L?A.e9>A.s20:A.e9<A.s20,7,'9v20');
    add(L===A.up15,9,'15m'); add(L===A.up60,9,'1h');
    add(L?(A.rsi>=45&&A.rsi<=72):(A.rsi>=28&&A.rsi<=55),9,'RSI');
    add(L?(A.h2>0&&A.h2>A.h1):(A.h2<0&&A.h2<A.h1),9,'MACD');
    add(A.rvol!=null&&A.rvol>=1.2,12,'RVOL');
    add(A.atr/A.px*100>=0.12,8,'MOVE');
    if(A.pdh!=null) add(L?A.px>A.pdh:A.px<A.pdl,10,'PD');
    if(rs!=null) add(L?rs>0.15:rs<-0.15,5,'RS');
    return {s:Math.min(100,s), why};
  }
  const b=side(1), r=side(-1);
  return b.s>=r.s ? {score:b.s, dir:1, side:'LONG', why:b.why} : {score:r.s, dir:-1, side:'SHORT', why:r.why};
}

/* ---------------- Claude gate: VETO power only ---------------- */
async function claudeGate(tk, A, sc, plan){
  const sys='You are the risk-officer gate of an autonomous PAPER trading agent running the Kornis Protocol. '+
    'A deterministic engine already selected this trade. You may ONLY reply with strict JSON: '+
    '{"decision":"CONFIRM"|"VETO","reason":"one sentence"} . '+
    'VETO if: signals contradict the direction, volume is hollow, the tape is chop, a scheduled binary event (major earnings/Fed) is imminent for this name today, or the setup is chasing an extended move. Otherwise CONFIRM. No other text.';
  const user='Candidate: '+tk+' '+sc.side+' score '+sc.score+'/100. Signals: '+sc.why.join(' ')+
    '. Price '+A.px.toFixed(2)+', VWAP '+A.vw.toFixed(2)+', RSI '+A.rsi.toFixed(0)+', RVOL '+(A.rvol?A.rvol.toFixed(2):'?')+
    ', dayHi '+A.dayHi.toFixed(2)+', dayLo '+A.dayLo.toFixed(2)+
    '. Plan: entry market ~'+plan.px.toFixed(2)+', stop '+plan.stop.toFixed(2)+', target '+plan.t1.toFixed(2)+', '+plan.qty+' shares.';
  try{
    const r = await fetch(RELAY,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:150,system:sys,messages:[{role:'user',content:user}]})});
    const j = await r.json();
    const txt = (j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim();
    const m = txt.match(/\{[\s\S]*\}/);
    if(m){ const d=JSON.parse(m[0]); if(d.decision==='CONFIRM'||d.decision==='VETO') return d; }
    return {decision:'VETO', reason:'gate unreadable — default safe'};
  }catch(e){ return {decision:'VETO', reason:'gate unreachable — default safe'}; }
}

/* ---------------- the cycle ---------------- */
async function run(env, manual){
  const out={mode:manual?'manual':'cron'};
  try{
    const paused = await env.LOG.get('paused');
    if(paused==='1'){ await jlog(env,{a:'SKIP',r:'paused by operator'}); return {skip:'paused'}; }

    const clock = await alp(env,'/v2/clock');
    const m = ctMin();

    /* 2:45 CT — THE FLAT LAW */
    if(m>=14*60+45){
      const pos = await alp(env,'/v2/positions');
      if(pos.length){ await alp(env,'/v2/positions?cancel_orders=true','DELETE');
        await jlog(env,{a:'FLAT-LAW',r:'2:45 CT — closed '+pos.map(p=>p.symbol).join(',')}); }
      else await jlog(env,{a:'FLAT-CHECK',r:'2:45 CT — already flat'});
      await snapEquity(env);
      return {flat:true};
    }

    if(!clock.is_open){ return {skip:'market closed'}; }

    /* manage-only windows: pre-8:35, lunch 11:00-12:30, after 14:00 */
    const entriesOpen = (m>=8*60+35 && m<11*60) || (m>=12*60+30 && m<14*60);

    const pos = await alp(env,'/v2/positions');
    if(pos.length){
      const p=pos[0];
      await jlog(env,{a:'MANAGE',r:p.symbol+' '+p.side+' '+p.qty+' @ '+(+p.avg_entry_price).toFixed(2)+
        ' · uP/L $'+(+p.unrealized_pl).toFixed(0)+' — bracket is working'});
      await snapEquity(env);
      return {managing:p.symbol};
    }

    if(!entriesOpen){ await jlog(env,{a:'WAIT',r:'window closed (pre-open / lunch / wind-down)'}); return {skip:'window'}; }

    if(ONE_TRADE_PER_DAY){
      const today = ct().toDateString();
      const last = await env.LOG.get('lastTradeDay');
      if(last===today){ await jlog(env,{a:'WAIT',r:'one-trade-per-day law: already traded today'}); return {skip:'daily cap'}; }
    }

    /* score the board */
    let bench=null; try{ bench=analyze(await bars('SPY')).chg; }catch(e){}
    let best=null;
    for(const tk of BOARD){
      try{ const A=analyze(await bars(tk));
        const rs=(bench!=null&&A.chg!=null)?A.chg-bench:null;
        const sc=score(A,rs);
        if(!best||sc.score>best.sc.score) best={tk,A,sc};
      }catch(e){}
    }
    if(!best){ await jlog(env,{a:'SKIP',r:'board unreadable'}); return {skip:'nodata'}; }
    if(best.sc.score<PASS_LINE){
      await jlog(env,{a:'PASS',r:'best was '+best.tk+' '+best.sc.side+' '+best.sc.score+'/100 — below the line ('+PASS_LINE+'). No trade is a position.'});
      return {skip:'below line', best:best.tk, score:best.sc.score};
    }

    /* compose the plan — structure-based, sized from risk */
    const A=best.A, L=best.sc.dir>0;
    let stop = L?Math.min(A.vw,A.e9):Math.max(A.vw,A.e9);
    if(L&&stop>=A.px) stop=A.px-1.6*A.atr;
    if(!L&&stop<=A.px) stop=A.px+1.6*A.atr;
    let t1 = L ? ((A.pdh&&A.pdh>A.px+0.5*A.atr)?A.pdh:A.px+2.5*A.atr)
               : ((A.pdl&&A.pdl<A.px-0.5*A.atr)?A.pdl:A.px-2.5*A.atr);
    const dist=Math.abs(A.px-stop); if(dist<=0){ await jlog(env,{a:'SKIP',r:'degenerate stop'}); return {skip:'stop'}; }
    let qty=Math.floor(RISK_DOLLARS/dist);
    qty=Math.max(1, Math.min(qty, Math.floor(MAX_NOTIONAL/A.px)));
    const plan={px:A.px, stop:+stop.toFixed(2), t1:+t1.toFixed(2), qty};

    /* Claude gate */
    const gate=await claudeGate(best.tk, A, best.sc, plan);
    if(gate.decision!=='CONFIRM'){
      await jlog(env,{a:'VETO',tk:best.tk,r:'Claude vetoed '+best.tk+' '+best.sc.side+' ('+best.sc.score+'): '+gate.reason});
      return {veto:gate.reason};
    }

    /* place bracket order — THE LAW: no bracket, no trade */
    const order={symbol:best.tk, qty:String(qty), side:L?'buy':'sell', type:'market',
      time_in_force:'day', order_class:'bracket',
      take_profit:{limit_price:String(plan.t1)},
      stop_loss:{stop_price:String(plan.stop)}};
    const placed=await alp(env,'/v2/orders','POST',order);
    await env.LOG.put('lastTradeDay', ct().toDateString());
    await jlog(env,{a:'ENTER',tk:best.tk,
      r:best.tk+' '+best.sc.side+' '+qty+' sh @ ~'+A.px.toFixed(2)+' · stop '+plan.stop+' · target '+plan.t1+
        ' · score '+best.sc.score+' ['+best.sc.why.filter(w=>w[0]==='+').join(' ')+'] · Claude: '+gate.reason,
      oid:placed.id});
    await snapEquity(env);
    return {entered:best.tk, qty, plan};
  }catch(e){
    await jlog(env,{a:'ERROR',r:String(e.message||e).slice(0,200)});
    return {error:String(e.message||e)};
  }
}

/* ---------------- HTTP panel API ---------------- */
function cors(x,code){ return new Response(JSON.stringify(x),{status:code||200,
  headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}}); }

export default {
  async scheduled(event, env, ctx){ ctx.waitUntil(run(env,false)); },
  async fetch(req, env){
    const u=new URL(req.url);
    if(req.method==='OPTIONS') return cors({ok:1});
    if(u.searchParams.get('k')!==env.PANEL_KEY) return cors({error:'bad key'},401);
    const p=u.pathname;
    try{
      if(p==='/status'){
        const a=await alp(env,'/v2/account');
        const pos=await alp(env,'/v2/positions');
        const paused=await env.LOG.get('paused');
        let E=[]; try{E=JSON.parse(await env.LOG.get('equity'))||[];}catch(e){}
        return cors({equity:+a.equity, cash:+a.cash, buying_power:+a.buying_power,
          paused:paused==='1', positions:pos, curve:E.slice(-200)});
      }
      if(p==='/journal'){ let L=[]; try{L=JSON.parse(await env.LOG.get('journal'))||[];}catch(e){}
        return cors({journal:L.slice(0,120)}); }
      if(p==='/pause'){ await env.LOG.put('paused','1'); return cors({paused:true}); }
      if(p==='/resume'){ await env.LOG.put('paused','0'); return cors({paused:false}); }
      if(p==='/run'){ const r=await run(env,true); return cors(r); }
      if(p==='/flat'){ await alp(env,'/v2/positions?cancel_orders=true','DELETE');
        await jlog(env,{a:'KILL',r:'operator forced flat'}); return cors({flat:true}); }
      return cors({routes:['/status','/journal','/run','/pause','/resume','/flat']});
    }catch(e){ return cors({error:String(e.message||e)},500); }
  }
};
