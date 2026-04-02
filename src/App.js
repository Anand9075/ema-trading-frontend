import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { tradeAPI, alertAPI, priceAPI, strategyAPI, configAPI } from './api';

/* ─── Helpers ─────────────────────────────────────────────────────────── */
const fmt   = n => '₹' + Number(n||0).toLocaleString('en-IN');
const fmtN  = (n,d=2) => Number(n||0).toFixed(d);
const pct   = (v,b) => b ? ((v-b)/b*100).toFixed(2) : '0.00';
const nowIST= () => new Date().toLocaleTimeString('en-IN',{hour12:false,timeZone:'Asia/Kolkata'});
const isOpen= () => {
  const d=new Date(), ist=new Date(d.getTime()+5.5*3600000);
  const day=ist.getUTCDay(), t=ist.getUTCHours()*60+ist.getUTCMinutes();
  return day>0 && day<6 && t>=555 && t<=930;
};

const ALERT_CFG = {
  BUY:       {col:'#00e676',label:'BUY SIGNAL', icon:'▲'},
  SL_HIT:    {col:'#ff1744',label:'STOP LOSS',  icon:'▼'},
  TARGET:    {col:'#69f0ae',label:'TARGET HIT',  icon:'★'},
  TARGET2:   {col:'#00e5ff',label:'TARGET 2',    icon:'★★'},
  TRAIL:     {col:'#ff9900',label:'TRAILING',    icon:'⚠'},
  SELECTION: {col:'#00e5ff',label:'SELECTION',   icon:'◈'},
  CLOSED:    {col:'#ff9900',label:'CLOSED',       icon:'✕'},
  ERROR:     {col:'#f44336',label:'ERROR',        icon:'✕'},
  DEFAULT:   {col:'#ff9900',label:'ALERT',        icon:'●'},
};
const aCfg = t => ALERT_CFG[t]||ALERT_CFG.DEFAULT;

const STATUS_MAP = {
  WAITING:'badge-waiting', ACTIVE:'badge-active',
  TARGET:'badge-target', SL:'badge-sl',
  MANUAL_EXIT:'badge-sl', CLOSED:'badge-closed',
};
const STATUS_DOT = {
  WAITING:'#ff9900',ACTIVE:'#00b0ff',TARGET:'#00e676',
  SL:'#ff1744',MANUAL_EXIT:'#e040fb',CLOSED:'#666644',
};

/* ─── Badge ───────────────────────────────────────────────────────────── */
function Badge({status}) {
  const s = (status||'WAITING').toUpperCase().replace(' ','_');
  const label = status||'WAITING';
  return (
    <span className={`badge ${STATUS_MAP[s]||'badge-waiting'}`}>
      <span className="badge-dot" style={{background:STATUS_DOT[s]||'#ff9900'}}/>
      {label}
    </span>
  );
}

/* ─── Toast ───────────────────────────────────────────────────────────── */
function Toast({toast,onDismiss}) {
  useEffect(()=>{ if(!toast) return; const t=setTimeout(onDismiss,6000); return ()=>clearTimeout(t); },[toast,onDismiss]);
  if(!toast) return null;
  const cfg = aCfg(toast.type);
  return (
    <div className="toast-wrap">
      <div className="toast" style={{borderColor:cfg.col}} onClick={onDismiss}>
        <div className="toast-hdr">
          <span className="toast-type" style={{color:cfg.col}}>{cfg.icon} {cfg.label}</span>
          <span className="alert-time">{new Date(toast.createdAt||Date.now()).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'})}</span>
        </div>
        <div className="toast-sym">{toast.symbol}</div>
        <div className="toast-msg">{toast.message}</div>
      </div>
    </div>
  );
}

/* ─── Modal ───────────────────────────────────────────────────────────── */
function Modal({show,onClose,title,children}) {
  if(!show) return null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal-box" onClick={e=>e.stopPropagation()}>
        <div className="modal-hdr">
          <span>{title}</span>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--muted2)',cursor:'pointer',fontSize:16}}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function FInput({label,half,...p}) {
  return (
    <div className="form-group" style={half?{gridColumn:'span 1'}:{}}>
      {label&&<label className="form-label">{label}</label>}
      <input className="form-input" {...p}/>
    </div>
  );
}
function FSelect({label,value,onChange,options}) {
  return (
    <div className="form-group">
      {label&&<label className="form-label">{label}</label>}
      <select className="form-select" value={value} onChange={onChange}>
        {options.map(o=><option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
      </select>
    </div>
  );
}

/* ─── Price Bar ───────────────────────────────────────────────────────── */
function PriceBar({entry,sl,target,cur}) {
  const range = target - sl; if(range<=0) return null;
  const pos   = Math.min(100,Math.max(0,(cur-sl)/range*100));
  const entP  = Math.min(100,Math.max(0,(entry-sl)/range*100));
  const col   = cur>=entry?'var(--green)':'var(--red)';
  return (
    <div className="pbar-section">
      <div className="pbar-wrap">
        <div className="pbar-fill" style={{width:`${pos}%`,background:col}}/>
        <div className="pbar-marker" style={{left:`${entP}%`}}/>
      </div>
      <div className="pbar-labels">
        <span className="col-red">SL {fmt(sl)}</span>
        <span>Entry {fmt(entry)}</span>
        <span className="col-green">T {fmt(target)}</span>
      </div>
      <div style={{textAlign:'center',fontSize:9,color:'var(--muted2)',marginTop:2}}>
        Position: {fmtN(pos)}% of SL→Target
      </div>
    </div>
  );
}

/* ─── Trade Card ──────────────────────────────────────────────────────── */
function TradeCard({trade,prices,onEdit,onDelete,onMarkActive,onClose}) {
  const q       = prices[trade.symbol||trade.name]||{};
  const cur     = q.price || trade.currentPrice || trade.entry;
  const pnl     = (cur - trade.entry) * (trade.qty||1);
  const pnlPct  = Number(pct(cur, trade.entry));
  const isUp    = pnl >= 0;
  const rr      = ((trade.target - trade.entry)/Math.max(1,trade.entry - trade.sl)).toFixed(1);
  const st      = (trade.status||'WAITING').toUpperCase().replace(' ','_');
  const isActive= st === 'ACTIVE';
  const isWait  = st === 'WAITING';

  return (
    <div className="t-card">
      <div className="t-card-hdr">
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span className="t-card-title">{trade.name||(trade.symbol||'').replace('.NS','')}</span>
          <span style={{fontSize:9,color:'var(--muted2)'}}>{trade.symbol}</span>
          {isActive && <span className="live-dot"/>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:9,color:'var(--muted2)'}}>{trade.sector||''}</span>
          <Badge status={trade.status||'WAITING'}/>
          {trade.entryType && <span style={{fontSize:9,color:'var(--cyan)'}}>{trade.entryType}</span>}
        </div>
      </div>

      {/* Live price row */}
      <div className="t-card-row" style={{borderBottom:'1px solid rgba(255,153,0,.1)'}}>
        <span className={`t-card-price ${isUp?'col-green':'col-red'}`}>{fmt(cur)}</span>
        <span style={{fontSize:12,color:isUp?'var(--green)':'var(--red)',fontWeight:600}}>
          {isUp?'▲':'▼'} {isUp?'+':''}{fmtN(q.changePct||0)}%
          {q.change ? ` (${isUp?'+':''}₹${fmtN(Math.abs(q.change||0),2)})` : ''}
        </span>
        {q.volume && <span style={{fontSize:10,color:'var(--muted2)'}}>Vol: {(q.volume/1e5).toFixed(1)}L</span>}
        {q.high   && <span style={{fontSize:10,color:'var(--muted2)'}}>H:{fmt(q.high)} L:{fmt(q.low)}</span>}
      </div>

      {/* Price bar */}
      <PriceBar entry={trade.entry} sl={trade.sl} target={trade.target} cur={cur}/>

      {/* Levels */}
      <div className="t-card-row" style={{fontSize:11}}>
        {[['Entry',trade.entry,''],['Stop Loss',trade.sl,'col-red'],['Target',trade.target,'col-green']].map(([l,v,c])=>(
          <span key={l} style={{marginRight:16}}>
            <span className="col-muted">{l}: </span>
            <span className={`fw6 ${c}`}>{fmt(v)}</span>
          </span>
        ))}
      </div>

      {/* Indicators */}
      <div className="t-card-row" style={{fontSize:10,color:'var(--muted2)'}}>
        {trade.ema200 && <span>200EMA: <span className="col-cyan">{fmt(trade.ema200)}</span></span>}
        {trade.ema50  && <span>50EMA: <span className="col-cyan">{fmt(trade.ema50)}</span></span>}
        {trade.rsi    && <span>RSI: <span style={{color:trade.rsi>=55&&trade.rsi<=75?'var(--green)':'var(--amber)'}}>{fmtN(trade.rsi,1)}</span></span>}
        <span>R:R <span className="col-amber">{rr}:1</span></span>
        {trade.confidence && <span style={{color:trade.confidence==='HIGH'?'var(--green)':trade.confidence==='MEDIUM'?'var(--amber)':'var(--muted2)'}}>{trade.confidence}</span>}
      </div>

      {/* P&L */}
      <div className="t-card-row" style={{background:isUp?'var(--green-bg)':'var(--red-bg)',borderTop:'1px solid var(--border)',borderBottom:'1px solid var(--border)'}}>
        <span className={`fw7 ${isUp?'col-green':'col-red'}`} style={{fontSize:13}}>
          P&L: {isUp?'+':''}{fmt(Math.round(pnl))} ({isUp?'+':''}{fmtN(pnlPct)}%)
        </span>
        <span style={{fontSize:10,color:'var(--muted2)',marginLeft:'auto'}}>
          {trade.qty} shares · {fmt(Math.round((trade.qty||1)*trade.entry))} invested · {trade.createdAt ? new Date(trade.createdAt).toLocaleDateString('en-IN') : ''}
        </span>
      </div>

      {/* Action buttons */}
      <div className="t-card-actions">
        {isWait   && <button className="btn btn-blue btn-sm" onClick={onMarkActive}>◉ MARK ACTIVE</button>}
        {(isActive||st==='TARGET'||st==='SL') && <button className="btn btn-green btn-sm" onClick={onClose}>✕ CLOSE TRADE</button>}
        <button className="btn btn-sm" onClick={onEdit}>✎ EDIT</button>
        <button className="btn btn-red btn-sm" onClick={onDelete}>✕ REMOVE</button>
      </div>
    </div>
  );
}

/* ─── Ticker ──────────────────────────────────────────────────────────── */
function Ticker({prices}) {
  const items = Object.values(prices||{}).filter(q=>q&&q.price);
  if(!items.length) return <div className="ticker-wrap"><div style={{padding:'5px 12px',color:'var(--muted2)',fontSize:10}}>Connecting to market data...</div></div>;
  const content = items.map(q=>{
    const up = (q.changePct||0)>=0;
    const name = (q.symbol||'').replace('.NS','').replace('^','');
    return (
      <span key={q.symbol} className="ticker-item">
        <span className="col-amber">{name}</span>{' '}
        <span style={{color:up?'var(--green)':'var(--red)',fontWeight:600}}>{fmt(q.price)}</span>{' '}
        <span style={{color:up?'var(--green)':'var(--red)'}}>{up?'▲':'▼'}{fmtN(Math.abs(q.changePct||0))}%</span>
      </span>
    );
  });
  return (
    <div className="ticker-wrap">
      <div className="ticker-track">{content}{content}</div>
    </div>
  );
}

/* ─── Perf Chart ──────────────────────────────────────────────────────── */
function PerfChart({monthly}) {
  const ref = useRef(null); const ch = useRef(null);
  useEffect(()=>{
    if(!ref.current||!monthly.length||!window.Chart) return;
    if(ch.current) ch.current.destroy();
    ch.current = new window.Chart(ref.current,{
      type:'line',
      data:{labels:monthly.map(m=>m.month),datasets:[
        {label:'End',data:monthly.map(m=>m.end),borderColor:'#00e676',backgroundColor:'rgba(0,230,118,.06)',borderWidth:1.5,pointRadius:3,pointBackgroundColor:'#00e676',fill:true,tension:.3},
        {label:'Start',data:monthly.map(m=>m.start),borderColor:'rgba(255,153,0,.3)',borderWidth:1,borderDash:[3,3],pointRadius:0,fill:false,tension:.3},
      ]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
        scales:{x:{grid:{color:'rgba(255,153,0,.07)'},ticks:{color:'#666644',font:{size:9,family:'IBM Plex Mono'}}},
          y:{grid:{color:'rgba(255,153,0,.07)'},ticks:{color:'#666644',font:{size:9,family:'IBM Plex Mono'},callback:v=>'₹'+(v/1000).toFixed(0)+'k'}}}}
    });
    return()=>{if(ch.current)ch.current.destroy()};
  },[monthly]);
  return <canvas ref={ref}/>;
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════════════════════ */
export default function App() {
  const [tab,      setTab]     = useState('positions');
  const [trades,   setTrades]  = useState([]);
  const [alerts,   setAlerts]  = useState([]);
  const [prices,   setPrices]  = useState({});
  const [scanner,  setScanner] = useState({stocks:[],lastRun:null,totalScanned:0});
  const [config,   setConfig]  = useState({capital:100000});
  const [monthly,  setMonthly] = useState([]);
  const [unread,   setUnread]  = useState(0);
  const [toast,    setToast]   = useState(null);
  const [modal,    setModal]   = useState(null);
  const [editTrade,setEdit]    = useState(null);
  const [closeTrade,setCloseT] = useState(null);
  const [scanning, setScan]    = useState(false);
  const [loading,  setLoading] = useState(true);
  const [apiErr,   setApiErr]  = useState(null);
  const [time,     setTime]    = useState(nowIST());
  const [lastUpd,  setLastUpd] = useState(null);
  const [editCap,  setEditCap] = useState(false);
  const [tmpCap,   setTmpCap]  = useState('');
  const prevPricesRef = useRef({});
  const lastAlertCheck = useRef(Date.now()-3600000);

  const BLANK = {symbol:'',name:'',sector:'',entry:'',sl:'',target:'',qty:'',status:'WAITING',entryType:'BREAKOUT',confidence:'MEDIUM'};
  const [form, setForm] = useState(BLANK);
  const [closeForm, setCloseForm] = useState({exitPrice:'',exitDate:new Date().toISOString().slice(0,10),result:'TARGET'});

  /* ── Initial load ── */
  useEffect(()=>{
    (async()=>{
      try {
        const [t,al,pr,cfg] = await Promise.allSettled([
          tradeAPI.getAll(), alertAPI.getAll(), priceAPI.getAll(), configAPI.get()
        ]);
        if(t.status==='fulfilled'  && Array.isArray(t.value))   setTrades(t.value);
        if(al.status==='fulfilled' && Array.isArray(al.value))  { setAlerts(al.value); setUnread(al.value.filter(a=>!a.read).length); }
        if(pr.status==='fulfilled' && pr.value?.prices)         setPrices(pr.value.prices);
        if(cfg.status==='fulfilled' && cfg.value)               setConfig(cfg.value);
        lastAlertCheck.current = Date.now();
        setApiErr(null);
      } catch(e) { setApiErr(e.message); }
      finally    { setLoading(false); }
    })();
  },[]);

  /* ── Clock ── */
  useEffect(()=>{ const id=setInterval(()=>setTime(nowIST()),1000); return()=>clearInterval(id); },[]);

  /* ── Price polling every 30s ── */
  useEffect(()=>{
    const poll = async()=>{
      try {
        const res = await priceAPI.getAll();
        if(!res?.prices) return;
        const newP = res.prices;
        // Flash changed cells
        Object.entries(newP).forEach(([sym,q])=>{
          const prev = prevPricesRef.current[sym];
          if(prev && q.price!==prev) {
            const el = document.getElementById(`tp-${sym.replace(/[^a-z0-9]/gi,'-')}`);
            if(el){ el.classList.remove('flash-up','flash-dn'); void el.offsetWidth; el.classList.add(q.price>prev?'flash-up':'flash-dn'); }
          }
          prevPricesRef.current[sym] = q.price;
        });
        setPrices(newP); setLastUpd(res.updated);
      } catch(e){}
    };
    const id = setInterval(poll, 30000);
    return()=>clearInterval(id);
  },[]);

  /* ── Alert polling every 15s ── */
  useEffect(()=>{
    const poll = async()=>{
      try {
        const newAlerts = await alertAPI.getAll(lastAlertCheck.current);
        if(Array.isArray(newAlerts) && newAlerts.length>0) {
          setAlerts(prev=>{ const ids=new Set(prev.map(a=>a._id)); return [...newAlerts.filter(a=>!ids.has(a._id)),...prev]; });
          setUnread(n=>n+newAlerts.length);
          setToast(newAlerts[0]);
        }
        lastAlertCheck.current = Date.now();
      } catch(e){}
    };
    const id = setInterval(poll, 15000);
    return()=>clearInterval(id);
  },[]);

  /* ── Computed stats ── */
  const capital = config.capital||100000;
  const totalInvested = useMemo(()=>trades.reduce((s,t)=>s+(t.qty||1)*t.entry,0),[trades]);
  const totalCurrent  = useMemo(()=>trades.reduce((s,t)=>{
    const q=prices[t.symbol||t.name]; return s+(t.qty||1)*(q?.price||t.currentPrice||t.entry);
  },0),[trades,prices]);
  const totalPnl    = totalCurrent - totalInvested;
  const totalPnlPct = Number(pct(totalCurrent,totalInvested));
  const closedTrades= useMemo(()=>trades.filter(t=>['TARGET','SL','MANUAL_EXIT','CLOSED'].includes((t.status||'').toUpperCase())),[trades]);
  const activeTrades= useMemo(()=>trades.filter(t=>['WAITING','ACTIVE'].includes((t.status||'').toUpperCase().replace(' ','_'))),[trades]);
  const histPnl     = useMemo(()=>closedTrades.reduce((s,t)=>s+(t.exitPrice?t.exitPrice-t.entry:0)*(t.qty||1),0),[closedTrades]);

  /* ── Actions ── */
  const reloadTrades = useCallback(async()=>{
    try { const d=await tradeAPI.getAll(); setTrades(Array.isArray(d)?d:[]); } catch(e){}
  },[]);

  const openAdd  = ()=>{ setEdit(null); setForm(BLANK); setModal('trade'); };
  const openEdit = t=>{ setEdit(t); setForm({...t,entry:String(t.entry),sl:String(t.sl),target:String(t.target),qty:String(t.qty||'')}); setModal('trade'); };
  
  const saveTrade = async()=>{
    try {
      const payload={...form,name:(form.name||form.symbol||'').replace('.NS','').toUpperCase(),
        entry:Number(form.entry),sl:Number(form.sl),target:Number(form.target),
        qty:Number(form.qty)||Math.floor(capital/3/Number(form.entry||1))};
      if(editTrade) await tradeAPI.update(editTrade._id, payload);
      else          await tradeAPI.create(payload);
      await reloadTrades(); setModal(null);
    } catch(e){ alert('Error saving trade: '+e.message); }
  };

  const deleteTrade   = async id=>{ await tradeAPI.delete(id); await reloadTrades(); };
  const markActive    = async id=>{ await tradeAPI.update(id,{status:'ACTIVE'}); await reloadTrades(); };
  
  const openClose = t=>{ setCloseT(t); setCloseForm({exitPrice:String(prices[t.symbol||t.name]?.price||t.currentPrice||t.entry),exitDate:new Date().toISOString().slice(0,10),result:'TARGET'}); setModal('close'); };
  const confirmClose  = async()=>{
    try {
      await tradeAPI.close(closeTrade._id,{exitPrice:Number(closeForm.exitPrice),result:closeForm.result,exitDate:closeForm.exitDate});
      await reloadTrades(); setModal(null);
    } catch(e){ alert('Error: '+e.message); }
  };

  const runScanner = async()=>{
    setScan(true);
    try {
      const res = await strategyAPI.getPicks();
      setScanner({stocks:res.picks||[],lastRun:res.generated,totalScanned:res.picks?.length||0});
    } catch(e){ alert('Scanner error: '+e.message); }
    finally { setScan(false); }
  };

  const markAllRead = async()=>{ await alertAPI.markAllRead(); setAlerts(p=>p.map(a=>({...a,read:true}))); setUnread(0); };
  const applyCap   = ()=>{ setConfig(c=>({...c,capital:Number(tmpCap)})); setEditCap(false); };

  const marketOpen = isOpen();

  /* ── RENDER ── */
  if(loading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'#060604',color:'#ff9900',fontFamily:'IBM Plex Mono',fontSize:14,gap:12}}>
      <div className="spinner"/> Connecting to trading server...
    </div>
  );

  return (
    <div className="app">
      {/* TOP BAR */}
      <div className="topbar">
        <div className="topbar-logo">
          <div className="logo-mark">
            <div className="logo-dot" style={{background:'#ff9900'}}/>
            <div className="logo-dot" style={{background:'#00e676'}}/>
            <div className="logo-dot" style={{background:'#00b0ff'}}/>
          </div>
          <span className="logo-text">EMA TERMINAL</span>
          <span className="logo-sub">v2.0 · NSE INDIA</span>
        </div>
        <div className="topbar-right">
          {apiErr && <span style={{color:'var(--red)',fontSize:10}}>⚠ {apiErr}</span>}
          <span>
            <span className={`live-dot ${marketOpen?'':'off'}`} style={{marginRight:4}}/>
            {marketOpen ? <span className="col-green">MARKET OPEN</span> : <span className="col-muted">CLOSED</span>}
          </span>
          <span className="col-amber blink">IST {time}</span>
          {editCap ? (
            <span style={{display:'inline-flex',gap:4,alignItems:'center'}}>
              <input type="number" value={tmpCap} onChange={e=>setTmpCap(e.target.value)} onKeyDown={e=>e.key==='Enter'&&applyCap()}
                style={{width:90,background:'rgba(255,255,255,.05)',border:'1px solid var(--amber)',color:'var(--text2)',padding:'2px 6px',fontSize:11,outline:'none',fontFamily:'IBM Plex Mono'}}/>
              <button className="btn btn-sm" onClick={applyCap}>✓</button>
              <button className="btn btn-sm" onClick={()=>setEditCap(false)}>✕</button>
            </span>
          ) : (
            <span style={{cursor:'pointer'}} onClick={()=>{setTmpCap(String(capital));setEditCap(true);}}>
              Capital: <span className="col-amber">{fmt(capital)}</span> <span style={{fontSize:9,color:'var(--muted2)'}}>✎</span>
            </span>
          )}
          {lastUpd && <span style={{fontSize:9}}>Updated: {new Date(lastUpd).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'})}</span>}
        </div>
      </div>

      {/* TICKER */}
      <Ticker prices={prices}/>

      {/* NAV */}
      <div className="fnbar">
        {[['positions','Positions','1'],['scanner','AI Scanner','2'],['portfolio','Portfolio','3'],
          ['history','History','4'],['alerts','Alerts','5'],['log','Perf Log','6'],['strategy','Strategy','7']].map(([id,label,num])=>(
          <button key={id} className={`fn-key ${tab===id?'active':''}`} onClick={()=>setTab(id)}>
            <span className="fn-num">[F{num}]</span>{label}
            {id==='alerts'&&unread>0&&<span className="fn-badge">{unread}</span>}
          </button>
        ))}
        <div className="fnbar-right">
          <button className="btn btn-sm" onClick={openAdd}>+ NEW TRADE</button>
        </div>
      </div>

      {/* ═══ POSITIONS TAB ═══ */}
      {tab==='positions' && (
        <div className="main-grid" style={{flex:1,overflow:'hidden'}}>
          {/* LEFT — Portfolio summary */}
          <div className="left-panel">
            <div className="pane">
              <div className="pane-hdr">Portfolio Summary</div>
              {[
                ['Capital',     fmt(capital),                           ''],
                ['Invested',    fmt(Math.round(totalInvested)),         ''],
                ['Current Val', fmt(Math.round(totalCurrent)),          totalPnl>=0?'col-green':'col-red'],
                ['Active P&L',  `${totalPnl>=0?'+':''}${fmt(Math.round(totalPnl))}`, totalPnl>=0?'col-green':'col-red'],
                ['Return',      `${totalPnlPct>=0?'+':''}${fmtN(totalPnlPct)}%`,     totalPnlPct>=0?'col-green':'col-red'],
                ['Positions',   `${activeTrades.length} open`,          'col-blue'],
              ].map(([l,v,c])=>(
                <div key={l} className="stat-row">
                  <span className="stat-lbl">{l}</span>
                  <span className={`stat-val ${c}`}>{v}</span>
                </div>
              ))}
            </div>
            {/* Indices */}
            <div className="pane">
              <div className="pane-hdr">Market Indices</div>
              {['^NSEI','^NSEBANK'].map(sym=>{
                const q=prices[sym]; if(!q) return <div key={sym} className="stat-row"><span className="stat-lbl">{sym.replace('^','')}</span><span className="col-muted">—</span></div>;
                const up=(q.changePct||0)>=0;
                return (
                  <div key={sym} className="stat-row">
                    <span className="stat-lbl">{sym.replace('^','')}</span>
                    <span><span className={`stat-val ${up?'col-green':'col-red'}`}>{(q.price||0).toLocaleString('en-IN')}</span>
                      <span style={{fontSize:10,color:up?'var(--green)':'var(--red)',marginLeft:4}}>{up?'▲':'▼'}{fmtN(Math.abs(q.changePct||0))}%</span>
                    </span>
                  </div>
                );
              })}
            </div>
            {/* Scanner status */}
            <div className="pane">
              <div className="pane-hdr"><span>AI Scanner</span>{scanner.lastRun&&<span style={{fontSize:9,color:'var(--cyan)'}}>{new Date(scanner.lastRun).toLocaleDateString('en-IN')}</span>}</div>
              <div className="pane-body" style={{fontSize:10}}>
                {scanner.stocks?.length>0 ? (
                  <>
                    <div className="col-muted" style={{marginBottom:6}}>Last scan: {scanner.stocks.length} picks found</div>
                    {scanner.stocks.slice(0,3).map(s=>(
                      <div key={s.name||s.symbol} style={{padding:'4px 6px',background:'rgba(0,229,255,.06)',borderLeft:'2px solid var(--cyan)',marginBottom:4,fontSize:10}}>
                        <span className="col-cyan fw6">{s.displayName||s.name}</span>
                        <span className="col-muted" style={{marginLeft:6}}>Score:{s.totalScore||0} [{s.confidence||''}]</span>
                      </div>
                    ))}
                  </>
                ) : <div className="col-muted">No scan run yet</div>}
                <button className="btn btn-sm" style={{marginTop:8,width:'100%'}} onClick={runScanner} disabled={scanning}>
                  {scanning?'⟳ SCANNING...':'▶ RUN SCANNER'}
                </button>
              </div>
            </div>
            {/* Alert preview */}
            <div className="pane">
              <div className="pane-hdr"><span>Recent Alerts</span>{unread>0&&<span className="fn-badge">{unread}</span>}</div>
              {alerts.slice(0,5).map(a=>{
                const cfg=aCfg(a.type);
                return (
                  <div key={a._id} className={`alert-item ${!a.read?'unread':''}`}>
                    <div style={{display:'flex',justifyContent:'space-between'}}>
                      <span className="alert-type" style={{color:cfg.col}}>{cfg.icon} {cfg.label}</span>
                      <span className="alert-time">{new Date(a.createdAt||Date.now()).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'})}</span>
                    </div>
                    <div className="alert-sym">{a.symbol}</div>
                    <div className="alert-msg">{a.message}</div>
                  </div>
                );
              })}
              {alerts.length===0&&<div style={{padding:'10px',fontSize:10,color:'var(--muted2)'}}>No alerts yet. They fire automatically.</div>}
            </div>
          </div>

          {/* CENTER — Trade cards */}
          <div className="center-panel">
            <div style={{padding:'8px 8px 4px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid var(--border)'}}>
              <span style={{fontSize:10,color:'var(--amber)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.1em'}}>
                Active Positions [{trades.length}]
              </span>
              <button className="btn btn-sm" onClick={openAdd}>+ ADD</button>
            </div>
            {trades.length===0 && <div className="empty-box"><div className="empty-icon">◧</div><div>No trades. Add a position to begin tracking.</div></div>}
            {trades.map(t=>(
              <TradeCard key={t._id} trade={t} prices={prices}
                onEdit={()=>openEdit(t)} onDelete={()=>deleteTrade(t._id)}
                onMarkActive={()=>markActive(t._id)} onClose={()=>openClose(t)}/>
            ))}
          </div>

          {/* RIGHT — Alert feed */}
          <div className="right-panel">
            <div className="pane-hdr">
              <span>Alert Feed</span>
              {unread>0&&<button className="btn btn-sm" style={{fontSize:9}} onClick={markAllRead}>Mark Read</button>}
            </div>
            {alerts.length===0&&<div style={{padding:'14px',fontSize:10,color:'var(--muted2)'}}>No alerts yet. Alerts fire automatically when price conditions are met by the backend scheduler.</div>}
            {alerts.map(a=>{
              const cfg=aCfg(a.type);
              return (
                <div key={a._id} className={`alert-item ${!a.read?'unread':''}`}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span className="alert-type" style={{color:cfg.col}}>{cfg.icon} {cfg.label}</span>
                    <span className="alert-time">{new Date(a.createdAt||Date.now()).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'})}</span>
                  </div>
                  <div className="alert-sym">{a.symbol}</div>
                  <div className="alert-msg">{a.message}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ SCANNER TAB ═══ */}
      {tab==='scanner' && (
        <div className="tab-content">
          <div className="section-hdr" style={{marginBottom:12}}>
            <span>AI Stock Scanner — EMA 200 + Multi-Factor Engine</span>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              {scanner.lastRun&&<span style={{fontSize:10,color:'var(--muted2)'}}>Last: {new Date(scanner.lastRun).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</span>}
              <button className="btn" onClick={runScanner} disabled={scanning}>{scanning?'⟳ SCANNING NSE...':'▶ RUN SCAN'}</button>
            </div>
          </div>
          <div style={{border:'1px solid var(--border)',padding:'10px 14px',marginBottom:12,background:'var(--panel)',fontSize:10,lineHeight:2}}>
            <span className="col-amber fw7">CRITERIA: </span>
            Price &gt; 200 EMA · Price &gt; 50 EMA · RSI 40–80 · Volume surge · Fresh breakout · Fundamental score ≥55/100
            <span className="col-muted"> | Auto-runs monthly via cron. Manual trigger available above.</span>
          </div>
          {scanning && <div style={{textAlign:'center',padding:'40px',color:'var(--cyan)',fontSize:13,letterSpacing:'.1em'}}>⟳ RUNNING STRATEGY ENGINE — ANALYZING NSE STOCKS...</div>}
          {!scanning && scanner.stocks.length===0 && <div className="empty-box"><div className="empty-icon">◈</div><div>Click RUN SCAN to screen stocks.<br/><span style={{fontSize:10,color:'var(--muted2)'}}>Requires backend server running.</span></div></div>}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:12}}>
            {scanner.stocks.map((s,i)=>(
              <div key={s.symbol||i} className="scan-card">
                <div className="scan-hdr">
                  <span>#{i+1} {s.displayName||s.name} <span style={{fontSize:10,color:'var(--muted2)'}}>{s.symbol}</span></span>
                  <span style={{fontSize:10}}>Score: <span className="col-amber">{s.totalScore||0}</span> | {s.confidence}</span>
                </div>
                <div className="scan-body">
                  {[['Sector',s.sector,''],['CMP',fmt(s.currentPrice||s.entry),'col-white'],
                    ['Entry',fmt(s.entry),'col-amber'],['Stop Loss',fmt(s.sl),'col-red'],
                    ['Target',fmt(s.target),'col-green'],['R:R',`${s.rrRatio}:1`,'col-green'],
                    ['RSI',fmtN(s.rsi,1),s.rsi>=55&&s.rsi<=75?'col-green':'col-amber'],
                    ['Tech Score',s.techScore,'col-cyan'],['Fund Score',s.fundScore,'col-cyan'],
                  ].map(([l,v,c])=>(
                    <div key={l} className="scan-row">
                      <span className="col-muted">{l}</span><span className={`fw6 ${c}`}>{v}</span>
                    </div>
                  ))}
                  <button className="btn btn-green btn-sm" style={{marginTop:10,width:'100%'}}
                    onClick={()=>{
                      setForm({...BLANK,symbol:s.symbol||s.name,name:s.displayName||s.name,sector:s.sector||'',
                        entry:String(s.entry),sl:String(s.sl),target:String(s.target),
                        qty:String(s.qty||Math.floor(capital/3/s.entry)),entryType:s.entryType||'BREAKOUT',
                        confidence:s.confidence||'MEDIUM'});
                      setEdit(null); setModal('trade');
                    }}>
                    + ADD TO PORTFOLIO
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ PORTFOLIO TAB ═══ */}
      {tab==='portfolio' && (
        <div className="tab-content">
          <div className="section-hdr" style={{marginBottom:12}}>Portfolio Breakdown</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:8,marginBottom:16}}>
            {[
              {l:'Capital',v:fmt(capital),c:''},
              {l:'Current Value',v:fmt(Math.round(totalCurrent)),c:totalPnl>=0?'col-green':'col-red'},
              {l:'Active P&L',v:`${totalPnl>=0?'+':''}${fmt(Math.round(totalPnl))}`,c:totalPnl>=0?'col-green':'col-red'},
              {l:'Return',v:`${totalPnlPct>=0?'+':''}${fmtN(totalPnlPct)}%`,c:totalPnlPct>=0?'col-green':'col-red'},
            ].map(item=>(
              <div key={item.l} style={{background:'var(--panel)',border:'1px solid var(--border)',padding:'10px 12px'}}>
                <div style={{fontSize:9,color:'var(--muted2)',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:5}}>{item.l}</div>
                <div className={`fw7 ${item.c}`} style={{fontSize:16}}>{item.v}</div>
              </div>
            ))}
          </div>
          <div style={{overflowX:'auto',border:'1px solid var(--border)'}}>
            <table className="t-table">
              <thead><tr>{['Stock','Sector','Qty','Entry','Invested','Live Price','Value','P&L ₹','P&L %','Status','EMA200','RSI'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {trades.map(t=>{
                  const lp=prices[t.symbol||t.name]?.price||t.currentPrice||t.entry;
                  const bv=(t.qty||1)*t.entry, cv=(t.qty||1)*lp, pl=cv-bv;
                  const pp=Number(pct(cv,bv)), pos=pl>=0;
                  return (
                    <tr key={t._id}>
                      <td className="fw7 col-amber">{t.name}</td>
                      <td className="col-muted">{t.sector}</td>
                      <td>{t.qty||1}</td>
                      <td>{fmt(t.entry)}</td>
                      <td>{fmt(Math.round(bv))}</td>
                      <td id={`tp-${(t.symbol||t.name||'').replace(/[^a-z0-9]/gi,'-')}`} className={pos?'col-green':'col-red'}>{fmt(lp)}</td>
                      <td className={`fw6 ${pos?'col-green':'col-red'}`}>{fmt(Math.round(cv))}</td>
                      <td className={`fw6 ${pos?'col-green':'col-red'}`}>{pos?'+':''}{fmt(Math.round(pl))}</td>
                      <td className={`fw7 ${pos?'col-green':'col-red'}`}>{pos?'+':''}{fmtN(pp)}%</td>
                      <td><Badge status={t.status||'WAITING'}/></td>
                      <td className="col-cyan">{t.ema200?fmt(t.ema200):'—'}</td>
                      <td style={{color:t.rsi&&t.rsi>=55&&t.rsi<=75?'var(--green)':'var(--amber)'}}>{t.rsi?fmtN(t.rsi,1):'—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ HISTORY TAB ═══ */}
      {tab==='history' && (
        <div className="tab-content">
          <div className="section-hdr" style={{marginBottom:12}}>
            <span>Closed Trade History [{closedTrades.length}]</span>
            <span style={{fontSize:10,color:'var(--muted2)'}}>
              Realised P&L: <span className={histPnl>=0?'col-green':'col-red'}>{histPnl>=0?'+':''}{fmt(Math.round(histPnl))}</span>
            </span>
          </div>
          {closedTrades.length===0 && <div className="empty-box"><div className="empty-icon">📂</div><div>No closed trades yet.</div></div>}
          {closedTrades.length>0 && (
            <div style={{overflowX:'auto',border:'1px solid var(--border)'}}>
              <table className="t-table">
                <thead><tr>{['Stock','Sector','Date','Exit Date','Entry','Exit Price','Qty','P&L ₹','P&L %','Result'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {closedTrades.map(t=>{
                    const ep=t.exitPrice||t.entry, pl=(ep-t.entry)*(t.qty||1), pp=Number(pct(ep,t.entry)), win=pl>=0;
                    return (
                      <tr key={t._id}>
                        <td className="fw7 col-amber">{t.name}</td>
                        <td className="col-muted">{t.sector}</td>
                        <td className="col-muted">{t.createdAt?new Date(t.createdAt).toLocaleDateString('en-IN'):''}</td>
                        <td className="col-muted">{t.closedAt?new Date(t.closedAt).toLocaleDateString('en-IN'):''}</td>
                        <td>{fmt(t.entry)}</td>
                        <td className={win?'col-green':'col-red'}>{fmt(ep)}</td>
                        <td>{t.qty||1}</td>
                        <td className={`fw6 ${win?'col-green':'col-red'}`}>{win?'+':''}{fmt(Math.round(pl))}</td>
                        <td className={`fw7 ${win?'col-green':'col-red'}`}>{win?'+':''}{fmtN(pp)}%</td>
                        <td><Badge status={t.status}/></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ ALERTS TAB ═══ */}
      {tab==='alerts' && (
        <div className="tab-content">
          <div className="section-hdr" style={{marginBottom:12}}>
            <span>Alert Log [{alerts.length}] · Unread: <span className="col-red">{unread}</span></span>
            {unread>0 && <button className="btn btn-sm" onClick={markAllRead}>MARK ALL READ</button>}
          </div>
          {alerts.length===0 && <div className="empty-box"><div className="empty-icon">🔔</div><div>No alerts yet.<br/><span style={{fontSize:10,color:'var(--muted2)'}}>Alerts fire automatically from the backend based on price movements.</span></div></div>}
          <div style={{border:'1px solid var(--border)'}}>
            {alerts.map(a=>{
              const cfg=aCfg(a.type);
              return (
                <div key={a._id} className={`alert-item ${!a.read?'unread':''}`} style={{padding:'10px 14px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:3}}>
                    <span style={{fontSize:10,fontWeight:700,color:cfg.col,letterSpacing:'.08em'}}>{cfg.icon} {cfg.label}</span>
                    <span style={{fontSize:9,color:'var(--muted2)'}}>{new Date(a.createdAt||Date.now()).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</span>
                  </div>
                  <div style={{fontSize:11,fontWeight:600,color:'var(--text2)'}}>{a.symbol}</div>
                  <div style={{fontSize:10,color:'var(--text)',marginTop:2}}>{a.message}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ PERF LOG TAB ═══ */}
      {tab==='log' && (
        <div className="tab-content">
          <div className="section-hdr" style={{marginBottom:12}}>
            <span>Monthly Performance Log</span>
            <button className="btn btn-sm" onClick={()=>setModal('month')}>+ ADD MONTH</button>
          </div>
          <div className="chart-wrap" style={{marginBottom:16}}><PerfChart monthly={monthly}/></div>
          {monthly.length===0 && <div className="empty-box"><div className="empty-icon">📊</div><div>No monthly data yet. Add monthly records to track performance.</div></div>}
          {monthly.length>0 && (
            <div style={{overflowX:'auto',border:'1px solid var(--border)'}}>
              <table className="t-table">
                <thead><tr>{['Month','Start Capital','End Capital','P&L','Return %'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {monthly.map((m,i)=>{
                    const pl=m.end-m.start, ret=Number(pct(m.end,m.start)), pos=pl>=0;
                    return (
                      <tr key={i}>
                        <td className="fw6 col-amber">{m.month}</td>
                        <td>{fmt(m.start)}</td>
                        <td className={pos?'col-green':'col-red'}>{fmt(m.end)}</td>
                        <td className={`fw6 ${pos?'col-green':'col-red'}`}>{pos?'+':''}{fmt(Math.round(pl))}</td>
                        <td className={`fw7 ${pos?'col-green':'col-red'}`}>{pos?'+':''}{fmtN(ret)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ STRATEGY TAB ═══ */}
      {tab==='strategy' && (
        <div className="tab-content" style={{maxWidth:800}}>
          <div className="section-hdr" style={{marginBottom:12}}>Strategy Reference Guide</div>
          {[
            {title:'WHAT IS 200 EMA BREAKOUT?',col:'var(--cyan)',body:'The 200-period EMA on a weekly chart defines long-term trend direction. A breakout above it with volume confirms institutional buying. This is one of the most reliable setups in technical analysis, used by hedge funds globally to filter long trades.'},
            {title:'SCANNER LOGIC (HOW AI PICKS STOCKS)',col:'var(--amber)',body:'The strategy engine scores each NSE stock 0–100 using: Technical Analysis (60%) — EMA position, RSI, MACD, volume spike, golden cross, supertrend. Fundamental Analysis (40%) — revenue growth, ROE, ROCE, D/E ratio, promoter holding, FCF. Only stocks scoring ≥55 with RSI 40–80 and above 200 EMA qualify.'},
            {title:'ENTRY CONDITIONS',col:'var(--green)',body:'[1] BREAKOUT: Weekly candle closes above 200 EMA with volume > 1.3× 20-day average. Enter at close or next day open within 2% of EMA.\n[2] EMA50 BOUNCE: Price retraces to 50 EMA after breakout and bounces with momentum.\n[3] EMA20 PULLBACK: In strong trends, use 20 EMA retests as lower-risk entries.'},
            {title:'STOP LOSS & POSITION SIZING',col:'var(--red)',body:'SL = Entry − 2× ATR(14) or 50 EMA (whichever is higher). Risk per trade = 1.5% of total capital. Position size = Risk Amount ÷ (Entry − SL). In TRANSITIONAL regime: reduce size by 50%. When VIX > 20: reduce by 40%. HIGH confidence: full size. MEDIUM: 75%. LOW: skip trade.'},
            {title:'EXIT RULES',col:'var(--purple)',body:'T1 (2:1 R:R): Book 50% profit, move SL to breakeven.\nT2 (3.5:1 R:R): Trail remaining position.\nTime Stop: No meaningful progress in 10 days — exit.\nInvalidation: Full close BELOW 200 EMA on weekly chart.'},
          ].map(s=>(
            <div key={s.title} style={{border:'1px solid var(--border)',marginBottom:8,background:'var(--panel)'}}>
              <div style={{background:'rgba(255,153,0,.06)',borderBottom:'1px solid var(--border)',padding:'6px 12px',fontSize:10,fontWeight:700,color:s.col,letterSpacing:'.1em'}}>{s.title}</div>
              <div style={{padding:'10px 12px',fontSize:11,color:'var(--text)',lineHeight:1.8,whiteSpace:'pre-line'}}>{s.body}</div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ MODALS ═══ */}
      {/* Add/Edit Trade */}
      <Modal show={modal==='trade'} onClose={()=>setModal(null)} title={editTrade?`EDIT — ${editTrade.name}`:'ADD NEW POSITION'}>
        <div className="form-grid">
          <FInput label="Symbol (e.g. RELIANCE.NS)" value={form.symbol} onChange={e=>setForm({...form,symbol:e.target.value})} placeholder="RELIANCE.NS"/>
          <FInput label="Display Name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="RELIANCE"/>
        </div>
        <div className="form-grid">
          <FInput label="Sector" value={form.sector} onChange={e=>setForm({...form,sector:e.target.value})} placeholder="Energy"/>
          <FSelect label="Status" value={form.status} onChange={e=>setForm({...form,status:e.target.value})} options={['WAITING','ACTIVE','TARGET','SL']}/>
        </div>
        <div className="form-grid">
          <FInput label="Entry Price (₹)" type="number" value={form.entry} onChange={e=>setForm({...form,entry:e.target.value})} placeholder="2850"/>
          <FInput label="Qty (blank=auto)" type="number" value={form.qty} onChange={e=>setForm({...form,qty:e.target.value})} placeholder={form.entry?String(Math.floor(capital/3/Number(form.entry||1))):'auto'}/>
          <FInput label="Stop Loss (₹)" type="number" value={form.sl} onChange={e=>setForm({...form,sl:e.target.value})} placeholder="2700"/>
          <FInput label="Target Price (₹)" type="number" value={form.target} onChange={e=>setForm({...form,target:e.target.value})} placeholder="3150"/>
        </div>
        <div className="form-grid">
          <FSelect label="Setup Type" value={form.entryType||'BREAKOUT'} onChange={e=>setForm({...form,entryType:e.target.value})} options={['BREAKOUT','EMA50_BOUNCE','EMA20_PULLBACK','MONITOR']}/>
          <FSelect label="Confidence" value={form.confidence||'MEDIUM'} onChange={e=>setForm({...form,confidence:e.target.value})} options={['HIGH','MEDIUM','LOW']}/>
        </div>
        {form.entry&&form.sl&&form.target&&(
          <div style={{background:'rgba(255,153,0,.06)',border:'1px solid var(--border)',padding:'8px 12px',marginBottom:12,fontSize:11,display:'flex',gap:16,flexWrap:'wrap'}}>
            <span>R:R: <span className="col-green fw6">{((Number(form.target)-Number(form.entry))/(Number(form.entry)-Number(form.sl))).toFixed(1)}:1</span></span>
            <span>Exp Return: <span className="col-green fw6">+{pct(form.target,form.entry)}%</span></span>
            <span>Max Loss: <span className="col-red fw6">{pct(form.sl,form.entry)}%</span></span>
            <span>Allocation: <span className="col-amber fw6">{fmt(Math.round(capital/3))}</span></span>
          </div>
        )}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button className="btn" onClick={()=>setModal(null)}>CANCEL</button>
          <button className="btn btn-green" onClick={saveTrade} disabled={!form.entry||!form.sl||!form.target}>{editTrade?'UPDATE':'ADD POSITION'}</button>
        </div>
      </Modal>

      {/* Close Trade */}
      <Modal show={modal==='close'} onClose={()=>setModal(null)} title={`CLOSE — ${closeTrade?.name}`}>
        {closeTrade&&(
          <>
            <div style={{background:'rgba(255,153,0,.06)',border:'1px solid var(--border)',padding:'10px 12px',marginBottom:14,fontSize:11}}>
              <div style={{display:'flex',justifyContent:'space-between'}}><span className="fw7 col-amber">{closeTrade.name}</span><Badge status={closeTrade.status}/></div>
              <div className="col-muted" style={{marginTop:4}}>Entry: {fmt(closeTrade.entry)} · SL: {fmt(closeTrade.sl)} · Target: {fmt(closeTrade.target)} · Qty: {closeTrade.qty}</div>
            </div>
            <FInput label="Exit Price (₹)" type="number" value={closeForm.exitPrice} onChange={e=>setCloseForm({...closeForm,exitPrice:e.target.value})} placeholder="Exit price"/>
            <FInput label="Exit Date" type="date" value={closeForm.exitDate} onChange={e=>setCloseForm({...closeForm,exitDate:e.target.value})}/>
            <FSelect label="Exit Reason" value={closeForm.result} onChange={e=>setCloseForm({...closeForm,result:e.target.value})} options={['TARGET','SL','MANUAL_EXIT','CLOSED']}/>
            {closeForm.exitPrice&&Number(closeForm.exitPrice)>0&&(()=>{
              const ep=Number(closeForm.exitPrice), pl=(ep-closeTrade.entry)*(closeTrade.qty||1), pp=Number(pct(ep,closeTrade.entry)), win=pl>=0;
              return (
                <div style={{background:win?'var(--green-bg)':'var(--red-bg)',border:`1px solid ${win?'rgba(0,230,118,.3)':'rgba(255,23,68,.3)'}`,padding:'10px 14px',marginBottom:14,display:'flex',gap:24}}>
                  <div><div style={{fontSize:9,color:'var(--muted2)',marginBottom:2}}>P&L</div><div className={`fw7 ${win?'col-green':'col-red'}`} style={{fontSize:16}}>{win?'+':''}{fmt(Math.round(pl))}</div></div>
                  <div><div style={{fontSize:9,color:'var(--muted2)',marginBottom:2}}>Return</div><div className={`fw7 ${win?'col-green':'col-red'}`} style={{fontSize:16}}>{win?'+':''}{fmtN(pp)}%</div></div>
                </div>
              );
            })()}
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn" onClick={()=>setModal(null)}>CANCEL</button>
              <button className="btn btn-green" onClick={confirmClose} disabled={!closeForm.exitPrice}>CONFIRM CLOSE</button>
            </div>
          </>
        )}
      </Modal>

      {/* Month Modal */}
      <Modal show={modal==='month'} onClose={()=>setModal(null)} title="ADD MONTHLY RECORD">
        <FInput label="Month (e.g. Jun 2025)" value={''} onChange={()=>{}} placeholder="Jun 2025" id="mmonth"/>
        <div className="form-grid">
          <FInput label="Capital at Start (₹)" type="number" id="mstart" placeholder="100000"/>
          <FInput label="Capital at End (₹)" type="number" id="mend" placeholder="107200"/>
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button className="btn" onClick={()=>setModal(null)}>CANCEL</button>
          <button className="btn btn-green" onClick={()=>{
            const mo=document.getElementById('mmonth')?.value;
            const ms=document.getElementById('mstart')?.value;
            const me=document.getElementById('mend')?.value;
            if(mo&&ms&&me){ setMonthly(p=>[...p,{month:mo,start:Number(ms),end:Number(me)}]); setModal(null); }
          }}>SAVE</button>
        </div>
      </Modal>

      {/* Toast */}
      <Toast toast={toast} onDismiss={()=>setToast(null)}/>
    </div>
  );
}
