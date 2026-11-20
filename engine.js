/* ============================================================
   KORNIS SIGNAL ENGINE — engine.js  v1.0  (Nov 18, 2026)
   The one copy of the entry logic. today.html runs it live; audit.html replays it on real tape.
   If a rule changes, it changes here, and the audit shows what it did.

   RULES.LEGACY = exactly what today.html did through Sep 29 (the version that lost money).
   RULES.FIXED  = the corrected rules. setRules('FIXED') is the default.
   ============================================================ */
const ENGINE_VERSION='1.0';
const RULES={
  LEGACY:{closedCandleOnly:false,requireClosed:false,levelAge:0,firstOnly:false,chopBlocksBreak:false,pastMax:0.8,pastMaxOpen:1.2,gradeAtEntry:false},
  FIXED: {closedCandleOnly:true, requireClosed:true, levelAge:3,firstOnly:true, chopBlocksBreak:true, pastMax:0.35,pastMaxOpen:0.6,gradeAtEntry:true}
};
let KR=Object.assign({name:'FIXED'},RULES.FIXED);
function setRules(name){KR=Object.assign({name},RULES[name]||RULES.FIXED);return KR;}
function _PM(){try{return (typeof PM!=='undefined'&&PM)||{};}catch(e){return {};}}
function _RELAY(){try{return (typeof RELAY!=='undefined'&&RELAY)||'https://kornis-ai-relay.rick-018.workers.dev';}catch(e){return 'https://kornis-ai-relay.rick-018.workers.dev';}}

/* ---------- indicators ---------- */
const _DS=new Map();function ctDate(t){let v=_DS.get(t);if(v===undefined){v=new Date(t*1000).toLocaleDateString('en-US',{timeZone:'America/Chicago'});_DS.set(t,v);}return v;}
function emaAll(c,p){const k=2/(p+1);let e=null;return c.map(x=>{e=e==null?x:x*k+e*(1-k);return e;});}
function smaAll(c,p){return c.map((x,i)=>{if(i<p-1)return null;let s=0;for(let j=i-p+1;j<=i;j++)s+=c[j];return s/p;});}
function vwapAll(T,H,L,C,V){const out=[];let d0=null,pv=0,vv=0;for(let i=0;i<C.length;i++){const dd=ctDate(T[i]);if(dd!==d0){d0=dd;pv=0;vv=0;}const tp=(H[i]+L[i]+C[i])/3;pv+=tp*(V[i]||0);vv+=(V[i]||0);out.push(vv?pv/vv:C[i]);}return out;}
function macdHist(c){const f=emaAll(c,12),s=emaAll(c,26);const m=c.map((_,i)=>f[i]-s[i]);const sig=emaAll(m,9);return m.map((x,i)=>x-sig[i]);}
function rsiAll(c,p){let g=0,l=0;const out=[];for(let i=0;i<c.length;i++){if(i===0){out.push(null);continue;}const ch=c[i]-c[i-1];const up=ch>0?ch:0,dn=ch<0?-ch:0;if(i<=p){g+=up;l+=dn;out.push(i===p?100-100/(1+(g/p)/((l/p)||1e-9)):null);}else{g=(g*(p-1)+up)/p;l=(l*(p-1)+dn)/p;out.push(100-100/(1+g/(l||1e-9)));}}return out;}
async function pull(tk){
  const r=await fetch(_RELAY()+'/?hist='+encodeURIComponent(tk)+'&i=5m&r=10d');const j=await r.json();
  const res=j.chart&&j.chart.result&&j.chart.result[0];if(!res)throw new Error('no data');
  const q=res.indicators.quote[0],ts=res.timestamp||[];const T=[],H=[],L=[],C=[],V=[],O=[];
  for(let i=0;i<ts.length;i++){if(q.close[i]==null)continue;T.push(ts[i]);H.push(q.high[i]);L.push(q.low[i]);C.push(q.close[i]);V.push(q.volume[i]||0);O.push(q.open[i]!=null?q.open[i]:q.close[i]);}
  return {T,O,H,L,C,V,pc:res.meta.chartPreviousClose||null,stale:!!j._stale};   /* _stale: relay v5.2 marks its emergency 24h copy */
}
function analyze(b,asOf){
  const n=b.C.length-1,px=b.C[n];const e9=emaAll(b.C,9),s20=smaAll(b.C,20),vw=vwapAll(b.T,b.H,b.L,b.C,b.V),rsi=rsiAll(b.C,14),mh=macdHist(b.C);
  const days=[];let cur=[],d0=null;for(let i=0;i<b.T.length;i++){const d=ctDate(b.T[i]);if(d0!==null&&d!==d0){days.push(cur);cur=[];}d0=d;cur.push(i);}days.push(cur);
  const today=days[days.length-1],prior=days.length>1?days[days.length-2]:null;
  const pdh=prior?Math.max(...prior.map(i=>b.H[i])):null,pdl=prior?Math.min(...prior.map(i=>b.L[i])):null,pdc=prior?b.C[prior[prior.length-1]]:null;
  const orH=today?b.H[today[0]]:null,orL=today?b.L[today[0]]:null;const dayOpen=today?(b.O?b.O[today[0]]:b.C[today[0]]):null;
  const nowS=asOf||Date.now()/1000;
  /* FIX #1 — the decision candle must be CLOSED. A 5-minute bar that started at T is closed once T+300 <= now (with 3s of grace for the feed).
     The old rule (last bar older than 90s => treat it as closed) accepted a half-formed candle whenever the page polled mid-candle or the
     relay served a cached snapshot. Half a candle's close and volume is not a signal. */
  let ci=n;if(KR.closedCandleOnly){while(ci>0&&b.T[ci]+300>nowS-3)ci--;}else{ci=(nowS-b.T[n]<90&&n>0)?n-1:n;}
  const closed=b.T[ci]+300<=nowS-3;
  let av=0,ac=0;for(let k=Math.max(0,ci-5);k<ci;k++){av+=b.V[k];ac++;}const avgVol=ac?av/ac:b.V[ci];
  /* prior high/low = TODAY's session before the closed candle (not the 5-day) */
  const tIdx=(today||[]).filter(i=>i<ci);
  const firstBar=!!(today&&today.length&&ci===today[0]);   /* the 8:30–8:35 candle just closed */
  const prevHi=tIdx.length?Math.max(...tIdx.map(i=>b.H[i])):(orH||b.H[ci]);
  const prevLo=tIdx.length?Math.min(...tIdx.map(i=>b.L[i])):(orL||b.L[ci]);
  const pClose=ci>0?b.C[ci-1]:b.C[ci];const ppClose=ci>1?b.C[ci-2]:pClose;const e9p=e9[Math.max(0,ci-1)];const dayHi=today?Math.max(...today.map(i=>b.H[i])):px,dayLo=today?Math.min(...today.map(i=>b.L[i])):px;
  let atr=0;for(let i=Math.max(1,n-13);i<=n;i++)atr+=Math.max(b.H[i]-b.L[i],Math.abs(b.H[i]-b.C[i-1]),Math.abs(b.L[i]-b.C[i-1]));atr/=Math.min(14,n);
  const rv=avgVol?b.V[ci]/avgVol:1;
  /* TIME-OF-DAY relative volume: this candle vs the same minute-of-day across prior sessions */
  /* minute-of-day per bar, computed once: offset from each session's first bar (5-minute bars) */
  const SLOT=new Array(b.T.length);for(const dd of days){const t0=b.T[dd[0]];for(const i of dd)SLOT[i]=Math.round((b.T[i]-t0)/60);}
  const slotOf=i=>SLOT[i];
  /* per prior session: slot -> volume */
  const SV=days.slice(0,-1).map(dd=>{const m={};for(const i of dd)m[SLOT[i]]=b.V[i];return m;});
  const mySlot=SLOT[ci];let tv=0,tc=0;for(const m of SV){if(m[mySlot]!=null){tv+=m[mySlot];tc++;}}
  const todBase=tc?tv/tc:null;const rvolTOD=todBase?b.V[ci]/todBase:rv;
  let r3=0,p6=0;for(let k=Math.max(0,ci-2);k<=ci;k++)r3+=b.V[k];for(let k=Math.max(0,ci-8);k<=ci-3;k++)p6+=b.V[k];const volTrend=p6>0?(r3/3)/(p6/6):1;
  const priorDays=days.slice(0,-1).filter(dd=>dd.length>10);
  const adr=priorDays.length?priorDays.reduce((s,dd)=>s+(Math.max(...dd.map(i=>b.H[i]))-Math.min(...dd.map(i=>b.L[i]))),0)/priorDays.length:null;
  const adrUsed=(adr&&today)?(Math.max(...today.map(i=>b.H[i]))-Math.min(...today.map(i=>b.L[i])))/adr:null;
  let wv=0,ws=0;if(today){for(const i of today){const tp=(b.H[i]+b.L[i]+b.C[i])/3;const w=b.V[i]||1;wv+=w*Math.pow(tp-vw[i],2);ws+=w;}}
  const vsig=ws?Math.sqrt(wv/ws):null;const vz=(vsig>0)?(px-vw[n])/vsig:null;
  let legStart=n;for(let i=n;i>0;i--){const a=(e9[i]||0)-(s20[i]||0),bb=(e9[i-1]||0)-(s20[i-1]||0);if(a===0||bb===0)continue;if((a>0)!==(bb>0)){legStart=i;break;}legStart=i;}
  /* behavior: 9/20 crosses per session (fewer = cleaner, more predictable trends) */
  let crosses=0;for(let i=1;i<n;i++){const a=(e9[i]||0)-(s20[i]||0),bb=(e9[i-1]||0)-(s20[i-1]||0);if(a&&bb&&(a>0)!==(bb>0))crosses++;}
  const sess=Math.max(1,days.length);const xPer=crosses/sess;
  const behave=xPer<=2.5?'CLEAN':xPer<=4.5?'MIXED':'CHOPPY';
  const adrP=adr&&px?adr/px*100:null;
  return {lastT:b.T[n],closed,nowS,dayOpen,px,chg:pdc?(px-pdc)/pdc*100:(b.pc?(px-b.pc)/b.pc*100:null),vsig,vwAll:vw,e9:e9[n],e9c:e9[ci],s20:s20[n],vw:vw[n],vwc:vw[ci],rsi:rsi[n]||50,mh,ci,pClose,ppClose,e9p,dayHi,dayLo,firstBar,cClose:b.C[ci],cVol:b.V[ci],avgVol,prevHi,prevLo,pdh,pdl,pdc,orH,orL,atr,rv,volTrend,adrUsed,vz,legMove:Math.abs(px-b.C[legStart]),adr,adrP,behave,xPer,rvolTOD,todBase,slotOf,SLOT,SV,days,bars:b};
}
function runMeter(A,L){
  const dirZ=A.vz==null?0:(L?A.vz:-A.vz);const cAdr=A.adrUsed==null?0.4:Math.min(1,A.adrUsed/1.1);const cZ=Math.max(0,Math.min(1,dirZ/3));
  const cLeg=A.atr?Math.max(0,Math.min(1,(A.legMove/A.atr)/6)):0.3;const rs=L?Math.max(0,Math.min(1,(A.rsi-55)/25)):Math.max(0,Math.min(1,(45-A.rsi)/25));
  const pastT=A._pastATR||0;const cChase=Math.max(0,Math.min(1,(pastT-0.5)/2));   /* >0.5 ATR past the trigger starts counting; 2.5 ATR = fully spent */
  /* THE DAY'S MOVE in your direction — vs a normal day's range. A stock already up a full ADR has spent its day, whatever the last leg looks like. */
  const adrP=A.adrP||(A.atr/A.px*100*8);const chg=A.chg||0;const dirChg=L?chg:-chg;
  const openMove=(A.dayOpen&&A.atr)?((L?(A.px-A.dayOpen):(A.dayOpen-A.px))/A.atr):0;
  /* starts counting only once the day is half spent: 50% of ADR = 0, 110% = fully spent. Ordinary moves don't read late. */
  const cDay=Math.max(0,Math.min(1,Math.max((dirChg/Math.max(0.5,adrP)-0.5)/0.6,(openMove-3)/5)));
  const dayMove={chgPct:dirChg,openATR:openMove};A._dayMove=dayMove;
  const score=Math.round(100*(0.30*cAdr+0.22*cZ+0.13*cLeg+0.08*rs+0.12*cChase+0.15*cDay));
  const phase=score<30?'EARLY':score<50?'FRESH':score<70?'RUNNING':score<85?'LATE':'EXHAUSTED';
  const lines=[];if(A._dayMove){const dm=A._dayMove;if(dm.chgPct>=0.8*(A.adrP||3))lines.push('already '+dm.chgPct.toFixed(1)+'% today vs a normal '+(A.adrP||0).toFixed(1)+'% day — the day\'s move is spent');else if(dm.openATR>=5)lines.push(dm.openATR.toFixed(1)+' ATR from the open — a long leg already');}
  return {score,phase,lines};
}
function score(A,L){
  let sc=0;const S=[];const add=(ok,p,l)=>{if(ok)sc+=p;S.push({ok,l});};
  add(L?A.e9>A.s20:A.e9<A.s20,18,'9/20 aligned');add(L?A.px>A.vw:A.px<A.vw,18,'right side of VWAP');add(L?(A.rsi>=45&&A.rsi<=72):(A.rsi>=28&&A.rsi<=55),12,'RSI healthy');
  add((A.rvolTOD||A.rv)>=1.05,14,'volume alive (vs this time of day)');add(L?A.px>A.pdc:A.px<A.pdc,12,'winning vs yesterday');add(L?(A.px>=A.orH*0.998):(A.px<=A.orL*1.002),14,'at the range edge');add(A.atr/A.px>=0.0018,12,'it can travel');
  {const ev=evidence(A,L);if(ev&&ev.n>=3){add(ev.rate>=0.55,10,'triggers have worked here ('+(ev.rate*100).toFixed(0)+'%)');if(ev.rate<0.35)sc=Math.max(0,sc-10);}}
  const P0=compose(A,L);A._pastATR=P0.pastATR;
  const rm=runMeter(A,L);if(rm.phase==='LATE')sc=Math.max(0,sc-15);if(rm.phase==='EXHAUSTED')sc=Math.max(0,sc-30);
  return {score:sc,det:S,rm};
}
function compose(A,L){
  let brk,rec,useRec,trig,kind;
  if(A.firstBar&&A.pdh&&A.pdl){
    /* 8:35 — the opening candle. Trigger = the stronger of yesterday's high and the PRE-MARKET high (calls) / the lower of the lows (puts). */
    const p=_PM()[A.tk];
    trig=L?Math.max(A.pdh,p?p.pmH:0):Math.min(A.pdl,p?p.pmL:1e9);kind='OPEN';brk=trig;rec=trig;useRec=false;
  }else{
    brk=L?Math.max(A.prevHi||0,A.orH||0):Math.min(A.prevLo||1e9,A.orL||1e9);rec=L?Math.max(A.vw||0,A.orH||0):Math.min(A.vw||1e9,A.orL||1e9);
    useRec=(L?rec<brk:rec>brk)&&Math.abs(rec-A.px)<Math.abs(brk-A.px);trig=useRec?rec:brk;kind=useRec?'RECLAIM':'BREAKOUT';
  }
  /* FIX #2 — a breakout level has to be a LEVEL. The old trigger was the running session high, which the previous candle itself usually set,
     so every new-high candle in a run "crossed" it: the program said BUY at every higher close — the midpoint-of-the-run entry you kept getting
     reversed on. Now the high must have stood for >= levelAge candles (default 3) without being exceeded. */
  let levelOK=true,levelAge=null;
  if(kind==='BREAKOUT'&&KR.levelAge>0){const b=A.bars,td=A.days[A.days.length-1]||[];const before=td.filter(i=>i<A.ci);
    if(before.length){let bi=before[0];for(const i of before){if(L?b.H[i]>b.H[bi]:b.L[i]<b.L[bi])bi=i;}levelAge=A.ci-bi;levelOK=levelAge>=KR.levelAge;}}
  /* FIX #3 — one breakout/reclaim per name per side per day (the way the evidence back-run always scored it). After the first cross the
     rest of the run is a PULLBACK trade or nothing. */
  /* counted per KIND: one BREAKOUT (the 8:35 OPEN counts as one) and one RECLAIM per side per day */
  let priorBreak=0,priorRec=0;
  if(KR.firstOnly&&!A.firstBar){const b=A.bars,td=A.days[A.days.length-1]||[];let runHi=-1e9,runLo=1e9,hiK=0,loK=0;
    for(let k=0;k<td.length;k++){const i=td[k];if(i>=A.ci)break;if(k===0&&A.pdh&&A.pdl){if(L?b.C[i]>A.pdh:b.C[i]<A.pdl){if(_rvolAt(A,i)>=1.2)priorBreak++;}}else if(k>0){const pc=b.C[td[k-1]];const lvl=L?runHi:runLo;const age=k-(L?hiK:loK);
      /* a prior breakout only counts if it was real under the same rules (the level had stood >= levelAge candles) */
      if((L?(pc<=lvl&&b.C[i]>lvl):(pc>=lvl&&b.C[i]<lvl))&&age>=KR.levelAge){if(_rvolAt(A,i)>=1.2)priorBreak++;}
      /* a RECLAIM earlier today: a close back through VWAP (as it stood then) / the opening-range edge, with volume */
      const vwk=A.vwAll?A.vwAll[i]:null;const orE=L?A.orH:A.orL;const lv2=vwk!=null?(L?Math.max(vwk,orE||0):Math.min(vwk,orE||1e9)):orE;
      if(lv2!=null&&(L?(pc<=lv2&&b.C[i]>lv2):(pc>=lv2&&b.C[i]<lv2))){if(_rvolAt(A,i)>=1.2)priorRec++;}}
      if(b.H[i]>runHi){runHi=b.H[i];hiK=k;}if(b.L[i]<runLo){runLo=b.L[i];loK=k;}}}
  const priorFires=kind==='RECLAIM'?priorRec:priorBreak;
  /* FIX #4 — no trend entries inside a chop regime; chop days get the CHOP set only. */
  const chopBlock=KR.chopBlocksBreak&&chopRegime(A)&&(kind==='BREAKOUT'||kind==='RECLAIM');
  let stop=L?Math.min(A.e9,A.vw,trig)-0.15*A.atr:Math.max(A.e9,A.vw,trig)+0.15*A.atr;
  if(Math.abs(trig-stop)<1.0*A.atr)stop=L?trig-1.0*A.atr:trig+1.0*A.atr;            /* a stop inside the noise is a donation */
  /* targets are the next real walls on the ruler, not an ATR guess */
  let t1=L?trig+2.2*A.atr:trig-2.2*A.atr,t1n='2.2 ATR',t2=null,t2n='';
  try{const W=nextWalls(A,A.tk,L,trig);if(W.t1){t1=W.t1.v;t1n=W.t1.n;}if(W.t2){t2=W.t2.v;t2n=W.t2.n;}}catch(e){}
  const beyond=L?(A.cClose>trig):(A.cClose<trig);
  const crossed=L?(A.pClose<=trig&&A.cClose>trig):(A.pClose>=trig&&A.cClose<trig);   /* THIS candle crossed it */
  const vol=(A.rvolTOD||A.rv)>=1.2;   /* vs the same time of day on prior sessions */
  const pastATR=A.atr?Math.abs(A.px-trig)/A.atr:0;                                   /* how far price already ran past the trigger */
  /* FIX #5 — ONE entry gate. The old code FIRED (voice, chime, grade) up to 0.8 ATR past the trigger while the card itself said
     "FIRED but MISSED" past 0.35 ATR. You heard "fired", you bought 0.8 ATR late, with a stop >= 1 ATR under the trigger: ~1.8 ATR of risk
     against a 2.2 ATR target. Now one number, used everywhere. */
  const pastMax=A.firstBar?KR.pastMaxOpen:KR.pastMax;
  const blocked=!levelOK||priorFires>0||chopBlock||(KR.requireClosed&&!A.closed);
  const fired=crossed&&vol&&pastATR<=pastMax&&!blocked;                                                /* fresh cross, with volume, still near the level */
  const thin=crossed&&!vol;
  const missed=beyond&&!crossed&&pastATR>0.8;                                           /* it fired earlier and ran — you are late */
  const why=!levelOK?'level is only '+levelAge+' candle'+(levelAge===1?'':'s')+' old — not a wall yet':priorFires>0?(kind==='RECLAIM'?'already reclaimed once today — pullback or nothing':'already broke out once today — pullback or nothing'):chopBlock?'chop regime — fade the bands, don\'t chase breaks':(KR.requireClosed&&!A.closed)?'candle still forming':null;
  return {trig,stop,t1,t1n,t2,t2n,fired,thin,missed,pastATR,kind,pastMax,levelAge,priorFires,blocked,why};
}
/* ===== PULLBACK — the entry the program kept telling you to wait for ===== */
function pullback(A,L){
  const b=A.bars,td=A.days[A.days.length-1];if(!td||td.length<6)return null;
  const ci=A.ci;const k=td.indexOf(ci);if(k<4)return null;
  /* 1. was there an impulse today in this direction? (from the session open to the extreme, >= 1.5 ATR) */
  const open0=b.O?b.O[td[0]]:b.C[td[0]];
  const ext=L?Math.max(...td.slice(0,k).map(i=>b.H[i])):Math.min(...td.slice(0,k).map(i=>b.L[i]));
  const impulse=Math.abs(ext-open0)/A.atr;if(impulse<1.5)return null;
  const extIdx=td.slice(0,k).reduce((bi,i)=>(L?b.H[i]>b.H[bi]:b.L[i]<b.L[bi])?i:bi,td[0]);
  const barsSince=k-td.indexOf(extIdx);if(barsSince<2||barsSince>18)return null;   /* the pullback must be fresh: 2-18 candles off the extreme */
  /* 2. the pullback: price came back to the ride line (9 EMA or VWAP) */
  const e9=A.bars.e9||null;
  const line=L?Math.max(A.e9c,A.vwc):Math.min(A.e9c,A.vwc);
  const prev=td[k-1];const touched=L?(b.L[prev]<=line*1.002):(b.H[prev]>=line*0.998);
  const held=L?(b.C[prev]>=line*0.995):(b.C[prev]<=line*1.005);                 /* closed on the right side of the line */
  const depth=Math.abs(ext-b.C[prev])/A.atr;if(depth<0.4||depth>3.5)return null;   /* a real pullback, not a wiggle; deep ones are fine if they HOLD the line */  /* a real pullback, not a wiggle, not a collapse */
  if(!(touched&&held))return {near:true,line,ext};
  /* 3. the push: this candle closes back in the trend direction with volume */
  const push=L?(A.cClose>b.C[prev]&&A.cClose>b.O[ci]):(A.cClose<b.C[prev]&&A.cClose<b.O[ci]);
  const vol=(A.rvolTOD||A.rv)>=1.0;
  const stop=L?Math.min(b.L[prev],b.L[ci])-0.2*A.atr:Math.max(b.H[prev],b.H[ci])+0.2*A.atr;
  if(Math.abs(A.cClose-stop)<0.8*A.atr){/* keep at least 0.8 ATR of room */ }
  const t1=ext;const t2=L?ext+1.5*A.atr:ext-1.5*A.atr;
  return {fired:push&&vol,thin:push&&!vol,ready:!push,trig:A.cClose,stop,t1,t2,line,ext,kind:'PULLBACK'};
}
/* ===== RANGE TURN — the reversal trade after an extended run =====
   For PUTS: the up-run is spent (calls' RUN LATE/EXHAUSTED), the last two closed candles fell, this one closed under the 9 EMA.
   For CALLS: mirror. Stop = the extreme + 0.2 ATR. T1 = VWAP (or 1.5 ATR). Half size — it's a scalp against the trend. */
function rangeTurn(A,L){
  const runOpp=runMeter(A,!L);                       /* how spent is the OTHER side's run */
  if(runOpp.phase!=='LATE'&&runOpp.phase!=='EXHAUSTED')return null;
  const twoDown=L?(A.cClose>A.pClose&&A.pClose>A.ppClose):(A.cClose<A.pClose&&A.pClose<A.ppClose);
  const thru=L?(A.cClose>A.e9c&&A.pClose<=A.e9p):(A.cClose<A.e9c&&A.pClose>=A.e9p);
  const vol=(A.rvolTOD||A.rv)>=1.0;
  if(!(twoDown&&thru))return {near:true,runOpp};
  const stop=L?A.dayLo-0.2*A.atr:A.dayHi+0.2*A.atr;
  const t1=L?Math.max(A.vw,A.px+1.5*A.atr):Math.min(A.vw,A.px-1.5*A.atr);
  return {fired:vol,thin:!vol,stop,t1,trig:A.cClose,kind:'TURN',runOpp};
}
/* ===== EVIDENCE — back-run the triggers on this stock's own prior sessions ===== */
function evidence(A,L){
  const ck=(A.tk||'')+'|'+(L?'C':'P')+'|'+A.ci;if(A._evc&&A._evc[ck])return A._evc[ck];
  const b=A.bars,days=A.days;if(!days||days.length<3)return null;
  const atr=A.atr||0.5;let n=0,win=0,mfeSum=0,openN=0,openWin=0;
  for(let s=1;s<days.length-1;s++){
    const dd=days[s],prev=days[s-1];if(dd.length<15||prev.length<10)continue;
    const pdh=Math.max(...prev.map(i=>b.H[i])),pdl=Math.min(...prev.map(i=>b.L[i]));
    let runHi=-1e9,runLo=1e9,firedOnce=false;
    for(let k=0;k<dd.length;k++){
      const i=dd[k];const slot=A.SLOT[i];
      let tv=0,tc=0;for(let s2=0;s2<A.SV.length;s2++){if(s2===s)continue;const v=A.SV[s2][slot];if(v!=null){tv+=v;tc++;}}
      const rv=tc?b.V[i]/(tv/tc):1;
      let fire=false,kind='';
      if(k===0){if(L?(b.C[i]>pdh):(b.C[i]<pdl)){fire=rv>=1.2;kind='OPEN';}}
      else{const prevC=b.C[dd[k-1]];const lvl=L?runHi:runLo;if(L?(prevC<=lvl&&b.C[i]>lvl):(prevC>=lvl&&b.C[i]<lvl)){fire=rv>=1.2;kind='BREAK';}}
      runHi=Math.max(runHi,b.H[i]);runLo=Math.min(runLo,b.L[i]);
      if(!fire||firedOnce)continue;firedOnce=true;
      const e=b.C[i];let best=0,hit=null;
      for(let m=1;m<=12&&k+m<dd.length;m++){const j=dd[k+m];const fav=L?(b.H[j]-e):(e-b.L[j]);const adv=L?(e-b.L[j]):(b.H[j]-e);best=Math.max(best,fav);
        if(adv>=1.0*atr){hit=false;break;}if(fav>=1.5*atr){hit=true;break;}}
      n++;if(hit)win++;mfeSum+=best/atr;if(kind==='OPEN'){openN++;if(hit)openWin++;}
    }
  }
  const res=!n?{n:0,sessions:days.length-1}:{n,win,rate:win/n,mfe:mfeSum/n,openN,openWin,sessions:days.length-1};
  (A._evc=A._evc||{})[ck]=res;return res;
}
/* ================= RANGE RULER — where are we in the range, where does it likely end, where are the reversals ================= */
function rangeInfo(A,tk){
  const p=_PM()[tk]||null;const lo=Math.min(A.dayLo||A.px,p?p.pmL:A.px),hi=Math.max(A.dayHi||A.px,p?p.pmH:A.px);
  const span=Math.max(hi-lo,0.01);const pos=(A.px-lo)/span;
  const adr=A.adr||A.atr*10;const used=(hi-lo)/adr;
  const rem=Math.max(0,adr-(hi-lo));
  /* likely end of the range: extend the side price is leaning toward by what's left of a normal day */
  const lean=A.px>A.vw?'up':'down';
  const projHi=lean==='up'?hi+rem:hi,projLo=lean==='down'?lo-rem:lo;
  return {lo,hi,span,pos,used,rem,projHi,projLo,lean};
}
/* ===== ruler-driven levels: targets and stops are the next real wall, not an ATR multiple ===== */
function rulerLevels(A,tk){
  const R=rangeInfo(A,tk);const p=_PM()[tk]||null;const L=[];
  const add=(v,n)=>{if(v!=null&&isFinite(v))L.push({v,n});};
  add(A.vw,'VWAP');add(A.pdh,'PDH');add(A.pdl,'PDL');add(R.lo,'day low');add(R.hi,'day high');add(R.projHi,'likely high');add(R.projLo,'likely low');
  if(p){add(p.pmH,'pre-mkt high');add(p.pmL,'pre-mkt low');}
  if(A.vsig){add(A.vw+2*A.vsig,'upper band');add(A.vw-2*A.vsig,'lower band');add(A.vw+A.vsig,'+1σ');add(A.vw-A.vsig,'-1σ');}
  add((R.lo+R.hi)/2,'mid-range');
  return {R,levels:L.sort((a,b)=>a.v-b.v)};
}
function nextWalls(A,tk,L,from){
  /* the next two walls in the trade direction, at least 0.6 ATR away */
  const {levels}=rulerLevels(A,tk);const atr=A.atr||0.5;
  const ahead=levels.filter(x=>L?(x.v-from>=0.6*atr):(from-x.v>=0.6*atr)).sort((a,b)=>L?(a.v-b.v):(b.v-a.v));
  const behind=levels.filter(x=>L?(from-x.v>=0.5*atr):(x.v-from>=0.5*atr)).sort((a,b)=>L?(b.v-a.v):(a.v-b.v));
  return {t1:ahead[0]||null,t2:ahead[1]||null,wall:behind[0]||null};
}
/* where in the range is this entry allowed? calls need room above; puts need room below */
function rangeGate(A,tk,L,kind){
  const R=rangeInfo(A,tk);const pos=R.pos;
  if(kind==='CHOP'||kind==='TURN')return {ok:true};                       /* range trades are SUPPOSED to be at the edges */
  const freshBreak=L?(A.pClose<=R.hi&&A.cClose>R.hi&&(A.rvolTOD||A.rv)>=1.3):(A.pClose>=R.lo&&A.cClose<R.lo&&(A.rvolTOD||A.rv)>=1.3);
  if(L&&pos>=0.8&&!freshBreak)return {ok:false,why:'TURNAROUND ZONE — top of the range; calls are off here'};
  if(!L&&pos<=0.2&&!freshBreak)return {ok:false,why:'TURNAROUND ZONE — bottom of the range; puts are off here'};
  if(L&&pos>=0.7&&A.px<R.hi)return {ok:false,why:'top of the range ('+(pos*100).toFixed(0)+'%) with the high still above — no room'};
  if(!L&&pos<=0.3&&A.px>R.lo)return {ok:false,why:'bottom of the range ('+(pos*100).toFixed(0)+'%) with the low still below — no room'};
  if(R.used>=1.0&&!freshBreak)return {ok:false,why:'the range is already spent ('+(R.used*100).toFixed(0)+'% of a normal day)'};
  return {ok:true};
}
/* ================= THE CHOP SET — the consistent trade in a wide, sideways range ================= */
/* Regime: not trending (few 9/20 crosses is NOT chop; many is), price oscillating around VWAP, range wide enough to pay (ADR >= 3%). */
function chopRegime(A){
  const wide=(A.adrP||0)>=3;const notTrend=(A.behave==='CHOPPY'||A.behave==='MIXED')&&Math.abs(A.vz||0)<2.2;
  const spent=(A.adrUsed||0)>=0.5;   /* the range has to exist before you can fade its edges */
  return wide&&notTrend&&spent;
}
function chopSet(A,L){
  if(!chopRegime(A)||!A.vsig)return null;
  const R=rangeInfo(A,A.tk);
  const edge=L?Math.max(R.lo,Math.min(A.vw-1.5*A.vsig,R.lo+0.2*R.span)):Math.min(R.hi,Math.max(A.vw+1.5*A.vsig,R.hi-0.2*R.span));   /* the range edge zone you fade */
  const near=Math.abs(A.px-edge)/A.atr;
  const b=A.bars,ci=A.ci,prev=ci>0?ci-1:ci;
  const touched=L?(b.L[prev]<=edge+0.15*A.atr||b.L[ci]<=edge+0.15*A.atr):(b.H[prev]>=edge-0.15*A.atr||b.H[ci]>=edge-0.15*A.atr);
  const reversal=L?(A.cClose>b.H[prev]&&A.cClose>b.O[ci]):(A.cClose<b.L[prev]&&A.cClose<b.O[ci]);   /* this candle closed back through the prior candle */
  const vol=(A.rvolTOD||A.rv)>=0.9;
  const stop=L?edge-0.6*A.atr:edge+0.6*A.atr;const t1=A.vw;const t2=L?A.vw+1.0*A.vsig:A.vw-1.0*A.vsig;
  if(touched&&reversal)return {fired:vol,thin:!vol,trig:A.cClose,stop,t1,t2,edge,kind:'CHOP'};
  if(near<=0.5)return {armed:true,edge,stop,t1,t2,kind:'CHOP'};
  return {ready:true,edge,stop,t1,t2,kind:'CHOP'};
}
/* ===== overnight stress test — per strategy, per name: OPEN, BREAK, PULLBACK, TURN, CHOP replayed on the last sessions =====
   Result: odds for each trigger type on THIS stock lately. Types with no edge are benched for the day (Holly's lesson). */
function evidenceKinds(A){
  const ck='K|'+(A.tk||'')+'|'+A.ci;if(A._evk&&A._evk[ck])return A._evk[ck];
  const b=A.bars,days=A.days;const out={OPEN:{n:0,w:0},BREAK:{n:0,w:0},PULLBACK:{n:0,w:0},TURN:{n:0,w:0},CHOP:{n:0,w:0}};
  if(!days||days.length<3){(A._evk=A._evk||{})[ck]=out;return out;}
  const atr=A.atr||0.5;
  const grade=(dd,k,e,L)=>{let hit=null;for(let m=1;m<=12&&k+m<dd.length;m++){const j=dd[k+m];const fav=L?(b.H[j]-e):(e-b.L[j]);const adv=L?(e-b.L[j]):(b.H[j]-e);if(adv>=1.0*atr){hit=false;break;}if(fav>=1.5*atr){hit=true;break;}}return hit;};
  for(let s=1;s<days.length-1;s++){
    const dd=days[s],prev=days[s-1];if(dd.length<15||prev.length<10)continue;
    const pdh=Math.max(...prev.map(i=>b.H[i])),pdl=Math.min(...prev.map(i=>b.L[i]));
    let runHi=-1e9,runLo=1e9,e9=b.C[dd[0]],fired={};const open0=b.O?b.O[dd[0]]:b.C[dd[0]];let ext=open0,extK=0;
    for(let k=0;k<dd.length;k++){
      const i=dd[k];const slot=A.SLOT[i];let tv=0,tc=0;for(let s2=0;s2<A.SV.length;s2++){if(s2===s)continue;const v=A.SV[s2][slot];if(v!=null){tv+=v;tc++;}}
      const rv=tc?b.V[i]/(tv/tc):1;const c=b.C[i];const pC=k?b.C[dd[k-1]]:c;e9=k?c*(2/10)+e9*(8/10):c;
      const range=runHi-runLo;
      for(const L of [true,false]){
        const key=k=>L?'L'+k:'S'+k;
        /* OPEN */
        if(k===0&&!fired[key('O')]&&(L?c>pdh:c<pdl)&&rv>=1.2){fired[key('O')]=1;const r=grade(dd,k,c,L);out.OPEN.n++;if(r)out.OPEN.w++;}
        /* BREAK: first cross of the running high/low */
        if(k>0&&!fired[key('B')]&&(L?(pC<=runHi&&c>runHi):(pC>=runLo&&c<runLo))&&rv>=1.2){fired[key('B')]=1;const r=grade(dd,k,c,L);out.BREAK.n++;if(r)out.BREAK.w++;}
        /* PULLBACK: impulse >=1.5 ATR from open, came back to e9, closes back in trend direction with volume */
        if(k>3&&!fired[key('P')]){const imp=L?(runHi-open0):(open0-runLo);const nearE=L?(b.L[dd[k-1]]<=e9*1.002&&pC>=e9*0.995):(b.H[dd[k-1]]>=e9*0.998&&pC<=e9*1.005);const push=L?(c>pC):(c<pC);
          if(imp>=1.5*atr&&nearE&&push&&rv>=1.0){fired[key('P')]=1;const r=grade(dd,k,c,L);out.PULLBACK.n++;if(r)out.PULLBACK.w++;}}
        /* TURN: the OTHER side ran >=2.5 ATR from open; two closes against it and through e9 */
        if(k>3&&!fired[key('T')]){const oppRun=L?(open0-runLo):(runHi-open0);const two=L?(c>pC&&pC>b.C[dd[k-2]]):(c<pC&&pC<b.C[dd[k-2]]);const thru=L?(c>e9&&pC<=e9):(c<e9&&pC>=e9);
          if(oppRun>=2.5*atr&&two&&thru&&rv>=1.0){fired[key('T')]=1;const r=grade(dd,k,c,L);out.TURN.n++;if(r)out.TURN.w++;}}
        /* CHOP: touch of the bottom/top 20% of the session range (range >= 2 ATR), reversal candle */
        if(k>6&&!fired[key('C')]&&range>=2*atr){const edge=L?(runLo+0.2*range):(runHi-0.2*range);const touch=L?(b.L[dd[k-1]]<=edge):(b.H[dd[k-1]]>=edge);const rev=L?(c>b.H[dd[k-1]]):(c<b.L[dd[k-1]]);
          if(touch&&rev&&rv>=0.9){fired[key('C')]=1;const r=grade(dd,k,c,L);out.CHOP.n++;if(r)out.CHOP.w++;}}
      }
      runHi=Math.max(runHi,b.H[i]);runLo=Math.min(runLo,b.L[i]);
    }
  }
  (A._evk=A._evk||{})[ck]=out;return out;
}
function kindKey(kind){return kind==='BREAKOUT'||kind==='RECLAIM'?'BREAK':kind;}
function oddsFor(A,kind){const e=evidenceKinds(A)[kindKey(kind)];if(!e||!e.n)return null;return {n:e.n,w:e.w,rate:e.w/e.n};}

/* ===== shared grading — the trade the ticket actually describes: entry where you'd fill, the plan's own stop and T1 =====
   Legacy graded every fire at the CANDLE CLOSE against a fixed +1.5 ATR / -1.0 ATR. Real fills were later and the real stop/target were the
   plan's. gradeTrade() scores the plan as written; gradeFixed() keeps the old yardstick so the two can be compared. */
function gradeTrade(b,startIdx,entry,stop,t1,L,maxBars,endIdx){
  const last=endIdx!=null?endIdx:b.C.length-1;let best=0,res=null,n=0,exitIdx=null;
  for(let m=1;m<=maxBars&&startIdx+m<=last;m++){const j=startIdx+m;n++;const fav=L?(b.H[j]-entry):(entry-b.L[j]);best=Math.max(best,fav);
    const stopHit=L?(b.L[j]<=stop):(b.H[j]>=stop);const tgtHit=L?(b.H[j]>=t1):(b.L[j]<=t1);
    if(stopHit&&tgtHit){res='stopped';exitIdx=j;break;}            /* both in one candle: assume the worst */
    if(stopHit){res='stopped';exitIdx=j;break;}if(tgtHit){res='hit';exitIdx=j;break;}}
  const risk=Math.abs(entry-stop)||1e-9;
  let R=null;if(res==='hit')R=Math.abs(t1-entry)/risk;else if(res==='stopped')R=-1;else if(n>=maxBars){res='flat';const j=startIdx+n;const px=b.C[Math.min(j,last)];R=(L?px-entry:entry-px)/risk;}
  return {result:res,best,R,bars:n,exitIdx};
}
function gradeFixed(b,startIdx,entry,atr,L,maxBars,endIdx){
  const last=endIdx!=null?endIdx:b.C.length-1;let best=0,res=null,n=0;
  for(let m=1;m<=maxBars&&startIdx+m<=last;m++){const j=startIdx+m;n++;const fav=L?(b.H[j]-entry):(entry-b.L[j]);const adv=L?(entry-b.L[j]):(b.H[j]-entry);best=Math.max(best,fav);
    if(adv>=1.0*atr){res='stopped';break;}if(fav>=1.5*atr){res='hit';break;}}
  if(!res&&n>=maxBars)res='flat';return {result:res,best:best/atr,bars:n};
}
/* relative volume at any bar vs the same minute-of-day on the other sessions (what rvolTOD is for the decision candle) */
function _rvolAt(A,i){const slot=A.SLOT[i];let tv=0,tc=0;const mine=A.days.findIndex(dd=>dd.includes(i));for(let s2=0;s2<A.SV.length;s2++){if(s2===mine)continue;const v=A.SV[s2][slot];if(v!=null){tv+=v;tc++;}}const base=tc?tv/tc:null;if(!base){let av=0,ac=0;for(let k=Math.max(0,i-5);k<i;k++){av+=A.bars.V[k];ac++;}return ac?A.bars.V[i]/(av/ac):1;}return A.bars.V[i]/base;}

/* slice a bar object so it looks the way the page saw it at the close of candle idx (for replay) */
function barsAsOf(b,idx){const e=idx+1;return {T:b.T.slice(0,e),O:b.O.slice(0,e),H:b.H.slice(0,e),L:b.L.slice(0,e),C:b.C.slice(0,e),V:b.V.slice(0,e),pc:b.pc};}

if(typeof module!=='undefined'&&module.exports){module.exports={ENGINE_VERSION,RULES,get KR(){return KR;},setRules,emaAll,smaAll,vwapAll,macdHist,rsiAll,analyze,runMeter,score,compose,pullback,rangeTurn,evidence,evidenceKinds,rangeInfo,rulerLevels,nextWalls,rangeGate,chopRegime,chopSet,kindKey,oddsFor,gradeTrade,gradeFixed,barsAsOf,_rvolAt};}
