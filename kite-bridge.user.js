// ==UserScript==
// @name         Rocket Scanner — Kite bridge
// @namespace    rocket-scanner
// @version      1.5
// @description  Serve the Rocket Scanner's requests for 5-minute chart data from your own logged-in Kite tab.
// @match        https://kite.zerodha.com/*
// @match        https://axionaut.github.io/rocket-scanner/*
// @include      file://*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @updateURL    https://axionaut.github.io/rocket-scanner/kite-bridge.user.js
// @downloadURL  https://axionaut.github.io/rocket-scanner/kite-bridge.user.js
// @run-at       document-idle
// ==/UserScript==
//
// NB ON THE MATCH LINES: every line between ==UserScript== and ==/UserScript== must begin with @.
// A prose comment in there is not just untidy - the parser can stop reading at it and silently drop
// the @grant lines below, leaving GM_setValue undefined and the script dead on its first call.
// `@include file://*` rather than a @match pattern because the local path contains a SPACE
// ("Rocket Scanner" -> "Rocket%20Scanner"), which @match will not survive; the guard in the body
// keeps it from acting on any other local page.
//
// WHAT THIS IS, AND WHAT IT IS NOT
//
// It runs inside the Kite tab you already have open and logged in. It reads a table that is already
// rendered on your screen and hands it to the scanner. It does NOT drive a separate browser, does
// NOT hold its own credentials, and does NOT poll on a timer.
//
// It is DEMAND-DRIVEN: the scanner publishes a short list of symbols it wants, this script serves
// exactly that list, then goes idle. The scanner also enforces its own cap (12 symbols per 15
// minutes) before a request is ever published, so the ceiling is not a setting in here that could
// drift. If you want fewer, lower PACE_MS.
//
// SETUP - install ONCE from the hosted copy so it can update itself:
//   https://axionaut.github.io/rocket-scanner/kite-bridge.user.js
// Opening that link in a browser with Tampermonkey installed offers to install it, and sets the
// update URL automatically. Every later fix ships by bumping @version and pushing - no re-pasting.
//   1. Install Tampermonkey.
//   2. Open the link above and accept the install.
//   3. Keep a Kite chart tab open (any symbol) alongside the scanner.
//   4. In the scanner, press "Fetch via Kite".

(function(){
  'use strict';
  // THE SANDBOX TRAP. The moment a userscript uses ANY @grant, Tampermonkey runs it in an isolated
  // world and `window` becomes a sandboxed copy - NOT the page's window. Setting a hook on it is
  // invisible to the page, which is exactly what happened: the console logged "connected" from
  // userscript.html while the app's button still read "helper not installed", with no error
  // anywhere. `unsafeWindow` is the page's real window. Everything shared with the app must go
  // through PAGE, never through `window`.
  const PAGE = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const REQ='rocketScannerKiteBridge_req';
  const RES='rocketScannerKiteBridge_res';
  const ALIVE='rocketScannerKiteBridge_alive';   // Kite tab heartbeat, so the scanner can tell
  const LOG='rocketScannerKiteBridge_log';       // what the Kite tab is doing, shown in the scanner
  const PACE_MS = 4000; // gap between symbols. Deliberately slow: this is a person's pace.

  const onKite = location.hostname === 'kite.zerodha.com';
  // On a file:// page this may attach to any local HTML, so only act where the scanner actually is.
  if(!onKite && !document.getElementById('tblOuter') && !/rocket|scanner/i.test(location.href)) return;

  // ── SCANNER SIDE ───────────────────────────────────────────────────────────────────────────
  // Publish requests the page makes, and feed results back through the app's own ingest hook.
  if(!onKite){
    // Defining this hook is ALSO how the app knows the helper is installed - without it the Fetch
    // button greys out and says so rather than publishing a request nobody will collect.
    PAGE.__rocketBridgeRequest = function(req){
      try{ GM_setValue(REQ, JSON.stringify({...req, at: Date.now()})); }catch(e){}
    };
    // A DOM marker as well as the hook: the document is shared with the page in every sandbox
    // mode, so this is the one signal that cannot be isolated away.
    try{ document.documentElement.setAttribute('data-rocket-bridge','1'); }catch(e){}
    // Let the app ask whether a KITE TAB is actually listening. Without this the scanner could only
    // report that it had published a request - which it did, into silence.
    PAGE.__rocketBridgeStatus = function(){
      let alive=0,log='';
      try{ alive=Number(GM_getValue(ALIVE,0))||0; }catch(e){}
      try{ log=String(GM_getValue(LOG,'')||''); }catch(e){}
      return {kiteSeenMsAgo: alive?Date.now()-alive:null, lastLog: log};
    };
    console.log('[kite-bridge] connected to Rocket Scanner (hook on page window:',
                typeof PAGE.__rocketBridgeRequest === 'function', ')');
    try{
      // app.js may still be loading, so the hook is looked up at DELIVERY time and anything that
      // arrives early is held until the app is ready rather than dropped.
      let queued=[];
      const deliver=p=>{
        if(typeof PAGE.__rocketIntradayIngest !== 'function'){ queued.push(p); return false; }
        console.log('[kite-bridge] ingested', p.symbol, p.rows.length, 'rows',
                    PAGE.__rocketIntradayIngest(p.symbol, p.rows));
        return true;
      };
      setInterval(()=>{ if(queued.length && typeof PAGE.__rocketIntradayIngest==='function'){
        const q=queued; queued=[]; q.forEach(deliver); } }, 1500);
      GM_addValueChangeListener(RES, function(_n,_o,val){
        try{
          const p = typeof val === 'string' ? JSON.parse(val) : val;
          if(!p || !p.symbol || !Array.isArray(p.rows)) return;
          deliver(p);
        }catch(e){ console.warn('[kite-bridge] ingest failed', e); }
      });
    }catch(e){}
    return;
  }

  // ── KITE SIDE ──────────────────────────────────────────────────────────────────────────────
  const $ = s => document.querySelector(s);
  const sleep = ms => new Promise(r=>setTimeout(r,ms));

  function readTable(){
    const tbl = $('.ciq-data-table-wrapper table');
    if(!tbl) return null;
    const rows = Array.from(tbl.querySelectorAll('tbody tr'))
      .map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()))
      .filter(r => r.length >= 5 && r[0]);
    if(rows.length < 5) return null;
    // Volume is the LAST of the eight columns. Five columns means "+ Additional columns" has not
    // been applied, and a five-column read produces no flow at all - so report it and retry rather
    // than ingest something inert.
    if(rows[0].length < 8) return {short: true, rows: rows};
    return rows;
  }

  // Kite's chart URL is PATH-based: /markets/chart/web/ciq/NSE/MANCREDIT/6354689
  // v1.4 read it from the HASH, so the confirmation after a switch could never succeed and every
  // symbol reported "could not switch" even when the chart had actually moved.
  function currentSymbol(){
    try{
      const m = location.pathname.match(/\/(?:ciq|tvc)\/[A-Z]+\/([A-Z0-9&_.\-]+)\//i);
      if(m) return m[1].toUpperCase();
      const h = new URLSearchParams(location.hash.replace(/^#/, ''));
      return (h.get('tradingsymbol') || '').toUpperCase();
    }catch(e){ return ''; }
  }

  // Report what this page actually offers, so a broken selector is fixed from one paste rather than
  // another round of guessing.
  function dumpSelectors(){
    const probe = {
      'cq-lookup input'           : document.querySelectorAll('cq-lookup input').length,
      'input[placeholder*=earch]' : document.querySelectorAll('input[placeholder*="earch" i]').length,
      '.ciq-search input'         : document.querySelectorAll('.ciq-search input').length,
      'cq-item'                   : document.querySelectorAll('cq-item').length,
      '.ciq-data-table-wrapper'   : document.querySelectorAll('.ciq-data-table-wrapper').length,
      '.ciq-data-table-container' : document.querySelectorAll('.ciq-data-table-container').length
    };
    say('SELECTORS ' + JSON.stringify(probe) + ' | path ' + location.pathname);
    console.log('[kite-bridge] inputs on page:',
      [...document.querySelectorAll('input')].slice(0, 12)
        .map(i => ({cls: i.className, ph: i.placeholder, id: i.id, val: i.value})));
    console.log('[kite-bridge] labelled buttons:',
      [...document.querySelectorAll('[title],[aria-label]')].slice(0, 40)
        .map(x => x.getAttribute('title') || x.getAttribute('aria-label')).filter(Boolean));
  }

  // Switch symbol through the chart's own lookup box rather than reloading the page - a reload
  // re-authenticates and re-fetches everything, which is exactly the load we are trying not to add.
  async function selectSymbol(sym){
    if(currentSymbol() === sym) return true;
    const input = $('cq-lookup input')
      || $('input[placeholder*="earch" i]')
      || $('.ciq-search input')
      || [...document.querySelectorAll('input[type="text"], input:not([type])')]
           .find(i => i.offsetParent && i.clientWidth > 60);
    if(!input){ say('no symbol box found - send me the SELECTORS line above'); return false; }
    input.focus();
    input.click();
    // Set through the NATIVE setter: a framework-controlled input ignores a plain `.value =`,
    // which is why v1.4 typed the symbol into the box and the chart never moved.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '');
    input.dispatchEvent(new Event('input', {bubbles: true}));
    await sleep(200);
    setter.call(input, sym);
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('keyup', {bubbles: true}));
    await sleep(1200);
    const hit = document.querySelector('cq-item[cq-focused], cq-item, .ciq-result, .results-item, .search-result');
    if(hit){ hit.click(); }
    else {
      for(const type of ['keydown', 'keypress', 'keyup']){
        input.dispatchEvent(new KeyboardEvent(type, {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
      }
    }
    for(let i = 0; i < 24; i++){
      await sleep(250);
      if(currentSymbol() === sym) return true;
    }
    return false;
  }

  // OWNER: "Zerodha always defaults to the chart view on every click. We then have to click on the
  // Table layout and then Additional Columns button to get all 8 columns in view." So this is TWO
  // clicks, and it has to run after EVERY symbol switch rather than once per session.
  async function openDataTable(){
    if(!$('.ciq-data-table-wrapper table')){
      const toggle = $('[cq-data-table]') || $('.ciq-data-table-toggle')
        || [...document.querySelectorAll('[title],[aria-label]')]
             .find(x => /table/i.test(x.getAttribute('title') || x.getAttribute('aria-label') || ''));
      if(toggle){ toggle.click(); await sleep(700); }
    }
    if(!$('.ciq-data-table-wrapper table')) return false;
    // "+ Additional columns" - without it the table is five columns and VOLUME is missing, which is
    // the one column the whole flow read depends on. Only click it while it still reads "+".
    const cols = [...document.querySelectorAll('button, a, div[role="button"]')]
      .find(x => /additional columns/i.test(x.textContent || ''));
    if(cols && /^\s*\+/.test(cols.textContent || '')){ cols.click(); await sleep(500); }
    return !!$('.ciq-data-table-wrapper table');
  }

  const beat = ()=>{ try{ GM_setValue(ALIVE, Date.now()); }catch(e){} };
  const say  = m =>{ try{ GM_setValue(LOG, m); }catch(e){} console.log('[kite-bridge]', m); };
  beat(); setInterval(beat, 15000);   // local heartbeat only - touches no network and no exchange

  let busy = false;
  async function serve(reqRaw){
    if(busy) return;
    let req; try{ req = typeof reqRaw==='string' ? JSON.parse(reqRaw) : reqRaw; }catch(e){ return; }
    if(!req || !Array.isArray(req.symbols) || !req.symbols.length) return;
    busy = true;
    say('serving '+req.symbols.join(', '));
    try{
      for(const sym of req.symbols){
        const ok = await selectSymbol(sym);
        if(!ok){ say('could not switch the chart to '+sym+' - the symbol box selector needs fixing'); continue; }
        await openDataTable();
        let rows = null;
        for(let i = 0; i < 12; i++){
          await sleep(400);
          const r = readTable();
          if(Array.isArray(r)){ rows = r; break; }
          if(r && r.short){ await openDataTable(); }      // re-click "+ Additional columns"
        }
        if(!rows){ say('no 8-column table for ' + sym + ' - could not reach Additional columns'); continue; }
        GM_setValue(RES, JSON.stringify({symbol: sym, rows, at: Date.now()}));
        say('sent '+sym+' ('+rows.length+' rows)');
        await sleep(PACE_MS);
      }
    } finally {
      busy = false;
      try{ GM_setValue(REQ, JSON.stringify({symbols:[],servedAt:Date.now()})); }catch(e){}
    }
  }

  try{ GM_addValueChangeListener(REQ, (_n,_o,val)=>serve(val)); }catch(e){}
  // Serve anything already waiting when the tab opens, then go quiet.
  try{ const pending = GM_getValue(REQ,''); if(pending) serve(pending); }catch(e){}
  say('ready on '+(currentSymbol()||'(no symbol in the url - open a CHART page)'));
  dumpSelectors();
})();
