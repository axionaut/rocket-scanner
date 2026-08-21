const BUILD_TS='2026-08-21 16:05 IST'; // release build time (IST)
const APP_VERSION=1212; // v1212: targets come from the market - its own tape, the session, the circuit - never from his trade history.
// v1093: a baseline reward:risk MEASURED on the cross-section (last completed bhav session) instead of learned from the owner's own fills - reported on every row, deliberately not enforced. Includes v1092: position size split by Radar score / stop distance, so equally-scored names carry equal RUPEE risk, plus an opt-in Risk /trade cap.
// v556: parse the NSE Market Activity Report (MA<date>.csv) — official Nifty %, advances/declines and sector index moves shown as market CONTEXT in the status bar (EOD data, display only, never fed into per-row scoring); MA added to the ℹ️ file manifest.
// v555 market-cycle stage awareness (stateless, self-calibrating): per-row stage label (1 accumulation · 2 breakout · 3 event · 4 profit-booking · 5 re-accumulation · 6 second-leg); a quiet-accumulation signal (conjunction-of-percentiles) injected via the rocket-diagnostic weighting; sell-the-news decay off Recent earnings date (horizon = review days). v1065 makes the market-breadth gauge an entry-eligibility input while still never changing ranking.
const GOOGLE_DRIVE_CLIENT_ID='1015012642264-oi2nelv3v90k3d39r994a6nelgjs2a56.apps.googleusercontent.com'; // Public OAuth Web Client ID.
const PRICE_BAND_BLOCK_BUFFER_PCT=0.15; // Treat rounded 4.9/9.9/19.9 rows as effectively band-locked.
const BASKET_CASH_RESERVE_RS=1; // Leave a rupee for broker-side tax/rounding differences.
const MAX_TURNOVER_PARTICIPATION=0.001; // Market-impact rail: never exceed 0.10% of a stock's daily rupee turnover.
const BASKET_MARKET_BUDGET_BUFFER_PCT=0.25; // Sizing cushion only; exported buys remain MARKET orders.
let RADAR_STRETCH_USE_TARGET=true;
const SYSTEM_TRADE_START_DATE='2026-04-01'; // Adaptive stats use trades closed from this date onward.
const HARVEST_DAILY_NET_GOAL_RS=15000; // North-star daily pure-profit goal, never a forced capital assumption.
const HARVEST_DESIRED_NET_PCT=0.60; // Minimum useful net profit after charges for capital rotation.
const HARVEST_TRIGGER_CONFIDENCE=0.60; // Prefer a target that prior picks commonly reached.
const HARVEST_MIN_SAMPLES=8;
const SL_ATR_MULT=1.5;
const SL_MIN_PCT=3.0;
const SL_MAX_PCT=8.0;
let MARKET_MODE='stock';
function modeKey(base){return base;}
function inputBaseName(name){
  return String(name||'').split(/[\\/]/).pop().trim();
}
function inputNameLower(name){
  return inputBaseName(name).toLowerCase();
}
function normaliseInputFilename(name){
  return inputNameLower(name)
    .replace(/^\ufeff/,'')
    .replace(/\s*\(\d+\)(?=\.[^.]+$)/,'')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();
}
function isExactCsvName(name, expected){
  return normaliseInputFilename(name)===normaliseInputFilename(expected)&&/\.csv$/i.test(inputBaseName(name));
}
function isScannerCsvName(name){
  return isExactCsvName(name,'ALL NSE.csv');
}
function isAllNseFilename(name){
  return isScannerCsvName(name);
}
function looksLikeAllNseRows(rows){
  if(!Array.isArray(rows)||rows.length<100) return false;
  const headers=Object.keys(rows[0]||{}).map(normaliseInputFilename);
  return headers.length>=50&&
    headers.includes('symbol')&&
    headers.includes('price')&&
    headers.some(h=>h.includes('price change')&&h.includes('1 day'))&&
    headers.some(h=>h.includes('volume')&&h.includes('1 day'));
}
function isReportsZipName(name){
  return inputNameLower(name)==='reports-daily-multiple.zip';
}
function isCsvLikeFile(file){
  const name=inputBaseName(file?.name||file||'');
  const type=String(file?.type||'').toLowerCase();
  return /\.csv$/i.test(name)||type.includes('csv')||type.includes('comma-separated')||type.includes('excel');
}
function isLooseNseSupportCsvName(name){
  const n=inputNameLower(name);
  return n==='nse holidays.csv'||
    n==='block.csv'||
    n==='bulk.csv'||
    /^cm_52_wk_high_low_\d{8}\.csv$/i.test(inputBaseName(name))||
    /^reg1_ind\d{6}\.csv$/i.test(inputBaseName(name))||
    /^sec_bhavdata_full_\d{8}\.csv$/i.test(inputBaseName(name))||
    /^sec_list_\d{8}\.csv$/i.test(inputBaseName(name));
}

function updateModeUI(){
  const brand=document.querySelector('.brand-tag');
  if(brand) brand.textContent='Same-Day Composite Radar';
  document.querySelectorAll('.currency-lbl').forEach(el=>{el.textContent='₹';});
}
let ALL=[],FILT=[],PG=1,PGSZ=100,SCOL='rank',SDIR=1;
let _tvLoadedThisSession=false; // true once a TV CSV has been processed this session
let PERF_PERIOD_FILTER='all'; // 'all' | '1m' | '3m' | '6m' | '1y'
let PERF_TRACK_ISSUE=null; // issue date selected in the recommendation-tracking outcome panel
let PERF_LATEST_SUMMARY=null; // cached latest session summary from buildLatestSessionPanel — used by renderStats card
let PERF_RENDERED=false; // true after background or foreground performance calculation
let PERF_RENDER_QUEUED=false;
let PERF_RENDER_WAITING_FOR_VISIBLE=false;
let ENGINE_DATA={}; // legacy engine metadata shell; the Radar composite keeps its own RADAR state
let SUPPRESSED_HELD=0; // count of RANKED stocks you already hold (v1070: informational, no longer hidden)
let SURV_HARD_REMOVED=0; // count of stocks weeded out by configured surveillance rules
let PEAK_TIMING_REMOVED=0; // count of ranked rows withheld by stock/market entry confirmation
let CURRENT_TRADE_TIMING={state:'Neutral',reason:'Trade timing evidence is not loaded.',evidence:[]};
let ALLOC_BLOCKED=0; // count of ranked rows removed because no share can be allocated to them (v1080)
let DIRECTION_REMOVED=0; // v1087: ranked rows removed for not currently going UP (below VWAP/open, or red on the day)
let REMOVED_ROWS=[]; // [{s, reason:'held'|'surv'|'peak'|'alloc', rules?, detail?}] captured each applyFilters pass so the
                     // "Removed from rankings" table can explain every gap in the rank sequence (v546)
let SELECTED=new Set(); // symbols selected for basket — recomputed from FILT each applyFilters
let EXPORT_EXCLUDED=new Set(); // symbols the user unchecked from export — persisted in rs_filters
// Startup hydration renders (and therefore calls applyFilters → saveFilterState) before
// the saved filters have been read back into the DOM. Without this latch those empty
// inputs overwrite the stored state, so every refresh reset the user's filters.
let FILTERS_RESTORED=false;
let FILE_LOAD_STATUS={source:null,when:null,files:[]};
// Radar composite scorer state (v517): one same-day transparent cross-sectional model.
let RADAR={headers:[],matrix:[],features:[],ids:{},rockets:0,continuationCount:0,ms:0,sourceNote:'',scoredAt:null};
const SCANNER_STORE='rs_filters';
const SHARED_FILTER_STORE='rs_filters_shared';
const TRADE_INPUTS_STORE='rs_trade_inputs_v1';
let _lastTradeInputSig=''; // gate brain writes to genuine trade-input changes, not every keystroke
const ALL_STORE='rs_data';
const ALL_STORE_SCHEMA='radar_composite_v12'; // v1202 adds persisted causal trigger state.
const HOLD_STORE='rs_holdings';
const ORDERS_STORE='rs_orders';
const POS_STORE='rs_positions';
const TRADEBOOK_STORE='rs_tradebook';
const TRADEBOOK_META_STORE='rs_tradebook_meta_v1';
const TRADE_TIMING_CONTEXT_STORE='rs_trade_timing_context_v1';
const SURV_RULE_STORE='rs_surv_rules';
// v1211: set once, the first time v1169's retirement is applied to an existing brain. After that
// the owner's saved set is authoritative and nothing strips it again - see loadSurvRules.
const SURV_RETIRE_MARK='rs_surv_retired_v1169';
const SURV_CORR_STORE='rs_surv_corr';
const SAME_DAY_EXIT_OPPORTUNITY_STORE='rs_same_day_exit_opportunity_v3';
const RECOMMEND_OUTCOME_STORE='rs_recommend_outcomes_delta_v1';
const POST_CLOSE_AUDIT_STORE='rs_post_close_audit_v1';
const NSE_FUNDAMENTAL_STORE='rs_nse_fundamentals_v1';
const RECOMMEND_MIN_PROGRESS_FRACTION=0.25;
const LEFT_ON_TABLE_STORE='rs_left_on_table_v1';
const LEFT_ON_TABLE_KEEP_SESSIONS=30;   // how much history is retained
const LEFT_ON_TABLE_POOL_SESSIONS=10;   // how much of it the pool actually reads
// v1098: dated official closes, so a multi-session drift can be measured properly. The app has never
// retained any price history — NSE_BHAV is rebuilt from the current zip on every load — which is why
// v1097 had to approximate "the drift into the results" from a 1-week column.
const PRICE_HISTORY_STORE='rs_price_history_v1';
const PRICE_HISTORY_KEEP_SESSIONS=40;
const PRE_RESULTS_DRIFT_SESSIONS=3;     // the owner's 2-3 day window, measured to the last close before today
const ENTRY_OUTCOME_STORE='rs_entry_outcomes_delta_v1';
const OUTCOME_HORIZON_FALLBACK_DAYS=5;
const OUTCOME_HORIZON_MAX_DAYS=20;
const OUTCOME_FEEDBACK_MIN_SAMPLES=6;
const OUTCOME_SCORE_ADJ_MAX=8;
const OUTCOME_FEATURE_SIGNATURE_MAX=24;
const NSE_HOLIDAYS_STORE='rs_nse_holidays';
// Keep rocket_brain.json for learned state only. Input-file derivatives are rebuilt
// from Google Drive canonical files; legacy non-stock keys are purged completely.
const SOURCE_DERIVED_BRAIN_KEYS=new Set([
  HOLD_STORE,
  POS_STORE,
  ORDERS_STORE,
  TRADEBOOK_STORE,
]);
const DEPRECATED_BRAIN_KEYS=new Set([
  'rs_position_tsl',   // v1116: the trailing stop was removed - it was never executable
  'rs_corr_bull',
  'rs_corr_bear',
  'rs_corr_neutral',
  'rs_regime_cal',
  'rs_rocket_lab_v1',
  'rs_intraday_ledger_v1',
  'rs_intraday_mrmr_v1',
  'rs_snapshot',
  'rs_snapshot_prev',
  'rs_feature_accountability_v1',
  'rs_missed_opp_v2',
  'rs_post_sale_rockets_v1',
  'rs_avg_day_chg',
  'rs_avg_move_all_v1',
  'rs_avg_move_universe_v1',
  'rs_auto_strategies_v1',
  // v517: the five-session learning engine, strategy ladder/championship and
  // outcome-episode scoreboard were retired with the Radar composite core.
  'rs_corr',
  'rs_snapshot_mrmr_v1',
  'rs_meth',
  'rs_rec_count',
  'rs_pick_champion_v1',
  'rs_pick_disabled_v1',
  'rs_outcome_episode_ledger_v1',
]);
function shouldDropBrainKey(key){
  const k=String(key||'').toLowerCase();
  if(!k) return false;
  const legacyNonStockSuffix='_'+'cr'+'yp'+'to';
  if(k.includes(legacyNonStockSuffix)) return true;
  if(DEPRECATED_BRAIN_KEYS.has(k)) return true;
  return SOURCE_DERIVED_BRAIN_KEYS.has(key);
}
function compactOutcomeFeatures(features,featureOrder=null,limit=OUTCOME_FEATURE_SIGNATURE_MAX){
  if(!features||typeof features!=='object') return {};
  const seen=new Set();
  const source=Array.isArray(featureOrder)&&featureOrder.length?featureOrder:Object.keys(features);
  const keys=[];
  source.forEach(f=>{
    if(!f||seen.has(f)||keys.length>=limit) return;
    seen.add(f);
    const value=Number(features[f]);
    if(isFinite(value)) keys.push(f);
  });
  const out={};
  keys.forEach(f=>{out[f]=+Number(features[f]).toFixed(4);});
  return out;
}
function getOutcomeFeatureOrderFromWeights(weights,features){
  const w=weights||{};
  const source=Array.isArray(features)&&features.length?features:Object.keys(w);
  return [...source]
    .filter(f=>f&&(w[f]||0)>0)
    .sort((a,b)=>(w[b]||0)-(w[a]||0))
    .slice(0,OUTCOME_FEATURE_SIGNATURE_MAX);
}
function getOutcomeFeatureOrderFromEngine(){
  return getOutcomeFeatureOrderFromWeights(ENGINE_DATA?.weights,ENGINE_DATA?.features);
}
function getOutcomeFeatureOrderFromBrain(brain){
  // rs_meth (engine feature weights) is deprecated; stored outcome signatures keep
  // their own key order via the compactOutcomeFeatures fallback.
  return [];
}
function migrateOutcomeFeatureStore(store,featureOrder){
  if(!store||typeof store!=='object') return false;
  let changed=false;
  const apply=obj=>{
    if(!obj?.features) return;
    const before=Object.keys(obj.features||{}).length;
    const next=compactOutcomeFeatures(obj.features,featureOrder);
    const after=Object.keys(next).length;
    if(after!==before||Object.keys(next).some(k=>next[k]!==obj.features[k])){
      obj.features=next;
      changed=true;
    }
  };
  Object.values(store.issues||{}).forEach(issue=>(issue.picks||[]).forEach(apply));
  Object.values(store.cohorts||{}).forEach(cohort=>Object.values(cohort.candidates||{}).forEach(apply));
  Object.values(store.entries||{}).forEach(apply);
  if(changed) store.compactFeatureSchema='top_weighted_v1';
  return changed;
}
function compactOutcomeStoresInBrain(brain){
  if(!brain||typeof brain!=='object') return brain;
  const order=getOutcomeFeatureOrderFromBrain(brain);
  migrateOutcomeFeatureStore(brain[RECOMMEND_OUTCOME_STORE],order);
  migrateOutcomeFeatureStore(brain[ENTRY_OUTCOME_STORE],order);
  return brain;
}
function pruneBrainForStorage(brain){
  const src=(brain&&typeof brain==='object')?brain:{};
  const out={};
  Object.entries(src).forEach(([key,value])=>{
    if(shouldDropBrainKey(key)) return;
    out[key]=value;
  });
  return compactOutcomeStoresInBrain(out);
}
function mergeCumulativeBrain(first,second){
  const base=(first&&typeof first==='object')?first:{};
  const incoming=(second&&typeof second==='object')?second:{};
  const merged={...base,...incoming};
  const a=base[TRADE_TIMING_CONTEXT_STORE],b=incoming[TRADE_TIMING_CONTEXT_STORE];
  if(a?.entries||b?.entries){
    const entries={...(a?.entries||{}),...(b?.entries||{})};
    const keys=Object.keys(entries).sort((x,y)=>String(entries[x]?.orderTime||x).localeCompare(String(entries[y]?.orderTime||y)));
    while(keys.length>500) delete entries[keys.shift()];
    merged[TRADE_TIMING_CONTEXT_STORE]={
      version:1,entries,
      updatedAt:[a?.updatedAt,b?.updatedAt].filter(Boolean).sort().at(-1)||new Date().toISOString()
    };
  }
  return merged;
}
let TRADEBOOK_STATS=null; // Includes the realised exit-policy baseline, later refined by outcome learning.
let LAST_BUY_DATE_MAP={}; // Legacy latest-buy map retained for stored-brain compatibility.
let ORDERS_TODAY=null; // [{symbol,type,qty,price,time,product,status,totalQty,pending}] — `qty` is the
                       // FILLED quantity (every consumer sums it); `pending` is the unfilled half of an
                       // order still working in the market (v1207).
let TRADEBOOK_BUY_FILLS=[]; // Consolidated BUY fills available for executed-entry feedback matching.

const FS = (() => {
  const BRAIN_FILE = 'rocket_brain.json';
  const CLIENT_ID_STORE = 'rs_google_client_id';
  const PROVIDER_STORE = 'rs_cloud_provider';
  const SESSION_STORE = 'rs_drive_access_v1';
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
  const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const LOCAL_DB = 'rocket_scanner_local_brain_v1';
  const LOCAL_STORE = 'brain';
  const LOCAL_KEY = 'rocket_brain';
  const LOCAL_HANDLE_KEY = 'rocket_brain_dir_handle';
  let _saveTimer = null;
  let _brain = {};
  let _brainLoaded = false;
  let _accessToken = null;
  let _expiresAt = 0;
  let _tokenClient = null;
  let _gisLoadPromise = null;
  let _fileCache = null;
  let _localDirHandle = null;

  function clientId(){ return (GOOGLE_DRIVE_CLIENT_ID||localStorage.getItem(CLIENT_ID_STORE)||'').trim(); }
  function setClientId(id){
    const cleaned=String(id||'').trim();
    if(cleaned) localStorage.setItem(CLIENT_ID_STORE,cleaned);
    else localStorage.removeItem(CLIENT_ID_STORE);
    _tokenClient=null;
  }
  function isConfigured(){ return !!clientId(); }
  function isConnected(){ return !!_accessToken&&Date.now()<_expiresAt-30000; }
  function clearSession(){
    _accessToken=null;_expiresAt=0;
    _fileCache=null;
    try{sessionStorage.removeItem(SESSION_STORE);}catch(e){}
    updateFolderUI();
  }
  function restoreSession(){
    try{
      const state=JSON.parse(sessionStorage.getItem(SESSION_STORE)||'null');
      if(state?.token&&state?.expiresAt>Date.now()+30000){
        _accessToken=state.token;_expiresAt=state.expiresAt;
      }
    }catch(e){}
  }
  async function waitForGIS(){
    for(let i=0;i<60;i++){
      if(window.google?.accounts?.oauth2) return true;
      await new Promise(r=>setTimeout(r,50));
    }
    if(_gisLoadPromise) return await _gisLoadPromise;
    _gisLoadPromise=new Promise(resolve=>{
      const prior=document.getElementById('googleGisScript')||document.querySelector('script[src^="https://accounts.google.com/gsi/client"]');
      if(prior) prior.remove();
      const script=document.createElement('script');
      script.id='googleGisScript';script.src='https://accounts.google.com/gsi/client';script.async=true;
      let settled=false;
      const finish=ok=>{if(settled)return;settled=true;clearTimeout(timer);resolve(!!ok);};
      script.addEventListener('load',()=>finish(!!window.google?.accounts?.oauth2),{once:true});
      script.addEventListener('error',()=>finish(false),{once:true});
      const timer=setTimeout(()=>finish(!!window.google?.accounts?.oauth2),12000);
      document.head.appendChild(script);
    });
    const loaded=await _gisLoadPromise;
    if(!loaded)_gisLoadPromise=null;
    return loaded;
  }

  async function init(){
    restoreSession();
    await restoreLocalDirectoryHandle();
    updateFolderUI();
    const localBrain=await readLocalBrain();
    if(!isConnected()&&localStorage.getItem(PROVIDER_STORE)==='drive'){
      try{
        const restored=await connect({silent:true});
        if(restored?.ok){
          updateFolderUI();
          return mergeCumulativeBrain(localBrain,restored.brain);
        }
      }catch(e){console.warn('Silent Drive reconnect failed',e);}
    }
    if(!isConnected()) return localBrain;
    try{
      const brain=await read();
      return mergeCumulativeBrain(localBrain,brain);
    }catch(e){console.warn('Drive startup read failed',e);return localBrain;}
  }

  async function connect(opts={}){
    const silent=!!opts.silent;
    if(!isConfigured()) return {ok:false,reason:'missing_client_id'};
    if(!(await waitForGIS())) return {ok:false,reason:'google_library'};
    return new Promise(resolve=>{
      _tokenClient=google.accounts.oauth2.initTokenClient({
        client_id:clientId(),
        scope:SCOPE,
        callback:async response=>{
          if(response?.error||!response?.access_token){
            resolve({ok:false,reason:response?.error||'authorization_failed'});return;
          }
          _accessToken=response.access_token;
          _expiresAt=Date.now()+((parseInt(response.expires_in,10)||3600)*1000);
          localStorage.setItem(PROVIDER_STORE,'drive');
          try{sessionStorage.setItem(SESSION_STORE,JSON.stringify({token:_accessToken,expiresAt:_expiresAt}));}catch(e){}
          updateFolderUI();
          _fileCache=null;
          try{await listAppDataFiles(true);}catch(e){console.warn('Drive file index refresh failed after connect',e);}
          let brain=null;
          try{brain=await read();}catch(e){console.warn('Drive brain read failed after connect',e);}
          resolve({ok:true,brain});
        },
        error_callback:()=>resolve({ok:false,reason:'popup_failed'})
      });
      _tokenClient.requestAccessToken({prompt:silent?'':''});
    });
  }

  function needsReconnect(){
    return localStorage.getItem(PROVIDER_STORE)==='drive'&&!isConnected();
  }

  async function request(url,options={}){
    if(!isConnected()) throw new Error('Google Drive is not connected. Click Connect Drive again.');
    const headers=new Headers(options.headers||{});
    headers.set('Authorization','Bearer '+_accessToken);
    const response=await fetch(url,{...options,headers});
    if(response.status===401){
      clearSession();
      throw new Error('Google Drive authorization expired. Click Connect Drive again.');
    }
    if(!response.ok) throw new Error('Google Drive request failed ('+response.status+').');
    return response;
  }
  function queryName(name){ return String(name).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
  async function listAppDataFiles(force=false){
    if(_fileCache&&!force) return _fileCache;
    const files=[];
    let pageToken='';
    do{
      const url=DRIVE_API+'?spaces=appDataFolder&pageSize=100&fields=nextPageToken,files(id,name,modifiedTime,mimeType,size)&q='+encodeURIComponent('trashed=false')+(pageToken?'&pageToken='+encodeURIComponent(pageToken):'');
      const data=await (await request(url)).json();
      (data.files||[]).forEach(f=>files.push(f));
      pageToken=data.nextPageToken||'';
    }while(pageToken);
    _fileCache=new Map();
    files.forEach(f=>{
      const existing=_fileCache.get(f.name);
      if(!existing||String(f.modifiedTime||'')>String(existing.modifiedTime||'')) _fileCache.set(f.name,f);
    });
    return _fileCache;
  }
  async function findFile(name){
    const cache=await listAppDataFiles();
    if(cache.has(name)) return cache.get(name);
    // Canonical reads should also find files saved with minor name variations
    // such as ALL_NSE.csv, ALL-NSE.csv or browser '(1)' suffixes.
    const targetCanonical=canonicalInputName(name);
    if(targetCanonical===name){
      let best=null;
      for(const meta of cache.values()){
        if(canonicalInputName(meta.name)!==name) continue;
        if(!best||String(meta.modifiedTime||'')>String(best.modifiedTime||'')) best=meta;
      }
      if(best){
        cache.set(name,best);
        return best;
      }
    }
    const q=`name='${queryName(name)}' and trashed=false`;
    const url=DRIVE_API+'?spaces=appDataFolder&pageSize=1&fields=files(id,name,modifiedTime,mimeType)&q='+encodeURIComponent(q);
    const data=await (await request(url)).json();
    const file=data.files?.[0]||null;
    if(file) cache.set(name,file);
    return file;
  }
  async function readBlob(name){
    const meta=await findFile(name);
    if(!meta) return null;
    const response=await request(DRIVE_API+'/'+encodeURIComponent(meta.id)+'?alt=media');
    return {blob:await response.blob(),meta};
  }
  async function read(){
    const hit=await readBlob(BRAIN_FILE);
    if(!hit) return null;
    try{
      return JSON.parse(await hit.blob.text());
    }
    catch(e){console.warn('FS.read invalid cloud brain',e);return null;}
  }
  async function readJsonFile(name){
    if(!isConnected()||!name) return null;
    const hit=await readBlob(name);
    if(!hit) return null;
    try{return {data:JSON.parse(await hit.blob.text()),meta:hit.meta};}
    catch(e){console.warn('FS.readJsonFile invalid JSON',name,e);return null;}
  }
  async function writeJsonFile(name,data){
    if(!isConnected()||!name) return false;
    return await uploadFile(name,JSON.stringify(data),'application/json');
  }

  async function readUploadText(fileName){
    if(!isConnected()||!fileName) return null;
    const hit=await readBlob(fileName);
    if(!hit) return null;
    return {text:await hit.blob.text(),lastModified:Date.parse(hit.meta.modifiedTime)||0,path:'Google Drive/'+fileName};
  }

  async function readUploadFile(fileName){
    if(!isConnected()||!fileName) return null;
    const hit=await readBlob(fileName);
    if(!hit) return null;
    const lastModified=Date.parse(hit.meta.modifiedTime)||Date.now();
    const file=new File([hit.blob],fileName,{type:hit.blob.type||'application/octet-stream',lastModified});
    return {file,lastModified,path:'Google Drive/'+fileName};
  }

  async function uploadFile(name,content,mimeType='application/octet-stream'){
    const existing=await findFile(name);
    const endpoint=DRIVE_UPLOAD+(existing?'/'+encodeURIComponent(existing.id):'')+'?uploadType=resumable&fields=id,name,modifiedTime';
    const metadata=existing?{name}:{name,parents:['appDataFolder']};
    const begin=await request(endpoint,{
      method:existing?'PATCH':'POST',
      headers:{'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':mimeType},
      body:JSON.stringify(metadata)
    });
    const location=begin.headers.get('Location');
    if(!location) throw new Error('Google Drive did not provide an upload location.');
    const blob=content instanceof Blob?content:new Blob([content],{type:mimeType});
    const done=await request(location,{method:'PUT',headers:{'Content-Type':mimeType},body:blob});
    try{
      const meta=await done.json();
      if(meta?.name&&_fileCache) _fileCache.set(meta.name,meta);
    }catch(e){}
    return true;
  }

  function canonicalInputName(name){
    if(isScannerCsvName(name)) return 'ALL NSE.csv';
    if(isExactCsvName(name,'Holdings.csv')) return 'Holdings.csv';
    if(isExactCsvName(name,'Positions.csv')) return 'Positions.csv';
    if(isExactCsvName(name,'Orders.csv')) return 'Orders.csv';
    if(isExactCsvName(name,'TRADEBOOK.csv')) return 'TRADEBOOK.csv';
    if(isExactCsvName(name,'NSE Holidays.csv')) return 'NSE Holidays.csv';
    if(isReportsZipName(name)) return 'Reports-Daily-Multiple.zip';
    return null;
  }
  async function saveUploadedInputs(files){
    const byName=new Map();
    await listAppDataFiles().catch(()=>null);
    for(const file of files||[]){
      const name=canonicalInputName(file.name);
      if(!name) continue;
      const prior=byName.get(name);
      if(!prior||((file.lastModified||0)>(prior.lastModified||0))) byName.set(name,file);
    }
    const jobs=[];
    byName.forEach((file,name)=>{
      jobs.push(uploadFile(name,file,file.type||(/\.zip$/i.test(name)?'application/zip':'text/csv')).then(()=>1));
    });
    if(!jobs.length) return 0;
    const counts=await Promise.all(jobs);
    return counts.reduce((s,v)=>s+v,0);
  }

  async function write(data){
    if(_saveTimer){clearTimeout(_saveTimer);_saveTimer=null;}
    const cleaned=pruneBrainForStorage(data);
    if(data===_brain) _brain=cleaned;
    const localOk=await writeLocalBrain(cleaned);
    if(!isConnected()) return localOk;
    try{return await uploadFile(BRAIN_FILE,JSON.stringify(cleaned),'application/json');}
    catch(e){console.warn('FS.write failed',e);return false;}
  }

  function openLocalDb(){
    return new Promise((resolve,reject)=>{
      if(!window.indexedDB){resolve(null);return;}
      const req=indexedDB.open(LOCAL_DB,1);
      req.onupgradeneeded=()=>{req.result.createObjectStore(LOCAL_STORE,{keyPath:'key'});};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }

  async function writeIndexedBrain(data){
    if(!data||typeof data!=='object') return false;
    const db=await openLocalDb();
    if(!db) return false;
    return new Promise(resolve=>{
      const tx=db.transaction(LOCAL_STORE,'readwrite');
      tx.objectStore(LOCAL_STORE).put({key:LOCAL_KEY,data,ts:Date.now()});
      tx.oncomplete=()=>{db.close();resolve(true);};
      tx.onerror=()=>{console.warn('IndexedDB brain mirror failed',tx.error);db.close();resolve(false);};
    });
  }

  async function putLocalStore(key, value){
    const db=await openLocalDb();
    if(!db) return false;
    return new Promise(resolve=>{
      const tx=db.transaction(LOCAL_STORE,'readwrite');
      tx.objectStore(LOCAL_STORE).put({key,value,ts:Date.now()});
      tx.oncomplete=()=>{db.close();resolve(true);};
      tx.onerror=()=>{console.warn('Local store write failed',tx.error);db.close();resolve(false);};
    });
  }

  async function getLocalStore(key){
    const db=await openLocalDb();
    if(!db) return null;
    return new Promise(resolve=>{
      const tx=db.transaction(LOCAL_STORE,'readonly');
      const req=tx.objectStore(LOCAL_STORE).get(key);
      req.onsuccess=()=>resolve(req.result?.value??null);
      req.onerror=()=>{console.warn('Local store read failed',req.error);resolve(null);};
      tx.oncomplete=()=>db.close();
      tx.onerror=()=>db.close();
    });
  }

  async function readIndexedBrain(){
    const db=await openLocalDb();
    if(!db) return null;
    return new Promise(resolve=>{
      const tx=db.transaction(LOCAL_STORE,'readonly');
      const req=tx.objectStore(LOCAL_STORE).get(LOCAL_KEY);
      req.onsuccess=()=>resolve(req.result?.data||null);
      req.onerror=()=>{console.warn('IndexedDB brain read failed',req.error);resolve(null);};
      tx.oncomplete=()=>db.close();
      tx.onerror=()=>db.close();
    });
  }

  async function deleteIndexedBrain(){
    const db=await openLocalDb();
    if(!db) return false;
    return new Promise(resolve=>{
      const tx=db.transaction(LOCAL_STORE,'readwrite');
      tx.objectStore(LOCAL_STORE).delete(LOCAL_KEY);
      tx.oncomplete=()=>{db.close();resolve(true);};
      tx.onerror=()=>{console.warn('IndexedDB brain delete failed',tx.error);db.close();resolve(false);};
    });
  }

  async function writeLocalBrain(data){
    const fileOk=await writeLocalBrainFile(data);
    const indexedOk=await writeIndexedBrain(data).catch(e=>{console.warn('IndexedDB brain mirror failed',e);return false;});
    return fileOk||indexedOk;
  }

  async function readLocalBrain(){
    const brain=await readIndexedBrain().catch(e=>{console.warn('Local brain read failed',e);return null;});
    if(brain&&typeof brain==='object') return brain;
    return null;
  }

  async function setLocalDirectoryHandle(handle){
    _localDirHandle=handle||null;
    if(!_localDirHandle) return false;
    try{
      const ok=await requestLocalPermission(_localDirHandle);
      if(!ok){_localDirHandle=null;return false;}
      await putLocalStore(LOCAL_HANDLE_KEY,_localDirHandle).catch(e=>console.warn('Could not persist local folder handle',e));
      updateFolderUI();
      return true;
    }catch(e){console.warn('Local folder permission failed',e);_localDirHandle=null;return false;}
  }

  async function restoreLocalDirectoryHandle(){
    try{
      const handle=await getLocalStore(LOCAL_HANDLE_KEY);
      if(!handle) return false;
      _localDirHandle=handle;
      const granted=!_localDirHandle.queryPermission||await _localDirHandle.queryPermission({mode:'read'})==='granted';
      if(granted){
        updateFolderUI();
        return true;
      }
      _localDirHandle=null;
      return false;
    }catch(e){console.warn('Local folder restore failed',e);_localDirHandle=null;return false;}
  }

  async function requestLocalPermission(handle){
    if(!handle?.queryPermission||!handle?.requestPermission) return true;
    const writeOpts={mode:'readwrite'};
    if(await handle.queryPermission(writeOpts)==='granted') return 'readwrite';
    if(await handle.requestPermission(writeOpts)==='granted') return 'readwrite';
    const readOpts={mode:'read'};
    if(await handle.queryPermission(readOpts)==='granted') return 'read';
    return await handle.requestPermission(readOpts)==='granted'?'read':false;
  }

  async function getStoredUploadDirHandle(){
    try{
      const handle=await getLocalStore(LOCAL_HANDLE_KEY);
      if(!handle) return null;
      const ok=await requestLocalPermission(handle);
      if(!ok) return null;
      _localDirHandle=handle;
      updateFolderUI();
      return handle;
    }catch(e){
      console.warn('Stored upload folder unavailable',e);
      return null;
    }
  }

  async function writeLocalBrainFile(data){
    if(!_localDirHandle||!data||typeof data!=='object') return false;
    try{
      if(_localDirHandle.queryPermission&&await _localDirHandle.queryPermission({mode:'readwrite'})!=='granted') return false;
      const fileHandle=await _localDirHandle.getFileHandle(BRAIN_FILE,{create:true});
      const writable=await fileHandle.createWritable();
      await writable.write(JSON.stringify(data));
      await writable.close();
      return true;
    }catch(e){console.warn('Local rocket_brain.json write failed',e);return false;}
  }

  async function deleteLocalBrainFile(){
    if(!_localDirHandle) return;
    try{
      if(_localDirHandle.queryPermission&&await _localDirHandle.queryPermission({mode:'readwrite'})!=='granted') return;
      await _localDirHandle.removeEntry(BRAIN_FILE).catch(()=>null);
    }catch(e){console.warn('Local rocket_brain.json delete failed',e);}
  }

  async function deleteFile(){
    if(!isConnected()) return;
    try{
      const file=await findFile(BRAIN_FILE);
      if(file) await request(DRIVE_API+'/'+encodeURIComponent(file.id),{method:'DELETE'});
    }catch(e){console.warn('FS.deleteFile failed',e);}
  }

  function brainValueChanged(key,value){
    const old=_brain[key];
    if(old===value) return false;
    try{return JSON.stringify(old)!==JSON.stringify(value);}catch(e){return true;}
  }

  // Set one key and schedule a debounced background write. Trading render never waits for this.
  function set(key,value){
    if(shouldDropBrainKey(key)){delete _brain[key];return;}
    if(!brainValueChanged(key,value)) return;
    _brain[key]=value;
    if(_saveTimer) clearTimeout(_saveTimer);
    _saveTimer=setTimeout(()=>write(_brain),1600);
  }

  // Set multiple keys in one write cycle (avoids repeated full-brain writes)
  function setMultiple(updates){
    let changed=false, dropped=false;
    Object.entries(updates||{}).forEach(([key,value])=>{
      if(shouldDropBrainKey(key)){if(_brain[key]!==undefined){delete _brain[key];dropped=true;}return;}
      if(!brainValueChanged(key,value)) return;
      _brain[key]=value;
      changed=true;
    });
    if(changed||dropped){
      if(_saveTimer) clearTimeout(_saveTimer);
      _saveTimer=setTimeout(()=>write(_brain),1600);
    }
  }

  function get(key){ return _brain[key]??null; }
  function load(brain){
    const raw=(brain&&typeof brain==='object')?brain:{};
    const hadDropped=Object.keys(raw).some(shouldDropBrainKey);
    const cumulative=mergeCumulativeBrain(_brain,raw);
    _brain=pruneBrainForStorage(cumulative);
    _brainLoaded=true;
    writeLocalBrain(_brain).catch(e=>console.warn('Local brain mirror failed after load',e));
    // Seamless one-time migration: old/full brains still load, then the next cloud copy is pruned automatically.
    if(hadDropped&&isConnected()) write(_brain).catch(e=>console.warn('Cloud brain migration save failed',e));
  }
  async function loadFromDisk(){
    if(!isConnected()) return null;
    const brain=await read();
    load(brain||{});
    return brain;
  }
  async function refreshCloudIndex(){
    if(!isConnected()) return null;
    _fileCache=null;
    return await listAppDataFiles(true);
  }
  async function verifyConnection(){
    if(!isConnected()) return false;
    try{
      await listAppDataFiles(true);
      return true;
    }catch(e){
      console.warn('Drive connection check failed',e);
      return false;
    }
  }
  async function ensureLoaded(){
    if(!_brainLoaded&&isConnected()) await loadFromDisk();
    return _brain;
  }
  function getBrain(){ return _brain; }
  function reset(preserved={}){
    _brain=pruneBrainForStorage(preserved||{});
    _brainLoaded=true;
    if(_saveTimer) clearTimeout(_saveTimer);
    if(Object.keys(_brain).length) write(_brain);
    else { deleteLocalBrainFile(); deleteIndexedBrain(); deleteFile(); }
  }
  function folderName(){ return isConnected()?'Google Drive':(_localDirHandle?'Local folder':null); }
  function hasFolder(){ return isConnected(); }
  function hasLocalBrainFolder(){ return !!_localDirHandle; }
  function getActiveLocalDirectoryHandle(){ return _localDirHandle; }

  return {init,connect,needsReconnect,isConfigured,setClientId,isConnected,read,readJsonFile,writeJsonFile,readUploadText,readUploadFile,saveUploadedInputs,write,set,setMultiple,get,load,loadFromDisk,ensureLoaded,refreshCloudIndex,verifyConnection,getBrain,reset,folderName,hasFolder,setLocalDirectoryHandle,getStoredUploadDirHandle,hasLocalBrainFolder,getActiveLocalDirectoryHandle};
})();

function updateFolderUI(){
  const loadBtn=document.getElementById('loadFilesBtn');
  if(loadBtn){
    const driveConnected=FS.isConnected();
    loadBtn.disabled=!driveConnected;
    loadBtn.textContent='Load Files';
    loadBtn.title=driveConnected
      ? 'Select the Rocket Scanner folder or Scanner Uploads folder.'
      : 'Reconnect Google Drive before loading files.';
    loadBtn.style.borderColor=driveConnected?'':'';
    loadBtn.style.color=driveConnected?'':'';
  }
  const driveBtn=document.getElementById('driveBtn');
  if(!driveBtn) return;
  if(FS.isConnected()){
    driveBtn.textContent='Drive Connected';
    driveBtn.title='Google Drive is connected. Click to refresh or reconnect cloud brain.';
    driveBtn.style.borderColor='rgba(34,197,94,.45)';
    driveBtn.style.color='var(--green)';
  }else if(FS.needsReconnect()){
    driveBtn.textContent='Reconnect Drive';
    driveBtn.title='Google Drive authorization expired. Click to reconnect and load cloud brain.';
    driveBtn.style.borderColor='rgba(251,191,36,.5)';
    driveBtn.style.color='var(--amber)';
  }else{
    driveBtn.textContent='Connect Drive';
    driveBtn.title='Connect Google Drive to load and save the private scanner brain.';
    driveBtn.style.borderColor='';
    driveBtn.style.color='';
  }
}
setInterval(()=>{try{updateFolderUI();}catch(e){}},30000);

let _driveSilentReconnect=null;
async function maintainDriveSession(){
  if(_driveSilentReconnect||!FS.needsReconnect()) return false;
  _driveSilentReconnect=FS.connect({silent:true})
    .then(result=>{
      if(result?.ok){
        if(result.brain) FS.load(result.brain);
        updateFolderUI();
        return true;
      }
      return false;
    })
    .catch(e=>{console.warn('Silent Drive session refresh failed',e);return false;})
    .finally(()=>{_driveSilentReconnect=null;});
  return await _driveSilentReconnect;
}
setInterval(()=>{maintainDriveSession().catch(()=>null);},60000);

function showDriveAuthRequiredState(){
  const msg=FS.needsReconnect()
    ? 'Google Drive needs authorization. Press Drive to reconnect and load latest saved data.'
    : 'Press Drive to connect Google Drive and load latest saved data.';
  try{
    const bar=document.getElementById('infoBar');
    if(bar) bar.innerHTML=`<span class="info-pill pill-amber" title="${escHtml(msg)}">⚠ ${escHtml(msg)}</span>`;
    document.getElementById('hdrR').style.display='flex';
    document.getElementById('dash').style.display='block';
    document.getElementById('noDataBanner').style.display='flex';
    const nd=document.querySelector('#noDataBanner div:nth-child(2)');
    if(nd) nd.innerHTML=`Cloud data is private. Press <strong style="color:var(--fire)">Drive</strong> to reconnect and restore the latest saved dashboard.`;
  }catch(e){}
}

function idleTask(fn,timeout=1200){
  const run=()=>{try{fn();}catch(e){console.warn('Background task failed',e);}};
  if('requestIdleCallback' in window) requestIdleCallback(run,{timeout});
  else setTimeout(run,60);
}
// Drive copies of the canonical inputs are what hydrate a second device, so this stays —
// but only for files that actually CHANGED. Before v533 every processFiles() call, including
// each 15-second auto-refresh tick, re-uploaded all seven inputs (multi-MB CSV + ZIP) and
// toasted about it; the encode/upload work landed inside the scoring window and competed
// with the render. Now unchanged files are skipped, the work is deferred further, and a
// silent auto-refresh never toasts.
const _driveInputSigs=new Map(); // lowercased file name -> "size:lastModified"
const driveInputKey=f=>String(f?.name||'').toLowerCase();
const driveInputSig=f=>`${f?.size}:${f?.lastModified}`;
const driveInputNeedsPush=f=>_driveInputSigs.get(driveInputKey(f))!==driveInputSig(f);
const markDriveInputPushed=f=>_driveInputSigs.set(driveInputKey(f),driveInputSig(f));
function saveInputsInBackground(files,{silent=false}={}){
  if(!files?.length||!FS.hasFolder()) return;
  const pending=files.filter(driveInputNeedsPush);
  if(!pending.length) return; // nothing changed since the last push — no upload, no toast
  idleTask(()=>{
    FS.saveUploadedInputs(pending)
      .then(n=>{
        pending.forEach(markDriveInputPushed);
        if(n&&!silent) showToast(`Saved ${n} input file${n!==1?'s':''} to Drive in background.`,2500);
      })
      .catch(e=>showToast('Background Drive input save failed: '+(e.message||e),5000,true));
  },6000);
}
function saveBrainInBackground(label='Brain saved'){
  idleTask(()=>{
    FS.write(FS.getBrain())
      .then(ok=>{if(!ok) showToast('Background brain save failed. Reconnect Drive and load again.',5000,true);})
      .catch(e=>showToast('Background brain save failed: '+(e.message||e),5000,true));
  },1800);
}
function renderTradingDashboardNow(){
  try{
    document.getElementById('hdrR').style.display='flex';
    document.getElementById('dash').style.display='block';
    document.getElementById('noDataBanner').style.display=ALL.length?'none':'flex';
  }catch(e){}
  try{renderMethodology();}catch(e){console.warn('Methodology render failed',e);}
  // applyFilters renders the Rankings panels; without scanner rows it never runs, so the
  // portfolio-only tables are rendered directly in that case.
  try{if(ALL.length) applyFilters(); else renderRankingsPanels();}catch(e){console.warn('Fast ranking render failed',e);}
  try{ const _bf=backfillPickUpStreak(); if(_bf) console.log('upStreak backfilled onto '+_bf+' picks'); }catch(e){}
  schedulePerformanceRender();
}

async function ensureDriveReadyForLoad(){
  updateFolderUI();
  if(!FS.hasFolder()){
    showDriveAuthRequiredState();
    showToast('Connect Google Drive first, then press Load Files.',4000,true);
    return false;
  }
  const ok=await FS.verifyConnection();
  updateFolderUI();
  if(ok) return true;
  showDriveAuthRequiredState();
  showToast('Google Drive is disconnected. Press Drive to reconnect before loading files.',5000,true);
  return false;
}

async function connectCloudStorage(opts={}){
  const reloadAfterConnect=false;
  if(!FS.isConfigured()){
    const id=window.prompt('Paste your Google OAuth Web Client ID. This is a public app identifier, not a password or secret.');
    if(!id) return false;
    if(!/\.apps\.googleusercontent\.com$/.test(id.trim())){
      showToast('That does not look like a Google OAuth Web Client ID.',5000,true);
      return false;
    }
    FS.setClientId(id);
  }
  setLoading(true,FS.needsReconnect()?'Reconnecting Google Drive...':'Connecting Google Drive...');
  const result=await FS.connect();
  if(!result.ok){
    setLoading(false);
    const reason=result.reason==='google_library'?'Google authorization library is blocked or unavailable after retry. Check the connection or browser privacy blocking, then reconnect Drive.':result.reason==='popup_failed'?'Google authorization popup was closed or blocked.':'Google Drive connection failed: '+result.reason;
    showToast(reason,5000,true);
    return false;
  }
  setMsg('Loading latest cloud brain...');
  if(result.brain) FS.load(result.brain);
  else {
    try{await FS.loadFromDisk();}catch(e){console.warn('Drive brain reload failed after connect',e);}
  }
  setMsg('Loading latest Drive inputs...');
  try{
    await FS.refreshCloudIndex?.();
    const hydratedCount=await hydrateSessionCSVsFromPreferredInputs('Drive reconnect');
    try{enrichRowsWithNSEData(ALL);}catch(e){console.warn('Drive reconnect NSE enrichment failed',e);}
    if(hydratedCount||Object.keys(FS.getBrain()||{}).length) saveBrainInBackground('Cloud brain saved');
  }catch(e){console.warn('Drive input hydration failed after connect',e);}
  updateFolderUI();
  renderTradingDashboardNow();
  setLoading(false);
  showToast('<strong>Google Drive connected.</strong> Latest data loaded without page reload.',3500);
  return true;
}

// ── One-time key migration: move old versioned keys → clean names ──
// Deletes old key FIRST to free space, then writes new. Safe to run repeatedly.
(function migrateKeys(){
  const OLD_TO_NEW={
    'rscanner_v4_filters':SCANNER_STORE,'rscanner_v5_filters':SCANNER_STORE,
    'rscanner_v4_data':ALL_STORE,'rscanner_v5_data':ALL_STORE,
    'rscanner_v4_corr':'rs_corr','rscanner_v5_corr':'rs_corr',
    'rscanner_v4_meth':'rs_meth','rscanner_v5_meth':'rs_meth'
  };
  try{
    // First pass: clean up orphans and defunct keys to free space
    ['rscanner_v5_excluded','rscanner_v4_excluded'].forEach(k=>{try{localStorage.removeItem(k);}catch(e){}});
    for(const [oldKey,newKey] of Object.entries(OLD_TO_NEW)){
      if(oldKey===newKey) continue;
      if(localStorage.getItem(newKey)){
        // New key already exists — just delete old duplicate
        try{localStorage.removeItem(oldKey);}catch(e){}
        continue;
      }
      const val=localStorage.getItem(oldKey);
      if(val){
        // Delete old first to free space, then write new
        try{localStorage.removeItem(oldKey);}catch(e){}
        try{localStorage.setItem(newKey,val);}catch(e){
          // If write fails, snapshot rebuilds on next upload, others are small
          console.warn('Migration write failed for',newKey,'— will rebuild on next scan');
        }
      }
    }
  }catch(e){console.warn('Key migration:',e);}
})();
let NSE_BHAV={},NSE_52W={},NSE_SURV={},NSE_BULK={},NSE_BLOCK={},NSE_PRICE_BAND={};
let NSE_VAR={}; // {symbol -> {securityVarPct,elmPct,additionalMarginPct,totalMarginPct}} from the EOD _6 DAT only
let NSE_NEXT_BAND={}; // {symbol -> {fromPct,toPct,reportDate}} effective for the next trading session
let NSE_SECURITY_MASTER={}; // {symbol -> exchange identity/eligibility metadata} from NSE-listed CM MII .csv.gz
let NSE_FUNDAMENTALS={}; // {symbol -> [{source,subject,title,description,pubDate,link,...}]} from official NSE RSS indexes
let NSE_FUNDAMENTAL_META=null; // fetch/snapshot and XBRL extraction status for causal result triggers
let NSE_STATUS={}; // {symbol -> exchange status letter from REG1 (A = active)}
let NSE_SERIES={}; // {symbol -> exchange series letters from REG1 (EQ, BE, BZ, SM, ST, SZ)}
let NSE_DEAL_NET={}; // {symbol -> signed net deal quantity (BUY − SELL) across bulk + block files}
let NSE_CORP_ACTION={}; // {symbol -> [{exDate:'YYYY-MM-DD', purpose, kind:'structural'|'dividend'|'buyback', divAmt}]} from PR-zip bc file (v552)
let NSE_BOARD_MEETING={}; // {symbol -> {date:'YYYY-MM-DD', purpose, isResults}} from PR-zip bm file (v554) — upcoming-event calendar
let NSE_ANNOUNCE={}; // {symbol -> short label} from PR-zip an file (v554) — an announcement was filed this session
let MARKET_INTRADAY=null; // v555 WS-D: {adv,dec,advPct,median} market breadth from change-from-open (entry-timing gauge)
// v1079: the export DATE of each portfolio file, from its own lastModified. Needed because a
// CNC buy reaches holdings on T+1: when holdings.csv is dated LATER than positions.csv, those
// position buys have already settled into holdings and must not be added again.
let PORTFOLIO_FILE_DATES={holdings:null,positions:null,orders:null};
let PORTFOLIO_STALE=null; // v557: {portfolioDate,stale,sessionDate} — Positions/Orders are from a prior session
let NSE_MARKET=null; // v556: official Market Activity Report summary {date,dateISO,niftyPct,advances,declines,tradedValueCr,marketCapCr,indices} — EOD context, display only
// v1076: PR-zip data surveyed in RULES.md Appendix E and previously never parsed.
let NSE_INDEX={};        // {indexName -> {close,prev,pct,high52,low52,rangePos}} from pd IND_SEC='Y' rows; includes India VIX
let NSE_NAME_TO_SYM={};  // {UPPERCASED security NAME -> symbol} from pd - the join key for the name-keyed files
let KITE_TOKEN={};      // v1139: {symbol -> Kite instrument token} from the PUBLIC api.kite.trade dump
let DEPTH_LIVE={};      // symbol -> a directly-observed book, if one is ever supplied; beats the estimate
let NSE_DEPTH={};       // v1137: {symbol -> pre-open order book} from Market Depth.csv (dev/fetch-preopen.js)
let NSE_DEPTH_META=null; // {date, time, rows} - the book is a 09:07 snapshot and says so on screen
let NSE_BAND_HIT={};     // {symbol -> 'H'|'L'} from bh: securities that HIT their price band (the upper-circuit list)
let NSE_NEW_HL_BYNAME={};// {UPPERCASED name -> {status,now,prev}} from hl: NEW 52-week high/low (resolved lazily)
let NSE_INDEX_GROUP_BYNAME={}; // {UPPERCASED name -> 'Nifty 50'|'Nifty Next 50'|'Other'} from gl (resolved lazily)
let NSE_INDEX_GROUP_BYSYM={}; // {symbol -> 'Nifty 50'} straight from pd IND_SEC (symbol-keyed, no name join)
let MARKET_REGIME=null;  // v1076: market regime stamped onto recorded outcomes; NOT a scoring input
let NSE_NON_EQ=new Set(); // symbols in non-EQ series (BE,BZ,SZ,SM,ST) — excluded from display, kept in learning
let NSE_HOLIDAYS=new Set(); // Set of 'YYYY-MM-DD' strings for NSE trading holidays
let SURV_CUSTOM_RULES=[]; // [{key,column,label}] all surveillance rules — user-managed, persisted in brain
let SURV_FILE_RULES=[]; // [{key,column,label,manual:false}] — populated from actual REG1 file in parseSurv; replaces SURV_DEFAULT_RULES
let SURV_MISSING_RULES=new Set(); // keys of custom rules whose column was not found in the last REG1 file — all stocks blocked as precaution
let SURV_HEADERS=[]; // exact REG1 headers loaded this session
let SURV_RULE_HITS={}; // {ruleKey -> flagged symbol count} before hard filters
let SURV_ALL_HITS={}; // {sym -> {colName: true}} — ALL columns flagged, not just active rules
let SURV_CORR_ACC={}; // {colKey -> {col, sessions, winRate, avgPnl, lastCount}} accumulated correlation
let SURV_CORR_LAST_TAG=null; // dedup: prevent multiple accumulations per upload session
let _methTbls={hf:null,sc:null}; // sortable table instances for methodology hard-filters + surv-corr
let HOLDINGS=[]; // active holdings from Holdings.csv (qty>0)
let HOLDINGS_ALL=[]; // all holdings rows from Holdings.csv, including qty=0 closed holdings
let POSITIONS=[]; // parsed positions from Positions.csv

// ── Shared deployed version: identical on every browser/device ──
(function initVersion(){
  const lbl=document.getElementById('verLabel');
  if(lbl) lbl.textContent='v'+APP_VERSION;
  document.title='NSE Rocket Scanner v'+APP_VERSION;
  // Show build/push timestamp
  const _bsEl=document.getElementById('appUpdateVal');
  if(_bsEl) _bsEl.textContent=BUILD_TS?'Last updated: '+BUILD_TS:'';
})();

// ── Go to top button ──
window.addEventListener('scroll',function(){
  const btn=document.getElementById('goTop');
  if(btn) btn.classList.toggle('vis', window.scrollY>400);
},{passive:true});

// ── Generic sortable tables: click any <th> in a .ct table to sort ──
document.addEventListener('click',function(e){
  const th=e.target.closest('.ct th');
  if(!th) return;
  const table=th.closest('table');
  if(!table) return;
  const thead=table.querySelector('thead');
  const tbody=table.querySelector('tbody');
  if(!thead||!tbody) return;
  const ths=[...thead.querySelectorAll('th')];
  const colIdx=ths.indexOf(th);
  if(colIdx<0) return;
  // Toggle direction
  const prevDir=th.dataset.sortDir||'';
  ths.forEach(t=>{t.dataset.sortDir='';t.style.color='';});
  const dir=prevDir==='asc'?'desc':'asc';
  th.dataset.sortDir=dir;
  th.style.color='var(--blue)';
  const rows=[...tbody.querySelectorAll('tr:not([data-total])')];
  const totalRows=[...tbody.querySelectorAll('tr[data-total]')];
  rows.sort((a,b)=>{
    const cellA=(a.cells[colIdx]?.textContent||'').trim();
    const cellB=(b.cells[colIdx]?.textContent||'').trim();
    const numA=parseFloat(cellA.replace(/[₹,%+↑↓]/g,''));
    const numB=parseFloat(cellB.replace(/[₹,%+↑↓]/g,''));
    const aIsNum=isFinite(numA), bIsNum=isFinite(numB);
    // If both are numbers, compare numerically
    if(aIsNum&&bIsNum) return dir==='asc'?(numA-numB):(numB-numA);
    // Push non-numeric (NaN, —, empty) to bottom regardless of direction
    if(aIsNum&&!bIsNum) return -1;
    if(!aIsNum&&bIsNum) return 1;
    // Both non-numeric — compare as text
    const cmp=cellA.localeCompare(cellB);
    return dir==='asc'?cmp:-cmp;
  });
  rows.forEach(r=>tbody.appendChild(r));
  totalRows.forEach(r=>tbody.appendChild(r)); // total always last
});

// ── Toast notifications (replaces alert/confirm) ──
function showToast(msg, duration=4000, isError=false){
  const old=document.getElementById('appToast');if(old)old.remove();
  const t=document.createElement('div');
  t.className='toast'+(isError?' toast-err':'');
  t.id='appToast';
  t.innerHTML=msg;
  document.body.appendChild(t);
  if(duration>0) setTimeout(()=>{const el=document.getElementById('appToast');if(el)el.remove();},duration);
}

// ── One operational trading clock: IST 09:00 rollover, 16:00 live close ──
// The app receipt time owns every session decision. A new model day begins only at
// 09:00 on a valid NSE trading date. Post-market, overnight, weekends and holidays
// remain attached to the last valid model day until that next 09:00 boundary.
const DAY_START_MIN = 9*60;   // 9:00 AM IST = 540
const DAY_END_MIN   = 16*60;  // 4:00 PM IST = 960
const DAY_LENGTH_MIN= DAY_END_MIN - DAY_START_MIN; // 420

// CONTINUOUS TRADING does not end at the same minute for every stock any more. SEBI's Closing
// Auction Session went live 2026-08-03: a stock with F&O contracts stops trading continuously at
// 15:15 and its close is set by an auction that prints no 5-minute candle. Everything else still
// trades to 15:30. These are exchange facts, not tunables - the same category as Zerodha's
// 20-order cap. Which of the two applies to a given stock is DERIVED from its own bar file, never
// from a list (see buildIntradayTrajectory); no input carries F&O membership.
const SESSION_CLOSE_MIN      = 15*60+30;  // 15:30 - continuous close outside the F&O segment
const CAS_CONTINUOUS_END_MIN = 15*60+15;  // 15:15 - earliest close the auction regime can produce

function istClock(timestamp=Date.now()){
  const ts=Number(timestamp)||Date.now();
  const shifted=new Date(ts+5.5*60*60*1000);
  const h=shifted.getUTCHours(),m=shifted.getUTCMinutes();
  return {
    timestamp:ts,
    year:shifted.getUTCFullYear(),month:shifted.getUTCMonth()+1,day:shifted.getUTCDate(),
    h,m,mins:h*60+m,dateMs:ts+5.5*60*60*1000
  };
}
function isoDateFromUtcDate(date){ return date.toISOString().slice(0,10); }
function isNseTradingDate(dateText){
  const date=new Date(String(dateText||'')+'T12:00:00Z');
  if(Number.isNaN(date.getTime())) return false;
  const day=date.getUTCDay();
  return day!==0&&day!==6&&!NSE_HOLIDAYS.has(isoDateFromUtcDate(date));
}
function getModelTradingDate(timestamp=Date.now()){
  const clock=istClock(timestamp);
  const anchor=new Date(Date.UTC(clock.year,clock.month-1,clock.day,12,0,0));
  if(clock.mins<DAY_START_MIN) anchor.setUTCDate(anchor.getUTCDate()-1);
  while(!isNseTradingDate(isoDateFromUtcDate(anchor))) anchor.setUTCDate(anchor.getUTCDate()-1);
  return isoDateFromUtcDate(anchor);
}
function istNow(){ return istClock(Date.now()); }
function isMarketHours(){
  const {mins}=istNow();
  return mins>=DAY_START_MIN&&mins<DAY_END_MIN;
}
function getSessionDate(){ return getModelTradingDate(Date.now()); }

// Stable liquidity and self-managing display filters
const LIQ_MIN_AVG_VOL=10000;
const LIQ_MIN_AVG_TURNOVER=10000000;
const MIN_PRICE_FLOOR=5;
const MIN_MCAP_FLOOR=500000000;
function passesAverageLiquidity(avgVol10D,avgTurnover){
  if(avgVol10D==null||!isFinite(avgVol10D)) return true;
  if(avgVol10D<LIQ_MIN_AVG_VOL) return false;
  return avgTurnover==null||!isFinite(avgTurnover)||avgTurnover>=LIQ_MIN_AVG_TURNOVER;
}
// ── CSV Parser ──
function parseCSVRaw(text){
  const lines=[];let cur='',inQ=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"')inQ=!inQ;
    else if((c==='\n'||c==='\r')&&!inQ){if(c==='\r'&&text[i+1]==='\n')i++;if(cur.trim())lines.push(cur);cur='';continue;}
    cur+=c;
  }
  if(cur.trim())lines.push(cur);
  return lines;
}
function splitLine(line){
  const r=[];let f='',inQ=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){if(inQ&&line[i+1]==='"'){f+='"';i++;}else inQ=!inQ;}
    else if(c===','&&!inQ){r.push(f.trim());f='';}
    else f+=c;
  }
  r.push(f.trim());return r;
}
function parseCSV(text){
  let lines=parseCSVRaw(String(text||'').replace(/^\uFEFF/,''));
  if(lines[0]&&/^sep=/i.test(lines[0].trim())) lines=lines.slice(1);
  if(!lines.length)return[];
  const hdrs=splitLine(lines[0].replace(/^\uFEFF/,'')).map(h=>h.trim().replace(/^\uFEFF/,''));
  const rows=lines.slice(1).map(l=>{
    const v=splitLine(l);
    const o={};
    hdrs.forEach((h,i)=>o[h]=(v[i]!==undefined?v[i].trim():''));
    return o;
  }).filter(r=>Object.values(r).some(v=>v));
  rows._headers=hdrs; // column order for the Radar composite scorer
  return rows;
}
function num(v){
  if(v===null||v===undefined)return null;
  const s=String(v).trim().replace(/,/g,'');
  if(!s||s==='-'||s==='—'||/^n\/?a$/i.test(s))return null;
  const x=parseFloat(s);
  return Number.isFinite(x)?x:null;
}
function normSym(s){return String(s||'').trim().replace(/^[A-Z]+:/,'').replace(/_/g,'-').toUpperCase().replace(/-(EQ|BE|BZ|SM|ST|SZ)$/,'');}
function escHtml(s){return String(s??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));}
function openTradingViewChart(sym){
  const symbol=String(sym??'').trim();
  if(!symbol) return;
  const url=`https://www.tradingview.com/chart/?symbol=NSE:${encodeURIComponent(symbol)}`;
  window.open(url,'_blank','noopener,noreferrer');
}
function symbolChartButton(sym,innerHtml=null,extraStyle=''){
  const s=String(sym??'').trim();
  if(!s) return '';
  const t=KITE_TOKEN[normSym(s)];
  const url=t?`https://kite.zerodha.com/chart/web/ciq/NSE/${encodeURIComponent(normSym(s))}/${t}`:'';
  const onClick=t
    ?`kiteOpen(${JSON.stringify(normSym(s))},${JSON.stringify(url)})`
    :`openTradingViewChart(${JSON.stringify(s)})`;
  const title=t?`Open ${escHtml(s)} in Zerodha Kite (copies the symbol too)`
              :`Open the TradingView chart for ${escHtml(s)} — no Kite token on file`;
  return `<button type="button" onclick='event.stopPropagation();${onClick}'`
    +` style="padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;${extraStyle}"`
    +` title="${title}">${innerHtml??escHtml(s)}</button>`
    ;
}
function tvChartButton(sym){
  const s=String(sym??'').trim();
  if(!s) return '';
  return `<button type="button" onclick='event.stopPropagation();openTradingViewChart(${JSON.stringify(s)})'`
    +` style="margin-left:5px;padding:0 4px;border:1px solid var(--border);border-radius:3px;background:transparent;`
    +`color:var(--t3);font-size:10px;line-height:14px;cursor:pointer"`
    +` title="Open the TradingView chart for ${escHtml(s)}">TV</button>`;
}
function kiteOpen(sym,url){
  let copied=false;
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(sym);copied=true;}
  }catch(e){}
  try{window.open(url,'_blank','noopener');}catch(e){}
  showToast(copied?sym+' copied — opening Kite':'Opening '+sym+' in Kite',2000);
}
function findHeader(hdrs,patterns){return hdrs.find(h=>patterns.some(p=>p.test(h.trim())))||null;}
function meanArr(arr){return arr.length?arr.reduce((s,v)=>s+v,0)/arr.length:0;}
function roundPct05(v){return +(Math.round(v/0.05)*0.05).toFixed(2);}
function capSLDistancePct(v){
  const n=Number(v);
  if(!Number.isFinite(n)||n<=0) return SL_MIN_PCT;
  return Math.max(SL_MIN_PCT,Math.min(n,SL_MAX_PCT));
}
function getCappedSLPct(rawDistance){
  return -capSLDistancePct(rawDistance);
}
function getActiveStopDistancePct(atrPct){
  const atr=Number(atrPct);
  return capSLDistancePct(atr>0?atr*SL_ATR_MULT:SL_MIN_PCT);
}
function getRowStopDistancePct(s){
  const explicit=Math.abs(Number(s?.slPct));
  if(explicit>0&&Number.isFinite(explicit)) return capSLDistancePct(explicit);
  const atr=Number(s?.atr);
  if(Number.isFinite(atr)&&atr>0) return getActiveStopDistancePct(atr);
  const learned=Math.abs(Number(TRADEBOOK_STATS?.adaptiveSL));
  return capSLDistancePct(learned>0?learned:SL_MIN_PCT);
}
function weightedPercentile(rows,valueFn,weightFn,pct){
  const vals=rows.map(r=>({v:valueFn(r),w:Math.max(0,weightFn(r))}))
    .filter(x=>isFinite(x.v)&&isFinite(x.w)&&x.w>0).sort((a,b)=>a.v-b.v);
  if(!vals.length) return null;
  const total=vals.reduce((s,x)=>s+x.w,0), target=total*Math.max(0,Math.min(1,pct));
  let seen=0;
  for(const x of vals){seen+=x.w;if(seen>=target) return x.v;}
  return vals[vals.length-1].v;
}
// Observational policy: chooses fast, profitable realised exit cohorts; it does not claim
// an alternate TGT/SL would have filled without position-level historical price paths.
function deriveProfitVelocityPolicy(trips,fallbackSL,fallbackTGT){
  const valid=(trips||[]).filter(r=>isFinite(r.netPnlPct)&&isFinite(r.holdDays));
  const baseline={slPct:fallbackSL,tgtPct:fallbackTGT,holdDays:Math.max(1,Math.round(meanArr(valid.map(r=>r.holdDays))||5)),
    velocityPctPerDay:null,sample:valid.length,objective:'observed net % / holding day'};
  if(valid.length<30) return baseline;
  const minObs=Math.max(20,Math.ceil(valid.length*0.08));
  const candidates=[1,2,3,5,7,10,15,20,30].map(days=>{
    const rows=valid.filter(r=>r.holdDays<=days);
    if(rows.length<minObs) return null;
    const avgPct=meanArr(rows.map(r=>r.netPnlPct));
    const avgDays=Math.max(1,meanArr(rows.map(r=>r.holdDays)));
    const downside=meanArr(rows.map(r=>Math.max(0,-r.netPnlPct)));
    const reliability=Math.sqrt(rows.length/(rows.length+40));
    const velocity=avgPct/avgDays;
    return {days,rows,velocity,score:((avgPct-(0.15*downside))/avgDays)*reliability};
  }).filter(Boolean);
  const best=candidates.length?candidates.reduce((a,b)=>b.score>a.score?b:a):null;
  if(!best||best.score<=0) return baseline;
  const wins=best.rows.filter(r=>r.netPnlPct>0);
  const losses=valid.filter(r=>r.netPnlPct<=0);
  const speedWeight=r=>1/Math.max(1,r.holdDays);
  const learnedTgt=weightedPercentile(wins,r=>r.netPnlPct,speedWeight,0.5);
  const learnedSL=weightedPercentile(losses,r=>Math.abs(r.netPnlPct),speedWeight,0.35);
  const tgtBlend=Math.min(0.75,wins.length/(wins.length+40));
  const slBlend=Math.min(0.75,losses.length/(losses.length+40));
  let tgt=learnedTgt==null?fallbackTGT:roundPct05(Math.max(1,fallbackTGT+(learnedTgt-fallbackTGT)*tgtBlend));
  const tightenedSL=learnedSL==null?fallbackSL:Math.min(fallbackSL,learnedSL);
  const sl=roundPct05(Math.max(1,fallbackSL+(tightenedSL-fallbackSL)*slBlend));
  return {slPct:sl,tgtPct:tgt,holdDays:best.days,coreHoldDays:best.days,velocityPctPerDay:+best.velocity.toFixed(3),
    sample:best.rows.length,total:valid.length,baselineSL:fallbackSL,baselineTGT:fallbackTGT,
    objective:'observed net % / holding day'};
}
function tickPrice(v){return Math.round(v/0.05)*0.05;}
function tickBelowPrice(v){return Math.max(0,(Math.ceil((v*100)/5)*5-5)/100);}
function actionableSellTrigger(stop, ltp){
  if(!(stop>0)||!(ltp>0)) return stop;
  return +Math.min(tickPrice(stop),tickBelowPrice(ltp)).toFixed(2);
}
function survRuleKey(label){return String(label||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');}
function isSurvFlag(v){
  const s=String(v||'').trim();
  return s!==''&&s!=='100';
}
const SURV_SEED_RULES=[
  {column:'Default',label:'Default'},
  {column:'Insolvency_Resolution_Process(IRP)',label:'Insolvency Resolution Process (IRP)'},
  {column:'ICA',label:'ICA'},
  {column:'Under BZ/SZ Series',label:'Under BZ/SZ Series'},
  {column:'Company has failed to pay Annual listing fee',label:'Listing fee unpaid'},
  {column:'ESM',label:'ESM'},
  {column:'GSM',label:'GSM'},
  {column:'Long_Term_Additional_Surveillance_Measure (Long Term ASM)',label:'Long Term ASM'},
  {column:'Short_Term_Additional_Surveillance_Measure (Short Term ASM)',label:'Short Term ASM'},
  {column:'Add-on_PB',label:'Add-on price band'},
  {column:'Unsolicited_SMS',label:'Unsolicited SMS'},
  {column:'Social Media Platforms',label:'Social Media Platforms'},
];
const SURV_RETIRED_KEYS=[
  'scrip_pe_is_greater_than_50_4_trailing_quarters',
  'eps_in_the_scrip_is_zero_4_trailing_quarters',
  'loss_making',
  'high_low_price_variation_greater_than_100perc_in_previous_6_months',
  'pledge','total_pledge',
  'the_overall_encumbered_share_in_the_scrip_is_more_than_50_percent',
  'less_than_100_unique_pan_traded_in_previous_30_days',
  'sme_scrip_is_not_regularly_traded',
  'mandatory_market_making_period_in_sme_scrip_is_over',
  'derivative_contracts_in_the_scrip_to_be_moved_out_of_f_and_o',
];

function getSurvRules(){
  const seen=new Set();
  return SURV_CUSTOM_RULES.map(rule=>{
    const column=String(rule.column||rule.label||'').trim();
    const label=String(rule.label||column).trim();
    const key=survRuleKey(column);
    return {key,column,label};
  }).filter(rule=>{
    if(!rule.column||seen.has(rule.key)) return false;
    seen.add(rule.key);
    return true;
  });
}
function saveSurvRules(){
  try{FS.set(SURV_RULE_STORE,SURV_CUSTOM_RULES);}catch(e){console.warn('Could not save surveillance rules',e);}
}
function loadSurvRules(){
  try{
    const raw=FS.get(SURV_RULE_STORE);
    if(raw&&Array.isArray(raw)&&raw.length>0){
      const parsed=raw.map(rule=>{
        const column=String(rule.column||rule.label||'').trim();
        return column?{key:survRuleKey(column),column,label:String(rule.label||column).trim()}:null;
      }).filter(Boolean);
      // v1211: v1169 retired eleven CRITERIA columns because seeding them made a hard removal out of
      // "this company has a high PE". Its own note promised "adding one back by hand still works and
      // is still respected - this only undoes the seeding, it does not police the owner". It did not:
      // the filter sat in loadSurvRules, which reads the SAVED set on EVERY load, so a rule the owner
      // re-added was stripped again on the next boot and silently saved back without it. The
      // retirement is a ONE-TIME migration of an existing brain, applied once and then recorded.
      let retired=false;
      if(!FS.get(SURV_RETIRE_MARK)){
        SURV_CUSTOM_RULES=parsed.filter(r=>SURV_RETIRED_KEYS.indexOf(r.key)<0);
        retired=SURV_CUSTOM_RULES.length!==parsed.length;
      } else {
        SURV_CUSTOM_RULES=parsed;
      }
      try{ FS.set(SURV_RETIRE_MARK,1); }catch(e){}
      if(retired) saveSurvRules();
    } else {
      // First-time: seed with default rules
      SURV_CUSTOM_RULES=SURV_SEED_RULES.map(r=>({key:survRuleKey(r.column),column:r.column,label:r.label}));
    }
  }catch(e){
    // A read failure is not a licence to replace the owner's table. Seed ONLY when nothing was
    // stored; if something was stored and could not be understood, leave whatever is already in
    // memory alone rather than overwriting a saved set with defaults.
    console.warn('Could not load surveillance rules',e);
    if(!Array.isArray(SURV_CUSTOM_RULES)||!SURV_CUSTOM_RULES.length){
      SURV_CUSTOM_RULES=SURV_SEED_RULES.map(r=>({key:survRuleKey(r.column),column:r.column,label:r.label}));
    }
  }
}
function syncSurvRuleRows(savedRows){
  const byKey={};
  (savedRows||[]).forEach(row=>{if(row&&row.key) byKey[row.key]=row;});
  const activeHeaders=new Set((SURV_HEADERS||[]).map(h=>String(h).trim().toLowerCase()));
  return getSurvRules().map(rule=>{
    const prev=byKey[rule.key]||{};
    const active=prev.active!=null?prev.active:activeHeaders.has(rule.column.toLowerCase());
    return {key:rule.key,label:rule.label,column:rule.column,active,flagged:prev.flagged||0,removed:prev.removed||0};
  });
}
// ── NSE Parsers ──
function parseBhavdata(text){
  parseCSV(text).forEach(r=>{
    const sym=normSym(r['SYMBOL']);
    if(!sym||(r['SERIES']||'').trim()!=='EQ')return;
    NSE_BHAV[sym]={delivPct:num(r['DELIV_PER']),nseVol:num(r['TTL_TRD_QNTY']),
      officialClose:num(r['CLOSE_PRICE']),officialAvg:num(r['AVG_PRICE']),trades:num(r['NO_OF_TRADES']),
      open:num(r['OPEN_PRICE']),high:num(r['HIGH_PRICE']),low:num(r['LOW_PRICE']),
      prevClose:num(r['PREV_CLOSE']),dateStr:(r['DATE1']||'').trim()};
  });
}
function nseDateToISO(s){
  const m=String(s||'').trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if(!m) return null;
  const mo=PR_MONTHS[m[2].toLowerCase()];
  return mo?`${m[3]}-${mo}-${m[1].padStart(2,'0')}`:null;
}
// v1099: each stored value is [close, high, low]. The extremes are what "where did it go AFTER I
// sold" needs — a close cannot answer it. Legacy entries written by v1098 are bare close numbers and
// are read through these accessors, so an older brain degrades to close-only rather than breaking.
const phClose=v=>Array.isArray(v)?(Number(v[0])>0?Number(v[0]):null):(Number(v)>0?Number(v):null);
const phHigh =v=>Array.isArray(v)&&Number(v[1])>0?Number(v[1]):null;
const phLow  =v=>Array.isArray(v)&&Number(v[2])>0?Number(v[2]):null;
function recordPriceHistoryFromBhav(){
  const byDate={};
  for(const sym of Object.keys(NSE_BHAV||{})){
    const b=NSE_BHAV[sym];
    const iso=nseDateToISO(b?.dateStr);
    if(!iso||!(Number(b?.officialClose)>0)) continue;
    const hi=Number(b?.high)>0?+Number(b.high).toFixed(2):null;
    const lo=Number(b?.low)>0?+Number(b.low).toFixed(2):null;
    (byDate[iso]=byDate[iso]||{})[sym]=[+Number(b.officialClose).toFixed(2),hi,lo];
  }
  const dates=Object.keys(byDate);
  if(!dates.length) return null;
  const raw=FS.get(PRICE_HISTORY_STORE);
  const store=(raw&&typeof raw==='object'&&raw.sessions)?raw:{version:1,sessions:{}};
  const sessions={...store.sessions};
  let changed=false;
  for(const d of dates){
    // Re-uploading a session overwrites that date rather than accumulating — idempotent by date key.
    if(JSON.stringify(sessions[d]||null)!==JSON.stringify(byDate[d])){ sessions[d]=byDate[d]; changed=true; }
  }
  const keep=Object.keys(sessions).sort().slice(-PRICE_HISTORY_KEEP_SESSIONS);
  for(const d of Object.keys(sessions)) if(!keep.includes(d)){ delete sessions[d]; changed=true; }
  if(!changed) return store;
  const out={version:1,sessions};
  FS.set(PRICE_HISTORY_STORE,out);
  return out;
}
function resultsDayMoveContext(resultsDate){
  const raw=FS.get(PRICE_HISTORY_STORE);
  const store=(raw&&typeof raw==='object'&&raw.sessions)?raw.sessions:null;
  if(!store||!resultsDate) return null;
  const dates=Object.keys(store).sort();
  const i=dates.indexOf(resultsDate);
  if(i<1) return null;                       // need the results day AND the close before it
  const prev=store[dates[i-1]]||{}, cur=store[resultsDate]||{};
  const moves={},all=[];
  for(const sym of Object.keys(cur)){
    const p0=phClose(prev[sym]),p1=phClose(cur[sym]);
    if(!(p0>0)||!(p1>0)) continue;
    const m=(p1/p0-1)*100;
    moves[sym]=+m.toFixed(2); all.push(m);
  }
  if(all.length<50) return null;             // too thin a cross-section to take a percentile from
  all.sort((a,b)=>a-b);
  return {moves,cut:all[Math.floor(all.length*0.9)],n:all.length,date:resultsDate};
}
function buildUpStreakMap(){
  const raw=FS.get(PRICE_HISTORY_STORE);
  const store=(raw&&typeof raw==='object'&&raw.sessions)?raw.sessions:null;
  if(!store) return null;
  const dates=Object.keys(store).sort();
  if(dates.length<2) return null;                 // one session cannot show a streak
  const out={};
  const last=store[dates[dates.length-1]]||{};
  for(const sym of Object.keys(last)){
    if(!(phClose(last[sym])>0)) continue;
    let n=0;
    for(let i=dates.length-1;i>0;i--){
      const a=phClose((store[dates[i]]||{})[sym]), b=phClose((store[dates[i-1]]||{})[sym]);
      if(!(a>0)||!(b>0)) break;
      if(a>b) n++; else break;
    }
    out[sym]=n;
  }
  return {map:out,sessions:dates.length,asOf:dates[dates.length-1]};
}

function measureFieldEdge(field,opts){
  const st=FS.get(RECOMMEND_OUTCOME_STORE);
  const issues=(st&&st.issues)?st.issues:null;
  const higherIsBetter=!(opts&&opts.lowerIsBetter);
  if(!issues) return {field,w:0,conc:null,pairs:0,cohorts:0,why:'no resolved picks yet'};
  let hi=0,pairs=0,cohorts=0;
  for(const d of Object.keys(issues)){
    const picks=(issues[d].picks||[]).filter(p=>!p.control
      &&['rocket','stopped','expired','ambiguous'].indexOf(String(p.rocketOutcome))>=0
      &&Number.isFinite(p[field]));
    const W=picks.filter(p=>String(p.rocketOutcome)==='rocket');
    const L=picks.filter(p=>String(p.rocketOutcome)!=='rocket');
    if(!W.length||!L.length) continue;
    let n=0;
    for(const a of W) for(const b of L){
      if(a[field]===b[field]) continue;           // a tie discriminates nothing
      n++;
      if(higherIsBetter?(a[field]>b[field]):(a[field]<b[field])) hi++;
    }
    if(n){ pairs+=n; cohorts++; }
  }
  if(!pairs) return {field,w:0,conc:null,pairs:0,cohorts:0,why:'no discriminating pairs recorded yet'};
  const conc=hi/pairs;
  const prior=pairs/cohorts;                       // mean pairs per cohort - self-derived, not typed
  const w=Math.max(0,Math.min(1,2*(conc-0.5)))*(pairs/(pairs+prior));
  return {field,w,conc,pairs,cohorts,why:null};
}
function measureUpStreakEdge(){ return measureFieldEdge('upStreak'); }
function backfillPickUpStreak(){
  const raw=FS.get(PRICE_HISTORY_STORE);
  const store=(raw&&typeof raw==='object'&&raw.sessions)?raw.sessions:null;
  const st=FS.get(RECOMMEND_OUTCOME_STORE);
  const issues=(st&&st.issues)?st.issues:null;
  if(!store||!issues) return 0;
  const dates=Object.keys(store).sort();
  if(dates.length<2) return 0;
  let filled=0;
  for(const d of Object.keys(issues)){
    const before=dates.filter(x=>x<d);              // STRICTLY before the issue date
    if(before.length<2) continue;
    for(const p of (issues[d].picks||[])){
      if(p.upStreak!=null||!p.symbol) continue;
      const sym=normSym(p.symbol);
      let n=0,ok=false;
      for(let i=before.length-1;i>0;i--){
        const a=phClose((store[before[i]]||{})[sym]), b=phClose((store[before[i-1]]||{})[sym]);
        if(!(a>0)||!(b>0)) break;
        ok=true;
        if(a>b) n++; else break;
      }
      if(ok){ p.upStreak=n; filled++; }
    }
  }
  if(filled){ FS.set(RECOMMEND_OUTCOME_STORE,st); invalidateUpStreakCache(); }
  return filled;
}

let _upStreakMemo=null;
function getUpStreakContext(){
  const raw=FS.get(PRICE_HISTORY_STORE);
  const key=(raw&&raw.sessions)?Object.keys(raw.sessions).sort().join('|'):'';
  if(_upStreakMemo&&_upStreakMemo.key===key) return _upStreakMemo.ctx;
  const built=buildUpStreakMap();
  const edge=measureUpStreakEdge();
  const ctx=built?Object.assign({},built,{edge}):{map:null,sessions:0,asOf:null,edge};
  _upStreakMemo={key,ctx};
  return ctx;
}
function invalidateUpStreakCache(){ _upStreakMemo=null; }

let _r4dMemo=null;
function getResultsDayMove(sym,resultsDate){
  if(!sym||!resultsDate) return null;
  if(!_r4dMemo||_r4dMemo.date!==resultsDate) _r4dMemo={date:resultsDate,ctx:resultsDayMoveContext(resultsDate)};
  const c=_r4dMemo.ctx;
  if(!c) return null;
  const m=c.moves[normSym(sym)];
  return m===undefined?null:{movePct:m,topDecileCut:+c.cut.toFixed(2),wasRocket:m>=c.cut,universe:c.n};
}

function buildDriftIntoEventMap(beforeDate,sessions=PRE_RESULTS_DRIFT_SESSIONS){
  const raw=FS.get(PRICE_HISTORY_STORE);
  const store=(raw&&typeof raw==='object'&&raw.sessions)?raw.sessions:null;
  if(!store) return {map:{},sessionsUsed:0,from:null,to:null};
  const dates=Object.keys(store).sort().filter(d=>!beforeDate||d<beforeDate);
  if(dates.length<sessions+1) return {map:{},sessionsUsed:0,from:null,to:null};
  const to=dates[dates.length-1], from=dates[dates.length-1-sessions];
  const a=store[from]||{}, b=store[to]||{};
  const map={};
  for(const sym of Object.keys(b)){
    const p0=phClose(a[sym]), p1=phClose(b[sym]);
    if(!(p0>0)||!(p1>0)) continue;          // a symbol missing either end gets no drift, not a zero
    map[sym]=+((p1/p0-1)*100).toFixed(2);
  }
  return {map,sessionsUsed:sessions,from,to};
}

function getPostSellExtremes(sym,sellDate,sellTime=null){
  const s=normSym(sym);
  const out={high:null,low:null,sessions:0,includesSellDay:false,exact:true,from:null,to:null};
  if(!s||!sellDate) return out;
  const raw=FS.get(PRICE_HISTORY_STORE);
  const store=(raw&&typeof raw==='object'&&raw.sessions)?raw.sessions:{};
  for(const d of Object.keys(store).sort()){
    if(d<=sellDate) continue;               // strictly AFTER the sell — the sell day is handled below
    const v=store[d]?.[s];
    if(v===undefined) continue;
    const hi=phHigh(v)??phClose(v), lo=phLow(v)??phClose(v);
    if(hi>0) out.high=out.high==null?hi:Math.max(out.high,hi);
    if(lo>0) out.low =out.low ==null?lo:Math.min(out.low ,lo);
    out.sessions++;
    if(!out.from) out.from=d;
    out.to=d;
  }
  // Today's bar is still forming and is not in the bhav copy yet, so take it from the live row.
  const scanDate=(typeof getSessionDate==='function')?getSessionDate():null;
  const row=(Array.isArray(ALL)?ALL:[]).find(r=>r.symbol===s);
  if(row&&scanDate&&scanDate>=sellDate){
    const hi=Number(row.high1d), lo=Number(row.low1d), px=Number(row.price);
    const useHi=hi>0?hi:(px>0?px:null), useLo=lo>0?lo:(px>0?px:null);
    // v1120: on a LATER session the whole bar is attributable and folds in as before. On the SELL
    // DAY it must NOT — the fold now happens inside the branch below, and only for the part of the
    // day that came after the exit. Folding first and correcting after is what left GNA at ₹592.
    if(scanDate>sellDate){
      if(useHi>0) out.high=out.high==null?useHi:Math.max(out.high,useHi);
      if(useLo>0) out.low =out.low ==null?useLo:Math.min(out.low ,useLo);
    }
    if(scanDate===sellDate){
      const w=getPostSellHighFromWatch(s,sellDate,sellTime);
      if(w){
        if(w.advanced&&w.postSellHigh>0){
          out.high=out.high==null?w.postSellHigh:Math.max(out.high,w.postSellHigh);
          out.includesSellDay=true;
          out.exact=!w.straddles;                 // clean unless the advance interval straddles the sell
          out.sellDayNote=w.straddles
            ? `new high after the exit, but the observation interval straddles your sell`
            : `new high at ${w.advancedAt} IST, after your ${String(sellTime).match(/\d{1,2}:\d{2}/)?.[0]||'exit'}`;
        } else {
          // No new high after the exit. The sell day contributes NOTHING — it cannot be claimed.
          out.includesSellDay=false; out.exact=true;
          out.sellDayNote=`no new high after your exit${w.preSellHigh?` — the day's high (${w.preSellHigh}) was already in`:''}`;
        }
      } else {
        // Not watched (recorder began 2026-08-11, scope is the book plus the top of the ranking).
        // Fall back to the v1099 behaviour — fold the whole bar in — and keep saying it is an upper bound.
        if(useHi>0) out.high=out.high==null?useHi:Math.max(out.high,useHi);
        if(useLo>0) out.low =out.low ==null?useLo:Math.min(out.low ,useLo);
        out.includesSellDay=true; out.exact=false;
        out.sellDayNote='sell day not watched — the whole-day high is an upper bound';
      }
    } else { out.sessions++; out.to=scanDate; if(!out.from) out.from=scanDate; }
  }
  return out;
}
function parsePriceBand(text){
  parseCSV(text).forEach(r=>{
    const sym=normSym(r['Symbol']||r['SYMBOL']||r['symbol']);
    if(!sym)return;
    const series=String(r['Series']||r['SERIES']||'').trim().toUpperCase();
    if(series&&series!=='EQ')return;
    const band=num(r['Band']||r['BAND']||r['Price Band']||r['PRICE_BAND']);
    if(band!==null&&band>0)NSE_PRICE_BAND[sym]={bandPct:band,remarks:String(r['Remarks']||r['REMARKS']||'').trim()};
  });
}
function reportDateFromFilename(filename){
  const m=String(filename||'').match(/(\d{2})(\d{2})(\d{4})/);
  return m?`${m[3]}-${m[2]}-${m[1]}`:null;
}
function parseVarEod(text){
  // NSE publishes six snapshots. Only _6 is the completed-session rate; detectNSE deliberately
  // refuses snapshots 1-5 so an intraday margin estimate can never masquerade as the EOD risk read.
  const next={};
  for(const line of parseCSVRaw(text)){
    if(!line.startsWith('20,')) continue;
    const p=splitLine(line),series=String(p[2]||'').trim().toUpperCase();
    const sym=normSym(p[1]);
    if(!sym||series!=='EQ') continue;
    const securityVarPct=num(p[4]),varMarginPct=num(p[6]),elmPct=num(p[7]),additionalMarginPct=num(p[8]),totalMarginPct=num(p[9]);
    next[sym]={securityVarPct,varMarginPct,elmPct,additionalMarginPct,totalMarginPct};
  }
  NSE_VAR=next;
}
function parseNextBandChanges(text,filename=''){
  const reportDate=reportDateFromFilename(filename);
  parseCSV(text).forEach(r=>{
    const sym=normSym(r['Symbol']||r['SYMBOL']);
    const series=String(r['Series']||r['SERIES']||'').trim().toUpperCase();
    const fromPct=num(r['From']||r['FROM']),toPct=num(r['To']||r['TO']);
    if(sym&&(!series||series==='EQ')&&fromPct>0&&toPct>0) NSE_NEXT_BAND[sym]={fromPct,toPct,reportDate};
  });
}
function epochDateISO(value){
  const n=Number(value);
  if(!(n>0)) return null;
  const d=new Date(n*1000);
  return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);
}
function parseSecurityMaster(text){
  const next={};
  parseCSV(text).forEach(r=>{
    const sym=normSym(r['TckrSymb']),series=String(r['SctySrs']||'').trim().toUpperCase();
    if(!sym||!series) return;
    const item={series,isin:String(r['ISIN']||'').trim(),name:String(r['FinInstrmNm']||'').trim(),
      instrumentId:num(r['FinInstrmId']),normalMarketEligible:String(r['ElgbltyNrmlMkt']||'').trim()==='1',
      normalMarketStatus:num(r['SctyStsNrmlMkt']),deleted:String(r['DelFlg']||'').trim().toUpperCase()==='Y',
      listingDate:epochDateISO(r['ListgDt']),priceRange:String(r['PricRg']||'').trim(),
      tickSize:num(r['TickSz']),tradeToTrade:String(r['TradToTradInd']||'').trim().toUpperCase()==='Y',
      slbmEligible:String(r['SLBMElgblty']||'').trim().toUpperCase()==='Y'};
    // The file contains multiple series and instruments under a ticker. The cash EQ row is the
    // relevant identity and always wins; non-EQ is retained only as a fallback audit record.
    if(!next[sym]||series==='EQ') next[sym]=item;
  });
  NSE_SECURITY_MASTER=next;
  // REG1 remains the authority for A/inactive status. The master safely fills only a missing series;
  // its numeric normal-market status codes are retained for audit, not guessed into A/I semantics.
  Object.entries(next).forEach(([sym,m])=>{if(!NSE_SERIES[sym]&&m.series)NSE_SERIES[sym]=m.series;});
}
function useNextSessionBand(change){
  if(!change?.reportDate) return false;
  const c=istClock(),today=`${c.year}-${String(c.month).padStart(2,'0')}-${String(c.day).padStart(2,'0')}`;
  return today>change.reportDate||(today===change.reportDate&&c.mins>=DAY_END_MIN);
}
function getNSEBandRecord(symbol){
  const sym=normSym(symbol),base=NSE_PRICE_BAND[sym],change=NSE_NEXT_BAND[sym];
  if(change){
    const next=useNextSessionBand(change);
    return {bandPct:next?change.toPct:change.fromPct,remarks:next?`Next-session band changed ${change.fromPct}% to ${change.toPct}%`:`Band changes to ${change.toPct}% next session`,change};
  }
  return base||null;
}
function enrichRowsWithNSEData(rows){
  (rows||[]).forEach(s=>{
    const sym=normSym(s.symbol);
    if(sym&&sym!==s.symbol) s.symbol=sym;
    const pb=getNSEBandRecord(s.symbol);
    if(pb?.bandPct!=null){
      s.price_band_pct=pb.bandPct;
      s.pct_to_upper_band=(s.priceChange!=null&&isFinite(s.priceChange))?pb.bandPct-s.priceChange:null;
      if(s._features){
        s._features.price_band_pct=s.price_band_pct;
        s._features.pct_to_upper_band=s.pct_to_upper_band;
      }
    }
  });
  return rows;
}
function getNSEPriceBandPct(symbol){
  const pb=getNSEBandRecord(symbol);
  const band=pb?.bandPct;
  return band!=null&&isFinite(band)&&band>0?band:null;
}
function getPriceBandBlockReason(s){
  const band=s?.price_band_pct??getNSEPriceBandPct(s?.symbol);
  if(!(band!=null&&isFinite(band)&&band>0)) return '';
  const pc=s?.priceChange;
  if(pc!=null&&isFinite(pc)&&pc>=band-PRICE_BAND_BLOCK_BUFFER_PCT) return `Near ${band}% NSE price band`;
  return '';
}
function getUpperCircuitInfo(row,refPrice=null){
  const band=row?.price_band_pct??getNSEPriceBandPct(row?.symbol);
  if(!(band!=null&&isFinite(band)&&band>0)) return null;   // no band on file: fail open
  const pc=Number(row?.priceChange), px=Number(row?.price);
  if(!Number.isFinite(pc)||!(px>0)) return null;
  const prevClose=px/(1+pc/100);
  if(!(prevClose>0)) return null;
  const ucPrice=prevClose*(1+band/100);
  const ref=Number(refPrice)>0?Number(refPrice):px;
  return {band,prevClose,ucPrice,refPrice:ref,runwayPct:(ucPrice/ref-1)*100};
}
function getSessionCeilingInfo(row,refPrice=null){
  const low=Number(row?.low1d), rangePct=Number(row?.rangePct);
  if(!(low>0)||!(rangePct>0)) return null;
  const ceiling=low*(1+rangePct/100);
  const ref=Number(refPrice)>0?Number(refPrice):Number(row?.price);
  if(!(ref>0)) return null;
  return {rangePct,low,ceiling,refPrice:ref,runwayPct:(ceiling/ref-1)*100};
}
function parse52W(text){
  const lines=parseCSVRaw(text);
  let hi=-1;
  for(let i=0;i<lines.length;i++){if(lines[i].includes('SYMBOL')&&lines[i].includes('52_Week')){hi=i;break;}}
  if(hi<0)return;
  parseCSV(lines.slice(hi).join('\n')).forEach(r=>{
    const sym=normSym(r['SYMBOL']);
    if(!sym)return;
    const s=(r['SERIES']||'').trim();
    if(s&&s!=='EQ')return;
    const h=num(r['Adjusted_52_Week_High']),l=num(r['Adjusted_52_Week_Low']);
    if(h!==null&&l!==null)NSE_52W[sym]={high52w:h,low52w:l};
  });
}
function parseSurv(text){
  const rows=parseCSV(text);
  NSE_SURV={};
  NSE_STATUS={};
  NSE_SERIES={};
  NSE_NON_EQ=new Set();
  SURV_HEADERS=[];
  SURV_RULE_HITS={};
  SURV_MISSING_RULES=new Set();
  SURV_ALL_HITS={};
  if(!rows.length) return;
  const hdrs=Object.keys(rows[0]);
  SURV_HEADERS=hdrs.slice();
  const hdrMap={};
  hdrs.forEach(h=>{hdrMap[String(h).trim().toLowerCase()]=h;});
  // Find symbol column — REG1 files use various casings/names
  const symCol=findHeader(hdrs,[/^symbol$/i,/^nse.?symbol$/i,/^trading.?symbol$/i,/^scrip.?symbol$/i])||null;
  const seriesCol=findHeader(hdrs,[/^series$/i])||null;
  // dataHdrs: every column from the actual REG1 file that is a surveillance flag
  // Excludes identity/metadata columns and filler columns
  const _survNonFlag=new Set(['scripcode','symbol','nse exclusive','status','series']);
  const dataHdrs=hdrs.filter(h=>{const hl=h.trim().toLowerCase();return !_survNonFlag.has(hl)&&!/^filler/i.test(h.trim());});
  // SURV_FILE_RULES: every column in the REG1 file — used by the "add rule" datalist so the
  // user can browse all available rules even though only configured ones flag stocks
  const fileRuleKeys=new Set();
  SURV_FILE_RULES=dataHdrs.map(h=>({key:survRuleKey(h),column:h,label:h}))
    .filter(r=>{if(fileRuleKeys.has(r.key))return false;fileRuleKeys.add(r.key);return true;});
  // Update column names for any user rules renamed in the REG1 file (case/spacing only)
  SURV_CUSTOM_RULES.forEach(r=>{
    const matchedHdr=dataHdrs.find(h=>survRuleKey(h)===r.key);
    if(matchedHdr){r.column=matchedHdr;r.label=matchedHdr;}
  });
  // activeRules: ONLY the user's configured surveillance rules (SURV_CUSTOM_RULES).
  // Rules in the REG1 file but NOT in the user's table do not flag stocks. The badge,
  // REMOVED.survRules counts, and methodology rule counts all derive from this.
  const activeRules=SURV_CUSTOM_RULES.map(r=>{
    const matchedHdr=dataHdrs.find(h=>survRuleKey(h)===r.key);
    return {key:r.key, column:r.column, label:r.label, header:matchedHdr||null};
  });
  activeRules.forEach(rule=>{SURV_RULE_HITS[rule.key]=0;});
  const statusCol=findHeader(hdrs,[/^status$/i])||null;
  rows.forEach(r=>{
    const sym=normSym(symCol?r[symCol]:r['Symbol']);if(!sym)return;
    // Track non-EQ series — BE/BZ/SZ/SM/ST can't be bought normally
    // Duplicate-symbol rows (warrants/partly-paid share the base symbol): the EQ row
    // always wins so a W1/E1 sibling can never poison an equity's series or status.
    const rowSeries=seriesCol?(r[seriesCol]||'').trim().toUpperCase():'';
    if(rowSeries&&(NSE_SERIES[sym]==null||rowSeries==='EQ'))NSE_SERIES[sym]=rowSeries;
    if(statusCol){const st=(r[statusCol]||'').trim().toUpperCase();if(st&&(NSE_STATUS[sym]==null||rowSeries==='EQ'))NSE_STATUS[sym]=st;}
    const hits=[];
    activeRules.forEach(rule=>{
      if(!rule.header) return;
      if(isSurvFlag(r[rule.header])) hits.push(rule.key);
    });
    if(hits.length){NSE_SURV[sym]=hits; hits.forEach(key=>{SURV_RULE_HITS[key]=(SURV_RULE_HITS[key]||0)+1;});}
    // Populate SURV_ALL_HITS for ALL flagged columns (for P&L correlation)
    const allHit={};
    dataHdrs.forEach(h=>{if(isSurvFlag(r[h]))allHit[h]=true;});
    if(Object.keys(allHit).length) SURV_ALL_HITS[sym]=allHit;
  });
  NSE_NON_EQ=new Set(Object.entries(NSE_SERIES).filter(([,v])=>v!=='EQ').map(([k])=>k));
}
function parseDeal(text,map){
  parseCSV(text).forEach(r=>{
    const sym=normSym(r['Symbol']);if(!sym)return;
    const side=(r['Buy/Sell']||'').trim().toUpperCase();
    const qty=num(r['Quantity Traded'])||0;
    if(side==='BUY'){map[sym]=true;NSE_DEAL_NET[sym]=(NSE_DEAL_NET[sym]||0)+qty;}
    else if(side==='SELL'){NSE_DEAL_NET[sym]=(NSE_DEAL_NET[sym]||0)-qty;}
  });
}
function parseCorpActions(text){
  parseCSV(text).forEach(r=>{
    const series=String(r['SERIES']||'').trim().toUpperCase();
    if(!/^(EQ|BE|BZ)$/.test(series))return; // equity series only
    const sym=normSym(r['SYMBOL']);if(!sym)return;
    const exDate=String(r['EX_DT']||r['RECORD_DT']||'').trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(exDate))return;
    const purpose=String(r['PURPOSE']||'').trim().toUpperCase();
    let kind=null,divAmt=0;
    if(/DEMERGER|FVSPLT|SPLIT|BONUS|RIGHT/.test(purpose))kind='structural';
    else if(/BUY\s*BACK|BUYBACK|CAPITAL RED/.test(purpose))kind='buyback';
    else if(/DIV/.test(purpose)){kind='dividend';divAmt=(purpose.match(/\d+(?:\.\d+)?/g)||[]).reduce((a,b)=>a+Number(b),0);}
    else return; // INTEREST PAYMENT / REDEMPTION (bonds) etc. — ignored
    (NSE_CORP_ACTION[sym]??=[]).push({exDate,purpose,kind,divAmt});
  });
}
const PR_MONTHS={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
// PR-zip board-meetings file bm<ddmmyyyy>.txt (v554). Line: "<company> <SYMBOL> : DD-MMM-YYYY : <purpose>".
// An upcoming-event calendar — a results meeting on the session date flags an event day (idea #1 Event Risk).
function parseBoardMeetings(text){
  String(text||'').split(/\r?\n/).forEach((line,i)=>{
    if(i===0||!line.trim())return; // header
    const parts=line.split(' : ');
    if(parts.length<2)return;
    const sym=normSym(parts[0].trim().split(/\s+/).pop());if(!sym)return;
    const dm=parts[1].trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);if(!dm)return;
    const mo=PR_MONTHS[dm[2].toLowerCase()];if(!mo)return;
    const date=`${dm[3]}-${mo}-${dm[1].padStart(2,'0')}`,purpose=parts.slice(2).join(' : ').trim();
    NSE_BOARD_MEETING[sym]={date,purpose,isResults:/financial result/i.test(purpose)};
  });
}
// PR-zip announcements file an<ddmmyyyy>.txt (v554). Line: "<company> <SYMBOL> : <category ...>[ : <text>]".
// Presence = the company filed an announcement this session; stored short for the detail modal only (noisy → not scored).
function parseAnnouncements(text){
  String(text||'').split(/\r?\n/).forEach((line,i)=>{
    if(i===0||!line.trim())return; // header
    const parts=line.split(' : ');
    if(parts.length<2)return;
    const sym=normSym(parts[0].trim().split(/\s+/).pop());if(!sym)return;
    if(!NSE_ANNOUNCE[sym])NSE_ANNOUNCE[sym]=parts.slice(1).join(' : ').replace(new RegExp('^'+sym+'\\b\\s*','i'),'').trim().slice(0,120);
  });
}
function _nseCells(line){return String(line||'').split(',').map(c=>c.trim());}
// pd<ddmmyyyy>.csv - the same payload as pr but WITH a SYMBOL column, so it serves two purposes:
// IND_SEC='Y' rows give index OHLC + 52-week range (Nifty 50, Midcap, Bank, and INDIA VIX), and the
// equity rows give the NAME -> SYMBOL map that the name-keyed files (hl, gl) need to be usable.
function parsePdIndexAndNames(text){
  const lines=String(text||'').split(/\r?\n/).filter(Boolean);
  if(!lines.length) return;
  const head=_nseCells(lines[0]).map(h=>h.toUpperCase());
  const ix=n=>head.indexOf(n);
  const iSym=ix('SYMBOL'),iSec=ix('SECURITY'),iPrev=ix('PREV_CL_PR'),iClose=ix('CLOSE_PRICE'),
        iInd=ix('IND_SEC'),iHi=ix('HI_52_WK'),iLo=ix('LO_52_WK');
  if(iSec<0||iClose<0) return;
  const num=v=>{const x=Number(String(v||'').replace(/,/g,''));return Number.isFinite(x)?x:null;};
  for(let k=1;k<lines.length;k++){
    const f=_nseCells(lines[k]); if(f.length<head.length) continue;
    const name=(f[iSec]||'').trim(); if(!name) continue;
    const sym0=iSym>=0?normSym(f[iSym]):'';
    const isConstituent=iInd>=0&&(f[iInd]||'').toUpperCase()==='Y';
    if(!sym0){
      if(!isConstituent) continue;
      const close=num(f[iClose]),prev=num(f[iPrev]),hi=num(f[iHi]),lo=num(f[iLo]);
      if(close===null) continue;
      NSE_INDEX[name]={close,prev,
        pct:(prev&&prev!==0)?+(((close-prev)/prev)*100).toFixed(2):null,
        high52:hi||null,low52:lo||null,
        rangePos:(hi&&lo&&hi>lo)?+(((close-lo)/(hi-lo))*100).toFixed(1):null};
    } else {
      NSE_NAME_TO_SYM[name.toUpperCase()]=sym0;
      // A symbol-bearing row flagged IND_SEC=Y is a Nifty 50 constituent. This is a SYMBOL-keyed
      // membership source, far more reliable than joining gl's truncated 24-char names.
      if(isConstituent) NSE_INDEX_GROUP_BYSYM[sym0]='Nifty 50';
    }
  }
}
// bh<ddmmyyyy>.csv - securities that HIT their price band today (SYMBOL,SERIES,SECURITY,HIGH/LOW).
// This is the literal upper-circuit list, kept as a labelled cohort for forward learning.
function parseBandHits(text){
  const lines=String(text||'').split(/\r?\n/).filter(Boolean);
  const head=_nseCells(lines[0]||'').map(h=>h.toUpperCase());
  const iSym=head.indexOf('SYMBOL'),iHL=head.findIndex(h=>h.includes('HIGH'));
  if(iSym<0||iHL<0) return;
  for(let k=1;k<lines.length;k++){
    const f=_nseCells(lines[k]); if(f.length<=Math.max(iSym,iHL)) continue;
    const sym=normSym(f[iSym]),hl=(f[iHL]||'').toUpperCase();
    if(sym&&(hl==='H'||hl==='L')) NSE_BAND_HIT[sym]=hl;
  }
}
function parseNewHighLow(text){
  const lines=String(text||'').split(/\r?\n/).filter(Boolean);
  const head=_nseCells(lines[0]||'').map(h=>h.toUpperCase());
  const iSec=head.indexOf('SECURITY'),iNew=head.indexOf('NEW'),iPrev=head.indexOf('PREVIOUS'),
        iSt=head.findIndex(h=>h.includes('STATUS'));
  if(iSec<0||iSt<0) return;
  const num=v=>{const x=Number(String(v||'').replace(/,/g,''));return Number.isFinite(x)?x:null;};
  for(let k=1;k<lines.length;k++){
    const f=_nseCells(lines[k]); if(f.length<=iSt) continue;
    const name=(f[iSec]||'').trim().toUpperCase(),st=(f[iSt]||'').toUpperCase();
    if(!name||(st!=='H'&&st!=='L')) continue;
    NSE_NEW_HL_BYNAME[name]={status:st,now:iNew>=0?num(f[iNew]):null,prev:iPrev>=0?num(f[iPrev]):null};
  }
}
// gl<ddmmyyyy>.csv - gainers/losers under section headers ("Nifty 50 Sec.", "Nifty Next 50 Sec.",
// "OTHER SECURITIES"). A header row has an EMPTY first cell and the section name in the second.
// This is the app's only source of index membership.
function parseIndexGroups(text){
  const lines=String(text||'').split(/\r?\n/);
  let group='Other';
  for(let k=1;k<lines.length;k++){
    const f=_nseCells(lines[k]); if(f.length<2) continue;
    const gl=(f[0]||'').toUpperCase(),name=(f[1]||'').trim();
    if(!gl&&name){
      const u=name.toUpperCase();
      group=u.includes('NIFTY 50')?'Nifty 50':u.includes('NEXT 50')?'Nifty Next 50':'Other';
      continue;
    }
    // FIRST assignment wins. The file lists Nifty 50, then Nifty Next 50, then OTHER SECURITIES —
    // and OTHER repeats the index constituents, so last-write-wins silently reclassified every
    // Nifty 50 name as 'Other' (measured: 0 Nifty 50 members before this fix).
    if((gl==='G'||gl==='L')&&name){
      const key=name.toUpperCase();
      if(!(key in NSE_INDEX_GROUP_BYNAME)) NSE_INDEX_GROUP_BYNAME[key]=group;
    }
  }
}
// Lazy resolvers so member order inside the zip cannot matter.
function getNewHighLowMap(){
  const out={};
  Object.entries(NSE_NEW_HL_BYNAME).forEach(([name,v])=>{const sym=NSE_NAME_TO_SYM[name];if(sym)out[sym]=v;});
  return out;
}
function getIndexGroupMap(){
  // gl's names are truncated to 24 characters, so the name join is lossy. pd's symbol-keyed
  // constituent flag is authoritative for Nifty 50 and takes precedence.
  const out={};
  Object.entries(NSE_INDEX_GROUP_BYNAME).forEach(([name,g])=>{const sym=NSE_NAME_TO_SYM[name];if(sym)out[sym]=g;});
  Object.entries(NSE_INDEX_GROUP_BYSYM).forEach(([sym,g])=>{out[sym]=g;});
  return out;
}
function buildLiveNiftyProxy(rows){
  // Only an OMITTED argument falls back to the global universe. An explicitly empty array must
  // yield null — otherwise "compute this for no rows" silently returns the whole market.
  const src=Array.isArray(rows)?rows:(typeof ALL!=='undefined'?ALL:[]);
  if(!src.length||!NSE_INDEX_GROUP_BYSYM) return null;
  let wsum=0,w=0,n=0,adv=0;
  for(const r of src){
    if(NSE_INDEX_GROUP_BYSYM[r.symbol]!=='Nifty 50') continue;
    const d=Number(r.day), mc=Number(r.marketCap);
    if(!Number.isFinite(d)) continue;
    const wt=(Number.isFinite(mc)&&mc>0)?mc:1; // equal-weight fallback when market cap is absent
    wsum+=d*wt; w+=wt; n++; if(d>0)adv++;
  }
  if(!n||!(w>0)) return null;
  return {pct:+(wsum/w).toFixed(2), members:n, advancing:adv, weighted:src.some(r=>Number(r.marketCap)>0)};
}
function buildMarketRegime(){
  const idx=n=>NSE_INDEX[n]||null;
  const vix=idx('India VIX'),nifty=idx('Nifty 50'),mid=idx('NIFTY MIDCAP 150')||idx('Nifty Midcap 50');
  const adv=NSE_MARKET&&NSE_MARKET.advances!=null?NSE_MARKET.advances:null;
  const dec=NSE_MARKET&&NSE_MARKET.declines!=null?NSE_MARKET.declines:null;
  const breadth=(MARKET_INTRADAY&&MARKET_INTRADAY.advPct!=null)?+(MARKET_INTRADAY.advPct*100).toFixed(1):null;
  const vp=vix?vix.rangePos:null;
  if(!vix&&!nifty&&adv===null&&breadth===null) return null;
  return {
    vix:vix?vix.close:null, vixPct:vix?vix.pct:null, vixRangePos:vp,
    niftyPct:nifty?nifty.pct:null, niftyRangePos:nifty?nifty.rangePos:null,
    midcapRangePos:mid?mid.rangePos:null,
    advances:adv, declines:dec,
    advDecRatio:(adv!=null&&dec)?+(adv/dec).toFixed(2):null,
    breadthPct:breadth,
    label:vp===null?'unknown':vp<25?'calm':vp<50?'normal':vp<75?'elevated':'stressed'
  };
}
function parseMarketActivity(text){
  const m={date:null,dateISO:null,niftyPct:null,advances:null,declines:null,tradedValueCr:null,marketCapCr:null,indices:{}};
  const numf=s=>{const x=Number(String(s).replace(/[,%\s]/g,''));return Number.isFinite(x)?x:null;};
  String(text||'').split(/\r?\n/).forEach(line=>{
    const f=line.split(',');if(f.length<2)return;
    const a=(f[1]||'').trim(),b=(f[2]||'').trim();
    const dm=a.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if(!m.date&&dm){m.date=a;const mo=PR_MONTHS[dm[2].toLowerCase()];if(mo)m.dateISO=`${dm[3]}-${mo}-${dm[1].padStart(2,'0')}`;return;}
    if(/^ADVANCES$/i.test(a)){m.advances=numf(b);return;}
    if(/^DECLINES$/i.test(a)){m.declines=numf(b);return;}
    if(/traded value/i.test(a)){m.tradedValueCr=numf(b);return;}
    if(/total market cap/i.test(a)){m.marketCapCr=numf(b);return;}
    // index rows: name + prev-close(f2)…close(f6)…gain-loss(f7). % = gain-loss / prev-close.
    if(f.length>=8&&/[A-Za-z]/.test(a)){const prev=numf(f[2]),gl=numf(f[7]);if(prev!=null&&gl!=null&&prev!==0){const pct=gl/prev*100;m.indices[a]=pct;if(a==='Nifty 50')m.niftyPct=pct;}}
  });
  NSE_MARKET=m;
}
function parseNSEHolidays(text){
  // Format: Sr. No,Date,Day,Description — Date is DD-MMM-YYYY
  const months={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  const rows=parseCSV(text);
  const dates=new Set();
  rows.forEach(r=>{
    const raw=(r['Date']||r['date']||'').trim();
    const m=raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if(!m) return;
    const dd=m[1].padStart(2,'0'), mo=months[m[2].toLowerCase()], yyyy=m[3];
    if(mo) dates.add(`${yyyy}-${mo}-${dd}`);
  });
  NSE_HOLIDAYS=dates;
  FS.set(NSE_HOLIDAYS_STORE,[...dates]);
  console.log('NSE Holidays loaded:',dates.size,'dates');
}
// Returns number of trading days between two YYYY-MM-DD strings (exclusive of d1, inclusive of d2)
function tradingDaysBetween(d1,d2){
  if(!d1||!d2) return null;
  const start=new Date(d1+'T12:00:00Z'), end=new Date(d2+'T12:00:00Z');
  if(end<=start) return 0;
  let count=0;
  const cur=new Date(start);
  cur.setUTCDate(cur.getUTCDate()+1); // start exclusive
  while(cur<=end){
    const dow=cur.getUTCDay(); // 0=Sun,6=Sat
    if(dow!==0&&dow!==6){
      const ds=cur.toISOString().slice(0,10);
      if(!NSE_HOLIDAYS.has(ds)) count++;
    }
    cur.setUTCDate(cur.getUTCDate()+1);
  }
  return count;
}
function clampNum(v,min,max){return Math.max(min,Math.min(max,v));}
function percentileValue(values,pct){
  const sorted=(values||[]).filter(v=>v!=null&&isFinite(v)).sort((a,b)=>a-b);
  if(!sorted.length) return null;
  return sorted[Math.min(sorted.length-1,Math.max(0,Math.floor((sorted.length-1)*pct)))];
}
const ROCKET_HORIZON_DAYS=2; // the issue day + the next trading day
const ROCKET_OUTCOME={ROCKET:'rocket',STOPPED:'stopped',AMBIGUOUS:'ambiguous',PENDING:'pending',EXPIRED:'expired'};
function resolveRocketDay(bar,entryPrice,targetPct,stopPct,prevHigh=null,prevLow=null){
  if(!(entryPrice>0)||!(targetPct>0)||!(stopPct>0)) return null;
  const up=entryPrice*(1+targetPct/100), dn=entryPrice*(1-stopPct/100);
  const hi=Number(bar?.high1d), lo=Number(bar?.low1d);
  const newHigh=prevHigh==null||!(prevHigh>0)?true:hi>prevHigh+1e-9;
  const newLow =prevLow ==null||!(prevLow >0)?true:lo<prevLow -1e-9;
  const hitUp=hi>0&&hi>=up&&newHigh;
  const hitDn=lo>0&&lo<=dn&&newLow;
  if(hitUp&&hitDn) return ROCKET_OUTCOME.AMBIGUOUS;
  if(hitUp) return ROCKET_OUTCOME.ROCKET;
  if(hitDn) return ROCKET_OUTCOME.STOPPED;
  return null; // neither barrier touched — still live
}
// Did this pick's resolved state count as a rocket? Ambiguity is deliberately NOT a rocket.
function isRocketOutcome(p){return p?.rocketOutcome===ROCKET_OUTCOME.ROCKET;}
function resolveRocketForPick(p,bar,gap,scanDate){
  if(!p||!bar) return;
  if(p.rocketOutcome&&p.rocketOutcome!==ROCKET_OUTCOME.PENDING) return; // already resolved
  if(!(p.entryPrice>0)||!(p.targetPct>0)||!(p.stopPct>0)){
    p.rocketOutcome=p.rocketOutcome||ROCKET_OUTCOME.PENDING;
    p.rocketUnresolvedReason='no per-stock target/stop recorded at issue';
    return;
  }
  const horizon=Math.max(1,p.rocketHorizonDays||ROCKET_HORIZON_DAYS);
  if(gap>horizon-1){ // window closed without either barrier being touched
    p.rocketOutcome=ROCKET_OUTCOME.EXPIRED;p.rocketResolvedOn=scanDate;p.rocketResolvedDay=gap;
    return;
  }
  if(p.rocketDaysSeen&&p.rocketDaysSeen.includes(gap)) return;
  p.rocketDaysSeen=[...(p.rocketDaysSeen||[]),gap];
  // Only the ISSUE day needs its pre-recommendation action excluded (see resolveRocketDay).
  const res=resolveRocketDay(bar,p.entryPrice,p.targetPct,p.stopPct,
    gap===0?p.high1dAtIssue:null, gap===0?p.low1dAtIssue:null);
  if(!res) return; // still live inside the window
  p.rocketOutcome=res;p.rocketResolvedOn=scanDate;p.rocketResolvedDay=gap;
  if(res===ROCKET_OUTCOME.ROCKET){p.rocketDate=scanDate;p.rocketDays=gap;}
}
function getRocketArrivalStats(){
  const issues=Object.values((FS.get(RECOMMEND_OUTCOME_STORE)||{}).issues||{});
  const days=issues.flatMap(issue=>(issue.picks||[])
      .filter(p=>String(p.rocketOutcome)===String(ROCKET_OUTCOME.ROCKET))
      .map(p=>p.rocketDays))
    .filter(v=>v!=null&&isFinite(v)&&v>0);
  return {
    count:days.length,
    avg:days.length?+meanArr(days).toFixed(1):null,
    p75:percentileValue(days,0.75),
  };
}
function getAdaptiveOutcomeHorizonDays(){
  const arrival=getRocketArrivalStats();
  const adaptiveTrips=TRADEBOOK_STATS?.tripsData?.length?getAdaptiveTradeTrips(TRADEBOOK_STATS.tripsData):[];
  const avgHold=adaptiveTrips.length?meanArr(adaptiveTrips.map(r=>r.holdDays)):TRADEBOOK_STATS?.avgHoldDays;
  const evidence=[
    avgHold!=null&&isFinite(avgHold)?Math.max(1,Math.round(avgHold)):null,
    arrival.p75!=null?Math.ceil(arrival.p75+1):null,
  ].filter(v=>v!=null&&v>0);
  return Math.min(OUTCOME_HORIZON_MAX_DAYS,Math.max(1,evidence.length?Math.max(...evidence):OUTCOME_HORIZON_FALLBACK_DAYS));
}
function getEffectiveReviewDays(){
  const realised=TRADEBOOK_STATS?.exitPolicy?.holdDays||TRADEBOOK_STATS?.holdLimitDays||null;
  const rocketFloor=getRocketArrivalStats().p75;
  const evidence=[realised,rocketFloor].filter(v=>v!=null&&isFinite(v)&&v>0);
  return evidence.length?Math.max(1,Math.ceil(Math.max(...evidence))):null;
}
function getOutcomeCheckpointDays(horizonDays){
  return Math.max(1,Math.round(Math.max(1,horizonDays)/3));
}
function calcRecommendationOutcomeScore(p,threshold){
  const tgt=(threshold&&isFinite(threshold)&&threshold>0)?threshold:10;
  const horizon=Math.max(1,p.horizonDays||getAdaptiveOutcomeHorizonDays());
  const bestHigh=p.bestHighProfitPct;
  const bestClose=p.bestCloseProfitPct;
  const finalClose=p.finalCloseProfitPct!=null?p.finalCloseProfitPct:bestClose;
  const worstLow=p.worstLowProfitPct;
  const earlyHigh=p.conversionHighProfitPct;
  const earlyClose=p.conversionCloseProfitPct;
  const earlyWorst=p.conversionWorstLowProfitPct;
  if(p.rocketDate){
    const days=p.rocketDays??horizon;
    return +clampNum(1-(0.5*((days-1)/Math.max(1,horizon-1))),0.5,1).toFixed(3);
  }
  let score=0;
  if(earlyHigh!=null&&isFinite(earlyHigh)) score=Math.max(score,clampNum((earlyHigh/tgt)*0.8,-1,0.55));
  if(earlyClose!=null&&isFinite(earlyClose)) score=Math.max(score,clampNum((earlyClose/tgt)*0.65,-1,0.45));
  if(bestHigh!=null&&isFinite(bestHigh)) score=Math.max(score,clampNum((bestHigh/tgt)*0.55,-1,0.55));
  if(bestClose!=null&&isFinite(bestClose)) score=Math.max(score,clampNum((bestClose/tgt)*0.45,-1,0.45));
  if(p.conversionAssessed&&!p.rocketDate){
    const minProgress=tgt*RECOMMEND_MIN_PROGRESS_FRACTION;
    const noBreak=(earlyHigh==null||earlyHigh<minProgress);
    const weakClose=earlyClose!=null&&earlyClose<0;
    if(noBreak||weakClose){
      const noConvPenalty=noBreak? -0.25 : score;
      const failPenalty=weakClose?clampNum(earlyClose/(tgt*0.45),-0.75,-0.08):score;
      score=Math.min(score,noConvPenalty,failPenalty);
    }
  }
  if(finalClose!=null&&isFinite(finalClose)){
    const finalScore=clampNum(finalClose/tgt,-1,1);
    score=(score*0.7)+(finalScore*0.3);
    if(finalClose<0&&(bestHigh==null||bestHigh<tgt*0.35)){
      score=Math.min(score,clampNum(finalClose/(tgt*0.5),-1,-0.05));
    }
  }
  if(earlyWorst!=null&&isFinite(earlyWorst)&&earlyWorst<0&&(earlyHigh==null||earlyHigh<tgt*0.35)){
    score=Math.min(score,clampNum((earlyWorst/(tgt*0.55))*0.9,-1,-0.08));
  }
  if(worstLow!=null&&isFinite(worstLow)&&worstLow<0&&(bestHigh==null||bestHigh<tgt*0.5)){
    score=Math.min(score,clampNum((worstLow/(tgt*0.6))*0.8,-1,-0.05));
  }
  return +clampNum(score,-1,1).toFixed(3);
}
function recordRecommendationOutcomeScan(scan){
  if(!scan?.date||!scan.rows?.length) return;
  const adaptiveHorizon=getAdaptiveOutcomeHorizonDays();
  const store=FS.get(RECOMMEND_OUTCOME_STORE)||{horizonDays:adaptiveHorizon,issues:{}};
  const outcomeFeatureOrder=getOutcomeFeatureOrderFromEngine();
  migrateOutcomeFeatureStore(store,outcomeFeatureOrder);
  store.horizonDays=adaptiveHorizon;
  const rowMap=Object.fromEntries(scan.rows.map(r=>[r.symbol,r]));
  Object.values(store.issues||{}).forEach(issue=>{
    const horizon=Math.max(1,issue.horizonDays||adaptiveHorizon);
    const checkpoint=getOutcomeCheckpointDays(horizon);
    issue.horizonDays=horizon;
    const gap=tradingDaysBetween(issue.date,scan.date);
    if(gap==null||gap<0) return;
    if(gap===0){
      (issue.picks||[]).forEach(p=>{
        const row=rowMap[p.symbol];
        if(row) resolveRocketForPick(p,row,gap,scan.date);
      });
      return;
    }
    if(gap>horizon){
      (issue.picks||[]).forEach(p=>{
        const row=rowMap[p.symbol];
        if(row) resolveRocketForPick(p,row,gap,scan.date);
        p.complete=true;
      });
      return;
    }
    (issue.picks||[]).forEach(p=>{
      const row=rowMap[p.symbol];
      if(!row||!(p.entryPrice>0)) return;
      resolveRocketForPick(p,row,gap,scan.date);
      if(p.evaluatedThrough===scan.date) return;
      const highProfit=row.high1d>0?((row.high1d-p.entryPrice)/p.entryPrice)*100:null;
      const closeProfit=row.price>0?((row.price-p.entryPrice)/p.entryPrice)*100:null;
      const lowProfit=row.low1d>0?((row.low1d-p.entryPrice)/p.entryPrice)*100:null;
      p.observations=(p.observations||0)+1;
      p.evaluatedThrough=scan.date;
      if(highProfit!=null&&(p.bestHighProfitPct==null||highProfit>p.bestHighProfitPct)){
        p.bestHighProfitPct=+highProfit.toFixed(2);p.bestDays=gap;
      }
      if(closeProfit!=null&&(p.bestCloseProfitPct==null||closeProfit>p.bestCloseProfitPct)){
        p.bestCloseProfitPct=+closeProfit.toFixed(2);
      }
      if(closeProfit!=null) p.finalCloseProfitPct=+closeProfit.toFixed(2);
      if(lowProfit!=null&&(p.worstLowProfitPct==null||lowProfit<p.worstLowProfitPct)){
        p.worstLowProfitPct=+lowProfit.toFixed(2);
      }
      p.horizonDays=horizon;
      if(gap<=checkpoint){
        p.conversionAssessed=gap===checkpoint;
        if(highProfit!=null&&(p.conversionHighProfitPct==null||highProfit>p.conversionHighProfitPct)){
          p.conversionHighProfitPct=+highProfit.toFixed(2);
        }
        if(closeProfit!=null) p.conversionCloseProfitPct=+closeProfit.toFixed(2);
        if(lowProfit!=null&&(p.conversionWorstLowProfitPct==null||lowProfit<p.conversionWorstLowProfitPct)){
          p.conversionWorstLowProfitPct=+lowProfit.toFixed(2);
        }
      } else if(!p.conversionAssessed&&(p.conversionHighProfitPct!=null||p.conversionCloseProfitPct!=null||p.conversionWorstLowProfitPct!=null)){
        p.conversionAssessed=true;
      }
      p.outcomeScore=calcRecommendationOutcomeScore(p,issue.threshold);
      p.complete=gap>=horizon;
    });
  });
  const currentIssue=store.issues[scan.date];
  if(currentIssue&&scan.recommendations?.length){
    const fresh=Object.fromEntries(scan.recommendations.map(r=>[r.symbol,r]));
    (currentIssue.picks||[]).forEach(p=>{
      if(Number(p.targetPct)>0&&Number(p.stopPct)>0) return;   // already usable
      const r=fresh[p.symbol];
      if(!r||!(Number(r.targetPct)>0)||!(Number(r.stopPct)>0)) return;
      p.targetPct=Number(r.targetPct);
      p.stopPct=Number(r.stopPct);
      if(p.high1dAtIssue==null&&Number(r.high1dAtIssue)>0) p.high1dAtIssue=Number(r.high1dAtIssue);
      if(p.low1dAtIssue==null&&Number(r.low1dAtIssue)>0) p.low1dAtIssue=Number(r.low1dAtIssue);
      p.rocketOutcome=p.rocketOutcome||ROCKET_OUTCOME.PENDING;
      p.rocketHorizonDays=p.rocketHorizonDays||ROCKET_HORIZON_DAYS;
      p.barriersBackfilledOn=scan.date;
      delete p.rocketUnresolvedReason;
    });
  }
  const isNewIssueDate=!currentIssue||!(currentIssue.picks||[]).length;
  if(scan.recommendations?.length&&isNewIssueDate){
    store.issues[scan.date]={
      date:scan.date,threshold:scan.threshold,horizonDays:adaptiveHorizon,
      regime:(typeof MARKET_REGIME!=='undefined'&&MARKET_REGIME)?MARKET_REGIME:null,
      picks:scan.recommendations.map(p=>({symbol:p.symbol,entryPrice:p.entryPrice,score:p.score,rank:p.rank,
        features:compactOutcomeFeatures(p.features,outcomeFeatureOrder),
        entryReady:p.entryReady!==false,
        blockReason:p.entryReady===false?[
          (p.entryTiming?.rangeUsed>=75?'rangeConsumed':''),
          (p.entryTiming?.cooling?'cooling':''),
          (p.entryTiming?.bandExtended?'bandExtended':''),
          (p.entryTiming?.gapLedFade?'gapLedFade':''),
          (p.entryTiming?.failedBreakout?'failedBreakout':''),
          (p.entryTiming?.weakMarketBlocked?'weakMarket':'')
        ].filter(Boolean).join('+')||'peak':null,
        rangeLocationAtIssue:p.entryTiming?.rangeLocation??null,
        rangeUsedAtIssue:p.entryTiming?.rangeUsed??null,
        radarRank:p.radarRank??null,
        control:p.control?true:undefined,          // v1128: evidence-only row, never a recommendation
        // v1127: carried through the whitelist deliberately — v1085 added barrier fields to the
        // caller and NOT here, and every pick silently lost them for 9 releases. Same trap.
        stage:p.stage??null,
        upStreak:Number.isFinite(+p.upStreak)?+p.upStreak:null,
        upStreakPct:Number.isFinite(+p.upStreakPct)?+p.upStreakPct:null,
        issueMinute:Number.isFinite(+p.issueMinute)?+p.issueMinute:null,
        issueClock:p.issueClock??null,
        compositePct:p.compositePct??null,
        ignitePct:p.ignitePct??null,
        setupPct:p.setupPct??null,
        directionConfirmed:!!p.directionConfirmed,
        rocketReady:p.rocketReady===true,
        targetReachable:p.targetReachable===true,
        fundamentalTrigger:Number.isFinite(Number(p.fundamentalTrigger))?Number(p.fundamentalTrigger):0,
        targetPct:Number(p.targetPct)>0?Number(p.targetPct):null,
        stopPct:Number(p.stopPct)>0?Number(p.stopPct):null,
        high1dAtIssue:Number(p.high1dAtIssue)>0?Number(p.high1dAtIssue):null,
        low1dAtIssue:Number(p.low1dAtIssue)>0?Number(p.low1dAtIssue):null,
        rocketOutcome:p.rocketOutcome||ROCKET_OUTCOME.PENDING,
        rocketHorizonDays:p.rocketHorizonDays||ROCKET_HORIZON_DAYS,
        observations:0,evaluatedThrough:null,rocketDate:null,rocketDays:null,
        bestHighProfitPct:null,bestCloseProfitPct:null,finalCloseProfitPct:null,worstLowProfitPct:null,
        conversionHighProfitPct:null,conversionCloseProfitPct:null,conversionWorstLowProfitPct:null,conversionAssessed:false,
        bestDays:null,outcomeScore:null,horizonDays:adaptiveHorizon,complete:false}))
    };
  }
  const cutoff=new Date(scan.date+'T12:00:00Z');
  cutoff.setUTCDate(cutoff.getUTCDate()-180);
  Object.keys(store.issues).forEach(date=>{if(date<cutoff.toISOString().slice(0,10)) delete store.issues[date];});
  FS.set(RECOMMEND_OUTCOME_STORE,store);
}
const POST_CLOSE_CONDITIONS=[
  {key:'entry-ready',label:'Entry gate approved',mode:'gate',test:p=>p.entryReady!==false,rowTest:r=>r.entryReady!==false},
  {key:'top-5',label:'Issued rank 1-5',mode:'gate',test:p=>Number(p.radarRank??p.rank)<=5,rowTest:r=>Number(r.rank)<=5},
  {key:'top-10',label:'Issued rank 1-10',mode:'gate',test:p=>Number(p.radarRank??p.rank)<=10,rowTest:r=>Number(r.rank)<=10},
  {key:'score-99',label:'Issue score at least 99',mode:'gate',test:p=>Number(p.score)>=99,rowTest:r=>Number(r.score)>=99},
  {key:'setup-p95',label:'Setup percentile at least 95%',mode:'gate',test:p=>Number(p.setupPct)>=.95,rowTest:r=>Number(r.setupPct)>=.95},
  {key:'ignite-p95',label:'Ignition percentile at least 95%',mode:'gate',test:p=>Number(p.ignitePct)>=.95,rowTest:r=>Number(r.ignitePct)>=.95},
  {key:'direction-confirmed',label:'Direction confirmed at issue',mode:'gate',test:p=>p.directionConfirmed===true,rowTest:r=>r.directionConfirmed===true},
  {key:'range-location-75',label:'Range location at most 75%',mode:'gate',test:p=>Number.isFinite(Number(p.rangeLocationAtIssue))&&Number(p.rangeLocationAtIssue)<=75,rowTest:r=>Number.isFinite(Number(r.entryTiming?.rangeLocation))&&Number(r.entryTiming.rangeLocation)<=75},
  {key:'range-used-75',label:'Expected range used below 75%',mode:'gate',test:p=>Number.isFinite(Number(p.rangeUsedAtIssue))&&Number(p.rangeUsedAtIssue)<75,rowTest:r=>Number.isFinite(Number(r.entryTiming?.rangeUsed))&&Number(r.entryTiming.rangeUsed)<75},
  {key:'ready-top-10',label:'Entry approved and issued rank 1-10',mode:'gate',test:p=>p.entryReady!==false&&Number(p.radarRank??p.rank)<=10,rowTest:r=>r.entryReady!==false&&Number(r.rank)<=10},
  {key:'rocket-ready',label:'All feasibility tests passed',mode:'gate',test:p=>p.rocketReady===true,rowTest:r=>r.rocketReady===true},
  {key:'target-reachable',label:'Target fits the stock range estimate',mode:'gate',test:p=>p.targetReachable===true,rowTest:r=>{try{return getRowExitPolicy(r).reachable===true;}catch(e){return false;}}},
  {key:'stage-accumulation',label:'Accumulation or re-accumulation stage',mode:'boost',test:p=>[1,5].includes(Number(p.stage)),rowTest:r=>[1,5].includes(Number(r.stage))},
  {key:'stage-breakout',label:'Initial or second-leg breakout stage',mode:'boost',test:p=>[2,6].includes(Number(p.stage)),rowTest:r=>[2,6].includes(Number(r.stage))},
  {key:'stage-event',label:'Unresolved event-day stage',mode:'veto-on-retired',test:p=>Number(p.stage)===3,rowTest:r=>Number(r.stage)===3},
  {key:'stage-digestion',label:'Post-result profit-booking stage',mode:'veto-on-retired',test:p=>Number(p.stage)===4,rowTest:r=>Number(r.stage)===4},
  {key:'fundamental-positive',label:'Profitable results plus price confirmation',mode:'boost',test:p=>Number(p.fundamentalTrigger)>0,rowTest:r=>Number(r.fundamentalTrigger)>0},
  {key:'fundamental-negative',label:'Loss, negative operations, or qualified audit',mode:'veto-on-retired',test:p=>Number(p.fundamentalTrigger)<0,rowTest:r=>Number(r.fundamentalTrigger)<0},
];
function buildPostCloseIssueAudit(issue,asOf){
  const picks=(issue?.picks||[]).filter(p=>!p.control);
  const resolved=picks.filter(p=>p.rocketOutcome&&p.rocketOutcome!==ROCKET_OUTCOME.PENDING);
  const rockets=resolved.filter(isRocketOutcome);
  const conditions=POST_CLOSE_CONDITIONS.map(c=>{
    const matched=resolved.filter(c.test),wins=matched.filter(isRocketOutcome).length,losses=matched.length-wins;
    return {key:c.key,label:c.label,n:matched.length,wins,losses,precision:matched.length?+(100*wins/matched.length).toFixed(1):null};
  });
  return {issueDate:issue.date,asOf,issued:picks.length,resolved:resolved.length,rockets:rockets.length,
    pending:picks.length-resolved.length,precision:resolved.length?+(100*rockets.length/resolved.length).toFixed(1):null,
    conditions,candidates:conditions.filter(c=>c.n>0&&c.precision>=95)};
}
function getPostCloseRuleScorecard(audits){
  return POST_CLOSE_CONDITIONS.map(c=>{
    const rows=Object.values(audits||{}).map(a=>(a.conditions||[]).find(x=>x.key===c.key)).filter(x=>x&&x.n>0);
    const wins=rows.reduce((s,x)=>s+x.wins,0),losses=rows.reduce((s,x)=>s+x.losses,0),sessions=rows.length,total=wins+losses;
    const precision=total?+(100*wins/total).toFixed(1):null;
    const status=wins>=3&&sessions>=2&&losses<=1&&precision>=95?'ARMED':wins===0&&sessions>=10?'RETIRED':'COLLECTING';
    return {key:c.key,label:c.label,wins,losses,sessions,total,precision,status};
  });
}
const GAINER_COHORT_N=20;
// v1208: the existing audit grades the app's OWN picks, so it can only ever learn from what it
// already recommends. This grades the day's ACTUAL winners against the same conditions, whether or
// not the app picked them, which is the only way a miss becomes evidence.
function getGainerCohort(rows){
  const pool=(Array.isArray(rows)?rows:ALL).filter(r=>r&&r.eqEligible!==false
    &&Number(r.turnover)>=25e5&&Number(r.price)>=10&&Number.isFinite(Number(r.day)));
  return pool.slice().sort((a,b)=>Number(b.day)-Number(a.day)).slice(0,GAINER_COHORT_N);
}
function buildGainerAudit(asOf){
  const rows=Array.isArray(ALL)?ALL:[];
  if(rows.length<200) return null;
  const cohort=getGainerCohort(rows);
  if(cohort.length<5) return null;
  const win=new Set(cohort.map(r=>r.symbol));
  const control=rows.filter(r=>!win.has(r.symbol)&&r.eqEligible!==false
    &&Number(r.turnover)>=25e5&&Number(r.price)>=10);
  if(control.length<200) return null;
  const safe=(fn,r)=>{try{return !!fn(r);}catch(e){return false;}};
  const conditions=POST_CLOSE_CONDITIONS.map(c=>{
    const hit=cohort.filter(r=>safe(c.rowTest,r)).length;
    const base=control.filter(r=>safe(c.rowTest,r)).length;
    const hp=hit/cohort.length, bp=base/control.length;
    return {key:c.key,label:c.label,mode:c.mode,hit,of:cohort.length,
      hitPct:+(100*hp).toFixed(1),basePct:+(100*bp).toFixed(1),lift:+((hp-bp)*100).toFixed(1)};
  });
  const num=(f)=>{
    const a=cohort.map(f).filter(Number.isFinite).sort((x,y)=>x-y);
    const b=control.map(f).filter(Number.isFinite).sort((x,y)=>x-y);
    const med=v=>v.length?v[Math.floor(v.length/2)]:null;
    return {cohort:med(a),control:med(b)};
  };
  const fields={
    rank:num(r=>Number(r.rank)), score:num(r=>Number(r.score)),
    setupPct:num(r=>Number(r.setupPct)), ignitePct:num(r=>Number(r.ignitePct)),
    compositePct:num(r=>Number(r.compositePct)), feasibility:num(r=>Number(r.feasibility)),
    circuitFeasibility:num(r=>Number(r.circuitFeasibility)),
    relvol:num(r=>Number(r.relvol)), day:num(r=>Number(r.day))};
  const onBoard=cohort.filter(r=>Number(r.rank)<=RECOMMEND_MAX_RANK).length;
  const scored=cohort.filter(r=>Number(r.score)>=RECOMMEND_MIN_SCORE).length;
  return {date:asOf,n:cohort.length,controlN:control.length,
    symbols:cohort.map(r=>({s:r.symbol,day:+Number(r.day).toFixed(2),rank:Number(r.rank)||null,
      score:Number(r.score)||0,setupPct:Number(r.setupPct)||null,
      feasibility:Number.isFinite(r.feasibility)?+r.feasibility.toFixed(3):null,
      circuitFeasibility:Number.isFinite(r.circuitFeasibility)?+r.circuitFeasibility.toFixed(3):null,
      relvol:Number.isFinite(r.relvol)?+r.relvol.toFixed(2):null,
      dirOk:!!r.directionConfirmed})),
    caught:{onBoard,scored},fields,conditions};
}
// A condition ARMS on the same shape of bar the pick audit uses: it has to hold, with the same sign,
// across sessions rather than once. LIFT_MIN is the cohort/control gap in percentage points; a
// condition present in the winners at the market's own base rate says nothing.
const GAINER_LIFT_MIN=25;
function getGainerScorecard(gainers){
  const days=Object.values(gainers||{});
  return POST_CLOSE_CONDITIONS.map(c=>{
    const rows=days.map(d=>(d.conditions||[]).find(x=>x.key===c.key)).filter(Boolean);
    const confirms=rows.filter(x=>x.lift>=GAINER_LIFT_MIN).length;
    const contradictions=rows.filter(x=>x.lift<=-GAINER_LIFT_MIN).length;
    const sessions=rows.length;
    const meanLift=sessions?+(rows.reduce((s,x)=>s+x.lift,0)/sessions).toFixed(1):null;
    const status=confirms>=3&&sessions>=2&&contradictions<=1?'ARMED'
      :(sessions>=10&&confirms===0&&contradictions>=3)?'RETIRED':'COLLECTING';
    return {key:c.key,label:c.label,mode:c.mode,sessions,confirms,contradictions,meanLift,status};
  });
}
function runPostCloseAudit(force=false){
  const clock=istClock(),today=getSessionDate();
  if(!force&&clock.mins<DAY_END_MIN) return null;
  const issues=(FS.get(RECOMMEND_OUTCOME_STORE)||{}).issues||{};
  const prior=FS.get(POST_CLOSE_AUDIT_STORE)||{version:1,audits:{}};
  const audits={...(prior.audits||{})};
  Object.values(issues).forEach(issue=>{
    const picks=(issue?.picks||[]).filter(p=>!p.control);
    const observed=picks.some(p=>(p.rocketDaysSeen||[]).length||p.evaluatedThrough);
    if(observed) audits[issue.date]=buildPostCloseIssueAudit(issue,today);
  });
  const gainers={...(prior.gainers||{})};
  const g=buildGainerAudit(today);
  if(g) gainers[today]=g;
  const out={version:1,updatedAt:new Date().toISOString(),latestSession:today,audits,gainers,
    scorecard:getPostCloseRuleScorecard(audits),gainerScorecard:getGainerScorecard(gainers)};
  FS.set(POST_CLOSE_AUDIT_STORE,out);
  return out;
}
function postCloseAuditStatus(){
  const today=getSessionDate(),store=FS.get(POST_CLOSE_AUDIT_STORE)||{};
  return {today,audit:store.audits?.[today]||null,store};
}
function activePostCloseTriggerRules(mode){
  const store=FS.get(POST_CLOSE_AUDIT_STORE)||{};
  const scorecard=store.scorecard||getPostCloseRuleScorecard(store.audits||{});
  return scorecard.map(s=>({score:s,definition:POST_CLOSE_CONDITIONS.find(c=>c.key===s.key)}))
    .filter(x=>x.definition&&x.definition.mode===mode&&(
      mode==='veto-on-retired'?x.score.status==='RETIRED':['ARMED','ELIGIBLE'].includes(x.score.status)));
}
function applyLearnedTriggerRanking(rows){
  const active=activePostCloseTriggerRules('boost');
  rows.forEach(r=>{r.modelTriggers=[];});
  if(!active.length||!rows.length)return 0;
  let matched=0;
  rows.forEach(r=>{
    const hits=active.filter(x=>x.definition.rowTest(r));
    r.modelTriggers=hits.map(x=>({key:x.definition.key,label:x.definition.label,action:'rank boost',evidence:x.score}));
    if(hits.length)matched++;
    const triggerPct=hits.length?1:.5;
    r._triggerBlend=Math.sqrt(Math.max(0,Number(r.depthBlendPct)||0)*triggerPct);
  });
  if(!matched){rows.forEach(r=>delete r._triggerBlend);return 0;}
  const ranked=rows.slice().sort((a,b)=>a._triggerBlend-b._triggerBlend),n=ranked.length;
  ranked.forEach((r,i)=>{r.depthBlendPct=n>1?i/(n-1):1;});
  rows.forEach(r=>{
    delete r._triggerBlend;
    r.score=+(100*Math.pow(r.depthBlendPct*(r.directionConfirmed?1:0),4)).toFixed(1);
    r.rocketScore=r.score;
  });
  rows.sort((a,b)=>b.score-a.score||radarRankTieBreak(a,b));
  rows.forEach((r,i)=>{r.rank=i+1;});
  return matched;
}
function radarRankTieBreak(a,b){
  const st=r=>{
    const d=Number(r&&r.depthBlendPct); if(Number.isFinite(d)) return d;
    const p=Number(r&&r.setupPct); return Number.isFinite(p)?p:-1;
  };
  return (st(b)-st(a))||String(a.symbol||'').localeCompare(String(b.symbol||''));
}
function applyLearnedRecommendationGates(rows){
  const active=[...activePostCloseTriggerRules('gate'),...activePostCloseTriggerRules('veto-on-retired')];
  rows.forEach(r=>{
    const failed=active.filter(x=>x.definition.mode==='gate'?!x.definition.rowTest(r):x.definition.rowTest(r));
    r.recommendationTriggerBlocked=failed.length>0;
    r.recommendationTriggerReasons=failed.map(x=>x.definition.label);
    r.modelTriggers=[...(r.modelTriggers||[]).filter(t=>t.action==='rank boost'),...active.filter(x=>!failed.includes(x)&&x.definition.rowTest(r))
      .map(x=>({key:x.definition.key,label:x.definition.label,action:x.definition.mode==='gate'?'recommendation gate':'veto',evidence:x.score}))];
  });
  return active.length;
}
function getRecommendationOutcomeSummary(){
  const issues=Object.values((FS.get(RECOMMEND_OUTCOME_STORE)||{}).issues||{});
  // v1128: control rows never enter a RECOMMENDATION metric — the app must not report converting
  // stocks it did not pick. They are graded all the same, and read by the band breakdown.
  const observedPicks=issues.flatMap(i=>(i.picks||[]).filter(p=>p.observations>0&&!p.control));
  const observedRockets=observedPicks.filter(p=>p.rocketDate&&p.rocketDays!=null);
  const assessed=issues.flatMap(issue=>(issue.picks||[])
    .filter(p=>p.complete&&p.observations>0)
    .map(p=>({p,threshold:issue.threshold})));
  const picks=assessed.map(x=>x.p);
  const rocketPool=observedPicks;
  const rockets=rocketPool.filter(p=>isRocketOutcome(p));
  const stoppedOut=rocketPool.filter(p=>p.rocketOutcome===ROCKET_OUTCOME.STOPPED);
  const ambiguous=rocketPool.filter(p=>p.rocketOutcome===ROCKET_OUTCOME.AMBIGUOUS);
  const expired=rocketPool.filter(p=>p.rocketOutcome===ROCKET_OUTCOME.EXPIRED);
  const pendingRocket=rocketPool.filter(p=>!p.rocketOutcome||p.rocketOutcome===ROCKET_OUTCOME.PENDING);
  // Legacy picks carry no target/stop and can NEVER resolve, so they are excluded from the
  // denominator rather than counted as failures — and reported separately so the gap stays visible.
  const unresolvable=pendingRocket.filter(p=>!(p.targetPct>0)||!(p.stopPct>0));
  const resolvedRocketCount=rockets.length+stoppedOut.length+ambiguous.length+expired.length;
  const currentHorizon=getAdaptiveOutcomeHorizonDays();
  const fastRockets=rockets.filter(p=>(p.rocketDays??currentHorizon)<=getOutcomeCheckpointDays(p.horizonDays||currentHorizon));
  const delayedRockets=rockets.length-fastRockets.length;
  const upsides=picks.map(p=>p.bestHighProfitPct).filter(v=>v!=null);
  const scored=assessed.map(({p,threshold})=>calcRecommendationOutcomeScore(p,threshold)).filter(v=>v!=null&&isFinite(v));
  const failures=assessed.filter(({p,threshold})=>calcRecommendationOutcomeScore(p,threshold)<0);
  const earlyFailures=assessed.filter(({p,threshold})=>p.conversionAssessed&&!p.rocketDate&&calcRecommendationOutcomeScore(p,threshold)<0);
  return {
    evaluated:picks.length,rockets:rockets.length,
    stoppedOut:stoppedOut.length,ambiguousRockets:ambiguous.length,
    expiredRockets:expired.length,pendingRockets:pendingRocket.length,
    resolvedRockets:resolvedRocketCount,
    unresolvableRockets:unresolvable.length,
    fastRockets:fastRockets.length,delayedRockets,earlyFailures:earlyFailures.length,
    failures:failures.length,
    conversionPct:resolvedRocketCount?+(rockets.length/resolvedRocketCount*100).toFixed(1):null,
    rocketArrivalCount:observedRockets.length,
    avgRocketDays:observedRockets.length?+(meanArr(observedRockets.map(p=>p.rocketDays)).toFixed(1)):null,
    avgBestHighPct:upsides.length?+meanArr(upsides).toFixed(2):null,
    avgOutcomeScore:scored.length?+meanArr(scored).toFixed(3):null,
    issueDays:issues.length,horizonDays:currentHorizon
  };
}
function buildSystemScorecard(){
  const store=FS.get(RECOMMEND_OUTCOME_STORE)||{};
  const issues=store.issues||{};
  const rows=[];
  let tot={picks:0,resolvable:0,target:0,stopped:0,expired:0,ambiguous:0,pending:0,legacy:0};
  const daysToTarget=[];
  Object.keys(issues).sort().forEach(date=>{
    const issue=issues[date]||{};
    const picks=issue.picks||[];
    // v1128: control rows are graded but are NOT recommendations — excluded here so the scorecard
    // reports what the app actually picked. They are used by the band breakdown below.
    const resolvable=picks.filter(p=>Number(p.targetPct)>0&&Number(p.stopPct)>0&&!p.control);
    const legacy=picks.filter(p=>!p.control).length-resolvable.length;
    const target=resolvable.filter(p=>isRocketOutcome(p));
    const stopped=resolvable.filter(p=>p.rocketOutcome===ROCKET_OUTCOME.STOPPED);
    const expired=resolvable.filter(p=>p.rocketOutcome===ROCKET_OUTCOME.EXPIRED);
    const ambiguous=resolvable.filter(p=>p.rocketOutcome===ROCKET_OUTCOME.AMBIGUOUS);
    const settled=target.length+stopped.length+expired.length+ambiguous.length;
    const pending=resolvable.length-settled;
    target.forEach(p=>{if(p.rocketDays!=null)daysToTarget.push(Number(p.rocketDays));});
    tot.picks+=picks.filter(p=>!p.control).length; tot.resolvable+=resolvable.length; tot.legacy+=legacy;
    tot.target+=target.length; tot.stopped+=stopped.length; tot.expired+=expired.length;
    tot.ambiguous+=ambiguous.length; tot.pending+=pending;
    if(!resolvable.length) return;                        // a wholly legacy cohort says nothing
    rows.push({date,
      regime:String(issue.regime?.label||issue.regime||'—'),
      picks:resolvable.length, target:target.length, stopped:stopped.length,
      expired:expired.length, pending,
      hitPct:settled?+(target.length/settled*100).toFixed(0):null,
      medDays:target.length?median(target.map(p=>Number(p.rocketDays)).filter(v=>Number.isFinite(v))):null});
  });
  let cBetter=0,cWorse=0,cPairs=0;
  Object.keys(issues).forEach(date=>{
    const day=(issues[date]||{}).picks||[];
    const g=day.filter(p=>Number(p.targetPct)>0&&Number(p.stopPct)>0&&!p.control
      &&Number.isFinite(+p.radarRank)
      &&['rocket','stopped','expired','ambiguous'].includes(String(p.rocketOutcome)));
    for(let i=0;i<g.length;i++) for(let j=i+1;j<g.length;j++){
      const a=g[i],b2=g[j];
      const wa=isRocketOutcome(a), wb=isRocketOutcome(b2);
      if(wa===wb) continue;                       // only winner/loser pairs discriminate
      const winner=wa?a:b2, loser=wa?b2:a;
      cPairs++;
      if(+winner.radarRank<+loser.radarRank) cBetter++; else if(+winner.radarRank>+loser.radarRank) cWorse++;
    }
  });
  const bandDefs=[[95,101,'95–100'],[80,95,'80–95'],[65,80,'65–80'],[0,65,'under 65']];
  const bands=bandDefs.map(([lo,hi,label])=>({label,lo,hi,n:0,target:0,settled:0,control:0}));
  Object.keys(issues).forEach(date=>{
    ((issues[date]||{}).picks||[]).forEach(p=>{
      if(!(Number(p.targetPct)>0&&Number(p.stopPct)>0))return;
      const sc=Number(p.score); if(!Number.isFinite(sc))return;
      const b=bands.find(x=>sc>=x.lo&&sc<x.hi); if(!b)return;
      b.n++; if(p.control)b.control++;
      const st=String(p.rocketOutcome);
      if(['rocket','stopped','expired','ambiguous'].includes(st)){
        b.settled++; if(isRocketOutcome(p))b.target++;
      }
    });
  });
  bands.forEach(b=>{b.hitPct=b.settled?+(b.target/b.settled*100).toFixed(0):null;});
  const settled=tot.target+tot.stopped+tot.expired+tot.ambiguous;
  daysToTarget.sort((a,b)=>a-b);
  return {rows:rows.reverse(),                            // newest cohort first
    settled, ...tot,
    hitPct:settled?+(tot.target/settled*100).toFixed(1):null,
    stopPct:settled?+(tot.stopped/settled*100).toFixed(1):null,
    expiredPct:settled?+(tot.expired/settled*100).toFixed(1):null,
    medDaysToTarget:daysToTarget.length?median(daysToTarget):null,
    concordancePct:cPairs?+(cBetter/cPairs*100).toFixed(1):null, concordancePairs:cPairs,
    bands,
    sameDay:daysToTarget.filter(v=>v===0).length,
    nextDay:daysToTarget.filter(v=>v===1).length,
    cohorts:rows.length};
}
function median(a){
  const v=(a||[]).filter(x=>Number.isFinite(x)).sort((x,y)=>x-y);
  if(!v.length) return null;
  return v.length%2?v[(v.length-1)/2]:+(((v[v.length/2-1]+v[v.length/2])/2).toFixed(1));
}
function getDisplayedEntryCandidates(rows){
  if(!Array.isArray(rows)||!rows.length) return [];
  return rows
    // v1070: held no longer excludes a candidate.
    .filter(s=>s.symbol&&Number(s.price)>0&&s.basketEligible!==false&&!NSE_SURV[s.symbol]?.length&&s.recommendationTriggerBlocked!==true)
    .sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)||a.symbol.localeCompare(b.symbol))
    .slice(0,20);
}
const CONTROL_BANDS=[[80,95],[65,80],[50,65]];   // below the bar; the bands the scorecard reports
const CONTROL_PER_BAND=3;
function getScoreBandControlSample(rows,exclude){
  if(!Array.isArray(rows)||!rows.length) return [];
  const taken=exclude instanceof Set?exclude:new Set((exclude||[]).map(s=>s.symbol));
  const out=[];
  CONTROL_BANDS.forEach(([lo,hi])=>{
    const band=rows.filter(s=>s.symbol&&Number(s.price)>0&&s.basketEligible!==false
      &&!NSE_SURV[s.symbol]?.length&&!taken.has(s.symbol)
      &&Number(s.score)>=lo&&Number(s.score)<hi);
    // Take the TOP of each band by score: the same selection rule the cohort itself uses, so a
    // control row differs from a recommended row only in which band it fell into.
    band.sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)||a.symbol.localeCompare(b.symbol));
    band.slice(0,CONTROL_PER_BAND).forEach(s=>{out.push(s);taken.add(s.symbol);});
  });
  return out;
}
function recordDisplayedEntryCohort(scan){
  if(!scan?.date||!scan.candidates?.length) return;
  const adaptiveHorizon=getAdaptiveOutcomeHorizonDays();
  const store=FS.get(ENTRY_OUTCOME_STORE)||{horizonDays:adaptiveHorizon,cohorts:{},entries:{}};
  const outcomeFeatureOrder=getOutcomeFeatureOrderFromEngine();
  migrateOutcomeFeatureStore(store,outcomeFeatureOrder);
  store.horizonDays=adaptiveHorizon;
  const cohort=store.cohorts[scan.date]||{date:scan.date,horizonDays:adaptiveHorizon,candidates:{}};
  scan.candidates.forEach((s,i)=>{
    if(cohort.candidates[s.symbol]) return;
    cohort.candidates[s.symbol]={
      symbol:s.symbol,referencePrice:s.price,score:s.rocketScore,rank:i+1,
      kind:s._isTopUp?'topup':'fresh',heldAvg:s._heldAvg??null,heldQty:s._heldQty??null,
      features:compactOutcomeFeatures(s._features,outcomeFeatureOrder)
    };
  });
  store.cohorts[scan.date]=cohort;
  const cutoff=new Date(scan.date+'T12:00:00Z');
  cutoff.setUTCDate(cutoff.getUTCDate()-180);
  Object.keys(store.cohorts).forEach(date=>{if(date<cutoff.toISOString().slice(0,10)) delete store.cohorts[date];});
  FS.set(ENTRY_OUTCOME_STORE,store);
}
function syncExecutedRecommendedEntries(){
  const store=FS.get(ENTRY_OUTCOME_STORE);
  if(!store?.cohorts) return;
  const outcomeFeatureOrder=getOutcomeFeatureOrderFromEngine();
  migrateOutcomeFeatureStore(store,outcomeFeatureOrder);
  if(!store.entries) store.entries={};
  const fills={};
  const add=(date,symbol,qty,price,sourcePriority)=>{
    const candidate=store.cohorts?.[date]?.candidates?.[symbol];
    if(!candidate||!(qty>0)||!(price>0)) return;
    const key=date+'|'+symbol;
    const existing=fills[key];
    if(existing&&existing.sourcePriority>sourcePriority) return;
    if(!existing||existing.sourcePriority<sourcePriority){
      fills[key]={date,symbol,qty:0,value:0,sourcePriority};
    }
    fills[key].qty+=qty;
    fills[key].value+=qty*price;
  };
  (TRADEBOOK_BUY_FILLS||[]).forEach(t=>add(t.date,t.symbol,t.qty,t.price,2));
  // Orders.csv is the current-session execution truth and replaces any partial same-day tradebook slice.
  (ORDERS_TODAY||[]).filter(o=>o.type==='BUY').forEach(o=>add(normOrderDate(o.time),o.symbol,o.qty,o.price,3));
  let changed=false;
  Object.values(fills).forEach(fill=>{
    const candidate=store.cohorts[fill.date].candidates[fill.symbol];
    const id=fill.date+'|'+fill.symbol;
    const avgBuy=fill.value/fill.qty;
    const existing=store.entries[id];
    if(existing&&existing.qty===fill.qty&&Math.abs(existing.buyPrice-avgBuy)<0.001) return;
    store.entries[id]={
      ...(existing||{}),id,symbol:fill.symbol,issueDate:fill.date,
      kind:candidate.kind||'fresh',qty:fill.qty,buyPrice:+avgBuy.toFixed(4),
      capital:+fill.value.toFixed(2),referencePrice:candidate.referencePrice,
      score:candidate.score,rank:candidate.rank,features:compactOutcomeFeatures(candidate.features,outcomeFeatureOrder),
      horizonDays:existing?.horizonDays||store.cohorts[fill.date]?.horizonDays||getAdaptiveOutcomeHorizonDays(),
      observations:existing?.observations||0,evaluatedThrough:existing?.evaluatedThrough||null,
      bestNetHighPct:existing?.bestNetHighPct??null,bestNetClosePct:existing?.bestNetClosePct??null,
      maxAdversePct:existing?.maxAdversePct??null,
      bestHighDays:existing?.bestHighDays??null,bestVelocityPctPerDay:existing?.bestVelocityPctPerDay??null,
      bestVelocityDays:existing?.bestVelocityDays??null,
      complete:existing?.complete||false
    };
    changed=true;
  });
  if(changed) FS.set(ENTRY_OUTCOME_STORE,store);
}
function estimatedEntryNetPct(entry,exitPrice){
  if(!(entry?.buyPrice>0)||!(entry?.qty>0)||!(exitPrice>0)) return null;
  const capital=entry.buyPrice*entry.qty;
  const charges=calcZerodhaCharges(entry.buyPrice,entry.qty,false,false,false)+calcZerodhaCharges(exitPrice,entry.qty,true,false,false);
  return capital>0?(((exitPrice-entry.buyPrice)*entry.qty-charges)/capital)*100:null;
}
function assessExecutedEntryOutcomeScan(scan){
  if(!scan?.date||!scan.rows?.length) return;
  syncExecutedRecommendedEntries();
  try{recordTradeTimingEntryContext();}catch(e){console.warn('Trade timing context capture failed',e);}
  const store=FS.get(ENTRY_OUTCOME_STORE);
  if(!store?.entries) return;
  const rowMap=Object.fromEntries(scan.rows.map(r=>[r.symbol,r]));
  let changed=false;
  Object.values(store.entries).forEach(entry=>{
    const horizon=Math.max(1,entry.horizonDays||store.horizonDays||getAdaptiveOutcomeHorizonDays());
    entry.horizonDays=horizon;
    const gap=tradingDaysBetween(entry.issueDate,scan.date);
    if(gap==null) return;
    if(gap>horizon){entry.complete=true;changed=true;return;}
    const row=rowMap[entry.symbol];
    if(!row) return;
    const entryRef=Number(entry.referencePrice||entry.buyPrice);
    if(entryRef>0&&row.low1d>0){
      let lowForEntry=null;
      if(gap>0){
        lowForEntry=row.low1d;                        // whole bar is after the trade
      } else if(gap===0){
        const base=getBuyContextBaseline(entry.symbol,scan.date);
        if(base&&base.low>0){
          if(row.low1d<base.low-1e-9) lowForEntry=row.low1d;   // a NEW low after the buy
        } else {
          entry.entryDayAdverseUnattributable=true;   // no baseline: say so, do not measure
          changed=true;
        }
      }
      if(lowForEntry!=null){
        const adverse=Math.max(0,((entryRef-lowForEntry)/entryRef)*100);
        if(entry.maxAdversePct==null||adverse>entry.maxAdversePct){
          entry.maxAdversePct=+adverse.toFixed(2);
          entry.maxAdverseAttributed=gap>0?'later-day':'entry-day-new-low';
          changed=true;
        }
      }
    }
    if(gap<=0||entry.evaluatedThrough===scan.date) return;
    const highNet=estimatedEntryNetPct(entry,row.high1d>0?row.high1d:row.price);
    const closeNet=estimatedEntryNetPct(entry,row.price);
    entry.observations=(entry.observations||0)+1;
    entry.evaluatedThrough=scan.date;
    if(highNet!=null&&(entry.bestNetHighPct==null||highNet>entry.bestNetHighPct)){
      entry.bestNetHighPct=+highNet.toFixed(2);
      entry.bestHighDays=gap;
    }
    const velocity=highNet!=null?highNet/gap:null;
    if(velocity!=null&&(entry.bestVelocityPctPerDay==null||velocity>entry.bestVelocityPctPerDay)){
      entry.bestVelocityPctPerDay=+velocity.toFixed(3);
      entry.bestVelocityDays=gap;
    }
    if(closeNet!=null&&(entry.bestNetClosePct==null||closeNet>entry.bestNetClosePct)) entry.bestNetClosePct=+closeNet.toFixed(2);
    entry.complete=gap>=horizon;
    changed=true;
  });
  if(changed) FS.set(ENTRY_OUTCOME_STORE,store);
}
function getExecutedEntryOutcomeSummary(){
  const entries=Object.values((FS.get(ENTRY_OUTCOME_STORE)||{}).entries||{});
  const completed=entries.filter(e=>e.complete&&e.observations>0&&isFinite(e.bestVelocityPctPerDay));
  const topups=completed.filter(e=>e.kind==='topup');
  const positive=completed.filter(e=>e.bestVelocityPctPerDay>0);
  return {
    tracked:entries.length,completed:completed.length,topups:topups.length,positive:positive.length,
    avgVelocity:completed.length?+meanArr(completed.map(e=>e.bestVelocityPctPerDay)).toFixed(3):null,
    avgBestNet:completed.length?+meanArr(completed.map(e=>e.bestNetHighPct)).toFixed(2):null,
    horizonDays:getAdaptiveOutcomeHorizonDays()
  };
}
function calcExecutedEntryOutcomeScore(entry){
  const tgt=getEffectiveTgtPct()||TRADEBOOK_STATS?.adaptiveTGT||4;
  const best=entry.bestNetHighPct;
  const close=entry.bestNetClosePct;
  const velocity=entry.bestVelocityPctPerDay;
  let score=0;
  if(best!=null&&isFinite(best)) score=Math.max(score,clampNum(best/tgt,-1,0.8));
  if(close!=null&&isFinite(close)){
    score=(score*0.7)+(clampNum(close/tgt,-1,1)*0.3);
    if(close<0&&(best==null||best<tgt*0.35)) score=Math.min(score,clampNum(close/(tgt*0.5),-1,-0.05));
  }
  if(velocity!=null&&isFinite(velocity)) score+=clampNum(velocity/tgt,-0.25,0.25);
  return +clampNum(score,-1,1).toFixed(3);
}
function getClosedSaleCohorts(trips){
  const cohorts={};
  (trips||[]).forEach(trip=>{
    if(!trip?.sym||!trip.sellDate||!(trip.qty>0)||!(trip.buyPrice>0)||!(trip.sellPrice>0)) return;
    const key=trip.sellDate+'|'+trip.sym;
    if(!cohorts[key]) cohorts[key]={key,symbol:trip.sym,sellDate:trip.sellDate,qty:0,buyValue:0,sellValue:0,netPnl:0};
    const cohort=cohorts[key];
    cohort.qty+=trip.qty;
    cohort.buyValue+=trip.buyPrice*trip.qty;
    cohort.sellValue+=trip.sellPrice*trip.qty;
    cohort.netPnl+=isFinite(trip.netPnl)?trip.netPnl:(trip.sellPrice-trip.buyPrice)*trip.qty;
  });
  return Object.values(cohorts).map(cohort=>({
    ...cohort,
    avgBuy:cohort.qty>0?cohort.buyValue/cohort.qty:0,
    avgSell:cohort.qty>0?cohort.sellValue/cohort.qty:0,
    realisedPnlPct:cohort.buyValue>0?(cohort.netPnl/cohort.buyValue)*100:null,
  }));
}
function recordSameDayExitOpportunity(scan){
  if(!scan?.date||!scan.rows?.length) return;
  const sourceDate=scan.sourceDate||scan.date;
  const tradebookCohorts=Object.fromEntries(getClosedSaleCohorts(TRADEBOOK_STATS?.tripsData||[]).map(cohort=>[cohort.key,cohort]));
  const orderSession=getLatestOrderSession();
  const orderCohorts={};
  if(orderSession?.date===sourceDate){
    orderSession.orders.filter(order=>order.type==='SELL'&&order.qty>0&&order.price>0).forEach(order=>{
      const key=sourceDate+'|'+order.symbol;
      if(!orderCohorts[key]) orderCohorts[key]={key,symbol:order.symbol,sellDate:sourceDate,qty:0,sellValue:0};
      orderCohorts[key].qty+=order.qty;
      orderCohorts[key].sellValue+=order.price*order.qty;
    });
  }
  const candidates={...orderCohorts};
  Object.values(tradebookCohorts).filter(cohort=>cohort.sellDate===sourceDate).forEach(cohort=>{candidates[cohort.key]=cohort;});
  if(!Object.keys(candidates).length) return;
  const rowMap=Object.fromEntries(scan.rows.map(row=>[row.symbol,row]));
  const store=FS.get(SAME_DAY_EXIT_OPPORTUNITY_STORE)||{version:3,entries:{}};
  if(!store.entries||typeof store.entries!=='object') store.entries={};
  Object.values(candidates).forEach(candidate=>{
    const row=rowMap[candidate.symbol];
    const high=row?(row.high1d>0?row.high1d:row.price):null;
    const avgSell=candidate.qty>0?candidate.sellValue/candidate.qty:0;
    if(!(high>0)||!(avgSell>0)) return;
    const matched=tradebookCohorts[candidate.key];
    const prior=store.entries[candidate.key]||{};
    const dayHigh=Math.max(prior.dayHigh||0,high);
    store.entries[candidate.key]={
      symbol:candidate.symbol,sellDate:sourceDate,qty:candidate.qty,
      avgBuy:matched?.avgBuy>0?+matched.avgBuy.toFixed(2):(prior.avgBuy??null),
      avgSell:+avgSell.toFixed(2),sellValue:+candidate.sellValue.toFixed(2),
      realisedPnlPct:matched?.realisedPnlPct==null?(prior.realisedPnlPct??null):+matched.realisedPnlPct.toFixed(2),
      dayHigh:+dayHigh.toFixed(2),
      missedGainPct:+Math.max(0,((dayHigh-avgSell)/avgSell)*100).toFixed(2),
      source:matched?'tradebook':'orders',lastUpdated:new Date().toISOString(),
    };
  });
  store.lastUpdated=new Date().toISOString();
  FS.set(SAME_DAY_EXIT_OPPORTUNITY_STORE,store);
}
function reconcileSameDayExitOpportunities(){
  if(!TRADEBOOK_STATS?.tripsData?.length) return;
  const store=FS.get(SAME_DAY_EXIT_OPPORTUNITY_STORE);
  if(!store?.entries) return;
  const cohorts=Object.fromEntries(getClosedSaleCohorts(TRADEBOOK_STATS.tripsData).map(cohort=>[cohort.key,cohort]));
  let changed=false;
  Object.entries(store.entries).forEach(([key,entry])=>{
    const cohort=cohorts[key];
    if(!cohort||!(entry.dayHigh>0)) return;
    const avgSell=cohort.avgSell;
    store.entries[key]={...entry,
      qty:cohort.qty,avgBuy:+cohort.avgBuy.toFixed(2),avgSell:+avgSell.toFixed(2),
      sellValue:+cohort.sellValue.toFixed(2),realisedPnlPct:cohort.realisedPnlPct==null?null:+cohort.realisedPnlPct.toFixed(2),
      missedGainPct:+Math.max(0,((entry.dayHigh-avgSell)/avgSell)*100).toFixed(2),source:'tradebook',
    };
    changed=true;
  });
  if(changed){store.lastUpdated=new Date().toISOString();FS.set(SAME_DAY_EXIT_OPPORTUNITY_STORE,store);}
}
function refreshExitPolicyFromFeedback(stats){
  if(!stats?.tripsData?.length) return stats;
  const existing=stats.exitPolicy||{};
  const baselineSL=existing.baselineSL??roundPct05(Math.abs(stats.medianLossPct||stats.adaptiveSL||3.5));
  const baselineTGT=existing.baselineTGT??roundPct05(Math.abs(stats.medianWinPct||stats.adaptiveTGT||3.7));
  const adaptiveTrips=getAdaptiveTradeTrips(stats.tripsData);
  stats.exitPolicy=deriveProfitVelocityPolicy(adaptiveTrips.length?adaptiveTrips:stats.tripsData,baselineSL,baselineTGT);
  stats.adaptiveSL=capSLDistancePct(stats.exitPolicy.slPct);
  stats.adaptiveTGT=stats.exitPolicy.tgtPct;
  stats.holdLimitDays=stats.exitPolicy.holdDays;
  return stats;
}
function detectNSE(filename,content){
  const raw=String(filename||'').toLowerCase();
  const fn=normaliseInputFilename(filename);
  if(/^c_var1_\d{8}_6\.dat$/i.test(raw)){parseVarEod(content);return'var_eod';}
  if(raw.includes('eq_band_changes')){parseNextBandChanges(content,raw);return'band_change';}
  if(/^nse_cm_security_\d{8}\.csv\.gz$/i.test(raw)){parseSecurityMaster(content);return'security_master';}
  if(fn.includes('bhavdata')||raw.includes('sec_bhav')){parseBhavdata(content);return'bhav';}
  if(fn.includes('sec list')||fn.includes('price band')||fn.includes('priceband')||raw.includes('sec_list')||raw.includes('price_band')){parsePriceBand(content);return'price_band';}
  if(fn.includes('52 wk')||fn.includes('high low')||raw.includes('52_wk')||raw.includes('high_low')){parse52W(content);return'52w';}
  if(fn.startsWith('reg1')||fn.includes('reg1 ind')||raw.includes('reg1_ind')){parseSurv(content);return'surv';}
  if(fn.includes('bulk')){parseDeal(content,NSE_BULK);return'bulk';}
  if(fn.includes('block')){parseDeal(content,NSE_BLOCK);return'block';}
  if(/^bc\d{6,8}\.csv$/.test(raw)){parseCorpActions(content);return null;} // PR-zip corporate actions (v552); null = no load-status pill (covered by the zip)
  if(/^bm\d{6,8}\.txt$/.test(raw)){parseBoardMeetings(content);return null;} // PR-zip board meetings (v554)
  if(/^an\d{6,8}\.txt$/.test(raw)){parseAnnouncements(content);return null;} // PR-zip announcements (v554)
  if(/^pd\d{6,8}\.csv$/.test(raw)){parsePdIndexAndNames(content);return null;} // PR-zip index OHLC + name->symbol map (v1076)
  if(/^bh\d{6,8}\.csv$/.test(raw)){parseBandHits(content);return null;}          // PR-zip price-band hits = upper circuits (v1076)
  if(/^hl\d{6,8}\.csv$/.test(raw)){parseNewHighLow(content);return null;}        // PR-zip NEW 52-week highs/lows (v1076)
  if(/^gl\d{6,8}\.csv$/.test(raw)){parseIndexGroups(content);return null;}       // PR-zip index membership (v1076)
  if(/^ma\d{6,8}\.csv$/.test(raw)){parseMarketActivity(content);return'market';} // Market Activity Report (v556)
  if(fn.includes('nse holidays')){parseNSEHolidays(content);return'holidays';}
  return null;
}

// ── Stats ──
function mean(a){return a.length?a.reduce((s,v)=>s+v,0)/a.length:0;}
function previousTradingSessionDate(dateText){
  if(!dateText) return null;
  const date=new Date(dateText+'T12:00:00Z');
  if(Number.isNaN(date.getTime())) return null;
  do{
    date.setUTCDate(date.getUTCDate()-1);
    const dow=date.getUTCDay();
    const key=date.toISOString().slice(0,10);
    if(dow!==0&&dow!==6&&!NSE_HOLIDAYS.has(key)) return key;
  }while(true);
}

const RADAR_GROUPS={
  participation:{label:'Participation',budget:20,desc:'Relative volume, money flow and turnover impulse'},
  momentum:{label:'Momentum',budget:20,desc:'ROC, oscillators and multi-timeframe thrust'},
  trend:{label:'Trend',budget:18,desc:'MA, DMI/ADX, Aroon and Ichimoku alignment'},
  structure:{label:'Structure',budget:17,desc:'Gap, range, bands, channels and pivots'},
  liquidity:{label:'Liquidity',budget:12,desc:'Turnover, volume, market cap and tradability'},
  volatility:{label:'Volatility',budget:8,desc:'ATR and range expansion without chaos'},
  context:{label:'Context',budget:5,desc:'Sector-relative regime and fundamentals'}
};
const RADAR_RATING={'strong sell':-2,'sell':-1,'neutral':0,'buy':1,'strong buy':2};
// Columns that are EXPORTED but deliberately NOT modelled as features. Exporting and scoring are
// separate decisions: the data stays available for derived signals and future use, it simply does
// not earn a feature weight of its own. Never remove these from the TradingView export (v1071).
const RADAR_EXCLUDED_FEATURES=new Set([
  // Static share count is only a size proxy (already covered by Market cap); R2's real signal is a
  // buyback event, which arrives statelessly via the bc corporate action, not a share-count delta.
  'Total common shares outstanding',
  'Open, 1 day',
  'Average volume, 30 days','Average volume, 60 days','Average volume, 90 days',
  'Beta, 1 year'
]);
const RADAR_LIQ_STEPS=[0,5e5,25e5,1e7,5e7,1e8,1e9,1e10];
const RADAR_LIQ_LABELS=['Any','₹5L','₹25L','₹1Cr','₹5Cr','₹10Cr','₹100Cr','₹1000Cr'];
const radarNum=v=>{if(v===null||v===undefined||v==='')return null;const x=Number(String(v).replace(/[,%₹\s]/g,''));return Number.isFinite(x)?x:null;};
const clamp01=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
function radarIdx(headers,name){return headers.indexOf(name);}
function radarPct(sorted,x){
  if(x===null||!sorted.length)return null;
  let lo=0,hi=sorted.length;
  while(lo<hi){const m=(lo+hi)>>1;if(sorted[m]<x)lo=m+1;else hi=m;}
  const lower=lo;
  hi=sorted.length;
  while(lo<hi){const m=(lo+hi)>>1;if(sorted[m]<=x)lo=m+1;else hi=m;}
  return clamp01((lower+lo)/(2*sorted.length));
}
function radarQuant(a,p){if(!a.length)return null;const z=(a.length-1)*p,l=Math.floor(z),f=z-l;return a[l]+(a[Math.min(a.length-1,l+1)]-a[l])*f;}
function radarGroupFor(h){
  const s=h.toLowerCase();
  // Multi-timeframe Performance % (v552, WS1/R1): short legs to Momentum, medium/long to Trend.
  // Anchored ^performance so "Market capitalization performance %, 1 week" stays in Liquidity.
  if(/^performance %, (1 week|1 month)$/.test(s))return'momentum';
  if(/^performance %, (3 months|6 months|year to date|1 year)$/.test(s))return'trend';
  if(/relative volume|volume change|money flow|chaikin|bull bear power|volume-weighted/.test(s))return'participation';
  if(/rate of change|momentum|relative strength|stochastic|commodity channel|awesome oscillator|moving average convergence|ultimate oscillator/.test(s))return'momentum';
  if(/moving average|aroon|directional|ichimoku|parabolic sar|technical rating|oscillators rating/.test(s))return'trend';
  if(/gap|high|low|open|bollinger|donchian|keltner|pivot|price change|average daily range/.test(s))return'structure';
  if(/turnover|volume|market capitalization|shareholder|price to earnings|average volume|free float/.test(s))return'liquidity';
  if(/volatility|average true range/.test(s))return'volatility';
  return'context';
}
function radarIsPriceLevel(h){
  return /moving average|bollinger|donchian|keltner|pivot points|ichimoku|parabolic sar|volume-weighted average price|volume-weighted moving average|hull moving average|high,|low,|open,/.test(h.toLowerCase())&&!/percentage|%/.test(h);
}
function radarIsSessionLevel(h){
  const s=String(h||'').trim().toLowerCase();
  return /volume-weighted average price/.test(s)||/^(high|low|open), 1 day$/.test(s);
}
function radarTransformed(raw,f,priceI,openI=-1){
  const rv=raw[f.i];
  if(f.rating)return RADAR_RATING[String(rv).toLowerCase()]??null;
  let x=radarNum(rv);
  if(x===null)return null;
  if(radarIsPriceLevel(f.name)){
    const p=radarNum(raw[priceI]);
    if(radarIsSessionLevel(f.name)){if(p&&x)return 100*(p/x-1);}
    else{
      const o=openI>=0?radarNum(raw[openI]):null;
      const ref=(o!==null&&o>0)?o:p;
      if(ref&&x)return 100*(ref/x-1);
    }
  }
  if(/volume|turnover|market capitalization|shareholder/.test(f.name.toLowerCase()))return Math.sign(x)*Math.log1p(Math.abs(x));
  if(f.name==='Price to earnings ratio')return Math.sign(x)*Math.log1p(Math.abs(x));
  if(f.name==='Price')return Math.log1p(Math.max(0,x));
  return x;
}
function getContinuationSignal(raw,targetI,priceHourI,price15I,price5I,relI,relAtI,volChgI){
  const day=radarNum(raw[targetI])||0;
  const vals=[priceHourI>=0?radarNum(raw[priceHourI]):null,price15I>=0?radarNum(raw[price15I]):null,price5I>=0?radarNum(raw[price5I]):null].filter(v=>v!==null);
  const positive=vals.filter(v=>v>0).length;
  const negative=vals.filter(v=>v<0).length;
  const relvol=radarNum(raw[relI])||0;
  const relAt=radarNum(raw[relAtI])||0;
  const volChg=radarNum(raw[volChgI])||0;
  const participationReady=(relvol>=1.2)||(relAt>=1.5)||(volChg>=20);
  const dayStrength=day>=8?0.45:day>=3?0.25:0;
  const intradayStrength=vals.length?positive/vals.length*0.45:0;
  const participationStrength=participationReady?0.30:0;
  const reversalPenalty=vals.length?negative/vals.length*0.40:0;
  return clamp01(dayStrength+intradayStrength+participationStrength-reversalPenalty,-1,1);
}
function getPeakEntryTiming(row){
  const price=Number(row?.price),high=Number(row?.high1d),low=Number(row?.low1d);
  const expectedRangePct=Number(row?.rangePct),day=Number(row?.day);
  if(!(price>0)||!(high>low)||!(expectedRangePct>0)||!isFinite(day)){
    return {blocked:false,rangeLocation:null,rangeUsed:null,headroomPct:null,pullbackPrice:null,reason:''};
  }
  const rangeLocation=clamp01((price-low)/(high-low),0,1);
  const rangeUsed=Math.max(0,day)/expectedRangePct;
  const headroomPct=Math.max(0,(high-price)/price*100);
  const atPeak=rangeLocation>=.75;
  const rangeConsumed=rangeUsed>=.75;
  const p5=row?.price5m,p15=row?.price15m;
  const p5Known=p5!=null&&isFinite(Number(p5)),p15Known=p15!=null&&isFinite(Number(p15));
  const cooling=(p5Known&&Number(p5)<=0)||(p15Known&&Number(p15)<=0);
  const bollUpper=row?.bollUpper,keltUpper=row?.keltUpper;
  const bandsKnown=bollUpper!=null&&keltUpper!=null&&isFinite(Number(bollUpper))&&isFinite(Number(keltUpper))&&Number(bollUpper)>0&&Number(keltUpper)>0;
  const bandExtended=bandsKnown&&price>Number(bollUpper)&&price>Number(keltUpper);
  const vwap=Number(row?.vwap),vwapKnown=vwap>0&&isFinite(vwap);
  const belowVwap=vwapKnown&&price<vwap;
  const highBrokeEnvelope=bandsKnown&&high>Math.min(Number(bollUpper),Number(keltUpper));
  const gapKnown=row?.gapSigned!=null&&isFinite(Number(row.gapSigned));
  const changeOpenKnown=row?.changeOpen!=null&&isFinite(Number(row.changeOpen));
  const gapSigned=gapKnown?Number(row.gapSigned):null;
  const changeOpen=changeOpenKnown?Number(row.changeOpen):null;
  const gapLedFade=gapSigned>0&&changeOpenKnown&&gapSigned>Math.max(0,changeOpen)&&cooling&&(bandExtended||belowVwap);
  // A breakout does not become safe merely because it has already fallen away from its peak.
  // Once the session high cleared an upper envelope, cooling below VWAP is rejection/distribution,
  // independent of where the current price now sits inside the expanding session range.
  const failedBreakout=highBrokeEnvelope&&belowVwap&&cooling;
  const peakBlocked=atPeak&&(rangeConsumed||cooling||bandExtended);
  const blocked=peakBlocked||gapLedFade||failedBreakout;
  const pullbackPrice=peakBlocked?high-(high-low)*.25:null;
  const why=[];
  if(rangeConsumed)why.push('expected range consumed');
  if(cooling)why.push('5m/15m confirmation lost');
  if(bandExtended)why.push('above both Bollinger and Keltner upper bands');
  const reason=gapLedFade
    ?`gap-led fade: opening gap outweighs post-open drift, 5m/15m confirmation lost, ${belowVwap?'price is below VWAP':'price remains above both upper envelopes'}`
    :failedBreakout
      ?'failed breakout: session high cleared an upper envelope, but price is now below VWAP with 5m/15m confirmation lost'
    :peakBlocked?'upper-quarter peak: '+why.join(', '):'';
  return {
    blocked,
    rangeLocation:+(rangeLocation*100).toFixed(1),
    rangeUsed:+(rangeUsed*100).toFixed(1),
    headroomPct:+headroomPct.toFixed(2),
    pullbackPrice:pullbackPrice>0?+tickPrice(pullbackPrice).toFixed(2):null,
    cooling,bandExtended,belowVwap,highBrokeEnvelope,gapLedFade,failedBreakout,
    action:(gapLedFade||failedBreakout)?'wait for post-open confirmation':peakBlocked?'wait for pullback':'',
    reason
  };
}
function getMarketAlignedEntryTiming(row,marketIntraday=MARKET_INTRADAY){
  const local=row?.entryTiming&&row.entryTiming._local===true?row.entryTiming:getPeakEntryTiming(row);
  const marketWeak=marketIntraday?.advPct!=null&&Number(marketIntraday.advPct)<.5;
  const vwap=Number(row?.vwap),price=Number(row?.price),changeOpen=Number(row?.changeOpen);
  const stockConfirmed=vwap>0&&price>=vwap&&changeOpen>0;
  const weakMarketBlocked=marketWeak&&!stockConfirmed;
  const blocked=!!local.blocked||weakMarketBlocked;
  const stageNote=row?.stage===6?' for an established-leg breakout':'';
  const reason=local.reason||(weakMarketBlocked
    ?`broad market is weak (${(Number(marketIntraday.advPct)*100).toFixed(0)}% above open); this stock has not confirmed above VWAP, above its open, and on completed positive 5m/15m tape${stageNote}`
    :'');
  return {
    ...local,_local:false,blocked,marketWeak,stockConfirmed,weakMarketBlocked,
    action:local.action||(weakMarketBlocked?'wait for stock + market confirmation':''),
    reason
  };
}
function radarPrior(feature,p){
  const s=feature.name.toLowerCase();
  if(p===null)return null;
  if(/negative|aroon.*down|free float/.test(s))return 1-2*p;
  if(/relative strength|stochastic|money flow|commodity channel|ultimate oscillator/.test(s))return clamp01(1-Math.abs(p-.68)/.68,0,1)*2-1;
  if(/volatility|true range|daily range/.test(s))return clamp01(1-Math.abs(p-.64)/.64,0,1)*2-1;
  if(/gap|price change/.test(s))return clamp01(1-Math.abs(p-.72)/.72,0,1)*2-1;
  if(s==='price to earnings ratio')return 0;
  return 2*p-1;
}
const RADAR_SCORE_BANDS=[
  {min:80,color:'var(--green)',range:'80–100',note:'strongest relative continuation setup.'},
  {min:65,color:'var(--amber)',range:'65–79.9',note:'watchlist; confirmation required.'},
  {min:50,color:'var(--cyan)',range:'50–64.9',note:'mixed evidence.'},
  {min:-Infinity,color:'var(--red)',range:'Below 50',note:'weak under this model.'}
];
function radarScoreColor(score){
  const s=Number(score);
  if(score===null||score===undefined||!isFinite(s)) return 'var(--t3)';
  return RADAR_SCORE_BANDS.find(b=>s>=b.min).color;
}
const RECOMMEND_MIN_SCORE=95;
const RECOMMEND_MAX_RANK=10;    // owner-set depth bar: the top ten of the cross-section, by rank
function meetsScoreBar(score){const s=Number(score);return isFinite(s)&&s>=RECOMMEND_MIN_SCORE;}
const isGreenScore=meetsScoreBar;   // legacy alias - do not use in new code
function buildMarketTimingWindows(){
  const W={};
  let n=0;
  for(const sym in INTRADAY_BARS){
    const bars=INTRADAY_BARS[sym]; if(!bars||bars.length<12) continue;
    const byDay={};
    bars.forEach(b=>{const k=istDayKey(b.t);(byDay[k]??=[]).push(b);});
    for(const day in byDay){
      const b=byDay[day]; if(b.length<12) continue;
      const vols=b.map(x=>Number(x.v)||0).slice().sort((x,y)=>x-y);
      const medV=vols[Math.floor(vols.length/2)];
      if(!(medV>0)) continue;
      for(let i=0;i<b.length-6;i++){
        const x=b[i];
        if(!(x.c>x.o&&(Number(x.v)||0)>medV)) continue;   // an ignition bar, in its own session's terms
        const fwd=b[i+6].c/x.c-1;
        const dt=new Date(x.t);
        const mins=dt.getHours()*60+dt.getMinutes();
        const key=String(Math.floor(mins/30)*30);
        const g=(W[key]??={key,n:0,hit:0});
        g.n++; if(fwd>0) g.hit++; n++;
      }
    }
  }
  const keys=Object.keys(W);
  if(!keys.length) return {windows:[],graded:0,base:null};
  const hits=keys.reduce((t,k)=>t+W[k].hit,0);
  const base=hits/n;
  const k0=n/keys.length;                                  // the mean window size IS the prior weight
  keys.forEach(k=>{const g=W[k];
    g.rate=g.hit/g.n;
    g.shrunk=(g.n*g.rate+k0*base)/(g.n+k0);});
  const shr=keys.map(k=>W[k].shrunk);
  const spread=Math.max(...shr)-Math.min(...shr);
  keys.forEach(k=>{const g=W[k];
    g.peerRank=spread>0?Math.max(0,Math.min(1,0.5+(g.shrunk-base)/(2*spread))):0.5;});
  return {windows:keys.map(k=>W[k]),graded:n,base};
}
let _mktWinMemo=null;
function getMarketTimingWindows(){
  const sig=Object.keys(INTRADAY_BARS).length+'|'+
    Object.keys(INTRADAY_BARS).reduce((t,k)=>t+(INTRADAY_BARS[k]?INTRADAY_BARS[k].length:0),0);
  if(_mktWinMemo&&_mktWinMemo.sig===sig) return _mktWinMemo.v;
  const v=buildMarketTimingWindows(); _mktWinMemo={sig,v}; return v;
}
function getTimingDepth(){
  try{
    const m=getMarketTimingWindows();
    if(!m.windows.length) return {depth:RECOMMEND_MAX_RANK,peer:null,window:null,graded:0,
      why:'no 5-minute inventory yet - depth is the default'};
    const c=istClock();
    if(!c||!Number.isFinite(c.mins)) return {depth:RECOMMEND_MAX_RANK,peer:null,window:null,why:'no clock'};
    const key=String(Math.floor(c.mins/30)*30);
    const g=m.windows.find(x=>x.key===key);
    const hh=Math.floor(+key/60),mm=+key%60;
    const label=String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0');
    if(!g) return {depth:RECOMMEND_MAX_RANK,peer:null,window:label,graded:m.graded,
      why:'this half-hour has no graded bars yet'};
    const depth=Math.max(1,Math.min(RECOMMEND_MAX_RANK*2,Math.round(RECOMMEND_MAX_RANK*2*g.peerRank)));
    return {depth,peer:g.peerRank,window:label,graded:m.graded,n:g.n,raw:g.rate,base:m.base,
      why:'ignitions in this half-hour held 30 minutes later '+(100*g.rate).toFixed(0)+'% of the time over '
        +g.n+' bars (pooled '+(100*m.base).toFixed(0)+'%), shrunk to '+g.peerRank.toFixed(3)};
  }catch(e){ return {depth:RECOMMEND_MAX_RANK,peer:null,window:null,why:'timing model unavailable'}; }
}
let _timingDepthMemo=null;
function timingDepth(){
  const c=istClock(); const k=c&&Number.isFinite(c.mins)?Math.floor(c.mins/30):-1;
  // The memo carries the EVIDENCE SIZE, not just the half-hour: the first call happens during the
  // initial render before any inventory is loaded, and a bare clock key cached "no inventory" and
  // served it for the rest of the half hour.
  const n=(()=>{try{return getMarketTimingWindows().graded||0;}catch(e){return 0;}})();
  if(_timingDepthMemo&&_timingDepthMemo.k===k&&_timingDepthMemo.n===n) return _timingDepthMemo.v;
  const v=getTimingDepth(); _timingDepthMemo={k,n,v}; return v;
}
function meetsRecommendationBar(s){
  if(!s) return false;
  if(s.recommendationTriggerBlocked===true)return false;
  if(s.noHistory===true) return false;   // v1170: no multi-day history, so nothing to rank it on
  if(s.intradaySellingToday===true) return false;
  const rank=Number(s.rank);
  return isGreenScore(s.score)&&Number.isFinite(rank)&&rank<=timingDepth().depth;
}
function passesIntradayValidation(s){
  if(!s?.symbol||s.intradayVerdict!=='confirmed') return false;
  const read=getIntradayRead(s.symbol);
  return !!(read&&read.current);
}
// Score number + proportional bar, both tinted by the band.
function radarScoreCell(score,title=''){
  const s=Number(score);
  if(score===null||score===undefined||!isFinite(s)) return '<span class="sc-m" style="color:var(--t3)">—</span>';
  const c=radarScoreColor(s);
  const ok=meetsScoreBar(s);
  const tip=title||(ok?`Clears the buy bar (${RECOMMEND_MIN_SCORE}).`
    :`Below the buy bar — scores ${s.toFixed(1)} against ${RECOMMEND_MIN_SCORE} needed to be recommended. Green starts at 80, which is the band, not the bar.`);
  return `<span class="sc-m" style="color:${c}" title="${escHtml(tip)}">${s.toFixed(1)}${ok?'':'<sub style="font-size:9px;color:var(--t3)">\u25be</sub>'}</span>`
    +`<span class="score-bar" style="position:relative">`
    +`<i style="width:${Math.max(0,Math.min(100,s))}%;background:${c};opacity:${ok?1:.42}"></i>`
    +`<em style="position:absolute;left:${RECOMMEND_MIN_SCORE}%;top:0;bottom:0;width:1px;background:var(--t3);opacity:.75"></em>`
    +`</span>`;
}
function radarSetupLabel(r){
  const b=[];
  // v1068: when ignition is what earned the rank, say so first — otherwise the row reads as a
  // generic "Volume ignition" from the group part and the user cannot tell the two apart.
  if(r.igniteReady&&(r.ignitePct||0)>=.9&&(r.ignitePct||0)>=(r.compositePct||0))b.push('Ignition');
  if(r.parts.participation>=67)b.push('Volume ignition');
  if(r.parts.structure>=67)b.push('Breakout coil');
  if(r.parts.trend>=67)b.push('Trend alignment');
  if(r.parts.momentum>=67)b.push('Momentum stack');
  if(r.parts.volatility>=65&&r.parts.structure<67)b.push('Range expansion');
  return b.slice(0,2).join(' + ')||'Mixed setup';
}
// Supplements: authoritative exchange context assembled from the already-parsed NSE maps
// (sec_list price bands, bhav delivery/close/avg, REG1 series/status/flags, 52W, deals).
function buildRadarSupplements(){
  const meta={};
  const get=sym=>meta[sym]??={symbol:sym,flags:[],bulkNet:0};
  new Set([...Object.keys(NSE_PRICE_BAND),...Object.keys(NSE_NEXT_BAND)]).forEach(sym=>{const pb=getNSEBandRecord(sym),m=get(sym);m.band=pb?.bandPct??null;m.bandChange=pb?.change||null;m.bandNote=pb?.remarks||'';m.series=m.series||'EQ';});
  Object.entries(NSE_BHAV).forEach(([sym,b])=>{const m=get(sym);m.series=m.series||'EQ';m.delivery=b.delivPct;m.trades=b.trades;m.officialClose=b.officialClose;m.officialAvg=b.officialAvg;});
  Object.entries(NSE_VAR).forEach(([sym,v])=>{get(sym).nseVar=v;});
  Object.entries(NSE_SECURITY_MASTER).forEach(([sym,v])=>{const m=get(sym);m.securityMaster=v;if(!m.series&&v.series)m.series=v.series;});
  Object.entries(NSE_FUNDAMENTALS).forEach(([sym,events])=>{get(sym).fundamentalEvents=events;});
  Object.entries(NSE_SERIES).forEach(([sym,ser])=>{const m=get(sym);if(ser)m.series=ser;});
  Object.entries(NSE_STATUS).forEach(([sym,st])=>{get(sym).status=st;});
  Object.entries(NSE_52W).forEach(([sym,w])=>{const m=get(sym);m.high52=w.high52w;m.low52=w.low52w;});
  // v1117 (R11): the hl file's NEW 52-week high/low list. v1076 parsed it specifically to supply
  // "the cleared-the-high half of R11 that had n=2" and then nothing ever read it — the same
  // dead-output pattern the TSL gap model had. R11 graduated on 2026-08-10 and this is its input.
  Object.entries(getNewHighLowMap()).forEach(([sym,v])=>{const m=get(sym);m.newHL=v?.status||null;});
  // Signed net deal quantity (BUY − SELL) across bulk + block files, matching the Radar:
  // net buying earns +1.5, net selling −1.5 in the penalty layer.
  Object.entries(NSE_DEAL_NET).forEach(([sym,net])=>{get(sym).bulkNet=Number(net)||0;});
  Object.entries(SURV_ALL_HITS).forEach(([sym,hits])=>{get(sym).flags=Object.keys(hits||{});});
  // Corporate action whose ex-date is THIS session (v552, WS3): drives R5 neutralisation
  // and the R2 buyback bonus. Materiality of a dividend is decided at scoring time (needs price).
  const today=getSessionDate();
  Object.entries(NSE_CORP_ACTION).forEach(([sym,acts])=>{const t=(acts||[]).find(a=>a.exDate===today);if(t)get(sym).corpToday=t;});
  // Board-meeting calendar (bm) + today's announcements (an), v554. Drives the Event Risk flag
  // (idea #1): the score stays direction-neutral, but an event-day move is flagged as less
  // pattern-reliable, so it floors risk at Medium and annotates the detail modal.
  Object.entries(NSE_BOARD_MEETING).forEach(([sym,bm])=>{get(sym).boardMeeting=bm;});
  Object.entries(NSE_ANNOUNCE).forEach(([sym,a])=>{get(sym).announceToday=a;});
  Object.values(meta).forEach(m=>{
    const rssToday=(m.fundamentalEvents||[]).some(e=>e.dateISO===today&&e.isResults);
    m.eventToday=!!m.corpToday||!!(m.boardMeeting&&m.boardMeeting.date===today&&m.boardMeeting.isResults)||rssToday;
  });
  return meta;
}
function deriveFundamentalTrigger(row){
  const today=getSessionDate();
  const events=(row?.meta?.fundamentalEvents||[]).filter(e=>e?.isResults&&e.financial&&e.dateISO)
    .map(e=>({event:e,age:Number(tradingDaysBetween(e.dateISO,today))}))
    .filter(x=>{
      const periodEnd=String(x.event.financial?.periodEnd||'');
      const periodAge=/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)?Math.floor((new Date(today+'T12:00:00Z')-new Date(periodEnd+'T12:00:00Z'))/86400000):null;
      return Number.isFinite(x.age)&&x.age>=0&&x.age<=1&&periodAge!=null&&periodAge>=0&&periodAge<=120;
    })
    .sort((a,b)=>a.age-b.age);
  if(!events.length)return {value:0,label:null,event:null,why:'no fresh parsed financial result'};
  const event=events[0].event,f=event.financial||{};
  const nonPositive=v=>v!=null&&Number.isFinite(Number(v))&&Number(v)<=0;
  const negative=f.auditQualified===true||nonPositive(f.pat)||nonPositive(f.pbt)||nonPositive(f.operatingProfit);
  if(negative){
    const why=f.auditQualified?'qualified/adverse audit':nonPositive(f.pat)?'non-positive period profit':nonPositive(f.pbt)?'non-positive profit before tax':'non-positive operating profit';
    return {value:-1,label:'Fundamental veto candidate',event,why};
  }
  const profitable=Number(f.revenue)>0&&Number(f.pat)>0&&Number(f.pbt)>0&&Number(f.operatingProfit)>0
    &&(f.eps==null||Number(f.eps)>0);
  if(!profitable)return {value:0,label:null,event,why:'financial filing lacks a complete positive earnings set'};
  if(!row.directionConfirmed)return {value:0,label:null,event,why:'positive accounts without bullish price confirmation'};
  return {value:1,label:'Earnings + price trigger',event,
    why:`PAT ${fmtINR(f.pat)}; operating margin ${Number.isFinite(Number(f.operatingMarginPct))?Number(f.operatingMarginPct).toFixed(2)+'%':'positive'}; price above VWAP and open`};
}
let _fwdEffMemo=null;
function getForwardIndicatorEffects(){
  const iw=FS.get(INDICATOR_WATCH_STORE)||{};
  const log=iw.logShort||{},longLog=iw.log||{};
  if(_fwdEffMemo&&_fwdEffMemo.src===log&&_fwdEffMemo.longSrc===longLog) return _fwdEffMemo.map;
  const raw=[];
  Object.keys(log).forEach(name=>{
    const e=log[name];
    const arr=Array.isArray(e?.e5)?e.e5.map(Number).filter(Number.isFinite):[];
    if(arr.length<2) return;                                // a t-statistic needs at least two
    const n=arr.length, mean=arr.reduce((a,b)=>a+b,0)/n;
    const sd=Math.sqrt(arr.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(n-1));
    const t=sd>0?mean/(sd/Math.sqrt(n)):null;
    if(!(t!=null&&Math.abs(t)>=IW_T_CRIT)) return;          // not distinguishable from noise
    raw.push({name,mean:mean*(n/(n+IW_MIN_SESSIONS)),n,t});
  });
  const shortNames=new Set(raw.map(r=>r.name));
  let guardrail;
  try{guardrail=evaluateIndicatorWatch();}catch(e){guardrail=null;}
  (guardrail?.flags||[]).forEach(f=>{
    if(shortNames.has(f.name))return;
    const mean=(Number(f.e5?.mean)+Number(f.e10?.mean))/2;
    if(Number.isFinite(mean))raw.push({name:f.name,mean,n:Math.min(Number(f.e5?.n)||0,Number(f.e10?.n)||0),t:Math.min(Math.abs(Number(f.e5?.t)||0),Math.abs(Number(f.e10?.t)||0)),guardrail:true});
  });
  const peak=raw.reduce((m,r)=>Math.max(m,Math.abs(r.mean)),0);
  const map=new Map();
  if(peak>0) raw.forEach(r=>map.set(r.name,{effect:clamp01(r.mean/peak,-1,1),gap:r.mean,n:r.n,t:r.t}));
  _fwdEffMemo={src:log,longSrc:longLog,map};
  return map;
}
let INTRADAY_BARS={};        // symbol -> [{t,o,h,l,c}] most recent session last
let INTRADAY_TARGET='';      // which row the next paste belongs to (the paste carries no symbol)
let INTRADAY_RESULT=null;

function parseIntradayPaste(text,forSymbol){
  const sym=normSym(forSymbol||'');
  if(!sym) return {ok:false,why:'pick a stock in the table first'};
  const lines=String(text||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const bars=[];
  for(const ln of lines){
    if(/^"?date"?\s*,/i.test(ln)) continue;                 // header
    const cells=(ln.match(/"([^"]*)"/g)||[]).map(x=>x.slice(1,-1));
    const raw=cells.length?cells:ln.split(',').map(x=>x.trim());
    if(raw.length<5) continue;
    // TWO DATE SHAPES, because the two sources differ. The CSV download carries a full timestamp
    // ("Mon Aug 17 2026 13:10:00 GMT+0530 ..."); the on-screen ChartIQ table renders "17/08 13:10"
    // with no year. Both must land, or the bridge silently delivers nothing that parses.
    const t=(()=>{
      const raw0=String(raw[0]||'').trim();
      const dm=raw0.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\s+(\d{1,2}):(\d{2})/);
      if(dm){
        const d=+dm[1], mo=+dm[2]-1;
        let y=dm[3]?+dm[3]:new Date().getFullYear();
        if(y<100) y+=2000;
        return new Date(y,mo,d,+dm[4],+dm[5],0,0).getTime();
      }
      return Date.parse(raw0);
    })();
    const o=+String(raw[1]).replace(/,/g,''), h=+String(raw[2]).replace(/,/g,'');
    const l=+String(raw[3]).replace(/,/g,''), c=+String(raw[4]).replace(/,/g,'');
    if(!Number.isFinite(t)||!(o>0)||!(h>0)||!(l>0)||!(c>0)||h<l) continue;
    // ALL EIGHT COLUMNS, BY NAME. The export is
    //   Date, Open, High, Low, Close, % Change, % Change vs Average, Volume
    // and this parser previously took the first five and dropped the rest - including VOLUME, which
    // is the entire flow read. Every real paste silently fell back to the price-path measure and
    // nobody noticed, because the tests built bar objects by hand instead of going through here.
    // Read positionally from the END so a shorter export (no % columns) still lands its volume.
    const num=x=>{const v=Number(String(x==null?'':x).replace(/[,\s%]/g,''));return Number.isFinite(v)?v:null;};
    const bar={t,o,h,l,c};
    if(raw.length>=8){
      bar.chgPct=num(raw[5]);        // the bar's own % change, as the terminal computed it
      bar.chgVsAvg=num(raw[6]);      // its move against this stock's own average - not derivable here
      bar.v=num(raw[7]);
    }else if(raw.length>=6){
      bar.v=num(raw[raw.length-1]);  // shorter export: volume is still the last column
    }
    if(!(bar.v>=0)) delete bar.v;
    bars.push(bar);
  }
  // v1144: the summary block UNDER the chart table carries the LIVE RESTING ORDER BOOK -
  //   Volume | Avg. trade price | Total buy quantity | Total sell quantity
  // That is a direct reading of what is resting right now, and it beats every estimate in this file.
  // The pre-open book is auction inventory that was consumed at the open and then DECAYED by model
  // (v1141); this is the real thing. Observed 2026-08-17: VGUARD's live book was 116,194 buy against
  // 153,042 sell = -0.137 SELL-heavy, while the app's decayed pre-open estimate read +0.70. When the
  // two disagree, the reading wins and the estimate is discarded for that stock.
  const live=(()=>{
    const flat=String(text||'').replace(/,/g,' ');
    const m=flat.match(/Total\s+buy\s+quantity[\s\S]{0,400}?Total\s+sell\s+quantity([\s\S]{0,400})/i);
    if(!m) return null;
    // Kite prints the four labels on one row and their four values on the next, in order:
    // Volume, Avg. trade price, Total buy quantity, Total sell quantity.
    const nums=(m[1].match(/[0-9]+(?:\.[0-9]+)?/g)||[]).map(Number).filter(v=>Number.isFinite(v));
    if(nums.length<4) return null;
    const buy=nums[nums.length-2], sell=nums[nums.length-1];
    if(!(buy>0&&sell>0)) return null;
    return {buyQty:buy,sellQty:sell,imbalance:(buy-sell)/(buy+sell)};
  })();
  if(live) DEPTH_LIVE[sym]={buyQty:live.buyQty,sellQty:live.sellQty,at:Date.now(),how:'chart summary'};
  if(bars.length<5) return {ok:false,why:'found '+bars.length+' usable bars - paste the whole table including its header',live};
  bars.sort((a,b)=>a.t-b.t);
  INTRADAY_BARS[sym]=bars;
  return {ok:true,sym,bars:bars.length,sessions:new Set(bars.map(b=>istDayKey(b.t))).size,live};
}
function istDayKey(ms){
  // The pasted stamps carry their own +0530 offset, so a plain local-date read is enough here and
  // does not depend on the machine's timezone.
  const d=new Date(ms);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

// What the price path says, all of it bounded and parameter-free. Nothing here is a tunable: every
// term is a ratio of the stock's own session.
// ── v1144: THE TRAJECTORY, ON A VOLUME CLOCK ─────────────────────────────────────────────────
// Owner: *"If volume is high and price dropped in the next 5 minutes, that means it was sell heavy.
function buildIntradayTrajectory(bars,history){
  const n=bars.length;
  if(n<3) return null;
  const newSes=bars.map((b,i)=>i>0&&istDayKey(b.t)!==istDayKey(bars[i-1].t));
  const prevC=i=>newSes[i]?bars[i].o:bars[i-1].c;
  const dP=[0]; for(let i=1;i<n;i++) dP.push(bars[i].c-prevC(i));
  let _tw=0,_ts=0;
  for(let i=1;i<n;i++){const w=Number(bars[i].v)||0;_tw+=w;_ts+=w*Math.abs(dP[i]);}
  const typ=_tw>0?_ts/_tw:dP.slice(1).reduce((a,b)=>a+Math.abs(b),0)/Math.max(1,n-1);
  if(!(typ>0)) return null;
  const cvd=[],vx=[]; let run=0,cum=0,anyVol=false,lastF=0;
  for(let i=0;i<n;i++){
    const v=Number(bars[i].v)||0; if(v>0) anyVol=true;
    const locked=bars[i].h===bars[i].l;
    let f;
    if(locked){
      const d=i>0?bars[i].c-prevC(i):0;
      f=d>0?1:d<0?-1:lastF;
    }else f=Math.max(-1,Math.min(1,dP[i]/typ));
    if(f>0) lastF=1; else if(f<0) lastF=-1;
    run+=v*(i===0?0:f); cvd.push(run);
    cum+=v; vx.push(cum);
  }
  if(!anyVol||!(cum>0)) return null;      // no volume column: the price-path read stands instead
  const totV=cum;
  const wslope=(y,fromFrac)=>{
    const cut=totV*fromFrac;
    let sw=0,sx=0,sy=0,sxy=0,sxx=0;
    for(let i=0;i<n;i++){
      if(vx[i]<cut) continue;
      const w=Number(bars[i].v)||0; if(!w) continue;
      const x=vx[i]/totV;
      sw+=w; sx+=w*x; sy+=w*y[i]; sxy+=w*x*y[i]; sxx+=w*x*x;
    }
    const d=sw*sxx-sx*sx;
    return Math.abs(d)<1e-9?0:(sw*sxy-sx*sy)/d;
  };
  const price=bars.map(b=>b.c);
  const pRec=wslope(price,0.5), cRec=wslope(cvd,0.5);

  const idx=[]; for(let i=1;i<n;i++){ if(Number(bars[i].v)>0) idx.push(i); }
  const impOf=i=>Math.abs((bars[i].c-prevC(i))/prevC(i)*100)/((Number(bars[i].v)||1)/1000);
  const byVol=idx.slice().sort((x,y)=>Number(bars[y].v)-Number(bars[x].v));
  const byImp=idx.slice().sort((x,y)=>impOf(x)-impOf(y));
  const cut=Math.max(1,Math.ceil(idx.length*0.25));
  const busySet=new Set(byVol.slice(0,cut)), quietSet=new Set(byImp.slice(0,cut));
  const isAbsorb=new Array(n).fill(false);
  let absNet=0,absCount=0;
  for(const i of idx){
    if(!busySet.has(i)||!quietSet.has(i)) continue;   // must be BOTH
    const dpct=(bars[i].c-prevC(i))/prevC(i)*100;
    isAbsorb[i]=true; absNet+=(Number(bars[i].v)||0)*Math.sign(dpct); absCount++;
  }

  let mvSum=0,mvN=0,mvW=0,mvWV=0;
  for(let i=1;i<n;i++){
    const mv=Math.abs((bars[i].c-prevC(i))/prevC(i)*100);
    const v=Number(bars[i].v)||0;
    mvSum+=mv; mvN++;
    mvW+=mv*v; mvWV+=v;
  }
  const avgMovePct=mvWV>0?(mvW/mvWV):(mvN?mvSum/mvN:null);
  const _paceDay=istDayKey(bars[n-1].t);
  let _pacePeak=null,_episodeLow=null,_episodeLowAt=null;
  let _confirmedPacePct=null,_confirmedPaceAt=null,_confirmedPullbackCount=0;
  for(let i=0;i<n;i++){
    const b=bars[i];
    if(istDayKey(b.t)!==_paceDay) continue;
    if(_pacePeak==null){ _pacePeak=b.h; continue; }
    if(b.h>_pacePeak){
      if(_episodeLow!=null&&_episodeLow<_pacePeak){
        const dd=100*(_pacePeak-_episodeLow)/_pacePeak;
        _confirmedPullbackCount++;
        if(_confirmedPacePct==null||dd>_confirmedPacePct){
          _confirmedPacePct=dd; _confirmedPaceAt=_episodeLowAt;
        }
      }
      _pacePeak=b.h; _episodeLow=null; _episodeLowAt=null;
      continue;
    }
    if(b.l<_pacePeak&&(_episodeLow==null||b.l<_episodeLow)){
      _episodeLow=b.l; _episodeLowAt=b.t;
    }
  }
  const confirmedPacePct=_confirmedPacePct;
  const currentPullbackPct=(_pacePeak>0&&_episodeLow!=null)
    ?100*(_pacePeak-_episodeLow)/_pacePeak:null;
  // Compatibility alias for older diagnostics. All live Pace surfaces use the explicit confirmed
  // name below so an unresolved decline cannot accidentally regain the old meaning.
  const maxPullbackPct=confirmedPacePct;

  const upV=[],dnV=[];
  for(let i=1;i<n;i++){
    if(isAbsorb[i]) continue;
    const dpct=(bars[i].c-prevC(i))/prevC(i)*100;
    const v=Number(bars[i].v)||0; if(!v) continue;
    if(dpct>0) upV.push([v,dpct]); else if(dpct<0) dnV.push([v,-dpct]);
  }
  const agg=a=>{const V=a.reduce((x,y)=>x+y[0],0),M=a.reduce((x,y)=>x+y[1],0);return M>0?V/M:null;};
  let upCost=agg(upV), dnCost=agg(dnV);             // shares needed to move it 1%
  // If pulling absorption out has emptied a side - which happens when the only bars going one way
  // were themselves the absorbing ones - fall back to costing EVERY bar. A ratio computed from the
  // whole session is worth more than no ratio at all, and the absorption is still reported on its own.
  if(!(upCost>0)||!(dnCost>0)){
    const upAll=[],dnAll=[];
    for(let i=1;i<n;i++){
      const dpct=(bars[i].c-prevC(i))/prevC(i)*100;
      const v=Number(bars[i].v)||0; if(!v) continue;
      if(dpct>0) upAll.push([v,dpct]); else if(dpct<0) dnAll.push([v,-dpct]);
    }
    upCost=agg(upAll); dnCost=agg(dnAll);
  }
  // >1 means selling is dearer than buying: thin supply above, firm demand below.
  const costRatio=(upCost>0&&dnCost>0)?dnCost/upCost:null;   // one-sided session: no ratio to claim

  // UNSPENT PRESSURE: net directional volume over the recent half, priced at what a share currently
  // buys. Reported as a percentage of price - what the accumulated imbalance is WORTH if impact
  // holds. It is arithmetic, not a forecast, and nothing scores it.
  let netRecent=0;
  for(let i=1;i<n;i++){
    if(vx[i]<totV*0.5) continue;
    const dpct=(bars[i].c-prevC(i))/prevC(i)*100;
    netRecent+=(Number(bars[i].v)||0)*Math.sign(dpct);
  }
  const pressurePct=upCost?(netRecent/upCost):null;

  const gaps=[]; for(let i=1;i<n;i++){const g=bars[i].t-bars[i-1].t; if(g>0&&g<6*3600e3) gaps.push(g);}
  gaps.sort((a,b)=>a-b);
  const stepMs=gaps.length?gaps[Math.floor(gaps.length/2)]:300000;
  const lastT=new Date(bars[n-1].t);
  const _todayKey=istDayKey(bars[n-1].t);
  const _hist=(Array.isArray(history)&&history.length>n)?history:bars;
  let _seenMin=0;
  for(let i=0;i<_hist.length;i++){
    if(istDayKey(_hist[i].t)===_todayKey) continue;
    const _d=new Date(_hist[i].t), _m=_d.getHours()*60+_d.getMinutes();
    if(_m>_seenMin) _seenMin=_m;
  }
  const _endMin=(_seenMin+stepMs/60000>=CAS_CONTINUOUS_END_MIN)?_seenMin+stepMs/60000:SESSION_CLOSE_MIN;
  const closeT=new Date(lastT); closeT.setHours(Math.floor(_endMin/60),_endMin%60,0,0);
  const barsLeft=Math.max(0,Math.floor((closeT-lastT)/stepMs));
  const maxTravel=(avgMovePct!=null)?avgMovePct*barsLeft:null;
  const seenBars=Math.max(1,n-1);
  const evid=seenBars/(seenBars+barsLeft);
  const predRaw=(pressurePct==null)?null
    :(maxTravel==null?pressurePct:Math.max(-maxTravel,Math.min(maxTravel,pressurePct)));
  // A PROJECTION MAY NOT FIGHT THE TAPE. pressurePct measures an IMBALANCE; pRec measures whether
  // the market is CONVERTING it. When the two disagree in sign the imbalance is by definition being
  // absorbed, and an extrapolation of it points where the tape is refusing to go. Measured
  // 2026-08-21 on the owner's book: SPECTRUM carried netRecent +4,154 shares against an upCost of
  // ~154 shares - pressure +27.00%, clamped by travel to +20.44%, shrunk to EoD +10.63% - while its
  // own priceSlope was -191.1, its regime was 'absorption', it was down 5.0% on the day and 5.10%
  // off its high unrecovered. There is no honest close projection there, and a ZERO would be a
  // claim of its own, so the projection is ABSENT and the reason is reportable.
  const pressureConverting=!(predRaw!=null&&predRaw!==0&&pRec!==0&&(predRaw>0)!==(pRec>0));
  const predPct=(predRaw==null||!pressureConverting)?null:predRaw*evid;
  const predClose=(predPct==null)?null:bars[n-1].c*(1+predPct/100);
  const cvdPct=run/totV;                  // a LEVEL, so a late drift on no volume cannot erase a
                                          // morning of selling
  const agree=(pRec>=0)===(cRec>=0);
  const regime=(cvdPct>=0&&pRec>=0&&cRec>=0)?'accumulating'
             :(pRec>=0&&cRec<0)             ?'distribution into strength'
             :(pRec<0&&cRec>=0&&cvdPct>=0)  ?'absorption'
                                            :'selling';
  return {cvd,cvdNet:run,cvdPct,totV,priceSlope:pRec,flowSlope:cRec,agree,regime,
          pressureConverting,
          // Projected close at the recent pace, over the volume still expected today. Reported.
          projected:price[n-1]+pRec*(1-vx[n-1]/totV),
          avgMovePct,confirmedPacePct,confirmedPaceAt:_confirmedPaceAt,
          confirmedPullbackCount:_confirmedPullbackCount,currentPullbackPct,
          maxPullbackPct,maxPullbackAt:_confirmedPaceAt,barsLeft,stepMin:Math.round(stepMs/60000),maxTravel,predPct,predClose,
          predRaw,sessionSeen:evid,
          sessionEndMin:_endMin,
          upCost,dnCost,costRatio,absorptionNet:absNet,absorptionBars:absCount,
          netRecent,pressurePct,
          // THREE terms now, each 0.5 at "no information", so the geometric mean is 0.5 at no
          // information: net flow, recent flow direction, and which side is cheaper to move.
          // costRatio/(1+costRatio) is 0.5 at parity by construction - no constant decides it.
          standing:Math.cbrt(Math.max(0,Math.min(1,(cvdPct+1)/2))
                            *Math.max(0,Math.min(1,(cRec/totV+1)/2))
                            *(costRatio?Math.max(0,Math.min(1,costRatio/(1+costRatio))):0.5))};
}
let _thinCutMemo=null;
// costRatio is dnCost/upCost - shares to move it 1% down against 1% up - so 1.0 is parity only if
// the MARKET is at parity. Measured 2026-08-21 over 273 fetched stocks: today's median was 0.93 and
// 59% sat below 1.0, so the bare threshold called the MEDIAN stock "nothing holding it up" and
// reduced 7 of 8 open positions on it while their own net flow was positive. The cut is the day's
// own median - a cross-sectional midrank like every other magnitude in this app, not a chosen
// number. Below the scorer's own modeled-feature density floor there is no cross-section to read
// and parity is the only defensible neutral.
function getIntradayThinCut(){
  const keys=Object.keys(INTRADAY_BARS||{});
  const sig=keys.length+':'+keys.reduce((t,k)=>t+(INTRADAY_BARS[k]?INTRADAY_BARS[k].length:0),0);
  if(_thinCutMemo&&_thinCutMemo.sig===sig) return _thinCutMemo.val;
  const rs=[];
  for(const k of keys){
    let rd=null; try{ rd=getIntradayRead(k); }catch(e){}
    const t=(rd&&rd.current)?rd.todayTraj:null;
    if(t&&Number.isFinite(t.costRatio)&&t.costRatio>0) rs.push(t.costRatio);
  }
  let val=1;
  if(rs.length>=25){
    rs.sort((a,b)=>a-b);
    val=rs.length%2?rs[(rs.length-1)/2]:(rs[rs.length/2-1]+rs[rs.length/2])/2;
  }
  _thinCutMemo={sig,val,n:rs.length};
  return val;
}
// ONE WINDOW PER ROW (v1206), extended to the fetch list. Named and exported so the window it
// resolves is assertable rather than inlined in the fetch handler.
function intradayFetchListRow(sym,w){
  const rd=getIntradayRead(sym), bars=INTRADAY_BARS[normSym(sym)]||[];
  const f=bars[0]?new Date(bars[0].t):null, l=bars[bars.length-1]?new Date(bars[bars.length-1].t):null;
  const hhmm=d=>d?String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'):'—';
  const ddmm=d=>d?String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0'):'';
  const today=(rd&&rd.current)?rd.todayTraj:null;
  return {sym,bars:bars.length,file:w?w.file:null,fileRows:w?w.rows:null,
    daily:(w&&w.daily)?w.daily.sessions:null,
    from:ddmm(f)+' '+hhmm(f),to:ddmm(l)+' '+hhmm(l),
    last:rd?rd.close:null,
    regime:today?today.regime:(rd&&rd.regime||null),
    flow:today&&Number.isFinite(today.cvdPct)?today.cvdPct
        :(rd&&Number.isFinite(rd.cvdPct)?rd.cvdPct:null),
    // When today cannot be read the label is the multi-session tape, and it must SAY so rather
    // than sit under the same word beside a verdict computed on today.
    spanSessions:(!today&&rd&&rd.sessions>0)?rd.sessions:null};
}
function getIntradayRead(sym){
  const bars=INTRADAY_BARS[normSym(sym||'')];
  if(!bars||!bars.length) return null;
  const key=istDayKey(bars[bars.length-1].t);
  const day=bars.filter(b=>istDayKey(b.t)===key);
  if(bars.length<3) return null;
  const open=day[0].o, close=day[day.length-1].c;
  const hi=Math.max(...day.map(b=>b.h)), lo=Math.min(...day.map(b=>b.l));
  const first=day.slice(0,3);
  const fHi=Math.max(...first.map(b=>b.h)), fLo=Math.min(...first.map(b=>b.l));
  const f15=fHi>fLo?((first[first.length-1].c-fLo)-(fHi-first[first.length-1].c))/(fHi-fLo):0;
  // (2) PATH EFFICIENCY - net travel over gross travel. A clean trend approaches 1; chop approaches
  // 0. This is the thing ALL NSE cannot say: two stocks up the same 2% look identical in a snapshot
  // and completely different bar by bar.
  let gross=0; for(let i=1;i<day.length;i++) gross+=Math.abs(day[i].c-day[i-1].c);
  const eff=gross>0?Math.abs(close-open)/gross:0;
  // (3) WHERE PRICE SITS IN THE SESSION'S OWN RANGE, and how fresh the high is.
  const pos=hi>lo?(close-lo)/(hi-lo):0.5;
  let hiIdx=0; day.forEach((b,i)=>{if(b.h>=hi) hiIdx=i;});
  const freshness=day.length>1?hiIdx/(day.length-1):1;
  const traj=buildIntradayTrajectory(bars.length>day.length?bars:day);
  const nowKey=(typeof getSessionDate==='function')?getSessionDate():key;
  const asOf=day[day.length-1].t;
  const ageMin=Math.max(0,Math.round((Date.now()-asOf)/60000));
  const spanBars=Math.round((asOf-day[0].t)/300000)+1;      // 5-minute bars the span should hold
  const holes=Math.max(0,spanBars-day.length);
  const todayTraj=day.length>=3?buildIntradayTrajectory(day,bars):null;
  const _tv=day.reduce((n,b)=>n+(Number(b.v)||0),0);
  const _av=bars.reduce((n,b)=>n+(Number(b.v)||0),0);
  const volShare=_av>0?_tv/_av:1;
  const allSessions=[...new Set(bars.map(b=>istDayKey(b.t)))].sort();
  return {sym:normSym(sym),bars:day.length,flowBars:bars.length,sessions:allSessions.length,
          sessionList:allSessions,
          on:key,current:key===nowKey,asOf,ageMin,holes,
          open,close,hi,lo,dayPct:(close/open-1)*100,traj,
          todayTraj,volShare,
          todayStanding:todayTraj?todayTraj.standing:null,
          todayFlowPct:todayTraj?todayTraj.cvdPct:null,
          todayRegime:todayTraj?todayTraj.regime:null,
          regime:traj?traj.regime:null,cvdPct:traj?traj.cvdPct:null,
          avgMovePct:traj?traj.avgMovePct:null,
          confirmedPacePct:traj?traj.confirmedPacePct:null,
          confirmedPaceAt:traj?traj.confirmedPaceAt:null,
          confirmedPullbackCount:traj?traj.confirmedPullbackCount:0,
          currentPullbackPct:traj?traj.currentPullbackPct:null,
          maxPullbackPct:traj?traj.maxPullbackPct:null,
          predClose:todayTraj?todayTraj.predClose:null,predPct:todayTraj?todayTraj.predPct:null,
          // One object, so a surface cannot pair the projection with another window's pressure.
          eod:todayTraj&&Number.isFinite(todayTraj.predPct)?{
            pct:todayTraj.predPct,close:todayTraj.predClose,pressurePct:todayTraj.pressurePct,
            barsLeft:todayTraj.barsLeft,maxTravel:todayTraj.maxTravel,
            avgMovePct:todayTraj.avgMovePct,stepMin:todayTraj.stepMin,
            sessionSeen:todayTraj.sessionSeen}:null,
          projected:traj?traj.projected:null,
          first15:f15, first15Up:f15>0, efficiency:eff, position:pos, freshness,
          // The standing: direction confirmed by the open, travelled cleanly, and still near its
          // high. Geometric so a zero on any one of them cannot be averaged away.
          standing:traj?traj.standing:Math.cbrt(Math.max(0,(f15+1)/2)*Math.max(0,eff)*Math.max(0,pos))};
}
function applyIntradayReorder(rows){
  if(!rows||!rows.length) return 0;
  let n=0;
  for(const r of rows){
    const read=getIntradayRead(r.symbol);
    r.intraday=read||null;
    // Kept on the row so the table can SAY it is stale - but it must not move the ranking. Silently
    // dropping it would be worse: the owner would see no badge and assume the stock was never
    // checked, when in fact it was checked on a day that no longer describes it.
    if(read&&read.current) n++;
  }
  if(!n) return 0;
  const _obs=rows.map(r=>(r.intraday&&r.intraday.current&&Number.isFinite(r.intraday.standing))
      ?Math.max(0,Math.min(1,r.intraday.standing)):null).filter(v=>v!=null).sort((a,b)=>a-b);
  const NEUTRAL=_obs.length?_obs[Math.floor(_obs.length/2)]:0.5;
  rows.forEach(r=>{
    // v1168: the multi-session standing carries the row early, today's own standing carries it late,
    // and the crossover is today's share of the volume clock rather than a typed hour. Geometric, so
    // both being 0.5 at "no information" keeps the product 0.5 at no information (the v1145 rule).
    let f=NEUTRAL;
    if(r.intraday&&r.intraday.current){
      const full=Math.max(0,Math.min(1,r.intraday.standing));
      const td=Number.isFinite(r.intraday.todayStanding)?Math.max(0,Math.min(1,r.intraday.todayStanding)):null;
      const w=(td!=null&&Number.isFinite(r.intraday.volShare))?Math.max(0,Math.min(1,r.intraday.volShare)):0;
      f=(td==null||w<=0)?full:Math.pow(full,1-w)*Math.pow(td,w);
    }
    r._iAdj=Math.max(0,(Number.isFinite(r.depthBlendPct)?r.depthBlendPct:r.setupPct))*f;
  });
  const ranked=rows.filter(r=>Number.isFinite(r._iAdj)).slice().sort((a,b)=>a._iAdj-b._iAdj);
  const m=ranked.length;
  ranked.forEach((r,i)=>{r._iPct=m>1?i/(m-1):1;});
  rows.forEach(r=>{
    if(!Number.isFinite(r._iPct)) return;
    r.depthBlendPct=r._iPct;
    r.score=+(100*Math.pow(r._iPct*(r.directionConfirmed?1:0),4)).toFixed(1);
    r.rocketScore=r.score;
    delete r._iAdj; delete r._iPct;
  });
  rows.sort((a,b)=>b.score-a.score||radarRankTieBreak(a,b));
  rows.forEach((r,i)=>{r.rank=i+1;});
  // THE VERDICT (owner: "it's a validation step. If it still passes our Buy thresholds, I'll buy,
  // else not."). The re-rank is the mechanism; this is the product. A checked stock is CONFIRMED
  // only if it still clears the SAME bar the basket uses - nothing softer, nothing bespoke.
  rows.forEach(r=>{
    if(!r.intraday){r.intradayVerdict=null;r.intradayWhy=null;return;}
    const _tt=r.intraday.current?r.intraday.todayTraj:null;
    if(_tt){
      const cr=_tt.costRatio;
      const sold=_tt.cvdPct<0;
      const thin=Number.isFinite(cr)&&cr>0&&cr<getIntradayThinCut();
      if(sold||thin){
        r.intradayVerdict='rejected';
        r.intradayWhy=(sold?('being sold today - net flow '+(100*_tt.cvdPct).toFixed(1)+'% of this session')
                           :('nothing holding it up - 1% down costs '+Math.round(_tt.dnCost).toLocaleString('en-IN')
                             +' shares against '+Math.round(_tt.upCost).toLocaleString('en-IN')+' to go up (ratio '
                             +cr.toFixed(2)+' against the day’s own median '+getIntradayThinCut().toFixed(2)+')'))
          +(r.intraday.traj?' (multi-day: '+r.intraday.traj.regime+')':'');
        r.intradaySellingToday=true;
        return;
      }
    }
    r.intradaySellingToday=false;
    if(!r.intraday.current){
      r.intradayVerdict='stale';
      r.intradayWhy='checked on '+r.intraday.on+', not today — refetch before acting on it';
      return;
    }
    if(!_tt){
      r.intradayVerdict='unverified';
      r.intradayWhy='the current session has only '+r.intraday.bars+' bar'+(r.intraday.bars===1?'':'s')
        +' — under three the today-only flow cannot be computed, so nothing can veto this row yet'
        +(r.intraday.traj?' (multi-day: '+r.intraday.traj.regime+', which is NOT evidence about today)':'');
      return;
    }
    const passes=(typeof meetsRecommendationBar==='function')?meetsRecommendationBar(r):(r.score>=RECOMMEND_MIN_SCORE);
    r.intradayVerdict=passes?'confirmed':'rejected';
    const t=r.intraday.traj;
    r.intradayWhy=t
      ?`${t.regime} · net flow ${(t.cvdPct*100).toFixed(1)}% of everything traded`
      +`${t.costRatio?` · ${t.costRatio>=1?'selling':'buying'} costs ${(t.costRatio>=1?t.costRatio:1/t.costRatio).toFixed(2)}x more`
         +` (up ${Math.round(t.upCost).toLocaleString('en-IN')} sh per 1%, down ${Math.round(t.dnCost).toLocaleString('en-IN')})`:''}`
      +`${t.absorptionBars?` · ${t.absorptionBars} absorption bar${t.absorptionBars>1?'s':''}, net ${t.absorptionNet>=0?'+':''}${Math.round(t.absorptionNet).toLocaleString('en-IN')} sh`:''}`
      +`${Number.isFinite(t.pressurePct)?` · unspent pressure ${t.pressurePct>=0?'+':''}${t.pressurePct.toFixed(2)}%`:''}`
      +`${t.agree?'':' · price and flow DIVERGE'}`
      :`first 15m ${r.intraday.first15Up?'up':'down'} · path ${(r.intraday.efficiency*100).toFixed(0)}% efficient`;
  });
  return n;
}

// THE LOOP'S STATE. Which of the current top recommendations still lack intraday data, and has the
// list stopped moving? Converged means every name at the top has been checked AND survived the
// check - which is the only honest definition of "these are the recommendations".
function getIntradayLoopState(){
  const pool=(Array.isArray(FILT)&&FILT.length?FILT:ALL).slice().sort((a,b)=>a.rank-b.rank);
  const passing=pool.filter(r=>typeof meetsRecommendationBar==='function'?meetsRecommendationBar(r):true);
  const board=passing.length?passing:pool.slice(0,typeof FETCH_TOP_RANK==='number'?FETCH_TOP_RANK:5);
  const liveRead=r=>{const x=getIntradayRead(r.symbol);return (x&&x.current)?x:null;};
  const need=board.filter(r=>!liveRead(r));
  const source=board.filter(r=>liveRead(r)&&r.intradayVerdict);
  const confirmed=source.filter(r=>r.intradayVerdict==='confirmed');
  const rejected=source.filter(r=>r.intradayVerdict==='rejected');
  return {top:board,need,converged:board.length>0&&need.length===0,
          checked:board.length-need.length,of:board.length,confirmed,rejected};
}
function radarAnalyze(headers,rawRows,supplements={},heldSymbols=new Set()){
  const _depthPctMap=(typeof getDepthPctMap==='function')?getDepthPctMap():{};
  const priceI=radarIdx(headers,'Price'),targetI=radarIdx(headers,'Price change %, 1 day'),sectorI=radarIdx(headers,'Sector'),symbolI=radarIdx(headers,'Symbol'),descI=radarIdx(headers,'Description');
  if(symbolI<0||priceI<0||targetI<0)throw Error('Expected Symbol, Price, and Price change %, 1 day columns.');
  const turnI=radarIdx(headers,'Price × volume (turnover), 1 day'),relI=radarIdx(headers,'Relative volume, 1 day'),relAtI=radarIdx(headers,'Relative volume at time'),volChgI=radarIdx(headers,'Volume change %, 1 day'),gapI=radarIdx(headers,'Gap %, 1 day'),adrI=radarIdx(headers,'Average daily range %'),atrI=radarIdx(headers,'Average true range %, 14, 1 day'),atrWeekI=radarIdx(headers,'Average true range %, 14, 1 week'),volI=radarIdx(headers,'Volatility, 1 day'),highI=radarIdx(headers,'High, 1 day'),lowI=radarIdx(headers,'Low, 1 day'),openI=radarIdx(headers,'Open, 1 day'),mcapI=radarIdx(headers,'Market capitalization');
  const bollUpperI=radarIdx(headers,'Bollinger Bands, 20, 1 day, Upper'),keltUpperI=radarIdx(headers,'Keltner channels, 20, 1 day, Upper');
  const priceHourI=radarIdx(headers,'Price change %, 1 hour'),price15I=radarIdx(headers,'Price change %, 15 minutes'),price5I=radarIdx(headers,'Price change %, 5 minutes');
  const changeOpenI=radarIdx(headers,'Change from open %, 1 day'),perf1mI=radarIdx(headers,'Performance %, 1 month'),perf3mI=radarIdx(headers,'Performance %, 3 months'),perf1yI=radarIdx(headers,'Performance %, 1 year');
  const vwapI=radarIdx(headers,'Volume-weighted average price, 1 day');
  const dayVolI=radarIdx(headers,'Volume, 1 day'),avgVol60I=radarIdx(headers,'Average volume, 60 days');
  // v555 market-cycle inputs: earnings dates (stateless days-since/days-to), 50-day MA (holding-above check).
  const recentEarnI=radarIdx(headers,'Recent earnings date'),upcomingEarnI=radarIdx(headers,'Upcoming earnings date'),sma50I=radarIdx(headers,'Simple moving average, 50, 1 day');
  const weekChgI=radarIdx(headers,'Price change %, 1 week'); // v1097 pre-results drift
  // v1105 exit signal inputs - the two money-flow measures that are NOT circular with price position
  const cmfI=radarIdx(headers,'Chaikin money flow, 20, 1 day'), mfi15I=radarIdx(headers,'Money flow index, 14, 15 minutes');
  const sessionDate=getSessionDate(),reviewDays=getEffectiveReviewDays(); // reviewDays null ⇒ post-event stages/decay don't fire (graceful, no constant)
  for(let ri=0;ri<rawRows.length;ri++){
    const meta=supplements[normSym(rawRows[ri][symbolI])],ca=meta&&meta.corpToday;
    if(!ca)continue;
    const price=radarNum(rawRows[ri][priceI])||0;
    // "Material" is self-calibrating per stock: a dividend is neutralised only when its ex-date drop
    // (amount/price) exceeds the stock's own average daily range — i.e. it moves the price beyond
    // normal daily noise. Structural actions (demerger/split/bonus/rights) are always mechanical.
    const adr=adrI>=0?radarNum(rawRows[ri][adrI]):null;
    const material=ca.kind==='structural'||(ca.kind==='dividend'&&price>0&&adr!==null&&ca.divAmt/price*100>=adr);
    if(!material)continue;
    // Keep the REAL day move for DISPLAY (owner v554 — showing 0 hid the true −41% move); only the
    // SCORING inputs are blanked so the mechanical move can't pollute the percentiles or penalties.
    meta._realDay=targetI>=0?radarNum(rawRows[ri][targetI]):null;
    if(targetI>=0)rawRows[ri][targetI]='';
    if(changeOpenI>=0)rawRows[ri][changeOpenI]='';
    if(gapI>=0)rawRows[ri][gapI]='';
    meta._corpNeutralised=true;
  }
  let _radarSessionTargetPct=null;
  let _radarStretchBarUsed=null;   // v1113: the stretch bar actually used, recorded for audit
  try{const t=Number(getEffectiveTgtPct());if(t>0)_radarSessionTargetPct=t;}catch(e){}
  // v1098: resolved ONCE per scoring pass, not per row — it is a store read plus a full-universe walk.
  let _driftInfo={map:{},sessionsUsed:0,from:null,to:null};
  try{ _driftInfo=buildDriftIntoEventMap(sessionDate,PRE_RESULTS_DRIFT_SESSIONS); }catch(e){}
  const rocketRows=rawRows.map((raw,i)=>{
    const o=openI>=0?radarNum(raw[openI]):null;
    const hi=highI>=0?radarNum(raw[highI]):null;
    const lo=lowI>=0?radarNum(raw[lowI]):null;
    const atrPct=radarNum(raw[atrI]);
    if(!(o>0)||!(hi>0)||!(lo>0)) return null;
    const tgt=Number(_radarSessionTargetPct)>0?Number(_radarSessionTargetPct):null;
    const stop=atrPct>0?clampNum(SL_ATR_MULT*atrPct,SL_MIN_PCT,SL_MAX_PCT):null;
    if(!(tgt>0)||!(stop>0)) return null;
    return resolveRocketDay({high1d:hi,low1d:lo},o,tgt,stop)===ROCKET_OUTCOME.ROCKET?i:null;
  }).filter(i=>i!==null);
  const rset=new Set(rocketRows);
  const continuationSignals=rawRows.map(r=>getContinuationSignal(r,targetI,priceHourI,price15I,price5I,relI,relAtI,volChgI));
  const continuationRows=continuationSignals.map((signal,i)=>signal>=.35?i:null).filter(i=>i!==null);
  const sectorBuckets={};
  for(const r of rawRows){const s=r[sectorI]||'Unknown',v=radarNum(r[targetI]);if(v!==null)(sectorBuckets[s]??=[]).push(clamp01(v,-10,10));}
  const sectorMeans=Object.fromEntries(Object.entries(sectorBuckets).map(([s,a])=>[s,a.reduce((x,y)=>x+y,0)/a.length])),sectorSorted=Object.values(sectorMeans).sort((a,b)=>a-b);
  // Sector MEDIAN of the day move (v552, WS4/R6): the sector-relative signal below rewards a name
  // out-performing its own sector (idiosyncratic strength), damping pure sector drift.
  const sectorMedians=Object.fromEntries(Object.entries(sectorBuckets).map(([s,a])=>[s,radarQuant([...a].sort((x,y)=>x-y),.5)??0]));
  const _noHist={};
  rawRows.forEach(raw=>{
    const sym=normSym(raw[symbolI]||''); if(!sym) return;
    const a1=perf1mI>=0?radarNum(raw[perf1mI]):null;
    const a3=perf3mI>=0?radarNum(raw[perf3mI]):null;
    const ay=perf1yI>=0?radarNum(raw[perf1yI]):null;
    _noHist[sym]=(a1!=null&&a3!=null&&ay!=null&&a1===a3&&a3===ay);
  });
  const trendArr=rawRows.map(raw=>{const a=perf1mI>=0?radarNum(raw[perf1mI]):null,b=perf3mI>=0?radarNum(raw[perf3mI]):null;return(a===null||b===null)?null:a+b;});
  const trendSorted=trendArr.filter(v=>v!==null).sort((x,y)=>x-y);
  // WS4/R6: sector-relative day move per row (post-neutralisation; blanked rows are null).
  const srArr=rawRows.map(raw=>{const d=radarNum(raw[targetI]);return d===null?null:clamp01(d,-10,10)-(sectorMedians[raw[sectorI]||'Unknown']??0);});
  const minObs=Math.max(25,Math.floor(rawRows.length*.08));
  const rocketCohortTrusted=false;
  // v1135: forward-measured effects, resolved once per pass (see getForwardIndicatorEffects).
  const fwdEffects=(typeof getForwardIndicatorEffects==='function')?getForwardIndicatorEffects():new Map();
  const features=[];
  for(let i=0;i<headers.length;i++){
    const name=headers[i],rating=/rating/i.test(name);
    // v552: exclude the static share-count level from scoring — it is only a size proxy (already
    // in Market cap), and R2's real signal (a buyback) arrives statelessly via the bc event, not
    // via a cross-day share-count delta. Keep the column exported for possible future use.
    if([symbolI,descI,sectorI,targetI].includes(i)||/ - Currency$/.test(name)||RADAR_EXCLUDED_FEATURES.has(name))continue;
    const f={i,name,group:radarGroupFor(name),rating};
    let vals=[];
    for(let ri=0;ri<rawRows.length;ri++){const v=radarTransformed(rawRows[ri],f,priceI,openI);if(v!==null)vals.push(v);}
    vals.sort((a,b)=>a-b);
    if(vals.length<minObs||vals[0]===vals[vals.length-1])continue;
    const tailFeature=f.group==='participation';
    const q02=radarQuant(vals,.02),q98=tailFeature?vals[vals.length-1]:radarQuant(vals,.98);
    const wins=vals.map(v=>clamp01(v,q02,q98)).sort((a,b)=>a-b);
    f.sorted=wins;f.lo=q02;f.hi=q98;f.coverage=vals.length/rawRows.length;
    let ar=[],ao=[];
    for(let ri=0;ri<rawRows.length;ri++){
      let v=radarTransformed(rawRows[ri],f,priceI,openI);
      if(v===null)continue;
      const p=radarPct(wins,clamp01(v,q02,q98));
      (rset.has(ri)?ar:ao).push(p);
    }
    const mr=ar.length?ar.reduce((a,b)=>a+b,0)/ar.length:.5,mo=ao.length?ao.reduce((a,b)=>a+b,0)/ao.length:.5;
    // v1083: the rocket cohort must clear the SAME minimum-observation bar every feature must clear
    // before it is modeled at all. See rocketCohortTrusted above for the full reasoning.
    // v1085: the separation is still MEASURED (the ledger shows it) but never APPLIED.
    f.diagnosticEffect=clamp01((mr-mo)*2,-1,1);
    // v1135: the SAME-DAY separation stays diagnostic-only, exactly as v1085 requires. The effect
    // that now drives the weight is the FORWARD one, measured 5 sessions after the fact.
    const _fwd=fwdEffects.get(f.name);
    f.forwardEffect=_fwd?_fwd.effect:null;
    f.forwardSessions=_fwd?_fwd.n:0;
    f.effect=_fwd?_fwd.effect:(rocketCohortTrusted?f.diagnosticEffect:0);
    f.reliability=Math.sqrt(f.coverage)*(rocketRows.length/(rocketRows.length+12));
    f.weight=(.07+Math.abs(f.effect))*.6+.4*Math.sqrt(f.coverage);
    features.push(f);
  }
  let srFeat=null;
  {
    const vals=srArr.filter(v=>v!==null).sort((a,b)=>a-b);
    if(vals.length>=minObs&&vals[0]!==vals[vals.length-1]){
      const q02=radarQuant(vals,.02),q98=radarQuant(vals,.98),wins=vals.map(v=>clamp01(v,q02,q98)).sort((a,b)=>a-b);
      let ar=[],ao=[];
      srArr.forEach((v,ri)=>{if(v===null)return;(rset.has(ri)?ar:ao).push(radarPct(wins,clamp01(v,q02,q98)));});
      const mr=ar.length?ar.reduce((a,b)=>a+b,0)/ar.length:.5,mo=ao.length?ao.reduce((a,b)=>a+b,0)/ao.length:.5;
      const diagnosticEffect=clamp01((mr-mo)*2,-1,1);
      const effect=rocketCohortTrusted?diagnosticEffect:0,coverage=vals.length/rawRows.length;
      srFeat={sorted:wins,q02,q98,effect,diagnosticEffect,weight:(.07+Math.abs(effect))*.6+.4*Math.sqrt(coverage)};
    }
  }
  // ── v555 MARKET-CYCLE STAGE AWARENESS (stateless, self-calibrating) ──
  // Cross-sectional distributions for the stage inputs. Percentiles (not fixed thresholds) define
  // low/high, so the classifier recalibrates to each day's universe.
  const _sortF=a=>a.filter(v=>v!==null&&isFinite(v)).sort((x,y)=>x-y);
  const volArr=rawRows.map(raw=>{const a=radarNum(raw[adrI]),b=radarNum(raw[atrI]),d=radarNum(raw[atrWeekI]);const m=Math.max(a||0,b||0,(d||0)/Math.sqrt(5));return m>0?m:null;});
  const dayAbsArr=rawRows.map(raw=>{const d=radarNum(raw[targetI]);return d===null?null:Math.abs(d);});
  const relvolArr=rawRows.map(raw=>radarNum(raw[relI]));
  const deliveryArr=rawRows.map(raw=>{const m=supplements[normSym(raw[symbolI])];return m&&m.delivery!=null?m.delivery:null;});
  const breakoutArr=rawRows.map(raw=>{const m=supplements[normSym(raw[symbolI])],p=radarNum(raw[priceI]);return(m&&m.high52&&p)?p/m.high52:null;});
  const chgOpenArr=rawRows.map(raw=>changeOpenI>=0?radarNum(raw[changeOpenI]):null);
  const volSorted=_sortF(volArr),dayAbsSorted=_sortF(dayAbsArr),relvolSorted=_sortF(relvolArr),deliverySorted=_sortF(deliveryArr),breakoutSorted=_sortF(breakoutArr);
  const pctOr=(sorted,v,dflt)=>v===null?dflt:radarPct(sorted,v);
  const stagePct=rawRows.map((raw,ri)=>({
    tPct:trendArr[ri]===null?0.5:radarPct(trendSorted,trendArr[ri]),
    vPct:pctOr(volSorted,volArr[ri],0.5), dPct:pctOr(dayAbsSorted,dayAbsArr[ri],0),
    uPct:pctOr(relvolSorted,relvolArr[ri],0.5), delPct:pctOr(deliverySorted,deliveryArr[ri],0.5),
    bPct:pctOr(breakoutSorted,breakoutArr[ri],0.5)
  }));
  // WS-B accumulation signal: the CONJUNCTION (quiet + trending + accumulated + not-yet-spiked) is
  // the edge, so a parameter-free product of percentiles. Injected per row through the same
  // rocket-diagnostic × coverage weighting as every feature — no hand-set magnitude.
  const accArr=stagePct.map(p=>p.tPct*(1-p.vPct)*p.delPct*(1-p.dPct));
  let accFeat=null;
  {
    const vals=accArr.filter(v=>v!==null&&isFinite(v)).sort((a,b)=>a-b);
    if(vals.length>=minObs&&vals[0]!==vals[vals.length-1]){
      const q02=radarQuant(vals,.02),q98=radarQuant(vals,.98),wins=vals.map(v=>clamp01(v,q02,q98)).sort((a,b)=>a-b);
      let ar=[],ao=[];
      accArr.forEach((v,ri)=>{if(v===null)return;(rset.has(ri)?ar:ao).push(radarPct(wins,clamp01(v,q02,q98)));});
      const mr=ar.length?ar.reduce((a,b)=>a+b,0)/ar.length:.5,mo=ao.length?ao.reduce((a,b)=>a+b,0)/ao.length:.5;
      const diagnosticEffect=clamp01((mr-mo)*2,-1,1);
      const effect=rocketCohortTrusted?diagnosticEffect:0,coverage=vals.length/rawRows.length;
      accFeat={sorted:wins,q02,q98,effect,diagnosticEffect,weight:(.07+Math.abs(effect))*.6+.4*Math.sqrt(coverage)};
    }
  }
  const igniteArr=rawRows.map((raw,ri)=>{
    const p=radarNum(raw[priceI]),vw=vwapI>=0?radarNum(raw[vwapI]):null,co=chgOpenArr[ri];
    // Direction gate. `p>=vw` (not `p>vw`) to match getMarketAlignedEntryTiming's long-standing
    // semantics — v1069: the two gates must state the same thing, and 4 thin names sat exactly at
    // VWAP and disagreed. This is the ONE definition of "confirmed direction" in the codebase.
    if(!(p>0)||!(vw>0)||co===null||!(p>=vw)||!(co>0))return null;
    const ra=relAtI>=0?radarNum(raw[relAtI]):null,r1=relI>=0?radarNum(raw[relI]):null;
    const vol=dayVolI>=0?radarNum(raw[dayVolI]):null,av60=avgVol60I>=0?radarNum(raw[avgVol60I]):null;
    const r60=(vol!==null&&av60!==null&&av60>0)?vol/av60:null;
    if(ra===null&&r1===null&&r60===null)return null;
    return Math.log1p(Math.max(0,ra??0))+Math.log1p(Math.max(0,r1??0))+Math.log1p(Math.max(0,r60??0));
  });
  const igniteSorted=igniteArr.filter(v=>v!==null&&isFinite(v)).sort((a,b)=>a-b);
  const STAGE_LABEL={1:'Accumulation',2:'Breakout',3:'Event day',4:'Profit-booking',5:'Re-accumulation',6:'Second leg'};
  const allRows=rawRows.map((raw,ri)=>{
    const parts={},weights={},contrib=[];
    for(const g in RADAR_GROUPS){parts[g]=0;weights[g]=0;}
    let observed=0;
    for(const f of features){
      let v=radarTransformed(raw,f,priceI,openI);
      if(v===null)continue;
      // Use the bounds the feature was actually built with (v1068). Re-deriving 2nd/98th from the
      // already-winsorised array double-clipped every feature and would re-flatten the
      // participation tail this release deliberately preserves.
      v=clamp01(v,f.lo,f.hi);
      const p=radarPct(f.sorted,v),learn=Math.sign(f.effect||1)*(2*p-1),alpha=clamp01(Math.abs(f.effect)*1.35,.12,.58),sig=alpha*learn+(1-alpha)*radarPrior(f,p),w=f.weight;
      parts[f.group]+=sig*w;weights[f.group]+=w;observed++;
      contrib.push({name:f.name,group:f.group,p,sig,impact:sig*w});
    }
    // WS4/R6: sector-relative day signal into Momentum, using the identical signal formula and a
    // high-good prior (2p−1). Skipped on neutralised corp-action rows (srArr is null there).
    if(srFeat&&srArr[ri]!==null){
      const v=clamp01(srArr[ri],srFeat.q02,srFeat.q98),p=radarPct(srFeat.sorted,v),learn=Math.sign(srFeat.effect||1)*(2*p-1),alpha=clamp01(Math.abs(srFeat.effect)*1.35,.12,.58),sig=alpha*learn+(1-alpha)*(2*p-1),w=srFeat.weight;
      parts.momentum+=sig*w;weights.momentum+=w;
      contrib.push({name:'Sector-relative day %',group:'momentum',p,sig,impact:sig*w});
    }
    // ── v555 accumulation signal (WS-B) + sell-the-news decay (WS-C) + stage (WS-A) ──
    const _m=supplements[normSym(raw[symbolI])]||{};
    const _recEarn=recentEarnI>=0?String(raw[recentEarnI]||'').trim():'';
    const _daysSince=(reviewDays!=null&&/^\d{4}-\d{2}-\d{2}$/.test(_recEarn))?tradingDaysBetween(_recEarn,sessionDate):null;
    const _inDigestion=_daysSince!=null&&_daysSince>=0&&_daysSince<=reviewDays;
    // WS-C: a freshly-reported name earns NO accumulation credit and regains it linearly by the learned
    // review horizon (getEffectiveReviewDays) — magnitude-free, it just scales the self-calibrated signal.
    const _accDecay=_inDigestion?clamp01(_daysSince/Math.max(1,reviewDays),0,1):1;
    if(accFeat&&accArr[ri]!==null&&_accDecay>0){
      const v=clamp01(accArr[ri],accFeat.q02,accFeat.q98),p=radarPct(accFeat.sorted,v),learn=Math.sign(accFeat.effect||1)*(2*p-1),alpha=clamp01(Math.abs(accFeat.effect)*1.35,.12,.58),sig=alpha*learn+(1-alpha)*(2*p-1),w=accFeat.weight*_accDecay;
      parts.momentum+=sig*w;weights.momentum+=w;
      contrib.push({name:'Accumulation (quiet strength)',group:'momentum',p,sig,impact:sig*w});
    }
    const _upEarn=upcomingEarnI>=0?String(raw[upcomingEarnI]||'').trim():'';
    const _bmDate=(_m.boardMeeting&&_m.boardMeeting.isResults)?_m.boardMeeting.date:null;
    const _resDate=/^\d{4}-\d{2}-\d{2}$/.test(_bmDate||'')?_bmDate
      :(/^\d{4}-\d{2}-\d{2}$/.test(_upEarn)?_upEarn:null);
    const _daysToRes=_resDate?tradingDaysBetween(sessionDate,_resDate):null;
    const _weekChg=weekChgI>=0?radarNum(raw[weekChgI]):null;
    // `day` and `participationReady` are declared LATER in this loop, so both are recomputed here from
    // the same columns rather than referenced early. The ignition test is the model's existing
    // definition (RelVol >= 1.2 OR RelVol-at-time >= 1.5 OR volume change >= 30%), not a one-off.
    const _dayPct=radarNum(raw[targetI])||0;
    const _partReady=(relI>=0&&radarNum(raw[relI])>=1.2)
      ||(relAtI>=0&&radarNum(raw[relAtI])>=1.5)
      ||(volChgI>=0&&radarNum(raw[volChgI])>=30);
    const _sym=normSym(raw[symbolI]);
    let _drift=(_driftInfo.map&&_sym in _driftInfo.map)?_driftInfo.map[_sym]:null;
    let _driftSource=_drift!=null?`${_driftInfo.sessionsUsed}-session close-to-close (${_driftInfo.from} to ${_driftInfo.to})`:null;
    if(_drift==null&&_weekChg!=null&&Number.isFinite(_dayPct)&&(1+_dayPct/100)!==0){
      _drift=+(((1+_weekChg/100)/(1+_dayPct/100)-1)*100).toFixed(2);
      _driftSource='1-week column, compounded (approximate — ~5 sessions, not 3)';
    }
    const _quietRise=_drift!=null&&_drift>0&&_dayPct>0&&!_partReady;
    const _preResults={
      resultsDate:_resDate,
      resultsSource:_bmDate?'NSE board meeting':(_resDate?'TradingView upcoming earnings':null),
      daysToResults:_daysToRes,
      weekChangePct:_weekChg,
      driftPct:_drift,
      driftSource:_driftSource,
      quietRise:_quietRise,
      // The owner's window is 2-3 days out; 1 day is included because a T-1 print is the same setup one
      // session later, and it is the exact case R10 was opened on.
      inWindow:_daysToRes!=null&&_daysToRes>=1&&_daysToRes<=3,
      drift:!!(_quietRise&&_daysToRes!=null&&_daysToRes>=1&&_daysToRes<=3)
    };
    const _r4d=(_inDigestion&&/^\d{4}-\d{2}-\d{2}$/.test(_recEarn))?getResultsDayMove(_sym,_recEarn):null;
    const _vwapR4d=vwapI>=0?radarNum(raw[vwapI]):null;
    const _priceR4d=radarNum(raw[priceI]);
    const _reaccum=!!(_vwapR4d>0&&_priceR4d>=_vwapR4d&&chgOpenArr[ri]>0&&_partReady);
    const _mdir=(_r4d&&_r4d.wasRocket)?getMarginDirection(_sym):null;
    const _marginRelease=!!(_mdir&&_mdir.direction==='expanding');
    const _digestionRisk=!!(_r4d&&_r4d.wasRocket&&!_reaccum&&!_marginRelease);
    const _r4dRecord={
      inDigestion:_inDigestion,
      daysSinceResults:_daysSince,
      resultsDayMovePct:_r4d?_r4d.movePct:null,
      topDecileCut:_r4d?_r4d.topDecileCut:null,
      wasResultsRocket:_r4d?_r4d.wasRocket:null,
      reaccumulating:_reaccum,
      marginDirection:_mdir?_mdir.direction:null,
      marginDelta:_mdir?_mdir.delta:null,
      marginRelease:_marginRelease,
      blocked:_digestionRisk,
      reason:_digestionRisk
        ? `Rocketed ${_r4d.movePct}% on its results day (${_recEarn}), above that session's top-decile cut of ${_r4d.topDecileCut}%, and is not re-accumulating now. RULES.md R4d: a results rocket gives back sharply on the following sessions even when the numbers were good.`
        : (_r4d?null:(_inDigestion?'results-day move unknown - no stored closes for that session, so R4d does not apply':null))
    };
    // WS-A stage (percentile bands + event/earnings flags). Stages 4/5/6 need reviewDays + earnings date.
    const _P=stagePct[ri],_chgOpen=chgOpenArr[ri],_sma50=sma50I>=0?radarNum(raw[sma50I]):null,_priceMA=radarNum(raw[priceI]),_aboveMA=_sma50!=null&&_priceMA!=null&&_priceMA>_sma50;
    let _stage=null;
    if(_m.eventToday)_stage=3; // event today (corp-action ex-date or results board-meeting today)
    else if(_inDigestion){
      // Early in the post-results window (≤ a third of the review horizon) = profit-booking; later,
      // a quiet name holding above its MA is re-accumulating, a fresh breakout is the second leg.
      if(_daysSince<=Math.max(1,reviewDays/3))_stage=4;
      else if(_P.bPct>0.67&&_P.tPct>0.67)_stage=6;
      else if(_P.vPct<0.33&&_aboveMA&&_P.uPct<0.5)_stage=5;
      else _stage=4;
    }
    else if(_P.dPct>0.67&&_P.uPct>0.67&&_P.bPct>0.67)_stage=_P.tPct>0.67?6:2; // established-trend second leg vs first-leg breakout
    else if(_P.vPct<0.33&&_P.tPct>0.5&&_P.delPct>0.67&&_P.dPct<0.33)_stage=1; // silent accumulation
    let rawScore=0;
    for(const g in RADAR_GROUPS){
      parts[g]=weights[g]?50+50*parts[g]/weights[g]:50;
      if(g==='context'){const sp=radarPct(sectorSorted,sectorMeans[raw[sectorI]||'Unknown']??0);parts[g]=parts[g]*.7+sp*100*.3;}
      rawScore+=parts[g]*RADAR_GROUPS[g].budget/100;
    }
    const symbol=normSym(raw[symbolI]),meta=supplements[symbol]||{},series=String(meta.series||'Unknown').toUpperCase(),band=meta.band,status=String(meta.status||'A').toUpperCase();
    const eqEligible=series==='EQ'&&status==='A',basketEligible=eqEligible&&(band===null||band===undefined||band>=10);
    const day=radarNum(raw[targetI])||0,turn=radarNum(raw[turnI])||0,price=radarNum(raw[priceI])||0;
    const gapSigned=radarNum(raw[gapI]),gap=Math.abs(gapSigned||0),changeOpen=radarNum(raw[changeOpenI]),quality=features.length?observed/features.length:0;
    const relvol=radarNum(raw[relI]),relAt=radarNum(raw[relAtI]),volChg=radarNum(raw[volChgI]);
    const atrPct=radarNum(raw[atrI]);
    // v1084: historical capacity only (see volArr above). `Volatility, 1 day` is excluded because it
    // is an OUTCOME of today's move, and this figure feeds the 10%-stretch penalty, target
    // reachability and the v1083 session ceiling — all of which must not widen as a stock runs.
    const sessionVolatilityPct=radarNum(raw[volI]);
    const rangePct=Math.max(radarNum(raw[adrI])||0,atrPct||0,(radarNum(raw[atrWeekI])||0)/Math.sqrt(5));
    const _stretchBar=(RADAR_STRETCH_USE_TARGET&&Number(_radarSessionTargetPct)>0)
      ? Number(_radarSessionTargetPct) : 10;
    const stretch=rangePct?_stretchBar/rangePct:99;
    _radarStretchBarUsed=_stretchBar;
    const _stretchTiers=RADAR_STRETCH_USE_TARGET?[2,1.5,1]:[4,3,2.5];
    const participationReady=(relvol||0)>=1.2||(relAt||0)>=1.5||(volChg||0)>=20;
    const impulseReady=(day>=.5&&day<8)||parts.momentum>=62||parts.trend>=65;
    const continuationScore=continuationSignals[ri]||0;
    const followThroughBonus=continuationScore*8;
    const fallingKnifePenalty=day>=8&&(continuationScore<.15||!participationReady)?-10:0;
    const rocketReady=rangePct>=3.5&&participationReady&&impulseReady&&quality>=.7&&turn>=25e5&&price>=10&&basketEligible;
    const gateReasons=[];
    if(series!=='EQ')gateReasons.push(series==='UNKNOWN'?'exchange series unverified':'non-EQ series '+series);
    if(status!=='A')gateReasons.push('inactive exchange status');
    if(band!==null&&band!==undefined&&band<10)gateReasons.push(band+'% price band cannot permit a 10% move');
    if(rangePct<3.5)gateReasons.push('range capacity below 3.5%');
    if(!participationReady)gateReasons.push('no participation ignition');
    if(!impulseReady)gateReasons.push('no directional impulse');
    if(quality<.7)gateReasons.push('insufficient feature coverage');
    if(turn<25e5)gateReasons.push('turnover below ₹25L');
    if(price<10)gateReasons.push('price below ₹10');
    rawScore*=.88+.12*quality;
    if(series!=='EQ')rawScore-=50;
    if(status!=='A')rawScore-=50;
    if(band!==null&&band!==undefined&&band<10)rawScore-=35;else if(band===10)rawScore-=3;
    if(meta.flags?.length)rawScore-=Math.min(12,meta.flags.length*2);
    if(meta.delivery!==null&&meta.delivery!==undefined)rawScore+=clamp01(1-Math.abs(meta.delivery-55)/55,0,1)*3-1;
    if(meta.officialClose&&meta.officialAvg)rawScore+=meta.officialClose>=meta.officialAvg?1:-1;
    if(meta.high52&&meta.low52&&meta.high52>meta.low52){
      const pos52=clamp01((price-meta.low52)/(meta.high52-meta.low52));
      const bonus52=(pos52-.5)*4;
      const cleared52=price>meta.high52||meta.newHL==='H';
      const nearUncleared=!cleared52&&rangePct>0&&(meta.high52-price)<=price*rangePct/100;
      rawScore+=nearUncleared?-Math.abs(bonus52):bonus52;
      if(nearUncleared)gateReasons.push('at the 52-week high but not cleared');
    }
    // WS5/R8 (v552): weight the signed bulk/block deal-net by liquidity — churn in an illiquid
    // micro-cap (AASTHA) is not the institutional conviction the flat ±1.5 assumes. The ₹25L line
    // is the model's existing tradeability threshold (rocketReady/risk/Indicator Watch), not a new knob.
    if(meta.bulkNet){const dw=clamp01(turn/25e5,0,1);rawScore+=(meta.bulkNet>0?1.5:-1.5)*dw;}
    if(stretch>_stretchTiers[0])rawScore-=22;else if(stretch>_stretchTiers[1])rawScore-=14;else if(stretch>_stretchTiers[2])rawScore-=7;
    if(!participationReady)rawScore-=7;
    if(!impulseReady)rawScore-=5;
    rawScore+=followThroughBonus+fallingKnifePenalty;
    if(day>8){const chase=Math.min(13,(day-8)*1.7);const tPct=trendArr[ri]===null?null:radarPct(trendSorted,trendArr[ri]);rawScore-=chase*(tPct===null?1:1-tPct);}
    if(gap>7)rawScore-=Math.min(6,(gap-7)*.8);
    if(turn<5e5)rawScore-=7;
    if(price<5)rawScore-=5;
    const dispDay=meta._corpNeutralised&&meta._realDay!=null?meta._realDay:day;
    const out={symbol,name:String(raw[descI]||symbol),sector:raw[sectorI]||'',rawScore,parts,contrib,quality,
      price,day:dispDay,priceChange:dispDay,turnover:turn,relvol,gap,gapSigned,changeOpen,rangePct,sessionVolatilityPct,stretch,stretchBarPct:_stretchBar,atr:atrPct,
      high1d:highI>=0?radarNum(raw[highI]):null,low1d:lowI>=0?radarNum(raw[lowI]):null,dayVolume:dayVolI>=0?radarNum(raw[dayVolI]):null,open1d:openI>=0?radarNum(raw[openI]):null,marketCap:mcapI>=0?radarNum(raw[mcapI]):null,rocketToday:rset.has(ri),
      vwap:vwapI>=0?radarNum(raw[vwapI]):null,
      chaikinMF:cmfI>=0?radarNum(raw[cmfI]):null, mfi15m:mfi15I>=0?radarNum(raw[mfi15I]):null,
      bollUpper:bollUpperI>=0?radarNum(raw[bollUpperI]):null,
      keltUpper:keltUpperI>=0?radarNum(raw[keltUpperI]):null,
      price1h:priceHourI>=0?radarNum(raw[priceHourI]):null,
      price15m:price15I>=0?radarNum(raw[price15I]):null,
      price5m:price5I>=0?radarNum(raw[price5I]):null,
      corpAction:meta._corpNeutralised?(meta.corpToday?.purpose||'corporate action'):null,
      stage:_stage,stageLabel:_stage?STAGE_LABEL[_stage]:null,legTrendPct:_P.tPct,legHighPct:_P.bPct,
      inDigestion:_inDigestion,daysSinceEarnings:_daysSince,preResults:_preResults,r4d:_r4dRecord,
      rocketReady,gateReasons,series,band:band??null,status,eqEligible,basketEligible,meta,
      igniteReady:igniteArr[ri]!==null,
      igniteStrength:igniteArr[ri]===null?null:+igniteArr[ri].toFixed(4),
      ignitePct:igniteArr[ri]===null?0:radarPct(igniteSorted,igniteArr[ri])};
    out.entryTiming=getPeakEntryTiming(out);
    out.entryReady=!out.entryTiming.blocked;
    return out;
  });
  allRows.forEach(r=>{r._held=heldSymbols.has(r.symbol);});
  const rows=allRows;
  const suppressedHeld=allRows.filter(r=>r._held).length;
  const rawScores=rows.map(r=>r.rawScore).sort((a,b)=>a-b);
  for(const r of rows){
    r.compositePct=radarPct(rawScores,r.rawScore);
    r.noHistory=!!_noHist[normSym(r.symbol)];
    r.setupPct=Math.max(r.compositePct,r.ignitePct||0);
    const _tgt=Number(_radarSessionTargetPct)>0?Number(_radarSessionTargetPct):null;
    const _buy=r.price>0?r.price*(1+BASKET_MARKET_BUDGET_BUFFER_PCT/100):null;
    let _feas=1;
    if(_tgt&&_buy>0){
      const runways=[];
      if(r.low1d>0&&r.rangePct>0) runways.push((r.low1d*(1+r.rangePct/100)/_buy-1)*100);
      const _uc=getUpperCircuitInfo(r,_buy);
      if(_uc&&isFinite(_uc.runwayPct)){
        runways.push(_uc.runwayPct);
        r.circuitRunwayPct=+_uc.runwayPct.toFixed(3);
        r.circuitFeasibility=clamp01(_uc.runwayPct/_tgt,0,1);
      }
      if(runways.length){
        // The binding constraint is the tightest ceiling, and it must cover the target with the
        // same slippage cushion the order already budgets for (v1081's rule, reused not re-tuned).
        const _room=Math.min(...runways);
        _feas=clamp01(_room/_tgt,0,1);
      }
    }
    const _dirOk=(Number(r.vwap)>0&&Number(r.price)>=Number(r.vwap))
      &&Number(r.changeOpen)>0&&Number(r.day)>0;
    r.directionConfirmed=!!_dirOk;
    r.feasibility=+_feas.toFixed(4);
    const _bk=NSE_DEPTH[r.symbol];
    const _lv=DEPTH_LIVE[r.symbol];
    // A pasted book (chart summary, v1144) is a direct reading of what is resting NOW - it needs no
    // decay, because nothing about it is leftover auction inventory.
    if(_lv&&_lv.buyQty>0&&_lv.sellQty>0){
      r.depthImbalance=(_lv.buyQty-_lv.sellQty)/(_lv.buyQty+_lv.sellQty);
      r.depthLive=true; r.depthSource='pasted';
    }else if(_bk&&_bk.series==='EQ'&&_bk.bookQty>=DEPTH_MIN_BOOK_QTY){
      const d=deriveLiveBookImbalance(_bk,r);
      if(d){r.depthImbalance=d.imb;r.depthLive=false;r.depthSource=d.source;
            r.depthSignedVol=d.signedVol;r.depthPreOpenImb=_bk.imbalance;}
    }
    r.depthBlendPct=r.setupPct;   // provisional; replaced in the second pass
    r.score=+(100*Math.pow(r.depthBlendPct*(_dirOk?1:0),4)).toFixed(1);
    r.rocketScore=r.score; // allocation/export alias
    r.fundamental=deriveFundamentalTrigger(r);
    r.fundamentalTrigger=Number(r.fundamental?.value)||0;
    r.risk=!r.basketEligible||r.meta.flags?.length>=3||r.turnover<25e5||r.price<10?'High':(r.gap>6||r.day>6||r.parts.volatility<38?'Medium':'Low');
    r.setup=r.series!=='EQ'?(r.series==='UNKNOWN'?'Series unverified':`Non-EQ · ${r.series}`):r.band!==null&&r.band<10?`${r.band}% price band`:radarSetupLabel(r);
  }
  if(RADAR_DEPTH_IN_SCORE){
    const booked=rows.filter(r=>Number.isFinite(r.depthImbalance));
    if(booked.length>=50){
      const byImb=booked.slice().sort((a,b)=>a.depthImbalance-b.depthImbalance);
      const bn=byImb.length;
      byImb.forEach((r,i)=>{r.depthPct=bn>1?i/(bn-1):1;});
      // Absence is the MEDIAN, never the row's own standing: leaving bookless rows untouched while
      // the geometric mean shrinks every booked row PROMOTES them - measured, seven of the top
      // eight had no book at all. No information means the middle of the distribution.
      rows.forEach(r=>{
        const dp=Number.isFinite(r.depthPct)?r.depthPct:0.5;
        // v1208: the CIRCUIT only. feasibility fuses it with the statistical session ceiling that
        // v1112 retired, and min() let the retired half back in as a rank multiplier.
        const fz=Number.isFinite(r.circuitFeasibility)?r.circuitFeasibility:1;
        r.depthBlendPct=Math.sqrt(Math.max(0,r.setupPct)*Math.max(0,dp))*fz;
      });
      const _us=getUpStreakContext();
      const _uw=(_us&&_us.edge&&_us.edge.w>0)?_us.edge.w:0;
      if(_uw>0&&_us.map){
        const vals=[];
        rows.forEach(r=>{const v=_us.map[normSym(r.symbol)]; if(Number.isFinite(v)){r.upStreak=v; vals.push(v);}});
        if(vals.length>1){
          const srt=vals.slice().sort((x,y)=>x-y);
          // MIDRANK percentile. The distribution is heavily tied - most stocks are on a 0-day
          // streak - and an upper-bound rank would hand every member of a tie block the top of it,
          // which is the exact defect v1084 fixed in radarPct.
          const pct=v=>{
            let lo=0,hiI=0;
            for(const x of srt){ if(x<v) lo++; if(x<=v) hiI++; }
            return ((lo+hiI)/2)/srt.length;
          };
          const seen=rows.map(r=>Number.isFinite(r.upStreak)?pct(r.upStreak):null).filter(v=>v!=null).sort((x,y)=>x-y);
          // ABSENCE TAKES THE MEDIAN OF WHAT WAS ACTUALLY OBSERVED, never a free pass (v1139/v1174).
          const med=seen.length?seen[Math.floor(seen.length/2)]:0.5;
          rows.forEach(r=>{
            r.upStreakPct=Number.isFinite(r.upStreak)?pct(r.upStreak):med;
            const base=Math.max(0,r.depthBlendPct);
            r.depthBlendPct=Math.pow(base,1-_uw)*Math.pow(Math.max(1e-9,r.upStreakPct),_uw);
          });
        }
      }else if(_us&&_us.map){
        // still record it even when it counts for nothing, so the edge can be measured tomorrow
        rows.forEach(r=>{const v=_us.map[normSym(r.symbol)]; if(Number.isFinite(v)) r.upStreak=v;});
      }
      const byBlend=rows.filter(r=>Number.isFinite(r.depthBlendPct)).slice()
        .sort((a,b)=>a.depthBlendPct-b.depthBlendPct);
      const n=byBlend.length;
      byBlend.forEach((r,i)=>{r._bp=n>1?i/(n-1):1;});
      rows.forEach(r=>{
        if(!Number.isFinite(r._bp)) return;
        r.depthBlendPct=r._bp; delete r._bp;
        r.score=+(100*Math.pow(r.depthBlendPct*(r.directionConfirmed?1:0),4)).toFixed(1);
        r.rocketScore=r.score;
      });
    }
  }
  rows.sort((a,b)=>b.score-a.score||radarRankTieBreak(a,b));
  rows.forEach((r,i)=>{r.rank=i+1;});
  applyLearnedTriggerRanking(rows);
  applyIntradayReorder(rows);
  // WS-D: stateless market intraday breadth (share of the universe up from open). Market-wide ⇒ it
  // does NOT change the ranking; surfaced in the status bar + basket export as an entry-timing gauge.
  const _open=chgOpenArr.filter(v=>v!==null&&isFinite(v)),_adv=_open.filter(v=>v>0).length,_dec=_open.filter(v=>v<0).length;
  const marketIntraday=_open.length?{adv:_adv,dec:_dec,advPct:_adv/_open.length,median:radarQuant([..._open].sort((a,b)=>a-b),.5)}:null;
  // Rank answers what is moving; this second pass answers whether the move is executable in
  // the current market. Breadth is known only after the whole cross-section has been measured.
  rows.forEach(r=>{
    r.entryTiming=getMarketAlignedEntryTiming(r,marketIntraday);
    // R4d is applied HERE, after the market-aligned pass, because that pass REPLACES entryTiming
    // wholesale — merging R4d any earlier silently lost it. Entry timing has exactly one final
    // author, and this is it.
    if(r.r4d&&r.r4d.blocked){
      r.entryTiming={...r.entryTiming,blocked:true,digestionRisk:true,
        reason:r.entryTiming.reason?r.entryTiming.reason+'; '+r.r4d.reason:r.r4d.reason,
        action:r.entryTiming.action||'Wait for re-accumulation'};
    } else r.entryTiming.digestionRisk=false;
    r.entryReady=!r.entryTiming.blocked;
  });
  applyLearnedRecommendationGates(rows);
  return {rows,features,rockets:rocketRows.length,rocketTargetPct:_radarSessionTargetPct,stretchBarPct:_radarStretchBarUsed,continuationCount:continuationRows.length,suppressedHeld,marketIntraday,ids:{priceI,targetI,sectorI,symbolI,descI}};
}
// Score the current upload (object rows from parseCSV) through the Radar composite.
function radarScoreRows(objRows){
  const headers=objRows?._headers||Object.keys(objRows?.[0]||{});
  const matrix=(objRows||[]).map(o=>headers.map(h=>o[h]??''));
  const heldPos=getHeldPositionMap();
  const held=new Set(Object.keys(heldPos).map(normSym));
  const t0=performance.now();
  const result=radarAnalyze(headers,matrix,buildRadarSupplements(),held);
  RADAR={headers,matrix,features:result.features,ids:result.ids,rockets:result.rockets,rocketTargetPct:result.rocketTargetPct??null,stretchBarPct:result.stretchBarPct??null,continuationCount:result.continuationCount,ms:performance.now()-t0,sourceNote:'',scoredAt:Date.now()};
  SUPPRESSED_HELD=result.suppressedHeld;
  MARKET_INTRADAY=result.marketIntraday; // v555 WS-D: market breadth for the status bar + basket export
  return result.rows;
}
// Outcome-tracking rows for the surviving Harvest/entry outcome stores.
function buildObservedDailyMoves(objRows){
  const headers=objRows?._headers||Object.keys(objRows?.[0]||{});
  const highCol=findHeader(headers,[/^high, 1 day$/i]);
  const lowCol=findHeader(headers,[/^low, 1 day$/i]);
  const changeCol=findHeader(headers,[/^price change %, 1 day$/i]);
  return (objRows||[]).map(r=>{
    const symbol=normSym(r['Symbol']);
    if(!symbol) return null;
    return {symbol,price:num(r['Price']),high1d:highCol?num(r[highCol]):null,low1d:lowCol?num(r[lowCol]):null,priceChange:changeCol?num(r[changeCol]):null};
  }).filter(Boolean);
}
const INDICATOR_WATCH_STORE='rs_indicator_watch_v1';
const IW_SCHEMA='indicator_watch_v1';
const IW_WINDOW=5;            // forward trading sessions
const IW_LOG_MAX=30;         // rolling evaluated-session tally per indicator/outcome
const IW_MIN_SESSIONS=5;     // v1135 (OWNER): 20 -> 5. An owner-set evidence preference, the same
                             // category as the 20-order cap — not a calibrated output. It is the
                             // gate on BOTH the backwards-indicator warning and, from v1135, on
                             // whether a measured FORWARD effect may weight a feature.
const IW_MIN_MOVERS=5;       // a session contributes to an outcome only with >= this many movers
const IW_MIN_EFFECT=0.08;    // |mean forward effect| must clear this (not just be significant)
const IW_SIGN_FRACTION=0.70; // >= this fraction of samples must share the backwards sign
const IW_T_CRIT=3.5;         // ~Bonferroni two-sided z across ~120 monotonic features
const IW_MIN_TURNOVER=25e5;  // watch only tradeable stocks (turnover >= ₹25L); keeps signal + storage honest
async function iwDeflateB64(u8){
  try{
    const stream=new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf=new Uint8Array(await new Response(stream).arrayBuffer());
    let s='';for(let i=0;i<buf.length;i+=8192) s+=String.fromCharCode.apply(null,buf.subarray(i,i+8192));
    return btoa(s);
  }catch(e){console.warn('IW deflate failed',e);return null;}
}
async function iwInflate(b64){
  const bin=atob(b64),u8=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
  const stream=new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
// Prior orientation for the watch: +1 monotonic high-good, -1 inverted (high-bad),
// 0 = peak/neutral (not orientation-testable this way, excluded).
function iwPriorSign(feature){
  const lo=radarPrior(feature,0.05),hi=radarPrior(feature,0.95),mid=radarPrior(feature,0.50);
  if(Math.abs(lo)<0.02&&Math.abs(mid)<0.02&&Math.abs(hi)<0.02) return 0; // neutral (PE)
  if(mid>hi+0.05&&mid>lo+0.05) return 0;                                  // peak
  if(hi>lo+0.1) return 1;
  if(hi<lo-0.1) return -1;
  return 0;
}
function getIndicatorWatchStore(){
  const raw=FS.get(INDICATOR_WATCH_STORE);
  if(raw?.schema===IW_SCHEMA) return raw;
  return {schema:IW_SCHEMA,window:IW_WINDOW,pending:[],dailyMovers:[],log:{},resolvedSessions:0,updatedAt:null};
}
const SESSION_WATCH_STORE='rs_session_watch_v1';
const SESSION_WATCH_KEEP=30;              // sessions of high-time history to retain
const SESSION_WATCH_PATH_MAX=60;          // high-water points kept per symbol per session
function getSessionWatchStore(){
  const s=FS.get(SESSION_WATCH_STORE);
  return (s&&typeof s==='object')?{version:1,highs:s.highs||{},opm:s.opm||{}}:{version:1,highs:{},opm:{}};
}
function recordSessionWatch(sessionDate,receivedAt,objRows){
  if(!sessionDate||!Array.isArray(ALL)||!ALL.length) return null;
  const store=getSessionWatchStore();
  const hhmm=new Date(receivedAt||Date.now()).toLocaleTimeString('en-GB',
    {timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'});
  // SCOPE: the book plus the top of the ranking. The question is about positions we hold and picks
  // we made, so recording the whole 2,900-row universe every refresh would be storage for nothing.
  const held=getHeldPositionMap()||{};
  const watch=new Set(Object.keys(held));
  ALL.slice(0,(typeof RECOMMEND_MAX_RANK==='number'?RECOMMEND_MAX_RANK:10)*2)
     .forEach(r=>{if(r&&r.symbol)watch.add(r.symbol);});
  const day=store.highs[sessionDate]||(store.highs[sessionDate]={});
  ALL.forEach(r=>{
    if(!r||!watch.has(r.symbol)) return;
    const hi=Number(r.high1d), px=Number(r.price);
    const best=hi>0?hi:(px>0?px:null);
    if(!(best>0)) return;
    const cur=day[r.symbol];
    if(!cur){ day[r.symbol]={h:+best.toFixed(2),at:hhmm,first:hhmm,n:1,path:[[hhmm,+best.toFixed(2)]]}; return; }
    if(!Array.isArray(cur.path)||!cur.path.length) cur.path=[[cur.at||cur.first||hhmm,+Number(cur.h).toFixed(2)]];
    cur.n=(cur.n||0)+1;
    if(best>cur.h+1e-9){
      cur.h=+best.toFixed(2); cur.at=hhmm;                        // stamp ONLY on a new high
      if(!Array.isArray(cur.path)) cur.path=[];
      cur.path.push([hhmm,cur.h]);
      if(cur.path.length>SESSION_WATCH_PATH_MAX) cur.path.splice(1,cur.path.length-SESSION_WATCH_PATH_MAX);
    }
  });
  // TTM operating margin, recorded per symbol with the date it last moved.
  const rows=Array.isArray(objRows)?objRows:[];
  const COL='Operating margin %, Trailing 12 months';
  rows.forEach(r=>{
    const sym=normSym(r&&r['Symbol']); if(!sym) return;
    const v=Number(String(r[COL]??'').replace(/,/g,''));
    if(!Number.isFinite(v)) return;
    const prev=store.opm[sym];
    if(!prev){ store.opm[sym]={v:+v.toFixed(2),on:sessionDate}; return; }
    if(Math.abs(prev.v-v)>0.005){
      store.opm[sym]={v:+v.toFixed(2),on:sessionDate,prev:prev.v,prevOn:prev.on};
    }
  });
  // Bounded: keep the most recent sessions of high-time history, drop the rest.
  const dates=Object.keys(store.highs).sort();
  while(dates.length>SESSION_WATCH_KEEP){ delete store.highs[dates.shift()]; }
  FS.set(SESSION_WATCH_STORE,store);
  return store;
}
function splitPathAtSell(path,sellTime,finalHigh){
  const sellMin=clockMinutes(sellTime);
  if(sellMin==null||!Array.isArray(path)||!path.length) return null;
  let preHigh=null,preAt=null,advAt=null;
  for(const [t,h] of path){
    const m=clockMinutes(t);
    if(m==null) continue;
    if(m<=sellMin){ preHigh=h; preAt=t; }
    else if(advAt==null) advAt=t;
  }
  const fin=Number(finalHigh!=null?finalHigh:path[path.length-1][1]);
  // "Advanced" means a NEW high was set after the exit. With no pre-sell observation at all we only
  // know the first point came later, so it is flagged as straddling rather than claimed as clean.
  const advanced=preHigh==null?fin>0:(fin>preHigh+1e-9);
  return {advanced,preSellHigh:preHigh,postSellHigh:advanced?fin:null,
          advancedAt:advanced?advAt:null,straddles:advanced&&preAt==null};
}
function getPostSellHighFromWatch(sym,sessionDate,sellTime){
  const day=getSessionWatchStore().highs[sessionDate||getSessionDate()];
  const e=day&&day[normSym(sym)];
  if(!e) return null;
  const path=(Array.isArray(e.path)&&e.path.length)?e.path:[[e.at||e.first,+Number(e.h).toFixed(2)]];
  if(!path[0]||!path[0][0]) return null;
  const r=splitPathAtSell(path,sellTime,e.h);
  if(!r) return null;
  return {...r,advancedAt:r.advancedAt||(r.advanced?e.at:null),
          observations:e.n||0,points:path.length};
}
function getHighTimeInfo(sym,sessionDate){
  const d=getSessionWatchStore().highs[sessionDate||getSessionDate()];
  const e=d&&d[normSym(sym)];
  return e?{high:e.h,at:e.at,firstSeen:e.first,observations:e.n||0}:null;
}
let _gapStatsMemo=null;
function getHighGapStats(){
  const store=getSessionWatchStore();
  const trips=TRADEBOOK_STATS?.tripsData;
  const sig=Object.entries(store.highs||{})
    .map(([d,day])=>d+':'+Object.entries(day||{}).map(([s,e])=>s+e.at+e.h).join(''))
    .join('|')+'|'+(Array.isArray(trips)?trips.length:0);
  if(_gapStatsMemo&&_gapStatsMemo.sig===sig) return _gapStatsMemo.val;
  const gaps=[];const sessions=new Set();
  (Array.isArray(trips)?trips:[]).forEach(t=>{
    const d=t&&t.sellDate; if(!d) return;
    const day=store.highs[d]; if(!day) return;
    const e=day[normSym(t.sym)]; if(!e||!e.at) return;
    const hi=clockMinutes(e.at), se=clockMinutes(t.sellTime);
    if(hi==null||se==null) return;
    gaps.push(hi-se); sessions.add(d);
  });
  // Today's exits are in orders.csv, not yet in the tradebook, so fold them in from the same source
  // the Latest Session panel uses — otherwise the card reads empty on the day it matters most.
  try{
    const s=getLatestBookedSummary();
    if(s&&s.source==='Orders.csv'&&Array.isArray(s.rows)){
      const day=store.highs[s.date];
      if(day) s.rows.forEach(r=>{
        const e=day[normSym(r.sym)]; if(!e||!e.at) return;
        const hi=clockMinutes(e.at), se=clockMinutes(r.sellTime);
        if(hi==null||se==null) return;
        gaps.push(hi-se); sessions.add(s.date);
      });
    }
  }catch(err){}
  let val;
  if(!gaps.length){
    val={n:0,sessions:0,meanMin:null,medianMin:null,afterCount:0,
         source:'no watched session has a matching exit yet'};
  } else {
    const sorted=[...gaps].sort((a,b)=>a-b);
    val={n:gaps.length,sessions:sessions.size,
         meanMin:Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length),
         medianMin:Math.round(sorted[Math.floor(sorted.length/2)]),
         afterCount:gaps.filter(g=>g>0).length,
         source:`${gaps.length} exit${gaps.length===1?'':'s'} across ${sessions.size} watched session${sessions.size===1?'':'s'}`};
  }
  _gapStatsMemo={sig,val};
  return val;
}
// R3's signal: the sign of the TTM operating-margin move across the stock's last filing.
function getMarginDirection(sym){
  const e=getSessionWatchStore().opm[normSym(sym)];
  if(!e||e.prev==null) return null;                       // never seen it move: no signal, not "flat"
  return {delta:+(e.v-e.prev).toFixed(2),from:e.prev,to:e.v,on:e.on,prevOn:e.prevOn,
          direction:e.v>e.prev?'expanding':e.v<e.prev?'contracting':'flat'};
}
async function recordIndicatorWatch(sessionDate){
  try{
    if(!Array.isArray(ALL)||!ALL.length||!RADAR.features?.length) return;
    // Only monotonic-prior features are orientation-testable.
    const monoFeats=RADAR.features.map(f=>({name:f.name,sign:iwPriorSign(f)})).filter(f=>f.sign!==0);
    if(!monoFeats.length) return;
    const featNames=monoFeats.map(f=>f.name);
    const featIndex=new Map(featNames.map((n,i)=>[n,i]));
    const nF=featNames.length;
    // Restrict the watch to reasonably-LIQUID stocks (turnover >= IW_MIN_TURNOVER). This is
    // both correctness (a penny stock ticking to +10% on no volume is untradeable noise that
    // would pollute the mover sets and bias orientation) and a big storage cut.
    const liquid=s=>Number(s.turnover)>=IW_MIN_TURNOVER;
    const symbols=[];
    const deciles=[]; // per-stock Uint8 (length nF, 255=missing) — built now, packed after
    for(const s of ALL){
      if(!s.symbol||!Array.isArray(s.contrib)||!liquid(s)) continue;
      const row=new Uint8Array(nF).fill(255);
      let any=false;
      for(const c of s.contrib){
        const fi=featIndex.get(c.name);
        if(fi===undefined) continue;
        const d=Math.max(0,Math.min(9,Math.floor((Number(c.p)||0)*10)));
        row[fi]=d;any=true;
      }
      if(any){symbols.push(s.symbol);deciles.push(row);}
    }
    if(symbols.length<50) return;
    // Today's mover sets (same-day day-move thresholds among liquid stocks).
    const m5=[],m10=[];
    for(const s of ALL){const d=Number(s.day??s.priceChange);if(!isFinite(d)||!liquid(s))continue;if(d>=10)m10.push(s.symbol);if(d>=5)m5.push(s.symbol);}
    const store=getIndicatorWatchStore();
    // Per-feature anchor sum/count of deciles (for the non-mover baseline at resolution).
    const sum=new Float64Array(nF),cnt=new Uint32Array(nF);
    for(const row of deciles) for(let i=0;i<nF;i++){if(row[i]!==255){sum[i]+=row[i];cnt[i]++;}}
    const flat=new Uint8Array(symbols.length*nF);
    for(let r=0;r<deciles.length;r++) flat.set(deciles[r],r*nF);
    const packed=await iwDeflateB64(flat);
    if(!packed) return;
    // Dedup within a session: the latest upload of a date replaces that date's anchor/movers.
    store.dailyMovers=store.dailyMovers.filter(x=>x.date!==sessionDate);
    store.dailyMovers.push({date:sessionDate,m5,m10});
    store.dailyMovers.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    store.dailyMovers=store.dailyMovers.slice(-(IW_WINDOW+1));
    store.pending=store.pending.filter(a=>a.date!==sessionDate);
    store.pending.push({date:sessionDate,ns:symbols.length,nF,featNames,signs:monoFeats.map(f=>f.sign),
      symbols,packed,sum:Array.from(sum,v=>+v.toFixed(1)),cnt:Array.from(cnt)});
    // Resolve matured anchors (>= IW_WINDOW trading sessions elapsed by uploaded dates).
    const stillPending=[];
    for(const a of store.pending){
      const elapsed=Number(tradingDaysBetween(a.date,sessionDate));
      // v1136: resolve a SECOND time, earlier and conditioned, into store.logShort. An anchor still
      // matures at IW_WINDOW for the orientation guardrail; this extra pass is what feeds the SCORE.
      if(elapsed>=ROCKET_HORIZON_DAYS&&!a.shortDone){a.shortDone=true;await iwResolveShort(store,a);}
      if(!(elapsed>=IW_WINDOW)){stillPending.push(a);continue;}
      await iwResolveAnchor(store,a);
    }
    store.pending=stillPending;
    store.updatedAt=new Date().toISOString();
    FS.set(INDICATOR_WATCH_STORE,store);
  }catch(e){console.warn('recordIndicatorWatch failed',e);}
}
async function iwResolveShort(store,a){
  try{
    const H=ROCKET_HORIZON_DAYS;
    const win=store.dailyMovers.filter(x=>String(x.date)>String(a.date)&&Number(tradingDaysBetween(a.date,x.date))<=H);
    if(win.length<H) return;                        // window not actually covered by uploaded days
    const dirIdx=a.featNames.indexOf('Change from open %, 1 day');
    if(dirIdx<0) return;                            // no direction column: measure nothing, fail open
    const set5=new Set();
    win.forEach(x=>(x.m5||[]).forEach(s=>set5.add(s)));
    const flat=await iwInflate(a.packed);
    const nF=a.nF,syms=a.symbols;
    const mSum=new Float64Array(nF),mCnt=new Uint32Array(nF);
    const nSum=new Float64Array(nF),nCnt=new Uint32Array(nF);
    let movers=0,rows=0;
    for(let r=0;r<syms.length;r++){
      const base=r*nF,dv=flat[base+dirIdx];
      if(dv===255||dv<5) continue;                  // direction not confirmed: out of the sample
      rows++;
      const isM=set5.has(syms[r]);
      if(isM) movers++;
      for(let i=0;i<nF;i++){
        const d=flat[base+i]; if(d===255) continue;
        if(isM){mSum[i]+=d;mCnt[i]++;}else{nSum[i]+=d;nCnt[i]++;}
      }
    }
    if(movers<IW_MIN_MOVERS) return;                // too few movers to trust a direction
    store.logShort=store.logShort||{};
    for(let i=0;i<nF;i++){
      const mc=mCnt[i],nc=nCnt[i];
      if(mc<3||nc<3) continue;
      const e=((mSum[i]/mc)-(nSum[i]/nc))/9;        // same decile-mean gap, same normalisation
      const name=a.featNames[i];
      const rec=store.logShort[name]||(store.logShort[name]={sign:a.signs[i],e5:[]});
      rec.sign=a.signs[i];
      rec.e5.push(+e.toFixed(4));
      if(rec.e5.length>IW_LOG_MAX) rec.e5.shift();
    }
    store.resolvedShortSessions=(store.resolvedShortSessions||0)+1;
  }catch(e){console.warn('iwResolveShort failed',e);}
}
async function iwResolveAnchor(store,a){
  try{
    // Movers within the window: any stock hitting the threshold on a day strictly after
    // the anchor and within IW_WINDOW trading sessions.
    const win=store.dailyMovers.filter(x=>String(x.date)>String(a.date)&&Number(tradingDaysBetween(a.date,x.date))<=IW_WINDOW);
    const set5=new Set(),set10=new Set();
    win.forEach(x=>{(x.m5||[]).forEach(s=>set5.add(s));(x.m10||[]).forEach(s=>set10.add(s));});
    const flat=await iwInflate(a.packed);
    const nF=a.nF,syms=a.symbols;
    const foldOutcome=(moverSet,minMovers,key)=>{
      // Per feature: mover decile mean vs non-mover decile mean, normalized to [-1,1].
      const moverSum=new Float64Array(nF),moverCnt=new Uint32Array(nF);
      let movers=0;
      for(let r=0;r<syms.length;r++){
        if(!moverSet.has(syms[r])) continue;
        movers++;
        const base=r*nF;
        for(let i=0;i<nF;i++){const d=flat[base+i];if(d!==255){moverSum[i]+=d;moverCnt[i]++;}}
      }
      if(movers<minMovers) return; // too few movers this session to trust the direction
      for(let i=0;i<nF;i++){
        const mc=moverCnt[i];if(mc<3) continue;
        const nonC=a.cnt[i]-mc,nonSum=a.sum[i]-moverSum[i];
        if(nonC<3) continue;
        const e=((moverSum[i]/mc)-(nonSum/nonC))/9; // decile-mean gap, normalized
        const name=a.featNames[i];
        const rec=store.log[name]||(store.log[name]={sign:a.signs[i],e5:[],e10:[]});
        rec.sign=a.signs[i];
        rec[key].push(+e.toFixed(4));
        if(rec[key].length>IW_LOG_MAX) rec[key].shift();
      }
    };
    foldOutcome(set5,IW_MIN_MOVERS,'e5');
    foldOutcome(set10,Math.max(2,Math.floor(IW_MIN_MOVERS/2)),'e10'); // 10% movers are rarer
    store.resolvedSessions=(store.resolvedSessions||0)+1;
  }catch(e){console.warn('iwResolveAnchor failed',e);}
}
// Evaluate the rolling log: which indicators are backwards on BOTH outcomes, strictly.
function evaluateIndicatorWatch(){
  const store=getIndicatorWatchStore();
  const backwardsOn=(arr,sign)=>{
    const n=arr.length;
    if(n<IW_MIN_SESSIONS) return null;
    const mean=arr.reduce((s,v)=>s+v,0)/n;
    const varr=arr.reduce((s,v)=>s+(v-mean)*(v-mean),0)/Math.max(1,n-1);
    const se=Math.sqrt(varr/n)||1e-9;
    const t=mean/se;
    const backSign=-sign; // rewarded end holds FEWER movers => effect sign opposite to prior
    const sameSignFrac=arr.filter(v=>Math.sign(v)===backSign).length/n;
    const ok=Math.sign(mean)===backSign&&Math.abs(t)>=IW_T_CRIT&&Math.abs(mean)>=IW_MIN_EFFECT&&sameSignFrac>=IW_SIGN_FRACTION;
    return {ok,mean:+mean.toFixed(3),n,t:+t.toFixed(2)};
  };
  const flags=[];
  const tested=Object.keys(store.log).filter(name=>{
    const r=store.log[name];return (r.e5?.length||0)>=IW_MIN_SESSIONS&&(r.e10?.length||0)>=IW_MIN_SESSIONS;
  });
  Object.entries(store.log).forEach(([name,r])=>{
    const b5=backwardsOn(r.e5||[],r.sign),b10=backwardsOn(r.e10||[],r.sign);
    if(b5?.ok&&b10?.ok) flags.push({name,sign:r.sign,e5:b5,e10:b10});
  });
  return {resolvedSessions:store.resolvedSessions||0,pending:store.pending?.length||0,
    testable:tested.length,logged:Object.keys(store.log).length,flags};
}
function getHoldingAvgCost(symbol){
  symbol=normSym(symbol);
  if(!symbol) return null;
  // 1. Holdings.csv cost map (most accurate — Zerodha settled avg)
  if(HOLD_COST_MAP[symbol]!=null) return HOLD_COST_MAP[symbol];
  // 2. Holdings.csv all rows (includes qty=0 closed positions)
  const hrow=HOLDINGS_ALL?.find(h=>h.symbol===symbol&&h.avgCost!=null);
  if(hrow?.avgCost!=null) return hrow.avgCost;
  // 3. Positions.csv T+1 unsettled buy rows; sell avg is sell price, not cost basis.
  const prow=POSITIONS?.find(p=>p.symbol===symbol&&p.avg!=null&&!p.isSell);
  if(prow?.avg!=null) return prow.avg;
  // A stale tradebook still holds the unmatched buy lots that today's Orders.csv sell closed.
  const openAvg=TRADEBOOK_STATS?.openAvgCostMap?.[symbol];
  if(openAvg!=null) return openAvg;
  return null;
}

// Module-level helper: normalise Zerodha order timestamp to YYYY-MM-DD
// Handles DD-MM-YYYY HH:MM:SS (Zerodha format) and YYYY-MM-DD variants.
function normOrderDate(timeStr){
  const s=(timeStr||'').trim();
  const m=s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if(m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s.substring(0,10);
}

function getLatestOrderSession(){
  if(!ORDERS_TODAY?.length) return null;
  const date=getSessionDate();
  const orders=ORDERS_TODAY.filter(o=>normOrderDate(o.time)===date);
  return orders.length?{date,orders}:null;
}

function sumChargeParts(parts){
  return Object.values(parts).reduce((sum,v)=>sum+(v||0),0);
}

function currentPriceForSymbol(symbol){
  const sym=normSym(symbol);
  const row=ALL.find(s=>s.symbol===sym);
  const price=Number(row?.price);
  return price>0?price:null;
}

function dayHighForSymbol(sym){
  const row=ALL.find(s=>s.symbol===sym);
  const hi=Number(row?.high1d);
  return hi>0?hi:null;
}
function clockMinutes(v){
  const m=String(v||'').match(/(\d{1,2}):(\d{2})/);
  return m?(+m[1])*60+(+m[2]):null;
}
function enrichExitPnlRow(row,bookedDate=null){
  const qty=Number(row?.qty)||0;
  const buy=Number(row?.buyPrice);
  const sell=Number(row?.sellPrice);
  const current=currentPriceForSymbol(row?.sym);
  const out={...row};
  out.highAt=null; out.highGapMin=null; out.highObs=null; out.highNote='';
  try{
    const info=getHighTimeInfo(row?.sym,bookedDate||getSessionDate());
    if(!info){
      out.highNote='Not watched that session. The high-time recorder began 2026-08-11 and covers open positions plus the top of the ranking.';
    } else {
      out.highAt=info.at; out.highObs=info.observations;
      // If the high was already in at the FIRST observation, the recorder never saw it advance, so
      // the stamp is an UPPER BOUND ("at or before"), not a time. Saying otherwise would invent
      // precision the recorder cannot have — the high may have printed before watching began.
      out.highAtIsBound=(info.at===info.firstSeen);
      const hi=clockMinutes(info.at), se=clockMinutes(row?.sellTime);
      if(hi!=null&&se!=null) out.highGapMin=hi-se;
      out.highNote=(out.highAtIsBound
        ? `Day high ${info.high} was ALREADY IN at the first observation (${info.at} IST), so this is "at or before", not the time of the high.`
        : `Day high ${info.high} last advanced at ${info.at} IST.`)
        +` ${info.observations} observation${info.observations===1?'':'s'} that session`
        +(row?.sellTime?` · you sold at ${String(row.sellTime).match(/\d{1,2}:\d{2}/)?.[0]||'?'}`:'')
        +`. Resolution is your export cadence, not seconds.`;
    }
  }catch(e){}
  if(qty>0&&isFinite(buy)&&buy>0&&isFinite(sell)&&sell>0){
    out.priceDiff=+(sell-buy).toFixed(2);
    const _net=Number(out.netPnl), _chg=Number(out.charges);
    out.grossPnl=(Number.isFinite(_net)&&Number.isFinite(_chg))
      ? +(_net+_chg).toFixed(0)
      : +((sell-buy)*qty).toFixed(0);
  }else{
    out.priceDiff=null;
    out.grossPnl=null;
  }
  out.currentPrice=current!=null?+current.toFixed(2):null;
  const dayHigh=dayHighForSymbol(row?.sym);
  const scanDate=(typeof getSessionDate==='function')?getSessionDate():null;
  out.leftOnTableRs=null; out.leftOnTablePct=null;
  // v1120: the sell time is passed so the sell day can be split at the exit instead of folded in whole.
  const ext=getPostSellExtremes(row?.sym,bookedDate,row?.sellTime);
  out.postSellHigh=ext.high!=null?+ext.high.toFixed(2):null;
  out.postSellLow=ext.low!=null?+ext.low.toFixed(2):null;
  out.leftOnTableExact=ext.exact;
  out.leftOnTableSessions=ext.sessions;
  out.sellDayNote=ext.sellDayNote||null;
  if(dayHigh!=null) out.dayHigh=+dayHigh.toFixed(2);
  if(!(qty>0)||!(sell>0)){
    out.leftOnTableNote='No sell price or quantity on this row.';
  }else if(!bookedDate){
    out.leftOnTableNote='No booking date on this row, so the post-sell window cannot be bounded.';
  }else if(ext.high==null&&ext.low==null&&/no new high after your exit/.test(ext.sellDayNote||'')){
    out.leftOnTableRs=0; out.leftOnTablePct=0;
    out.leftOnTableExact=true;
    out.leftOnTableNote=`Sold at ₹${sell.toFixed(2)}. ${ext.sellDayNote}. Nothing is attributable to waiting — the app sees the running high only, so a rise that stopped short of the earlier high would be invisible.`;
  }else if(ext.high==null&&ext.low==null){
    out.leftOnTableNote=`No price data covering any session at or after ${bookedDate} — the symbol is absent from both the stored daily history and the current scanner file, so what happened after the exit is unknown.`;
  }else{
    const hi=ext.high, lo=ext.low;
    const wentUp=hi!=null&&hi>sell;
    const ref=wentUp?hi:(lo!=null?lo:hi);
    out.leftOnTableRs=+((ref-sell)*qty).toFixed(0);
    out.leftOnTablePct=+(((ref-sell)/sell)*100).toFixed(2);
    const res=ext.exact
      ? `Measured across ${ext.sessions} full session${ext.sessions===1?'':'s'} after the sell${ext.from?` (${ext.from} to ${ext.to})`:''}${ext.sellDayNote?`, plus the sell day: ${ext.sellDayNote}`:''} — fully attributable.`
      : `UPPER BOUND${ext.sellDayNote?` (${ext.sellDayNote})`:''}: part of that day's range may predate the exit. For a LIMIT sell it is exact — price can only reach the limit once, so anything above it came at or after the fill.`;
    const live=(typeof isMarketHours==='function'&&isMarketHours())?' The market is still open, so this is still moving.':'';
    const both=`Post-sell high ₹${hi!=null?hi.toFixed(2):'—'}, low ₹${lo!=null?lo.toFixed(2):'—'}.`;
    out.leftOnTableNote=out.leftOnTableRs>0
      ? `Sold at ₹${sell.toFixed(2)}; it went on to ₹${hi.toFixed(2)} — ${fmtINR(out.leftOnTableRs)} (${out.leftOnTablePct.toFixed(2)}%) left on the table across ${qty} shares. ${both} ${res}${live}`
      : out.leftOnTableRs===0
        ? `Sold at ₹${sell.toFixed(2)} and it never traded away from that price afterwards. ${both} ${res}${live}`
        : `Sold at ₹${sell.toFixed(2)}; it never traded above that and fell to ₹${lo.toFixed(2)} — the exit SAVED ${fmtINR(Math.abs(out.leftOnTableRs))} (${Math.abs(out.leftOnTablePct).toFixed(2)}%). ${both} ${res}${live}`;
  }
  return out;
}

function summarizeExitPnlRows(rows){
  const known=(rows||[]).filter(r=>r&&r.capital>0&&r.netPnl!=null);
  const capital=known.reduce((s,r)=>s+(r.capital||0),0);
  const net=known.reduce((s,r)=>s+(r.netPnl||0),0);
  const gross=known.reduce((s,r)=>s+(r.grossPnl||0),0);
  const charges=known.reduce((s,r)=>s+(r.charges||0),0);
  // v1094: totals for money left on the table. The % total is PROCEEDS-WEIGHTED, not a mean of the
  // per-row percentages — averaging percentages across positions of different size would let a tiny
  // position swing the headline.
  const leftRows=(rows||[]).filter(r=>r.leftOnTableRs!=null);
  const leftRs=leftRows.reduce((s,r)=>s+r.leftOnTableRs,0);
  const leftProceeds=leftRows.reduce((s,r)=>s+(Number(r.sellPrice)||0)*(Number(r.qty)||0),0);
  const leftPct=leftProceeds>0?+((leftRs/leftProceeds)*100).toFixed(2):null;
  return {known,capital,net,gross,charges,pct:capital>0?+(net/capital*100).toFixed(2):null,
          leftRs,leftPct,leftCount:leftRows.length,leftProceeds};
}

function getLeftOnTableStore(){
  const raw=FS.get(LEFT_ON_TABLE_STORE);
  return (raw&&typeof raw==='object'&&raw.sessions&&typeof raw.sessions==='object')?raw:{version:1,sessions:{}};
}
function recordLeftOnTableSession(date,summary){
  if(!date||!summary) return null;
  // leftCount 0 means the guard withheld every row — that is "unknown", not "nothing left behind".
  if(!(summary.leftCount>0)||!(summary.leftProceeds>0)||summary.leftPct==null) return null;
  const store=getLeftOnTableStore();
  const next={leftPct:+Number(summary.leftPct).toFixed(2),
              leftRs:Math.round(Number(summary.leftRs)||0),
              proceeds:Math.round(summary.leftProceeds),
              rows:summary.leftCount,
              updatedAt:new Date().toISOString()};
  const prev=store.sessions[date];
  if(prev&&prev.leftPct===next.leftPct&&prev.proceeds===next.proceeds&&prev.rows===next.rows) return store;
  const sessions={...store.sessions,[date]:next};
  for(const d of Object.keys(sessions).sort().slice(0,Math.max(0,Object.keys(sessions).length-LEFT_ON_TABLE_KEEP_SESSIONS))) delete sessions[d];
  const out={version:1,sessions};
  FS.set(LEFT_ON_TABLE_STORE,out);
  return out;
}
let _leftPoolMemo=null;
const REACHABLE_MIN_SAMPLES=40;         // below this the distribution is not worth trusting
let _reachMemo=null;
function getReachableTargets(){
  const store=FS.get(SAME_DAY_EXIT_OPPORTUNITY_STORE);
  const entries=store?.entries||{};
  const sig=(store?.lastUpdated||'')+'|'+Object.keys(entries).length;
  if(_reachMemo&&_reachMemo.sig===sig) return _reachMemo.val;
  const rows=Object.values(entries)
    .filter(e=>Number(e.avgBuy)>0&&Number(e.dayHigh)>0)
    .map(e=>(Number(e.dayHigh)/Number(e.avgBuy)-1)*100)
    .filter(v=>Number.isFinite(v))
    .sort((a,b)=>a-b);
  let val;
  if(rows.length<REACHABLE_MIN_SAMPLES){
    val={basePct:null,runnerPct:null,samples:rows.length,
         source:`only ${rows.length} exits on file, needs ${REACHABLE_MIN_SAMPLES}`};
  } else {
    const at=p=>rows[Math.min(rows.length-1,Math.floor(p*rows.length))];
    val={basePct:+Math.max(0,at(0.50)).toFixed(2),
         runnerPct:+Math.max(0,at(0.75)).toFixed(2),
         samples:rows.length,
         source:`${rows.length} closed exits, buy to that day's high`};
  }
  _reachMemo={sig,val};
  return val;
}
function getLeftOnTablePool(){
  const store=getLeftOnTableStore();
  const dates=Object.keys(store.sessions||{}).sort().slice(-LEFT_ON_TABLE_POOL_SESSIONS);
  const sig=dates.map(d=>d+':'+store.sessions[d].leftPct+':'+store.sessions[d].proceeds).join('|');
  if(_leftPoolMemo&&_leftPoolMemo.sig===sig) return _leftPoolMemo.val;
  let num=0,den=0;
  for(const d of dates){
    const s=store.sessions[d];
    if(!(s&&s.proceeds>0&&Number.isFinite(s.leftPct))) continue;
    num+=s.leftPct*s.proceeds; den+=s.proceeds;
  }
  const raw=den>0?num/den:null;
  const val={poolPct:raw==null?0:Math.max(0,+raw.toFixed(2)),
             rawPct:raw==null?null:+raw.toFixed(2),
             sessions:dates.length,proceeds:Math.round(den),
             source:raw==null?'no recorded sessions yet':(raw<=0?'exits already at or above the post-sell price — no nudge':`${dates.length} session${dates.length===1?'':'s'}, proceeds-weighted`)};
  _leftPoolMemo={sig,val};
  return val;
}

function computeLatestOrderBooked(){
  // Only compute from orders loaded this session — never from brain-restored stale orders.
  if(!ORDERS_TODAY?._loadedThisSession) return null;
  const session=getLatestOrderSession();
  if(!session) return null;
  const bySym={};
  session.orders.forEach(o=>{
    if(!bySym[o.symbol]) bySym[o.symbol]={buys:[],sells:[]};
    if(o.type==='BUY') bySym[o.symbol].buys.push(o);
    else if(o.type==='SELL') bySym[o.symbol].sells.push(o);
  });

  const rows=[];
  const dpCharged=new Set();
  Object.entries(bySym).forEach(([sym,{buys,sells}])=>{
    if(!sells.length) return;
    const totalSellQty=sells.reduce((s,o)=>s+o.qty,0);
    // v1119: the time of the LAST sell for this symbol, so the panel can say how long after the
    // exit the day high arrived. orders.csv carries fill times to the second (v1096).
    const _sellTime=sells.map(o=>String(o.time||'')).filter(Boolean).sort().pop()||null;
    const avgSell=sells.reduce((s,o)=>s+o.price*o.qty,0)/totalSellQty;
    const holdingAvg=getHoldingAvgCost(sym);
    const totalBuyQty=buys.reduce((s,o)=>s+o.qty,0);
    const sameDayQty=Math.min(totalBuyQty,totalSellQty);
    const deliveryQty=totalSellQty-sameDayQty;
    const todayAvg=totalBuyQty>0?buys.reduce((s,o)=>s+o.price*o.qty,0)/totalBuyQty:null;
    const components=[];
    const addKnownComponent=(qty,avgBuy,isSameDay)=>{
      if(!(qty>0)||!(avgBuy>0)) return;
      const skipDp=isSameDay||dpCharged.has(sym);
      if(!isSameDay) dpCharged.add(sym);
      const bcS=calcZerodhaChargesSplit(avgBuy,qty,false,isSameDay,false);
      const scS=calcZerodhaChargesSplit(avgSell,qty,true,isSameDay,skipDp);
      const parts={
        _brok:+(bcS.brokerage+scS.brokerage).toFixed(2),
        _stt:+(bcS.stt+scS.stt).toFixed(2),
        _txn:+(bcS.txn+scS.txn).toFixed(2),
        _sebi:+(bcS.sebi+scS.sebi).toFixed(2),
        _gst:+(bcS.gst+scS.gst).toFixed(2),
        _stamp:+(bcS.stamp+scS.stamp).toFixed(2),
        _dp:+(bcS.dp+scS.dp).toFixed(2)
      };
      const charges=+sumChargeParts(parts).toFixed(0);
      const capital=avgBuy*qty;
      const netPnl=+((avgSell-avgBuy)*qty-charges).toFixed(0);
      components.push({qty,avgBuy,capital,charges,netPnl,...parts});
    };
    if(sameDayQty>0) addKnownComponent(sameDayQty,todayAvg,true);
    if(deliveryQty>0&&holdingAvg!=null) addKnownComponent(deliveryQty,holdingAvg,false);
    if(deliveryQty>0&&holdingAvg==null){
      if(sameDayQty===0){
        // If tradebook has the same sell date, use its exact FIFO-realized row.
        const tradebookRow=TRADEBOOK_STATS?._loadedThisSession
          && TRADEBOOK_STATS.lastDate===session.date
          && TRADEBOOK_STATS.lastDayRows?.find(r=>r.sym===sym);
        if(tradebookRow){
          rows.push(enrichExitPnlRow({...tradebookRow,_sort:tradebookRow.netPnl},session.date));
          return;
        }
      }
      // Preserve a known intraday component, but disclose carried shares whose cost is unavailable.
      const skipDp=dpCharged.has(sym);
      dpCharged.add(sym);
      const scS=calcZerodhaChargesSplit(avgSell,deliveryQty,true,false,skipDp);
      const _brok=+scS.brokerage.toFixed(2),_stt=+scS.stt.toFixed(2),_txn=+scS.txn.toFixed(2);
      const _sebi=+scS.sebi.toFixed(2),_gst=+scS.gst.toFixed(2),_stamp=+scS.stamp.toFixed(2),_dp=+scS.dp.toFixed(2);
      const charges=+sumChargeParts({_brok,_stt,_txn,_sebi,_gst,_stamp,_dp}).toFixed(0);
      rows.push(enrichExitPnlRow({sym,sellTime:_sellTime,lots:sells.length,qty:deliveryQty,capital:null,buyPrice:null,sellPrice:+avgSell.toFixed(2),_brok,_stt,_txn,_sebi,_gst,_stamp,_dp,charges,winRate:null,netPnl:null,netPnlPct:null,_sort:-Infinity,_noAvgCost:true},session.date));
    }
    if(!components.length) return;
    const matchedQty=components.reduce((sum,c)=>sum+c.qty,0);
    const capital=components.reduce((sum,c)=>sum+c.capital,0);
    const avgBuy=capital/matchedQty;
    const _brok=+components.reduce((sum,c)=>sum+c._brok,0).toFixed(2);
    const _stt=+components.reduce((sum,c)=>sum+c._stt,0).toFixed(2);
    const _txn=+components.reduce((sum,c)=>sum+c._txn,0).toFixed(2);
    const _sebi=+components.reduce((sum,c)=>sum+c._sebi,0).toFixed(2);
    const _gst=+components.reduce((sum,c)=>sum+c._gst,0).toFixed(2);
    const _stamp=+components.reduce((sum,c)=>sum+c._stamp,0).toFixed(2);
    const _dp=+components.reduce((sum,c)=>sum+c._dp,0).toFixed(2);
    const charges=+components.reduce((sum,c)=>sum+c.charges,0).toFixed(0);
    const netPnl=+components.reduce((sum,c)=>sum+c.netPnl,0).toFixed(0);
    const netPnlPct=capital>0?+(netPnl/capital*100).toFixed(2):null;
    rows.push(enrichExitPnlRow({sym,sellTime:_sellTime,lots:sells.length,qty:matchedQty,capital,buyPrice:+avgBuy.toFixed(2),sellPrice:+avgSell.toFixed(2),_brok,_stt,_txn,_sebi,_gst,_stamp,_dp,charges,winRate:netPnl>0?100:0,netPnl,netPnlPct,_sort:netPnl},session.date));
  });
  const total=rows.reduce((s,r)=>s+(r.netPnl||0),0);
  const unknownRows=rows.filter(r=>r.netPnl==null).length;
  // Only return Orders.csv result if there are actual sell rows — if today only has buys,
  // fall through to tradebook so yesterday's session P&L shows instead of ₹0.
  if(!rows.length) return null;
  return {source:'Orders.csv',date:session.date,total,rows,unknownRows,hasOrders:session.orders.length>0};
}

function getTodayBookedAddendum(){
  const booked=computeLatestOrderBooked();
  if(!booked?.rows?.length) return null;
  const tbDate=TRADEBOOK_STATS?._loadedThisSession?(TRADEBOOK_STATS.lastDate||''):'';
  if(tbDate&&booked.date&&tbDate>=booked.date) return null; // already settled — never double-count
  const known=booked.rows.filter(r=>r.netPnl!=null&&isFinite(r.netPnl));
  if(!known.length) return null;
  return {
    date:booked.date,
    amount:+known.reduce((s,r)=>s+r.netPnl,0).toFixed(0),
    lots:known.length,
    unknownRows:booked.unknownRows||0,
    tradebookDate:tbDate||null
  };
}
function getLatestBookedSummary(){
  const orderBooked=computeLatestOrderBooked();
  const currentOrderSession=ORDERS_TODAY?._loadedThisSession?getLatestOrderSession():null;
  const hasCurrentSellOrders=!!currentOrderSession?.orders?.some(o=>o.type==='SELL');
  const tbLoaded=TRADEBOOK_STATS?._loadedThisSession&&TRADEBOOK_STATS?.lastDayRows?.length;

  // Current-session sell orders are fresher than a completed prior-day tradebook export.
  // Even if some P&L fields are incomplete, do not replace today's sells with yesterday's session.
  if(hasCurrentSellOrders) return orderBooked||{source:'Orders.csv',date:currentOrderSession.date,total:0,rows:[],unknownRows:0,hasOrders:true};

  // If both available, pick whichever has the more recent date
  if(orderBooked&&tbLoaded){
    const ordDate=orderBooked.date||'';
    const tbDate=TRADEBOOK_STATS.lastDate||'';
    if(tbDate>ordDate){
      // Tradebook has a newer session (e.g. GTT triggered day after Orders.csv)
      const rows=TRADEBOOK_STATS.lastDayRows.map(r=>enrichExitPnlRow({...r,_sort:r.netPnl},tbDate));
      return {source:'Tradebook',date:tbDate,total:+rows.reduce((s,r)=>s+r.netPnl,0).toFixed(0),rows,unknownRows:0};
    }
    return orderBooked;
  }
  if(orderBooked) return orderBooked;
  if(tbLoaded){
    const rows=TRADEBOOK_STATS.lastDayRows.map(r=>enrichExitPnlRow({...r,_sort:r.netPnl},TRADEBOOK_STATS.lastDate||null));
    return {source:'Tradebook',date:TRADEBOOK_STATS.lastDate||'',total:+rows.reduce((s,r)=>s+r.netPnl,0).toFixed(0),rows,unknownRows:0};
  }
  return null;
}

function getSameDayExitOpportunitySummary(){
  const entries=Object.values(FS.get(SAME_DAY_EXIT_OPPORTUNITY_STORE)?.entries||{})
    .filter(entry=>entry&&entry.avgSell>0&&entry.sellValue>0&&isFinite(entry.missedGainPct));
  const sellValue=entries.reduce((sum,entry)=>sum+entry.sellValue,0);
  const avgMissed=sellValue>0?entries.reduce((sum,entry)=>sum+(entry.missedGainPct*entry.sellValue),0)/sellValue:0;
  const realisedEntries=entries.filter(entry=>entry.avgBuy>0&&entry.qty>0&&isFinite(entry.realisedPnlPct));
  const buyValue=realisedEntries.reduce((sum,entry)=>sum+(entry.avgBuy*entry.qty),0);
  const avgRealised=buyValue>0?realisedEntries.reduce((sum,entry)=>sum+(entry.realisedPnlPct*entry.avgBuy*entry.qty),0)/buyValue:null;
  return {
    exits:entries.length,
    upsideExits:entries.filter(entry=>entry.missedGainPct>0).length,
    avgRealised:avgRealised==null?null:+avgRealised.toFixed(2),
    avgMissed:+avgMissed.toFixed(2),
    missedValue:+entries.reduce((sum,entry)=>sum+(entry.missedGainPct/100)*entry.sellValue,0).toFixed(0),
    nudge:+(avgMissed*0.25).toFixed(2),
  };
}

// ── Goal engine (v482): required NET daily compounding rate toward the owner's corpus target ──
// Compass, not throttle: informs pace/capital planning only; never alters harvest targets,
// scoring, or allocation. Config persists in brain (GOAL_STORE) for cross-device sync.
const GOAL_STORE='rs_goal_v1';
let _repsState=null; // {date,lastTotal,lastDelta} — session-only reps trigger state (v483)
let _goalCfgMemo=null;
function getGoalConfig(){
  const raw=FS.get(GOAL_STORE)||{};
  const day=getSessionDate();
  if(_goalCfgMemo&&_goalCfgMemo.raw===raw&&_goalCfgMemo.day===day) return _goalCfgMemo.v;
  const v=_computeGoalConfig(raw);
  _goalCfgMemo={raw,day,v};
  return v;
}
function _computeGoalConfig(rawCfg){
  const g=rawCfg||{};
  const target=(Number(g.target)>0)?Number(g.target):10000000;
  const withdrawMonthly=Math.max(0,Number(g.withdrawMonthly)||0);
  // v1129: withdrawals return as an AMOUNT + FREQUENCY. A legacy `withdrawMonthly` migrates to the
  // equivalent monthly schedule, so an older brain keeps the number the owner last typed.
  const withdrawAmount=Number.isFinite(Number(g.withdrawAmount))&&Number(g.withdrawAmount)>=0
    ? Math.max(0,Number(g.withdrawAmount)) : withdrawMonthly;
  const withdrawFreq=GOAL_WITHDRAW_FREQS.includes(g.withdrawFreq)?g.withdrawFreq:'monthly';
  const reinvestPct=(g.reinvestPct===''||g.reinvestPct==null||!isFinite(Number(g.reinvestPct)))
    ?55:Math.min(100,Math.max(0,Number(g.reinvestPct)));
  const isDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v);
  let endDate=isDate(g.endDate)?g.endDate:null;
  // Migrate the v522–v531 {days, anchorDate} horizon into the equivalent deadline,
  // preserving the runway the user still had left. Legacy {date} maps straight across.
  if(!endDate&&isDate(g.date)) endDate=g.date;
  if(!endDate&&Number(g.days)>0){
    const elapsed=isDate(g.anchorDate)?Math.max(0,Number(tradingDaysBetween(g.anchorDate,getSessionDate()))||0):0;
    endDate=goalImpliedEndDate(Math.max(0,Math.floor(Number(g.days))-elapsed));
  }
  if(!endDate) endDate=goalImpliedEndDate(250); // ~one trading year default
  return {target,endDate,days:goalTradingDaysUntil(endDate),withdrawMonthly,
          withdrawAmount,withdrawFreq,reinvestPct};
}
function goalRemainingDays(g){return Math.max(0,Number(g.days)||0);}
// Implied calendar end date: walk N trading days forward from today (display hint only).
function goalImpliedEndDate(remainingDays){
  const cur=new Date(getSessionDate()+'T12:00:00Z');
  let n=0,guard=0;
  while(n<remainingDays&&guard++<2600){
    cur.setUTCDate(cur.getUTCDate()+1);
    const dow=cur.getUTCDay();
    if(dow!==0&&dow!==6&&!NSE_HOLIDAYS.has(cur.toISOString().slice(0,10))) n++;
  }
  return cur.toISOString().slice(0,10);
}
let _goalChangeTimer=null;
function onGoalChange(immediate){
  clearTimeout(_goalChangeTimer);
  if(immediate===true) return _applyGoalChange();
  _goalChangeTimer=setTimeout(_applyGoalChange,180);
}
function refreshGoalReadout(){
  const el=document.getElementById('goalReadout');
  if(el) el.innerHTML=buildGoalReadout();
}
function _applyGoalChange(){
  const t=parseFloat(document.getElementById('goalTarget')?.value);
  const e=String(document.getElementById('goalEnd')?.value||'').trim();
  const w=parseFloat(document.getElementById('goalWd')?.value);
  const wf=String(document.getElementById('goalWdFreq')?.value||'').trim();
  const cur=getGoalConfig();
  _goalCfgMemo=null;FS.set(GOAL_STORE,{
    target:t>0?t:cur.target,
    endDate:/^\d{4}-\d{2}-\d{2}$/.test(e)?e:cur.endDate,
    withdrawMonthly:cur.withdrawMonthly,           // legacy field, kept so an older build still reads
    withdrawAmount:Number.isFinite(w)&&w>=0?w:cur.withdrawAmount,
    withdrawFreq:GOAL_WITHDRAW_FREQS.includes(wf)?wf:cur.withdrawFreq,
    reinvestPct:(()=>{const v=document.getElementById('goalReinvest');if(!v)return cur.reinvestPct;
      const t=String(v.value||'').trim();if(t==='')return null;
      const n=Number(t);return isFinite(n)?Math.min(100,Math.max(0,n)):cur.reinvestPct;})()
  });
  invalidateTargetAnchorCaches();   // capital/goal feed the anchor; a stale memo would show old maths
  renderStats();
  refreshGoalReadout();             // NOT renderGoalPopover(): that would replace the live field
  scheduleApplyFilters();           // the required rate moves targets, which moves the board
}
function goalTradingDaysUntil(dateStr){
  const end=new Date(dateStr+'T12:00:00Z');
  if(!isFinite(end.getTime())) return 0;
  const cur=new Date(getSessionDate()+'T12:00:00Z');
  let n=0;
  while(cur<end&&n<2600){
    cur.setUTCDate(cur.getUTCDate()+1);
    const dow=cur.getUTCDay();
    if(dow!==0&&dow!==6&&!NSE_HOLIDAYS.has(cur.toISOString().slice(0,10))) n++;
  }
  return n;
}
const GOAL_WITHDRAW_FREQS=['daily','weekly','monthly'];
function goalWeekKey(iso){
  const d=new Date(iso+'T12:00:00Z');
  d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));   // back to Monday
  return d.toISOString().slice(0,10);
}
// Incremental by design: the solver knows its horizon up front, the projector walks until the target
// is met, so the only shape both can share is "given the previous trading day and this one, is a
// withdrawal due now?". One definition, two callers, no chance of drift.
function goalWithdrawalDue(prevIso,curIso,freq){
  if(!prevIso||!curIso) return false;
  if(freq==='daily') return true;
  if(freq==='weekly') return goalWeekKey(curIso)!==goalWeekKey(prevIso);
  if(freq==='monthly') return curIso.slice(0,7)!==prevIso.slice(0,7);
  return false;
}
function normaliseGoalWithdrawal(g){
  const amt=Math.max(0,Number(g&&g.withdrawAmount)||0);
  const freq=GOAL_WITHDRAW_FREQS.includes(g&&g.withdrawFreq)?g.withdrawFreq:'monthly';
  return {amt,freq};
}
function solveGoalDailyRate(start,target,days,wd,reinvestPct){
  if(!(start>0)||!(days>0)||!(target>0)) return null;
  // v1129: the horizon is walked as DATED trading steps, not as calendar gaps, because a weekly or
  // monthly withdrawal falls due on a calendar boundary that a gap count cannot see.
  const steps=[];
  {
    const cur=new Date(getSessionDate()+'T12:00:00Z');
    let n=0,guard=0;
    while(n<days&&guard++<2600){
      cur.setUTCDate(cur.getUTCDate()+1);
      const dow=cur.getUTCDay(), iso=cur.toISOString().slice(0,10);
      if(dow!==0&&dow!==6&&!NSE_HOLIDAYS.has(iso)){steps.push(iso);n++;}
    }
  }
  const W=normaliseGoalWithdrawal(typeof wd==='object'&&wd?wd:{withdrawAmount:wd,withdrawFreq:'monthly'});
  const reinvest=Math.min(1,Math.max(0,(reinvestPct==null||!isFinite(Number(reinvestPct)))?0.55:Number(reinvestPct)/100));
  const earned=r=>{
    let c=start,e=0,prev=null;
    for(let i=0;i<steps.length;i++){
      if(c<=0){c=0;prev=steps[i];continue;}
      const gain=c*r;
      e+=gain;                     // full gain is earned...
      c=c+gain*reinvest;           // ...but only the reinvested share compounds
      // ...and the scheduled withdrawal leaves the account whether or not the day earned.
      if(W.amt>0&&goalWithdrawalDue(prev,steps[i],W.freq)) c=Math.max(0,c-W.amt);
      prev=steps[i];
    }
    return e;
  };
  if(earned(0.5)<target) return null;
  let lo=0,hi=0.5;
  for(let i=0;i<60;i++){const mid=(lo+hi)/2;if(earned(mid)>=target)hi=mid;else lo=mid;}
  return hi;
}
function projectGoalCompletionDate(start,target,netPctPerDay,wd,reinvestPct){
  if(!(start>0)||!(target>0)||!(netPctPerDay>0)) return null;
  const r=netPctPerDay/100;
  const reinvest=Math.min(1,Math.max(0,(reinvestPct==null||!isFinite(Number(reinvestPct)))?0.55:Number(reinvestPct)/100));
  const W=normaliseGoalWithdrawal(typeof wd==='object'&&wd?wd:{withdrawAmount:wd,withdrawFreq:'monthly'});
  const cur=new Date(getSessionDate()+'T12:00:00Z');
  let c=start,e=0,guard=0,prev=null;
  while(guard++<2600){
    cur.setUTCDate(cur.getUTCDate()+1);
    const dow=cur.getUTCDay(), iso=cur.toISOString().slice(0,10);
    if(dow===0||dow===6||NSE_HOLIDAYS.has(iso)) continue;   // not a trading day: no earning, no drain
    if(c<=0){prev=iso;continue;}
    const gain=c*r;
    e+=gain;                 // full gain is earned...
    c=c+gain*reinvest;       // ...only the reinvested share compounds
    if(W.amt>0&&goalWithdrawalDue(prev,iso,W.freq)) c=Math.max(0,c-W.amt);
    prev=iso;
    if(e>=target) return iso;
  }
  return null;
}
function fileDateISO(ms){
  const n=Number(ms);
  if(!Number.isFinite(n)||n<=0) return null;
  return new Date(n+5.5*3600*1000).toISOString().slice(0,10);
}
function positionsAlreadySettled(){
  const h=PORTFOLIO_FILE_DATES&&PORTFOLIO_FILE_DATES.holdings;
  const pd=PORTFOLIO_FILE_DATES&&PORTFOLIO_FILE_DATES.positions;
  if(!h||!pd) return false;   // unknown -> behave as before (additive)
  return h>pd;
}
function getCapitalBuckets(){
  const liveBySym=new Map((typeof ALL!=='undefined'?ALL:[]).map(r=>[r.symbol,Number(r.price)||0]));
  const px=(sym,fb)=>liveBySym.get(sym)||Number(fb)||0;
  let delivery=0;
  (HOLDINGS||[]).forEach(h=>{ if(h&&h.qty>0) delivery+=h.qty*px(h.symbol,h.ltp||h.avgCost); });
  // Two independent reasons a position's buy leg must NOT be added on top of holdings:
  //  1. holdings.csv is dated later than positions.csv -> T+1 settled it in already.
  //  2. PORTFOLIO_STALE says the positions/orders files are from a prior session.
  const posStale=positionsAlreadySettled()
    ||!!(typeof PORTFOLIO_STALE!=='undefined'&&PORTFOLIO_STALE&&PORTFOLIO_STALE.stale);
  let todayBuys=0,buyCost=0,sellProceeds=0;
  (POSITIONS||[]).forEach(pp=>{
    if(!pp||!isFinite(Number(pp.qty))) return;
    const q=Number(pp.qty)||0, avg=Number(pp.avg??pp.avgCost)||0;
    if(q>0){
      buyCost+=q*avg;                                   // cash spent today
      if(!posStale) todayBuys+=q*px(pp.symbol,pp.ltp||avg); // not yet in holdings
    } else if(q<0){
      sellProceeds+=Math.abs(q)*avg;                    // capital freed today
    }
  });
  const idleCash=Math.max(0,+(sellProceeds-buyCost).toFixed(0));
  delivery=+delivery.toFixed(0); todayBuys=+todayBuys.toFixed(0);
  return {delivery,todayBuys,sellProceeds:+sellProceeds.toFixed(0),buyCost:+buyCost.toFixed(0),
          idleCash,posStale,
          invested:delivery+todayBuys,
          total:Math.max(0,delivery+todayBuys+idleCash)};
}
let _capitalMemo=null;
function getComputedCapital(){
  if(_capitalMemo&&_capitalMemo.h===HOLDINGS&&_capitalMemo.p===POSITIONS
     &&_capitalMemo.o===ORDERS_TODAY&&_capitalMemo.a===ALL) return _capitalMemo.v;
  const v=_computeCapitalUncached();
  _capitalMemo={h:HOLDINGS,p:POSITIONS,o:ORDERS_TODAY,a:ALL,v};
  return v;
}
function _computeCapitalUncached(){
  const b=getCapitalBuckets();
  // `positions` is kept as a reported field for the existing sub-lines; it is today's un-settled
  // buys only, never a second copy of the holdings.
  return {holdings:b.delivery,positions:b.todayBuys,invested:b.invested,
          sells:b.sellProceeds,buys:b.buyCost,idleCash:b.idleCash,posStale:b.posStale,
          total:b.total};
}
function getDefaultCapital(){ return getComputedCapital().total; }
let _defMaxAllocMemo=null;
let _avgTradesMemo=null;
function getAverageTradesPerEntryDay(){
  const tb=TRADEBOOK_STATS?.tripsData;
  if(_avgTradesMemo&&_avgTradesMemo.tb===tb) return _avgTradesMemo.avg;
  const trips=getAdaptiveTradeTrips(tb||[]);
  if(!trips.length) return null;
  const avg=Number(computePerfStats(trips).avgPositionsPerEntryDay);
  const value=Number.isFinite(avg)&&avg>0?avg:null;
  _avgTradesMemo={tb,avg:value};
  return value;
}
function getDefaultMaxAlloc(){
  const tb=TRADEBOOK_STATS?.tripsData;
  const capital=getEffectiveCapital();
  if(_defMaxAllocMemo&&_defMaxAllocMemo.tb===tb&&_defMaxAllocMemo.capital===capital) return _defMaxAllocMemo.v;
  const avgTrades=getAverageTradesPerEntryDay();
  const v=capital>0&&avgTrades>0?Math.round(capital/avgTrades):0;
  _defMaxAllocMemo={tb,capital,v,avgTrades};
  return v;
}
function getEffectiveCapital(){
  const v=parseFloat(document.getElementById('fCapital')?.value);
  return (Number.isFinite(v)&&v>0)?v:getDefaultCapital();
}
function getEffectiveMaxAlloc(){
  const v=parseFloat(document.getElementById('fMaxAlloc')?.value);
  return (Number.isFinite(v)&&v>0)?v:getDefaultMaxAlloc();
}
function rowRiskRupees(notional,stopPct){
  const n=Number(notional),s=Number(stopPct);
  return (n>0&&s>0)?n*(s/100):0;
}
// The notional at which this row's own stop costs exactly `riskRs`. Infinity = no budget set.
function riskNotionalCap(s,riskRs){
  if(!(riskRs>0)) return Infinity;
  const stop=getRowStopDistancePct(s);
  return stop>0?riskRs/(stop/100):Infinity;
}
let _defRiskMemo=null;
function getDefaultRiskPerTrade(){
  const maxAlloc=getEffectiveMaxAlloc();
  if(!(maxAlloc>0)) return 0;
  const pool=(FILT&&FILT.length?FILT:ALL)||[];
  const stops=pool.map(getRowStopDistancePct).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);
  if(!stops.length) return 0;
  const sig=maxAlloc+'|'+stops.length+'|'+stops[0]+'|'+stops.at(-1);
  if(_defRiskMemo&&_defRiskMemo.sig===sig) return _defRiskMemo.v;
  const mid=stops.length%2?stops[(stops.length-1)/2]:(stops[stops.length/2-1]+stops[stops.length/2])/2;
  const v=Math.round(rowRiskRupees(maxAlloc,mid));
  _defRiskMemo={sig,v,medianStopPct:mid};
  return v;
}
function getEffectiveRiskPerTrade(){
  const v=parseFloat(document.getElementById('fRiskPerTrade')?.value);
  return (Number.isFinite(v)&&v>0)?v:0;
}
function allocLimitReason(caps){
  const {score,max,turnover,topUp,risk}=caps;
  const lo=Math.min(score,max,turnover,topUp,risk),e=0.01;
  if(topUp<=lo+e) return 'top-up average cost';
  if(turnover<=lo+e) return 'turnover';
  if(max<=lo+e) return 'max allocation';
  if(risk<=lo+e) return 'risk cap';
  return 'risk weight';
}

// The notional a row can actually reach. Uses only ROW-INTRINSIC and SESSION-WIDE rails; the
// score-weight share is deliberately EXCLUDED (v1080/v1086), because that one depends on which OTHER
// stocks were selected and admitting it would make a stock's rank depend on its neighbours.
function rowAchievableNotional(s,ctx=null){
  const c=ctx||getAllocationPassContext();
  const buyP=getBuyPrice(s);
  if(!(buyP>0)) return 0;
  const turnoverCap=getTurnoverAllocationCap(s);
  if(!(turnoverCap>0)) return 0;
  const topUpCap=getHeldTopUpNotionalCap(s,buyP,c.heldMap);
  const riskCap=riskNotionalCap(s,c.riskPerTrade);
  const maxCap=c.maxAlloc>0?c.maxAlloc:c.capital;
  const v=Math.min(maxCap,turnoverCap,topUpCap,riskCap);
  return Number.isFinite(v)&&v>0?v:0;
}
// What ONE position in this stock is actually worth, in rupees, at a given notional: whole shares and
// the full Zerodha charge model on both legs. This is the number the owner trades on.
function getRowRupeeEconomics(s,notional,policy=null,ctx=null){
  const buyP=getBuyPrice(s);
  const pol=policy||getRowExitPolicy(s,buyP,(ctx||getAllocationPassContext()).active);
  const out={qty:0,notional:0,grossRs:0,chargesRs:0,netRs:0,riskRs:0,
             tgtPct:pol?.targetPct??null,stopPct:pol?.stopPct??null};
  if(!(buyP>0)||!(notional>0)||!(pol?.targetPct>0)) return out;
  const qty=Math.floor(notional/buyP);
  if(qty<=0) return out;
  const sellP=buyP*(1+pol.targetPct/100);
  out.qty=qty;
  out.notional=qty*buyP;
  out.grossRs=qty*buyP*(pol.targetPct/100);
  out.chargesRs=calcZerodhaCharges(buyP,qty,false)+calcZerodhaCharges(sellP,qty,true);
  out.netRs=out.grossRs-out.chargesRs;
  out.riskRs=pol.stopPct>0?qty*buyP*(pol.stopPct/100):0;
  return out;
}
// The SAME economic floor as HARVEST_DESIRED_NET_PCT, expressed in rupees at the reference notional.
// NOT a new constant - a conversion of the existing one - but applied against each row's ACTUAL
// rupees, which is what makes it discriminate where the percentage never could.
function getDesiredNetRupees(){
  const ref=getEffectiveMaxAlloc();
  return ref>0?ref*(HARVEST_DESIRED_NET_PCT/100):0;
}
// Rupees the goal needs TODAY, and what is still outstanding after what is already booked. Extracted
// from buildGoalCard (v1078), which computed it inline and so could not share it with the basket.
function getTodayRupeeNeed(){
  const g=getGoalConfig();
  const basis=getGoalPortfolioBasis();
  const days=goalRemainingDays(g);
  if(!(basis>0)||!(days>0)) return null;
  const r=solveGoalDailyRate(basis,g.target,days,g,g.reinvestPct);
  if(!(r>0)) return null;
  const need=basis*r;                                  // r is a FRACTION, not a percent
  let booked=null;
  try{const b=getLatestBookedSummary(); if(b&&Number.isFinite(Number(b.total))) booked=Number(b.total);}catch(e){}
  return {need,booked,outstanding:Math.max(0,need-(booked||0))};
}
function getBasketRupeeProjection(allocMap){
  const rows=Object.values(allocMap||{}).filter(a=>a&&!a.rejected&&a.qty>0);
  const expectedNet=rows.reduce((sum,a)=>sum+(Number(a.expectedNet)||0),0);
  const riskRs=rows.reduce((sum,a)=>sum+(Number(a.riskRs)||0),0);
  const deployed=rows.reduce((sum,a)=>sum+(Number(a.debit)||0),0);
  const t=getTodayRupeeNeed();
  return {positions:rows.length,deployed,expectedNet,riskRs,
          need:t?t.need:null,booked:t?t.booked:null,outstanding:t?t.outstanding:null,
          coverPct:(t&&t.outstanding>0)?(expectedNet/t.outstanding*100):null};
}
// Show each default in its field's placeholder so an empty field visibly reflects what the
// calculation will use (grey = default in effect; a typed value = your override).
function updateFilterPlaceholders(){
  const capEl=document.getElementById('fCapital');
  if(capEl){ const d=getDefaultCapital(); if(d>0){ capEl.placeholder=String(Math.round(d)); capEl.title=`Empty = your computed capital ₹${Math.round(d).toLocaleString('en-IN')} (holdings + open positions). Type a value to override.`; } }
  const maxEl=document.getElementById('fMaxAlloc');
  if(maxEl){ const d=getDefaultMaxAlloc(),avg=getAverageTradesPerEntryDay(),capital=getEffectiveCapital(); if(d>0&&avg>0){ maxEl.placeholder=String(d); maxEl.title=`Empty = Capital ₹${Math.round(capital).toLocaleString('en-IN')} ÷ ${avg.toFixed(2)} average positions per entry day = ₹${d.toLocaleString('en-IN')}. Type a value to override the per-stock cap.`; } else { maxEl.placeholder='need trade history'; } }
  const riskEl=document.getElementById('fRiskPerTrade');
  if(riskEl){ const d=getDefaultRiskPerTrade(),med=_defRiskMemo?.medianStopPct,ma=getEffectiveMaxAlloc();
    if(d>0&&med>0){ riskEl.placeholder=String(d);
      riskEl.title=`Empty = NO cap; sizing follows Radar score ÷ stop distance and the existing rails, which today imply about ₹${d.toLocaleString('en-IN')} at risk for a full Max Alloc ₹${Math.round(ma).toLocaleString('en-IN')} position at the ${med.toFixed(2)}% median stop. Type a value to cap what any one position may lose — it can only shrink a position, never grow one.`; }
    else { riskEl.placeholder='auto'; } }
  const tgtEl=document.getElementById('fTgtOverride');
  if(tgtEl){ let d=0; try{d=getDefaultTgtPct();}catch(e){} if(d>0){ tgtEl.placeholder=d.toFixed(1); tgtEl.title=`Empty = the auto portfolio target anchor ${d.toFixed(1)}% (lower of learned Harvest / goal-led). A typed value replaces the anchor; each stock still gets its own capacity-aware target.`; } }
}
// Goal capital basis = effective capital (the field if the owner typed one, else the
// computed deployed book). An empty field means the default, never zero.
function getGoalFreeCapitalParts(){
  const c=getComputedCapital();
  const typed=parseFloat(document.getElementById('fCapital')?.value);
  const hasManual=Number.isFinite(typed)&&typed>0;
  const total=hasManual?typed:c.total;
  // v1078: report the real cash components instead of the hardcoded zeros left over from the
  // v539-v543 saga. A manual override still wins outright and is reported as such.
  return {holdings:c.holdings,positions:c.positions,computed:c.total,field:hasManual?typed:0,
          overridden:hasManual&&Math.round(typed)!==Math.round(c.total),
          invested:hasManual?typed:(c.invested??c.total),cap:hasManual?typed:0,
          sells:hasManual?0:c.sells,buys:hasManual?0:c.buys,
          idleCash:hasManual?0:c.idleCash,cash:hasManual?0:c.idleCash,
          posStale:c.posStale,
          free:total,total:Math.max(0,total)};
}
function getGoalPortfolioBasis(){return getGoalFreeCapitalParts().total;}
let _goalRateCache=null;
// Required NET %/trading day toward the goal, on FREE capital. Informational only:
// this compass display never alters harvest targets, scoring, or allocation.
function getGoalRequiredNetPct(){
  const g=getGoalConfig();
  const basis=getGoalPortfolioBasis();
  const days=goalRemainingDays(g);
  const key=[g.target,g.endDate,days,g,g.reinvestPct,Math.round(basis)].join('|');
  if(_goalRateCache?.key===key) return _goalRateCache.v;
  const r=solveGoalDailyRate(basis,g.target,days,g,g.reinvestPct);
  const v=(r!=null&&r>0)?+(r*100).toFixed(3):null;
  _goalRateCache={key,v};
  return v;
}
function getGoalAchievedDailyRate(basis){
  const trips=TRADEBOOK_STATS?.tripsData;
  if(!Array.isArray(trips)||!trips.length||!(basis>0)) return null;
  const cutoff=new Date(getSessionDate()+'T12:00:00Z');cutoff.setUTCDate(cutoff.getUTCDate()-30);
  const cutStr=cutoff.toISOString().slice(0,10);
  let net=0;const days=new Set();
  trips.forEach(r=>{if(r.sellDate&&String(r.sellDate)>=cutStr){net+=Number(r.netPnl)||0;days.add(r.sellDate);}});
  if(!days.size) return null;
  const span=tradingDaysBetween(cutStr,getSessionDate());
  const tradingDays=Math.max(days.size,Number(span)||0);
  return tradingDays>0?(net/tradingDays)/basis:null;
}
function goalFmtRs(v){
  const n=Number(v)||0;
  if(Math.abs(n)>=1e7) return (n/1e7).toFixed(2)+'Cr';
  if(Math.abs(n)>=1e5) return (n/1e5).toFixed(1)+'L';
  if(Math.abs(n)>=1e3) return (n/1e3).toFixed(1)+'K';
  return Math.round(n).toLocaleString('en-IN');
}
// Celebration/punishment reps (v482): profit ₹ = steps to walk; |loss| ÷ 100 = pushups.
function goalRepsHTML(v){
  const n=Number(v)||0;
  if(n>0) return `<div style="font-size:11px;color:var(--green)">🎉 ${Math.round(n).toLocaleString('en-IN')} steps</div>`;
  if(n<0) return `<div style="font-size:11px;color:var(--red)">💪 ${Math.max(1,Math.ceil(Math.abs(n)/100))} pushups</div>`;
  return '';
}
function goalFieldStyle(accent){
  return `width:100%;padding:7px 9px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;`
    +`color:var(--t1);font-family:'DM Mono',monospace;font-size:14px;outline:none;transition:border .2s`;
}
// A stat tile that matches the dashboard cards, at popover scale.
function goalTile(label,value,valueColor,detail,title){
  return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:10px 12px"${title?` title="${escHtml(title)}"`:''}>`
    +`<div style="font-size:12px;text-transform:uppercase;letter-spacing:1.1px;color:var(--t3);font-weight:600">${label}</div>`
    +`<div style="font-size:20px;font-weight:800;margin-top:3px;font-family:'DM Mono',monospace;color:${valueColor}">${value}</div>`
    +(detail?`<div style="font-size:12px;color:var(--t2);margin-top:2px;line-height:1.45">${detail}</div>`:'')
    +`</div>`;
}
function buildGoalPopoverContent(){
  const g=getGoalConfig();
  const _lbl='font-size:12px;font-weight:600;color:var(--t2);padding-left:2px;display:block;margin-bottom:3px';
  const remaining=goalRemainingDays(g);
  const basis=getGoalPortfolioBasis();
  const req=getGoalRequiredNetPct();
  const ach=basis>0?getGoalAchievedDailyRate(basis):null;

  return `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px">
    <div style="font-size:15px;color:var(--t1);font-weight:800">Goal</div>
    <div style="font-size:12px;color:var(--t3)">${remaining} trading day${remaining===1?'':'s'} left</div>
  </div>
  <div style="display:grid;grid-template-columns:1.15fr 1.35fr .8fr;gap:8px">
    <label><span style="${_lbl}">Earn ₹</span><input id="goalTarget" type="number" value="${g.target}" style="${goalFieldStyle()}" oninput="onGoalChange()" onchange="onGoalChange(true)" onfocus="this.style.borderColor='var(--amber)'" onblur="this.style.borderColor='var(--border)'" title="Trading profit to generate from current total capital within the horizon — not a balance to reach."></label>
    <label><span style="${_lbl}">By</span><input id="goalEnd" type="date" min="${getSessionDate()}" value="${g.endDate}" style="${goalFieldStyle()}" oninput="onGoalChange()" onchange="onGoalChange(true)" onfocus="this.style.borderColor='var(--amber)'" onblur="this.style.borderColor='var(--border)'" title="Deadline for the earnings target. Trading days left are counted from today to this date, skipping weekends and NSE holidays."></label>
    <label><span style="${_lbl}">Withdraw ₹</span><input id="goalWd" type="number" min="0" step="100" placeholder="0" value="${g.withdrawAmount?g.withdrawAmount:''}" oninput="onGoalChange()" onchange="onGoalChange(true)" title="A FIXED rupee amount you take out of the account on the schedule beside this — rent, salary, expenses. It leaves whether or not the day earned, so it shrinks the compounding base and RAISES the daily rate the goal needs. Separate from Reinvest %, which only splits the days that do earn. Blank or 0 = no scheduled withdrawal." style="${goalFieldStyle()}" onfocus="this.style.borderColor='var(--amber)'" onblur="this.style.borderColor='var(--border)'"></label>
    <label><span style="${_lbl}">Every</span><select id="goalWdFreq" onchange="onGoalChange(true)" title="How often the Withdraw ₹ amount leaves the account. Daily = every trading day; Weekly = the first trading day of each new week; Monthly = the first trading day of each new month." style="${goalFieldStyle()}" onfocus="this.style.borderColor='var(--amber)'" onblur="this.style.borderColor='var(--border)'">
      <option value="daily"${g.withdrawFreq==='daily'?' selected':''}>Day</option>
      <option value="weekly"${g.withdrawFreq==='weekly'?' selected':''}>Week</option>
      <option value="monthly"${g.withdrawFreq==='monthly'?' selected':''}>Month</option>
    </select></label>
    <label><span style="${_lbl}">Reinvest %</span><input id="goalReinvest" type="number" min="0" max="100" step="1" placeholder="55" value="${g.reinvestPct==null?'':g.reinvestPct}" oninput="onGoalChange()" onchange="onGoalChange(true)" title="Share of each day's gain that stays invested and compounds; the rest is taken out as cash. Blank uses 55%." style="${goalFieldStyle()}" onfocus="this.style.borderColor='var(--amber)'" onblur="this.style.borderColor='var(--border)'"></label>
  </div>
  <div id="goalReadout">${buildGoalReadout()}</div>`;
}
function buildGoalReadout(){
  const g=getGoalConfig();
  const remaining=goalRemainingDays(g);
  const basis=getGoalPortfolioBasis();
  const req=getGoalRequiredNetPct();
  const ach=basis>0?getGoalAchievedDailyRate(basis):null;
  // DEMAND — what the goal asks of every trading day, in both % and rupees.
  const needTile=(()=>{
    if(!(basis>0)) return goalTile('Need per day','—','var(--t3)',
      'Load Holdings/Positions, or type a Capital ₹, to compute the required rate');
    if(!(remaining>0)) return goalTile('Need per day','deadline reached','var(--amber)',
      'Pick a later date above');
    if(req==null) return goalTile('Need per day','not reachable','var(--red)',
      'This target and deadline would need over 50% a day');
    const _wdAmt=Number(g.withdrawAmount)||0;
    let _wdNote='';
    if(_wdAmt>0){
      const _bare=solveGoalDailyRate(basis,g.target,remaining,{withdrawAmount:0,withdrawFreq:g.withdrawFreq},g.reinvestPct);
      if(_bare!=null){
        const _bp=_bare*100, _add=req-_bp;
        const _perMonth=g.withdrawFreq==='daily'?_wdAmt*21:g.withdrawFreq==='weekly'?_wdAmt*4.33:_wdAmt;
        const _share=basis>0?(_perMonth/basis*100):0;
        _wdNote=` · of which <b style="color:${_add>_bp?'var(--red)':'var(--amber)'}">${_add>0?'+':''}${_add.toFixed(2)}%</b> is your ${fmtINR(_wdAmt)} ${g.withdrawFreq} withdrawal (${_share.toFixed(0)}% of capital a month); without it ${_bp.toFixed(2)}%`;
      }
    }
    return goalTile('Need per day','+'+req.toFixed(2)+'%','var(--amber)',
      `≈ ₹${goalFmtRs(basis*req/100)} net on ₹${goalFmtRs(basis)} capital${_wdNote}`,
      'Required NET earnings per NSE trading day, as % of capital. Capital defaults to your computed deployed book and is overridden by the Capital ₹ filter field.');
  })();

  // REALITY — what the tradebook says is actually happening, over the last 30 days.
  const paceTile=(()=>{
    if(ach==null) return goalTile('Your pace (30d)','—','var(--t3)','Not enough tradebook history yet');
    const pct=ach*100;
    const onTrack=req!=null&&pct>=req;
    return goalTile('Your pace (30d)',(pct>=0?'+':'')+pct.toFixed(2)+'%',
      pct<=0?'var(--red)':onTrack?'var(--green)':'var(--amber)',
      `≈ ₹${goalFmtRs(basis*pct/100)} a day realised${req!=null?(onTrack?' · ahead of the rate':' · short of the rate'):''}`,
      'Realised net P&L per trading day over the last 30 days, divided by capital.');
  })();

  return `  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">${needTile}${paceTile}</div>
  ${(()=>{
    // Projected finish date. PRIMARY = your REALISTIC pace from the tradebook (what you
    // actually earn per day, 30d) — the honest picture the owner asked for (v544).
    // SECONDARY = context if the portfolio target anchor were realised every session.
    if(!(basis>0)) return '';
    const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const readable=d=>{const [y,m,dd]=d.split('-');return `${+dd} ${MON[+m-1]} ${y}`;};
    const gapTxt=proj=>{
      const late=proj>g.endDate;
      const calDays=Math.abs(Math.round((new Date(proj+'T12:00:00Z')-new Date(g.endDate+'T12:00:00Z'))/86400000));
      const t=calDays<=1?'right on your deadline'
        :calDays<45?`≈ ${calDays} days ${late?'after':'ahead of'} your ${readable(g.endDate)} deadline`
        :`≈ ${Math.round(calDays/30)} months ${late?'after':'ahead of'} your ${readable(g.endDate)} deadline`;
      return {late,t};
    };
    const dateSpan=proj=>{const{late}=gapTxt(proj);return `<b style="color:${late?'var(--amber)':'var(--green)'}">${readable(proj)}</b>`;};

    // PRIMARY — realized pace from the tradebook (getGoalAchievedDailyRate = net/day ÷ basis, 30d).
    let finishVal,finishColor,finishDetail;
    if(ach==null){
      finishVal='—';finishColor='var(--t3)';
      finishDetail='Not enough tradebook history to project a date';
    }else if(ach<=0){
      finishVal='no date';finishColor='var(--red)';
      finishDetail=`Losing ${Math.abs(ach*100).toFixed(2)}% a day — there is no finish date until this turns positive`;
    }else{
      const rp=projectGoalCompletionDate(basis,g.target,ach*100,g,g.reinvestPct);
      if(rp){
        const gap=gapTxt(rp);
        finishVal=readable(rp);finishColor=gap.late?'var(--amber)':'var(--green)';
        finishDetail=`${gap.t}, holding your ${(ach*100).toFixed(2)}%/day pace`;
      }else{
        finishVal='8+ years';finishColor='var(--red)';
        finishDetail=`At ${(ach*100).toFixed(2)}% a day this deadline is out of reach`;
      }
    }

    // SECONDARY — portfolio-anchor context, not a claim that every stock has this target.
    let bestHtml='';
    try{
      const at=getActiveTargetInfo();
      if(at?.tgtPct){
        const netPct=+(at.tgtPct-estimateRoundTripCostPct(at.tgtPct)).toFixed(3);
        if(netPct>0){
          const bp=projectGoalCompletionDate(basis,g.target,netPct,g,g.reinvestPct);
          const srcLbl=at.source==='manual'?'manual':at.source==='goal'?'goal-led':'Harvest';
          bestHtml=bp
            ? `If every session hit its ${at.tgtPct.toFixed(1)}% ${srcLbl} target: ${dateSpan(bp)}`
            : `At the ${srcLbl} anchor: 8+ years`;
        }
      }
    }catch(e){}

    return `<div style="margin-top:8px">`
      +goalTile('Projected finish',finishVal,finishColor,
        finishDetail+(bestHtml?`<br><span style="color:var(--t3)">${bestHtml}</span>`:''),
        'Projected from your realised 30-day pace, walking the real NSE calendar — the same arithmetic that solves the required rate, run forwards.')
      +`</div>`;
  })()}
  <div style="font-size:12px;color:var(--t3);margin-top:8px;line-height:1.5">${g.reinvestPct}% of each day's gain compounds · ${(100-g.reinvestPct).toFixed(0)}% taken out as cash</div>`;
}

function renderGoalPopover(){
  const content=document.getElementById('goalPopoverContent');
  if(!content) return;
  // v1110: never rebuild the popover while one of its inputs has focus — a re-render mid-edit
  // replaces the element and throws away what is being typed, which is how the reinvest field
  // appeared to "revert". renderStats() calls this on every scan and filter change.
  const a=document.activeElement;
  if(a&&content.contains(a)&&/^(INPUT|SELECT)$/.test(a.tagName)) return;
  content.innerHTML=buildGoalPopoverContent();
}
function buildGoalCard(){
  const g=getGoalConfig();
  const parts=getGoalFreeCapitalParts();
  const basis=parts.total;
  const days=goalRemainingDays(g);
  const req=days>0?solveGoalDailyRate(basis,g.target,days,g,g.reinvestPct):null;
  const ach=getGoalAchievedDailyRate(basis);
  if(!(basis>0)){
    return `<div class="st"><div class="st-l">Goal · earn ₹${goalFmtRs(g.target)} · ${days} td left</div><div class="st-v" style="color:var(--t3)">—</div><div class="st-d">basis ₹0 · load Holdings/Positions to value your book · need —/day · achieved —/day (30d)</div></div>`;
  }
  if(days<=0){
    return `<div class="st"><div class="st-l">Goal · earn ₹${goalFmtRs(g.target)}</div><div class="st-v" style="color:var(--amber)">horizon elapsed</div><div class="st-d">set a new day count in ⚙ Goal</div></div>`;
  }
  const reqStr=req==null?'>50':'+'+(req*100).toFixed(2);
  const needRs=req!=null?basis*req:null;
  const onTrack=req!=null&&ach!=null&&ach>=req;
  const col=req==null?'var(--red)':(onTrack?'var(--green)':'var(--amber)');
  const badge=ach!=null?(onTrack?'<span style="color:var(--green);font-size:13px">✓ on track</span>':'<span style="color:var(--amber);font-size:13px">behind</span>'):'<span style="color:var(--t3);font-size:13px">no 30d trades</span>';
  const freeStr=parts.overridden
    ?`capital ₹${goalFmtRs(basis)} (your Capital ₹ override · computed book ₹${goalFmtRs(parts.computed)})`
    :`capital ₹${goalFmtRs(basis)} (delivery ${goalFmtRs(parts.holdings)}${parts.positions?` + today's buys ${goalFmtRs(parts.positions)}`:''}${parts.idleCash?` + freed cash ${goalFmtRs(parts.idleCash)}`:''}${parts.posStale?' · positions file is a prior session, its buys already settled into delivery':''})`;
  const title='Required NET earnings per NSE trading day, as % of your capital. Capital = the Capital ₹ field, which DEFAULTS to your computed deployed book (holdings + every open position incl. BTST, from the CSVs) and can be overridden; clearing the field restores the default. Informational only; does not change targets.';
  // v1078 (owner): the card must answer TODAY (how much do I need to make, how much have I made)
  // and REMAINING (how much of the goal is left). "Need/day" was already here; today's PROGRESS
  // against it and the remaining target were not, so the card could not be acted on intra-day.
  const _needToday = (basis > 0 && req != null) ? basis * req : null;
  let _doneToday = null;
  try { const _b = getLatestBookedSummary(); if (_b && isFinite(Number(_b.total))) _doneToday = Number(_b.total); } catch (e) {}
  const _pctToday = (_needToday > 0 && _doneToday != null) ? (_doneToday / _needToday * 100) : null;
  const _todayTone = _pctToday == null ? 'var(--t2)' : _pctToday >= 100 ? 'var(--green)' : _pctToday >= 50 ? 'var(--amber)' : 'var(--red)';
  const _todayLine = _needToday == null ? ''
    : `need <b>₹${goalFmtRs(_needToday)}</b> today` + (_doneToday != null
      ? ` · booked <b style="color:${_todayTone}">₹${goalFmtRs(_doneToday)}</b>${_pctToday != null ? ` (${_pctToday.toFixed(0)}%)` : ''}`
      : '');
  return `<div class="st" title="${title}"><div class="st-l">Goal · today &amp; remaining</div><div class="st-v" style="color:${_todayTone};font-size:17px">${_needToday!=null?'₹'+goalFmtRs(_needToday):reqStr+'%/day'} ${badge}</div><div class="st-d">${[_todayLine,`₹${goalFmtRs(g.target)} left · ${days} td · ${reqStr}%/day`].filter(Boolean).join('<br>')}</div></div>`;
}
function balanceGrid(el){
  if(!el||!el.children.length) return;
  const n=el.children.length;
  const cs=getComputedStyle(el);
  const min=parseFloat(cs.getPropertyValue('--card-min'))||160;
  const gap=parseFloat(cs.columnGap||cs.gap)||10;
  const w=el.clientWidth;
  if(!(w>0)) return;
  const maxPerRow=Math.max(1,Math.floor((w+gap)/(min+gap)));
  if(n<=maxPerRow){ el.style.gridTemplateColumns=''; return; }   // fits on one row: leave CSS in charge
  const rows=Math.ceil(n/maxPerRow);
  const perRow=Math.ceil(n/rows);                                 // 14 over 2 rows -> 7+7, 11 -> 6+5
  el.style.gridTemplateColumns=`repeat(${perRow},minmax(0,1fr))`;
}
function balanceGrids(){
  document.querySelectorAll('.stats,.kpi-grid').forEach(balanceGrid);
}
let _balanceTimer=null;
function scheduleBalanceGrids(){
  clearTimeout(_balanceTimer);
  _balanceTimer=setTimeout(balanceGrids,60);   // debounced: resize fires continuously while dragging
}
if(typeof window!=='undefined') window.addEventListener('resize',scheduleBalanceGrids,{passive:true});
function renderStats(){
  const t=ALL.length;
  const bull=ALL.filter(s=>(s.priceChange||0)>0).length;
  const top=FILT[0]||ALL[0];

  // Compute top sector by breadth
  const secBreadths={};
  ALL.forEach(s=>{
    if(!s.sector) return;
    if(!secBreadths[s.sector]) secBreadths[s.sector]={up:0,total:0};
    secBreadths[s.sector].total++;
    if((s.priceChange||0)>0) secBreadths[s.sector].up++;
  });
  let topSec='—', topSecPct=0;
  Object.entries(secBreadths).forEach(([sec,d])=>{
    if(d.total>=5){const pct=d.up/d.total*100; if(pct>topSecPct){topSecPct=pct;topSec=sec;}}
  });

  let bookedCard='';
  const booked=PERF_LATEST_SUMMARY;
  if(booked){
    const sessionToday=getSessionDate();
    const isToday=booked.date===sessionToday;
    const bookedLabel=isToday?'Booked Today':'Latest Session';
    const srcLabel=booked.source||'Tradebook';
    const dateLabel=booked.date||sessionToday;
    // Reps only on a NEW trigger this session (v483): first observation of a date is
    // the baseline (no reps on plain page load); a later change shows the DELTA's reps.
    if(!_repsState||_repsState.date!==booked.date){
      _repsState={date:booked.date,lastTotal:booked.total,lastDelta:null};
    } else if(booked.total!==_repsState.lastTotal){
      _repsState.lastDelta=booked.total-_repsState.lastTotal;
      _repsState.lastTotal=booked.total;
    }
    const d=_repsState.lastDelta;
    const repsTotal=d==null?'':(d>0?` · 🎉 ${Math.round(d).toLocaleString('en-IN')} steps`:d<0?` · 💪 ${Math.max(1,Math.ceil(Math.abs(d)/100))} pushups`:'');
    const pnlSummary=summarizeExitPnlRows(booked.rows||[]);
    const grossStr=pnlSummary.known.length?`gross ${fmtSignedINR(pnlSummary.gross)}`:'gross —';
    const costStr=pnlSummary.known.length?`cost ${fmtNegINR(pnlSummary.charges)}`:'cost —';
    // v1094: the Booked card's sub-line followed the same metric as the table column, so it moves
    // with it — leaving a retired "reverse" figure here while the column showed something else
    // would have put two different answers to the same question on one screen.
    const reverseStr=pnlSummary.leftCount
      ?`left on table ${fmtINR(pnlSummary.leftRs)}${pnlSummary.leftPct!=null?` (${pnlSummary.leftPct.toFixed(2)}%)`:''}`
      :'left on table —';
    const unknownWarning=booked.unknownRows>0?` · <span style="color:var(--amber)">&#9888; excludes ${booked.unknownRows} row${booked.unknownRows===1?'':'s'} with unknown cost</span>`:'';
    bookedCard=`
      <div class="st"><div class="st-l">${bookedLabel}</div><div class="st-v" style="color:${booked.total>=0?'var(--green)':'var(--red)'}">${fmtSignedINR(booked.total)}</div><div class="st-d">${dateLabel} · ${srcLabel} · ${grossStr} · ${costStr} · ${reverseStr}${unknownWarning}${repsTotal}</div></div>`;
  }

  const slTgtCard=(()=>{
    const harvestPlan=computeHarvestPlan();
    const active=getActiveTargetInfo();
    const selected=FILT.filter(s=>SELECTED.has(s.symbol));
    const summary=summarizeRowExitPolicies(selected.length?selected:FILT.slice(0,20));
    if(!summary) return '';
    const pctRange=(lo,hi,prefix)=>Math.abs(hi-lo)<0.001?`${prefix}${lo.toFixed(2)}%`:`${prefix}${lo.toFixed(2)}–${hi.toFixed(2)}%`;
    const reviewDays=getEffectiveReviewDays();
    const holdStr=reviewDays?` · review &gt;${reviewDays}d`:'';
    const learnedStr=harvestPlan.sampleCount?` · ${harvestPlan.sampleCount} move samples`:'';
    const opportunity=getSameDayExitOpportunitySummary();
    const opportunityStr=opportunity.exits?` · <span style="color:var(--amber)" title="${opportunity.exits} symbol/date exit${opportunity.exits===1?'':'s'} compared with the same day's ALL NSE high; ${opportunity.upsideExits} day high${opportunity.upsideExits===1?'':'s'} exceeded your quantity-weighted average sell price.">${opportunity.upsideExits}/${opportunity.exits} exit${opportunity.exits===1?'':'s'} left upside</span>`:'';
    const confStr=harvestPlan.confidence!=null?` · hit ${(harvestPlan.confidence*100).toFixed(0)}% hist`:'';
    const srcLabel=active.source==='manual'?'manual':active.source==='goal'?'goal-led':'Harvest';
    const fallbackStr=summary.fallbacks?` · ${summary.fallbacks} target fallback${summary.fallbacks===1?'':'s'}`:'';
    // v1102: the face of this card states ONE thing - these are RANGES across the list, not one
    // stock's policy. Every diagnostic fragment (hit rate, sample count, review horizon, same-day
    // upside) moved into the tooltip: they are audit detail, not something to read at a glance.
    const _tip=[`Lowest to highest stop and target across ${summary.count} stock${summary.count===1?'':'s'}.`,
      `Base rate ${active.tgtPct.toFixed(2)}% (${srcLabel}); each stock is nudged above it by Radar score.`,
      summary.fallbacks?`${summary.fallbacks} row${summary.fallbacks===1?'':'s'} fell back to a portfolio target.`:'',
      harvestPlan.confidence!=null?`Historic hit rate ${(harvestPlan.confidence*100).toFixed(0)}%${harvestPlan.sampleCount?` over ${harvestPlan.sampleCount} samples`:''}.`:'',
      reviewDays?`Review after ${reviewDays} days.`:'',
      opportunity.exits?`${opportunity.exits} past exits had further upside the same day.`:''
    ].filter(Boolean).join(' ');
    return `<div class="st" title="${escHtml(_tip)}"><div class="st-l">Stop / Target Range</div><div class="st-v" style="font-size:17px"><span style="color:var(--red)">${pctRange(summary.stopMin,summary.stopMax,'−')}</span><span style="color:var(--t2);font-size:14px"> / </span><span style="color:var(--green)">${pctRange(summary.targetMin,summary.targetMax,'+')}</span></div><div class="st-d">across ${summary.count} stock${summary.count===1?'':'s'} · base ${active.tgtPct.toFixed(2)}%</div></div>`;
  })();

  const topScore=top&&isFinite(top.score)?Number(top.score).toFixed(1):'—';
  const riskCounts={Low:0,Medium:0,High:0};
  FILT.forEach(s=>{if(riskCounts[s.risk]!=null)riskCounts[s.risk]++;});
  const medianRisk=Object.entries(riskCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—';
  const selCount=FILT.filter(s=>SELECTED.has(s.symbol)).length;
  const rocketsCard=`<div class="st"><div class="st-l">Rockets Today</div><div class="st-v" style="color:var(--fire)">${(RADAR.rockets||0).toLocaleString()}</div><div class="st-d" title="v1085 definition: reached its own target before its own stop. This card shows DAY 1 only — the full label runs over 2 trading days and is resolved in the outcome store after the next session. Diagnostic; it sets no feature weight.">reached target before stop today · day 1 of 2 · diagnostic${RADAR.continuationCount?` · ${RADAR.continuationCount.toLocaleString()} broader continuation signals scored separately`:''}</div></div>`;
  const scoreCard=`<div class="st"><div class="st-l">Top Score</div><div class="st-v" style="color:${radarScoreColor(top?.score)}">${topScore}</div><div class="st-d">${FILT.length.toLocaleString()} displayed · ${selCount} selected for export · median risk ${medianRisk} · ${RADAR.features.length||0} modeled features</div></div>`;

  const breadthPct = t ? (bull / t * 100) : null;
  const reg = (typeof MARKET_REGIME !== 'undefined' && MARKET_REGIME) ? MARKET_REGIME : null;
  const regTone = reg && reg.label === 'calm' ? 'var(--green)'
    : reg && reg.label === 'normal' ? 'var(--cyan)'
    : reg && reg.label === 'elevated' ? 'var(--amber)'
    : reg && reg.label === 'stressed' ? 'var(--red)' : 'var(--t2)';
  const live = (typeof buildLiveNiftyProxy === 'function') ? buildLiveNiftyProxy(ALL) : null;
  const nifty = live ? live.pct : (reg && reg.niftyPct != null ? reg.niftyPct : null);
  const niftyTone = nifty == null ? 'var(--t2)' : nifty >= 0 ? 'var(--green)' : 'var(--red)';
  const marketCard = `<div class="st" title="NIFTY 50 rebuilt LIVE from its ${live ? live.members : 50} constituents in this scan, market-cap weighted — the index row in the daily NSE zip is end-of-day, so mid-session it is yesterday's close. Breadth is the share of the scanned universe trading above its open (live). VIX has no live source in any input: it is the previous close, shown as a percentile of its OWN 52-week range so no volatility level is hard-coded. Regime is recorded on every outcome so results can be read within a regime rather than pooled — it never scores a stock.">
    <div class="st-l">Market${live ? '' : ' · EOD'}</div>
    <div class="st-v" style="font-size:17px;color:${niftyTone}">${nifty != null ? `NIFTY ${nifty >= 0 ? '+' : ''}${nifty.toFixed(2)}%` : (breadthPct != null ? breadthPct.toFixed(0) + '% breadth' : '—')}</div>
    <div class="st-d">${[
      breadthPct != null ? `${breadthPct.toFixed(0)}% advancing` : '',
      reg && reg.vix != null ? `VIX ${reg.vix.toFixed(2)}${reg.label && reg.label !== 'unknown' ? ` <span style="color:${regTone}">${escHtml(reg.label)}</span>` : ''}` : '',
      topSec && topSec !== '—' ? `${escHtml(topSec)} leading` : ''
    ].filter(Boolean).join(' · ')}</div></div>`;

  const costCard = (() => {
    const trips = (TRADEBOOK_STATS && TRADEBOOK_STATS.tripsData) || [];
    const valid = trips.filter(r => r.qty > 0 && r.charges >= 0);
    const totCharges = valid.reduce((a, r) => a + r.charges, 0);
    const totValue = valid.reduce((a, r) =>
      a + (r.buyPrice > 0 ? r.buyPrice * r.qty : 0) + (r.sellPrice > 0 ? r.sellPrice * r.qty : 0), 0);
    const costPct = totValue > 0 ? totCharges / totValue * 100 : null;
    const perLot = valid.length ? totCharges / valid.length : null;
    const hurdle = estimateRoundTripCostPct(getEffectiveTgtPct() || 1);
    const tip = valid.length
      ? `All-in cost of one round trip: ₹${Math.round(totCharges).toLocaleString('en-IN')} of charges over ₹${Math.round(totValue).toLocaleString('en-IN')} traded across ${valid.length.toLocaleString()} closed trips — all seven charges on Zerodha's published rate card (Zerodha Equity Trading Charges.csv): brokerage, STT, transaction, GST, SEBI, stamp and DP — including DP, which is ₹15.34 per ISIN per SELL DAY rather than per trade. The tradebook carries no charges column, so these are computed from that rate card and applied to every fill. Value-weighted, so it is what you actually paid rather than an average of ratios (a mean of per-trip percentages reads ${(TRADEBOOK_STATS && TRADEBOOK_STATS.avgChargePct != null ? TRADEBOOK_STATS.avgChargePct.toFixed(3) : '—')}%, inflated by the flat ₹15.34 DP fee on small lots). Works out to about ₹${perLot != null ? Math.round(perLot) : '—'} a trip. The allocator charges ${hurdle.toFixed(2)}% when testing whether a stock's target clears costs.`
      : `No tradebook loaded, so the allocator falls back to a hardcoded ${hurdle.toFixed(2)}% when testing whether a stock's target clears costs.`;
    return `<div class="st" title="${escHtml(tip)}">
      <div class="st-l">Avg Cost</div>
      <div class="st-v" style="font-size:17px;color:${costPct == null ? 'var(--t3)' : costPct >= 0.30 ? 'var(--amber)' : 'var(--cyan)'}">${costPct != null ? costPct.toFixed(2) + '%' : '—'}</div>
      <div class="st-d">${costPct != null ? 'per round trip, all-in' : 'no tradebook loaded'}</div></div>`;
  })();

  const universeCard = `<div class="st" title="Scan size and what survived filtering.">
    <div class="st-l">Universe</div>
    <div class="st-v">${t.toLocaleString()}</div>
    <div class="st-d"><span style="color:var(--green)">${bull} up</span> · <span style="color:var(--red)">${t - bull} down/flat</span> · ${FILT.length.toLocaleString()} shown · ${selCount} selected · ${RADAR.features.length || 0} features${top ? ' · top ' + escHtml(top.symbol) + ' ' + topScore : ''}</div></div>`;

  // v1079: the Top Score card was removed (owner: worthless). v1088 adds Avg Cost (owner) — SEVEN
  // cards now, which is exactly the owner's ceiling. Nothing further may be added without removing one.


  document.getElementById('statsBar').innerHTML =
    marketCard + universeCard + costCard + rocketsCard + slTgtCard + bookedCard + buildGoalCard();
  balanceGrids();   // v1101: spread the cards evenly instead of stranding a stub row

  const filterPills=[];
  // v1179: THE DEPTH THAT GOVERNS THE BOARD MUST BE VISIBLE. v1170 made the recommendation depth
  // move with the market's own time-of-day evidence, and nothing on any tab said so - the board
  // silently reached deeper or shallower than RECOMMEND_MAX_RANK with no way to see it or check it.
  (()=>{
    try{
      const d=timingDepth();
      if(!d||!Number.isFinite(d.depth)) return;
      const off=d.depth!==RECOMMEND_MAX_RANK;
      filterPills.push(`<span class="info-pill ${off?'pill-amber':''}" title="${escHtml(
        'Recommendations are drawn from the top '+d.depth+' by rank. The default is '+RECOMMEND_MAX_RANK
        +' and it moves with the time of day: '+(d.why||'no evidence yet')
        +'. Measured from the accumulated 5-minute files, never from a typed hour.')}">\u23f1 top ${d.depth}${
        off?` (of ${RECOMMEND_MAX_RANK})`:''}</span>`);
    }catch(e){}
  })();
  if(SUPPRESSED_HELD>0)filterPills.push(`<span class="info-pill pill-rose" title="Stocks you already hold (Holdings + Positions + today's net Orders buys). Since v1070 these stay in the ranking and can be recommended again — the badge is a duplicate-buy warning, not a filter.">📌 ${SUPPRESSED_HELD} already held</span>`);
  if(PEAK_TIMING_REMOVED>0)filterPills.push(`<span class="info-pill pill-amber" title="Automatic trigger input: these stocks fail the entry-timing condition. They remain eligible while the condition is collecting; if its forward precision arms in Post-close, failures are removed automatically.">⚡ ${PEAK_TIMING_REMOVED} timing-trigger misses</span>`);
  const inelig=ALL.filter(s=>s.basketEligible===false).length;
  if(inelig>0)filterPills.push(`<span class="info-pill pill-orange" title="Non-EQ series, inactive status, or a price band below 10% — visible in the ranking with penalties, but never exported to the basket.">⚠ ${inelig} basket-ineligible (ranked with penalties)</span>`);

  // Row 2: analysis / insight pills
  const infoPills=[];
  try{
    const opportunity=getSameDayExitOpportunitySummary();
    if(opportunity.exits){
      const realisedText=opportunity.avgRealised==null?'':` · realised ${opportunity.avgRealised>=0?'+':''}${opportunity.avgRealised.toFixed(2)}%`;
      infoPills.push(`<span class="info-pill pill-amber" title="One exit means one symbol on one sell date. Sell fills are quantity-weighted; ALL NSE supplies that day's high. The average is weighted by sold value and includes 0% when the high did not exceed your average sell price. Diagnostic only; it does not change the portfolio target anchor or any stock exit policy.">🎯 ${opportunity.exits} exit${opportunity.exits===1?'':'s'}${realisedText} · ${opportunity.upsideExits} left upside · missed +${opportunity.avgMissed.toFixed(2)}% (${fmtINR(opportunity.missedValue)}) · diagnostic</span>`);
    }
  }catch(e){}

  // Update surveillance P&L correlation accumulator if both data sources are ready
  if(HOLDINGS?.length&&Object.keys(SURV_ALL_HITS).length) try{updateSurvCorrelation();}catch(e){}
  const infoBarEl=document.getElementById('infoBar');
  infoBarEl.innerHTML=`<div style="display:flex;gap:6px;flex-wrap:wrap">${[...filterPills,...infoPills].join('')}</div>`;
  void infoBarEl.offsetHeight;
}

const COL_ORDER_LS='rs_col_order_v1';
function loadColOrders(){try{return JSON.parse(localStorage.getItem(COL_ORDER_LS)||'{}')||{};}catch(e){return {};}}
function saveColOrder(tableKey,keys){try{const all=loadColOrders();all[tableKey]=keys;localStorage.setItem(COL_ORDER_LS,JSON.stringify(all));}catch(e){}}
function applyColOrder(tableKey,cols){
  const saved=loadColOrders()[tableKey];
  if(!Array.isArray(saved)||!saved.length) return cols;
  const byKey=new Map(cols.map(c=>[c.key,c]));
  const ordered=saved.map(k=>byKey.get(k)).filter(Boolean);
  const seen=new Set(ordered.map(c=>c.key));
  return [...ordered,...cols.filter(c=>!seen.has(c.key))];
}
// Wire drag-to-reorder on a table's header cells. On drop: persist the new order and
// hand it to onReorder, which re-renders that table (tbody/tfoot follow the cols).
function attachColDrag(tableEl,tableKey,onReorder){
  const ths=[...tableEl.querySelectorAll('thead th[data-key]')];
  ths.forEach(th=>{
    th.draggable=true;
    th.title=(th.title?th.title+' · ':'')+'Drag to reorder columns';
    th.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/col-key',th.dataset.key);e.dataTransfer.effectAllowed='move';th.style.opacity='.35';});
    th.addEventListener('dragend',()=>{th.style.opacity='';ths.forEach(t=>{t.style.boxShadow='';});});
    th.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('text/col-key')){e.preventDefault();e.dataTransfer.dropEffect='move';th.style.boxShadow='inset 2px 0 0 var(--amber)';}});
    th.addEventListener('dragleave',()=>{th.style.boxShadow='';});
    th.addEventListener('drop',e=>{
      e.preventDefault();th.style.boxShadow='';
      const from=e.dataTransfer.getData('text/col-key'),to=th.dataset.key;
      if(!from||from===to) return;
      const keys=[...tableEl.querySelectorAll('thead th[data-key]')].map(t=>t.dataset.key);
      const fi=keys.indexOf(from),ti=keys.indexOf(to);
      if(fi<0||ti<0) return;
      keys.splice(fi,1);
      keys.splice(fi<ti?ti:ti,0,from); // dropping on a column takes its place
      saveColOrder(tableKey,keys);
      onReorder(keys);
    });
  });
}
function makeSortableTable(id, cols, rows, defaultSortKey, defaultDir=-1, rowStyleFn=null, totalsRow=null, rowClickKey=null){
  cols=applyColOrder(id,cols.slice());
  const thStyle=(align)=>`padding:6px 10px;text-align:${align};cursor:pointer;user-select:none;white-space:nowrap`;
  const tdStyle=(align,extra='')=>`padding:7px 10px;text-align:${align};white-space:nowrap${extra?';'+extra:''}`;
  let sortKey=defaultSortKey, sortDir=defaultDir;
  function render(){
    const sorted=[...rows].sort((a,b)=>{
      const av=a[sortKey],bv=b[sortKey];
      const an=av==null||av===''||(typeof av==='number'&&!isFinite(av));
      const bn=bv==null||bv===''||(typeof bv==='number'&&!isFinite(bv));
      if(an&&bn) return 0;
      if(an) return 1;
      if(bn) return -1;
      if(typeof av==='string') return sortDir*av.localeCompare(bv);
      return sortDir*((av||0)-(bv||0));
    });
    const thead=`<thead><tr style="color:var(--t3);border-bottom:1px solid var(--border)">${
      cols.map(c=>`<th data-key="${c.key}" style="${thStyle(c.align||'right')}">${c.label}${sortKey===c.key?(sortDir>0?' ▲':' ▼'):''}</th>`).join('')
    }</tr></thead>`;
    const tbody=`<tbody>${sorted.map(row=>{const _rs=rowStyleFn?rowStyleFn(row):'';const _cs=rowClickKey?row[rowClickKey]:null;const _ca=_cs?` onclick="showRadarDetail('${String(_cs).replace(/'/g,'')}')" title="Click for the full scoring breakdown"`:'';return`<tr${_ca} style="border-bottom:1px solid var(--border);color:var(--t1);${_cs?'cursor:pointer;':''}${_rs}">${
      cols.map((c,i)=>{
        const v=row[c.key];
        const display=c.fmt?c.fmt(v,row):v;
        const color=c.clrFn?c.clrFn(v,row):'var(--t1)';
        return `<td style="${tdStyle(c.align||'right','color:'+color+(c.bold?';font-weight:700':''))}">${display}</td>`;
      }).join('')
    }</tr>`;}).join('')}</tbody>`;
    const tfoot=totalsRow?`<tfoot><tr style="border-top:2px solid var(--border-hi);background:var(--bg-raised)">${
      cols.map(c=>{
        const v=totalsRow[c.key];
        const display=c.totFmt?c.totFmt(v,totalsRow):(v!=null?v:'');
        const totColor=c.totClrFn?c.totClrFn(v,totalsRow):'var(--t1)';
        return `<td style="${tdStyle(c.align||'right','font-weight:700;color:'+totColor)}">${display}</td>`;
      }).join('')
    }</tr></tfoot>`:'';
    const tbl=document.getElementById(id);
    if(tbl){
      tbl.innerHTML=thead+tbody+tfoot;
      attachSort(tbl);
      // Drag-to-reorder: persist per table id; re-render so tbody/tfoot follow.
      attachColDrag(tbl,id,keys=>{
        const pos=new Map(keys.map((k,i)=>[k,i]));
        cols.sort((a,b)=>(pos.get(a.key)??99)-(pos.get(b.key)??99));
        render();
      });
    }
  }
  function attachSort(tbl){
    tbl.querySelectorAll('th[data-key]').forEach(th=>{
      th.onclick=()=>{
        const k=th.dataset.key;
        if(sortKey===k) sortDir*=-1; else{sortKey=k;sortDir=-1;}
        render();
      };
    });
  }
  return {render,getHtml:()=>`<table id="${id}" style="width:100%;border-collapse:collapse;font-size:14px;font-family:'DM Mono',monospace"></table>`};
}

function computePerfStats(trips){
  trips.forEach(r=>{ if(r.netPnlPct==null||isNaN(r.netPnlPct)) r.netPnlPct=r.capital>0?r.netPnl/r.capital*100:r.pnlPct||0; });
  const wins=trips.filter(r=>r.netPnl>0), losses=trips.filter(r=>r.netPnl<=0);
  const winPcts=wins.map(r=>r.netPnlPct).sort((a,b)=>a-b);
  const lossPcts=losses.map(r=>r.netPnlPct).sort((a,b)=>a-b);
  const winRate=trips.length?+(wins.length/trips.length*100).toFixed(2):0;
  const avgWinPct=+meanArr(winPcts).toFixed(2);
  const avgLossPct=+meanArr(lossPcts).toFixed(2);
  const riskReward=avgLossPct?+Math.abs(avgWinPct/avgLossPct).toFixed(2):0;
  const kellyPct=avgLossPct?+(winRate/100 - (1-winRate/100)/Math.abs(avgWinPct/avgLossPct)).toFixed(3)*100:0;
  const grossWins=wins.reduce((s,r)=>s+r.netPnl,0);
  const grossLosses=Math.abs(losses.reduce((s,r)=>s+r.netPnl,0));
  const profitFactor=grossLosses>0?+(grossWins/grossLosses).toFixed(2):null;
  const totalNetPnlRs=+trips.reduce((s,r)=>s+r.netPnl,0).toFixed(0);
  const expectancy=trips.length?+Math.round(totalNetPnlRs/trips.length):0;
  const largestWinRs=wins.length?+Math.round(Math.max(...wins.map(r=>r.netPnl))):0;
  const largestLossRs=losses.length?+Math.round(Math.min(...losses.map(r=>r.netPnl))):0;
  const bookedByDate={};
  trips.forEach(r=>{
    if(!bookedByDate[r.sellDate]) bookedByDate[r.sellDate]={total:0,count:0};
    bookedByDate[r.sellDate].total+=r.netPnl;
    bookedByDate[r.sellDate].count++;
  });
  const dailyVals=Object.values(bookedByDate).map(d=>d.total);
  const totalTradingDays=dailyVals.length;
  const profitableDays=dailyVals.filter(v=>v>0).length;
  const pctProfitableDays=totalTradingDays?+(profitableDays/totalTradingDays*100).toFixed(0):0;
  const avgDailyPnl=totalTradingDays?+Math.round(totalNetPnlRs/totalTradingDays):0;
  let peak=0,cum=0,maxDD=0;
  Object.keys(bookedByDate).sort().forEach(d=>{cum+=bookedByDate[d].total;if(cum>peak)peak=cum;if(peak-cum>maxDD)maxDD=peak-cum;});
  const maxDrawdown=+Math.round(maxDD);
  const dailyPnlByDate={};
  trips.forEach(r=>{dailyPnlByDate[r.sellDate]=(dailyPnlByDate[r.sellDate]||0)+r.netPnl;});
  const dailySeq=Object.keys(dailyPnlByDate).sort().map(d=>dailyPnlByDate[d]);
  let lossStreak=0,maxLossStreak2=0,winStreak=0,maxWinStreak=0;
  dailySeq.forEach(v=>{
    if(v<=0){lossStreak++;if(lossStreak>maxLossStreak2)maxLossStreak2=lossStreak;winStreak=0;}
    else{winStreak++;if(winStreak>maxWinStreak)maxWinStreak=winStreak;lossStreak=0;}
  });
  const maxStreak=maxLossStreak2;
  const avgHoldDays=Math.round(meanArr(trips.map(r=>r.holdDays)));
  const posMap={};
  trips.forEach(r=>{const k=r.sym+'|'+r.buyDate;posMap[k]=(posMap[k]||0)+r.capital;});
  const entryDays=new Set(trips.map(r=>r.buyDate).filter(Boolean));
  const positionCount=Object.keys(posMap).length;
  const avgPositionsPerEntryDay=entryDays.size?positionCount/entryDays.size:0;
  const avgCapital=+Math.round(meanArr(Object.values(posMap)));
  const symMap={};
  trips.forEach(r=>{
    if(!symMap[r.sym]) symMap[r.sym]={sym:r.sym,netPnl:0,trades:0,wins:0,pnlPcts:[]};
    symMap[r.sym].netPnl+=r.netPnl; symMap[r.sym].trades++;
    if(r.netPnl>0) symMap[r.sym].wins++;
    symMap[r.sym].pnlPcts.push(r.netPnlPct);
  });
  const symBreakdown=Object.values(symMap).map(s=>({...s,netPnl:+s.netPnl.toFixed(0),winRate:+(s.wins/s.trades*100).toFixed(0),avgPct:+meanArr(s.pnlPcts).toFixed(2)})).sort((a,b)=>b.netPnl-a.netPnl);
  const hourMap={};
  trips.forEach(r=>{
    if(!r.buyTime) return;
    const m=r.buyTime.match(/(\d{1,2}):(\d{2})/);if(!m)return;
    const totalMin=parseInt(m[1])*60+parseInt(m[2]);
    const q=Math.floor(totalMin/30)*30;
    if(!hourMap[q]) hourMap[q]={hour:q,trades:0,wins:0,pnlPcts:[]};
    hourMap[q].trades++; if(r.netPnl>0)hourMap[q].wins++;
    hourMap[q].pnlPcts.push(r.netPnlPct);
  });
  const hourBreakdown=Object.values(hourMap).map(h=>({...h,winRate:+(h.wins/h.trades*100).toFixed(0),avgPct:+meanArr(h.pnlPcts).toFixed(2)})).sort((a,b)=>a.hour-b.hour);
  const sellHourMap={};
  trips.forEach(r=>{
    if(!r.sellTime) return;
    const m=r.sellTime.match(/(\d{1,2}):(\d{2})/);if(!m)return;
    const totalMin=parseInt(m[1])*60+parseInt(m[2]);
    const q=Math.floor(totalMin/30)*30;
    if(!sellHourMap[q]) sellHourMap[q]={hour:q,trades:0,wins:0,pnlPcts:[]};
    sellHourMap[q].trades++; if(r.netPnl>0)sellHourMap[q].wins++;
    sellHourMap[q].pnlPcts.push(r.netPnlPct);
  });
  const sellHourBreakdown=Object.values(sellHourMap).map(h=>({...h,winRate:+(h.wins/h.trades*100).toFixed(0),avgPct:+meanArr(h.pnlPcts).toFixed(2)})).sort((a,b)=>a.hour-b.hour);
  const eligHours=hourBreakdown.filter(h=>h.trades>=3);
  const bestHourObj=eligHours.length?eligHours.reduce((b,h)=>h.avgPct>b.avgPct?h:b,eligHours[0]):null;
  const dailyEntries=Object.entries(bookedByDate).map(([date,d])=>({date,pnl:+d.total.toFixed(0),count:d.count}));
  const maxProfitDay=dailyEntries.length?dailyEntries.reduce((b,d)=>d.pnl>b.pnl?d:b,dailyEntries[0]):null;
  const maxLossDay=dailyEntries.length?dailyEntries.reduce((b,d)=>d.pnl<b.pnl?d:b,dailyEntries[0]):null;
  return {
    roundTrips:trips.length, winners:wins.length, losers:losses.length,
    winRate, avgWinPct, avgLossPct, riskReward, kellyPct,
    profitFactor, expectancy, totalNetPnlRs,
    largestWinRs, largestLossRs, maxDrawdown, maxLossStreak:maxStreak, maxWinStreak,
    pctProfitableDays, profitableDays, totalTradingDays,
    avgDailyPnl, avgHoldDays, avgCapital,positionCount,entryDays:entryDays.size,
    avgPositionsPerEntryDay:+avgPositionsPerEntryDay.toFixed(2),
    maxProfitDay, maxLossDay,
    symBreakdown, hourBreakdown, sellHourBreakdown,
    bestHour:bestHourObj?.hour??null, bestHourAvgPct:bestHourObj?+bestHourObj.avgPct.toFixed(2):null,
    bestHourWinRate:bestHourObj?.winRate??null, bestHourTrades:bestHourObj?.trades??null,
  };
}

function getAdaptiveTradeTrips(trips){
  const dates=(trips||[]).map(r=>r?.sellDate).filter(Boolean).sort();
  const effectiveStart=dates.length?dates[0]>SYSTEM_TRADE_START_DATE?dates[0]:SYSTEM_TRADE_START_DATE:SYSTEM_TRADE_START_DATE;
  const rows=(trips||[]).filter(r=>r&&r.sellDate>=effectiveStart);
  return rows.length?rows:(trips||[]);
}

// Trade timing evidence (v1064). One entry decision is the unit, not a FIFO exit
// fragment. Outcomes are converted to bounded within-day and hold-context ranks so
// a single spectacular win/loss cannot manufacture an entry signal.
let _tradeTimingMemo=null;
function tradeClockMinute(value){
  const m=String(value||'').match(/(?:T|\s|^)(\d{1,2}):(\d{2})(?::\d{2})?/);
  if(!m) return null;
  const minute=Number(m[1])*60+Number(m[2]);
  return Number.isFinite(minute)?minute:null;
}
function tradeMedian(values){
  const a=(values||[]).filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length) return null;
  const mid=Math.floor(a.length/2);
  return a.length%2?a[mid]:(a[mid-1]+a[mid])/2;
}
function tradeRanks(rows,valueKey,outKey){
  const sorted=rows.map(row=>({row,value:Number(row[valueKey])}))
    .filter(x=>Number.isFinite(x.value)).sort((a,b)=>a.value-b.value);
  if(!sorted.length) return;
  if(sorted.length===1){sorted[0].row[outKey]=.5;return;}
  for(let start=0;start<sorted.length;){
    let end=start+1;
    while(end<sorted.length&&sorted[end].value===sorted[start].value) end++;
    const rank=((start+end-1)/2)/(sorted.length-1);
    for(let i=start;i<end;i++) sorted[i].row[outKey]=rank;
    start=end;
  }
}
function buildTradeEntryEpisodes(trips){
  const map={};
  (trips||[]).forEach(r=>{
    const symbol=normSym(r?.sym),date=String(r?.buyDate||''),time=String(r?.buyTime||'');
    const capital=Number(r?.capital),net=Number(r?.netPnl),qty=Number(r?.qty),hold=Number(r?.holdDays);
    if(!symbol||!date||!time||!(capital>0)||!Number.isFinite(net)) return;
    const key=symbol+'|'+date+'|'+time;
    const e=map[key]||(map[key]={key,symbol,date,time,capital:0,netPnl:0,qty:0,holdCapitalDays:0,exitFragments:0});
    e.capital+=capital;e.netPnl+=net;e.qty+=Number.isFinite(qty)?qty:0;
    e.holdCapitalDays+=(Number.isFinite(hold)?hold:0)*capital;e.exitFragments++;
  });
  return Object.values(map).map(e=>{
    e.netPnlPct=e.capital>0?e.netPnl/e.capital*100:0;
    e.holdDays=e.capital>0?e.holdCapitalDays/e.capital:0;
    e.minute=tradeClockMinute(e.time);
    return e;
  }).filter(e=>e.minute!==null);
}
function tradeLooRange(dayValues){
  if(!dayValues||dayValues.length<2) return null;
  const total=dayValues.reduce((s,v)=>s+v,0);
  const loo=dayValues.map(v=>(total-v)/(dayValues.length-1));
  return {min:Math.min(...loo),max:Math.max(...loo)};
}
function buildTradeTimingModel(trips){
  const adaptive=getAdaptiveTradeTrips(trips||[]);
  const memoKey=adaptive.length+'|'+(adaptive.at(-1)?.sellDate||'')+'|'+(adaptive.at(-1)?.netPnl||0);
  if(_tradeTimingMemo?.key===memoKey) return _tradeTimingMemo.value;
  const episodes=buildTradeEntryEpisodes(adaptive);
  if(!episodes.length){
    const empty={episodes:[],episodeCount:0,entryDays:0,rows:[],groups:{window:[],ordinal:[],phase:[],spacing:[]}};
    _tradeTimingMemo={key:memoKey,value:empty};return empty;
  }

  const byDay={};
  episodes.forEach(e=>(byDay[e.date]??=[]).push(e));
  Object.values(byDay).forEach(dayRows=>{
    dayRows.sort((a,b)=>a.time.localeCompare(b.time)||a.symbol.localeCompare(b.symbol));
    dayRows.forEach((e,index)=>{
      e.ordinal=index+1;e.dayEntries=dayRows.length;
      e.phase=dayRows.length===1?'Only':index===0?'First':index===dayRows.length-1?'Last':'Middle';
      e.spacingMinutes=index?Math.max(0,e.minute-dayRows[index-1].minute):null;
      e.windowMinute=Math.floor(e.minute/30)*30;
      e.ordinalKey=e.ordinal>=5?'5+':String(e.ordinal);
      e.spacingKey=e.spacingMinutes===null?'First entry'
        :e.spacingMinutes===0?'Same batch'
        :e.spacingMinutes<15?'<15m'
        :e.spacingMinutes<30?'15–29m'
        :e.spacingMinutes<60?'30–59m':'60m+';
    });
    tradeRanks(dayRows,'netPnlPct','dayRank');
  });

  // Intraday is semantic; positive hold periods split at their observed terciles.
  const positiveHolds=episodes.map(e=>e.holdDays).filter(v=>v>0).sort((a,b)=>a-b);
  const holdCut=p=>positiveHolds.length?positiveHolds[Math.min(positiveHolds.length-1,Math.floor((positiveHolds.length-1)*p))]:0;
  const holdCut1=holdCut(1/3),holdCut2=holdCut(2/3);
  episodes.forEach(e=>{
    e.holdStratum=e.holdDays===0?'Intraday'
      :e.holdDays<=holdCut1?`≤${Math.max(1,Math.ceil(holdCut1))}d`
      :e.holdDays<=holdCut2?`≤${Math.max(1,Math.ceil(holdCut2))}d`
      :`>${Math.max(1,Math.ceil(holdCut2))}d`;
  });
  const byHold={};
  episodes.forEach(e=>(byHold[e.holdStratum]??=[]).push(e));
  Object.values(byHold).forEach(rows=>tradeRanks(rows,'netPnlPct','holdRank'));

  function makeSlice(dimension,key,label,rows){
    const daily={};
    rows.forEach(e=>(daily[e.date]??=[]).push(e));
    const dayRows=Object.entries(daily).map(([date,list])=>({
      date,
      peer:meanArr(list.map(e=>Number.isFinite(e.dayRank)?e.dayRank:.5)),
      hold:meanArr(list.map(e=>Number.isFinite(e.holdRank)?e.holdRank:.5)),
      medianReturn:tradeMedian(list.map(e=>e.netPnlPct))
    }));
    const peerDays=dayRows.map(d=>d.peer),holdDays=dayRows.map(d=>d.hold);
    const holdCounts={};
    rows.forEach(e=>holdCounts[e.holdStratum]=(holdCounts[e.holdStratum]||0)+1);
    return {
      dimension,key,label,episodes:rows.length,days:dayRows.length,
      peerRank:meanArr(peerDays),holdRank:meanArr(holdDays),
      peerLoo:tradeLooRange(peerDays),holdLoo:tradeLooRange(holdDays),
      robustReturnPct:tradeMedian(dayRows.map(d=>d.medianReturn)),
      holdMix:Object.entries(holdCounts).map(([k,n])=>`${k} ${n}`).join(' · '),
      state:'Neutral',stability:'collecting'
    };
  }
  const groups={window:[],ordinal:[],phase:[],spacing:[]};
  const addSlices=(dimension,keyFn,labelFn)=>{
    const buckets={};
    episodes.forEach(e=>{const key=keyFn(e);if(key!=null)(buckets[key]??=[]).push(e);});
    Object.entries(buckets).forEach(([key,rows])=>groups[dimension].push(makeSlice(dimension,key,labelFn(key),rows)));
  };
  const fmtMinute=m=>{const h=Math.floor(m/60),mm=m%60,h12=h===0?12:h>12?h-12:h;return `${h12}:${String(mm).padStart(2,'0')} ${h<12?'AM':'PM'}`;};
  addSlices('window',e=>String(e.windowMinute),key=>fmtMinute(Number(key)));
  addSlices('ordinal',e=>e.ordinalKey,key=>key==='5+'?'Trade 5+':`Trade ${key}`);
  addSlices('phase',e=>e.phase,key=>`${key} trade`);
  addSlices('spacing',e=>e.spacingKey,key=>key);
  groups.window.sort((a,b)=>Number(a.key)-Number(b.key));
  groups.ordinal.sort((a,b)=>(a.key==='5+'?5:Number(a.key))-(b.key==='5+'?5:Number(b.key)));
  const phaseOrder={Only:0,First:1,Middle:2,Last:3};
  groups.phase.sort((a,b)=>(phaseOrder[a.key]??9)-(phaseOrder[b.key]??9));
  const spacingOrder={'First entry':0,'Same batch':1,'<15m':2,'15–29m':3,'30–59m':4,'60m+':5};
  groups.spacing.sort((a,b)=>(spacingOrder[a.key]??9)-(spacingOrder[b.key]??9));

  Object.values(groups).forEach(slices=>{
    const medianCoverage=tradeMedian(slices.map(r=>r.days))||Infinity;
    slices.forEach(r=>{
      const covered=r.days>=medianCoverage;
      const peerPos=r.peerLoo&&r.peerLoo.min>.5,peerNeg=r.peerLoo&&r.peerLoo.max<.5;
      const holdPos=r.holdLoo&&r.holdLoo.min>.5,holdNeg=r.holdLoo&&r.holdLoo.max<.5;
      r.peerShrunk=.5+(r.peerRank-.5)*(r.days/(r.days+medianCoverage));
      r.holdShrunk=.5+(r.holdRank-.5)*(r.days/(r.days+medianCoverage));
      if(covered&&peerPos&&holdPos){r.state='Prefer';r.stability='stable positive';}
      else if(covered&&peerNeg&&holdNeg){r.state='Avoid';r.stability='stable negative';}
      else r.stability=covered?'mixed / context-dependent':'collecting';
    });
  });
  const rows=[...groups.window,...groups.ordinal,...groups.phase,...groups.spacing];
  const model={episodes,episodeCount:episodes.length,entryDays:Object.keys(byDay).length,groups,rows,holdCuts:[holdCut1,holdCut2]};
  _tradeTimingMemo={key:memoKey,value:model};
  return model;
}
function getTradeTimingModel(){return buildTradeTimingModel(TRADEBOOK_STATS?.tripsData||[]);}

// v1211 (owner): the Time-of-day table answers ENTRY timing only. This is its exit-side sibling -
// "how much do I give up by selling at this hour". It deliberately reuses getPostSellExtremes, the
// SAME measurement the per-row left-on-table note is built from, rather than inventing a second
// definition of give-back: one meaning per quantity. What is new is the aggregation - by SELL clock
// window, in the identical 30-minute unit the entry table uses, so the two can be read together.
// Coverage is reported, never assumed: getPostSellExtremes needs stored price history at or after
// the sell date, so older trips can carry a realised return with no measurable give-back.
// v1211 (owner): keyed off the SELL time - how high did it go after the exit, the same day, and
// how high within a bounded forward window. Two separate answers because they decide two different
// things: the same-day figure says whether to have held longer INTRADAY, the horizon figure whether
// to have held overnight at all.
//
// The horizon ceiling is not a chosen number - it is getEffectiveReviewDays(), the app's own learned
// window for how long a pick stays live. It exists to make the buckets COMPARABLE: measured to the
// end of stored history the windows differed by 78 days in median exit age, so an older window
// looked worse purely for having had more sessions in which to rise.
//
// Not folded into getPostSellExtremes: that function backs the per-row note and is deliberately
// unbounded. One meaning per quantity - this is a different quantity, so it gets its own name.
function getPostSellHorizonHigh(sym,sellDate,sellTime,horizonSessions){
  const s=normSym(sym);
  const out={sameDayHigh:null,sameDayKnown:false,horizonHigh:null,sessions:0};
  if(!s||!sellDate) return out;
  // (a) the sell day, AFTER the exit only. Only the watch recorder can split the day at the sell;
  // without it the sell day is unknown rather than assumed.
  try{
    const w=getPostSellHighFromWatch(s,sellDate,sellTime);
    if(w){
      out.sameDayKnown=true;
      out.sameDayHigh=(w.advanced&&w.postSellHigh>0)?w.postSellHigh:null;
    }
  }catch(e){}
  // (b) the next N sessions, strictly after the sell day, N fixed for every row.
  const raw=FS.get(PRICE_HISTORY_STORE);
  const store=(raw&&typeof raw==='object'&&raw.sessions)?raw.sessions:{};
  const horizon=Math.max(1,Number(horizonSessions)||1);
  for(const d of Object.keys(store).sort()){
    if(d<=sellDate) continue;
    const v=store[d]?.[s];
    if(v===undefined) continue;
    const hi=phHigh(v)??phClose(v);
    if(hi>0) out.horizonHigh=out.horizonHigh==null?hi:Math.max(out.horizonHigh,hi);
    if(++out.sessions>=horizon) break;
  }
  return out;
}
function buildExitTimingModel(trips){
  // The ceiling must be at least as long as he ACTUALLY holds, or "afterwards" is answered over a
  // window shorter than the decision it informs: getEffectiveReviewDays() resolved to 1 session on
  // this book. Both inputs are existing learned quantities - the later of the review window and the
  // 75th percentile of observed overnight holds. No chosen number.
  const heldDays=(trips||[]).map(t=>Number(t?.holdDays)).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);
  const p75Hold=heldDays.length?heldDays[Math.min(heldDays.length-1,Math.floor(heldDays.length*0.75))]:0;
  const reviewDays=Number((typeof getEffectiveReviewDays==='function')?getEffectiveReviewDays():0)||0;
  const horizon=Math.max(1,Math.round(Math.max(reviewDays,p75Hold))||2);
  const rows=[];
  (trips||[]).forEach(t=>{
    if(!t||!t.sym||!t.sellDate||!t.sellTime) return;
    const minute=clockMinutes(t.sellTime);
    if(minute==null) return;
    const sell=Number(t.sellPrice), qty=Number(t.qty)||0;
    if(!(sell>0)||!(qty>0)) return;
    let sameDayPct=null, horizonPct=null, horizonRs=null, sameDayKnown=false, horizonKnown=false;
    try{
      const e=getPostSellHorizonHigh(t.sym,t.sellDate,t.sellTime,horizon);
      sameDayKnown=e.sameDayKnown;
      // A watched sell day with no new high is a REAL zero, not a gap: the stock did not go higher.
      if(e.sameDayKnown) sameDayPct=e.sameDayHigh!=null?+(((e.sameDayHigh-sell)/sell)*100).toFixed(2):0;
      if(e.sessions>0){
        horizonKnown=true;
        const ref=e.horizonHigh!=null?e.horizonHigh:sell;
        horizonPct=+(((ref-sell)/sell)*100).toFixed(2);
        horizonRs=Math.round((ref-sell)*qty);
      }
    }catch(e){}
    rows.push({minute,windowMinute:Math.floor(minute/30)*30,date:t.sellDate,
      netPct:Number(t.netPnlPct),sameDayPct,horizonPct,horizonRs,sameDayKnown,horizonKnown});
  });
  if(!rows.length) return {exits:0,rows:[],horizon,totalHorizonRs:0};
  const buckets={};
  rows.forEach(r=>(buckets[r.windowMinute]??=[]).push(r));
  const pad=x=>String(Math.floor(x/60)).padStart(2,'0')+':'+String(x%60).padStart(2,'0');
  const out=Object.keys(buckets).map(k=>+k).sort((a,b)=>a-b).map(m=>{
    const list=buckets[m];
    const nets=list.map(r=>r.netPct).filter(v=>Number.isFinite(v));
    const sd=list.filter(r=>r.sameDayKnown).map(r=>r.sameDayPct);
    const hz=list.filter(r=>r.horizonKnown).map(r=>r.horizonPct);
    const hzRs=list.filter(r=>r.horizonKnown);
    return {
      key:String(m), slice:pad(m)+'-'+pad(m+30), exits:list.length,
      days:new Set(list.map(r=>r.date)).size,
      medianNetPct:nets.length?+tradeMedian(nets).toFixed(2):null,
      sameDayPct:sd.length?+tradeMedian(sd).toFixed(2):null,
      sameDayN:sd.length,
      horizonPct:hz.length?+tradeMedian(hz).toFixed(2):null,
      horizonRs:hzRs.reduce((a,r)=>a+r.horizonRs,0),
      wentHigherPct:hz.length?+(100*hz.filter(v=>v>0).length/hz.length).toFixed(0):null
    };
  });
  return {exits:rows.length,rows:out,horizon,
    sameDayCoverage:rows.filter(r=>r.sameDayKnown).length,
    horizonCoverage:rows.filter(r=>r.horizonKnown).length,
    totalHorizonRs:out.reduce((a,r)=>a+r.horizonRs,0)};
}

// v1211 (owner): "how long should I hold a stock, both intraday and long term". Two cohorts,
// because they are different questions: a position closed the same session is bucketed by ELAPSED
// MINUTES, one carried overnight by DAYS HELD. Per bucket the decisive column is not the median
// return but the return PER DAY OF CAPITAL TIED UP - a 4% gain over 12 days and a 1.5% gain over
// one are not the same trade, and only the second scales.
//
// STATED ONCE, because it decides how the table may be read: HOLD LENGTH IS CHOSEN, NOT ASSIGNED.
// A trip held ten days was held because of how it behaved, so a slow bucket is partly "trades that
// needed longer" and not only "what waiting earns". This is descriptive of what happened. The
// unconfounded companion is time-to-peak, which the app already measures forward from issue
// (getRocketArrivalStats), and it is reported beside the table rather than mixed into it.
function buildHoldDurationModel(trips){
  const INTRA=[[0,15,'<15m'],[15,30,'15-29m'],[30,60,'30-59m'],[60,120,'1-2h'],[120,240,'2-4h'],[240,1e9,'4h+']];
  const DAYS=[[1,2,'1d'],[2,3,'2d'],[3,6,'3-5d'],[6,11,'6-10d'],[11,21,'11-20d'],[21,1e9,'21d+']];
  const rows=[];
  (trips||[]).forEach(t=>{
    const pct=Number(t?.netPnlPct), rs=Number(t?.netPnl), cost=Number(t?.capital);
    if(!Number.isFinite(pct)||!Number.isFinite(rs)) return;
    const hd=Number(t?.holdDays);
    if(!Number.isFinite(hd)) return;
    if(hd===0){
      const b=clockMinutes(t?.buyTime), sl=clockMinutes(t?.sellTime);
      if(b==null||sl==null||sl<b) return;
      const mins=sl-b;
      const band=INTRA.find(x=>mins>=x[0]&&mins<x[1]);
      if(!band) return;
      // An intraday position occupies that session's SLOT, not a fraction of it - you cannot run
      // 125 sequential three-minute trades. Dividing by elapsed minutes made a 3-minute +1.8% read
      // as 226% per session and named it the best bucket, which is a normalisation artefact and not
      // advice. Intraday therefore costs one session of capital, which is also what makes it
      // directly comparable with the overnight cohort's per-session figure.
      rows.push({cohort:'Intraday',key:'i'+band[0],label:band[2],pct,rs,cost,
        perDay:pct,unit:mins});
    } else {
      const band=DAYS.find(x=>hd>=x[0]&&hd<x[1]);
      if(!band) return;
      rows.push({cohort:'Overnight',key:'d'+band[0],label:band[2],pct,rs,cost,
        perDay:pct/hd,unit:hd});
    }
  });
  if(!rows.length) return {trips:0,rows:[],best:null};
  const buckets={};
  rows.forEach(r=>(buckets[r.cohort+'|'+r.key]??=[]).push(r));
  const order=['Intraday','Overnight'];
  const out=Object.keys(buckets).map(k=>{
    const list=buckets[k];
    const pcts=list.map(r=>r.pct);
    const wins=list.filter(r=>r.rs>0).length;
    return {
      cohort:list[0].cohort, slice:list[0].label, sortKey:list[0].unit,
      trips:list.length,
      winPct:+(100*wins/list.length).toFixed(0),
      medianPct:+tradeMedian(pcts).toFixed(2),
      medianPerDay:+tradeMedian(list.map(r=>r.perDay)).toFixed(2),
      totalRs:Math.round(list.reduce((a,r)=>a+r.rs,0))
    };
  }).sort((a,b)=>order.indexOf(a.cohort)-order.indexOf(b.cohort)||a.sortKey-b.sortKey);
  // The decision the table exists to make: the bucket with the best return per day of capital,
  // within each cohort, and only where the sample can carry it.
  const pick=c=>{
    const c2=out.filter(r=>r.cohort===c&&r.trips>=10);
    if(!c2.length) return null;
    return c2.reduce((a,b)=>b.medianPerDay>a.medianPerDay?b:a);
  };
  return {trips:rows.length,rows:out,best:{intraday:pick('Intraday'),overnight:pick('Overnight')}};
}

// v1211 (owner): money-weighted return on CLOSED round trips. Each trip is two dated cash flows -
// the cost out on the buy date, the proceeds back (net of charges) on the sell date - so a run of
// small fast gains and one large slow gain are no longer read as the same performance. Open
// positions are deliberately excluded: marking them would mix a realised series with a live quote
// and the number would move every time the scanner refreshed. Bisection, not Newton: the sign change
// is bracketed so it cannot diverge on a pathological series, and it returns null rather than a
// number when the flows never change sign (all wins or all losses in one direction).
function computePortfolioXirr(trips){
  const flows=[];
  (trips||[]).forEach(t=>{
    const cost=Number(t?.capital), net=Number(t?.netPnl);
    if(!(cost>0)||!Number.isFinite(net)||!t.buyDate||!t.sellDate) return;
    flows.push({d:t.buyDate,v:-cost});
    flows.push({d:t.sellDate,v:cost+net});
  });
  if(flows.length<2) return {rate:null,trips:0,why:'no closed round trips with a cost basis'};
  flows.sort((a,b)=>String(a.d).localeCompare(String(b.d)));
  const t0=new Date(flows[0].d).getTime();
  const yrs=f=>((new Date(f.d).getTime()-t0)/86400000)/365;
  const npv=r=>flows.reduce((s,f)=>s+f.v/Math.pow(1+r,yrs(f)),0);
  const hasIn=flows.some(f=>f.v<0), hasOut=flows.some(f=>f.v>0);
  if(!hasIn||!hasOut) return {rate:null,trips:flows.length/2,why:'cash flows never change sign'};
  let lo=-0.9999, hi=1e3, flo=npv(lo), fhi=npv(hi);
  if(!Number.isFinite(flo)||!Number.isFinite(fhi)||flo*fhi>0)
    return {rate:null,trips:flows.length/2,why:'no rate brackets these cash flows'};
  for(let i=0;i<200;i++){
    const mid=(lo+hi)/2, f=npv(mid);
    if(!Number.isFinite(f)) break;
    if(flo*f<=0){ hi=mid; fhi=f; } else { lo=mid; flo=f; }
    if(Math.abs(hi-lo)<1e-9) break;
  }
  const rate=(lo+hi)/2;
  const spanDays=Math.round((new Date(flows.at(-1).d).getTime()-t0)/86400000);
  return {rate,trips:flows.length/2,spanDays,
    why:spanDays<30?'span is under 30 days, so the annualised figure is an extrapolation':''};
}
function getTodayTradeTimingContext(){
  const today=getSessionDate();
  const buys=(ORDERS_TODAY||[]).filter(o=>o.type==='BUY'&&normOrderDate(o.time)===today&&tradeClockMinute(o.time)!==null);
  const bySymbol={};
  buys.forEach(o=>{const symbol=normSym(o.symbol);if(!bySymbol[symbol]||String(o.time)<String(bySymbol[symbol].time))bySymbol[symbol]=o;});
  const entries=Object.values(bySymbol).sort((a,b)=>String(a.time).localeCompare(String(b.time)));
  const nowMinute=istNow().mins,lastMinute=entries.length?tradeClockMinute(entries.at(-1).time):null;
  const ordinal=entries.length+1,spacing=lastMinute===null?null:Math.max(0,nowMinute-lastMinute);
  return {
    nowMinute,windowKey:String(Math.floor(nowMinute/30)*30),
    ordinal,ordinalKey:ordinal>=5?'5+':String(ordinal),
    spacingMinutes:spacing,
    spacingKey:spacing===null?'First entry':spacing===0?'Same batch':spacing<15?'<15m':spacing<30?'15–29m':spacing<60?'30–59m':'60m+',
    completedEntries:entries.length
  };
}
function getCurrentTradeTimingDecision(contextOverride=null){
  const model=getTradeTimingModel(),context=contextOverride||getTodayTradeTimingContext();
  if(context.nowMinute<570){
    return {
      state:'Neutral',diagnosticState:'Opening discovery',
      reason:'Before 09:30 IST there is no completed 15-minute bar, so the 5m/15m/1h readings may be the same unfinished opening impulse. Shown for context; it does not restrict anything.',
      evidence:[],context,model,openingDiscovery:true
    };
  }
  if(!model.episodeCount) return {state:'Neutral',reason:'No resolved tradebook entry episodes yet.',evidence:[],context};
  const windowRow=model.groups.window.find(r=>r.key===context.windowKey)||null;
  const evidence=[windowRow].filter(Boolean);
  // Clock-window outcomes remain descriptive. Nothing on this path — not the clock, not the
  // opening window, not cross-stock ordinal/phase/spacing — has execution authority.
  return {
    state:'Neutral',diagnosticState:windowRow?.state||'Neutral',
    reason:'Historical clock-window outcome is display only and never changes stock eligibility.',
    evidence,context,model
  };
}
function getBuyContextBaseline(symbol,date){
  const e=FS.get(TRADE_TIMING_CONTEXT_STORE)?.entries?.[date+'|'+normSym(symbol)];
  if(!e) return null;
  const hi=Number(e.high1dAtBuy),lo=Number(e.low1dAtBuy);
  if(!(hi>0)&&!(lo>0)) return null;   // pre-v1096 entry: captured, but without the extremes
  return {high:hi>0?hi:null,low:lo>0?lo:null,orderTime:e.orderTime||null};
}
function recordTradeTimingEntryContext(){
  const today=getSessionDate();
  const buys=(ORDERS_TODAY||[]).filter(o=>o.type==='BUY'&&normOrderDate(o.time)===today&&tradeClockMinute(o.time)!==null);
  if(!buys.length||!ALL.length) return 0;
  const bySymbol={};
  buys.forEach(o=>{const symbol=normSym(o.symbol);if(!bySymbol[symbol]||String(o.time)<String(bySymbol[symbol].time))bySymbol[symbol]=o;});
  const ordered=Object.values(bySymbol).sort((a,b)=>String(a.time).localeCompare(String(b.time)));
  const store=FS.get(TRADE_TIMING_CONTEXT_STORE)||{version:1,entries:{}};
  let added=0;
  ordered.forEach((order,index)=>{
    const symbol=normSym(order.symbol),key=today+'|'+symbol;
    if(store.entries[key]) return; // first observed scanner context is immutable
    const row=ALL.find(s=>s.symbol===symbol);
    if(!row) return;
    const minute=tradeClockMinute(order.time);
    const prior=index?tradeClockMinute(ordered[index-1].time):null;
    store.entries[key]={
      id:key,date:today,symbol,orderTime:order.time,orderMinute:minute,
      ordinal:index+1,spacingMinutes:prior===null?null:Math.max(0,minute-prior),
      price:Number(order.price)||null,
      ctxVersion:2,
      high1dAtBuy:Number(row.high1d)>0?Number(row.high1d):null,
      low1dAtBuy:Number(row.low1d)>0?Number(row.low1d):null,
      priceAtObservation:Number(row.price)>0?Number(row.price):null,
      rank:row.rank??null,score:row.score??null,setup:row.setup||null,stage:row.stage??null,risk:row.risk||null,
      gap:row.gapSigned??row.gap??null,changeOpen:row.changeOpen??null,
      price1h:row.price1h??null,price15m:row.price15m??null,price5m:row.price5m??null,
      vwap:row.vwap??null,legTrendPct:row.legTrendPct??null,legHighPct:row.legHighPct??null,
      entryTiming:row.entryTiming||null,
      marketAdvPct:MARKET_INTRADAY?.advPct??null,marketMedian:MARKET_INTRADAY?.median??null,
      observedAt:new Date().toISOString(),
      observationNote:'first scanner snapshot after the completed buy was detected'
    };
    added++;
  });
  const keys=Object.keys(store.entries).sort((a,b)=>{
    const av=store.entries[a]?.orderTime||a,bv=store.entries[b]?.orderTime||b;
    return av.localeCompare(bv);
  });
  while(keys.length>500) delete store.entries[keys.shift()];
  if(added){store.updatedAt=new Date().toISOString();FS.set(TRADE_TIMING_CONTEXT_STORE,store);}
  return added;
}

function rankingsSearchQuery(){
  return String(document.getElementById('fSearch')?.value||'').trim().toLowerCase();
}
function filterPanelRows(rows,query,fieldsFn){
  const q=String(query||'').trim().toLowerCase();
  if(!q) return rows;
  return rows.filter(row=>fieldsFn(row).filter(Boolean).join(' ').toLowerCase().includes(q));
}
function panelFilterTag(all,shown,query){
  const q=String(query||'').trim();
  if(!q||shown.length===all.length) return '';
  return ` <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--t3)">· ${shown.length} of ${all.length} matching "${escHtml(q)}"</span>`;
}
function panelNoMatchHtml(query,noun){
  return `<div style="padding:14px 16px;color:var(--t3);font-size:14px">No ${noun} matches "${escHtml(String(query||'').trim())}".</div>`;
}

function buildLatestSessionPanel(query=''){
  const clr=(v)=>v===0?'var(--t2)':v>0?'var(--green)':'var(--red)';
  const fmtPerfRs=(v)=>fmtSignedINR(v);
  const fmtPct=(v)=>(v>=0?'+':'')+v.toFixed(2)+'%';
  // Attach Radar score/rank to each sold row so the session shows the scoring context of
  // what was exited (owner v546); the 'Trades' count column was dropped as noise.
  const _latestAllBySym=new Map(ALL.map(x=>[x.symbol,x]));
  const withRadar=arr=>{arr.forEach(r=>{const a=_latestAllBySym.get(r.sym);r._score=a&&isFinite(Number(a.score))?Number(a.score):null;r._rank=a?.rank??null;});return arr;};
  const radarCols=dash=>[
    {key:'_score',label:'Radar Score',align:'right',bold:true,fmt:v=>radarScoreCell(v),clrFn:()=>'var(--t1)',...dash},
    {key:'_rank',label:'Rank',align:'right',fmt:v=>v??'—',clrFn:()=>'var(--t2)',...dash},
  ];
  const leftClr=v=>v==null?'var(--t3)':v>0?'var(--red)':v===0?'var(--green)':'var(--amber)';
  const _leftTot={totFmt:v=>v!=null?fmtINR(v):'—',totClrFn:leftClr};
  const _leftPctTot={totFmt:v=>v!=null?v.toFixed(2)+'%':'—',totClrFn:leftClr};
  const _leftCols=(rsTot,pctTot)=>[
    {key:'leftOnTableRs',label:'Left on Table ₹',align:'right',bold:true,
     fmt:(v,r)=>v!=null
       ?`<span title="${escHtml(r.leftOnTableNote||'')}">${fmtINR(v)}</span>`
       :`<span style="color:var(--t3)" title="${escHtml(r.leftOnTableNote||'')}">—</span>`,
     clrFn:leftClr,...rsTot},
    {key:'leftOnTablePct',label:'Left on Table %',align:'right',
     fmt:(v,r)=>v!=null
       ?`<span title="${escHtml(r.leftOnTableNote||'')}">${v.toFixed(2)}%</span>`
       :`<span style="color:var(--t3)">—</span>`,
     clrFn:leftClr,...pctTot},
    // v1119: how long after the exit the day's high arrived. Positive = waiting would have paid.
    {key:'highGapMin',label:'High after sell',align:'right',
     fmt:(v,r)=>{
       if(r.highAt==null) return `<span style="color:var(--t3)" title="${escHtml(r.highNote||'')}">—</span>`;
       const gap=v==null?'':(v>0?`+${v}m`:v<0?`${v}m`:'0m');
       // "≤" marks a stamp that is an upper bound: the high was already in when watching began.
       const pre=r.highAtIsBound?'≤':'';
       return `<span title="${escHtml(r.highNote||'')}">${pre}${r.highAt}`
         +(gap?`<span style="font-size:12px;color:var(--t3);margin-left:4px">${r.highAtIsBound?'≤':''}${gap}</span>`:'')+`</span>`;
     },
     // Red when the high came AFTER the exit (money was still on the table), green when it came
     // before (the exit was not early). Same inverted polarity as the Left on Table columns.
     clrFn:v=>v==null?'var(--t3)':v>0?'var(--red)':'var(--green)',
     totFmt:v=>v==null?'—':(v>0?`+${v}m avg`:`${v}m avg`),
     totClrFn:v=>v==null?'var(--t3)':v>0?'var(--red)':'var(--green)'},
  ];
  const card=inner=>`<div id="rank-latest-session-card" style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden">${inner}</div>`;
  const summary=getLatestBookedSummary();
  PERF_LATEST_SUMMARY=summary; // cache for the renderStats card — single source of truth
  const orderBooked=summary?.source==='Orders.csv'?summary:null;

  if(orderBooked){
    const allRows=orderBooked.rows;
    const latestDate=orderBooked.date||getSessionDate();
    const latestTotal=orderBooked.total;
    const latestUnknownRows=orderBooked.unknownRows||0;
    const latestUnknownWarning=latestUnknownRows>0?` <span style="font-size:12px;color:var(--amber);font-weight:700">&#9888; excludes ${latestUnknownRows} row${latestUnknownRows===1?'':'s'} with unknown cost</span>`:'';
    const rows=withRadar(filterPanelRows(allRows,query,r=>[r.sym]));
    const shownSummary=summarizeExitPnlRows(rows);
    // v1097: persist from the UNFILTERED set — the search box must never move the stored figure.
    recordLeftOnTableSession(latestDate,summarizeExitPnlRows(allRows));
    const shownTotal=rows.reduce((s,r)=>s+(r.netPnl||0),0);
    const _chFmt=v=>fmtNegINR(v);const _chClr=()=>'var(--red)';
    // Totals ride the component's totalsRow (keyed by column) so they follow any
    // user-dragged column order — the old hand-built tfoot assumed a fixed sequence.
    const _dash={totFmt:()=>'—',totClrFn:()=>'var(--t3)'};
    const _signTot={totFmt:v=>v!=null?fmtPerfRs(v):'—',totClrFn:v=>v!=null?(v>=0?'var(--green)':'var(--red)'):'var(--t3)'};
    const _chTot={totFmt:v=>fmtNegINR(v),totClrFn:()=>'var(--red)'};
    const latestCols=[
      {key:'sym',label:'Symbol',align:'left',fmt:v=>symbolChartButton(v),clrFn:()=>'var(--t1)',bold:true,totFmt:v=>v??'',totClrFn:()=>'var(--t2)'},
      ...radarCols(_dash),
      {key:'buyPrice',label:'Buy ₹',align:'right',fmt:(v,r)=>v!=null?Number(v).toLocaleString('en-IN',INR_2):`<span style="color:var(--amber);font-size:12px" title="Load Holdings.csv to see avg cost">avg cost?</span>`,clrFn:()=>'var(--t2)',..._dash},
      {key:'sellPrice',label:'Sell ₹',align:'right',fmt:v=>Number(v).toLocaleString('en-IN',INR_2),clrFn:()=>'var(--t2)',..._dash},
      {key:'priceDiff',label:'Diff ₹',align:'right',fmt:v=>v!=null?fmtSignedINR(v).replace('₹','₹/sh '):'—',clrFn:v=>v!=null?clr(v):'var(--t3)',..._dash},
      {key:'currentPrice',label:'Now ₹',align:'right',fmt:v=>v!=null?Number(v).toLocaleString('en-IN',INR_2):'—',clrFn:()=>'var(--t2)',..._dash},
      ..._leftCols(_leftTot,_leftPctTot),
      {key:'charges',label:'Total Charges',align:'right',bold:true,
       fmt:(v,r)=>{
         if(v==null) return '—';
         const parts=[['Brokerage',r._brok],['STT/CTT',r._stt],['Txn',r._txn],['GST',r._gst],
                      ['SEBI',r._sebi],['Stamp',r._stamp],['DP',r._dp]]
           .filter(([,x])=>Number(x))
           .map(([k,x])=>`${k} ${fmtNegINR(x)}`).join(' · ');
         return `<span title="${escHtml(parts||'no component breakdown on this row')}">${fmtNegINR(v)}</span>`;
       },
       clrFn:()=>'var(--red)',..._chTot},
      {key:'grossPnl',label:'Gross P&L',align:'right',bold:true,fmt:v=>v!=null?fmtPerfRs(v):'—',clrFn:v=>v!=null?clr(v):'var(--t3)',..._signTot},
      {key:'netPnl',label:'Net P&L',align:'right',bold:true,fmt:(v,r)=>v!=null?fmtPerfRs(v):`<span style="color:var(--amber);font-size:12px">unknown</span>`,clrFn:(v)=>v!=null?clr(v):'var(--amber)',..._signTot},
      {key:'netPnlPct',label:'P&L %',align:'right',bold:true,fmt:v=>v!=null?fmtPct(v):`<span style="color:var(--amber);font-size:12px">unknown</span>`,clrFn:v=>v!=null?clr(v):'var(--amber)',totFmt:v=>v==null?'--':fmtPct(v),totClrFn:v=>v==null?'var(--t3)':v>=0?'var(--green)':'var(--red)'},
    ];
    const _sum=k=>rows.reduce((s,r)=>s+(r[k]||0),0);
    const latestTotals=(rows.length>1||latestUnknownRows>0)?{
      sym:`Total (${rows.length})${latestUnknownRows?` <span style="color:var(--amber)">&#9888; excludes ${latestUnknownRows} unknown</span>`:''}`,
      leftOnTableRs:shownSummary.leftCount?shownSummary.leftRs:null,
      leftOnTablePct:shownSummary.leftCount?shownSummary.leftPct:null,
      _brok:_sum('_brok'),_stt:_sum('_stt'),_txn:_sum('_txn'),_gst:_sum('_gst'),_sebi:_sum('_sebi'),_stamp:_sum('_stamp'),_dp:_sum('_dp'),
      charges:_sum('charges'),
      grossPnl:shownSummary.known.length?shownSummary.gross:null,
      netPnl:shownTotal,
      netPnlPct:shownSummary.pct,
      // v1121: the session's AVERAGE gap between the exit and the day's high. Straight mean over the
      // rows that have one — negatives included, because a negative is the informative case (the
      // high was already in, so the exit was late rather than early).
      highGapMin:(()=>{const g=rows.map(r=>r.highGapMin).filter(v=>Number.isFinite(v));
        return g.length?Math.round(g.reduce((a,b)=>a+b,0)/g.length):null;})()
    }:null;
    const latestTbl=makeSortableTable('rank-latest-session',latestCols,rows,'_sort',-1,null,latestTotals,'sym');
    const emptyNote=String(query||'').trim()
      ?panelNoMatchHtml(query,'booked trade')
      :`<div style="padding:12px 16px;color:var(--t3);font-size:14px">No sell orders found in Orders.csv — only sell orders generate P&L rows.</div>`;
    const html=card(`
      <div style="padding:10px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.1em">Latest Session — ${latestDate} <span style="font-weight:400;color:var(--t3)">(Orders.csv · holdings/same-day buys)</span>${panelFilterTag(allRows,rows,query)}</span>
        <span style="font-size:17px;font-weight:800;color:${clr(latestTotal)};font-family:'DM Mono',monospace">${allRows.length?fmtPerfRs(latestTotal):''} <span style="font-size:12px;color:var(--t3);font-weight:400">${allRows.length?'net of charges':''}</span>${latestUnknownWarning}</span>
      </div>
      ${rows.length?`<div class="scroll-x">${latestTbl.getHtml()}</div>`:emptyNote}`);
    const render=()=>{if(rows.length)latestTbl.render();};
    return {html,render};
  }

  if(summary?.source==='Tradebook'){
    const allRows=summary.rows.map(r=>{
      const capital=r.capital??((r.buyPrice||0)*(r.qty||0));
      const netPnlPct=r.netPnlPct??(capital>0?+(r.netPnl/capital*100).toFixed(2):null);
      return enrichExitPnlRow({...r,capital,netPnlPct,_sort:r.netPnl},summary.date||null);
    });
    const tbDate=summary.date||'';
    const tbTotal=+(allRows.reduce((s,r)=>s+r.netPnl,0)).toFixed(0);
    const rows=withRadar(filterPanelRows(allRows,query,r=>[r.sym]));
    const tbSummary=summarizeExitPnlRows(rows);
    // v1097: same rule as the Orders branch — store the whole session, never the search match.
    if(tbDate) recordLeftOnTableSession(tbDate,summarizeExitPnlRows(allRows));
    const shownTotal=+(rows.reduce((s,r)=>s+r.netPnl,0)).toFixed(0);
    const _dash={totFmt:()=>'—',totClrFn:()=>'var(--t3)'};
    const _signTot={totFmt:v=>v!=null?fmtPerfRs(v):'—',totClrFn:v=>v!=null?(v>=0?'var(--green)':'var(--red)'):'var(--t3)'};
    const tbCols=[
      {key:'sym',label:'Symbol',align:'left',fmt:v=>symbolChartButton(v,`<span style="font-weight:700;font-size:14px">${escHtml(v)}</span>`),totFmt:v=>v??'',totClrFn:()=>'var(--t2)'},
      ...radarCols(_dash),
      {key:'buyPrice',label:'Buy ₹',align:'right',fmt:v=>`<span style="font-family:'DM Mono',monospace">${Number(v).toLocaleString('en-IN',INR_2)}</span>`,..._dash},
      {key:'sellPrice',label:'Sell ₹',align:'right',fmt:v=>`<span style="font-family:'DM Mono',monospace">${Number(v).toLocaleString('en-IN',INR_2)}</span>`,..._dash},
      {key:'priceDiff',label:'Diff ₹',align:'right',fmt:v=>v!=null?fmtSignedINR(v).replace('₹','₹/sh '):'—',clrFn:v=>v!=null?clr(v):'var(--t3)',..._dash},
      {key:'currentPrice',label:'Now ₹',align:'right',fmt:v=>v!=null?Number(v).toLocaleString('en-IN',INR_2):'—',clrFn:()=>'var(--t2)',..._dash},
      ..._leftCols(_leftTot,_leftPctTot),
      {key:'charges',label:'Charges ₹',align:'right',bold:true,fmt:fmtNegINR,clrFn:()=>'var(--red)',totFmt:v=>fmtNegINR(v),totClrFn:()=>'var(--red)'},
      {key:'grossPnl',label:'Gross P&L',align:'right',bold:true,fmt:v=>v!=null?fmtPerfRs(v):'—',clrFn:v=>v!=null?clr(v):'var(--t3)',..._signTot},
      {key:'netPnl',label:'Net P&L',align:'right',bold:true,fmt:fmtPerfRs,clrFn:clr,..._signTot},
      {key:'netPnlPct',label:'P&L %',align:'right',bold:true,fmt:v=>v!=null?fmtPct(v):'--',clrFn:v=>v!=null?clr(v):'var(--t3)',totFmt:v=>v==null?'--':fmtPct(v),totClrFn:v=>v==null?'var(--t3)':v>=0?'var(--green)':'var(--red)'},
    ];
    const tbTotals=rows.length>1?{
      sym:`Total (${rows.length})`,
      leftOnTableRs:tbSummary.leftCount?tbSummary.leftRs:null,
      leftOnTablePct:tbSummary.leftCount?tbSummary.leftPct:null,
      charges:rows.reduce((s,r)=>s+(r.charges||0),0),
      grossPnl:tbSummary.known.length?tbSummary.gross:null,
      netPnl:shownTotal,
      netPnlPct:tbSummary.pct
    }:null;
    const tbTbl=makeSortableTable('rank-latest-session',tbCols,rows,'_sort',-1,null,tbTotals,'sym');
    const html=card(`
      <div style="padding:10px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.1em">Latest Session — ${tbDate} <span style="font-weight:400;color:var(--t3)">(Tradebook · charges included)</span>${panelFilterTag(allRows,rows,query)}</span>
        <span style="font-size:17px;font-weight:800;color:${clr(tbTotal)};font-family:'DM Mono',monospace">${fmtPerfRs(tbTotal)} <span style="font-size:12px;color:var(--t3);font-weight:400">net of charges</span></span>
      </div>
      ${rows.length?`<div class="scroll-x">${tbTbl.getHtml()}</div>`:panelNoMatchHtml(query,'booked trade')}`);
    const render=()=>{if(rows.length)tbTbl.render();};
    return {html,render};
  }

  return {html:card(`<div style="padding:14px 16px;color:var(--t3);font-size:14px">
      <span style="font-weight:600;color:var(--t2)">Latest Session</span> — Upload <strong>Tradebook.csv</strong> or <strong>Orders.csv</strong> to see session P&amp;L.
    </div>`),render:()=>{}};
}

// One current-position view: the live portfolio merge plus the existing Radar context.
// It reads the exit-policy helpers but never feeds anything back into scoring.
// `query` filters only what is DISPLAYED; the panel always computes from the full position set.
function buildOpenPositionsPanel(query=''){
  const reviewDays=getEffectiveReviewDays()||5;
  const scannerBySymbol=new Map(ALL.map(row=>[row.symbol,row]));
  const rows=[];

  Object.values(getCombinedOpenPositionMap()).forEach(pos=>{
    const qty=Number(pos?.qty)||0;
    if(!(qty>0)||!pos.symbol) return;
    const scannerRow=scannerBySymbol.get(pos.symbol)||null;
    const ltp=Number(scannerRow?.price)>0
      ?Number(scannerRow.price)
      :Number(pos.ltp)>0?Number(pos.ltp):null;
    const avg=Number(pos.avg)>0?Number(pos.avg):(HOLD_COST_MAP[pos.symbol]||null);
    const pnlPct=(avg&&ltp)?+((ltp-avg)/avg*100).toFixed(2):null;
    const pnlRs=(avg&&ltp)?+((ltp-avg)*qty).toFixed(0):null;
    const daysHeld=getOpenPositionDaysHeld(pos.symbol,qty);
    const capital=avg?+(avg*qty).toFixed(0):null;
    const exitPolicy=getRowExitPolicy(scannerRow,avg);
    const stopPct=exitPolicy.stopPct;
    const targetPct=exitPolicy.targetPct;
    const targetPrice=avg&&targetPct?tickPrice(avg*(1+targetPct/100)):null;
    const stopPrice=avg?tickPrice(avg*(1-stopPct/100)):null;
    const _split=splitQty(qty);
    const _runnerPct=getRunnerTargetPct(exitPolicy);
    const _hasRunner=_split.runner>0&&_runnerPct>targetPct;
    const baseQty=_hasRunner?_split.base:qty;
    const runnerQty=_hasRunner?_split.runner:0;
    const runnerPct=_hasRunner?_runnerPct:null;
    const runnerPrice=(_hasRunner&&avg)?tickPrice(avg*(1+_runnerPct/100)):null;
    // v1106 (owner): the day-1 time-exit ADVICE went with the Action column - the trading surface
    // carries no instructions. The evidence behind it is unchanged and lives in Methodology.
    rows.push({
      sym:pos.symbol,qty,avg,ltp,pnlPct,pnlRs,capital,daysHeld,targetPrice,stopPrice,targetPct,exitPolicy,
      // v1210: today, through the same window the verdict reads. This field was the last survivor
      // of the multi-session leak v1209 closed everywhere else.
      flow:(()=>{const {tt}=getPositionFlowRead(getIntradayRead(pos.symbol));
        return tt&&Number.isFinite(tt.cvdPct)?+(tt.cvdPct*100).toFixed(2):null;})(),
      baseQty,runnerQty,runnerPrice,runnerPct,
      score:isFinite(Number(scannerRow?.score))?Number(scannerRow.score):null,
      rank:scannerRow?.rank??null,setup:scannerRow?.setup||'',
      dayPct:scannerRow?.day??scannerRow?.priceChange??null,risk:scannerRow?.risk||'',
      pace:(()=>{const r=getIntradayRead(pos.symbol);return r&&r.current&&Number.isFinite(r.confirmedPacePct)?r.confirmedPacePct:null;})(),
      predEod:(()=>{const r=getIntradayRead(pos.symbol);return r&&r.current&&r.eod&&Number.isFinite(r.eod.pct)?r.eod.pct:null;})(),
      scannerRow
    });
  });

  if(!rows.length){
    return {html:'',table:null};
  }

  const daysFmt=(v)=>{
    if(v==null) return '<span style="color:var(--t3)">—</span>';
    const color=v>reviewDays?'var(--red)':v>=reviewDays?'var(--amber)':'var(--t1)';
    return `<span title="Quantity-weighted age of remaining FIFO buy lots" style="color:${color};font-weight:${v>reviewDays?700:500}">${v}d</span>`;
  };
  const cols=[
    {key:'sym',label:'Symbol',align:'left',bold:true,
      // The flow reading rides the SYMBOL cell rather than a column of its own: one more column
      // pushed this panel into a horizontal scrollbar, which the owner has ruled out everywhere.
      fmt:(v,row)=>{
        const rd=getIntradayRead(v);
        let tag='';
        if(rd&&rd.traj){
          // v1206: the tooltip reads the SAME trajectory the instruction was computed on, and says
          // which session that is. It used to quote the whole-file read beside a verdict built on
          // today, which is how a row could carry EXIT ALL over the word ACCUMULATING.
          const {tt:_ft,span:_fs}=getPositionFlowRead(rd);
          const _fr=_ft?_ft.regime:rd.regime;
          const col=_fr==='accumulating'?'var(--green)':_fr==='selling'?'var(--red)':'var(--amber)';
          // v1172: the ACTION, not the weather. The regime and the flow numbers move to the tooltip.
          const a=getPositionAction(v,row);
          const ac=a?(a.tone==='green'?'var(--green)':a.tone==='red'?'var(--red)':'var(--amber)'):col;
          const _lvl=(a&&a.execution&&Number.isFinite(a.execution.level))
            ? `<span style="color:var(--t3);font-weight:600"> @ ${escHtml(fmtINR(a.execution.level))}</span>`
            : (a&&a.covered?'<span style="color:var(--t3);font-weight:600"> already worked</span>':'');
          tag=`<div style="font-size:11px;color:${ac};font-weight:700" title="${escHtml(
            (a?a.act+' — '+a.why+String.fromCharCode(10):'')
            +(_ft?(_fr.toUpperCase()+' — net flow '+(_ft.cvdPct*100).toFixed(1)+'% of everything traded'
              +(_ft.costRatio?'; 1% up costs '+Math.round(_ft.upCost).toLocaleString('en-IN')
                +' shares against '+Math.round(_ft.dnCost).toLocaleString('en-IN')+' down':'')
              +(Number.isFinite(_ft.pressurePct)?'; unspent pressure '
                +(_ft.pressurePct>=0?'+':'')+_ft.pressurePct.toFixed(2)+'%':'')
              +(_fs?_fs:' this session'))
              :('last read was '+rd.on+', not this session')))}">${
            a?escHtml(a.act)+_lvl:(_fr==='accumulating'?'HOLDING UP':_fr==='selling'?'BEING SOLD':escHtml(_fr))
          }</div>`;
        }else{
          const a=getPositionAction(v,row);
          if(a){
            const ac=a.tone==='green'?'var(--green)':a.tone==='red'?'var(--red)':'var(--amber)';
            const _lvl2=(a.execution&&Number.isFinite(a.execution.level))
              ? `<span style="color:var(--t3);font-weight:600"> @ ${escHtml(fmtINR(a.execution.level))}</span>`
              : (a.covered?'<span style="color:var(--t3);font-weight:600"> already worked</span>':'');
            tag=`<div style="font-size:11px;color:${ac};font-weight:700" title="${escHtml(a.act+' — '+a.why)}">${escHtml(a.act)+_lvl2}</div>`;
          }
        }
        return intradayRowButton({symbol:v})+symbolChartButton(v)+tag;
      }},

    {key:'qty',label:'Qty',align:'right',fmt:v=>v,clrFn:()=>'var(--t2)'},
    {key:'ltp',label:'Avg / LTP',align:'right',
      fmt:(v,row)=>`${row.avg!=null?Number(row.avg).toLocaleString('en-IN',INR_2):'—'}<span style="color:var(--t3)"> / </span>${v!=null?Number(v).toLocaleString('en-IN',INR_2):'—'}`,
      clrFn:()=>'var(--t1)'},
    {key:'pnlRs',label:'P&L',align:'right',bold:true,
      fmt:(v,row)=>`${v!=null?fmtSignedINR(v):'—'}<span style="font-size:11px;color:var(--t3)"> ${row.pnlPct!=null?(row.pnlPct>=0?'+':'')+row.pnlPct.toFixed(2)+'%':''}</span>`,
      clrFn:v=>v==null?'var(--t3)':v>0?'var(--green)':v<0?'var(--red)':'var(--t2)'},
    {key:'daysHeld',label:'Held',align:'right',fmt:daysFmt,clrFn:()=>'var(--t1)'},
    {key:'targetPrice',label:'Target ₹',align:'right',
      fmt:(v,row)=>{
        if(v==null) return '<span style="color:var(--t3)">—</span>';
        const legacy=row.runnerPrice!=null
          ? ` A position opened before v1177 may still have a second GTT resting at ${fmtINR(row.runnerPrice)} for ${row.runnerQty} share(s) — check Zerodha before re-arming.`
          : '';
        return fmtINR(v)+`<span style="font-size:11px;color:var(--t3)">×${row.qty??''}</span>`
          +`<span title="${escHtml('The whole position exits here: '+(row.targetPct!=null?('+'+Number(row.targetPct).toFixed(2)+'%'):'')+' on its own exit policy.'+legacy)}"></span>`;
      },
      clrFn:()=>'var(--green)'},
    {key:'stopPrice',label:'SL ₹',align:'right',fmt:(v,row)=>v!=null?fmtINR(v)+`<span style="font-size:12px;color:var(--t3);margin-left:4px">-${Number(row.exitPolicy?.stopPct).toFixed(2)}%</span>`:'—',clrFn:()=>'var(--red)'},
    {key:'score',label:'Score/#',align:'right',bold:true,
      fmt:(v,row)=>radarScoreCell(v)+`<span style="font-size:11px;color:var(--t3)"> #${row.rank??'—'}</span>`,
      clrFn:()=>'var(--t1)'},
    {key:'dayPct',label:'Day %',align:'right',fmt:fPerf,clrFn:()=>'var(--t2)'},
    // Pace and EoD share one cell so the panel does not gain a horizontal scrollbar. Pace is the
    // suggested Zerodha trigger GAP: the deepest seller retreat buyers proved survivable by making
    // a later high. EoD keeps its separate volume-weighted per-bar speed model.
    {key:'pace',label:'Pace / EoD',align:'right',
      fmt:(v,row)=>{
        const dim=(txt,title)=>`<span style="color:var(--t3)"${title?` title="${escHtml(title)}"`:''}>${txt}</span>`;
        const rd=getIntradayRead(row.sym);
        if(!rd) return dim('—','No 5-minute read for this stock yet.');
        if(!rd.current) return dim('—',`Last read was ${rd.on}, not this session — nothing here can describe today.`);

        const ltp=Number(row.ltp)||0;
        let pace;
        if(Number.isFinite(rd.confirmedPacePct)){
          const rs=ltp>0?ltp*rd.confirmedPacePct/100:null;
          const open=Number.isFinite(rd.currentPullbackPct)
            ?` Current unresolved pullback: ${rd.currentPullbackPct.toFixed(2)}%; it does not widen Pace unless buyers make another high.`:'';
          pace=`<span title="${escHtml('Deepest seller pullback today that buyers subsequently recovered by establishing a new high. '
            +rd.confirmedPullbackCount+' recovered episode'+(rd.confirmedPullbackCount===1?'':'s')
            +(rs?'; suggested Zerodha trigger gap at this LTP is ₹'+rs.toFixed(2):'')+'.'+open)}">${rd.confirmedPacePct.toFixed(2)}%${
            rs?`<span style="color:var(--t3);font-size:11px"> ₹${rs.toFixed(2)}</span>`:''}</span>`;
        } else if(Number.isFinite(rd.currentPullbackPct)){
          // Down and NOT back. No trail distance is quoted, deliberately.
          pace=dim(`↓${rd.currentPullbackPct.toFixed(2)}%`,
            `Down ${rd.currentPullbackPct.toFixed(2)}% from today's high and not recovered — buyers have made no new high since. `
            +`This is NOT Pace and is not a trail distance: a trailing stop exists to ride a pullback that was recovered, and this one has not been.`);
        } else {
          pace=dim('—','No seller pullback has yet been followed by a new high today.');
        }

        // v1206: ONE OBJECT, so the number and the pressure that explains it cannot come from
        // different windows. `rd.eod` is the CURRENT session's projection or nothing.
        const t=rd.eod;
        // ...and when the instruction on this row runs the other way, the cell says WHICH reading
        // overruled which, instead of leaving two numbers arguing. That is the owner's question of
        // 2026-08-20 answered where he asked it, not in a methodology page.
        // v1210: it quotes the INSTRUCTION'S OWN reconciliation rather than guessing at one. The
        // old text asserted the clash was always the flow test; on a stop-driven exit that was
        // simply untrue, and the row then carried a third story.
        const _act=getPositionAction(row.sym,row);
        const _clash=(t&&_act&&/^EXIT/.test(_act.act)&&t.pct>0)
          ?' This row still says '+_act.act+' — '+_act.why
          :'';
        const eod=t
          ?`<span style="color:${t.pct>=0?'var(--green)':'var(--red)'};font-weight:700" title="${escHtml(
              'Unspent pressure '+(t.pressurePct>=0?'+':'')+t.pressurePct.toFixed(2)+'% THIS SESSION, capped by what '
              +'this stock can travel in the '+t.barsLeft+' bars left and scaled to the '
              +Math.round(t.sessionSeen*100)+'% of the session already seen. Arithmetic, not a forecast.'+_clash)}">${
              (t.pct>=0?'+':'')+t.pct.toFixed(2)}%</span>`
          :dim('—',rd.todayTraj&&rd.todayTraj.pressureConverting===false
            ?'No projection: this session\u2019s imbalance is being ABSORBED, not converted — its unspent '
             +'pressure points one way and its own price slope the other, so there is no honest close to quote.'
            :'No projection: the current session has under three bars, or carries no measurable unspent pressure yet.');
        return pace+'<span style="color:var(--t3)"> / </span>'+eod;
      },clrFn:()=>'var(--t2)'},
    {key:'risk',label:'Risk',align:'left',fmt:v=>v?radarRiskPill(v):'—'}
  ];
  // Header totals always describe the WHOLE portfolio; the table shows the search match.
  const totalCapital=rows.reduce((sum,row)=>sum+(row.capital||0),0);
  const totalPnl=rows.reduce((sum,row)=>sum+(row.pnlRs||0),0);
  const pnlColor=totalPnl>0?'var(--green)':totalPnl<0?'var(--red)':'var(--t3)';
  const shown=filterPanelRows(rows,query,row=>[row.sym,row.scannerRow?.name,row.scannerRow?.sector]);
  const table=makeSortableTable('rank-open-positions',cols,shown,'rank',1,null,null,'sym');
  const radarNote=ALL.length
    ?'Radar context is from the current ALL NSE upload. Click a symbol for its scoring breakdown.'
    :'Load ALL NSE.csv to add Radar score, rank, setup, day change, and risk.';
  const html=`<div id="rank-open-positions-card" style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden">
    <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px">
        <span style="font-size:13px;font-weight:800;color:var(--t1);text-transform:uppercase;letter-spacing:.08em">Open Positions${panelFilterTag(rows,shown,query)}</span>
        <span style="font-size:14px;font-weight:700;color:${pnlColor}">${rows.length} live position${rows.length===1?'':'s'} · ${fmtINR(totalCapital)} deployed · ${fmtSignedINR(totalPnl)}</span>
      </div>
      <div style="font-size:14px;color:var(--t2);line-height:1.5">Live merge of Holdings, Positions, and today's net buys. Held stocks stay excluded from new recommendations; Target, Runner and SL are the row’s CURRENT exit policy — the two target legs the buy basket arms — not a read of the GTTs resting in Zerodha. ${radarNote}</div>
    </div>
    ${shown.length?`<div class="scroll-x">${table.getHtml()}</div>`:panelNoMatchHtml(query,'open position')}
  </div>`;
  return {html,table:shown.length?table:null};
}


// v1108: the live per-stock target range, for surfaces that used to quote the portfolio anchor.
// Since v1105 the anchor is only the floor; the target is each stock's own capacity.
function _tgtRangeTxt(){
  try{ const r=summarizeRowExitPolicies(ALL);
    return r? ` · targets ${r.targetMin.toFixed(2)}-${r.targetMax.toFixed(2)}%` : '';
  }catch(e){ return ''; }
}
function renderPerformance(){
  PERF_RENDERED=true;
  const el=document.getElementById('perfContent');
  if(!el) return;
  const hdrEl=document.querySelector('.hdr');
  if(hdrEl) document.documentElement.style.setProperty('--hdr-h',hdrEl.offsetHeight+'px');
  const tb=TRADEBOOK_STATS;
  // Re-apply the realised tradebook exit policy BEFORE the panel is built: it reads
  // getEffectiveTgtPct/getEffectiveReviewDays, which this refresh is what feeds.
  if(tb?.tripsData?.length){
    refreshExitPolicyFromFeedback(tb);
    try{FS.set(TRADEBOOK_STORE,tb);}catch(e){}
  }
  // Latest Session and Open Positions now live on the Rankings tab (v530).
  if(!tb){
    el.innerHTML=`<div style="padding:12px 16px"><div style="text-align:center;padding:60px 40px;color:var(--t2)"><div style="font-size:18px;font-weight:700;color:var(--t1);margin-bottom:8px">No Tradebook Loaded</div><div>Upload TRADEBOOK.csv to see performance analytics. Open Positions and Latest Session are on the Rankings tab.</div></div></div>`;
    return;
  }

  const clr=(v)=>v===0?'var(--t2)':v>0?'var(--green)':'var(--red)';
  const fmtPerfRs=(v)=>fmtSignedINR(v);
  const fmtPct=(v)=>(v>=0?'+':'')+v.toFixed(2)+'%';

  const allTripsRaw=tb.tripsData||[];
  if(!allTripsRaw.length&&tb.roundTrips>0){
    el.innerHTML=`<div style="padding:12px 16px"><div style="text-align:center;padding:60px 40px;color:var(--t2)"><div style="font-size:18px;font-weight:700;color:var(--t1);margin-bottom:8px">Re-upload TRADEBOOK.csv</div><div>Brain has ${tb.roundTrips} trades stored in the old format. Re-upload TRADEBOOK.csv once to rebuild with full trip data.</div></div></div>`;
    return;
  }

  const allTrips=allTripsRaw;
  const adaptiveAllTrips=getAdaptiveTradeTrips(allTrips);
  const preSystemLots=Math.max(0,allTrips.length-adaptiveAllTrips.length);

  const _now=new Date(getSessionDate());
  const _cutoff=PERF_PERIOD_FILTER==='all'?null
    :PERF_PERIOD_FILTER==='1m'?new Date(_now.getFullYear(),_now.getMonth()-1,_now.getDate()).toISOString().slice(0,10)
    :PERF_PERIOD_FILTER==='3m'?new Date(_now.getFullYear(),_now.getMonth()-3,_now.getDate()).toISOString().slice(0,10)
    :PERF_PERIOD_FILTER==='6m'?new Date(_now.getFullYear(),_now.getMonth()-6,_now.getDate()).toISOString().slice(0,10)
    :new Date(_now.getFullYear()-1,_now.getMonth(),_now.getDate()).toISOString().slice(0,10);
  const recentTrips=_cutoff?adaptiveAllTrips.filter(r=>r.sellDate>=_cutoff):adaptiveAllTrips;
  const p=computePerfStats(recentTrips.length?recentTrips:adaptiveAllTrips);
  const allSellDates=[...new Set(recentTrips.map(r=>r.sellDate))].sort();
  const dfrom=allSellDates[0], dto=allSellDates.at(-1);
  const calDayCount=(dfrom&&dto)?Math.round((new Date(dto)-new Date(dfrom))/86400000)+1:null;
  const avgCalDayPnl=(calDayCount&&calDayCount>0)?Math.round(p.totalNetPnlRs/calDayCount):null;
  const spanTradingDays=(dfrom&&dto)?(dfrom===dto?1:(tradingDaysBetween(dfrom,dto)||0)+1):null;
  const periodLabel=(dfrom&&dto)?`${dfrom} -> ${dto}`:'System period';
  const exitPolicy=tb.exitPolicy||null;
  const effectiveReviewDays=getEffectiveReviewDays();
  const recSummary=getRecommendationOutcomeSummary();
  const entrySummary=getExecutedEntryOutcomeSummary();
  updateFilterPlaceholders();
  const allocationCapital=getEffectiveCapital();
  const allocationCadence=getAverageTradesPerEntryDay();
  const autoMaxAlloc=allocationCapital>0&&allocationCadence?Math.round(allocationCapital/allocationCadence):0;
  const typedMaxAlloc=parseFloat(document.getElementById('fMaxAlloc')?.value);
  const maxAllocOverride=Number.isFinite(typedMaxAlloc)&&typedMaxAlloc>0;

  // Today's booked P&L is not in the tradebook yet — add it to the money total so the
  // headline matches reality, and say so explicitly rather than silently blending it.
  const todayAdd=getTodayBookedAddendum();
  const netWithToday=p.totalNetPnlRs+(todayAdd?.amount||0);
  const todayNote=todayAdd?` · incl. ${fmtPerfRs(todayAdd.amount)} booked ${todayAdd.date} from Orders (tradebook ends ${todayAdd.tradebookDate||'—'})`:'';
  const kpis=[
    {label:'Net P&L',value:fmtPerfRs(netWithToday),color:clr(netWithToday),sub:`${p.roundTrips}${todayAdd?`+${todayAdd.lots}`:''} lots · ${spanTradingDays||p.totalTradingDays} trading days${todayNote}${preSystemLots?` · ${preSystemLots} pre-system ignored`:''}`},
    {label:'Win Rate',value:p.winRate+'%',color:p.winRate>=55?'var(--green)':p.winRate>=45?'var(--amber)':'var(--red)',sub:`${p.winners}W · ${p.losers}L lots`},
    {label:'Expectancy',value:fmtPerfRs(p.expectancy),color:clr(p.expectancy),sub:'Net ₹ you make per lot, on average'},
    {label:'Profit Factor',value:p.profitFactor!=null?p.profitFactor:'—',color:p.profitFactor>=1.5?'var(--green)':p.profitFactor>=1?'var(--amber)':'var(--red)',sub:'Gross wins ÷ gross losses · above 1 = profitable'},
    {label:'Max Allocation',value:autoMaxAlloc?fmtINR(autoMaxAlloc):'—',color:autoMaxAlloc?'var(--amber)':'var(--t3)',sub:autoMaxAlloc?`${fmtINR(allocationCapital)} capital ÷ ${allocationCadence.toFixed(2)} avg positions/entry day${maxAllocOverride?` · typed override ${fmtINR(typedMaxAlloc)} active`:''}`:'Load trade history to calculate trading cadence'},
    (()=>{const g=getHighGapStats();
      return {label:'High vs Exit',
        value:g.meanMin==null?'—':(g.meanMin>0?`+${g.meanMin}m`:`${g.meanMin}m`),
        color:g.meanMin==null?'var(--t3)':g.meanMin>0?'var(--red)':'var(--green)',
        sub:g.meanMin==null
          ? `Recording since 2026-08-11 · ${g.source}`
          : `Mean minutes from your exit to the day's high · median ${g.medianMin>0?'+':''}${g.medianMin}m · high came AFTER the exit on ${g.afterCount} of ${g.n} · ${g.source}`};})(),
    {label:'Max Drawdown',value:p.maxDrawdown>0?fmtSignedINR(-p.maxDrawdown):'—',color:'var(--red)',sub:'Worst peak-to-trough fall in this period'},
    {label:'Largest Loss',value:fmtSignedINR(p.largestLossRs),color:'var(--red)',sub:'Worst single lot, net of charges'},
    {label:'Avg Hold',value:p.avgHoldDays+'d',color:'var(--t1)',sub:'How long a position actually lasts'},
  ];
  if(recSummary.evaluated){
    // v1086 fix: v1085 rendered `null + '%'` as the literal string "null%" whenever nothing had
    // resolved yet — which is the normal state on the day the definition changes, since every
    // pre-v1085 pick lacks the barriers needed to resolve. An unresolved metric must say so.
    const _conv=recSummary.conversionPct;
    const _hasConv=_conv!=null&&isFinite(_conv);
    kpis.push({label:'Rocket Conversion',
      value:_hasConv?_conv+'%':'—',
      color:!_hasConv?'var(--t3)':_conv>=20?'var(--green)':_conv>=10?'var(--amber)':'var(--red)',
      sub:_hasConv
        ?`${recSummary.rockets} of ${recSummary.resolvedRockets} picks hit target before stop`+(recSummary.stoppedOut?` · ${recSummary.stoppedOut} stopped first`:'')+(recSummary.pendingRockets-recSummary.unresolvableRockets>0?` · ${recSummary.pendingRockets-recSummary.unresolvableRockets} open`:'')
        :`Nothing resolved yet · ${recSummary.pendingRockets||0} open`});
  }
  const exitOpp=getSameDayExitOpportunitySummary();
  if(exitOpp.exits>=5){
    const activeTgt=(typeof getEffectiveTgtPct==='function')?getEffectiveTgtPct():null;
    const missColor=activeTgt!=null&&exitOpp.avgMissed>=activeTgt?'var(--red)':exitOpp.avgMissed>=1?'var(--amber)':'var(--green)';
    kpis.push({label:'Same-Day Exit Headroom',value:'+'+exitOpp.avgMissed.toFixed(2)+'%',color:missColor,sub:`Stock kept rising past your exit on ${exitOpp.upsideExits}/${exitOpp.exits} sell days · ${fmtINR(exitOpp.missedValue)} left same-day${_tgtRangeTxt()}`});
  }

  // Diagnostics. Labels here state honestly what each number IS and whether the exit
  // policy actually consumes it — several previously claimed authorship of a policy that
  // is in fact derived from a percentile of the same pool, not from these means.
  const detailKpis=[
    {label:'Avg P&L/Trading Day',value:fmtPerfRs(p.avgDailyPnl),color:clr(p.avgDailyPnl),sub:`On ${p.totalTradingDays} days traded, net of charges`},
    {label:'Avg P&L/Cal Day',value:avgCalDayPnl!=null?fmtPerfRs(avgCalDayPnl):'—',color:avgCalDayPnl!=null?clr(avgCalDayPnl):'var(--t3)',sub:calDayCount?`Over ${calDayCount} calendar days`:'Insufficient date range'},
    {label:'Profitable Days',value:p.pctProfitableDays+'%',color:p.pctProfitableDays>=60?'var(--green)':p.pctProfitableDays>=50?'var(--amber)':'var(--red)',sub:`${p.profitableDays} of ${p.totalTradingDays} days`},
    {label:'Best Day',value:p.maxProfitDay?fmtSignedINR(p.maxProfitDay.pnl):'—',color:p.maxProfitDay&&p.maxProfitDay.pnl>0?'var(--green)':'var(--t3)',sub:p.maxProfitDay?p.maxProfitDay.date+' · '+p.maxProfitDay.count+' lots':'No data'},
    {label:'Worst Day',value:p.maxLossDay?fmtSignedINR(p.maxLossDay.pnl):'—',color:p.maxLossDay&&p.maxLossDay.pnl<0?'var(--red)':'var(--t3)',sub:p.maxLossDay?p.maxLossDay.date+' · '+p.maxLossDay.count+' lots':'No data'},
    {label:'Largest Win',value:fmtSignedINR(p.largestWinRs),color:'var(--green)',sub:'Best single lot, net'},
    {label:'Max Win Streak',value:p.maxWinStreak+' days',color:p.maxWinStreak>=5?'var(--green)':p.maxWinStreak>=3?'var(--amber)':'var(--t1)',sub:'Consecutive profitable days'},
    {label:'Max Loss Streak',value:p.maxLossStreak+' days',color:p.maxLossStreak>=5?'var(--red)':p.maxLossStreak>=3?'var(--amber)':'var(--green)',sub:'Consecutive losing days'},
    {label:'Avg Position',value:fmtINR(p.avgCapital||0),color:'var(--t1)',sub:'Observed avg capital per position'},
    {label:'Avg Positions/Entry Day',value:allocationCadence!=null?allocationCadence.toFixed(2):'—',color:'var(--t1)',sub:'Distinct symbol + buy-date positions ÷ entry days · Max Allocation input'},
  ];
  // v1211 (owner): money-weighted, so hold time counts. Net P&L says how much was made; this says
  // how hard the money worked to make it.
  const xirr=computePortfolioXirr(adaptiveAllTrips);
  detailKpis.push({
    label:'XIRR',
    value:xirr.rate!=null?(xirr.rate*100).toFixed(1)+'%':'—',
    color:xirr.rate==null?'var(--t3)':xirr.rate>0?'var(--green)':'var(--red)',
    sub:xirr.rate!=null
      ? `Annualised money-weighted return · ${xirr.trips} closed round trips over ${xirr.spanDays} days`
        +(xirr.why?` · ${xirr.why}`:'')
      : (xirr.why||'Not computable')
  });
  if(recSummary.evaluated){
    const bestUpside=recSummary.avgBestHighPct;
    detailKpis.push(
    );
  }
  if(entrySummary.completed){
    detailKpis.push(
    );
  }

  const kpiCard=k=>`
    <div class="kpi-card">
      <div class="kpi-lbl">${k.label}</div>
      <div class="kpi-val" style="color:${k.color}">${k.value}</div>
      <div class="kpi-sub">${k.sub}</div>
    </div>`;
  const KPI_ORDER=[
    'Net P&L','Win Rate','Expectancy','Profit Factor','XIRR',
    'Avg P&L/Trading Day','Avg P&L/Cal Day','Profitable Days','Best Day','Worst Day',
    'Largest Win','Largest Loss','Max Drawdown','Max Win Streak','Max Loss Streak',
    'Avg Hold','High vs Exit','Rocket Conversion','Same-Day Exit Headroom',
    'Avg Position','Avg Positions/Entry Day','Max Allocation'
  ];
  const allKpis=[...kpis,...detailKpis];
  const byLabel=new Map(allKpis.map(k=>[k.label,k]));
  const orderedKpis=KPI_ORDER.map(l=>byLabel.get(l)).filter(Boolean)
    .concat(allKpis.filter(k=>!KPI_ORDER.includes(k.label)));
  const kpiHtml=`<div class="kpi-grid">`+orderedKpis.map(kpiCard).join('')+'</div>';

  const monthCols=[
    {key:'month',label:'Month',align:'left',fmt:v=>v,clrFn:()=>'var(--t1)'},
    {key:'pnl',label:'Net P&L',align:'right',bold:true,fmt:fmtPerfRs,clrFn:clr},
    {key:'trades',label:'Lots',align:'right',fmt:v=>v,clrFn:()=>'var(--t2)'},
    {key:'days',label:'Trading Days',align:'right',fmt:v=>v,clrFn:()=>'var(--t2)'},
    {key:'avgDay',label:'Avg/Trading Day',align:'right',fmt:fmtPerfRs,clrFn:clr},
    {key:'calDays',label:'Cal Days',align:'right',fmt:v=>v,clrFn:()=>'var(--t2)'},
    {key:'avgCalDay',label:'Avg/Cal Day',align:'right',fmt:fmtPerfRs,clrFn:clr},
  ];
  const monthMap={};
  const addToMonth=(sellDate,pnl,trades)=>{
    const ym=sellDate.substring(0,7);
    if(!monthMap[ym]) monthMap[ym]={month:ym,pnl:0,trades:0,days:0,_dates:new Set(),_minDate:sellDate,_maxDate:sellDate};
    monthMap[ym].pnl+=pnl; monthMap[ym].trades+=trades; monthMap[ym]._dates.add(sellDate);
    if(sellDate<monthMap[ym]._minDate) monthMap[ym]._minDate=sellDate;
    if(sellDate>monthMap[ym]._maxDate) monthMap[ym]._maxDate=sellDate;
  };
  adaptiveAllTrips.forEach(r=>addToMonth(r.sellDate,r.netPnl,1));
  // Same reason as the Net P&L KPI: today is booked but not yet in the tradebook.
  if(todayAdd) addToMonth(todayAdd.date,todayAdd.amount,todayAdd.lots);
  const _allMonths=Object.keys(monthMap).sort();
  const _firstMonth=_allMonths[0], _lastMonth=_allMonths.at(-1);
  const _todayYM=getSessionDate().substring(0,7);
  const monthRows=Object.values(monthMap).map(m=>{
    const [y,mo]=m.month.split('-').map(Number);
    const daysInMonth=new Date(y,mo,0).getDate();
    let calDays;
    if(m.month===_firstMonth){
      // Partial start: from first sell date to end of month
      calDays=Math.round((new Date(m.month+'-'+String(daysInMonth).padStart(2,'0'))-new Date(m._minDate))/86400000)+1;
    } else if(m.month===_lastMonth&&m.month===_todayYM){
      // Partial end (current month): from start of month to last sell date
      calDays=Math.round((new Date(m._maxDate)-new Date(m.month+'-01'))/86400000)+1;
    } else {
      // Full month
      calDays=daysInMonth;
    }
    return {month:m.month,pnl:+m.pnl.toFixed(0),trades:m.trades,days:m._dates.size,
      avgDay:m._dates.size?Math.round(m.pnl/m._dates.size):0,
      calDays,avgCalDay:calDays>0?Math.round(m.pnl/calDays):0};
  });
  const monthTbl=makeSortableTable('perf-month',monthCols,monthRows,'month',-1);

  const symRows=(p.symBreakdown||[]).map(r=>({...r,edge:+((r.winRate*r.avgPct)*Math.min(1,r.trades/5)).toFixed(2)}));
  const symCols=[
    {key:'sym',label:'Symbol',align:'left',fmt:v=>symbolChartButton(v),clrFn:()=>'var(--t1)',bold:true},
    {key:'netPnl',label:'Net P&L',align:'right',bold:true,fmt:fmtPerfRs,clrFn:clr},
    {key:'trades',label:'Lots',align:'right',fmt:v=>v,clrFn:()=>'var(--t2)'},
    {key:'winRate',label:'Win%',align:'right',fmt:v=>v+'%',clrFn:v=>v>=60?'var(--green)':v>=40?'var(--amber)':'var(--red)'},
    {key:'avgPct',label:'Avg%',align:'right',fmt:fmtPct,clrFn:clr},
    {key:'edge',label:'Edge',align:'right',bold:true,fmt:v=>v.toFixed(2),clrFn:v=>v>100?'var(--green)':v>0?'var(--amber)':'var(--red)'},
  ];
  const symTbl=makeSortableTable('perf-sym',symCols,symRows,'edge',-1,null,null,'sym');

  const timingModel=buildTradeTimingModel(adaptiveAllTrips);
  const timingRows=timingModel.groups.window.map(r=>({
    ...r,
    slice:r.label,
    peerPct:+(r.peerShrunk*100).toFixed(1),
    holdPct:+(r.holdShrunk*100).toFixed(1),
    robustPct:+Number(r.robustReturnPct||0).toFixed(2)
  }));
  const stateColor=s=>s==='Prefer'?'var(--green)':s==='Avoid'?'var(--red)':'var(--t3)';
  const timingCols=[
    {key:'slice',label:'Clock window',align:'left',fmt:v=>escHtml(v),clrFn:()=>'var(--t1)',bold:true},
    {key:'episodes',label:'Entries',align:'right',fmt:v=>v,clrFn:()=>'var(--t2)'},
    {key:'days',label:'Days',align:'right',fmt:v=>v,clrFn:()=>'var(--t2)'},
    {key:'peerPct',label:'Same-day peer rank',align:'right',fmt:v=>v.toFixed(1)+'%',clrFn:v=>v>50?'var(--green)':v<50?'var(--red)':'var(--t3)'},
    {key:'holdPct',label:'Hold-adjusted rank',align:'right',fmt:v=>v.toFixed(1)+'%',clrFn:v=>v>50?'var(--green)':v<50?'var(--red)':'var(--t3)'},
    {key:'robustPct',label:'Median day return',align:'right',fmt:v=>fmtPct(v),clrFn:clr},
    {key:'holdMix',label:'Hold mix',align:'left',fmt:v=>escHtml(v),clrFn:()=>'var(--t3)'},
    {key:'stability',label:'Stability',align:'left',fmt:v=>escHtml(v),clrFn:()=>'var(--t2)'},
    {key:'state',label:'Diagnostic state',align:'left',bold:true,fmt:v=>`<span style="color:${stateColor(v)}">${escHtml(v)}</span>`,clrFn:()=>''},
  ];
  const currentTiming=getCurrentTradeTimingDecision();
  const timingTbl=makeSortableTable('tbl-trade-timing',timingCols,timingRows,'slice',1,row=>{
    const isCurrent=row.dimension==='window'&&row.key===currentTiming.context.windowKey;
    return isCurrent?'background:rgba(99,102,241,.12);outline:1px solid rgba(99,102,241,.3);outline-offset:-1px':'';
  });
  const hasTradeWindows=timingRows.length>0;

  // v1211 (owner): the exit-side sibling of the table above - what selling at this hour gives up.
  const exitModel=buildExitTimingModel(adaptiveAllTrips);
  const exitCols=[
    {key:'slice',label:'Sell window',align:'left',fmt:v=>escHtml(v),clrFn:()=>'var(--t1)',bold:true},
    {key:'exits',label:'Exits',align:'right',fmt:v=>v,clrFn:()=>'var(--t2)'},
    {key:'medianNetPct',label:'Median net',align:'right',fmt:v=>v==null?'—':fmtPct(v),clrFn:v=>v==null?'var(--t3)':clr(v)},
    {key:'sameDayPct',label:'Rose after exit, same day',align:'right',bold:true,
      fmt:v=>v==null?'—':fmtPct(v),clrFn:v=>v==null?'var(--t3)':v>0?'var(--red)':'var(--green)'},
    {key:'sameDayN',label:'watched',align:'right',fmt:v=>v,clrFn:()=>'var(--t3)'},
    {key:'horizonPct',label:`Rose within ${exitModel.horizon}d`,align:'right',bold:true,
      fmt:v=>v==null?'—':fmtPct(v),clrFn:v=>v==null?'var(--t3)':v>0?'var(--red)':'var(--green)'},
    {key:'horizonRs',label:'₹ forgone',align:'right',
      fmt:v=>v==null?'—':fmtSignedINR(v),clrFn:v=>v==null?'var(--t3)':v>0?'var(--red)':'var(--green)'},
    {key:'wentHigherPct',label:'Went higher',align:'right',
      fmt:v=>v==null?'—':v+'%',clrFn:v=>v==null?'var(--t3)':v>=60?'var(--red)':v<=40?'var(--green)':'var(--amber)'},
  ];
  const exitTbl=makeSortableTable('tbl-exit-timing',exitCols,exitModel.rows,'slice',1);
  const hasExitWindows=exitModel.rows.length>0;

  // v1211 (owner): how long to hold, intraday and overnight.
  const holdModel=buildHoldDurationModel(adaptiveAllTrips);
  const holdCols=[
    {key:'cohort',label:'Cohort',align:'left',fmt:v=>escHtml(v),clrFn:v=>v==='Intraday'?'var(--cyan)':'var(--t2)'},
    {key:'slice',label:'Held for',align:'left',bold:true,fmt:v=>escHtml(v),clrFn:()=>'var(--t1)'},
    {key:'trips',label:'Lots',align:'right',fmt:v=>v,clrFn:()=>'var(--t2)'},
    {key:'winPct',label:'Win%',align:'right',fmt:v=>v+'%',clrFn:v=>v>=60?'var(--green)':v>=40?'var(--amber)':'var(--red)'},
    {key:'medianPct',label:'Median net',align:'right',fmt:v=>fmtPct(v),clrFn:clr},
    {key:'medianPerDay',label:'Net per session held',align:'right',bold:true,fmt:v=>fmtPct(v),clrFn:clr},
    {key:'totalRs',label:'Total net',align:'right',fmt:fmtSignedINR,clrFn:clr},
  ];
  const holdTbl=makeSortableTable('tbl-hold-duration',holdCols,holdModel.rows,'cohort',1);
  const hasHold=holdModel.rows.length>0;
  const arrival=(typeof getRocketArrivalStats==='function')?getRocketArrivalStats():null;
  const holdVerdict=(()=>{
    const bi=holdModel.best?.intraday, bo=holdModel.best?.overnight;
    if(!bi&&!bo) return 'Not enough closed lots in any bucket yet.';
    const parts=[];
    if(bi) parts.push(`intraday, the best return per session is <b>${escHtml(bi.slice)}</b> at ${fmtPct(bi.medianPerDay)}/session on ${bi.trips} lots`);
    if(bo) parts.push(`held overnight, <b>${escHtml(bo.slice)}</b> at ${fmtPct(bo.medianPerDay)}/session on ${bo.trips} lots`);
    const arr=(arrival&&arrival.p75!=null)?` Forward, unconfounded by choice: 75% of picks that reach their target do so within <b>${arrival.p75}</b> session${arrival.p75===1?'':'s'} of issue.`:'';
    return `On capital-efficiency: ${parts.join('; ')}.${arr}`;
  })();

  const periodPills=['all','1m','3m','6m','1y'].map(p=>{
    const active=PERF_PERIOD_FILTER===p;
    const label=p==='all'?'All':p==='1m'?'1M':p==='3m'?'3M':p==='6m'?'6M':'1Y';
    return `<button onclick="PERF_PERIOD_FILTER='${p}';renderPerformance()" style="padding:5px 14px;border-radius:20px;border:1px solid ${active?'var(--amber)':'var(--border)'};background:${active?'rgba(251,191,36,.15)':'transparent'};color:${active?'var(--amber)':'var(--t3)'};font-size:14px;font-weight:${active?700:500};cursor:pointer">${label}</button>`;
  }).join('');
  const periodPillsHtml=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
    <span style="font-size:13px;color:var(--t3);font-weight:600;text-transform:uppercase;letter-spacing:.06em">Period</span>
    ${periodPills}
  </div>`;

  const perfCard=(title,content,maxH,id)=>`
    <div ${id?`id="${id}" `:''}style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;margin-top:12px;overflow:hidden">
      <div style="padding:10px 16px;font-size:12px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid var(--border)">${title}</div>
      <div style="overflow:auto${maxH?';max-height:'+maxH:''}">${content}</div>
    </div>`;

  const _navLink=(id,label,show)=>show?`<a href="#${id}" onclick="event.preventDefault();scrollToSection('${id}')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:13px;font-weight:600;text-decoration:none;cursor:pointer;white-space:nowrap">${label}</a>`:'';
  const perfNav=`<nav style="position:sticky;top:var(--hdr-h,72px);z-index:50;background:var(--bg);padding:8px 0 10px;margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--border);box-shadow:0 2px 8px rgba(0,0,0,0.3);overflow-x:auto;-webkit-overflow-scrolling:touch">
    ${_navLink('perf-kpi','📊 KPIs',true)}
    ${_navLink('perf-scorecard','🎯 System Scorecard',true)}
    ${_navLink('perf-monthly','📅 Monthly',monthRows.length>0)}
    ${_navLink('perf-trade-windows','🕐 Time-of-day Outcomes',hasTradeWindows)}
    ${_navLink('perf-hold-duration','⏳ How Long to Hold',hasHold)}
    ${_navLink('perf-exit-windows','🚪 Exit-time Give-back',hasExitWindows)}
    ${_navLink('perf-stocks','📈 Stocks',p.symBreakdown.length>0)}
  </nav>`;
  const entryOutcomeText=entrySummary.completed
    ? `${entrySummary.completed} actual recommended buys assessed over their adaptive outcome windows (${entrySummary.topups} top-ups). Their average best net opportunity is ${entrySummary.avgBestNet>=0?'+':''}${entrySummary.avgBestNet.toFixed(2)}%; their best observed peak velocity averages ${entrySummary.avgVelocity>=0?'+':''}${entrySummary.avgVelocity.toFixed(3)}%/day. These outcomes provide confidence context only and refine the single target policy with sample-size confidence.`
    : entrySummary.tracked
      ? `${entrySummary.tracked} actual recommended buys are being tracked across the current ${entrySummary.horizonDays}-trading-day adaptive window. Fresh buys and top-ups are assessed separately; completed outcomes update confidence context and targets.`
      : `Executed-entry learning is ready. Future completed BUY executions that came from displayed recommendations will be assessed over the adaptive outcome window and fed into confidence context and targets.`;
  const outcomeText=recSummary.evaluated
    ? `${recSummary.evaluated} completed engine-shortlist picks assessed across ${recSummary.issueDays} scan days using the adaptive ${recSummary.horizonDays}-day window. ${recSummary.rockets} became rockets (${recSummary.conversionPct}%); observed conversions took ${recSummary.avgRocketDays!=null?recSummary.avgRocketDays+' trading days on average':'an unavailable average time'}. Faster conversions receive more reward, while failures and adverse moves penalise their feature patterns. Average outcome score is ${recSummary.avgOutcomeScore!=null?(recSummary.avgOutcomeScore>=0?'+':'')+recSummary.avgOutcomeScore.toFixed(3):'not available'}; average attainable high move is ${recSummary.avgBestHighPct!=null?(recSummary.avgBestHighPct>=0?'+':'')+recSummary.avgBestHighPct.toFixed(2)+'%':'not available'}.`
    : `Outcome learning has started. The assessment window is currently ${recSummary.horizonDays} trading days, derived from observed holding duration and rocket-arrival timing.`;
  const exitOpportunity=getSameDayExitOpportunitySummary();
  const escapeText=exitOpportunity.exits
    ? `${exitOpportunity.exits} symbol/date exits have same-day ALL NSE highs recorded. ${exitOpportunity.upsideExits} highs exceeded the quantity-weighted average sell price; sold-value-weighted missed upside averages ${exitOpportunity.avgMissed.toFixed(2)}% (${fmtINR(exitOpportunity.missedValue)}).`
    : `No same-day exit opportunities have been recorded yet. Load Orders, Tradebook, and ALL NSE for the sell day.`;
  // v1106 (owner): the Recommendation Outcome Feedback panel is gone from Performance. The
  // RECORDING is untouched - rs_recommend_outcomes_delta_v1 still carries every pick's v1085
  // rocket label and is what Leg 2 of the post-close routine grades. Only the readout is removed.
  const outcomeHtml='';

  // ── v1126 SYSTEM SCORECARD (owner) ────────────────────────────────────────────────────────────
  const sc=buildSystemScorecard();
  const scCols=[
    {key:'date',label:'Issue date',s:true},
    {key:'regime',label:'Market',s:true},
    {key:'picks',label:'Picks',s:true,fmt:v=>String(v)},
    {key:'target',label:'Hit target',s:true,fmt:v=>String(v),clrFn:v=>v>0?'var(--green)':'var(--t3)'},
    {key:'stopped',label:'Stopped first',s:true,fmt:v=>String(v),clrFn:v=>v>0?'var(--red)':'var(--t3)'},
    {key:'expired',label:'Never moved',s:true,fmt:v=>String(v),clrFn:v=>v>0?'var(--amber)':'var(--t3)'},
    {key:'pending',label:'Still open',s:true,fmt:v=>v?String(v):'—'},
    {key:'hitPct',label:'Hit %',s:true,fmt:v=>v==null?'—':v+'%',clrFn:v=>v==null?'var(--t3)':v>=40?'var(--green)':v>=20?'var(--amber)':'var(--red)'},
    {key:'medDays',label:'Days to target',s:true,fmt:v=>v==null?'—':(v===0?'same day':v+'d')}
  ];
  const scTbl=makeSortableTable('perf-scorecard-tbl',scCols,sc.rows,'date',-1);
  const scHeadline=sc.settled
    ? `<div style="display:flex;gap:22px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--border)">
        <div><div class="st-l">Resolved</div><div class="st-v" style="font-size:19px">${sc.settled}</div><div class="st-d">of ${sc.resolvable} with barriers${sc.pending?` · ${sc.pending} still open`:''}</div></div>
        <div><div class="st-l">Reached target</div><div class="st-v" style="font-size:19px;color:${sc.hitPct>=40?'var(--green)':sc.hitPct>=20?'var(--amber)':'var(--red)'}">${sc.hitPct}%</div><div class="st-d">${sc.target} picks</div></div>
        <div><div class="st-l">Stopped first</div><div class="st-v" style="font-size:19px;color:${sc.stopped?'var(--red)':'var(--green)'}">${sc.stopPct}%</div><div class="st-d">${sc.stopped} picks — dipped to stop before target</div></div>
        <div><div class="st-l">Never moved</div><div class="st-v" style="font-size:19px;color:var(--amber)">${sc.expiredPct}%</div><div class="st-d">${sc.expired} picks — neither barrier in ${ROCKET_HORIZON_DAYS} days</div></div>
        <div title="The only fair test of an ORDERING: on the SAME session, was the winner ranked above the loser? 50% means the ranking carries no information at all; below 50% means it is mildly inverted. Comparing ranks ACROSS days is confounded — rank is a within-day relative measure, so a rank 1 on a weak day and a rank 1 on a strong day are not the same claim."><div class="st-l">Ranking concordance</div><div class="st-v" style="font-size:19px;color:${sc.concordancePct==null?'var(--t3)':sc.concordancePct>=60?'var(--green)':sc.concordancePct>=52?'var(--amber)':'var(--red)'}">${sc.concordancePct==null?'—':sc.concordancePct+'%'}</div><div class="st-d">${sc.concordancePairs} same-day winner/loser pairs · 50% = no information</div></div>
        <div><div class="st-l">Time to target</div><div class="st-v" style="font-size:19px">${sc.medDaysToTarget==null?'—':(sc.medDaysToTarget===0?'same day':sc.medDaysToTarget+'d')}</div><div class="st-d">${sc.sameDay} same day · ${sc.nextDay} next day</div></div>
      </div>`
    : `<div style="padding:16px;color:var(--t2);font-size:13px">No cohort has resolved yet. A pick resolves once a post-close ALL NSE.csv closes its issue day and the following session's bar is read.</div>`;
  const bandRows=sc.bands.filter(b=>b.n>0).map(b=>
    `<tr><td style="padding:4px 10px">${b.label}</td>`
    +`<td style="padding:4px 10px;text-align:right">${b.n}</td>`
    +`<td style="padding:4px 10px;text-align:right;color:var(--t3)">${b.control}</td>`
    +`<td style="padding:4px 10px;text-align:right">${b.settled}</td>`
    +`<td style="padding:4px 10px;text-align:right;font-weight:700;color:${b.hitPct==null?'var(--t3)':b.hitPct>=30?'var(--green)':b.hitPct>=18?'var(--amber)':'var(--red)'}">${b.hitPct==null?'—':b.hitPct+'%'}</td></tr>`).join('');
  const bandTable=bandRows?`<div style="padding:10px 16px;border-top:1px solid var(--border)">
      <div class="st-l" style="margin-bottom:6px">Hit rate by score band — is the ordering monotonic?</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse">
        <tr style="color:var(--t3);font-size:11px;text-transform:uppercase;letter-spacing:.06em">
          <td style="padding:4px 10px">Score</td><td style="padding:4px 10px;text-align:right">Graded</td>
          <td style="padding:4px 10px;text-align:right">of which control</td>
          <td style="padding:4px 10px;text-align:right">Resolved</td><td style="padding:4px 10px;text-align:right">Hit %</td></tr>
        ${bandRows}
      </table>
      <div style="font-size:12px;color:var(--t3);margin-top:6px;line-height:1.5">A ranking that orders correctly is MONOTONIC down this table. Bands below the ${RECOMMEND_MIN_SCORE} bar are observed through a small stratified <b>control sample</b> (${CONTROL_PER_BAND} per band per session) that is graded but never bought — so a band the app no longer buys can still be shown to have recovered.</div>
    </div>`:'';
  const scNote=`<div style="padding:10px 16px;font-size:12px;color:var(--t3);line-height:1.55">
    A pick counts as a WIN only if it reached <b>its own target</b> before <b>its own stop</b>, within ${ROCKET_HORIZON_DAYS} trading days of being recommended (v1085). Cohorts are the picks as ISSUED — a later scan on the same day never rewrites them.
    ${sc.legacy?`<br>${sc.legacy} older picks carry no recorded target/stop (they predate v1094) and can never resolve, so they are excluded from every percentage above rather than counted as failures.`:''}
  </div>`;

  el.innerHTML=`
    <div style="padding:12px 16px">
      ${perfNav}
      ${periodPillsHtml}
      <div style="font-size:12px;color:var(--t3);margin-bottom:12px">${periodLabel} · ${p.roundTrips} lots</div>
      <div id="perf-kpi">${kpiHtml}</div>
      ${perfCard('System Scorecard — did the picks reach target? <span style="font-size:12px;color:var(--t3);font-weight:400">'+sc.cohorts+' cohorts · target-before-stop within '+ROCKET_HORIZON_DAYS+' trading days</span>',scHeadline+scTbl.getHtml()+bandTable+scNote,'','perf-scorecard')}
      ${monthRows.length?perfCard('Monthly Breakdown',monthTbl.getHtml(),'','perf-monthly'):''}
      ${hasHold?perfCard(`How Long to Hold — Diagnostic Only <span style="font-size:12px;color:var(--t3);font-weight:400">${holdModel.trips} closed lots · hold length is CHOSEN, not assigned, so a slow bucket is partly "trades that needed longer" — descriptive, never a recommendation rule</span>`,
        `<div style="padding:10px 16px;font-size:13px;color:var(--t2);border-bottom:1px solid var(--border);line-height:1.5">${holdVerdict}</div>`+holdTbl.getHtml(),'','perf-hold-duration'):''}
      ${hasExitWindows?perfCard(`Exit-time Give-back — Diagnostic Only <span style="font-size:12px;color:var(--t3);font-weight:400">${exitModel.exits} exits · same-day figure needs the watch recorder (${exitModel.sameDayCoverage} covered), forward figure needs stored price history (${exitModel.horizonCoverage} covered) · forward window fixed at ${exitModel.horizon} session${exitModel.horizon===1?'':'s'} (the learned review horizon) so every window is comparable · a positive figure is money the stock went on to make without you · descriptive, never a recommendation rule</span>`,exitTbl.getHtml(),'','perf-exit-windows'):''}
      ${hasTradeWindows?perfCard(`Time-of-day Outcomes — Diagnostic Only <span style="font-size:12px;color:var(--t3);font-weight:400">${timingModel.episodeCount} distinct entries · ${timingModel.entryDays} entry days · clock windows only · descriptive, never a recommendation rule</span>`,timingTbl.getHtml(),'','perf-trade-windows'):''}
      ${p.symBreakdown.length?perfCard('Stocks',symTbl.getHtml(),'360px','perf-stocks'):''}
    </div>`;

  setTimeout(()=>{monthTbl.render();symTbl.render();timingTbl.render();exitTbl.render();holdTbl.render();scTbl.render();},0);
}

function schedulePerformanceRender(){
  if(document.visibilityState==='hidden'){
    PERF_RENDER_WAITING_FOR_VISIBLE=true;
    return;
  }
  if(PERF_RENDER_QUEUED) return;
  PERF_RENDER_QUEUED=true;
  const el=document.getElementById('perfContent');
  if(el&&!PERF_RENDERED) el.innerHTML=`<div style="text-align:center;padding:60px 40px;color:var(--t2)"><div style="font-size:38px;margin-bottom:14px">📈</div><div style="font-size:17px;font-weight:700;color:var(--t1);margin-bottom:8px">Calculating performance</div><div>Rankings are ready while trade analytics finish in the background.</div></div>`;
  idleTask(()=>{
    PERF_RENDER_QUEUED=false;
    if(document.visibilityState==='hidden'){
      PERF_RENDER_WAITING_FOR_VISIBLE=true;
      return;
    }
    renderPerformance();
    try{if(ALL.length) renderStats();}catch(e){console.warn('Stats refresh after performance failed',e);}
  },900);
}

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='visible'||!PERF_RENDER_WAITING_FOR_VISIBLE)return;
  PERF_RENDER_WAITING_FOR_VISIBLE=false;
  requestAnimationFrame(()=>requestAnimationFrame(schedulePerformanceRender));
});

function _refreshHFSection(){
  const wrap=document.getElementById('meth-hf-wrap');
  if(wrap){wrap.innerHTML=buildHardFilterMethodologyHTML(ENGINE_DATA);setTimeout(()=>{_methTbls.hf?.render();_methTbls.sc?.render();},0);}
  else renderMethodology();
}
function rebuildActiveSurveillanceHits(){
  NSE_SURV={};SURV_RULE_HITS={};
  const fileRuleByKey=Object.fromEntries((SURV_FILE_RULES||[]).map(r=>[r.key,r]));
  const colKeyToRuleKey={};
  SURV_CUSTOM_RULES.forEach(rule=>{
    const matched=fileRuleByKey[rule.key]||null;
    if(matched){rule.column=matched.column;rule.label=matched.label;}
    SURV_RULE_HITS[rule.key]=0;
    colKeyToRuleKey[rule.key]=rule.key;
  });
  Object.entries(SURV_ALL_HITS||{}).forEach(([sym,hits])=>{
    const active=[];
    Object.keys(hits||{}).forEach(col=>{
      const ruleKey=colKeyToRuleKey[survRuleKey(col)];
      if(ruleKey&&!active.includes(ruleKey)) active.push(ruleKey);
    });
    if(active.length){
      NSE_SURV[sym]=active;
      active.forEach(k=>{SURV_RULE_HITS[k]=(SURV_RULE_HITS[k]||0)+1;});
    }
  });
}
function scannerSessionTag(fileName, raw, sourceText=''){
  const source=sourceText||JSON.stringify(raw);
  const dataHash=(function(){let h=2166136261;for(let i=0;i<source.length;i++){h^=source.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;})();
  return fileName+'·'+raw.length+'·'+dataHash;
}
function inputFileSessionDate(file){
  const ts=Number(file?.lastModified);
  // v557: return null (UNKNOWN) when there is no usable timestamp. Previously this returned
  // getSessionDate(), i.e. "assume current" — a fail-OPEN default that let an undateable file
  // (e.g. hydrated from Drive without mtime) be treated as this session's data.
  if(!(ts>0)) return null;
  const ist=new Date(ts+5.5*3600000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth()+1).padStart(2,'0')}-${String(ist.getUTCDate()).padStart(2,'0')}`;
}
function isCurrentSessionFile(file){
  const d=inputFileSessionDate(file);
  return d?d===getSessionDate():false; // unknown timestamp ⇒ treat as NOT current (fail-safe)
}
function getPortfolioSessionDate(orders){
  const list=orders||ORDERS_TODAY;
  if(!list?.length) return null;
  let max=null;
  for(const o of list){
    const d=normOrderDate(o?.time);
    if(/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&(!max||d>max)) max=d;
  }
  return max;
}
// Single source of truth for "are the portfolio CSVs from THIS session?". Also records the answer in
// PORTFOLIO_STALE so the status bar can say so out loud instead of silently dropping the data.
function resolvePortfolioStaleness(){
  const today=getSessionDate();
  const portfolioDate=getPortfolioSessionDate();
  const ordersStale=!!portfolioDate&&portfolioDate!==today;
  PORTFOLIO_STALE={portfolioDate,stale:ordersStale,sessionDate:today};
  return {today,portfolioDate,ordersStale};
}
// Positions carry no date of their own, so they inherit the orders' session: the two files are one
// snapshot taken at the same moment. The DATA wins over the file mtime, which can read "today" for
// yesterday's content (re-save, folder copy, Drive re-upload).
function isPositionsFileCurrent(file){
  const portfolioDate=getPortfolioSessionDate();
  if(portfolioDate) return portfolioDate===getSessionDate();
  return isCurrentSessionFile(file); // no dateable order rows → fall back to the file timestamp
}
async function refreshRankingsAfterSurvRuleChange(){
  if(!Object.keys(SURV_ALL_HITS||{}).length&&FS.hasFolder()){
    try{await hydrateSessionCSVsFromWorkspace();rebuildActiveSurveillanceHits();}catch(e){console.warn('Could not hydrate surveillance data for live refresh',e);}
  }
  let raw=Array.isArray(window._lastRawTV)?window._lastRawTV:null;
  let fileName='ALL NSE.csv';
  const looksStockRaw=rows=>rows?.length&&Object.prototype.hasOwnProperty.call(rows[0],'Symbol');
  if(!looksStockRaw(raw)&&FS.hasFolder()&&FS.readUploadText){
    try{
      const f=await FS.readUploadText('ALL NSE.csv');
      if(f?.text){raw=parseCSV(f.text);fileName=f.path||fileName;window._lastRawTV=raw;}
    }catch(e){console.warn('Could not reload ALL NSE.csv for surveillance refresh',e);}
  }
  if(!looksStockRaw(raw)){
    applyFilters();
    showToast('Rule saved. Re-upload ALL NSE.csv to fully refresh Rankings.',3500,true);
    return;
  }
  try{
    const tag=window._lastScannerSessionTag||scannerSessionTag(fileName,raw);
    ALL=radarScoreRows(raw);
    const ft=document.getElementById('fileTag');if(ft)ft.textContent=fileName+' · '+raw.length+' stocks';
    window._lastScannerSessionTag=tag;
    FILT=[...ALL];
    applyFilters();
    renderMethodology();
    try{await FS.write(FS.getBrain());}catch(e){console.warn('Brain flush failed after surveillance refresh',e);}
  }catch(e){
    console.error('Surveillance ranking refresh failed',e);
    showToast('Rule saved, but Rankings refresh failed. Re-upload ALL NSE.csv.',4000,true);
  }
}
async function addSurvRule(colArg){
  let column=colArg?String(colArg).trim():'';
  if(!column){
    const input=document.getElementById('survRuleInput');
    column=String(input?.value||'').trim();
    if(!column){showToast('Enter the exact REG1 column name to add.',3000,true);return;}
    if(input) input.value='';
  }
  const key=survRuleKey(column);
  if(getSurvRules().some(rule=>rule.key===key)){showToast('That hard filter is already configured.',3000,true);return;}
  SURV_CUSTOM_RULES.push({key,column,label:column});
  saveSurvRules();
  rebuildActiveSurveillanceHits();
  _refreshHFSection();
  await refreshRankingsAfterSurvRuleChange();
  showToast(`<strong>Added surveillance rule</strong> &mdash; ${escHtml(column)}. Flags on that REG1 column now appear in monitoring and the score penalty context.`,3500);
}
async function removeSurvRule(key){
  SURV_CUSTOM_RULES=SURV_CUSTOM_RULES.filter(rule=>rule.key!==key&&survRuleKey(rule.column||rule.label)!==key);
  saveSurvRules();
  rebuildActiveSurveillanceHits();
  _refreshHFSection();
  await refreshRankingsAfterSurvRuleChange();
  showToast('Surveillance rule removed.',2500);
}
function buildHardFilterMethodologyHTML(E){
  // Configured rules are a HARD filter (owner 2026-07-17): any stock flagged under a
  // rule in this table is weeded out of Rankings, selection, and outcome candidates.
  // Non-configured REG1 flags remain a Radar score penalty + badge only.
  const addedRuleKeys=new Set(getSurvRules().map(r=>r.key));
  const availableCols=(SURV_FILE_RULES.length>0?SURV_FILE_RULES:SURV_HEADERS.filter(h=>{
    const hl=h.trim().toLowerCase();
    return !['scripcode','symbol','nse exclusive','status','series'].includes(hl)&&!/^filler/i.test(h.trim());
  })).map(r=>r.column||r).filter(h=>!addedRuleKeys.has(survRuleKey(h)));
  const datalistHtml=availableCols.map(col=>`<option value="${escHtml(col)}"></option>`).join('');

  // Live holdings P&L is deliberately shared with the correlation table below.
  // Rule rows can overlap, so P&L is meaningful per rule but must never be totalled across rules.
  const heldPnlByRule=Object.fromEntries(getCurrentSurvHoldingRows().map(row=>[row.key,row]));
  const fileRuleKeys=new Set((SURV_FILE_RULES||[]).map(r=>r.key));
  const hfRows=getSurvRules().map(rule=>{
    const held=heldPnlByRule[rule.key]||null;
    const active=!SURV_HEADERS.length||fileRuleKeys.has(rule.key);
    return {
      criteria:rule.column||rule.label,
      flagged:SURV_RULE_HITS[rule.key]||0,
      heldPnlRs:held?.pnlRs??null,
      heldPnlPct:held?.pnlPct??null,
      heldCount:held?.lastCount??0,
      active, ruleKey:rule.key,
      inactiveNote:active?'':'Inactive — REG1 column not found in last upload',
    };
  });
  const hfCols=[
    {key:'criteria',label:'REG1 Column',align:'left',
      fmt:(v,r)=>`<span style="font-size:13px;color:${r.active?'var(--t1)':'var(--t3)'}">${escHtml(v)}${r.inactiveNote?`<div style="font-size:12px;color:var(--red);margin-top:2px">${r.inactiveNote}</div>`:''}</span>`,
      totFmt:()=>`<span style="font-size:13px;color:var(--t2);font-weight:700">Total</span>`},
    {key:'flagged',label:'Flagged',align:'right',
      fmt:(v,r)=>r.active?`<span style="color:${v>0?'var(--amber)':'var(--t3)'};font-weight:700;font-family:'DM Mono',monospace">${(v||0).toLocaleString()}</span>`:'&mdash;',
      totFmt:(v)=>`<span style="color:var(--amber);font-weight:700;font-family:'DM Mono',monospace">${(v||0).toLocaleString()}</span>`},
    {key:'heldPnlRs',label:'Held P&L ₹',align:'right',
      fmt:(v,r)=>v==null?'&mdash;':`<span style="color:${v<0?'var(--red)':v>0?'var(--green)':'var(--t3)'};font-weight:700;font-family:'DM Mono',monospace" title="Current unrealised P&L across ${r.heldCount||0} held stock${(r.heldCount||0)===1?'':'s'} currently flagged by this REG1 column">${fmtSignedINR(v)}</span>`,
      totFmt:()=>`<span title="Rule-level P&L overlaps when a holding has multiple REG1 flags, so there is no P&L total.">&mdash;</span>`},
    {key:'heldPnlPct',label:'Held P&L %',align:'right',
      fmt:(v,r)=>v==null?'&mdash;':`<span style="color:${v<0?'var(--red)':v>0?'var(--green)':'var(--t3)'};font-weight:700;font-family:'DM Mono',monospace" title="Current unrealised P&L as a capital-weighted percentage across ${r.heldCount||0} held stock${(r.heldCount||0)===1?'':'s'} currently flagged by this REG1 column">${v>=0?'+':''}${v.toFixed(2)}%</span>`,
      totFmt:()=>`<span title="Rule-level P&L overlaps when a holding has multiple REG1 flags, so there is no P&L total.">&mdash;</span>`},
    {key:'ruleKey',label:'',align:'right',
      fmt:(v,r)=>`<button onclick="removeSurvRule('${v}')" style="padding:4px 8px;border-radius:6px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.08);color:var(--red);font-size:12px;font-weight:700;cursor:pointer">Remove</button>`,
      totFmt:()=>''},
  ];
  const hfTotalsFlagged=hfRows.reduce((s,r)=>s+(r.active?(r.flagged||0):0),0);
  _methTbls.hf=makeSortableTable('tbl-hf',hfCols,hfRows,'flagged',-1,null,{
    criteria:null,flagged:hfTotalsFlagged,ruleKey:null,
  });

  const survActiveThisSession=SURV_HEADERS.length>0;
  const survMeta=survActiveThisSession
    ? `<div style="font-size:13px;color:var(--t3);margin-top:8px">REG1 file active this session. Configured rules above are a hard filter — flagged stocks are removed from Rankings entirely. Every other flagged REG1 column still subtracts up to 12 points from the Radar composite score and appears on the stock's ⚠ badge.</div>`
    : `<div style="margin-top:8px;padding:8px 10px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;font-size:13px;color:var(--red)">NSE REG1 data not active — surveillance rules cannot filter until a REG1 file is loaded.</div>`;

  return `
    <h3 id="meth-filters" style="margin-top:28px">Surveillance Hard Filters (NSE REG1)</h3>
    <p style="color:var(--t3);font-size:13px;margin-bottom:10px">Each row is an exact REG1 column. Any stock flagged under a configured column is weeded out of Rankings, basket selection, and outcome tracking. Exchange series, status and price band separately govern basket eligibility.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <input id="survRuleInput" type="text" placeholder="${SURV_HEADERS.length?'Type to search REG1 columns…':'Load NSE ZIP to enable suggestions'}" list="survRuleDatalist" onkeydown="if(event.key==='Enter'){event.preventDefault();addSurvRule();}" style="flex:1;min-width:260px;padding:9px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;color:var(--t1);font-size:14px;outline:none">
      <datalist id="survRuleDatalist">${datalistHtml}</datalist>
      <button class="btn" onclick="addSurvRule()" style="font-weight:700">+ Add Rule</button>
    </div>
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div class="scroll-x">${_methTbls.hf.getHtml()}</div>
    </div>
    <div style="font-size:12px;color:var(--t3);margin-top:7px">Held P&L is live, unrealised P&L for your currently held stocks flagged by that exact REG1 column. A stock with multiple flags appears in each relevant row, so rule-level P&L is not totalled.</div>
    ${survMeta}
    ${buildSurvCorrHTML()}
  `;
}

function getCurrentSurvHoldingRows(){
  if(!Object.keys(SURV_ALL_HITS||{}).length) return [];
  const heldPos=getHeldPositionMap();
  const rowsByCol={};
  const nonFlag=new Set(['scripcode','symbol','nse exclusive','status','series']);
  Object.entries(heldPos).forEach(([sym,pos])=>{
    if(!sym||!(pos?.qty>0)) return;
    const hitCols=SURV_ALL_HITS[sym];
    if(!hitCols) return;
    const qty=Number(pos.qty)||0;
    const ltp=ALL.find(s=>s.symbol===sym)?.price
      ||POSITIONS?.find(p=>p.symbol===sym)?.ltp
      ||HOLDINGS?.find(h=>h.symbol===sym)?.ltp
      ||null;
    const avg=pos.avg||HOLD_COST_MAP[sym]||HOLDINGS?.find(h=>h.symbol===sym)?.avgCost||null;
    if(!(qty>0)||!(ltp>0)||!(avg>0)) return;
    const capital=avg*qty;
    const pnlRs=(ltp-avg)*qty;
    const pnlPct=+((pnlRs/capital)*100).toFixed(2);
    Object.keys(hitCols).forEach(col=>{
      const label=String(col||'').trim();
      const lower=label.toLowerCase();
      if(!label||nonFlag.has(lower)||/^filler/i.test(label)) return;
      const key=survRuleKey(label);
      if(!key) return;
      if(!rowsByCol[key]) rowsByCol[key]={key,col:label,stocks:[]};
      rowsByCol[key].stocks.push({sym,qty,capital,pnlRs,pnlPct});
    });
  });
  return Object.values(rowsByCol).map(row=>{
    row.stocks.sort((a,b)=>a.pnlPct-b.pnlPct);
    const capital=row.stocks.reduce((sum,s)=>sum+s.capital,0);
    const pnlRs=row.stocks.reduce((sum,s)=>sum+s.pnlRs,0);
    const pnlPct=capital>0?+((pnlRs/capital)*100).toFixed(2):null;
    // Retain avgPnl for the existing internal accumulator, while the live table
    // deliberately shows the more useful capital-weighted percentage below.
    const avgPnl=row.stocks.reduce((sum,s)=>sum+s.pnlPct,0)/row.stocks.length;
    const wins=row.stocks.filter(s=>s.pnlPct>0).length;
    return {...row,sessions:10,lastCount:row.stocks.length,capital,pnlRs,pnlPct,avgPnl,winRate:wins/row.stocks.length*100};
  });
}

function updateSurvCorrelation(){
  const currentRows=getCurrentSurvHoldingRows();
  if(!currentRows.length) return;
  const _tag=currentRows.map(r=>r.key+':'+r.stocks.map(s=>s.sym+'@'+s.pnlPct).join(',')).sort().join('|');
  if(_tag===SURV_CORR_LAST_TAG) return;
  SURV_CORR_LAST_TAG=_tag;
  // Build held symbol → current P&L% map
  let updated=false;
  currentRows.forEach(row=>{
    if(!SURV_CORR_ACC[row.key]) SURV_CORR_ACC[row.key]={col:row.col,key:row.key,sessions:0,winRate:0,avgPnl:0,pnlPct:0,pnlRs:0,lastCount:0};
    const acc=SURV_CORR_ACC[row.key];
    const n=acc.sessions+1;
    acc.winRate=(acc.winRate*(n-1)+row.winRate)/n;
    acc.avgPnl=(acc.avgPnl*(n-1)+row.avgPnl)/n;
    acc.pnlPct=(Number(acc.pnlPct||0)*(n-1)+Number(row.pnlPct||0))/n;
    acc.pnlRs=(Number(acc.pnlRs||0)*(n-1)+Number(row.pnlRs||0))/n;
    acc.sessions=n; acc.col=row.col; acc.lastCount=row.lastCount;
    updated=true;
  });
  if(updated) FS.set(SURV_CORR_STORE,SURV_CORR_ACC);
}

function buildSurvCorrHTML(){
  const activeColKeys=new Set(getSurvRules().map(r=>r.key));
  const liveRows=getCurrentSurvHoldingRows().filter(r=>!activeColKeys.has(r.key));
  const allAcc=liveRows;
  // Show placeholder only when nothing accumulated yet
  if(!allAcc.length){
    const hasHoldings=Object.values(getHeldPositionMap()).some(p=>p?.qty>0);
    const hasSurv=Object.keys(SURV_ALL_HITS).length>0;
    let msg;
    if(!hasHoldings&&!hasSurv) msg='Load <strong>Holdings.csv</strong> + <strong>NSE ZIP</strong> to start accumulating surveillance P&amp;L correlation.';
    else if(!hasHoldings) msg='Load <strong>Holdings.csv</strong> to start accumulating surveillance P&amp;L correlation.';
    else if(!hasSurv) msg='Load <strong>NSE ZIP</strong> this session to start accumulating — REG1 surveillance file needed.';
    else msg='None of your held stocks are currently flagged in surveillance — accumulator activates when a held position appears on the REG1 list.';
    return `<div style="padding:12px 14px;background:rgba(148,163,184,.06);border:1px solid var(--border);border-radius:8px;font-size:14px;color:var(--t3);margin-top:12px">${msg}</div>`;
  }
  const staleNote='';
  // Build held-position pills per surveillance column (col name → pills HTML)
  const heldPillMap={};
  const heldSyms=new Set();
    if(HOLDINGS?.length) HOLDINGS.forEach(h=>{if(h?.symbol&&h.qty>0) heldSyms.add(h.symbol);});
    if(ORDERS_TODAY?.length){
      const todayDate=getSessionDate();
      const ordBuys={},ordSells={};
      ORDERS_TODAY.forEach(o=>{
        if(normOrderDate(o.time)!==todayDate||!o.symbol) return;
        const t=(o.type||'').toUpperCase();
        if(t==='BUY') ordBuys[o.symbol]=(ordBuys[o.symbol]||0)+o.qty;
        else if(t==='SELL') ordSells[o.symbol]=(ordSells[o.symbol]||0)+o.qty;
      });
      Object.entries(ordBuys).forEach(([sym,bQty])=>{if(bQty-(ordSells[sym]||0)>0) heldSyms.add(sym);});
    }
    heldSyms.forEach(sym=>{
      const hitCols=SURV_ALL_HITS[sym];
      if(!hitCols) return;
      const ltp=ALL.find(s=>s.symbol===sym)?.price||(POSITIONS?.find(p=>p.symbol===sym)?.ltp)||(HOLDINGS?.find(h=>h.symbol===sym)?.ltp)||null;
      const avg=HOLD_COST_MAP[sym]??HOLDINGS?.find(h=>h.symbol===sym)?.avgCost??null;
      const pnlPct=(ltp&&avg&&avg>0)?+(((ltp-avg)/avg)*100).toFixed(2):null;
      Object.keys(hitCols).forEach(col=>{
        if(!heldPillMap[col]) heldPillMap[col]=[];
        heldPillMap[col].push({sym,pnlPct});
      });
    });
  // Sort each flag's stocks worst P&L first
  Object.values(heldPillMap).forEach(arr=>arr.sort((a,b)=>(a.pnlPct??Infinity)-(b.pnlPct??Infinity)));

  const visRows=allAcc.filter(r=>!activeColKeys.has(r.key));
  const maxSess=1;
  const scRows=visRows.map(r=>{
    const conf='live';
    const verdict=r.sessions<2?'❓':r.winRate<35&&r.pnlPct<-0.5?'🚫 Filter':r.winRate>65&&r.pnlPct>0.5?'✅ Safe':'📊 Neutral';
    const stocks=r.stocks||[];
    const heldPills=stocks.map(({sym,pnlPct})=>{
      const pnlColor=pnlPct>=0?'var(--green)':'var(--red)';
      const pnlStr=pnlPct!=null?(pnlPct>=0?'+':'')+pnlPct.toFixed(1)+'%':'—';
      return `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:4px;padding:2px 6px;margin:2px 3px 2px 0;white-space:nowrap;font-family:'DM Mono',monospace"><span style="font-weight:700;color:var(--amber);font-size:13px">${escHtml(sym)}</span><span style="color:${pnlColor};font-size:12px">${pnlStr}</span></span>`;
    }).join('');
    return {col:r.col,sessions:r.sessions,lastCount:r.lastCount,winRate:r.winRate,avgPnl:r.avgPnl,pnlRs:r.pnlRs,pnlPct:r.pnlPct,
      verdict,_conf:conf,_maxSess:maxSess,heldPills,_heldCount:stocks.length,_addBtn:0};
  });
  const scCols=[
    {key:'col',label:'Surveillance Column',align:'left',fmt:(v)=>`<span style="font-size:13px" title="${escHtml(v)}">${escHtml(v)}</span>`},
    {key:'lastCount',label:'Holdings Flagged',align:'right',fmt:(v)=>`<span style="color:var(--t3);font-family:'DM Mono',monospace">${v}</span>`},
    {key:'pnlRs',label:'Unrealised P&L ₹',align:'right',fmt:(v)=>`<span style="color:${v<0?'var(--red)':v>0?'var(--green)':'var(--t3)'};font-weight:700;font-family:'DM Mono',monospace" title="Total current unrealised P&L in rupees across holdings currently flagged by this column">${fmtSignedINR(v)}</span>`},
    {key:'pnlPct',label:'Unrealised P&L %',align:'right',fmt:(v)=>`<span style="color:${v<0?'var(--red)':v>0?'var(--green)':'var(--t3)'};font-weight:700;font-family:'DM Mono',monospace" title="Capital-weighted current unrealised P&L percentage across holdings currently flagged by this column">${v>=0?'+':''}${v.toFixed(2)}%</span>`},
    {key:'verdict',label:'Signal',align:'left',fmt:(v)=>`<span style="color:${v.startsWith('🚫')?'var(--red)':v.startsWith('✅')?'var(--green)':'var(--amber)'};font-weight:700">${v}</span>`},
    {key:'heldPills',label:'Held Positions',align:'left',fmt:(v,row)=>v||`<span style="color:var(--t3);font-size:13px">—</span>`},
    {key:'_addBtn',label:'',align:'right',fmt:(v,row)=>`<button onclick="addSurvRule(${escHtml(JSON.stringify(row.col))})" style="padding:4px 8px;border-radius:6px;border:1px solid rgba(34,197,94,.3);background:rgba(34,197,94,.08);color:var(--green);font-size:12px;font-weight:700;cursor:pointer">Add</button>`},
  ];
  _methTbls.sc=makeSortableTable('tbl-sc',scCols,scRows,'pnlPct',1); // worst weighted P&L% first
  return `
    <h4 id="meth-surv-corr" style="margin:16px 0 6px;font-size:15px;color:var(--t2)">📊 Surveillance P&L Correlation
      <button onclick="if(confirm('Reset surveillance correlation accumulator?')){SURV_CORR_ACC={};SURV_CORR_LAST_TAG=null;FS.set(SURV_CORR_STORE,{});_refreshHFSection();}" style="margin-left:12px;padding:3px 8px;border-radius:6px;border:1px solid var(--border);background:none;color:var(--t3);font-size:12px;cursor:pointer">Reset</button>
    </h4>
    <p style="font-size:13px;color:var(--t3);margin-bottom:8px">For each surveillance column, shows the total current unrealised P&L in ₹ and the capital-weighted unrealised P&L% of your <em>currently held stocks</em> flagged by that column. A deep negative P&L% means those flagged holdings are underwater. Signal = 🚫 Filter when weighted P&L% &lt; −0.5%. A stock with several flags appears in each relevant rule row, so rows are not totalled.</p>
    ${staleNote}
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div class="scroll-x">${_methTbls.sc.getHtml()}</div>
    </div>`;
}

function renderMethodology(){
  try{ return _renderMethodologyInner(); }
  catch(err){
    console.error('renderMethodology error:',err);
    const mc=document.getElementById('methContent');
    if(mc) mc.innerHTML=`<div style="padding:20px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);border-radius:10px;color:var(--red);font-family:'DM Mono',monospace;font-size:14px"><strong>Methodology render error</strong><pre style="margin-top:10px;white-space:pre-wrap;font-size:13px;color:var(--t2)">${escHtml(err&&err.stack||String(err))}</pre></div>`;
  }
}
function buildRadarLedgerHTML(){
  if(!RADAR.headers.length) return '<p style="color:var(--t3);font-size:14px">Load files to audit every screener column. The ledger is rebuilt from each fresh upload.</p>';
  const byIndex=new Map(RADAR.features.map(f=>[f.i,f]));
  const rowsCount=RADAR.matrix.length||1;
  const ledgerRows=RADAR.headers.map((h,i)=>{
    const f=byIndex.get(i);
    let use,group='Audit',w=0,sep=null;
    let cov=f?f.coverage:(RADAR.matrix.length?RADAR.matrix.filter(r=>r[i]!==''&&r[i]!=null).length/rowsCount:0);
    if(i===RADAR.ids.targetI)use='Same-day rocket label and overextension control; excluded from modeled predictors';
    else if(i===RADAR.ids.symbolI||i===RADAR.ids.descI)use='Identifier / display only';
    else if(i===RADAR.ids.sectorI){use='Sector peer context and display';group='Context';}
    else if(/ - Currency$/.test(h))use='Unit metadata; zero weight when constant';
    else if(f){use=radarIsPriceLevel(h)?'Converted to % distance from current price, then ranked':'Winsorized and cross-sectionally percentile-ranked';group=RADAR_GROUPS[f.group].label;w=f.weight;sep=f.diagnosticEffect??f.effect;}
    else use=cov===0?'Empty in this snapshot; retained in audit':'Constant, sparse, or non-numeric; retained in audit';
    return `<tr><td style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:600;color:var(--t1);white-space:normal;min-width:230px">${escHtml(h)}</td><td style="font-size:13px;color:var(--t2)">${escHtml(use)}</td><td style="font-size:12px;color:var(--cyan);text-transform:uppercase;font-weight:700">${group}</td><td style="font-weight:700">${w?w.toFixed(3):'0'}</td><td><span style="display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;background:${cov>.9?'var(--green)':cov>.5?'var(--amber)':'var(--red)'}"></span>${(cov*100).toFixed(0)}%</td><td>${sep===null?'—':`<span class="${sep>=0?'pos':'neg'}">${sep>=0?'+':''}${(sep*100).toFixed(1)} pp</span>`}</td></tr>`;
  }).join('');
  return `<div class="corr-wrap"><table class="ct"><thead><tr><th>Column / Feature</th><th>Use</th><th>Group</th><th>Model Weight</th><th>Coverage</th><th>Today-Rocket Separation</th></tr></thead><tbody>${ledgerRows}</tbody></table></div>`;
}
function buildIndicatorWatchHTML(){
  let w;try{w=evaluateIndicatorWatch();}catch(e){return '';}
  const resolved=w.resolvedSessions||0;
  const collecting=resolved<IW_MIN_SESSIONS;
  const head=`<h3 id="meth-watch" style="margin-top:28px">Indicator Triggers <span style="font-size:14px;color:var(--t3);font-weight:400">automatic orientation correction</span></h3>`;
  const intro=`<p style="color:var(--t2);font-size:14.5px;line-height:1.7">Each accepted session records where every liquid stock (turnover ≥ ₹25L) sits on every direction-testable indicator. After ${IW_WINDOW} sessions, a trigger fires only when the rewarded end produced fewer movers on <strong>both</strong> the +5% and +10% outcomes past the strict multiple-testing bar. A measured trade-horizon effect has first authority; otherwise the mature trigger reverses the unopposed prior inside the score automatically.</p>`;
  if(collecting){
    return `${head}${intro}<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:14px 18px;font-size:14px;color:var(--t2)">⏳ Collecting evidence — <strong>${resolved}/${IW_MIN_SESSIONS}</strong> resolved sessions (need ${IW_MIN_SESSIONS} before any warning; ${w.pending} snapshot${w.pending===1?'':'s'} awaiting their ${IW_WINDOW}-session resolution). No orientation warnings until enough forward data exists.</div>`;
  }
  if(!w.flags.length){
    return `${head}${intro}<div style="background:var(--bg-card);border:1px solid rgba(34,197,94,.25);border-radius:10px;padding:14px 18px;font-size:14px;color:var(--t2)">✓ No orientation trigger is active over the last ${resolved} resolved sessions (${w.testable} indicators have enough samples to test).</div>`;
  }
  const rows=w.flags.map(f=>{
    const dir=f.sign>0?'rewards its HIGH end':'rewards its LOW end';
    return `<tr>
      <td style="font-weight:700;color:var(--t1)">${escHtml(f.name)}</td>
      <td style="font-size:13px;color:var(--t2)">prior ${dir}</td>
      <td style="color:var(--red);font-weight:700;font-family:'DM Mono',monospace">${f.e5.mean>0?'+':''}${f.e5.mean} (n${f.e5.n})</td>
      <td style="color:var(--red);font-weight:700;font-family:'DM Mono',monospace">${f.e10.mean>0?'+':''}${f.e10.mean} (n${f.e10.n})</td>
    </tr>`;
  }).join('');
  return `${head}${intro}
    <div style="background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:12px 16px;margin-bottom:10px;font-size:14px;color:var(--t1)"><strong>⚡ ${w.flags.length} orientation trigger${w.flags.length===1?' is':'s are'} active over the last ${resolved} sessions.</strong> The rewarded end held <em>fewer</em> movers on both +5% and +10%. Each unopposed prior is automatically reversed in scoring; a measured trade-horizon effect keeps first authority.${(()=>{
      // A TRIGGER ON A FEATURE THAT ALREADY CARRIES A MEASURED EFFECT DEFERS TO THE CLOSER HORIZON.
      // was built (v526) every effect was pinned to 0, so a prior ran unopposed and a backwards one
      // was invisible. Since the v1136 forward log re-armed, some features carry a measured forward
      // effect that OVERRIDES their prior at up to 58% of the signal - and where that effect already
      // points the way this panel is warning about, the scorer has corrected itself and there is
      // nothing to bring to review. Only the unopposed ones need a human.
      try{
        const F=RADAR.features||[];
        const over=w.flags.filter(f=>{
          const g=F.find(x=>(x.name||'')===(f.indicator||f.name));
          return g&&Math.abs(g.effect||0)>0.0001;
        }).length;
        if(!over) return '';
        return ` <span style="color:var(--t3)">${over} already carry a measured trade-horizon effect; the remaining ${w.flags.length-over} are being corrected by this trigger.</span>`;
      }catch(e){ return ''; }
    })()}</div>
    <div class="scroll-x"><table class="ct" style="min-width:620px"><thead><tr><th>Indicator</th><th>Prior orientation</th><th title="Mean forward decile gap (mover minus non-mover), normalized; negative vs the rewarded end = backwards">+5% forward gap</th><th>+10% forward gap</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function _renderMethodologyInner(){
  const mc=document.getElementById('methContent');
  if(!mc) return;
  const groupsHTML=Object.values(RADAR_GROUPS).map(g=>`<div class="rr-group"><b>${g.label}<i>${g.budget}%</i></b><span>${g.desc}</span><meter min="0" max="20" value="${g.budget}"></meter></div>`).join('');
  const diagHTML=`
    <div class="rr-diag">
      <div><b>${RADAR.rockets||0}</b><span>day-1 rockets (target before stop)</span></div>
      <div><b>${RADAR.features.length||0}</b><span>informative modeled features</span></div>
      <div><b>${RADAR.headers.length||0}</b><span>screener columns audited</span></div>
      <div><b>${RADAR.ms?(RADAR.ms/1000).toFixed(2)+'s':'—'}</b><span>parse + score time</span></div>
    </div>`;
  const hardFiltersHTML=buildHardFilterMethodologyHTML(ENGINE_DATA);
  mc.innerHTML=`
    <nav style="position:sticky;top:var(--hdr-h,72px);z-index:50;background:var(--bg);padding:8px 0 10px;margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--border);box-shadow:0 2px 8px rgba(0,0,0,0.3);overflow-x:auto;-webkit-overflow-scrolling:touch">
      <a href="#meth-scoring" onclick="event.preventDefault();scrollToSection('meth-scoring')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:13px;font-weight:600;text-decoration:none;cursor:pointer">⚙ Scoring System</a>
      <a href="#meth-ledger" onclick="event.preventDefault();scrollToSection('meth-ledger')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:13px;font-weight:600;text-decoration:none;cursor:pointer">📒 Feature Ledger</a>
      <a href="#meth-watch" onclick="event.preventDefault();scrollToSection('meth-watch')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:13px;font-weight:600;text-decoration:none;cursor:pointer">🧭 Indicator Watch</a>
      <a href="#meth-filters" onclick="event.preventDefault();scrollToSection('meth-filters')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:13px;font-weight:600;text-decoration:none;cursor:pointer">🛡 Surveillance</a>
      <a href="#meth-guide" onclick="event.preventDefault();scrollToSection('meth-guide')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:13px;font-weight:600;text-decoration:none;cursor:pointer">📖 Use & Risk</a>
    </nav>
    <h3 id="meth-scoring">Radar Composite — Same-Day Transparent Scoring</h3>
    <p><strong>Evidence boundary:</strong> one day's cross-section cannot train or validate a forward outcome. A <strong>rocket</strong> means a stock that reached its own target before its own stop within ${ROCKET_HORIZON_DAYS} trading days — a FORWARD, path-dependent label that does not exist at scan time, so it never sets a feature's direction or weight. The score is a transparent relative ranking built from robust market-wide normalization and engineered priors; the rocket separation is measured for audit only. It is a research screener, not investment advice.</p>
    <div class="m-grid">
      <div class="m-card"><h4>Composite Architecture</h4><p>Every informative screener column enters through a typed transformation, a robust percentile, and a budgeted feature group. Exchange reports add authoritative series, price band, status, delivery, trades, 52-week range, surveillance and deal context.</p><div class="rr-groups" style="margin-top:10px">${groupsHTML}</div></div>
      <div class="m-card"><h4>What the Score Does</h4><ol style="padding-left:18px;color:var(--t2);font-size:14px;line-height:1.7">
        <li>Winsorizes transformed numeric inputs at the 2nd and 98th percentiles.</li>
        <li>Converts values to ranks across the uploaded universe, preventing unit scale from dominating.</li>
        <li>Reports each feature’s separation between today’s day-1 rockets (reached target before stop) and the rest for audit, but never feeds that same-session label back into the score.</li>
        <li>Blends that diagnostic with finance-aware priors for momentum, participation, breakout structure, liquidity, volatility and trend.</li>
        <li>Cross-checks official delivery, close versus average price, 52-week position, deal activity and surveillance flags.</li>
        <li>Strongly penalizes non-EQ, inactive and sub-10% price-band securities while retaining them in the visible ranking for audit. Only eligible securities enter the basket.</li>
        <li>Penalizes a stock whose typical daily range cannot comfortably cover the session's target: above one normal daily range the target starts costing points, above two the penalty is severe. The bar is the target you actually need, not a fixed percentage — before v1113 it asked for a 10% move, the rocket definition retired in v1085.</li>
      </ol>${diagHTML}</div>
      <div class="m-card"><h4>Held Suppression & Basket</h4><p>Held positions (Holdings + Positions + today's net Orders buys) never re-enter the buy ranking. Quantities come from the charge-aware score-weighted allocator and can never exceed 0.10% of that stock's daily rupee turnover; missing turnover blocks a market order. Every exported order gets its own target from that stock's ATR/range capacity blended with the portfolio target anchor, plus its own ATR-scaled stop inside the existing ${SL_MIN_PCT.toFixed(1)}%–${SL_MAX_PCT.toFixed(1)}% risk rails.</p></div>
      <div class="m-card"><h4>What Still Learns</h4><p>The scorer itself is stateless by design. The execution layer keeps learning portfolio context from your results: the target anchor from later attainable highs, the fallback stop and review horizon from realised outcomes, and the same-day exit diagnostic from your sells against that day's highs. Max Allocation is arithmetic, not learned risk sizing: Capital divided by average positions entered per day.</p></div>
    </div>
    <h3 id="meth-ledger" style="margin-top:28px">Feature Ledger <span style="font-size:14px;color:var(--t3);font-weight:400">(${RADAR.features.length||0} modeled of ${RADAR.headers.length||0} columns)</span></h3>
    ${buildRadarLedgerHTML()}
    ${buildIndicatorWatchHTML()}
    <div id="meth-hf-wrap">${hardFiltersHTML}</div>
    <h3 id="meth-guide" style="margin-top:28px">Use & Risk</h3>
    <div class="m-grid">
      <div class="m-card"><h4>Entry Workflow</h4><ol style="padding-left:18px;color:var(--t2);font-size:14px;line-height:1.7">
        <li>Upload a screener snapshot at a consistent time.</li>
        <li>Start with liquid, low- or medium-risk names whose top contributions span several groups.</li>
        <li>Reject candidates driven by one heroic feature, corporate-action distortions, circuits, stale prints, surveillance restrictions, or news you have not checked.</li>
        <li>Demand confirmation: hold above VWAP/opening range, participation that persists, and a pre-defined invalidation price.</li>
        <li>Cap position size from account risk, not from enthusiasm. Enthusiasm has never met a denominator it respected.</li>
      </ol></div>
      <div class="m-card"><h4>Interpretation</h4><ul style="padding-left:18px;color:var(--t2);font-size:14px;line-height:1.7">
        ${RADAR_SCORE_BANDS.map(b=>`<li><b style="color:${b.color}">${b.range}:</b> ${b.note}</li>`).join('')}
        <li>The score is ordinal and cross-sectional. A score of 90 does not mean a 90% chance.</li>
        <li>A real probability model needs many dated snapshots and their next-day outcomes; the surviving outcome stores collect exactly that execution evidence.</li>
      </ul></div>
    </div>
    <p style="color:var(--t3);font-style:italic;margin-top:4px">⚠ Quantitative screening only. Not financial advice. Past momentum ≠ future returns.</p>`;
  setTimeout(()=>{_methTbls.hf?.render();_methTbls.sc?.render();},0);
}

// Fixed columns + dynamic top 10 rocket-relevance features (skip empty ones)
function getCols(){
  // User-dragged column order (v536) applies here so header and cells always agree.
  return applyColOrder('main-rankings',[
    {key:'chk',label:'',s:0},
    {key:'rank',label:'#',s:1},
    {key:'score',label:'Score',s:1},
    {key:'symbol',label:'Symbol',s:1},
    {key:'price',label:'Price/Day',s:1},
    {key:'relvol',label:'Vol/Bk',s:1},
    {key:'turnover',label:'Liq',s:1},
    {key:'avgMove',label:'Pace',s:1},
    {key:'predEod',label:'EoD',s:1},
    {key:'tgt',label:'TGT/SL',s:0},
    {key:'alloc',label:'Alloc',s:0},
    {key:'risk',label:'Risk',s:1},
  ]);
}
let COLS=getCols();

function updateSelectAll(){
  const allSyms=FILT.filter(s=>s.basketEligible!==false&&passesIntradayValidation(s)).map(s=>s.symbol);
  const allChecked=allSyms.length>0&&allSyms.every(sym=>SELECTED.has(sym));
  const sa=document.getElementById('chk-all');
  if(sa){sa.indeterminate=!allChecked&&SELECTED.size>0&&allSyms.some(sym=>SELECTED.has(sym));sa.checked=allChecked;}
  renderBasketBtn();
}
function toggleSelectAll(checked){
  if(checked){
    FILT.forEach(s=>EXPORT_EXCLUDED.delete(s.symbol));
    SELECTED=new Set(FILT.filter(s=>s.basketEligible!==false&&passesIntradayValidation(s))
      .slice(0,20).map(s=>s.symbol));
  } else {
    FILT.forEach(s=>{if(s.basketEligible!==false)EXPORT_EXCLUDED.add(s.symbol);});
    SELECTED.clear();
  }
  saveFilterState();
  renderTable();
  renderBasketBtn();
}
function toggleStock(sym,checked){
  const row=FILT.find(s=>s.symbol===sym);
  if(checked&&row&&passesIntradayValidation(row)){EXPORT_EXCLUDED.delete(sym);SELECTED.add(sym);}
  else if(checked){SELECTED.delete(sym);}
  else{EXPORT_EXCLUDED.add(sym);SELECTED.delete(sym);}
  saveFilterState();
  updateSelectAll();
  recomputeAlloc();
}
function getBuyPrice(s){
  const ltp=s.price>0?s.price:0;
  if(!(ltp>0)) return 0;
  const budgetReference=ltp*(1+BASKET_MARKET_BUDGET_BUFFER_PCT/100);
  return parseFloat(tickPrice(budgetReference).toFixed(2));
}
function getHeldPositionMap(){
  const heldPos={};
  Object.values(getCombinedOpenPositionMap()).forEach(pos=>{
    if(pos.qty>0) heldPos[pos.symbol]={qty:pos.qty,avg:pos.avg};
  });
  return heldPos;
}
function getCombinedOpenPositionMap(){
  const combined={};
  const ensure=(symbol)=>{
    if(!combined[symbol]) combined[symbol]={symbol,qty:0,avg:0,ltp:null,hasLivePosition:false};
    return combined[symbol];
  };
  if(HOLDINGS?.length) HOLDINGS.forEach(h=>{
    if(!h?.symbol||!(h.qty>0)) return;
    const pos=ensure(h.symbol);
    pos.qty=h.qty;
    pos.avg=HOLD_COST_MAP[h.symbol]??h.avgCost??0;
    pos.ltp=h.ltp??pos.ltp;
  });
  if(POSITIONS?.length) POSITIONS.forEach(p=>{
    if(!p?.symbol||!isFinite(Number(p.qty))) return;
    const pos=ensure(p.symbol);
    const liveQty=Number(p.qty)||0;
    const liveAvg=Number(p.avg??p.avgCost)||0;
    pos.hasLivePosition=true;
    pos.ltp=p.ltp??pos.ltp;
    if(liveQty>0){
      const settledValue=pos.qty>0&&pos.avg>0?pos.qty*pos.avg:0;
      const liveValue=liveAvg>0?liveQty*liveAvg:0;
      pos.qty+=liveQty;
      pos.avg=pos.qty>0?(settledValue+liveValue)/pos.qty:0;
    }else if(liveQty<0){
      if(!(pos.qty>0)){
        pos.qty+=liveQty;
        if(pos.qty<=0) pos.avg=liveAvg||pos.avg||0;
      }
    }
  });
  if(ORDERS_TODAY?.length){
    const todayDate=getSessionDate();
    const ordBuys={},ordSells={},ordAvgBuy={};
    ORDERS_TODAY.forEach(o=>{
      if(normOrderDate(o.time)!==todayDate) return;
      const sym=o.symbol; if(!sym) return;
      const otype=(o.type||'').toUpperCase();
      if(otype==='BUY'){
        ordBuys[sym]=(ordBuys[sym]||0)+o.qty;
        if(!ordAvgBuy[sym]) ordAvgBuy[sym]={tot:0,qty:0};
        ordAvgBuy[sym].tot+=o.price*o.qty;
        ordAvgBuy[sym].qty+=o.qty;
      } else if(otype==='SELL') ordSells[sym]=(ordSells[sym]||0)+o.qty;
    });
    Object.entries(ordBuys).forEach(([sym,bQty])=>{
      const netQty=bQty-(ordSells[sym]||0);
      if(netQty>0&&!combined[sym]?.hasLivePosition){
        const avgObj=ordAvgBuy[sym];
        const avg=avgObj&&avgObj.qty>0?+(avgObj.tot/avgObj.qty).toFixed(2):0;
        const pos=ensure(sym);
        const settledValue=pos.qty>0&&pos.avg>0?pos.qty*pos.avg:0;
        pos.qty+=netQty;
        pos.avg=pos.qty>0?(settledValue+avg*netQty)/pos.qty:0;
      }
    });
    Object.entries(ordSells).forEach(([sym,sQty])=>{
      const bQty=ordBuys[sym]||0;
      if(!combined[sym]?.hasLivePosition&&sQty>bQty){
        const pos=ensure(sym);
        // Same rule as Positions: a current positive Holdings quantity is already post-sale.
        // Orders is only a fallback for representing a net sell when no holding remains.
        if(!(pos.qty>0)) pos.qty-=sQty-bQty;
      }
    });
  }
  Object.values(combined).forEach(pos=>{pos.avg=pos.avg>0?+pos.avg.toFixed(4):0;});
  return combined;
}
function estimateRoundTripCostPct(grossTargetPct=1){
  const avgTurnoverPct=TRADEBOOK_STATS?.avgChargePct;
  if(avgTurnoverPct!=null&&isFinite(avgTurnoverPct)&&avgTurnoverPct>0){
    return +Math.max(0,avgTurnoverPct*(2+(Math.max(0,grossTargetPct)/100))).toFixed(3);
  }
  return 0.35;
}
function getHarvestOutcomeSamples(){
  const recPicks=Object.values((FS.get(RECOMMEND_OUTCOME_STORE)||{}).issues||{})
    .flatMap(issue=>(issue.picks||[]).filter(p=>p.complete&&p.observations>0));
  const entryRows=Object.values((FS.get(ENTRY_OUTCOME_STORE)||{}).entries||{})
    .filter(e=>e.complete&&e.observations>0);
  const samples=[];
  entryRows.forEach(e=>{
    const net=Number(e.bestNetHighPct);
    if(isFinite(net)) samples.push({net,kind:'entry'});
  });
  recPicks.forEach(p=>{
    const gross=Number(p.bestHighProfitPct);
    if(!isFinite(gross)) return;
    const net=gross-estimateRoundTripCostPct(gross);
    samples.push({net:+net.toFixed(3),kind:'recommendation'});
  });
  return samples;
}
// Memoized: the plan only changes on new uploads/outcome writes, but hot render paths
// (allocation cells, status bar, stats) used to recompute it on every keystroke.
let _harvestPlanMemo=null;
function computeHarvestPlan(){
  if(_harvestPlanMemo&&Date.now()-_harvestPlanMemo.t<1500) return _harvestPlanMemo.v;
  const v=_computeHarvestPlanUncached();
  _harvestPlanMemo={t:Date.now(),v};
  return v;
}
function invalidateTargetAnchorCaches(){
  _harvestPlanMemo=null;   // TTL-based: the one that can genuinely serve a pre-portfolio value
  _goalRateCache=null;     // goal-required net %/day — keyed on capital, which just changed
  _achieveMemo=null;       // measured achievability curve (bhav-derived, tradebook-cost dependent)
  _nudgeMemo=null;         // left-on-table pool cohort
  _avgTradesMemo=null;     // trade cadence -> Max Alloc default
  _defMaxAllocMemo=null;
  _defRiskMemo=null;
  _allocMemo=null;
  _reachMemo=null;         // v1119: the reachable level is read from the exit store, which a load refreshes
  _capitalMemo=null;       // v1126: capital buckets — identity-keyed, but a load replaces the inputs
  _goalCfgMemo=null;       // v1126: goal config + its trading-day countdown
}
function _computeHarvestPlanUncached(){
  const samples=getHarvestOutcomeSamples();
  const netSamples=samples.map(s=>s.net).filter(v=>isFinite(v)).sort((a,b)=>a-b);
  const desiredNet=HARVEST_DESIRED_NET_PCT;
  const confidenceTarget=HARVEST_TRIGGER_CONFIDENCE;
  const reachablePct=1-confidenceTarget;
  let source='cost floor';
  let learnedNet=null;
  if(netSamples.length>=HARVEST_MIN_SAMPLES){
    learnedNet=percentileValue(netSamples,reachablePct);
    source=`${Math.round(confidenceTarget*100)}% ${getAdaptiveOutcomeHorizonDays()}d reachable`;
  }
  let netTarget=Math.max(desiredNet,learnedNet!=null&&isFinite(learnedNet)?learnedNet:0);
  const goalNet=(typeof getGoalRequiredNetPct==='function')?getGoalRequiredNetPct():null;
  let grossTarget=netTarget+estimateRoundTripCostPct(netTarget+0.35);
  const costPct=estimateRoundTripCostPct(grossTarget);
  grossTarget=roundPct05(netTarget+costPct);
  const finalCostPct=estimateRoundTripCostPct(grossTarget);
  const expectedNetPct=+(grossTarget-finalCostPct).toFixed(3);
  const achievedConfidence=netSamples.length
    ? +(netSamples.filter(v=>v>=expectedNetPct).length/netSamples.length).toFixed(3)
    : null;
  const capitalNeeded=expectedNetPct>0?Math.ceil(HARVEST_DAILY_NET_GOAL_RS/(expectedNetPct/100)):null;
  const belowFloor=learnedNet!=null&&learnedNet<desiredNet;
  return {
    targetPct:grossTarget,
    expectedNetPct,
    costPct:+finalCostPct.toFixed(3),
    desiredNetPct:desiredNet,
    confidence:achievedConfidence,
    confidenceTarget,
    sampleCount:netSamples.length,
    learnedNetPct:learnedNet==null?null:+learnedNet.toFixed(3),
    capitalNeeded,
    dailyGoal:HARVEST_DAILY_NET_GOAL_RS,
    source:netSamples.length>=HARVEST_MIN_SAMPLES?source:'cost floor (warming up)',
    goalNetPct:goalNet,
    warning:belowFloor?'Recent reachable moves are below the desired net floor.':null
  };
}
function getGoalLedTargetPct(){
  const goalNet=getGoalRequiredNetPct(); // required NET %/trading day on total capital
  if(goalNet==null||!isFinite(goalNet)||goalNet<=0) return null;
  const netEff=Math.max(goalNet,HARVEST_DESIRED_NET_PCT);
  let gross=netEff+estimateRoundTripCostPct(netEff+0.35);
  gross=roundPct05(netEff+estimateRoundTripCostPct(gross));
  return gross;
}
function maxReachableAnchorPct(){
  let m=0;
  try{ for(const k in NSE_PRICE_BAND){ const b=NSE_PRICE_BAND[k]?.bandPct; if(b>m) m=b; } }catch(e){}
  return m>0?m:20;
}
function getActiveTargetInfo(){
  const harvest=computeHarvestPlan().targetPct;
  const goal=getGoalLedTargetPct();
  const auto=(goal!=null&&goal<harvest)?{tgtPct:goal,source:'goal'}:{tgtPct:harvest,source:'harvest'};
  const manual=parseFloat(document.getElementById('fTgtOverride')?.value);
  if(Number.isFinite(manual)&&manual>0&&manual<=maxReachableAnchorPct())
    return {tgtPct:manual,source:'manual',harvestPct:harvest,goalPct:goal,autoPct:auto.tgtPct};
  return {tgtPct:auto.tgtPct,source:auto.source,harvestPct:harvest,goalPct:goal,autoPct:auto.tgtPct};
}
function getDefaultTgtPct(){
  const harvest=computeHarvestPlan().targetPct;
  const goal=getGoalLedTargetPct();
  return (goal!=null&&goal<harvest)?goal:harvest;
}
function getEffectiveTgtPct(){
  return getActiveTargetInfo().tgtPct;
}

const ACHIEVE_MIN_ROWS=200;         // below this the curve is not trusted and nothing is floored
let _achieveMemo=null;
function buildAchievabilityCurve(){
  // v1126: the key used to run Object.keys(NSE_BHAV).length on EVERY call — walking a ~3,000-entry
  // map to read a number — which cost 514ms across 2,974 calls during one Performance render. The
  // map is REPLACED on each ZIP parse, so identity answers the same question in O(1).
  if(_achieveMemo&&_achieveMemo.bhav===NSE_BHAV&&_achieveMemo.all===ALL
     &&_achieveMemo.sl===(TRADEBOOK_STATS?.adaptiveSL??'')) return _achieveMemo.val;
  const sig={bhav:NSE_BHAV,all:ALL,sl:TRADEBOOK_STATS?.adaptiveSL??''};
  let val=null;
  try{
    const rows=[];
    for(const r of (ALL||[])){
      const b=NSE_BHAV[r.symbol];
      if(!b||!(b.open>0)||!(b.high>0)||!(b.low>0)) continue;
      if(r.basketEligible===false) continue;
      if(!(Number(r.turnover)>=2500000)||!(b.open>=10)) continue;   // the tradeable universe
      const stop=getRowStopDistancePct(r);
      if(!(stop>0)) continue;
      rows.push({stop,entry:b.open,close:b.officialClose,bar:{high1d:b.high,low1d:b.low}});
    }
    if(rows.length>=ACHIEVE_MIN_ROWS){
      const stops=rows.map(x=>x.stop).sort((a,b)=>a-b);
      const medStop=stops[Math.floor(stops.length/2)];
      const cost=estimateRoundTripCostPct(2)||0;
      let best=null; const curve=[];
      // The grid spans the observed stop distribution rather than round numbers, so no constant
      // is invented: the question is only ever "what multiple of the risk is worth aiming for".
      for(let t=stops[0]*0.2;t<=stops.at(-1)*1.05;t+=0.25){
        const T=+t.toFixed(2);
        let win=0,lose=0,neither=0,neitherSum=0;
        for(const x of rows){
          const o=resolveRocketDay(x.bar,x.entry,T,x.stop);
          if(o===ROCKET_OUTCOME.ROCKET) win++;
          else if(o===ROCKET_OUTCOME.STOPPED||o===ROCKET_OUTCOME.AMBIGUOUS) lose++;   // v1085: ambiguous is not a win
          else { neither++; if(x.close>0) neitherSum+=100*(x.close/x.entry-1); }
        }
        const n=rows.length, p=win/n, q=lose/n, m=neither/n;
        // The unresolved bucket is NOT free — it exits wherever the stock closed, which is what a
        // time exit realises. Ignoring it would make every large target look artificially safe.
        const exp=p*T - q*medStop + m*(neither?neitherSum/neither:0) - cost;
        curve.push({T,p,q,m,exp});
        if(!best||exp>best.exp) best={T,p,q,m,exp};
      }
      val={bestT:best.T,rr:+(best.T/medStop).toFixed(2),hitRate:best.p,expectancy:best.exp,
           medStop,n:rows.length,dateStr:NSE_BHAV[Object.keys(NSE_BHAV)[0]]?.dateStr||null,curve};
    }
  }catch(e){ val=null; }   // fails OPEN: no curve means no floor, never a broken target
  _achieveMemo={...sig,val};
  return val;
}
// The baseline multiple of risk worth aiming for. null when the curve cannot be trusted.
function getBaselineRewardRisk(){
  const c=buildAchievabilityCurve();
  return c&&c.rr>0?c.rr:null;
}
let _nudgeMemo=null;
function getTargetNudgeContext(){
  const pool=getLeftOnTablePool();
  const cohort=(Array.isArray(ALL)?ALL:[])
    .filter(r=>r&&r.basketEligible&&Number.isFinite(Number(r.score))&&Number(r.score)>0)
    .sort((a,b)=>(a.rank||1e9)-(b.rank||1e9))
    .slice(0,typeof RECOMMEND_MAX_RANK==='number'?RECOMMEND_MAX_RANK:10);
  const meanScore=cohort.length?cohort.reduce((s,r)=>s+Number(r.score),0)/cohort.length:null;
  const sig=`${pool.poolPct}|${meanScore==null?'-':meanScore.toFixed(3)}|${cohort.length}`;
  if(_nudgeMemo&&_nudgeMemo.sig===sig) return _nudgeMemo.val;
  const val={poolPct:pool.poolPct,rawPoolPct:pool.rawPct,meanScore,cohort:cohort.length,
             sessions:pool.sessions,poolSource:pool.source};
  _nudgeMemo={sig,val};
  return val;
}
let _capMedMemo=null;
function getUniverseMedianCapacity(){
  if(_capMedMemo&&_capMedMemo.all===ALL) return _capMedMemo.val;
  const caps=[];
  for(const r of (Array.isArray(ALL)?ALL:[])){
    if(r&&r.basketEligible===false) continue;
    if(!(Number(r&&r.turnover)>=2500000)||!(Number(r&&r.price)>=10)) continue;
    const atr=Number(r&&r.atr), range=Number(r&&r.rangePct);
    const hasA=Number.isFinite(atr)&&atr>0, hasR=Number.isFinite(range)&&range>0;
    const c=hasA&&hasR?Math.sqrt(atr*range):hasA?atr:hasR?range:null;
    if(c>0) caps.push(c);
  }
  // Below a real cross-section the median is not a median. Null makes the scaling inert and the
  // portfolio number is used exactly as v1119 left it.
  const val=caps.length>=ACHIEVE_MIN_ROWS
    ?caps.sort((a,b)=>a-b)[Math.floor(caps.length/2)]:null;
  _capMedMemo={all:ALL,val};
  return val;
}
// v1212 (owner, standing rule): TARGETS COME FROM THE MARKET, NOT FROM HIS TRADE HISTORY.
// "The app needs to evolve, not build on past mistakes... the trade history tells you previous
// logics/versions did not work and that's why we are here." v1105/v1206 priced the target from
// getReachableTargets().basePct - the p50 of buy -> that-day's-high on his own closed exits - and
// the "measured optimum of 1.0-1.25 ATR" came from the same pool. Both are records of what earlier
// versions of THIS APP told him to do. They are removed from the target path.
//
// What replaces them is what the market says is still available, most specific source first:
//   1. the stock's OWN 5-minute tape (Zerodha) - from where we are in the session right now, how
//      much further did this stock travel to its high on its own prior sessions, median;
//   2. the session ceiling (ALL NSE) - low1d + one typical day's range, against the live price;
//   3. its range capacity (ALL NSE) - sqrt(ATR% x rangePct), when there is no session read.
// All three are bounded by the NSE circuit, which is what it may LEGALLY reach.
let _tapeRunwayMemo=null;
function getTapeRunwayPct(sym){
  const keys=Object.keys(INTRADAY_BARS||{});
  const sig=keys.length+':'+keys.reduce((t,k)=>t+(INTRADAY_BARS[k]?INTRADAY_BARS[k].length:0),0);
  if(!_tapeRunwayMemo||_tapeRunwayMemo.sig!==sig) _tapeRunwayMemo={sig,map:new Map()};
  const s=normSym(sym||'');
  if(_tapeRunwayMemo.map.has(s)) return _tapeRunwayMemo.map.get(s);
  let out=null;
  const bars=INTRADAY_BARS[s];
  if(Array.isArray(bars)&&bars.length){
    const byDay={};
    bars.forEach(b=>{const d=istDayKey(b.t); if(d)(byDay[d]??=[]).push(b);});
    const days=Object.keys(byDay).sort();
    if(days.length>=2){
      const today=byDay[days[days.length-1]].slice().sort((a,b)=>a.t-b.t);
      const i=today.length-1;
      const travels=[];
      days.slice(0,-1).forEach(d=>{
        const bs=byDay[d].slice().sort((a,b)=>a.t-b.t);
        if(i>=bs.length) return;               // that session was shorter; no comparable point
        const ref=Number(bs[i].c);
        if(!(ref>0)) return;
        let hi=-Infinity;
        for(let k=i;k<bs.length;k++){ const h=Number(bs[k].h); if(h>hi) hi=h; }
        if(hi>0&&isFinite(hi)) travels.push(100*(hi-ref)/ref);
      });
      // Two comparable sessions is the minimum that can carry a median at all. Below that the
      // tape says nothing and the session ceiling answers instead - absence takes the fallback,
      // never a free pass.
      if(travels.length>=2){
        travels.sort((a,b)=>a-b);
        const n=travels.length;
        out=n%2?travels[(n-1)/2]:(travels[n/2-1]+travels[n/2])/2;
        out=Math.max(0,+out.toFixed(2));
      }
    }
  }
  _tapeRunwayMemo.map.set(s,out);
  return out;
}
function getRowExitPolicy(row,buyPrice=null,activeInfo=null,nudgeInfo=null){
  const active=activeInfo||getActiveTargetInfo();
  const anchor=Number(active.tgtPct)>0?Number(active.tgtPct):Math.abs(Number(TRADEBOOK_STATS?.adaptiveTGT))||null;
  const atr=Number(row?.atr);
  const range=Number(row?.rangePct);
  const hasAtr=Number.isFinite(atr)&&atr>0;
  const hasRange=Number.isFinite(range)&&range>0;
  const capacity=hasAtr&&hasRange?Math.sqrt(atr*range):hasAtr?atr:hasRange?range:null;
  let targetPct=anchor;
  let targetSource='portfolio fallback';
  const toStep=v=>Math.floor(v*20)/20;
  if(anchor>0){
    targetPct=toStep(anchor);
    targetSource=active.source==='manual'?'manual anchor'
      :active.source==='goal'?'goal-required daily rate'
      :'learned harvest rate';
  } else if(capacity>0){
    // Only when no goal/harvest rate can be computed at all.
    targetPct=toStep(capacity);
    targetSource='stock capacity fallback (no goal rate available)';
  }
  // v1097: the base rate is the contract floor and is retained separately — feasibility, viability and
  // the recommendation gates all keep using it (see radarAnalyze). Only the EXIT PRICE gets the nudge.
  const basePct=targetPct;
  let nudgePct=0;
  const bandRef=Number(buyPrice)>0?Number(buyPrice):getBuyPrice(row||{});
  // v1083: what the stock may PLAUSIBLY reach this session - the day's low plus one typical day's
  // range. Resolved HERE, above the nudge, because v1211 bounds the target with it.
  const sc=getSessionCeilingInfo(row,bandRef);
  // v1212: the aspiration is MARKET-DERIVED. getReachableTargets() is deliberately NOT consulted
  // here any more - it is a percentile of his own closed exits, i.e. of the old logic's decisions.
  const tapeRunwayPct=getTapeRunwayPct(row?.symbol);
  const sessionRunwayPct=(sc&&Number.isFinite(sc.runwayPct))?Math.max(0,sc.runwayPct):null;
  const ucEarly=getUpperCircuitInfo(row,bandRef);
  const circuitRunwayPct=(ucEarly&&Number.isFinite(ucEarly.runwayPct))?Math.max(0,ucEarly.runwayPct):null;
  let available=null, availableSource='';
  if(tapeRunwayPct!=null){ available=tapeRunwayPct; availableSource='its own 5-minute tape'; }
  else if(sessionRunwayPct!=null){ available=sessionRunwayPct; availableSource='the session ceiling'; }
  else if(capacity>0){ available=capacity; availableSource='its range capacity'; }
  // The circuit is what it may LEGALLY reach and bounds every estimate.
  if(available!=null&&circuitRunwayPct!=null) available=Math.min(available,circuitRunwayPct);
  // ...and so does the stock's own range capacity. A session ceiling measured from a low the stock
  // has already left can exceed what the stock actually does in a day (DHARIWAL priced 22.35% on a
  // 17.67% capacity, UHTL 3.80% on 3.63%), and a target the stock has never travelled is the same
  // defect as one the session cannot deliver, pointing the other way.
  if(available!=null&&capacity>0) available=Math.min(available,capacity);
  // A MANUAL Target Anchor is an owner input and outranks every measurement, exactly as before.
  if(available!=null&&targetPct>0&&active.source!=='manual'){
    // The goal/harvest anchor no longer RAISES the target to a level the session cannot deliver -
    // that is exactly how HINDZINC was armed at 2.85% with 0.13% of tape left. It survives as the
    // viability floor below, which is where an unaffordable trade belongs.
    targetPct=toStep(available);
    nudgePct=+(targetPct-basePct).toFixed(2);
    targetSource='what the market has left, read from '+availableSource
      +(circuitRunwayPct!=null&&Math.abs(available-circuitRunwayPct)<1e-9?' (bounded by the NSE circuit)':'');
  }
  const stopPct=getRowStopDistancePct(row);
  const baseRR=getBaselineRewardRisk();
  const rrFloorPct=(baseRR>0&&stopPct>0)?toStep(stopPct*baseRR):null;
  let minGrossPct=null;
  if(basePct>0){
    minGrossPct=roundPct05(HARVEST_DESIRED_NET_PCT+estimateRoundTripCostPct(basePct));
    minGrossPct=roundPct05(HARVEST_DESIRED_NET_PCT+estimateRoundTripCostPct(minGrossPct));
  }
  const uc=getUpperCircuitInfo(row,bandRef);
  const bandLimited=!!(uc&&basePct>0&&uc.runwayPct<basePct);
  const rangeExhausted=!!(sc&&basePct>0&&sc.runwayPct<basePct);
  // v1212: viability is decided on the target the row will ACTUALLY be given - but only where the
  // number that set it is HARD. v1112 (owner) removed the statistical session ceiling from this
  // decision after measuring twice that the cohort it deletes is the cohort that reaches target
  // (349 of 900 rows, most of the top ten), and that stands: a low session ceiling may lower the
  // PRICE printed on a row, it may never be the reason the row is withheld.
  // The stock's OWN 5-minute tape is not a statistical ceiling - it is what this stock actually did
  // from this point in the session, on its own sessions. Where that exists it decides affordability,
  // and the row is withheld when it cannot clear costs plus the desired net. Where it does not, the
  // basis falls back to the stock's own range capacity, exactly as before v1212.
  const viabilityBasis=(tapeRunwayPct!=null)?targetPct:(capacity>0?capacity:basePct);
  const viable=viabilityBasis>0&&!bandLimited&&(minGrossPct==null||viabilityBasis+1e-9>=minGrossPct);
  const stopSource=(Math.abs(Number(row?.slPct))>0)?'explicit stock stop'
    :hasAtr?'ATR stock stop'
    :(Number(TRADEBOOK_STATS?.adaptiveSL)>0?'learned portfolio fallback':'minimum-risk fallback');
  // v1073: reward:risk is returned on EVERY row and rendered in the TGT/SL tooltips. It sat below
  // 1.0 on 400/400 rows for releases without anyone noticing, because nothing ever displayed it.
  const rewardRisk=(targetPct>0&&stopPct>0)?+(targetPct/stopPct).toFixed(2):null;
  // v1077: can this stock plausibly travel the goal-required distance in a day? Reported as a FLAG
  // so an unreachable target is visible, never as a cap on the target itself (owner: no ATR-driven
  // targets). null when the stock has no usable range estimate.
  const reachable=(capacity>0&&targetPct>0)?(capacity+1e-9>=targetPct):null;
  return {
    targetPct:targetPct>0?+targetPct.toFixed(2):null,
    // v1097, all REPORTED so the nudge is auditable on every row:
    basePct:basePct>0?+basePct.toFixed(2):null,   // the goal rate alone — what eligibility is judged on
    nudgePct:+Number(nudgePct||0).toFixed(2),      // what the left-on-table pool added
    stopPct:+stopPct.toFixed(2),
    rewardRisk,
    reachable,
    capacityPct:capacity>0?+capacity.toFixed(2):null,
    minGrossPct:minGrossPct>0?+minGrossPct.toFixed(2):null,
    viable,
    bandLimited,
    bandPct:uc?uc.band:null,
    ucPrice:uc?+uc.ucPrice.toFixed(2):null,
    bandRunwayPct:uc?+uc.runwayPct.toFixed(2):null,
    rangeExhausted,
    sessionCeiling:sc?+sc.ceiling.toFixed(2):null,
    sessionRunwayPct:sc?+sc.runwayPct.toFixed(2):null,
    tapeRunwayPct,circuitRunwayPct,marketAvailablePct:available!=null?+available.toFixed(2):null,
    viabilityBasisPct:viabilityBasis>0?+viabilityBasis.toFixed(2):null,
    targetSource,
    stopSource,
    anchorPct:anchor>0?+anchor.toFixed(2):null,
    anchorSource:active.source,
    // v1093, all REPORTED (see the note above — measured, deliberately not enforced):
    rrFloorPct,                                  // the target the measured baseline would ask for
    baselineRR:baseRR??null,                     // market-measured multiple of risk worth aiming at
    meetsBaselineRR:(baseRR>0&&targetPct>0&&stopPct>0)?(targetPct/stopPct)+1e-9>=baseRR:null,
    fallback:capacity==null,
    buyPrice:Number(buyPrice)>0?Number(buyPrice):null
  };
}
function getPositionExitSignal(row){
  if(!row) return null;
  const price=Number(row.price), vwap=Number(row.vwap);
  const hi=Number(row.high1d), lo=Number(row.low1d);
  const cmf=Number(row.chaikinMF), mfi15=Number(row.mfi15m);
  const parts=[], missing=[];
  const push=(ok,label)=>{ if(ok===null){missing.push(label);return;} parts.push({ok,label}); };
  push((vwap>0&&price>0)?price>=vwap:null,'above VWAP');
  push(Number.isFinite(cmf)?cmf>0:null,'money flowing in');
  push(Number.isFinite(mfi15)?mfi15>60:null,'15m money flow strong');
  if(!parts.length) return {state:'unknown',score:null,parts:[],missing,
    note:'No VWAP or money-flow data on this row, so whether it is still being bought is unknown.'};
  const held=parts.filter(x=>x.ok).length;
  const frac=held/parts.length;
  // Retention is CONTEXT, never an input — it is the thing these signals are judged against, so
  // feeding it back in would be exactly the circularity the note above warns about.
  const retention=(hi>lo&&price>0)?+((price-lo)/(hi-lo)).toFixed(2):null;
  const state=frac>=0.99?'holding':frac>=0.5?'mixed':'fading';
  const retTxt=retention!=null?('; price sits at '+Math.round(retention*100)+'% of today’s range'):'';
  return {state,score:+frac.toFixed(2),held,of:parts.length,retention,
    parts:parts.map(x=>(x.ok?'✓ ':'✗ ')+x.label),missing,
    note:held+' of '+parts.length+' buying signals still on'+retTxt
      +'. Reported only — this moves no target and places no order.'};
}
function summarizeRowExitPolicies(rows){
  const policies=(rows||[]).map(r=>getRowExitPolicy(r,r?.price)).filter(p=>p.targetPct>0&&p.stopPct>0&&p.viable);
  if(!policies.length) return null;
  const targets=policies.map(p=>p.targetPct).sort((a,b)=>a-b);
  const stops=policies.map(p=>p.stopPct).sort((a,b)=>a-b);
  return {
    count:policies.length,
    targetMin:targets[0],targetMax:targets.at(-1),
    stopMin:stops[0],stopMax:stops.at(-1),
    fallbacks:policies.filter(p=>p.fallback).length
  };
}

function calendarDaysHeld(dateStr){
  if(!dateStr) return null;
  const start=new Date(String(dateStr).slice(0,10)+'T00:00:00Z');
  const end=new Date(getSessionDate()+'T00:00:00Z');
  if(!isFinite(start.getTime())||!isFinite(end.getTime())) return null;
  return Math.max(0,Math.round((end-start)/86400000));
}

function getOpenPositionDaysHeld(sym,liveQty){
  const qty=Math.max(0,Number(liveQty)||0);
  const lots=(TRADEBOOK_STATS?.openPositionLotsMap?.[sym]||[])
    .filter(l=>Number(l.qty)>0&&l.date)
    .map(l=>({qty:Number(l.qty),date:l.date}))
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  if(!lots.length||qty<=0) return null;

  const recordedQty=lots.reduce((s,l)=>s+l.qty,0);
  let soldAfterTradebook=Math.max(0,recordedQty-qty);
  let agedQty=0, weightedDays=0;
  lots.forEach(lot=>{
    const removed=Math.min(soldAfterTradebook,lot.qty);
    soldAfterTradebook-=removed;
    const remaining=lot.qty-removed;
    const days=calendarDaysHeld(lot.date);
    if(remaining>0&&days!=null){
      agedQty+=remaining;
      weightedDays+=remaining*days;
    }
  });
  // Quantity above the stored open lots is a newer live top-up and contributes age zero.
  const denominator=agedQty+Math.max(0,qty-agedQty);
  return denominator>0?Math.round(weightedDays/denominator):null;
}


let _allocMemo=null; // single-entry memo: renderTable and renderStatusBar share one pass
function getTurnoverAllocationCap(row){
  const turnover=Number(row?.turnover);
  return Number.isFinite(turnover)&&turnover>0?turnover*MAX_TURNOVER_PARTICIPATION:0;
}
function getRestingOrderMap(){
  const out={};
  if(!ORDERS_TODAY||!ORDERS_TODAY.length) return out;
  const today=(typeof getSessionDate==='function')?getSessionDate():null;
  for(const o of ORDERS_TODAY){
    if(!o||!o.symbol||!(o.pending>0)) continue;
    if(today&&normOrderDate(o.time)!==today) continue;
    const key=o.symbol, side=(o.type||'').toUpperCase()==='SELL'?'sell':'buy';
    const e=out[key]||(out[key]={sellQty:0,sellPrice:null,buyQty:0,buyPrice:null});
    if(side==='sell'){ e.sellQty+=o.pending; if(o.qty>0&&o.price>0) e.sellPrice=o.price; }
    else { e.buyQty+=o.pending; if(o.qty>0&&o.price>0) e.buyPrice=o.price; }
  }
  return out;
}
function getPositionFlowRead(rd){
  const tt=rd&&rd.current?(rd.todayTraj||rd.traj):null;
  return {tt,span:(rd&&tt&&!rd.todayTraj&&rd.sessions>0)?(' across '+rd.sessions+' sessions'):''};
}
function getPositionAction(sym,pos){
  const s=(Array.isArray(ALL)?ALL:[]).find(r=>normSym(r.symbol)===normSym(sym))||null;
  const qty=Number(pos&&pos.qty)||0;
  if(!(qty>0)) return null;
  const _rest=(typeof getRestingOrderMap==='function')?getRestingOrderMap()[normSym(sym)]:null;
  // v1210: the working order is NETTED OUT of the instruction, not merely mentioned in it. Telling
  // the owner to sell 92 when 57 are already on the offer asks for a double sale of 57 shares. The
  // recorded quantity keeps its v1207 meaning everywhere else; it is the ASK that shrinks.
  const _withResting=(a)=>{
    if(!a||!/^EXIT/.test(a.act)||!_rest||!(_rest.sellQty>0)) return a;
    const rq=Math.min(qty,_rest.sellQty);
    const rd2=getIntradayRead(sym);
    const proj=(rd2&&rd2.eod&&Number.isFinite(rd2.eod.close))?rd2.eod.close:null;
    const unreachable=(proj!=null&&_rest.sellPrice>0&&proj<_rest.sellPrice);
    const remain=Math.max(0,(Number(a.qty)||0)-rq);
    a.resting={qty:rq,price:_rest.sellPrice,unreachable};
    a.covered=!(remain>0);
    if(!a.covered&&a.act!=='EXIT ALL') a.act='EXIT '+remain;
    a.qty=a.covered?0:remain;
    a.why=a.why+' — '+rq+' of '+qty+' already resting on a sell'
      +(_rest.sellPrice>0?' worked at '+fmtINR(_rest.sellPrice):'')
      +(unreachable?', which this session projects to '+fmtINR(proj)+' and will not reach'
                   :', still live')
      +(a.covered?'; the whole ask is already on the offer, so there is nothing further to place'
                 :'; '+remain+' still to place');
    return a;
  };
  // EXECUTION, NOT DECISION. The projection may never decide WHETHER to exit - v1191 stands - but
  // the owner's question of 2026-08-21 (SPECTRUM reading EXIT ALL beside EoD +10.63%) is about the
  // PRICE, and leaving that to a column which argues with the instruction next to it IS the
  // contradiction. When this session's own projection sits above the live price the exit is WORKED
  // at that level instead of hit at market. Bounded by the row's own target, so a stop-out can
  // never be talked into a moonshot, and it expires with the session it was projected for.
  const _withExecution=(a)=>{
    if(!a||!/^EXIT/.test(a.act)||a.covered) return a;
    const rd2=getIntradayRead(sym);
    const t=(rd2&&rd2.current)?rd2.eod:null;   // resolved again: _withExecution is declared above rd
    const px=ltp;
    if(!t||!Number.isFinite(t.pct)||!(t.pct>0)||!Number.isFinite(t.close)||!(px>0)) return a;
    let level=tickPrice(t.close),capped=false;
    const av=Number(pos&&pos.avg)||0;
    if(s&&av>0){
      const pol=getRowExitPolicy(s,av);
      const tgt=av*(1+Number(pol.targetPct||0)/100);
      if(Number.isFinite(tgt)&&tgt>0&&level>tgt){ level=tgt; capped=true; }
    }
    if(!(level>px)) return a;
    a.execution={level,projPct:t.pct,barsLeft:t.barsLeft,capped,
      note:'Work this exit at '+fmtINR(level)+(capped?' (its own target)':'')
        +' rather than hitting the bid at '+fmtINR(px)+': this session projects +'+t.pct.toFixed(2)
        +'% over its remaining '+t.barsLeft+' bars. The projection expires with this session — '
        +'unfilled at the close, exit at market.'};
    a.why=a.why+' — but this session projects +'+t.pct.toFixed(2)+'% over its remaining '
      +t.barsLeft+' bars, so work the exit at '+fmtINR(level)
      +(capped?' (its own target, which the projection overshoots)':'')
      +' rather than hitting the bid at '+fmtINR(px)
      +'. The projection expires with this session: unfilled at the close, exit at market.';
    return a;
  };
  const _exit=(a)=>_withExecution(_withResting(a));
  const avg=Number(pos?.avg);
  const ltp=(()=>{
    const scan=Number(s&&s.price);
    if(scan>0) return scan;
    const p2=Number(pos&&pos.ltp);
    return p2>0?p2:0;
  })();
  // THE TAPE IS READ FIRST, WHATEVER DECIDES. A stop-driven exit used to say only "stop breached"
  // and the tape lived in a tooltip built from another window - which is how one row could carry
  // three stories. The boundary check still has FIRST authority (a blown stop is not a matter of
  // opinion); it simply no longer speaks alone.
  const rd=getIntradayRead(sym);
  const {tt,span}=getPositionFlowRead(rd);
  const _proj=(rd&&rd.current)?rd.eod:null;
  const _projNote=(!_proj||!Number.isFinite(_proj.pct))
    ?((rd&&rd.current&&rd.todayTraj&&rd.todayTraj.pressureConverting===false)
        ?'; this session has no close projection - its imbalance is being absorbed rather than converted'
        :'')
    :('; this session projects '+(_proj.pct>=0?'+':'')+_proj.pct.toFixed(2)+'% into the close'
       +(Number.isFinite(_proj.close)?' ('+fmtINR(_proj.close)+')':''));
  const _tapeNote=tt
    ?('; today\u2019s tape is net '+(tt.cvdPct>=0?'+':'')+(100*tt.cvdPct).toFixed(0)+'% of everything traded'
      +(Number.isFinite(tt.costRatio)?' at a cost ratio of '+tt.costRatio.toFixed(2)
        +' against the day\u2019s median '+getIntradayThinCut().toFixed(2):'')+span+_projNote)
    :'; no 5-minute read for this session yet';

  if(s&&avg>0&&ltp>0){
    const policy=getRowExitPolicy(s,avg);
    const target=avg*(1+Number(policy.targetPct||0)/100),stop=avg*(1-Number(policy.stopPct||0)/100);
    if(target>avg&&ltp>=target)return _exit({act:'EXIT ALL',qty,tone:'green',
      why:`target reached at ${fmtINR(target)}`+_tapeNote});
    if(stop>0&&ltp<=stop)return _exit({act:'EXIT ALL',qty,tone:'red',
      why:`stop breached at ${fmtINR(stop)}`+_tapeNote});
  }

  // NO READ IS NOT A HOLD. Saying "hold" on no evidence is the thing this panel was doing wrong in
  // a different costume. v1171 fetches held names automatically, so this clears itself.
  if(!tt) return {act:'NEEDS DATA',qty:0,tone:'grey',
    why:rd&&!rd.current?('last read was '+rd.on+', not this session'):'no 5-minute read for this session yet'};

  const sold=tt.cvdPct<0;
  const thinCut=getIntradayThinCut();
  const thin=Number.isFinite(tt.costRatio)&&tt.costRatio>0&&tt.costRatio<thinCut;
  const shares=n=>Math.round(n).toLocaleString('en-IN');

  // BOTH readings against it - supply is arriving AND nothing is holding it up.
  if(sold&&thin) return _exit({act:'EXIT ALL',qty,tone:'red',
    why:'sold into all session (net '+(100*tt.cvdPct).toFixed(0)+'%) and 1% down costs only '
      +shares(tt.dnCost)+' shares against '+shares(tt.upCost)+' up'+span});
  // ONE against it - reduce, do not abandon.
  if(sold||thin){
    const half=Math.max(1,Math.floor(qty/2));
    return _exit({act:'EXIT '+half,qty:half,tone:'red',
      why:(sold?('net selling this session ('+(100*tt.cvdPct).toFixed(0)+'% of everything traded), but demand still costs more to move')
              :('nothing holding it up - 1% down costs '+shares(tt.dnCost)+' shares against '+shares(tt.upCost)
                 +' up (ratio '+tt.costRatio.toFixed(2)+' against the day’s own median '+thinCut.toFixed(2)
                 +'), though flow is still net positive'))+span});
  }
  // BOTH readings for it, and the tape is still pushing - size the add from the cushion so a top-up
  // can never turn a position in profit into a losing one (v1070).
  const pressing=Number.isFinite(tt.pressurePct)&&tt.pressurePct>0;
  const reviewDays=getEffectiveReviewDays(),daysHeld=getOpenPositionDaysHeld(sym,qty);
  if(reviewDays>0&&daysHeld!=null&&daysHeld>=reviewDays&&!pressing){
    return _exit({act:'EXIT ALL',qty,tone:'red',
      why:`held ${daysHeld}d against the learned ${reviewDays}d review horizon, with no unspent buying pressure`+_projNote});
  }
  if(pressing&&s){
    try{
      const buyP=getBuyPrice(s);
      const cushion=getHeldTopUpNotionalCap(s,buyP);
      let cap=cushion;
      if(!Number.isFinite(cap)){
        cap=(typeof rowAchievableNotional==='function')?rowAchievableNotional(s):0;
      }
      const add=(Number.isFinite(cap)&&cap>0&&buyP>0)?Math.floor(cap/buyP):0;
      if(add>0) return {act:'ADD '+add,qty:add,tone:'green',
        why:'bought all session (net +'+(100*tt.cvdPct).toFixed(0)+'%), 1% up costs '+shares(tt.upCost)
          +' shares against '+shares(tt.dnCost)+' down, and '+tt.pressurePct.toFixed(2)+'% of buying is still unspent'+span+_projNote};
    }catch(e){}
  }
  return {act:'HOLD',qty:0,tone:'amber',
    why:'demand still costs more to move than supply (net +'+(100*tt.cvdPct).toFixed(0)+'%'
      +(Number.isFinite(tt.costRatio)?', ratio '+tt.costRatio.toFixed(2):'')+')'+span+_projNote};
}
function getHeldTopUpNotionalCap(s,buyP,heldMap=null){
  const held=(heldMap||getHeldPositionMap())[s.symbol];
  if(!held||!(held.qty>0)) return Infinity;      // not held: normal rails only
  const avg=Number(held.avg),price=Number(buyP);
  if(!(avg>0)||!(price>0)) return Infinity;      // unknown cost basis: do not invent a cap
  if(price<=avg) return Infinity;                // underwater: allow the maximum the rails permit
  const stopFrac=getRowStopDistancePct(s)/100;
  if(!(stopFrac>0)) return Infinity;
  const stopPrice=price*(1-stopFrac);
  if(avg>=stopPrice) return 0;                   // no cushion left
  return Math.max(0,held.qty*(stopPrice-avg)/(price*stopFrac)*price);
}
function getAllocationPassContext(){
  return {capital:getEffectiveCapital(),maxAlloc:getEffectiveMaxAlloc(),
          riskPerTrade:getEffectiveRiskPerTrade(),
          heldMap:getHeldPositionMap(),active:getActiveTargetInfo()};
}
// `ctx` carries the pass-constants (capital, max allocation, held map, target anchor) so a caller
// scanning the whole universe resolves them ONCE — see getAllocationPassContext(). Called without
// one it resolves them itself, which is correct but ~4ms per row.
function getAllocationBlockReason(s,ctx=null){
  const c=ctx||getAllocationPassContext();
  if(!(c.capital>0)) return null;         // no capital known: nothing to judge with, never filter
  const buyP=getBuyPrice(s);
  if(!(buyP>0)) return null;              // no price: the scorer already handles this elsewhere
  const turnoverCap=getTurnoverAllocationCap(s);
  if(!(turnoverCap>0)) return 'no daily turnover — market-impact safety cannot be verified';
  const topUpCap=getHeldTopUpNotionalCap(s,buyP,c.heldMap);
  if(!(topUpCap>0)) return 'already held at a profit with no cushion — an add would put the blended position at a loss on its own stop';
  const riskCap=riskNotionalCap(s,c.riskPerTrade);
  const rail=Math.min(c.maxAlloc>0?c.maxAlloc:c.capital,turnoverCap,topUpCap,riskCap);
  if(rail<buyP) return `allocation rails (${fmtINR(rail)}) are below one share at ${fmtINR(buyP)}`;
  const policy=getRowExitPolicy(s,buyP,c.active);
  if(policy&&policy.bandLimited) return `only ${policy.bandRunwayPct}% left to the ${policy.bandPct}% upper circuit (₹${policy.ucPrice}) — the ${policy.basePct}% target cannot be reached inside today's band`;
  if(policy&&policy.viable===false) return policy.capacityPct!=null
    ? `stock capacity ${policy.capacityPct.toFixed(2)}% cannot clear the ${policy.minGrossPct?.toFixed(2)??'—'}% cost + net hurdle`
    : 'no viable target after costs';
  const floorRs=getDesiredNetRupees();
  if(floorRs>0){
    const ec=getRowRupeeEconomics(s,rowAchievableNotional(s,c),policy,c);
    if(ec.qty>0&&ec.netRs<floorRs)
      return `nets only ${fmtINR(ec.netRs)} on the ${fmtINR(ec.notional)} this stock allows — below the ${fmtINR(floorRs)} minimum for a trade worth taking`;
  }
  return null;
}
function computeAlloc(capital, selList){
  if(!capital||!selList.length) return {};
  const maxAllocV=getEffectiveMaxAlloc(); // typed value, else capital ÷ average entry-day positions
  const targetAnchor=getEffectiveTgtPct();
  // Held qty/avg are part of the key (v1070): the top-up cap depends on them, so a fill that
  // changes the position must invalidate the memo or the next basket would reuse a stale cap.
  const heldMap=getHeldPositionMap();
  const riskPerTrade=getEffectiveRiskPerTrade();
  // slPct joins the key with atr: both feed getRowStopDistancePct, which now drives the WEIGHT and
  // not just the displayed stop, so a change in either must invalidate the memo.
  const memoKey=capital+'|'+maxAllocV+'|'+targetAnchor+'|'+riskPerTrade+'|'+selList.map(s=>{
    const h=heldMap[s.symbol];
    return s.symbol+':'+s.price+':'+s.rocketScore+':'+s.atr+':'+s.slPct+':'+s.rangePct+':'+s.turnover+':'+(h?h.qty+'@'+h.avg:'-');
  }).join(',');
  if(_allocMemo?.key===memoKey) return _allocMemo.val;
  const cap=maxAllocV>0?maxAllocV:capital;
  const spendableCapital=Math.max(0,capital-BASKET_CASH_RESERVE_RS);
  const buyDebit=(buyP,qty)=>qty>0?(buyP*qty)+calcZerodhaCharges(buyP,qty,false,false,false):0;
  const affordableQty=(budget,buyP,maxNotional=Infinity)=>{
    if(!(budget>0)||!(buyP>0)) return 0;
    let qty=Math.min(Math.floor(budget/buyP),Math.floor(maxNotional/buyP));
    while(qty>0&&buyDebit(buyP,qty)>budget+0.001) qty--;
    return qty;
  };
  function evalNet(s,buyP,qty){
    const policy=getRowExitPolicy(s,buyP);
    const tgtPct=policy.targetPct;
    if(!policy.viable) return {ok:false,rejected:true,reason:`stock capacity ${policy.capacityPct?.toFixed(2)??'—'}% is below the ${policy.minGrossPct?.toFixed(2)??'—'}% cost + net hurdle`,policy};
    if(tgtPct===null||tgtPct<=0) return {ok:true,skip:true,policy};
    const sellP=buyP*(1+tgtPct/100);
    const buyChg=calcZerodhaCharges(buyP,qty,false);
    const sellChg=calcZerodhaCharges(sellP,qty,true);
    const charges=buyChg+sellChg;
    return {ok:true,expectedNet:qty*buyP*(tgtPct/100)-charges,charges,tgtPct,policy};
  }

  const rawScore=s=>Math.max(0,Number(s.rocketScore)||0);
  const riskWeight=s=>{
    const sc=rawScore(s);
    if(!(sc>0)) return 0;
    const stop=getRowStopDistancePct(s);          // already clamped to SL_MIN_PCT..SL_MAX_PCT
    return stop>0?sc/stop:0;
  };
  const totalRiskWeight=selList.reduce((sum,s)=>sum+riskWeight(s),0)||1;
  // Residual redistribution (pass 2) still walks by CONVICTION, not by weight: the spare rupee
  // should go to the best setup. Risk normalisation governs the size of the slice, not its priority.
  const sortedSel=[...selList].sort((a,b)=>rawScore(b)-rawScore(a));
  const allocMap={},limits={},railLimits={},limitReasons={};

  for(const s of sortedSel){
    const buyP=getBuyPrice(s);
    if(!(buyP>0)) continue;
    const turnoverCap=getTurnoverAllocationCap(s);
    if(!(turnoverCap>0)){
      allocMap[s.symbol]={alloc:0,debit:0,qty:0,buyPrice:buyP,rejected:true,
        reason:'missing daily turnover; market-impact safety cannot be verified',liquidityCap:0};
      continue;
    }
    const scoreLimit=spendableCapital*(riskWeight(s)/totalRiskWeight);
    const topUpCap=getHeldTopUpNotionalCap(s,buyP,heldMap); // Infinity unless held and in profit
    const riskCap=riskNotionalCap(s,riskPerTrade);          // Infinity when no risk budget is set
    const railLimit=Math.min(cap,turnoverCap,topUpCap,riskCap);   // every rail EXCEPT the score share
    const rowLimit=Math.min(scoreLimit,railLimit);
    const limitReason=allocLimitReason({score:scoreLimit,max:cap,turnover:turnoverCap,topUp:topUpCap,risk:riskCap});
    railLimits[s.symbol]=railLimit;
    limits[s.symbol]=rowLimit;
    limitReasons[s.symbol]=limitReason;
    const qty=affordableQty(rowLimit,buyP,rowLimit);
    if(qty<=0) continue;
    const ev=evalNet(s,buyP,qty);
    if(ev.rejected){
      allocMap[s.symbol]={alloc:0,debit:0,qty:0,buyPrice:buyP,rejected:true,reason:ev.reason,
        stopDistancePct:ev.policy.stopPct,tgtPct:ev.policy.targetPct,exitPolicy:ev.policy,liquidityCap:turnoverCap,limitReason};
      continue;
    }
    allocMap[s.symbol]={alloc:qty*buyP,debit:buyDebit(buyP,qty),buyCharges:calcZerodhaCharges(buyP,qty,false,false,false),qty,buyPrice:buyP,
      limit:rowLimit,stopDistancePct:ev.policy.stopPct,expectedNet:ev.expectedNet,charges:ev.charges,tgtPct:ev.tgtPct,exitPolicy:ev.policy,liquidityCap:turnoverCap,limitReason};
  }

  let deployed=Object.values(allocMap).reduce((sum,am)=>sum+am.debit,0);
  let residual=spendableCapital-deployed;
  let progress=true;
  while(residual>0&&progress){
    progress=false;
    for(const s of sortedSel){
      const rowLimit=limits[s.symbol]||0;
      let am=allocMap[s.symbol];
      if(am?.rejected) continue;
      if(!am){
        const buyP=getBuyPrice(s);
        const railCeil=railLimits[s.symbol]||0;
        if(!(buyP>0)) continue;
        if(rowLimit<buyP){
          if(railCeil<buyP) continue;                 // a real rail, not rounding — leave it alone
          limits[s.symbol]=Math.max(rowLimit,buyP);   // one share, then the normal growth check binds
        }
        if(buyDebit(buyP,1)>residual+0.001) continue;
        const qty=1,ev=evalNet(s,buyP,qty);
        if(ev.rejected){
          allocMap[s.symbol]={alloc:0,debit:0,qty:0,buyPrice:buyP,rejected:true,reason:ev.reason,
            stopDistancePct:ev.policy.stopPct,tgtPct:ev.policy.targetPct,exitPolicy:ev.policy,liquidityCap:getTurnoverAllocationCap(s),limitReason:limitReasons[s.symbol]};
          continue;
        }
        allocMap[s.symbol]={alloc:qty*buyP,debit:buyDebit(buyP,qty),buyCharges:calcZerodhaCharges(buyP,qty,false,false,false),qty,buyPrice:buyP,
          limit:rowLimit,stopDistancePct:ev.policy.stopPct,expectedNet:ev.expectedNet,charges:ev.charges,tgtPct:ev.tgtPct,exitPolicy:ev.policy,liquidityCap:getTurnoverAllocationCap(s),limitReason:limitReasons[s.symbol]};
        am=allocMap[s.symbol];
        residual-=am.debit; deployed+=am.debit; progress=true;
      }
      const buyP=am.buyPrice;
      const nextDebit=buyDebit(buyP,am.qty+1),incremental=nextDebit-am.debit;
      if(incremental>residual+0.001||am.alloc+buyP>(limits[s.symbol]??am.limit)+0.5) continue;
      am.qty++; am.alloc+=buyP; am.debit=nextDebit; am.buyCharges=calcZerodhaCharges(buyP,am.qty,false,false,false);
      const ev=evalNet(s,buyP,am.qty);
      if(!ev.skip){am.expectedNet=ev.expectedNet;am.charges=ev.charges;am.tgtPct=ev.tgtPct;}
      residual-=incremental; deployed+=incremental; progress=true;
    }
  }
  // riskRs is stamped ONCE here, after pass 2 has finished growing positions, so it can never
  // describe a stale quantity. It is the rupees this position loses if its own stop is hit —
  // the number the Risk ₹/trade budget caps, and the one surfaced in the Alloc cell.
  Object.values(allocMap).forEach(am=>{
    delete am.limit;
    am.riskRs=rowRiskRupees(am.alloc,am.stopDistancePct);
  });
  for(const s of sortedSel){
    if(allocMap[s.symbol]) continue;
    const buyP=getBuyPrice(s);
    const railCeil=railLimits[s.symbol]||0;
    allocMap[s.symbol]={alloc:0,debit:0,qty:0,buyPrice:buyP,rejected:true,liquidityCap:getTurnoverAllocationCap(s),
      reason:railCeil>0&&buyP>0&&railCeil<buyP
        ? `one share costs ${fmtINR(buyP)} but this stock's rails allow only ${fmtINR(railCeil)}`
        : `capital exhausted before this row — one share costs ${fmtINR(buyP)} and the basket was already fully deployed`};
  }
  _allocMemo={key:memoKey,val:allocMap};
  return allocMap;
}
function allocationSubline(am,unitLabel='shares'){
  const unitShort=unitLabel==='shares'?'sh':(' '+unitLabel);
  // v1092: every allocation now states what it RISKS, not just what it costs. This number was
  // always determined (alloc × the row's own stop) — it was simply never shown, which is why the
  // Risk ₹/trade budget is an override on a visible default rather than a number typed into a vacuum.
  const riskTip=am?.riskRs>0
    ? ` Risks ${fmtINR(am.riskRs)} if its ${Number(am.stopDistancePct).toFixed(2)}% stop is hit.`
    : '';
  // v1125: and what it MAKES. Two rows can carry the identical target percentage and return 26x
  // different money once the turnover rail and whole-share rounding have had their say — measured on
  // the release board, where every top-60 row showed 3.45% and netted between ₹91 and ₹2,365.
  const netTip=Number.isFinite(am?.expectedNet)
    ? ` Nets ${fmtINR(am.expectedNet)} after all charges if its ${Number(am.tgtPct).toFixed(2)}% target fills.`
    : '';
  const netStr=Number.isFinite(am?.expectedNet)
    ? ` · <b style="color:var(--green)">+${fmtINR(am.expectedNet)}</b>`
    : '';
  if(am?.limitReason==='risk cap'){
    return `<div style="font-size:11px;color:var(--cyan);margin-top:1px" title="Sized down to fit the Risk ₹/trade budget at this stock's own ${Number(am.stopDistancePct).toFixed(2)}% stop.${riskTip}${netTip}">risk cap · ${am.qty}${unitShort} · r${fmtINR(am.riskRs)}${netStr}</div>`;
  }
  if(am?.limitReason==='top-up average cost'){
    // v1070: an add to a stock already in profit, sized so the blended average stays below the
    // new entry's own stop. A zero here means the existing average has no cushion left.
    return `<div style="font-size:11px;color:#f472b6;margin-top:1px" title="You already hold this at a profit. The add is sized so the blended average cost stays below this entry's own stop price — if the stop is hit, the combined position is still not at a loss.${riskTip}${netTip}">📌 capped · ${am.qty}${unitShort}${netStr}</div>`;
  }
  if(am?.limitReason==='turnover'){
    return `<div style="font-size:11px;color:var(--amber);margin-top:1px" title="Market-impact rail: allocation is capped at 0.10% of daily turnover (${fmtINR(am.liquidityCap)}), then rounded down to whole ${unitLabel}.${riskTip}${netTip}">turnover · ${am.qty}${unitShort}${netStr}</div>`;
  }
  const sizedBy=am?.limitReason==='risk weight'
    ? `Sized by Radar score ÷ this stock's ${Number(am.stopDistancePct).toFixed(2)}% stop, so equally-scored names carry equal rupee risk.`
    : 'Capped by the Max Allocation rail.';
  return `<div style="font-size:11px;color:var(--t3);margin-top:1px;max-width:190px;overflow:hidden;text-overflow:ellipsis" title="${sizedBy}${riskTip}${netTip}">${am.qty}${unitShort}${am?.riskRs>0?` · r${fmtINR(am.riskRs)}`:''}${netStr}</div>`;
}
function recomputeAlloc(){
  const capital=getEffectiveCapital();
  if(!capital){document.querySelectorAll('.alloc-cell').forEach(el=>el.innerHTML='<span style="color:var(--t3);font-size:13px">—</span>');return;}
  const selList=FILT.filter(s=>SELECTED.has(s.symbol));
  const allocMap=computeAlloc(capital, selList);
  const unitLabel='shares';
  document.querySelectorAll('.alloc-cell').forEach(el=>{
    const sym=el.dataset.sym;
    if(!SELECTED.has(sym)){el.innerHTML='<span style="color:var(--t3);font-size:13px">—</span>';return;}
    const am=allocMap[sym];
    if(!am){el.innerHTML='<span style="color:var(--red);font-size:12px" title="The score, Max Allocation, or 0.10% turnover cap is below one share.">cap below 1 share</span>';return;}
    if(am.rejected){
      // v1125: the label must match the CAUSE. "no viable target" was printed for every rejection,
      // including a row that simply ran out of capital — a different fact with a different remedy.
      const why=String(am.reason||'');
      const lbl=/capital exhausted/.test(why)?'capital exhausted'
        :/rails allow only|one share costs/.test(why)?'cap below 1 share'
        :/minimum for a trade worth taking/.test(why)?'too little money in it'
        :'no viable target';
      el.innerHTML=`<span style="color:var(--red);font-size:12px" title="${escHtml(why||'Stock-specific target cannot clear costs and desired net.')}">${lbl}</span>`;return;}
    el.innerHTML=`<span style="color:var(--amber);font-weight:700;font-family:'DM Mono',monospace;font-size:14px">${fmtINR(am.alloc)}</span>${allocationSubline(am,unitLabel)}`;
  });
  renderBasketSummary();
}
function renderBasketBtn(){
  const selList=FILT.filter(s=>SELECTED.has(s.symbol));
  const buyCount=selList.length;
  const buyBtn=document.getElementById('basketBtn');
  if(buyBtn){
    const cntSpan=document.getElementById('basketCount');
    if(cntSpan)cntSpan.textContent=buyCount>0?`(${buyCount})`:'';
    buyBtn.disabled=buyCount===0;
    buyBtn.title=buyCount===0
      ? 'Select at least one stock to export a Zerodha basket order.'
      : 'Export selected stocks as Zerodha basket order';
  }
}
function renderBasketSummary(){
  const capital=getEffectiveCapital();
  const selList=FILT.filter(s=>SELECTED.has(s.symbol));
  const sb=document.getElementById('statusBar');
  // update status bar — triggered via renderStatusBar, so leave it
}

function renderHead(){
  COLS=getCols(); // refresh in case ENGINE_DATA changed
  const exportable=FILT.filter(s=>s.basketEligible!==false&&passesIntradayValidation(s));
  const allChecked=exportable.length>0&&exportable.every(s=>SELECTED.has(s.symbol));
  const someChecked=exportable.some(s=>SELECTED.has(s.symbol));
  const timingBlocked=false; // the clock never disables selection (owner, v1068)
  document.getElementById('tHead').innerHTML='<tr>'+COLS.map(c=>{
    if(c.key==='chk'){
      return`<th data-key="chk" style="width:32px;text-align:center;padding:8px 6px">
        <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
          <input type="checkbox" id="chk-all" ${allChecked?'checked':''} ${timingBlocked?'disabled':''} title="${timingBlocked?escHtml(CURRENT_TRADE_TIMING.reason):'Select / deselect all for the basket export'}"
            style="width:14px;height:14px;accent-color:var(--amber);cursor:${timingBlocked?'not-allowed':'pointer'}"
            onchange="toggleSelectAll(this.checked)">
          <span style="font-size:11px;color:var(--t3);letter-spacing:.3px;font-weight:700;text-transform:uppercase">Export</span>
        </div>
      </th>`;
    }
    const arr=c.key===SCOL?(SDIR===-1?'▼':'▲'):'';
    return`<th data-key="${c.key}" class="${c.key===SCOL?'sorted':''}" ${c.s?`onclick="doSort('${c.key}')"`:''}>${c.label}<span class="sa">${arr}</span></th>`;
  }).join('')+'</tr>';
  // Drag-to-reorder columns; the saved order re-enters through getCols() (v536).
  attachColDrag(document.getElementById('tHead').parentElement,'main-rankings',()=>{COLS=getCols();renderHead();renderTable();});
  // fix indeterminate state
  const sa=document.getElementById('chk-all');
  if(sa&&!allChecked&&someChecked)sa.indeterminate=true;
}

function fmt(v,d=2){return v===null||v===undefined||isNaN(v)?'—':Number(v).toFixed(d);}
const INR_2={minimumFractionDigits:2,maximumFractionDigits:2};
// One cached Intl instance. Constructing a formatter per call is what made the
// full-universe table render slow once pagination was removed (v530); output is
// byte-identical to Number(v).toLocaleString('en-IN',INR_2).
const INR_2_FMT=new Intl.NumberFormat('en-IN',INR_2);
const inr2=v=>INR_2_FMT.format(Number(v));
function fmtINR(v){return v===null||v===undefined||isNaN(v)?'—':'₹'+inr2(v);}
function fmtSignedINR(v){return v===null||v===undefined||isNaN(v)?'—':(v>=0?'+':'−')+'₹'+inr2(Math.abs(Number(v)));}
function fmtNegINR(v){return v>0?'−₹'+inr2(v):'—';}
function fV(v){if(v===null||isNaN(v))return'—';if(v>=1e7)return(v/1e7).toFixed(2)+'Cr';if(v>=1e5)return(v/1e5).toFixed(2)+'L';if(v>=1e3)return(v/1e3).toFixed(2)+'K';return inr2(v);}
function fDel(v){
  if(v===null||v===undefined||isNaN(v))return'—';
  const c=v>=60?'var(--green)':v>=40?'var(--cyan)':v>=25?'var(--orange)':'var(--red)';
  return`<span style="color:${c};font-weight:600">${v.toFixed(1)}%</span>`;
}
function fPerf(v){
  if(v===null||v===undefined||isNaN(v))return'—';
  const c=v>0?'var(--green)':v<0?'var(--red)':'var(--t3)';
  return`<span style="color:${c};font-weight:600">${v>0?'+':''}${v.toFixed(1)}%</span>`;
}

function radarRiskPill(risk){
  const cls=risk==='Low'?'pill-green':risk==='Medium'?'pill-amber':'pill-red';
  return `<span class="info-pill ${cls}" style="padding:2px 8px;font-size:12px">${escHtml(risk||'—')}</span>`;
}
// v555 market-cycle stage pill. Colour = quality of the stage: accumulation/re-accumulation green,
// breakout/second-leg cyan, event/profit-booking amber.
function radarStagePill(r){
  if(!r||!r.stage) return '';
  const c={1:'var(--green)',5:'var(--green)',2:'var(--cyan)',6:'var(--cyan)',3:'var(--amber)',4:'var(--amber)'}[r.stage]||'var(--t3)';
  const t={1:'Silent accumulation — quiet strength before a move (a higher-quality candidate)',5:'Re-accumulation — quiet, holding above its 50-day MA after digesting a result',2:'Initial breakout — fresh high-volume move through resistance',6:'Second leg — breakout with an already-established trend, the event behind it',3:'Event day — today’s move may be event-driven and less pattern-reliable',4:'Profit-booking — digesting a recent result'+(r.daysSinceEarnings!=null?` (${r.daysSinceEarnings}d since results)`:'')}[r.stage]||'';
  return `<span style="font-size:12px;font-weight:700;border-radius:4px;padding:1px 5px;color:${c};border:1px solid ${c};white-space:nowrap;cursor:help" title="${escHtml(t)}">${escHtml(r.stageLabel||'')}</span>`;
}
function radarTriggerPill(r){
  const n=(r?.modelTriggers||[]).length;
  if(!n)return '';
  const title=(r.modelTriggers||[]).map(t=>`${t.label} → ${t.action}`).join(' · ');
  return `<span style="font-size:12px;font-weight:800;border-radius:4px;padding:1px 5px;color:var(--green);border:1px solid var(--green);white-space:nowrap;cursor:help" title="${escHtml(title)}">⚡ ${n}</span>`;
}
function radarSeriesBandPill(s){
  const ok=s.basketEligible!==false;
  const band=s.band!=null?s.band+'%':'No band';
  const title=ok?'Active EQ security; eligible for the Zerodha basket.':'Ineligible for the basket: '+escHtml((s.gateReasons||[]).slice(0,3).join(', ')||'exchange eligibility');
  return `<span class="info-pill ${ok?'pill-green':'pill-red'}" style="padding:2px 8px;font-size:12px" title="${title}">${escHtml(s.series||'—')} · ${band}</span>`;
}
function intradayVerdictFace(v,has){
  // v1207: `unverified` is its own face. It must not read as confirmed (nothing has checked it) and
  // must not read as rejected (nothing has condemned it) - the current session cannot speak yet.
  return v==='stale'?'\u29d6':v==='confirmed'?'\u2713':v==='rejected'?'\u2717'
    :v==='unverified'?'\u25f4':(has?'\u2022':'5m');
}
function intradayVerdictColor(v,has,sel){
  return sel?'var(--amber)'
    :v==='stale'?'var(--t3)'
    :v==='confirmed'?'var(--green)'
    :v==='rejected'?'var(--red)'
    :v==='unverified'?'var(--amber)'
    :has?'var(--cyan)':'var(--t3)';
}
function intradayRowButton(s){
  const sym=normSym(String(s&&s.symbol||''));
  if(!sym) return '';
  const sel=INTRADAY_TARGET===sym;
  const has=!!INTRADAY_BARS[sym];
  // v1146 (owner): the verdict goes ON THE ROW. A growing BUY/SKIP list above the table pushed the
  // table itself down the page, which is the same complaint as the horizontal scrollbar - the
  // recommendations are the thing, and nothing may crowd them out.
  const v=has?s.intradayVerdict:null;
  const rd=has?getIntradayRead(sym):null;
  const face=v==='stale'?intradayVerdictFace(v,has):(v?intradayVerdictFace(v,has):'5m');
  const col=intradayVerdictColor(v,has,sel);
  const age=rd?(rd.ageMin<60?rd.ageMin+' min old':(rd.ageMin/60).toFixed(1)+' h old'):'';
  const prov=rd?`
${rd.bars} bars from ${rd.on}, latest ${new Date(rd.asOf).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})} (${age})`
    +`${rd.holes?` · ${rd.holes} five-minute bar${rd.holes>1?'s':''} missing inside the session`:''}`:'';
  const tip=v==='stale'
    ? `${sym}: CHECKED ON A PREVIOUS SESSION — not evidence about today.`
      +`${prov}
It counts as unchecked and does not move the ranking. Click to refetch.`
    : v
      ? `${sym}: ${v==='confirmed'?'STILL CLEARS THE BAR — buy':'NO LONGER CLEARS THE BAR — skip'}`
        +`
${s.intradayWhy||''}${prov}
Click to replace this data.`
      : has
        ? `${sym}: checked${rd&&rd.regime?' — '+rd.regime:''}.${prov} Click to replace.`
        : `Check ${sym}: paste its 5-minute chart table and see whether it still clears the buy bar.`;
  return `<button type="button" onclick='event.stopPropagation();setIntradayTarget(${JSON.stringify(sym)})'`
    +` style="margin-right:6px;padding:0 4px;border:1px solid ${col};border-radius:3px;`
    +`background:${sel?'rgba(245,158,11,.12)':v==='rejected'?'rgba(239,68,68,.10)':v==='confirmed'?'rgba(34,197,94,.10)':'transparent'};`
    +`color:${col};font-size:10px;line-height:14px;cursor:pointer;vertical-align:middle;`
    +`opacity:${v==='stale'?'.55':'1'};font-weight:${(v&&v!=='stale')?'700':'400'}"`
    +` title="${escHtml(tip)}">${face}</button>`;
}

function renderTable(){
  { const _ib=document.getElementById('intradayBar'); if(_ib) _ib.innerHTML=intradayPasteBarHtml(); }
  const capital=getEffectiveCapital();
  // Allocation only across SELECTED instruments
  const selList=FILT.filter(s=>SELECTED.has(s.symbol));
  const allocMap=computeAlloc(capital, selList);
  const unitLabel='shares';

  // Pagination restored in v534 (owner): 100 rows/page keeps the DOM small, which is
  // also what kept the full-universe render off the typing path.
  const start=(PG-1)*PGSZ,pg=FILT.slice(start,start+PGSZ);
  document.getElementById('tBody').innerHTML=pg.map(s=>{
    const isSelected=SELECTED.has(s.symbol);
    const am=allocMap[s.symbol];
    const exitPolicy=getRowExitPolicy(s,getBuyPrice(s));
    const exchangeEligible=s.basketEligible!==false;
    const validated=passesIntradayValidation(s);
    const canBuy=exchangeEligible&&validated;
    const checkTitle=!exchangeEligible?'Ineligible for the basket'
      :!validated?'Awaiting current 5-minute validation'
      :'Include in the Zerodha basket export';
    // Cells are keyed and joined in COLS order so they always match the (possibly
    // user-reordered) header (v536).
    const cellH={
      chk:`<td style="text-align:center"><input type="checkbox" ${isSelected?'checked':''} ${canBuy?'':'disabled'} style="width:14px;height:14px;accent-color:var(--amber);cursor:${canBuy?'pointer':'not-allowed'}" onclick="event.stopPropagation()" onchange="toggleStock('${s.symbol}',this.checked)" title="${checkTitle}"></td>`,
      rank:`<td style="font-family:'DM Mono',monospace;font-weight:800;color:var(--t1);text-align:right">${s.rank??'—'}</td>`,
      score:`<td>${radarScoreCell(s.score,'Relative same-day composite score (0-100 percentile, top-weighted). It is a ranking, not a probability.')}</td>`,
      // v1142: routed through symbolChartButton like every other table. This cell had built its own
      // TradingView link since v1070, so the "one symbol interaction everywhere" rule was true of the
      // panels and quietly false of the main table - which is why swapping to Zerodha missed it.
      symbol:`<td style="font-family:'Plus Jakarta Sans',sans-serif">${intradayRowButton(s)}${symbolChartButton(String(s.symbol),
        `<div style="font-weight:700;font-size:15px;color:var(--t1);max-width:170px;overflow:hidden;text-overflow:ellipsis">${escHtml(s.symbol)}${(()=>{const flags=s.meta?.flags||[];if(!flags.length)return '';return `<span style="font-size:12px;background:rgba(239,68,68,.15);color:var(--red);border-radius:4px;padding:1px 5px;margin-left:5px;font-weight:700;vertical-align:middle" title="NSE surveillance flags: ${escHtml(flags.join(' · '))}">⚠ ${flags.length}</span>`;})()}${s._held?`<span style="font-size:12px;background:rgba(244,114,182,.15);color:#f472b6;border-radius:4px;padding:1px 5px;margin-left:5px;font-weight:700;vertical-align:middle" title="You already hold this. Held stocks stay in the ranking (v1070) and can be recommended again — buying here ADDS to the existing position.">📌 held</span>`:''}</div><div style="font-size:11px;color:var(--t3);max-width:150px;overflow:hidden;text-overflow:ellipsis" title="${escHtml((s.name||'')+(s.setup?' · '+s.setup:''))}">${radarSeriesBandPill(s)} ${escHtml(s.setup||s.name||'')}</div>`)}</td>`,
      setup:`<td style="font-size:13px;color:var(--t2)">${escHtml(s.setup||'—')}${s.stage?' '+radarStagePill(s):''}${(s.modelTriggers||[]).length?' '+radarTriggerPill(s):''}</td>`,
      series:`<td>${radarSeriesBandPill(s)}</td>`,
      price:`<td style="white-space:nowrap">${fmtINR(s.price)}<span style="color:var(--t3)"> · </span><span style="font-size:12px">${fPerf(s.day??s.priceChange)}${s.corpAction?`<span title="Corporate action (${escHtml(s.corpAction)}) — mechanical ex-date move, neutralised in scoring" style="font-size:11px;color:var(--amber);margin-left:4px;cursor:help">⚑</span>`:''}</span></td>`,
      day:`<td>${fPerf(s.day??s.priceChange)}${s.corpAction?`<span title="Corporate action (${escHtml(s.corpAction)}) — mechanical ex-date move, neutralised in scoring" style="font-size:11px;color:var(--amber);margin-left:4px;cursor:help">⚑</span>`:''}</td>`,
      relvol:`<td style="white-space:nowrap">${s.relvol!=null&&isFinite(s.relvol)?Number(s.relvol).toFixed(2)+'×':'—'}<span style="color:var(--t3)"> · </span>${Number.isFinite(s.depthImbalance)?`<span style="color:${s.depthImbalance>0?'var(--green)':'var(--red)'};font-size:12px" title="Order book: ${Number.isFinite(s.depthPct)?'stronger than '+Math.round(s.depthPct*100)+'% of books':''}${s.depthLive?' · LIVE reading':' · pre-open, decayed by the session'}">${(s.depthImbalance>0?'+':'')+s.depthImbalance.toFixed(2)}</span>`:'<span style="color:var(--t3)">—</span>'}</td>`,
      // v1139: the order book, in the recommendation table rather than a list of its own. Muted em
      // dash when the stock has no book - absent is not bearish.
      turnover:`<td>${fV(s.turnover)}</td>`,
      predEod:`<td style="white-space:nowrap">${(()=>{
        const rd=getIntradayRead(s.symbol);
        if(!rd||!rd.current) return `<span style="color:var(--t3)" title="${escHtml(rd?('Last read was '+rd.on+', not this session.'):'Not checked on the 5-minute tape yet.')}">—</span>`;
        const t=rd.eod;
        if(!t) return `<span style="color:var(--t3)" title="${escHtml(
          rd.todayTraj&&rd.todayTraj.pressureConverting===false
          ?'No projection: this session\u2019s imbalance is being ABSORBED, not converted — its unspent pressure '
           +'points one way and its own price slope the other, so there is no honest close to quote.'
          :'No projection: the current session has under three bars, or carries no measurable unspent pressure yet.')}">—</span>`;
        return `<span style="color:${t.pct>=0?'var(--green)':'var(--red)'};font-weight:700" title="${escHtml(
          'Unspent pressure '+(t.pressurePct>=0?'+':'')+t.pressurePct.toFixed(2)+'% THIS SESSION, capped by what this stock can travel in the '
          +t.barsLeft+' bars left ('+t.avgMovePct.toFixed(3)+'% per '+t.stepMin+'-minute bar = '
          +(t.maxTravel!=null?t.maxTravel.toFixed(2):'?')+'%) and scaled to the '+Math.round(t.sessionSeen*100)
          +'% of the session already seen. Projected close '+fmtINR(t.close)+'. Arithmetic, not a forecast.')}">${
          (t.pct>=0?'+':'')+t.pct.toFixed(2)}%</span>`;
      })()}</td>`,
      // Pace is available only after the checked tape contains a completed recovery episode.
      avgMove:`<td style="white-space:nowrap">${(()=>{
        const rd=getIntradayRead(s.symbol);
        // v1206: confirmedPacePct is scoped to the LAST session in the file, so without this a
        // stale read prints yesterday's pace here - the exact fault v1205 fixed one panel down.
        if(rd&&!rd.current) return `<span style="color:var(--t3)" title="${escHtml('Last read was '+rd.on+', not this session.')}">—</span>`;
        if(!rd||!Number.isFinite(rd.confirmedPacePct)){
          const open=rd&&Number.isFinite(rd.currentPullbackPct)
            ?` Current unresolved pullback: ${rd.currentPullbackPct.toFixed(2)}%.`:'';
          return `<span style="color:var(--t3)" title="No pullback has yet been recovered with a new high today.${open}">—</span>`;
        }
        const tp=Number(exitPolicy&&exitPolicy.targetPct);
        return `<span title="Deepest of ${rd.confirmedPullbackCount} seller pullback${rd.confirmedPullbackCount===1?'':'s'} that buyers recovered with a new high today.${
          Number.isFinite(rd.currentPullbackPct)?' Current unresolved pullback is '+rd.currentPullbackPct.toFixed(2)+'% and cannot widen Pace.':''
        }${tp>0?' Target is '+tp.toFixed(2)+'%.':''}">${rd.confirmedPacePct.toFixed(2)}%</span>`;
      })()}</td>`,
      // v1144: TGT and SL merged. They are ONE decision - what you ask for against what you risk -
      // and the two columns were part of why the table needed a horizontal scrollbar, which the
      // owner has ruled out. Both numbers survive, with their full tooltips.
      tgt:`<td style="font-weight:700" title="${escHtml((exitPolicy.viable?`${exitPolicy.targetSource}; portfolio anchor ${exitPolicy.anchorPct?.toFixed(2)??'—'}%`:`Stock capacity ${exitPolicy.capacityPct?.toFixed(2)??'—'}% cannot clear the ${exitPolicy.minGrossPct?.toFixed(2)??'—'}% cost + net hurdle`)+' · '+exitPolicy.stopSource+(exitPolicy.rewardRisk!=null?` · reward:risk ${exitPolicy.rewardRisk.toFixed(2)}`+(exitPolicy.rewardRisk<1?' — BELOW 1.0: this stock risks more than it aims to make':''):''))}"><span style="color:${exitPolicy.viable?'var(--green)':'var(--red)'}">${exitPolicy.viable&&exitPolicy.targetPct!=null?'+'+exitPolicy.targetPct.toFixed(2)+'%':'—'}</span><span style="color:var(--t3)"> / </span><span style="color:var(--red)">−${exitPolicy.stopPct.toFixed(2)}%</span></td>`,
      alloc:`<td class="alloc-cell" data-sym="${s.symbol}">${(()=>{
        if(!am) return '<span style="color:var(--t3);font-size:13px">—</span>';
        if(am.rejected) return `<span style="color:var(--red);font-size:12px" title="${escHtml(am.reason||'Stock-specific target cannot clear costs and desired net.')}">no viable target</span>`;
        return `<span style="color:var(--amber);font-weight:700;font-family:'DM Mono',monospace;font-size:14px">${fmtINR(am.alloc)}</span>${allocationSubline(am,unitLabel)}`;
      })()}</td>`,
      risk:`<td>${radarRiskPill(s.risk)}</td>`
    };
    const cells=COLS.map(c=>cellH[c.key]||'<td></td>').join('');
    let _trStyle='cursor:pointer';
    if(isSelected) _trStyle+=';background:rgba(251,191,36,.04);outline:1px solid rgba(251,191,36,.12);outline-offset:-1px';
    return`<tr style="${_trStyle}" onclick="showRadarDetail('${s.symbol}')" title="Click for the full scoring breakdown">${cells}</tr>`;
  }).join('')||`<tr><td colspan="${COLS.length}"><div style="padding:48px 20px;text-align:center;color:var(--t3)">No stocks match the filters you selected.</div></td></tr>`;
  renderPgn();
  updateSelectAll();
}

function renderPgn(){
  const tot=FILT.length,tp=Math.ceil(tot/PGSZ),c=document.getElementById('pgn');
  if(!c) return;
  if(tp<=1){c.innerHTML='';return;}
  let h=`<button ${PG===1?'disabled':''} onclick="goP(${PG-1})">‹</button>`;
  let s=Math.max(1,PG-3),e=Math.min(tp,PG+3);
  if(s>1)h+=`<button onclick="goP(1)">1</button>`;if(s>2)h+=`<span class="pg-i">…</span>`;
  for(let i=s;i<=e;i++)h+=`<button class="${i===PG?'act':''}" onclick="goP(${i})">${i}</button>`;
  if(e<tp-1)h+=`<span class="pg-i">…</span>`;if(e<tp)h+=`<button onclick="goP(${tp})">${tp}</button>`;
  h+=`<button ${PG===tp?'disabled':''} onclick="goP(${PG+1})">›</button><span class="pg-i" style="margin-left:10px">${tot.toLocaleString()} stocks</span>`;
  c.innerHTML=h;
}
// Scroll to section with offset for sticky header (72px) + nav (44px)
function scrollToSection(id){
  const el=document.getElementById(id);
  if(!el) return;
  const y=el.getBoundingClientRect().top+window.pageYOffset-130;
  window.scrollTo({top:y,behavior:'smooth'});
}
function goP(p){PG=p;renderTable();scrollToSection('tHead');}
function doSort(col){if(SCOL===col)SDIR*=-1;else{SCOL=col;SDIR=['symbol','setup','series','risk'].includes(col)?1:-1;}applySort();PG=1;renderHead();renderTable();saveFilterState();}
function applySort(){
  const col=SCOL;
  FILT.sort((a,b)=>{
    const va=a[col],vb=b[col];
    if(va===null||va===undefined)return 1;if(vb===null||vb===undefined)return-1;
    if(typeof va==='string')return va.localeCompare(vb)*SDIR;return(va-vb)*SDIR;
  });
}
function toggleFilters(){
  const p=document.getElementById('ctrlsPanel');
  const a=document.getElementById('ctrlsArrow');
  if(!p) return;
  const collapsed=p.classList.toggle('collapsed');
  if(a) a.textContent=collapsed?'▶':'▼';
}
// The paste surface lives ON the recommendation table (owner: no second table, no separate box).
// Click a row's `5m` button, paste that stock's chart export, and the recommendations re-rank.
function setIntradayTarget(sym){
  INTRADAY_TARGET=normSym(sym||'');INTRADAY_RESULT=null;
  renderTable();
  // The check now lives on Open Positions too (v1148), so the panels have to follow the selection.
  try{renderRankingsPanels();}catch(e){}
  const el=document.getElementById('intradayBox');
  if(el){el.value='';el.focus();el.scrollIntoView({block:'nearest'});}
}
function onIntradayPaste(){
  const el=document.getElementById('intradayBox');
  if(!el) return;
  // A batch payload carries many stocks at once and names each one, so it
  // does not need a selected target. Try it first; fall back to the single-table paste.
  const batch=ingestKiteCandlePayload(el.value);
  if(batch){
    el.value='';
    INTRADAY_RESULT={ok:true,sym:batch.done.join(', '),bars:0,sessions:0,batch:batch};
    const st=getIntradayLoopState();
    INTRADAY_TARGET=st.need.length?normSym(st.need[0].symbol):'';
    renderTable();
    showToast('Read '+batch.done.length+' stock(s): '+batch.done.join(', ')
      +(batch.failed.length?(' · could not read '+batch.failed.join(', ')):''),6000,!batch.done.length);
    return;
  }
  const res=parseIntradayPaste(el.value,INTRADAY_TARGET);
  INTRADAY_RESULT=res;
  if(res.ok){
    const read=getIntradayRead(res.sym);
    INTRADAY_RESULT=Object.assign({},res,{read});
    el.value='';
    applyIntradayReorder(ALL);
    applyFilters();
    try{renderRankingsPanels();}catch(e){}
    // The loop: re-rank, then point at whatever is now in the top and still unchecked. When nothing
    // is left the list has SETTLED - every name at the top was checked and survived the check.
    const st=getIntradayLoopState();
    INTRADAY_TARGET=st.need.length?normSym(st.need[0].symbol):'';
    showToast(res.sym+': '+res.bars+' bars over '+res.sessions+' session'+(res.sessions>1?'s':'')
      +(res.live?' · LIVE book '+((res.live.imbalance>0?'+':'')+res.live.imbalance.toFixed(3)):'')
      +(read?(read.traj?' · '+read.regime.toUpperCase()+' · net flow '+(read.cvdPct*100).toFixed(1)+'% of volume'
                       :' · first 15m '+(read.first15Up?'UP':'DOWN')+' · path '+(read.efficiency*100).toFixed(0)+'% efficient'):''),4000);
  }else{
    showToast('Could not read that paste — '+res.why,4000,true);
  }
  renderTable();
}
function collapseFetchList(){
  LAST_FETCH_HIDDEN=!LAST_FETCH_HIDDEN;
  renderTable();
}
// Kept for the case the owner actually asked for at v1146 - throwing away a stock's data on purpose
// - but reachable only per stock, never as a wipe of everything gathered.
function forgetIntradayFor(sym){
  const k=normSym(sym||''); if(!k) return;
  delete INTRADAY_BARS[k];
  if(INTRADAY_TARGET===k) INTRADAY_TARGET='';
  const r=(Array.isArray(ALL)?ALL:[]).find(x=>normSym(x.symbol)===k);
  if(r){ r.intraday=null;r.intradayVerdict=null;r.intradayWhy=null;r.intradaySellingToday=false; }
  try{ applyIntradayReorder(ALL); }catch(e){}
  scheduleApplyFilters();renderTable();
}
const FETCH_MAX_PER_DAY=400;
let FETCH_LOG=[];
let FETCH_LOG_DATE=null;
function fetchBudgetLeft(){
  const now=Date.now();
  const day=getSessionDate();
  if(FETCH_LOG_DATE!==day){ FETCH_LOG=[]; FETCH_LOG_DATE=day; }
  return Math.max(0,FETCH_MAX_PER_DAY-FETCH_LOG.length);
}
let FIRST_INGEST_DONE=false;
const FETCH_TOP_RANK=5;      // owner: the live candidate set, kept fresh
function intradayFetchJobs(limit){
  const budget=fetchBudgetLeft();
  if(!(budget>0)) return {ok:false,why:'daily fetch budget spent'};

  const posMap=(()=>{try{
    return (typeof getCombinedOpenPositionMap==='function')?getCombinedOpenPositionMap():{};
  }catch(e){ return {}; }})();
  const rowOf=s=>(Array.isArray(ALL)?ALL:[]).find(r=>normSym(r.symbol)===normSym(s))||null;

  const members=[],seen=new Set();
  const add=(sym,held,pos,row)=>{
    const s=normSym(sym||''); if(!s||seen.has(s)) return;
    const t=KITE_TOKEN[s]||0; if(!(t>0)) return;
    seen.add(s); members.push({s,t,held:!!held,_pos:pos||null,_row:row||null});
  };
  Object.keys(posMap).forEach(k=>{ if(posMap[k]&&posMap[k].qty>0) add(k,true,posMap[k],rowOf(k)); });
  (Array.isArray(ALL)?ALL:[]).filter(r=>meetsRecommendationBar(r))
    .slice().sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity))
    .forEach(r=>add(r.symbol,false,null,r));
  // v1208: after the close the decision set is empty, and that is exactly when the day's winners
  // are worth their candles. The supreme objective is to find them BEFORE they are winners, and the
  // only way to learn that is from the ones that were.
  if(istClock().mins>=DAY_END_MIN&&typeof getGainerCohort==="function"){
    try{ getGainerCohort().forEach(r=>add(r.symbol,false,null,r)); }catch(e){}
  }
  if(!members.length){
    const untokened=(Array.isArray(ALL)?ALL:[]).filter(r=>meetsRecommendationBar(r))
      .filter(r=>!KITE_TOKEN[normSym(r.symbol)]).map(r=>r.symbol).slice(0,5);
    return {ok:false,why:untokened.length?('no Kite instrument token for '+untokened.join(', '))
      :'nothing with a live decision to check'};
  }

  const boundary=(()=>{const c=istClock();
    return (c&&Number.isFinite(c.mins))?Math.floor((c.mins-5)/5)*5:null;})();
  const gapOf=m=>{
    const rd=getIntradayRead(m.s);
    if(!rd||!rd.current) return null;          // no current read: the blocked state
    if(boundary===null) return 0;
    const t=new Date(rd.asOf);
    return Math.max(0,Math.round((boundary-(t.getHours()*60+t.getMinutes()))/5));
  };
  const allocCtx=(()=>{try{return getAllocationPassContext();}catch(e){return null;}})();
  const stakeOf=m=>{
    if(m.held){
      const q=Number(m._pos&&m._pos.qty)||0;
      const p=Number(m._pos&&m._pos.ltp)||Number(m._pos&&m._pos.avg)||0;
      return (q>0&&p>0)?q*p:null;
    }
    if(!m._row) return null;
    try{ const v=rowAchievableNotional(m._row,allocCtx); return v>0?v:null; }catch(e){ return null; }
  };
  // Stop widths from the decision edge. SMALLER is more urgent, so the percentile is inverted below.
  const edgeOf=m=>{
    if(!m.held||!m._row||!m._pos) return null;
    const avg=Number(m._pos.avg),ltp=Number(m._pos.ltp);
    if(!(avg>0)||!(ltp>0)) return null;
    let pol=null; try{ pol=getRowExitPolicy(m._row,avg); }catch(e){ return null; }
    const tgt=Number(pol&&pol.targetPct),stp=Number(pol&&pol.stopPct);
    if(!(tgt>0)||!(stp>0)) return null;
    const width=avg*stp/100; if(!(width>0)) return null;
    return Math.min(Math.abs(ltp-avg*(1+tgt/100)),Math.abs(ltp-avg*(1-stp/100)))/width;
  };

  const sortFinite=a=>a.filter(v=>Number.isFinite(v)).sort((x,y)=>x-y);
  const median=a=>{const f=sortFinite(a); return f.length?radarQuant(f,0.5):null;};

  const rawGap=members.map(gapOf),gapFin=sortFinite(rawGap);
  // Strictly worse than any partial read, derived from the queue rather than chosen.
  const blockedGap=gapFin.length?gapFin[gapFin.length-1]+1:1;
  const gap=rawGap.map(v=>Number.isFinite(v)?v:blockedGap);
  const rawStake=members.map(stakeOf),stakeMed=median(rawStake);
  const stake=rawStake.map(v=>Number.isFinite(v)?v:(Number.isFinite(stakeMed)?stakeMed:1));
  const rawEdge=members.map(edgeOf),edgeMed=median(rawEdge);
  const edge=rawEdge.map(v=>Number.isFinite(v)?v:(Number.isFinite(edgeMed)?edgeMed:1));

  const pctOf=arr=>{const s=arr.slice().sort((a,b)=>a-b); return arr.map(v=>radarPct(s,v));};
  const gP=pctOf(gap),sP=pctOf(stake),eP=pctOf(edge);
  const queue=members.map((m,i)=>({s:m.s,t:m.t,held:m.held,gapBars:gap[i],
      blocked:!Number.isFinite(rawGap[i]),
      priority:Math.cbrt(gP[i]*sP[i]*(1-eP[i]))}))
    .filter(m=>m.gapBars>0)                                   // already current to the last bar
    .sort((a,b)=>b.priority-a.priority)
    .slice(0,budget);

  if(!queue.length) return {ok:false,
    why:'every open position and live candidate is current to the last 5-minute bar'};
  return {ok:true,jobs:queue,symbols:queue.map(j=>j.s),
          recs:queue.filter(j=>!j.held).length,held:queue.filter(j=>j.held).length,
          blocked:queue.filter(j=>j.blocked).length,movers:0};
}
const INTRADAY_FETCH_DAYS=3;   // sessions of 5-minute candles to ask for

// Kite returns candles as [isoTime, open, high, low, close, volume]. That is the SAME information
// the pasted table carries, so it is converted into the identical CSV and handed to the ONE parser
// rather than given a second ingestion path of its own.
function ingestKiteCandlePayload(text){
  let p=null;
  try{ p=JSON.parse(String(text||'').trim()); }catch(e){ return null; }
  if(!p||p.rocketScanner!=='candles'||!p.data||typeof p.data!=='object') return null;
  const done=[],failed=[];
  for(const sym of Object.keys(p.data)){
    const rows=p.data[sym];
    if(!Array.isArray(rows)||rows.length<5){ failed.push(sym); continue; }
    const csv=['"Date","Open","High","Low","Close","% Change","% Change vs Average","Volume"']
      .concat(rows.map(c=>{
        const t=new Date(c[0]);
        const d=String(t.getDate()).padStart(2,'0')+'/'+String(t.getMonth()+1).padStart(2,'0')
              +' '+String(t.getHours()).padStart(2,'0')+':'+String(t.getMinutes()).padStart(2,'0');
        return ['"'+d+'"','"'+c[1]+'"','"'+c[2]+'"','"'+c[3]+'"','"'+c[4]+'"','"0"','"0"','"'+(c[5]||0)+'"'].join(',');
      })).join('\n');
    const res=parseIntradayPaste(csv,sym);
    (res&&res.ok?done:failed).push(sym);
  }
  if(done.length){
    applyIntradayReorder(ALL); applyFilters();
    try{renderRankingsPanels();}catch(e){}
    renderTable();
  }
  return {done,failed};
}

let KITE_API=null;          // set when the local helper answers, wherever this page is hosted
let LAST_FETCH=null;        // what the last fetch actually brought back, shown so it can be checked
let FETCH_BUSY=null;        // v1177: {n, syms, at} while a fetch is in flight - it must be VISIBLE
let LAST_FETCH_HIDDEN=false; // v1172: the list is collapsed for space; the DATA is never discarded
const KITE_HELPER='http://localhost:8787';
function rssCompanyKey(value){
  return String(value||'').toUpperCase().replace(/&AMP;/g,' AND ').replace(/\b(LIMITED|LTD|PRIVATE|PVT|INDIA)\b/g,' ')
    .replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function rssEventDateISO(value){
  const m=String(value||'').match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  return m?nseDateToISO(`${m[1]}-${m[2]}-${m[3]}`):null;
}
function resolveRssSymbol(item){
  const known=new Set([...Object.keys(NSE_BHAV),...Object.keys(NSE_SERIES),...Object.keys(NSE_PRICE_BAND),...Object.keys(NSE_SECURITY_MASTER),...(ALL||[]).map(r=>normSym(r.symbol))]);
  const link=String(item?.link||''),file=decodeURIComponent(link.split('/').pop()||'');
  const prefix=normSym((file.match(/^([A-Z0-9&.-]+)_/i)||[])[1]||'');
  if(prefix&&known.has(prefix)) return prefix;
  const title=String(item?.title||'').replace(/\s+-\s+Ex-Date:[\s\S]*$/i,'').trim();
  const exact=NSE_NAME_TO_SYM[title.toUpperCase()];if(exact)return normSym(exact);
  const key=rssCompanyKey(title);
  for(const [name,sym] of Object.entries(NSE_NAME_TO_SYM||{})) if(rssCompanyKey(name)===key)return normSym(sym);
  const row=(ALL||[]).find(r=>rssCompanyKey(r.name)===key);return row?normSym(row.symbol):null;
}
function restoreNseFundamentals(){
  const saved=FS.get(NSE_FUNDAMENTAL_STORE);
  if(saved?.bySymbol)NSE_FUNDAMENTALS=saved.bySymbol;
  if(saved?.meta)NSE_FUNDAMENTAL_META=saved.meta;
}
async function refreshNseFundamentals(){
  restoreNseFundamentals();
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),10000);
  try{
    const res=await fetch(KITE_HELPER+'/api/nse/rss',{cache:'no-store',signal:c.signal});
    const data=await res.json();if(!data?.ok)throw new Error(data?.why||'helper returned no RSS data');
    const bySymbol={};
    for(const item of data.items||[]){
      const symbol=resolveRssSymbol(item);if(!symbol)continue;
      const text=`${item.subject||''} ${item.description||''}`;
      const event={source:item.source,title:item.title,subject:item.subject||'',description:item.description||'',pubDate:item.pubDate||'',dateISO:rssEventDateISO(item.pubDate),link:item.link||'',financial:item.financial||null,
        isResults:/financialResults|integratedFinancials/.test(item.source)||/financial results?|quarterly results?|annual results?/i.test(text),
        isBoard:item.source==='boardMeetings'||/board meeting/i.test(text)};
      (bySymbol[symbol]??=[]).push(event);
    }
    Object.values(bySymbol).forEach(events=>events.sort((a,b)=>String(b.pubDate).localeCompare(String(a.pubDate))));
    NSE_FUNDAMENTALS=bySymbol;
    NSE_FUNDAMENTAL_META={ok:true,fetchedAt:data.fetchedAt,feeds:data.feeds,feedCounts:data.feedCounts,financials:data.financials||null,snapshot:data.snapshot,symbols:Object.keys(bySymbol).length,items:(data.items||[]).length};
    FS.set(NSE_FUNDAMENTAL_STORE,{version:1,bySymbol,meta:NSE_FUNDAMENTAL_META});
    return true;
  }catch(e){
    NSE_FUNDAMENTAL_META={...(NSE_FUNDAMENTAL_META||{}),ok:false,why:e?.name==='AbortError'?'local helper RSS request timed out':String(e?.message||e)};
    return false;
  }finally{clearTimeout(timer);}
}
async function detectKiteApi(force){
  try{
    const c=new AbortController();
    const t=setTimeout(()=>c.abort(),1500);      // it is either running locally or it is not
    const r=await fetch(KITE_HELPER+'/api/kite/status'+(force?'?force=1':''),{cache:'no-store',signal:c.signal});
    clearTimeout(t);
    KITE_API=r.ok?await r.json():null;
  }catch(e){ KITE_API=null; }
  try{ renderTable(); }catch(e){}
  if(KITE_API) { try{ loadIntradayInventory(); }catch(e){} }
  try{ maybePromptKiteToken(); }catch(e){}
  return KITE_API;
}
let KITE_TOKEN_PROMPTED=false;   // once per page load; dismissing must not re-prompt on every render

function kiteTokenDialogState(){
  if(!KITE_API) return null;                       // no helper: nothing to save into, so do not ask
  if(!KITE_API.hasToken) return 'missing';
  if(KITE_API.tokenValid===false) return 'expired';
  return null;                                     // valid, or the helper could not check - stay quiet
}

function openKiteTokenDialog(force){
  const dlg=document.getElementById('kiteTokenDlg');
  if(!dlg) return;
  const st=kiteTokenDialogState();
  if(!st&&!force) return;
  if(dlg.open) return;
  const expired=st==='expired';
  document.getElementById('kiteTokenTitle').textContent=
    expired?'Kite token expired':(st==='missing'?'Kite token needed':'Kite token');
  document.getElementById('kiteTokenBody').innerHTML=`
    <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px">
      <div style="font-size:13px;color:var(--t2);line-height:1.5">
        ${expired
          ? 'The helper tried the stored token against Kite and it was <b style="color:var(--red)">rejected</b>. It rotates on every login, so this is normal the morning after you log in again.'
          : (st==='missing'
             ? 'No token is stored yet, so candles cannot be fetched.'
             : 'Paste a fresh token to replace the stored one.')}
      </div>
      <ol style="font-size:12px;color:var(--t2);line-height:1.7;margin:0;padding-left:18px">
        <li>Open your logged-in <b>kite.zerodha.com</b> tab</li>
        <li><b>F12</b> → Application → Cookies → <b>kite.zerodha.com</b></li>
        <li>Copy the value of <b>enctoken</b> and paste it below</li>
      </ol>
      <input id="kiteTokenDlgBox" type="password" autocomplete="off" spellcheck="false"
             placeholder="paste enctoken here, then press Enter">
      <div id="kiteTokenDlgMsg" style="font-size:12px;min-height:16px;color:var(--t3)"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn" style="font-size:12px" onclick="closeKiteTokenDialog()">Later</button>
        <button class="btn" style="font-size:12px;border-color:var(--green);color:var(--green)"
                onclick="saveKiteTokenFromDialog()">Save token</button>
      </div>
      <div style="font-size:11px;color:var(--t3);border-top:1px solid var(--border);padding-top:9px">
        Saved to <code>dev/kite-token.txt</code> by the local helper. It never leaves this machine and
        is never sent to the hosted page.
      </div>
    </div>`;
  try{ dlg.showModal(); }catch(e){ dlg.setAttribute('open','open'); }
  const box=document.getElementById('kiteTokenDlgBox');
  if(box){
    box.focus();
    // one paste and Enter is the whole interaction - it should not require finding a button
    box.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); saveKiteTokenFromDialog(); } };
  }
}

function closeKiteTokenDialog(){
  const dlg=document.getElementById('kiteTokenDlg');
  if(!dlg) return;
  // clear the field before closing: the token is a secret and must not sit in a detached DOM node
  const box=document.getElementById('kiteTokenDlgBox'); if(box) box.value='';
  try{ dlg.close(); }catch(e){ dlg.removeAttribute('open'); }
}

async function saveKiteTokenFromDialog(){
  const box=document.getElementById('kiteTokenDlgBox');
  const msg=document.getElementById('kiteTokenDlgMsg');
  const say=(t,bad)=>{ if(msg){ msg.textContent=t; msg.style.color=bad?'var(--red)':'var(--green)'; } };
  const t=(box&&box.value||'').trim();
  if(t.length<20){ say('That does not look like an enctoken.',true); return; }
  say('Saving…');
  const ok=await postKiteToken(t,say);
  if(!ok) return;
  if(box) box.value='';
  // Report what the HELPER now says, not what we just sent. v1152's rule: a control may not report
  // intent - it must verify the far side answered. A token can be stored and still be rejected.
  await detectKiteApi(true);   // force: the helper's cached answer describes the OLD token
  if(KITE_API&&KITE_API.tokenValid===false){ say('Kite rejected that token. Copy it again.',true); return; }
  say('Saved. Fetching is enabled.');
  setTimeout(closeKiteTokenDialog,700);
  try{ renderTable(); }catch(e){}
}

// ONE POST PATH, shared by the dialog and the inline box, so the two cannot drift apart.
async function postKiteToken(token,say){
  try{
    const r=await fetch(KITE_HELPER+'/api/kite/token',{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({token})});
    const j=await r.json();
    if(!j.ok){ say('Rejected: '+j.why,true); return false; }
    return true;
  }catch(e){ say('Could not reach the helper: '+e.message,true); return false; }
}

// Called wherever the helper's status is (re)established. Asks at most ONCE per page load, so
// dismissing it is respected; the bar keeps its inline box and the ☰ menu can reopen it on demand.
function maybePromptKiteToken(){
  if(KITE_TOKEN_PROMPTED) return;
  if(!kiteTokenDialogState()) return;
  KITE_TOKEN_PROMPTED=true;
  openKiteTokenDialog();
}

async function refreshBrokerInputs(){
  if(!KITE_API) await detectKiteApi();
  if(!KITE_API) return {ok:false,why:'helper not running'};
  try{
    const c=new AbortController();
    const t=setTimeout(()=>c.abort(),25000);
    const r=await fetch(KITE_HELPER+'/api/inputs/refresh',{cache:'no-store',signal:c.signal});
    clearTimeout(t);
    if(!r.ok) return {ok:false,why:'helper HTTP '+r.status};
    const j=await r.json();
    if(!j.ok) console.warn('broker refresh skipped:',j.why);
    return j;
  }catch(e){ return {ok:false,why:e.message}; }
}

async function saveKiteToken(){
  const el=document.getElementById('kiteTokenBox');
  const t=(el&&el.value||'').trim();
  if(t.length<20){ showToast('That does not look like an enctoken.',4000,true); return; }
  const ok=await postKiteToken(t,(m,bad)=>showToast(m,5000,!!bad));
  if(!ok) return;
  if(el) el.value='';
  await detectKiteApi(true);   // force: the helper's cached answer describes the OLD token
  if(KITE_API&&KITE_API.tokenValid===false){ showToast('Kite rejected that token. Copy it again.',5000,true); return; }
  showToast('Kite token saved. Press Fetch candles.',4000);
}
async function loadIntradayInventory(){
  if(!KITE_API) return 0;
  try{
    const r=await fetch(KITE_HELPER+'/api/kite/inventory',{cache:'no-store'});
    const j=await r.json();
    if(!j||!j.ok||!j.data) return 0;
    let n=0;
    for(const sym of Object.keys(j.data)){
      const rows=j.data[sym];
      if(!Array.isArray(rows)||rows.length<3) continue;
      // Through the ONE parser, exactly as a fetch or a paste would be (the v1148 lesson).
      const csv=['"Date","Open","High","Low","Close","% Change","% Change vs Average","Volume"']
        .concat(rows.map(c=>{
          const d=String(c[0]);
          const dt=d.slice(8,10)+'/'+d.slice(5,7)+' '+d.slice(11,16);
          return ['"'+dt+'"','"'+c[1]+'"','"'+c[2]+'"','"'+c[3]+'"','"'+c[4]+'"','"0"','"0"','"'+(c[5]||0)+'"'].join(',');
        })).join('\n');
      const res=parseIntradayPaste(csv,sym);
      if(res&&res.ok) n++;
    }
    if(n){
      try{ applyIntradayReorder(ALL); applyFilters(); }catch(e){}
      try{ renderRankingsPanels(); }catch(e){}
      try{ renderTable(); }catch(e){}
    }
    return n;
  }catch(e){ return 0; }
}
async function fetchCandlesInApp(limit,opts){
  const auto=!!(opts&&opts.auto)||!!(limit&&limit.auto);
  if(limit&&typeof limit==='object') limit=null;
  const say=(m,ms,bad)=>{ if(!auto) showToast(m,ms,bad); };   // silent on the automatic path
  if(!KITE_API){ say('The helper is not running. Double-click "Start Rocket Scanner.bat" and leave that window open — the app itself stays on GitHub Pages.',8000,true); return; }
  const r=intradayFetchJobs(limit);
  if(!r.ok){ say('Nothing to fetch: '+r.why,5000,true); return; }
  const budget=fetchBudgetLeft();
  if(!budget){ say('Daily fetch budget spent — '+FETCH_MAX_PER_DAY+' requests. It resets next session.',5000,true); return; }
  // v1203: the queue already bounded itself by the day budget and by the decision set. A second cap
  // here is what silently dropped open positions off the end of a press.
  const jobs=r.jobs;
  jobs.forEach(()=>FETCH_LOG.push(Date.now()));
  FETCH_BUSY={n:jobs.length,syms:jobs.map(j=>j.s),at:Date.now()};
  try{ renderTable(); }catch(e){}
  say('Fetching '+jobs.map(j=>j.s).join(', ')+'…',3000);
  try{
    const q=jobs.map(j=>j.s+':'+j.t).join(',');
    const res=await fetch(KITE_HELPER+'/api/kite/candles?days='+INTRADAY_FETCH_DAYS+'&jobs='+encodeURIComponent(q),{cache:'no-store'});
    const j=await res.json();
    if(!j.ok){ say(j.why,8000,true); return; }
    const out=ingestKiteCandlePayload(JSON.stringify({rocketScanner:'candles',data:j.data}));
    LAST_FETCH_HIDDEN=false;
    LAST_FETCH=out.done.map(sym=>intradayFetchListRow(sym,(j.files&&j.files[sym])||null));
    const st=getIntradayLoopState();
    INTRADAY_TARGET='';
    renderTable();
    say('Read '+out.done.length+' stock(s): '+out.done.join(', ')
      +((j.failed&&j.failed.length)?(' · no data for '+j.failed.join(', ')):'')
      +(st.converged?' · settled':''),6000,!out.done.length);
  }catch(e){ say('Fetch failed: '+e.message,6000,true); }
  finally{ FETCH_BUSY=null; try{ renderTable(); }catch(e){} }
}
function intradayPasteBarHtml(){
  const n=Object.keys(INTRADAY_BARS).length;
  const t=INTRADAY_TARGET, res=INTRADAY_RESULT;
  const st=(typeof getIntradayLoopState==='function')?getIntradayLoopState():null;
  if(!t&&!n&&!(st&&(st.need.length||st.top.length))) return '';
  const chip=r=>{
    const sym=normSym(r.symbol), sel=t===sym;
    const has=!!INTRADAY_BARS[sym];
    const rd=has?getIntradayRead(sym):null;
    const v=has?r.intradayVerdict:null;
    const col=intradayVerdictColor(v,has,sel);
    const mark=v?(' '+intradayVerdictFace(v,has)):'';
    const tip=v==='rejected'?(sym+': NO LONGER CLEARS THE BAR - skip. '+(r.intradayWhy||''))
      :v==='confirmed'?(sym+': STILL CLEARS THE BAR - buy. '+(r.intradayWhy||''))
      :v==='stale'?(sym+': last read was '+(rd?rd.on:'an earlier session')+', not this session - it counts as unchecked')
      :(has?(sym+': checked'+(rd&&rd.regime?' - multi-day tape reads '+rd.regime:'')+'.')
           :('Fetch '+sym+'\u2019s 5-minute chart data'));
    return `<button onclick="setIntradayTarget('${escHtml(sym)}')" title="${escHtml(tip)}"
      style="border:1px solid ${col};background:${sel?'rgba(245,158,11,.10)':'transparent'};border-radius:4px;
      padding:2px 7px;margin:2px 4px 0 0;font-size:11px;color:${col};cursor:pointer">${escHtml(sym)}${mark}</button>`;
  };
  const done=st&&st.converged;
  return `<div style="margin:8px 0;padding:10px 14px;border:1px solid ${t?'var(--amber)':done?'var(--green)':'var(--border)'};border-radius:8px;background:var(--bg2)">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
      <span class="st-l">Intraday check</span>
      ${st?`<span style="font-size:12px;color:${done?'var(--green)':'var(--t2)'}">
        ${done?`<b>settled</b> — the top ${st.of} were checked and held their place`
              :`checked <b>${st.checked}</b> of the top <b>${st.of}</b>`}
        ${st.confirmed.length||st.rejected.length?`<span style="color:var(--t3)"> · </span>
          <span style="color:var(--green)">${st.confirmed.length} buy</span><span style="color:var(--t3)"> / </span>
          <span style="color:var(--red)">${st.rejected.length} skip</span>
          <span style="color:var(--t3)"> — marked ✓ / ✗ on the rows</span>`:''}</span>`:''}
      ${KITE_API?`<button onclick="fetchCandlesInApp()" class="btn" style="font-size:11px;border-color:${KITE_API.tokenValid===false?'var(--red)':'var(--green)'};color:${KITE_API.tokenValid===false?'var(--red)':'var(--green)'}"
          title="Fetches the 5-minute candles for the names above and reads them straight in. Nothing to paste, nothing to run.">Fetch candles</button>
        ${(KITE_API.hasToken&&KITE_API.tokenValid!==false)?'':`${KITE_API.hasToken?`<span onclick="openKiteTokenDialog(true)" style="font-size:11px;color:var(--red);font-weight:700;cursor:pointer;text-decoration:underline" title="The helper used the stored token against Kite and it was rejected. It rotates on every login, so this happens the morning after you log in again. Click to paste a fresh one.">token expired — paste a fresh one</span>`:''}<input id="kiteTokenBox" type="password" placeholder="paste Kite enctoken once"
            style="font-size:11px;padding:2px 6px;background:var(--bg);color:var(--t1);border:1px solid var(--amber);border-radius:4px;width:190px"
            title="Kite tab → F12 → Application → Cookies → kite.zerodha.com → copy the value of enctoken. It rotates on every login.">
          <button onclick="saveKiteToken()" class="btn" style="font-size:11px">Save token</button>`}`
        :`<span style="font-size:11px;color:var(--t3)" title="Double-click &quot;Start Rocket Scanner.bat&quot; on your PC and leave that window open. The app stays right here on GitHub Pages; only the little helper runs locally, because a web page is not allowed to call Kite directly.">start the helper (Start Rocket Scanner.bat) to fetch automatically</span>`}
      ${FETCH_BUSY?`<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--amber);font-weight:700"
        title="${escHtml('Fetching '+FETCH_BUSY.syms.slice(0,12).join(', ')+(FETCH_BUSY.syms.length>12?' and '+(FETCH_BUSY.syms.length-12)+' more':'')
          +'. The board re-ranks when this finishes, so wait for it before acting on the list.')}">
        <span style="width:10px;height:10px;border:2px solid var(--amber);border-right-color:transparent;border-radius:50%;display:inline-block;animation:rsspin .7s linear infinite"></span>
        fetching ${FETCH_BUSY.n} stock${FETCH_BUSY.n===1?'':'s'}…</span>`:''}
      ${(LAST_FETCH&&LAST_FETCH.length)?`<button onclick="collapseFetchList()" class="btn" style="opacity:.75;font-size:11px"
        title="${LAST_FETCH_HIDDEN
          ? `Show the ${LAST_FETCH.length} stock(s) from the last fetch again — bars, verdicts and files were never touched.`
          : `Collapse this list to free up the space. Nothing is thrown away — the ${LAST_FETCH.length} stock(s) keep their bars, their verdicts and their place in the ranking, and the files stay in Scanner Uploads/Intraday.`
        }">${LAST_FETCH_HIDDEN?`Show list (${LAST_FETCH.length})`:'Hide list'}</button>`:''}
    </div>
    ${st&&st.top.length?`<div style="margin:2px 0 8px">${st.top.map(chip).join('')}</div>`:''}

    ${t?`<textarea id="intradayBox" rows="4" placeholder="Paste ${escHtml(t)}'s 5-minute chart table \u2014 header, rows, and the summary block underneath if it is there."
        style="width:100%;box-sizing:border-box;font-family:var(--mono,monospace);font-size:12px;padding:8px;background:var(--bg);color:var(--t1);border:1px solid var(--amber);border-radius:6px"
        onpaste="setTimeout(onIntradayPaste,0)"></textarea>`:''}
    ${(LAST_FETCH&&LAST_FETCH.length&&!LAST_FETCH_HIDDEN)?`<div style="margin-top:6px;font-size:11px;line-height:1.6">
      <span style="color:var(--t3)">last fetch — check these against your chart:</span>
      ${LAST_FETCH.map(x=>`<div><b>${escHtml(x.sym)}</b>
        <span style="color:var(--t3)">${x.bars} bars · ${escHtml(x.from)} → ${escHtml(x.to)} · last</span>
        <b>${x.last!=null?fmtINR(x.last):'—'}</b>
        ${x.file?`<span style="color:var(--t3)" title="Open it to see every bar. Appended on each fetch, deduped by timestamp, and truncated at any break so the series is always contiguous."> · Scanner Uploads/Intraday/${escHtml(x.file)} (${x.fileRows} rows)</span>`:''}
        ${x.daily?`<span style="color:var(--t3)" title="Daily candles, fetched once per session and cached. Recorded only - nothing scores them until the measurement in .claude/deferred.json says they separate."> · +${x.daily}d daily</span>`:''}
        ${x.regime?`<span style="color:${x.regime==='accumulating'?'var(--green)':x.regime==='selling'?'var(--red)':'var(--amber)'}"
          title="${x.spanSessions?'This session could not be read (under three bars), so this is the '+x.spanSessions+'-session tape. The row verdict does not use it.':'This session only — the same window the row verdict reads.'}"> · ${escHtml(x.regime)} ${x.flow!=null?((x.flow*100).toFixed(1)+'%'):''}${x.spanSessions?` <span style="color:var(--t3)">across ${x.spanSessions} sessions</span>`:''}</span>`:''}
      </div>`).join('')}
    </div>`:''}
    ${res&&!res.ok?`<div style="font-size:11px;color:var(--amber);margin-top:5px">${escHtml(res.why)}</div>`:''}
    ${res&&res.ok&&res.read?`<div style="font-size:11px;color:var(--t3);margin-top:5px">read <b style="color:var(--green)">${escHtml(res.sym)}</b> \u2014 ${res.bars} bars over ${res.sessions} session(s)${
      res.live?` \u00b7 LIVE book <b style="color:${res.live.imbalance>0?'var(--green)':'var(--red)'}">${(res.live.imbalance>0?'+':'')+res.live.imbalance.toFixed(3)}</b>`:''}${
      res.read.traj?` \u00b7 <b style="color:${res.read.regime==='accumulating'?'var(--green)':res.read.regime==='selling'?'var(--red)':'var(--amber)'}">${escHtml(res.read.regime.toUpperCase())}</b> \u00b7 net flow ${(res.read.cvdPct*100).toFixed(1)}% of everything traded \u00b7 projected ${res.read.projected.toFixed(2)}`
      :` \u00b7 first 15m <b style="color:${res.read.first15Up?'var(--green)':'var(--red)'}">${res.read.first15Up?'UP':'DOWN'}</b> <span style="color:var(--amber)">(no volume column in that paste)</span>`
    }</div>`:''}
  </div>`;
}
function applyFilters(){
  updateFilterPlaceholders();
  const q=(document.getElementById('fSearch')?.value||'').trim().toLowerCase();
  // Risk filter now supports multiple levels (v554): the dropdown value is a comma-joined set
  // (e.g. "Low,Medium"); empty = All.
  const riskSel=(document.getElementById('fRisk')?.value||'').split(',').map(x=>x.trim()).filter(Boolean);
  const turnIdx=+(document.getElementById('fMinTurnover')?.value||0);
  const minTurn=RADAR_LIQ_STEPS[turnIdx]||0;
  // Rows: blank shows the entire ranked universe (Radar behavior); a number caps the display.
  const rowsRaw=(document.getElementById('fRows')?.value||'').trim();
  const rowCap=rowsRaw===''?null:Math.max(1,Math.floor(+rowsRaw)||1);
  // Held suppression also applies here: portfolio files can parse after the scanner
  // file in the same load, so display time re-checks the full current held map.
  const heldPos=getHeldPositionMap();
  // Portfolio files can parse after the scanner file, so the held flag is refreshed
  // here from the full current map rather than trusting the scoring-time snapshot.
  ALL.forEach(s=>{s._held=!!heldPos[s.symbol];});
  SUPPRESSED_HELD=0;
  SURV_HARD_REMOVED=0;
  PEAK_TIMING_REMOVED=0;
  ALLOC_BLOCKED=0;
  DIRECTION_REMOVED=0;
  REMOVED_ROWS=[];
  // Resolved ONCE: the allocation gate below runs per row over the full universe, and its inputs
  // (capital, max allocation, held map, portfolio target anchor) are constant for the pass.
  const allocCtx=getAllocationPassContext();
  let rows=ALL.filter(s=>{
    if(s._held)SUPPRESSED_HELD++;
    // Configured surveillance rules are a HARD filter (owner 2026-07-17): any stock
    // flagged under a rule in the Methodology table is weeded out of recommendations.
    // Non-configured REG1 flags remain a score penalty + badge only.
    if(NSE_SURV[s.symbol]?.length){SURV_HARD_REMOVED++;REMOVED_ROWS.push({s,reason:'surv',rules:NSE_SURV[s.symbol]});return false;}
    if(s.recommendationTriggerBlocked){
      REMOVED_ROWS.push({s,reason:'trigger',detail:'automatic evidence trigger: '+(s.recommendationTriggerReasons||[]).join(', ')});
      return false;
    }
    if(s.entryReady===false)PEAK_TIMING_REMOVED++;
    const _vw=Number(s.vwap), _px=Number(s.price), _co=Number(s.changeOpen), _day=Number(s.day);
    const _aboveVwap=_vw>0&&_px>=_vw;
    const _aboveOpen=Number.isFinite(_co)&&_co>0;
    const _greenDay=Number.isFinite(_day)&&_day>0;
    if(!(_aboveVwap&&_aboveOpen&&_greenDay)){
      DIRECTION_REMOVED++;
      const why=[];
      if(!_greenDay)why.push('red on the day ('+(Number.isFinite(_day)?_day.toFixed(2)+'%':'no day move')+')');
      if(!_aboveVwap)why.push(_vw>0?'below VWAP ('+((_px/_vw-1)*100).toFixed(2)+'%)':'no VWAP on file');
      if(!_aboveOpen)why.push(Number.isFinite(_co)?'below its open ('+_co.toFixed(2)+'%)':'no change-from-open');
      REMOVED_ROWS.push({s,reason:'direction',detail:'not lifting off: '+why.join(', ')});
      return false;
    }
    if((s.turnover||0)<minTurn){REMOVED_ROWS.push({s,reason:'filter',detail:'below the Min Turnover filter ('+fmtINR(minTurn)+')'});return false;}
    if(riskSel.length&&!riskSel.includes(s.risk)){REMOVED_ROWS.push({s,reason:'filter',detail:s.risk+' risk — excluded by your Risk filter'});return false;}
    if(q&&![s.symbol,s.name,s.sector].join(' ').toLowerCase().includes(q)) return false;
    // v1080 (owner): a row that can never be allocated a single share is not a recommendation.
    // Structural causes only (see getAllocationBlockReason) — never the capital split.
    const allocBlock=getAllocationBlockReason(s,allocCtx);
    if(s.noHistory===true){
      REMOVED_ROWS.push({s,reason:'nohistory',
        detail:'listed too recently - 1-month, 3-month and 1-year performance are the same number, so every multi-day feature is fiction'});
      return false;
    }
    if(s.intradaySellingToday===true){
      REMOVED_ROWS.push({s,reason:'flow',detail:s.intradayWhy||'being sold in the current session'});
      return false;
    }
    if(allocBlock){ALLOC_BLOCKED++;REMOVED_ROWS.push({s,reason:'alloc',detail:allocBlock});return false;}
    return true;
  });
  rows.sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity));
  FILT=rowCap!=null?rows.slice(0,rowCap):rows;
  applySort();

  CURRENT_TRADE_TIMING=getCurrentTradeTimingDecision();
  const selectionRows=[...rows].sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity));
  SELECTED=new Set(selectionRows
    .filter(s=>s.basketEligible!==false&&!EXPORT_EXCLUDED.has(s.symbol)
      &&meetsRecommendationBar(s)&&passesIntradayValidation(s))
    .slice(0,20).map(s=>s.symbol));

  PG=1;renderHead();renderTable();renderStatusBar();saveFilterState();updateTabCounts();
  try{renderRankingsPanels();}catch(e){console.warn('Rankings panels render failed',e);}
  if(ALL.length) try{renderStats();}catch(e){}
}
function renderRankingsPanels(){
  const q=rankingsSearchQuery();
  const remEl=document.getElementById('rankRemoved');
  if(remEl) remEl.innerHTML=buildRemovedPanel(q);
  const latestEl=document.getElementById('rankLatestSession');
  if(latestEl){
    const latest=buildLatestSessionPanel(q);
    latestEl.innerHTML=latest.html;
    latest.render();
  }
  const posEl=document.getElementById('rankOpenPositions');
  if(posEl){
    const positions=buildOpenPositionsPanel(q);
    posEl.innerHTML=positions.html;
    positions.table?.render();
  }
}
// Map configured-surveillance rule keys → their human labels.
function survRuleLabels(keys){
  const map=new Map((SURV_CUSTOM_RULES||[]).map(r=>[r.key,r.label]));
  return (keys||[]).map(k=>map.get(k)||k);
}
function buildRemovedPanel(query=''){
  const all=[...REMOVED_ROWS].sort((a,b)=>(a.s.rank??1e9)-(b.s.rank??1e9));
  if(!all.length) return '';
  const heldN=all.filter(r=>r.reason==='held').length;
  const survN=all.filter(r=>r.reason==='surv').length;
  const dirN=all.filter(r=>r.reason==='direction').length;
  const filtN=all.filter(r=>r.reason==='filter').length;
  const peakN=all.filter(r=>r.reason==='peak').length;
  const allocN=all.filter(r=>r.reason==='alloc').length;
  const triggerN=all.filter(r=>r.reason==='trigger').length;
  const shown=filterPanelRows(all,query,r=>[r.s.symbol,r.s.name,r.s.sector]);
  const CAP=100;
  const view=shown.slice(0,CAP);
  const rowsHtml=view.map(r=>{
    const s=r.s;
    const reason=r.reason==='direction'
      ?`<span style="font-size:11px;background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.25);border-radius:5px;padding:1px 7px;white-space:nowrap" title="${escHtml(r.detail||'')}">📉 Not lifting off</span>`
      :r.reason==='filter'
      ?`<span style="font-size:11px;background:rgba(148,163,184,.10);color:var(--t2);border:1px solid rgba(148,163,184,.22);border-radius:5px;padding:1px 7px;white-space:nowrap" title="${escHtml(r.detail||'')}">⚙ Your filter</span>`
      :r.reason==='trigger'
      ?`<span style="font-size:11px;background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.25);border-radius:5px;padding:1px 7px;white-space:nowrap" title="${escHtml(r.detail||'')}">Automatic trigger veto</span>`
      :r.reason==='held'
      ?`<span style="font-size:11px;background:rgba(244,114,182,.12);color:#f472b6;border:1px solid rgba(244,114,182,.25);border-radius:5px;padding:1px 7px;white-space:nowrap">📌 Held · in Open Positions</span>`
      :r.reason==='alloc'
        ?`<span style="font-size:11px;background:rgba(148,163,184,.12);color:var(--t2);border:1px solid rgba(148,163,184,.28);border-radius:5px;padding:1px 7px;white-space:nowrap" title="${escHtml(r.detail||'')}">🚫 Cannot allocate</span>`
      :r.reason==='peak'
        ?`<span style="font-size:11px;background:rgba(245,158,11,.12);color:var(--amber);border:1px solid rgba(245,158,11,.3);border-radius:5px;padding:1px 7px;white-space:nowrap" title="${escHtml(r.s.entryTiming?.reason||'Entry timing is not confirmed')} · range location ${fmt(r.s.entryTiming?.rangeLocation,0)}% · expected range used ${fmt(r.s.entryTiming?.rangeUsed,0)}%${r.s.entryTiming?.pullbackPrice?` · wait near/below ${fmtINR(r.s.entryTiming.pullbackPrice)}`:''}">⏳ ${escHtml(r.s.entryTiming?.action||'Wait for confirmation')}</span>`
        :(()=>{const labels=survRuleLabels(r.rules);return `<span style="font-size:11px;background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.25);border-radius:5px;padding:1px 7px;white-space:nowrap" title="Configured surveillance rule(s): ${escHtml(labels.join(' · '))}">⚠ ${escHtml(labels[0]||'surveillance')}${labels.length>1?` +${labels.length-1}`:''}</span>`;})();
    // Same interaction as every other stock table (owner, v1070): the NAME opens the
    // TradingView chart, the ROW opens the Radar scoring breakdown.
    return `<tr onclick="showRadarDetail('${s.symbol}')" title="Click for the full scoring breakdown" style="border-bottom:1px solid var(--border);cursor:pointer">
      <td style="padding:6px 10px;text-align:right;font-family:'DM Mono',monospace;color:var(--t2)">#${s.rank??'—'}</td>
      <td style="padding:6px 10px">${symbolChartButton(s.symbol,`<span style="font-weight:700;color:var(--t1);font-size:14px">${escHtml(s.symbol)}</span> <span style="color:var(--t3);font-size:12px">${escHtml((s.name||'').slice(0,28))}</span>`)}</td>
      <td style="padding:6px 10px;text-align:right">${radarScoreCell(s.score)}</td>
      <td style="padding:6px 10px;text-align:right">${fPerf(s.day??s.priceChange)}</td>
      <td style="padding:6px 10px">${reason}</td>
    </tr>`;
  }).join('');
  const tag=query&&shown.length!==all.length?` <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--t3)">· ${shown.length} of ${all.length} matching "${escHtml(query)}"</span>`:'';
  const capNote=shown.length>CAP?`<div style="padding:6px 10px;font-size:12px;color:var(--t3)">Showing the top ${CAP} by rank · ${shown.length-CAP} more removed further down the ranking.</div>`:'';
  // Always visible, no collapse, no internal scroll (owner v547) — the page scrolls. Capped
  // at the top 100 by rank so the DOM stays bounded; it sits last on the Rankings tab.
  const body=shown.length
    ?`<div><table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr style="color:var(--t3);border-bottom:1px solid var(--border)">
          <th style="padding:6px 10px;text-align:right;font-size:12px;text-transform:uppercase">Rank</th>
          <th style="padding:6px 10px;text-align:left;font-size:12px;text-transform:uppercase">Symbol</th>
          <th style="padding:6px 10px;text-align:right;font-size:12px;text-transform:uppercase">Score</th>
          <th style="padding:6px 10px;text-align:right;font-size:12px;text-transform:uppercase">Day %</th>
          <th style="padding:6px 10px;text-align:left;font-size:12px;text-transform:uppercase">Reason removed</th>
        </tr></thead><tbody>${rowsHtml}</tbody></table></div>${capNote}`
    :panelNoMatchHtml(query,'removed stock');
  return `<div id="rank-removed-card" style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden">
    <div style="padding:10px 16px;border-bottom:1px solid var(--border)">
      <span style="font-size:12px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.1em">Removed from rankings — ${all.length}${tag}</span>
      <span style="font-size:13px;color:var(--t3);font-weight:400;margin-left:8px">${[dirN?`📉 ${dirN} not lifting off`:'',heldN?`📌 ${heldN} held`:'',survN?`⚠ ${survN} surveillance`:'',triggerN?`${triggerN} automatic trigger veto`:'',peakN?`⏳ ${peakN} waiting for entry confirmation`:'',allocN?`🚫 ${allocN} not allocatable`:'',filtN?`⚙ ${filtN} by your filters`:''].filter(Boolean).join(' · ')}${(heldN||survN||triggerN||peakN||allocN||dirN||filtN)?' · ':''}why the ranks skip</span>
    </div>
    ${body}
  </div>`;
}
function showRadarDetail(sym){
  const r=ALL.find(x=>x.symbol===sym);
  const dlg=document.getElementById('radarDetail');
  if(!r||!dlg) return;
  // innerHTML (not textContent) so the score carries its band colour; both interpolations are escaped.
  document.getElementById('radarDetailTitle').innerHTML=`${escHtml(r.symbol)} · <span style="color:${radarScoreColor(r.score)}">${isFinite(r.score)?Number(r.score).toFixed(1):'—'}</span> · ${escHtml(r.risk||'—')} risk`;
  const groups=Object.entries(RADAR_GROUPS).map(([k,g])=>`<div class="rr-group"><b>${g.label}<i>${r.parts?fmt(r.parts[k],0):'—'}/100</i></b><meter min="0" max="100" value="${r.parts?.[k]??0}"></meter></div>`).join('');
  const contribs=[...(r.contrib||[])].sort((a,b)=>Math.abs(b.impact)-Math.abs(a.impact)).slice(0,36).map(x=>`<div class="rr-contrib"><div><b>${escHtml(x.name)}</b><small>${RADAR_GROUPS[x.group]?.label||x.group} · percentile ${fmt(x.p*100,0)}</small></div><b class="${x.impact>=0?'pos':'neg'}">${x.impact>=0?'+':''}${fmt(x.impact,3)}</b></div>`).join('');
  const gate=r.rocketReady?'Meets the model’s high-feasibility criteria.':'Feasibility cautions: '+escHtml((r.gateReasons||[]).join(', ')||'not evaluated')+'.';
  const entryNote=r.entryReady===false
    ?`<br><b style="color:var(--amber)">Entry timing:</b> ${escHtml(r.entryTiming?.action||'Wait for confirmation')} — ${escHtml(r.entryTiming?.reason||'insufficient confirmation')}. Range location ${fmt(r.entryTiming?.rangeLocation,0)}%, expected range used ${fmt(r.entryTiming?.rangeUsed,0)}%${r.entryTiming?.pullbackPrice?`, reconsider near/below ${fmtINR(r.entryTiming.pullbackPrice)}`:''}. The breakout rank is preserved, but recommendation and basket export are blocked.`
    :'';
  const flags=(r.meta?.flags||[]).length?escHtml(r.meta.flags.join(', ')):'none';
  const corp=r.meta?.corpToday;
  const bm=r.meta?.boardMeeting;
  const eventBits=[];
  if(corp)eventBits.push(`corp action <b>${escHtml(corp.purpose||corp.kind)}</b> ex-date this session${r.meta?._corpNeutralised?' (mechanical move neutralised, not scored)':corp.kind==='buyback'?' (buyback conviction applied)':''}`);
  if(bm)eventBits.push(`board meeting ${escHtml(bm.date)}${bm.isResults?' — results':''}${bm.date===getSessionDate()?' <b>(today)</b>':''}`);
  if(r.meta?.announceToday)eventBits.push(`announcement filed today: ${escHtml(String(r.meta.announceToday))}`);
  (r.meta?.fundamentalEvents||[]).slice(0,3).forEach(e=>eventBits.push(`${escHtml(e.subject||e.source||'official filing')} ${escHtml(e.pubDate||'')}${e.link?` <a href="${escHtml(e.link)}" target="_blank" rel="noopener">official filing</a>`:''}`));
  const corpNote=eventBits.length?` <b style="color:var(--amber)">Events:</b> ${eventBits.join('; ')}.`:'';
  const triggerBits=(r.modelTriggers||[]).map(t=>`${escHtml(t.label)} → ${escHtml(t.action)}`);
  if(r.fundamental?.label)triggerBits.unshift(`${escHtml(r.fundamental.label)}: ${escHtml(r.fundamental.why||'')}`);
  const triggerNote=triggerBits.length?` <b style="color:var(--green)">Automatic triggers:</b> ${triggerBits.join('; ')}.`:'';
  const varNote=r.meta?.nseVar?.totalMarginPct!=null?` NSE EOD margin ${fmt(r.meta.nseVar.totalMarginPct,2)}% (security VaR ${fmt(r.meta.nseVar.securityVarPct,2)}% + ELM ${fmt(r.meta.nseVar.elmPct,2)}%).`:'';
  const bandNote=r.meta?.bandNote?` ${escHtml(r.meta.bandNote)}.`:'';
  const masterNote=r.meta?.securityMaster?` ISIN ${escHtml(r.meta.securityMaster.isin||'—')}${r.meta.securityMaster.listingDate?`, listed ${escHtml(r.meta.securityMaster.listingDate)}`:''}.`:'';
  const detailNote=(r.contrib||[]).length?'':'<div style="color:var(--amber);font-size:13px;margin-bottom:8px">Restored compact ranking — load files again for the full per-feature breakdown.</div>';
  document.getElementById('radarDetailBody').innerHTML=`${detailNote}<div class="rr-groups">${groups}</div>
    <div class="rr-read"><b>Exchange check:</b> Series ${escHtml(r.series||'—')}, price band ${r.band??'not supplied'}, status ${escHtml(r.status||'—')}; basket ${r.basketEligible!==false?'eligible':'ineligible'}. Official delivery ${r.meta?.delivery==null?'unavailable':fmt(r.meta.delivery,1)+'%'}, trades ${r.meta?.trades==null?'unavailable':fmt(r.meta.trades,0)}, surveillance triggers: ${flags}.${bandNote}${varNote}${masterNote}${corpNote}${triggerNote}<br>
    <b>Feasibility:</b> ${gate} Strongest daily range estimate ${fmt(r.rangePct,2)}%; the session target takes ${fmt(r.stretch,2)}× that range. The stock remains ranked either way.${entryNote}<br>
    ${r.stage?`<b>Market-cycle stage:</b> ${radarStagePill(r)} — ${escHtml({1:'silent accumulation (quiet strength before a move)',2:'initial breakout',3:'event day (move may be event-driven)',4:'profit-booking (digesting a recent result)',5:'re-accumulation',6:'second leg'}[r.stage]||'')}.<br>`:''}
    <b>Read:</b> ${escHtml(r.setup||'—')}. Data coverage ${r.quality!=null?fmt(r.quality*100,0)+'%':'—'}, day move ${(r.day??0)>=0?'+':''}${fmt(r.day,2)}%, relative volume ${r.relvol==null?'unavailable':fmt(r.relvol,2)+'×'}, turnover ${fV(r.turnover)}. Rank is relative, not a literal probability.</div>
    ${contribs?`<h3 style="font-size:16px;margin:12px 0 8px">Largest feature contributions</h3><div class="rr-contribs">${contribs}</div>`:''}`;
  dlg.showModal();
}
function closeRadarDetail(){document.getElementById('radarDetail')?.close();}

function renderPostClose(){
  const el=document.getElementById('postCloseContent');if(!el)return;
  const clock=istClock();
  if(clock.mins>=DAY_END_MIN) runPostCloseAudit();
  const {today,audit,store}=postCloseAuditStatus();
  const complete=!!audit,afterClose=clock.mins>=DAY_END_MIN;
  const candidates=(audit?.candidates||[]);
  const scorecard=store.scorecard||getPostCloseRuleScorecard(store.audits||{});
  const stateColor=complete?'var(--green)':afterClose?'var(--amber)':'var(--t3)';
  const stateText=complete?'Complete for '+today:afterClose?'Waiting for a refreshed post-close ALL NSE.csv':'Arms automatically at 16:00 IST';
  const candidateRows=candidates.length?candidates.map(c=>`<tr><td>${escHtml(c.label)}</td><td>${c.wins}/${c.n}</td><td style="color:${c.precision>=95?'var(--green)':'var(--t2)'}">${c.precision}%</td><td style="color:var(--amber)">Collecting for trigger</td></tr>`).join('')
    :`<tr><td colspan="4" style="color:var(--t3)">No predeclared condition currently reaches 95% among resolved picks. That is a valid result; the system does not tune a condition after seeing the answers.</td></tr>`;
  const ruleRows=scorecard.map(r=>`<tr><td>${escHtml(r.label)}</td><td>${r.sessions}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.precision==null?'—':r.precision+'%'}</td><td style="font-weight:800;color:${['ARMED','ELIGIBLE'].includes(r.status)?'var(--green)':r.status==='RETIRED'?'var(--red)':'var(--t3)'}">${r.status==='ELIGIBLE'?'ARMED':r.status}</td></tr>`).join('');
  const gToday=store.gainers?.[today]||null;
  const gCard=(()=>{
    const gs=store.gainerScorecard||getGainerScorecard(store.gainers||{});
    if(!gToday) return `<div class="m-card" style="margin-bottom:14px"><h3>Top-gainer reverse audit</h3><p style="color:var(--t3);font-size:13px">Runs after 16:00 on the refreshed closing tape. It takes the day's ${GAINER_COHORT_N} biggest EQ gainers and grades every predeclared condition against them and against the rest of the tradeable market, so a stock the board MISSED becomes evidence rather than nothing.</p></div>`;
    const f=gToday.fields||{};
    const n2=(v,d=2)=>v==null||!Number.isFinite(v)?'—':Number(v).toFixed(d);
    const rows=gToday.symbols.map(x=>`<tr><td style="font-weight:700">${escHtml(x.s)}</td><td style="color:var(--green)">+${n2(x.day)}%</td><td>${x.rank??'—'}</td><td>${n2(x.score,1)}</td><td>${n2(x.setupPct,3)}</td><td>${n2(x.feasibility,3)}</td><td>${n2(x.circuitFeasibility,3)}</td><td>${x.relvol==null?'—':n2(x.relvol)+'×'}</td><td style="color:${x.dirOk?'var(--green)':'var(--red)'}">${x.dirOk?'Y':'N'}</td></tr>`).join('');
    const cond=(gToday.conditions||[]).slice().sort((a,b)=>b.lift-a.lift).map(c=>`<tr><td>${escHtml(c.label)}</td><td>${c.hit}/${c.of}</td><td>${c.hitPct}%</td><td>${c.basePct}%</td><td style="font-weight:800;color:${c.lift>=GAINER_LIFT_MIN?'var(--green)':c.lift<=-GAINER_LIFT_MIN?'var(--red)':'var(--t3)'}">${c.lift>=0?'+':''}${c.lift}pp</td></tr>`).join('');
    const gRows=gs.map(r=>`<tr><td>${escHtml(r.label)}</td><td>${r.sessions}</td><td>${r.confirms}</td><td>${r.contradictions}</td><td>${r.meanLift==null?'—':(r.meanLift>=0?'+':'')+r.meanLift+'pp'}</td><td style="font-weight:800;color:${r.status==='ARMED'?'var(--green)':r.status==='RETIRED'?'var(--red)':'var(--t3)'}">${r.status}</td></tr>`).join('');
    return `<div class="m-card" style="margin-bottom:14px">
      <h3>Top-gainer reverse audit</h3>
      <p style="color:var(--t2);font-size:14px">The day's ${gToday.n} biggest EQ gainers, graded against the same predeclared conditions as the picks — and against the ${gToday.controlN} tradeable rows that were not gainers. <b>${gToday.caught.onBoard}</b> of them were inside the board's top ${RECOMMEND_MAX_RANK}; <b>${gToday.caught.scored}</b> cleared the ${RECOMMEND_MIN_SCORE} score bar.</p>
      <div class="kpi-grid" style="margin:12px 0">
        <div class="kpi-card"><div class="kpi-lbl">Median rank — gainers</div><div class="kpi-val">${f.rank?.cohort??'—'}</div><div class="kpi-sub">rest of market ${f.rank?.control??'—'}</div></div>
        <div class="kpi-card"><div class="kpi-lbl">Median score — gainers</div><div class="kpi-val">${n2(f.score?.cohort,1)}</div><div class="kpi-sub">rest ${n2(f.score?.control,1)}</div></div>
        <div class="kpi-card"><div class="kpi-lbl">Median setup pct</div><div class="kpi-val">${n2(f.setupPct?.cohort,3)}</div><div class="kpi-sub">rest ${n2(f.setupPct?.control,3)}</div></div>
        <div class="kpi-card"><div class="kpi-lbl">Median relative volume</div><div class="kpi-val">${n2(f.relvol?.cohort)}×</div><div class="kpi-sub">rest ${n2(f.relvol?.control)}×</div></div>
        <div class="kpi-card"><div class="kpi-lbl">Median circuit feasibility</div><div class="kpi-val">${n2(f.circuitFeasibility?.cohort,3)}</div><div class="kpi-sub">rest ${n2(f.circuitFeasibility?.control,3)}</div></div>
      </div>
      <div class="scroll-x"><table class="method-table"><thead><tr><th>Symbol</th><th>Day</th><th>Rank</th><th>Score</th><th>Setup</th><th>Feas</th><th>Circuit feas</th><th>RelVol</th><th>Dir</th></tr></thead><tbody>${rows}</tbody></table></div>
      <h3 style="margin-top:16px">Which conditions separated the winners today</h3>
      <p style="color:var(--t3);font-size:13px">Lift is the gap in percentage points between how often the winners satisfied a condition and how often the rest of the market did. A condition present in the winners at the market's own base rate says nothing about winning.</p>
      <div class="scroll-x"><table class="method-table"><thead><tr><th>Condition</th><th>Winners</th><th>Winner rate</th><th>Market rate</th><th>Lift</th></tr></thead><tbody>${cond}</tbody></table></div>
      <h3 style="margin-top:16px">Gainer-side trigger tracker</h3>
      <p style="color:var(--t3);font-size:13px">A condition arms after at least 3 sessions where its lift held at ${GAINER_LIFT_MIN}pp or better, across at least 2 sessions, with no more than 1 contradiction. One day never graduates a rule, and a condition that keeps failing retires on its own.</p>
      <div class="scroll-x"><table class="method-table"><thead><tr><th>Condition</th><th>Sessions</th><th>Confirms</th><th>Contradictions</th><th>Mean lift</th><th>Status</th></tr></thead><tbody>${gRows}</tbody></table></div>
    </div>`;
  })();
  const rss=NSE_FUNDAMENTAL_META,events=Object.values(NSE_FUNDAMENTALS).reduce((n,a)=>n+(a?.length||0),0);
  el.innerHTML=`<div style="padding:18px 16px 40px">
    <div class="m-card" style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap">
      <div><h3 style="margin:0 0 6px">Post-close model audit</h3><div style="font-size:14px;color:var(--t2);max-width:850px">Runs inside the app after 16:00 when the refreshed closing tape is ingested. It grades the cohort exactly as issued, keeps unresolved two-day picks pending, and accumulates the evidence bar without relying on RULES.md or an assistant remembering a routine.</div></div>
      <div style="font-weight:800;color:${stateColor}">${escHtml(stateText)}</div></div>
      <div class="kpi-grid" style="margin-top:14px">
        <div class="kpi-card"><div class="kpi-lbl">Issued</div><div class="kpi-val">${audit?.issued??'—'}</div></div>
        <div class="kpi-card"><div class="kpi-lbl">Resolved</div><div class="kpi-val">${audit?.resolved??'—'}</div></div>
        <div class="kpi-card"><div class="kpi-lbl">Rockets</div><div class="kpi-val" style="color:var(--green)">${audit?.rockets??'—'}</div></div>
        <div class="kpi-card"><div class="kpi-lbl">Pending</div><div class="kpi-val" style="color:var(--amber)">${audit?.pending??'—'}</div></div>
        <div class="kpi-card"><div class="kpi-lbl">Resolved precision</div><div class="kpi-val">${audit?.precision==null?'—':audit.precision+'%'}</div></div>
      </div>
    </div>
    <div class="m-card" style="margin-bottom:14px"><h3>Today’s ≥95% candidates</h3><p style="color:var(--t3);font-size:13px">Denominator is resolved non-control recommendations only. One session never graduates a rule.</p><div class="scroll-x"><table class="method-table"><thead><tr><th>Condition fixed before grading</th><th>Wins / n</th><th>Precision</th><th>Verdict</th></tr></thead><tbody>${candidateRows}</tbody></table></div></div>
    <div class="m-card" style="margin-bottom:14px"><h3>Automatic trigger tracker</h3><p style="color:var(--t3);font-size:13px">A condition arms itself after at least 3 wins across at least 2 audited sessions, no more than 1 contradiction, and at least 95% aggregate precision. ARMED gates or re-ranks recommendations automatically; RETIRED negative conditions become automatic vetoes after ten winless sessions.</p><div class="scroll-x"><table class="method-table"><thead><tr><th>Condition</th><th>Sessions</th><th>Confirms</th><th>Contradictions</th><th>Precision</th><th>Status</th></tr></thead><tbody>${ruleRows}</tbody></table></div></div>
    ${gCard}
    <div class="m-card"><h3>Official NSE fundamental triggers</h3><p style="color:var(--t2);font-size:14px">${rss?.ok?`${events} symbol-linked filing events loaded from ${rss.feeds||0} official RSS indexes; ${rss.financials?.parsed||0} of ${rss.financials?.attempted||0} result XBRLs parsed; snapshot ${escHtml(rss.snapshot||'saved locally')}.`:`${rss?.why?`RSS unavailable: ${escHtml(rss.why)}.`:'The local helper will fetch and snapshot the official indexes on the next load.'}`} A fresh result becomes a positive trigger only when revenue, profit, operating profit and audit quality pass and price confirms above VWAP and the open. Its rank authority arms automatically after the same forward evidence bar; a persistently losing negative-result cohort becomes an automatic veto.</p></div>
  </div>`;
}

let APPLY_FILTERS_TIMER=null;
function scheduleApplyFilters(){
  clearTimeout(APPLY_FILTERS_TIMER);
  APPLY_FILTERS_TIMER=setTimeout(()=>{APPLY_FILTERS_TIMER=null;applyFilters();},120);
}


function renderStatusBar(){
  const total=ALL.length,shown=FILT.length;
  const tags=[];
  const risk=document.getElementById('fRisk')?.value||'';
  if(risk)tags.push(risk.split(',').join(' + ')+' risk');
  const turnIdx=+(document.getElementById('fMinTurnover')?.value||0);
  if(turnIdx>0)tags.push('TO≥'+RADAR_LIQ_LABELS[turnIdx]);
  const q=(document.getElementById('fSearch')?.value||'').trim();
  if(q)tags.push('“'+escHtml(q)+'”');
  const capital=getEffectiveCapital();
  const isFiltered=tags.length>0||shown<total;
  const countColor=shown<total?'var(--fire)':'var(--green)';
  const instrumentLabel='stocks';
  const allocatedLabel=n=>n===1?'stock':'stocks';   // v1206: it printed "1 stocks".
  let html=`<span class="sb-count" style="color:${countColor}">${shown.toLocaleString()}</span><span class="sb-total">of ${total.toLocaleString()} ${instrumentLabel}</span>`;
  const selCount=FILT.filter(s=>SELECTED.has(s.symbol)).length;
  if(capital>0&&selCount>0){
    const selList2=FILT.filter(s=>SELECTED.has(s.symbol));
    const am2=computeAlloc(capital,selList2);
    const actualDeployed=Object.values(am2).reduce((s,a)=>s+(a.debit??a.alloc),0);
    const activeAlloc=Object.values(am2).filter(a=>!a.rejected&&a.qty>0);
    const stockCount=activeAlloc.length;
    html+=` <span style="color:var(--amber);font-size:13px;font-family:'DM Mono',monospace;font-weight:700;margin-left:8px" title="All-in estimated buy debit: limit-price notional plus CNC buy-side charges.">· ${stockCount} ${allocatedLabel(stockCount)} · ${fmtINR(actualDeployed)} of ${fmtINR(capital)} all-in</span>`;
    const risks=activeAlloc.map(a=>a.riskRs).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);
    if(risks.length){
      const totalRisk=risks.reduce((x,y)=>x+y,0);
      const riskPct=capital>0?(totalRisk/capital)*100:0;
      const spread=risks.length>1?`${fmtINR(risks[0])}–${fmtINR(risks.at(-1))}`:fmtINR(risks[0]);
      const budget=getEffectiveRiskPerTrade();
      const budgetLbl=budget>0?` Risk ₹/trade budget: ${fmtINR(budget)} per position.`:'';
      html+=` <span style="color:var(--cyan);font-size:13px;font-family:'DM Mono',monospace;font-weight:700;margin-left:8px" title="Total rupees at risk if every position in this basket hits its own stop — ${spread} per position across ${risks.length}. Positions are sized by Radar score ÷ stop distance, so equally-scored names carry equal rupee risk; a wide spread here means a cap (turnover, Max Allocation, top-up cushion) is binding instead of the weight.${budgetLbl}">· 🛡 ${fmtINR(totalRisk)} at risk (${riskPct.toFixed(1)}% of capital) · ${spread}/trade</span>`;
    }
    // Expected net uses each stock's own capacity-aware target. The Harvest/goal/manual
    // value is an anchor only; it is never pasted uniformly onto every selected row.
    const harvestPlan=computeHarvestPlan();
    const active=getActiveTargetInfo();
    const targets=activeAlloc.map(a=>a.tgtPct).filter(v=>Number.isFinite(v)).sort((a,b)=>a-b);
    const stops=activeAlloc.map(a=>a.stopDistancePct).filter(v=>Number.isFinite(v)).sort((a,b)=>a-b);
    if(targets.length){
      let totalNet=0;
      for(const sym in am2){
        const a=am2[sym];
        if(a.rejected) continue;
        if(a.expectedNet!=null && isFinite(a.expectedNet)){
          totalNet+=a.expectedNet;
        }
      }
      const _todayRs=getTodayRupeeNeed();
      const goalTargetRs=(_todayRs&&_todayRs.outstanding>0)?_todayRs.outstanding:harvestPlan.dailyGoal;
      const goalCoverage=goalTargetRs>0?Math.max(0,totalNet)/goalTargetRs:0;
      const srcLbl=active.source==='manual'?'✎ manual anchor':active.source==='goal'?'goal-led anchor':'Harvest anchor';
      const targetRange=Math.abs(targets.at(-1)-targets[0])<0.001?targets[0].toFixed(2)+'%':`${targets[0].toFixed(2)}–${targets.at(-1).toFixed(2)}%`;
      const stopRange=stops.length?(Math.abs(stops.at(-1)-stops[0])<0.001?stops[0].toFixed(2)+'%':`${stops[0].toFixed(2)}–${stops.at(-1).toFixed(2)}%`):'—';
      const needed=harvestPlan.capitalNeeded?` Capital needed for ${fmtINR(harvestPlan.dailyGoal)} at this learned edge: ${fmtINR(harvestPlan.capitalNeeded)}.`:'';
      const warn=harvestPlan.warning?` Warning: ${harvestPlan.warning}`:'';
      const tip=`Per-stock targets ${targetRange} and ATR stops ${stopRange}; ${srcLbl} ${active.tgtPct.toFixed(2)}% supplies portfolio context only. Expected net is charge-aware.${needed}${warn}`;
      const color=totalNet>=0?'var(--green)':'var(--red)';
      const goalLbl=(_todayRs&&_todayRs.outstanding>0)
        ? `${(goalCoverage*100).toFixed(0)}% of the ${fmtINR(goalTargetRs)} today still needs`
        : `${(goalCoverage*100).toFixed(0)}% of ${fmtINR(goalTargetRs)}`;
      const goalTip=(_todayRs&&_todayRs.need>0)
        ? ` Today needs ${fmtINR(_todayRs.need)}${_todayRs.booked!=null?`, of which ${fmtINR(_todayRs.booked)} is already booked, leaving ${fmtINR(_todayRs.outstanding)}`:''}. This basket covers ${(goalCoverage*100).toFixed(0)}% of that IF every target fills — the whole basket's rupees, added up, which is the only form of the goal that can actually be checked.`
        : '';
      html+=` <span style="color:${color};font-size:13px;font-family:'DM Mono',monospace;font-weight:700;margin-left:8px" title="${tip}${goalTip}">· 🎯 ${fmtINR(totalNet)} net @ stock targets ${targetRange} · ${goalLbl}</span>`;
      if(harvestPlan.warning){
        html+=` <span style="color:var(--amber);font-size:13px;font-family:'DM Mono',monospace;font-weight:700;margin-left:8px" title="${harvestPlan.warning}">· target floor active</span>`;
      }
      // v1093: the measured baseline reward:risk, and where this basket sits against it.
      // Reported only — see the horizon-contradiction note in getRowExitPolicy.
      const curve=buildAchievabilityCurve();
      if(curve&&curve.rr>0&&stops.length&&targets.length){
        const medT=targets[Math.floor(targets.length/2)],medS=stops[Math.floor(stops.length/2)];
        const rr=medS>0?medT/medS:0;
        const short=rr<curve.rr;
        const col=short?'var(--amber)':'var(--green)';
        const tip=`Measured on the last COMPLETED session (${escHtml(curve.dateStr||'—')}, ${curve.n.toLocaleString()} tradeable stocks): sweeping every candidate target against each stock's own ATR stop, expectancy peaks at a ${curve.bestT}% target against a ${curve.medStop.toFixed(2)}% median stop — a baseline of ${curve.rr}x risk, reached by ${(curve.hitRate*100).toFixed(1)}% of the market. This basket's median target ${medT.toFixed(2)}% against its ${medS.toFixed(2)}% median stop is ${rr.toFixed(2)}x. Measured on the CROSS-SECTION, never on your own fills, so a bad realised ratio cannot justify itself. REPORTED ONLY: it does not move any target — enforcing it was built and backed out because the curve is a full-day measure while row viability is still same-day (see CLAUDE.md v1093).`;
        html+=` <span style="color:${col};font-size:13px;font-family:'DM Mono',monospace;font-weight:700;margin-left:8px" title="${tip}">· ⚖ R:R ${rr.toFixed(2)}x vs ${curve.rr}x baseline${short?' — short':''}</span>`;
      }
    }
  } else if(capital>0){
    html+=` <span style="color:var(--t3);font-size:13px;margin-left:8px">· select ${instrumentLabel} to allocate ${fmtINR(capital)}</span>`;
  }
  // v555 WS-D: market intraday breadth gauge (entry timing). Market-wide, so it never changes the ranking.
  if(MARKET_INTRADAY&&MARKET_INTRADAY.advPct!=null){
    const up=MARKET_INTRADAY.advPct>=0.5,c=up?'var(--green)':'var(--red)',pct=(MARKET_INTRADAY.advPct*100).toFixed(0);
    html+=` <span style="color:${c};font-size:13px;font-family:'DM Mono',monospace;font-weight:700;margin-left:8px" title="Automatic breadth trigger: ${MARKET_INTRADAY.adv} of ${MARKET_INTRADAY.adv+MARKET_INTRADAY.dec} stocks are trading above their open. In broad weakness, an entry is blocked unless that stock independently confirms above VWAP and its open on positive completed tape.">· ⚡ Market ${up?'▲':'▼'} ${pct}% up-from-open</span>`;
  }
  // v557: say it out loud when Positions/Orders are a prior session's snapshot. Zerodha only rewrites
  // them on a new trade, so the morning after a no-trade day they still hold yesterday's rows — they
  // are EXCLUDED from today's numbers rather than silently counted.
  if(PORTFOLIO_STALE?.stale){
    html+=` <span class="sb-tag sb-tag-red" style="margin-left:8px" title="Positions.csv and Orders.csv still hold the ${escHtml(PORTFOLIO_STALE.portfolioDate||'prior')} session (Zerodha only rewrites them when you place a new trade). They are EXCLUDED from today's booked P&L, held-suppression and open positions — Holdings.csv is used instead. Re-export them after your first trade today to bring them current.">⏳ Positions/Orders from ${escHtml(PORTFOLIO_STALE.portfolioDate||'prior session')} — excluded from today</span>`;
  }
  // v1121 (owner): Review After moved off the Performance grid and onto the board, where the
  // decision it informs actually happens. It is one number, so it is a pill, not a card.
  {
    const _rev=getEffectiveReviewDays();
    if(_rev>0){
      const _xp=TRADEBOOK_STATS?.exitPolicy||null;
      html+=` <span class="sb-tag" style="margin-left:8px" title="Automatic exit trigger learned from realised holds${_xp&&_xp.holdDays?` (realised baseline ${_xp.holdDays}d)`:''}: at ${_rev} days, a position with no unspent buying pressure becomes EXIT ALL. Target, stop and active selling still take precedence.">⚡ exit review ${_rev}d</span>`;
    }
  }
  if(SUPPRESSED_HELD>0)html+=` <span class="sb-tag" style="margin-left:8px" title="Stocks you already hold (Holdings + Positions + today's net Orders buys). Since v1070 they remain in the ranking and can be recommended again — buying adds to the existing position. See Open Positions below.">📌 ${SUPPRESSED_HELD} already held</span>`;
  if(SURV_HARD_REMOVED>0)html+=` <span class="sb-tag sb-tag-red" style="margin-left:4px" title="Weeded out by the configured surveillance rules in the Methodology table (hard filter).">⚠ ${SURV_HARD_REMOVED} surveillance removed</span>`;
  if(ALLOC_BLOCKED>0)html+=` <span class="sb-tag" style="margin-left:4px" title="Removed because no share can be allocated to them: no daily turnover, allocation rails below one share, no viable target after costs, or already held at a profit with no cushion for an add. Listed with the reason in Removed from rankings.">🚫 ${ALLOC_BLOCKED} not allocatable</span>`;
  if(tags.length){html+=`<span class="sb-sep">|</span>`;html+=tags.map(t=>`<span class="sb-tag">${t}</span>`).join('');}
  if(isFiltered)html+=`<button class="sb-clear" onclick="clearFilters()">✕ Clear filters</button>`;
  const el=document.getElementById('statusBar');
  if(el)el.innerHTML=html;
}

function clearFilters(){
  ['fSearch','fRisk','fRows'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const turnEl=document.getElementById('fMinTurnover');if(turnEl)turnEl.value='0';
  updateFilterPlaceholders();
  applyFilters();
  localStorage.removeItem(SCANNER_STORE);
}
function toggleHeaderMenu(){
  const menu=document.getElementById('headerMenu');
  if(!menu) return;
  const isHidden=menu.style.display==='none';
  if(isHidden){
    menu.style.display='block';
    ['goalPopover','requiredFilesPopover'].forEach(id=>{const p=document.getElementById(id);if(p)p.style.display='none';});
    if(!window._headerMenuClickListener){
      window._headerMenuClickListener=true;
      document.addEventListener('click',(e)=>{
        if(!e.target.closest('#headerMenu')&&!e.target.closest('#menuBtn')){
          const m=document.getElementById('headerMenu');if(m)m.style.display='none';
        }
      });
    }
  } else {
    menu.style.display='none';
  }
}
function toggleGoalPopover(){
  const pop=document.getElementById('goalPopover');
  if(!pop) return;
  const isHidden=pop.style.display==='none';
  if(isHidden){
    renderGoalPopover();
    pop.style.display='block';
    const req=document.getElementById('requiredFilesPopover');
    if(req) req.style.display='none';
    if(!window._goalPopoverClickListener){
      window._goalPopoverClickListener=true;
      document.addEventListener('click',(e)=>{
        if(!e.target.closest('#goalPopover')&&!e.target.closest('button[onclick*="toggleGoalPopover"]')){
          document.getElementById('goalPopover').style.display='none';
        }
      });
    }
  } else {
    pop.style.display='none';
  }
}
function toggleRequiredFilesPopover(){
  const pop=document.getElementById('requiredFilesPopover');
  if(!pop) return;
  const isHidden=pop.style.display==='none';
  if(isHidden){
    const goal=document.getElementById('goalPopover');
    if(goal) goal.style.display='none';
    pop.style.display='block';
    const content=document.getElementById('requiredFilesPopoverContent');
    if(FILE_LOAD_STATUS.files?.length){
      const src=FILE_LOAD_STATUS.source==='Drive'?'☁ Drive · restored':'📁 "'+escHtml(FILE_LOAD_STATUS.source||'Scanner Uploads')+'" ·';
      content.innerHTML=`<div style="font-size:14px;color:var(--t1);margin-bottom:8px;font-weight:700">${src} ${escHtml(FILE_LOAD_STATUS.when||'')}</div>${renderFileStatusList()}`;
    }else if(!content.innerHTML){
      const grid=document.getElementById('requiredFilesGrid');
      if(grid) content.innerHTML=grid.innerHTML;
    }
    if(!window._popoverClickListener){
      window._popoverClickListener=true;
      document.addEventListener('click',(e)=>{
        if(!e.target.closest('#requiredFilesPopover')&&!e.target.closest('button[onclick*="toggleRequiredFilesPopover"]')){
          document.getElementById('requiredFilesPopover').style.display='none';
        }
      });
    }
  } else {
    pop.style.display='none';
  }
}

async function filesFromDirectoryHandle(dirHandle){
  const files=[];
  async function walk(handle){
    for await(const entry of handle.values()){
      if(entry.kind==='file'){
        files.push(await entry.getFile());
      }else if(entry.kind==='directory'){
        await walk(entry);
      }
    }
  }
  await walk(dirHandle);
  return files;
}

async function getLocalUploadFolderFiles(){
  const root=FS.getActiveLocalDirectoryHandle?.();
  if(!root) return null;
  try{
    if(root.queryPermission&&await root.queryPermission({mode:'read'})!=='granted') return null;
    let uploadHandle=root;
    try{uploadHandle=await root.getDirectoryHandle('Scanner Uploads');}catch(e){}
    const files=await filesFromDirectoryHandle(uploadHandle);
    return files.length?{files,sourceLabel:uploadHandle.name||root.name||'Scanner Uploads'}:null;
  }catch(e){
    console.warn('Stored local upload folder could not be read',e);
    return null;
  }
}

let _folderWatchTimer=null,_folderWatchBusy=false,_folderWatchAllNseLastModified=null;
function getAllNseLastModified(files){
  const allNse=(files||[]).find(f=>isScannerCsvName(f?.name));
  return allNse?.lastModified ?? null;
}
// Small corner pill instead of the full loader/toast: auto-refresh must never interrupt.
function showAutoRefreshIndicator(state){
  let el=document.getElementById('autoRefreshPill');
  if(!el){
    el=document.createElement('div');
    el.id='autoRefreshPill';
    el.style.cssText="position:fixed;bottom:16px;left:16px;z-index:998;padding:6px 12px;border-radius:20px;background:var(--bg-raised);border:1px solid var(--border-hi);color:var(--t2);font-size:13px;font-family:'DM Mono',monospace;box-shadow:0 4px 16px rgba(0,0,0,.35);display:none;align-items:center;gap:6px";
    document.body.appendChild(el);
  }
  clearTimeout(el._hideTimer);
  if(state==='refreshing'){
    el.style.color='var(--t2)';
    el.innerHTML='<span style="display:inline-block;animation:sp 1s linear infinite">⟳</span> auto-refresh';
    el.style.display='flex';
  } else if(state==='done'){
    el.style.color='var(--green)';
    el.innerHTML='✓ updated '+fileStatusClock();
    el.style.display='flex';
    el._hideTimer=setTimeout(()=>{el.style.display='none';el.style.color='var(--t2)';},4000);
  } else {
    el.style.display='none';
  }
}
async function folderWatchTick(){
  if(_folderWatchBusy||document.hidden) return;
  try{
    const local=await getLocalUploadFolderFiles();
    if(!local?.files?.length) return;
    const lastModified=getAllNseLastModified(local.files);
    if(lastModified===null) return;
    if(_folderWatchAllNseLastModified===null){_folderWatchAllNseLastModified=lastModified;return;} // baseline, no re-run
    if(lastModified===_folderWatchAllNseLastModified)return; // unchanged since last ingest
    _folderWatchAllNseLastModified=lastModified;
    _folderWatchBusy=true;
    showAutoRefreshIndicator('refreshing');
    // A NEW ALL NSE MEANS A NEW DECISION, so the book it is scored against must be current too.
    // This runs BEFORE the ingest and writes into the same folder, so processFiles picks the fresh
    // files up in the same pass. It cannot block: a failure just leaves the existing files in place.
    try{ await refreshBrokerInputs(); }catch(e){}
    const fresh=await getLocalUploadFolderFiles();
    const use=(fresh&&fresh.files&&fresh.files.length)?fresh.files:local.files;
    const ok=await processFiles(use,local.sourceLabel+' · auto-refresh',{silent:true});
    showAutoRefreshIndicator(ok?'done':'hide');
  }catch(e){
    console.warn('Folder watch tick failed',e);
    showAutoRefreshIndicator('hide');
  }
  finally{_folderWatchBusy=false;}
}
function startFolderWatch(){
  if(_folderWatchTimer) return;
  _folderWatchTimer=setInterval(folderWatchTick,3000);
}

async function hydrateSessionCSVsFromPreferredInputs(reason='startup'){
  const local=await getLocalUploadFolderFiles();
  if(local?.files?.length){
    console.log(`${reason}: hydrating from local upload folder`,local.sourceLabel,local.files.length);
    return await processFiles(local.files,local.sourceLabel)?local.files.length:0;
  }
  console.log(`${reason}: local upload folder unavailable; falling back to Drive inputs`);
  return await hydrateSessionCSVsFromWorkspace();
}

async function openUploadFolderPicker(){
  if(window.showDirectoryPicker){
    const stored=await FS.getStoredUploadDirHandle();
    if(stored){
      try{
        let uploadHandle=stored;
        try{uploadHandle=await stored.getDirectoryHandle('Scanner Uploads');}catch(e){}
        let files=await filesFromDirectoryHandle(uploadHandle);
        if(files.length){
          try{ await refreshBrokerInputs(); }catch(e){}
          { const _f=await getLocalUploadFolderFiles(); if(_f&&_f.files&&_f.files.length) files=_f.files; }
          await processFiles(files,uploadHandle.name);
          return true;
        }
      }catch(e){
        console.warn('Stored upload folder could not be reused',e);
      }
    }
    try{
      const picked=await window.showDirectoryPicker({id:'rocket-scanner-uploads',mode:'readwrite'});
      let uploadHandle=picked;
      let localBrainHandle=picked;
      try{
        uploadHandle=await picked.getDirectoryHandle('Scanner Uploads');
        localBrainHandle=picked;
      }catch(e){}
      await FS.setLocalDirectoryHandle(localBrainHandle);
      let files=await filesFromDirectoryHandle(uploadHandle);   // v1203: reassigned below
      if(!files.length){
        showToast('No files found in the selected folder.',4000,true);
        return false;
      }
      try{ await refreshBrokerInputs(); }catch(e){}
          { const _f=await getLocalUploadFolderFiles(); if(_f&&_f.files&&_f.files.length) files=_f.files; }
          await processFiles(files,uploadHandle.name);
      return true;
    }catch(e){
      if(e?.name!=='AbortError'){
        console.error('Directory load failed',e);
        showToast('Could not load the selected folder: '+(e?.message||e),6000,true);
      }
      return false;
    }
  }
  const input=document.getElementById('fInDir');
  input.value='';
  input.click();
  return true;
}

async function handleCloudLoadAction(){
  // Keep the folder/file picker inside the original user click. Browser pickers need
  // transient user activation; awaiting Drive reads first makes the picker silently fail.
  updateFolderUI();
  if(!FS.isConnected()){
    showDriveAuthRequiredState();
    showToast('Connect Google Drive first, then press Load Files.',4000,true);
    return;
  }
  setMsg('Select the Rocket Scanner folder...');
  const opened=await openUploadFolderPicker();
  if(!opened) setLoading(false);
}

// ── Brain Export / Import ──
// Saves all accumulated knowledge (correlations, snapshot, methodology, filters, version)
// to a single JSON file that can be imported on any browser/device.
function exportBrain(){
  const brain=pruneBrainForStorage(FS.getBrain());
  const out={
    _exported:new Date().toISOString(),
    _version:'rscanner_brain_v1',
    ...brain
  };
  out._summary={
    market:'Stocks',
    stocks:brain[modeKey(ALL_STORE)]?.data?.length||0
  };
  const json=JSON.stringify(out);
  out._sizeKB=Math.round(json.length/1024);
  const blob=new Blob([json],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`rocket_brain_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  const s=out._summary;
  showToast(`<strong>Brain exported</strong> (${out._sizeKB} KB) · ${s.stocks} cached ranked stocks`);
}

function importBrain(event){
  const file=event.target.files[0];
  if(!file)return;
  const reader=new FileReader();
  reader.onload=async function(e){
    try{
      const brain=JSON.parse(e.target.result);
      const isExport=!!(brain._version&&brain._version.startsWith('rscanner_brain'));
      const isRawBrain=!!(brain&&typeof brain==='object'&&(brain[ALL_STORE]||brain[TRADEBOOK_STORE]||brain['rs_corr']||brain['rs_snapshot_mrmr_v1']||brain[SAME_DAY_EXIT_OPPORTUNITY_STORE]||brain[RECOMMEND_OUTCOME_STORE]));
      if(!isExport&&!isRawBrain){
        showToast('Invalid brain file — not a Rocket Scanner export.', 5000, true);return;
      }
      if(!FS.hasFolder()){
        showToast('Connect Google Drive first before importing a brain backup.', 5000, true);return;
      }
      // Export wrappers contain metadata; auto-saved rocket_brain.json is already raw brain data.
      let data=brain;
      if(isExport){
        const {_exported,_version,_summary,_sizeKB,...wrappedData}=brain;
        data=wrappedData;
      }
      data=pruneBrainForStorage(data);
      const ok=await FS.write(data);
      if(!ok){showToast('Failed to write brain file.', 5000, true);return;}
      showToast(`<strong>Brain imported</strong> · Reloading...`, 3000);
      setTimeout(()=>location.reload(),1500);
    }catch(err){
      showToast('Failed to parse brain file: '+err.message, 5000, true);
    }
  };
  reader.readAsText(file);
  event.target.value='';
}

function showBrainPrompt(){
  // Remove any existing toast
  const old=document.getElementById('brainToast');
  if(old) old.remove();
  const toast=document.createElement('div');
  toast.className='brain-toast';
  toast.id='brainToast';
  toast.innerHTML=`
    <div class="brain-toast-msg"><strong>Brain updated</strong></div>
    <button class="brain-toast-btn" onclick="exportBrain();document.getElementById('brainToast')?.remove()">💾 Export Brain</button>
    <button class="brain-toast-x" onclick="this.parentElement.remove()" title="Dismiss">✕</button>`;
  document.body.appendChild(toast);
  // Auto-dismiss after 15 seconds
  setTimeout(()=>{const t=document.getElementById('brainToast');if(t)t.remove();},15000);
}

function resetBrain(btn){
  // Stage 1: first click → ask for confirmation
  if(!btn._stage){
    btn._stage=1;
    btn.innerHTML='⚠ Clear learned brain data?';
    btn.style.background='rgba(239,68,68,.15)';
    setTimeout(()=>{if(btn._stage===1){btn._stage=0;btn.innerHTML='🗑 Reset Brain';btn.style.background='';btn.style.borderColor='rgba(239,68,68,.3)';}},4000);
    return;
  }
  // Stage 2: second click → final warning
  if(btn._stage===1){
    btn._stage=2;
    btn.innerHTML=`🗑 CONFIRM: clear saved app state?`;
    btn.style.background='rgba(239,68,68,.25)';btn.style.borderColor='var(--red)';btn.style.color='#fff';
    setTimeout(()=>{if(btn._stage===2){btn._stage=0;btn.innerHTML='🗑 Reset Brain';btn.style.background='';btn.style.borderColor='rgba(239,68,68,.3)';btn.style.color='var(--red)';}},6000);
    return;
  }
  // Stage 3: clear learned/runtime state. The next upload becomes a fresh baseline.
  FS.reset({});
  localStorage.removeItem(SCANNER_STORE);
  localStorage.removeItem(SHARED_FILTER_STORE);
  ALL=[]; FILT=[]; ENGINE_DATA={};
  RADAR={headers:[],matrix:[],features:[],ids:{},rockets:0,ms:0,sourceNote:'',scoredAt:null};
  HOLDINGS=[]; POSITIONS=[]; ORDERS_TODAY=null; TRADEBOOK_STATS=null; LAST_BUY_DATE_MAP={};
  HOLD_COST_MAP={}; SURV_CORR_ACC={};
  btn._stage=0;
  btn.innerHTML='🗑 Reset Brain';btn.style.background='';btn.style.borderColor='rgba(239,68,68,.3)';btn.style.color='var(--red)';
  showToast('<strong>Brain reset.</strong> Cleared saved app state and filters. The next upload rebuilds the ranking fresh. Uploaded input files remain in Google Drive.',7000);
  setTimeout(()=>location.reload(),2000);
}


// ── Holdings ──
let HOLD_COST_MAP={}; // {symbol: avgCost} — ALL rows including qty=0 for position cross-ref
function parseHoldings(text){
  const rows=parseCSV(text);
  if(!rows.length) return [];
  const hdrs=Object.keys(rows[0]);
  const symCol=findHeader(hdrs,[/^instrument$/i,/^symbol$/i,/^stock$/i,/^tradingsymbol$/i]);
  const qtyCol=findHeader(hdrs,[/^qty/i,/^quantity/i]);
  const avgCol=findHeader(hdrs,[/^avg/i,/^average.*cost/i,/^buy.*price/i]);
  const ltpCol=findHeader(hdrs,[/^ltp$/i,/^last.*price/i,/^price$/i,/^cur.*price/i]);
  if(!symCol||!qtyCol){console.warn('Holdings CSV: could not detect Symbol/Qty columns');return [];}
  // Build cost map from ALL rows (including sold/zero qty)
  HOLD_COST_MAP={};
  const all=rows.map(r=>{
    const sym=normSym(r[symCol]);
    const qty=num(r[qtyCol]);
    const avg=avgCol?num(r[avgCol]):null;
    const ltp=ltpCol?num(r[ltpCol]):null;
    if(!sym) return null;
    if(avg!=null) HOLD_COST_MAP[sym]=avg;
    return{symbol:sym,qty:qty||0,avgCost:avg,ltp};
  }).filter(Boolean);
  HOLDINGS_ALL=all;
  // Return only active holdings (qty>0) for the holdings tab
  return all.filter(h=>h.qty>0);
}

// ── Positions ──
function parsePositions(text){
  const rows=parseCSV(text);
  if(!rows.length) return [];
  const hdrs=Object.keys(rows[0]);
  const symCol=findHeader(hdrs,[/^instrument$/i,/^symbol$/i,/^tradingsymbol$/i]);
  const qtyCol=findHeader(hdrs,[/^qty/i,/^quantity/i]);
  const avgCol=findHeader(hdrs,[/^avg/i,/^average$/i]);
  const ltpCol=findHeader(hdrs,[/^ltp$/i,/^last.*price/i]);
  const pnlCol=findHeader(hdrs,[/^p&l$/i,/^p.l$/i,/^pnl$/i]);
  if(!symCol||!qtyCol){console.warn('Positions CSV: could not detect columns');return [];}
  return rows.map(r=>{
    const sym=normSym(r[symCol]);
    const qty=num(r[qtyCol]);
    const avg=avgCol?num(r[avgCol]):null;
    const ltp=ltpCol?num(r[ltpCol]):null;
    const pnl=pnlCol?num(r[pnlCol]):null;
    if(!sym||qty===null) return null;
    return{symbol:sym,qty,avg,ltp,pnl,isSell:qty<0};
  }).filter(Boolean);
}

function parseOrders(text){
  const rows=parseCSV(text);
  if(!rows.length) return [];
  const hdrs=Object.keys(rows[0]);
  const timeCol=findHeader(hdrs,[/^time$/i,/^timestamp$/i,/^date$/i]);
  const typeCol=findHeader(hdrs,[/^type$/i]);
  const symCol=findHeader(hdrs,[/^instrument$/i,/^symbol$/i,/^tradingsymbol$/i,/^stock$/i]);
  const qtyCol=findHeader(hdrs,[/^qty/i,/^quantity/i]);
  const priceCol=findHeader(hdrs,[/^avg.*price$/i,/^price$/i,/^avg.*trade/i]);
  const statusCol=findHeader(hdrs,[/^status$/i]);
  const productCol=findHeader(hdrs,[/^product$/i]);
  if(!symCol||!typeCol||!qtyCol||!priceCol||!statusCol){console.warn('Orders CSV: missing required columns');return [];}
  return rows.map(r=>{
    const status=String(r[statusCol]||'').trim().toUpperCase();
    if(status==='REJECTED') return null;
    const sym=normSym(r[symCol]);
    const type=String(r[typeCol]||'').trim().toUpperCase();
    if(!sym||!(type==='BUY'||type==='SELL')) return null;
    const qtyRaw=String(r[qtyCol]||'').trim();
    const qtyParts=qtyRaw.split('/');
    const qty=num(qtyParts[0]);
    const totalQty=qtyParts.length>1?num(qtyParts[1]):qty;
    const working=(status==='OPEN'||status==='TRIGGER PENDING'||status==='PENDING');
    const pending=(working&&totalQty!==null&&qty!==null)?Math.max(0,totalQty-qty):0;
    const price=num(r[priceCol]);
    if(qty===null||price===null) return null;
    if(qty===0&&!(pending>0)) return null;
    // v557: an undateable row must NOT be stamped with today's session date — that made a stale
    // Orders.csv (or one whose Time column failed to parse) masquerade as this session's trades.
    // Left empty, it simply never matches a "today" filter.
    const time=String(r[timeCol]||'').trim();
    const product=productCol?String(r[productCol]||'').trim().toUpperCase():'CNC';
    return {symbol:sym,type,qty,price,time,product,status,totalQty,pending};
  }).filter(Boolean);
}

function keepFullerTradebookHistory(candidate,sourcePath,lastModified){
  if(!candidate) return {stats:null,persist:null,ignored:false};
  const prior=FS.get(TRADEBOOK_STORE);
  const priorMeta=FS.get(TRADEBOOK_META_STORE);
  const priorN=prior?.tripsData?.length||prior?.roundTrips||0;
  const priorMetaN=priorMeta?.tripsDataLength||priorMeta?.roundTrips||0;
  const nextN=candidate?.tripsData?.length||candidate?.roundTrips||0;
  if((priorN>nextN||priorMetaN>nextN)&&nextN>0){
    const priorFirst=(prior.tripsData||[]).map(r=>r.buyDate||r.sellDate).filter(Boolean).sort()[0]||priorMeta?.firstDate||'';
    const nextFirst=(candidate.tripsData||[]).map(r=>r.buyDate||r.sellDate).filter(Boolean).sort()[0]||'';
    const baselineN=Math.max(priorN,priorMetaN);
    const isPartialExport=nextN<Math.max(10,Math.floor(baselineN*0.8)) || (priorFirst&&nextFirst&&nextFirst>priorFirst);
    if(isPartialExport){
      console.warn('Ignored partial tradebook export:',sourcePath||'TRADEBOOK.csv',nextN,'lots; prior metadata has',baselineN,'historical lots.');
      try{showToast(`Ignored partial TRADEBOOK.csv (${nextN} lots); prior full history had ${baselineN} lots.`,5000,true);}catch(e){}
      return {stats:prior||null,persist:null,meta:null,ignored:true};
    }
  }
  const stats={...candidate,_loadedThisSession:true};
  const dates=(candidate.tripsData||[]).map(r=>r.buyDate||r.sellDate).filter(Boolean).sort();
  const meta={
    tripsDataLength:candidate.tripsData?.length||0,
    roundTrips:candidate.roundTrips||0,
    firstDate:dates[0]||'',
    lastDate:dates[dates.length-1]||'',
    sourcePath,
    lastModified
  };
  return {stats,persist:{...candidate,sourcePath,lastModified},meta,ignored:false};
}

async function readNseArchiveEntryText(filename,entry){
  const fn=String(filename||'').toLowerCase();
  if(fn.endsWith('.gz')){
    if(typeof DecompressionStream==='undefined') throw new Error('This browser cannot decompress the NSE .gz security master.');
    const bytes=await entry.async('uint8array');
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new TextDecoder('utf-8').decode(await new Response(stream).arrayBuffer());
  }
  return entry.async('string');
}
function isNseTextReport(filename){
  return /\.(?:csv|txt|dat)$/i.test(filename)||/\.csv\.gz$/i.test(filename);
}
async function hydrateSessionCSVsFromWorkspace(){
  if(!FS.hasFolder()||!FS.readUploadText) return 0;
  const [csvFiles,zipEntry,scannerEntry]=await Promise.all([
    Promise.all([
      FS.readUploadText('Holdings.csv'),
      FS.readUploadText('Positions.csv'),
      FS.readUploadText('Orders.csv'),
      FS.readUploadText('TRADEBOOK.csv'),
      FS.readUploadText('NSE Holidays.csv'),
    ]),
    FS.readUploadFile('Reports-Daily-Multiple.zip'),
    FS.readUploadFile('ALL NSE.csv'),
  ]);
  const [holdFile,posFile,ordFile,tbFile,holFile]=csvFiles;
  const driveFiles=[
    holdFile&&{name:'Holdings.csv'},posFile&&{name:'Positions.csv'},ordFile&&{name:'Orders.csv'},
    tbFile&&{name:'TRADEBOOK.csv'},holFile&&{name:'NSE Holidays.csv'},zipEntry?.file&&{name:'Reports-Daily-Multiple.zip'},
    scannerEntry?.file&&{name:'ALL NSE.csv'}
  ].filter(Boolean);
  mergeFileLoadStatus('Drive',driveFiles,'not in Drive');
  if(holFile?.text){parseNSEHolidays(holFile.text);updateFileLoadStatus('NSE Holidays.csv','loaded');}
  // Parse NSE ZIP to populate NSE_BHAV, NSE_52W, NSE_SURV etc. for this session
  if(zipEntry?.file&&typeof JSZip!=='undefined'){
    try{
      const outerZip=await JSZip.loadAsync(zipEntry.file);
      async function _hydrateZipEntries(zipObj){
        for(const[filename,entry]of Object.entries(zipObj.files)){
          if(entry.dir) continue;
          const fn=filename.toLowerCase().split('/').pop();
          if(fn.endsWith('.zip')){
            try{const buf=await entry.async('arraybuffer');await _hydrateZipEntries(await JSZip.loadAsync(buf));}catch(e){console.warn('Nested zip error:',fn,e);}
            continue;
          }
          if(isNseTextReport(fn)){
            const text=await readNseArchiveEntryText(fn,entry);
            const type=detectNSE(fn,text);
            if(type) updateFileLoadStatusByNseType(type,'loaded');
          }
        }
      }
      await _hydrateZipEntries(outerZip);
      updateFileLoadStatus('Reports-Daily-Multiple.zip','loaded');
    }catch(e){console.warn('hydrateSessionCSVsFromWorkspace: ZIP parse failed',e);}
  }
  await refreshNseFundamentals();
  let scannerHydrated=false;
  if(scannerEntry?.file){
    try{scannerHydrated=await processScannerUpload(scannerEntry.file,'stock',{restoreOnly:true});}
    catch(e){
      console.error('hydrateSessionCSVsFromWorkspace: ALL NSE parse failed',e);
      showToast('Stored ALL NSE.csv could not be loaded: '+(e?.message||e),6000,true);
    }
    if(scannerHydrated) updateFileLoadStatus('ALL NSE.csv','loaded');
  }
  const updates={};
  if(holdFile?.text){
    HOLDINGS=parseHoldings(holdFile.text);
    PORTFOLIO_FILE_DATES.holdings=fileDateISO(holdFile.lastModified); // v1079
    updates[HOLD_STORE]={holdings:HOLDINGS,costMap:HOLD_COST_MAP,sourcePath:holdFile.path,lastModified:holdFile.lastModified};
    updateFileLoadStatus('Holdings.csv','loaded');
  }
  // v557: orders first — their row dates decide which session the portfolio snapshot belongs to.
  if(ordFile?.text){
    ORDERS_TODAY=parseOrders(ordFile.text);
    if(ORDERS_TODAY) ORDERS_TODAY._loadedThisSession=true;
    updates[ORDERS_STORE]={orders:ORDERS_TODAY,sourcePath:ordFile.path,lastModified:ordFile.lastModified};
    const _ord=resolvePortfolioStaleness();
    updateFileLoadStatus('Orders.csv',_ord.ordersStale?'stale':'loaded',_ord.ordersStale?`prior session ${_ord.portfolioDate||'unknown'} - excluded from today`:'');
  }
  if(posFile?.text){
    const today=getSessionDate();
    const positionsCurrent=isPositionsFileCurrent(posFile);
    POSITIONS=positionsCurrent?parsePositions(posFile.text):[];
    PORTFOLIO_FILE_DATES.positions=fileDateISO(posFile.lastModified); // v1079
    updates[POS_STORE]={positions:POSITIONS,sessionDate:today,sourcePath:posFile.path,lastModified:posFile.lastModified,sourceDate:inputFileSessionDate(posFile),stale:!positionsCurrent};
    updateFileLoadStatus('Positions.csv',positionsCurrent?'loaded':'stale',positionsCurrent?'':'stale - ignored');
  }
  if(tbFile?.text){
    const tb=parseTradebook(tbFile.text);
    if(tb){
      const selected=keepFullerTradebookHistory(tb,tbFile.path,tbFile.lastModified);
      TRADEBOOK_STATS=selected.stats;
      reconcileSameDayExitOpportunities();
      if(selected.persist) updates[TRADEBOOK_STORE]=selected.persist;
      if(selected.meta) FS.set(TRADEBOOK_META_STORE,selected.meta);
    }
    updateFileLoadStatus('TRADEBOOK.csv','loaded');
  }
  syncExecutedRecommendedEntries();
  const updateCount=Object.keys(updates).length;
  // Source-derived CSV state remains in memory for this session; brain stores learning only.
  // Join same-day exits with the day's ALL NSE high after all source files are hydrated.
  try{recordSameDayExitOpportunity(window._lastStockOutcomeScan);}catch(e){}
  return updateCount;
}

function parseTradebook(text){
  const rows=parseCSV(text);
  if(!rows.length) return null;
  const hdrs=Object.keys(rows[0]);
  const symCol=findHeader(hdrs,[/^symbol$/i,/^tradingsymbol$/i]);
  const dateCol=findHeader(hdrs,[/^trade_date$/i,/^date$/i]);
  const typeCol=findHeader(hdrs,[/^trade_type$/i,/^type$/i,/^buy.*sell/i]);
  const qtyCol=findHeader(hdrs,[/^quantity$/i,/^qty$/i]);
  const priceCol=findHeader(hdrs,[/^price$/i,/^trade_price$/i]);
  const timeCol=findHeader(hdrs,[/^order_execution_time$/i,/^time$/i]);
  if(!symCol||!typeCol||!qtyCol||!priceCol){console.warn('Tradebook CSV: missing columns');return null;}

  // Group trades by symbol
  const bySymbol={};
  rows.forEach(r=>{
    const sym=normSym(r[symCol]);
    const type=(r[typeCol]||'').trim().toLowerCase();
    const qty=num(r[qtyCol]);
    const price=num(r[priceCol]);
    const date=(r[dateCol]||'').trim();
    const time=(r[timeCol]||date).trim();
    if(!sym||!type||!qty||!price) return;
    if(!bySymbol[sym]) bySymbol[sym]=[];
    bySymbol[sym].push({type,qty:Math.abs(qty),price,date,time});
  });

  Object.keys(bySymbol).forEach(sym=>{
    bySymbol[sym]=bySymbol[sym].slice()
      .sort((a,b)=>String(a.time||'').localeCompare(String(b.time||'')))
      .map(t=>({type:t.type,qty:t.qty,price:t.price,date:t.date,time:t.time}));
  });
  TRADEBOOK_BUY_FILLS=Object.entries(bySymbol).flatMap(([symbol,trades])=>
    trades.filter(t=>t.type==='buy').map(t=>({symbol,date:t.date,time:t.time,qty:t.qty,price:t.price}))
  );

  // FIFO matching per symbol — only closed round trips
  const roundTrips=[];
  const openAvgCostMap={}; // {symbol: avgCost} — unmatched buy legs (open positions)
  const openPositionLotsMap={}; // {symbol:[{qty,date}]} — remaining FIFO lots for age calculations
  Object.entries(bySymbol).forEach(([sym,trades])=>{
    trades.sort((a,b)=>a.time.localeCompare(b.time));
    const buyQueue=[], shortQueue=[];
    const close=(b,t,qty,shortTrip)=>{
      const buyPrice=shortTrip?t.price:b.price, sellPrice=shortTrip?b.price:t.price;
      const holdDays=shortTrip?0:Math.round((new Date(t.date)-new Date(b.date))/86400000);
      roundTrips.push({sym,buyPrice,sellPrice,qty,
        pnlPct:((sellPrice-buyPrice)/buyPrice)*100,holdDays,capital:buyPrice*qty,
        buyDate:shortTrip?t.date:b.date,sellDate:shortTrip?b.date:t.date,
        buyTime:shortTrip?t.time:b.time,sellTime:shortTrip?b.time:t.time,
        shortTrip:!!shortTrip});
    };
    const byDate={};
    for(const t of trades) (byDate[t.date]??=[]).push(t);
    for(const date of Object.keys(byDate).sort()){
      const day=byDate[date];
      const dayBuys=day.filter(x=>x.type==='buy').map(x=>({...x}));
      const daySells=day.filter(x=>x.type==='sell').map(x=>({...x}));
      // (1) INTRADAY: the day's own buys against the day's own sells, FIFO within the day.
      let bi=0,si=0;
      while(bi<dayBuys.length&&si<daySells.length){
        const b=dayBuys[bi], sl=daySells[si];
        const m=Math.min(b.qty,sl.qty);
        if(m>0) close({price:b.price,date:b.date,time:b.time},{price:sl.price,date:sl.date,time:sl.time},m,false);
        b.qty-=m; sl.qty-=m;
        if(b.qty<=0) bi++;
        if(sl.qty<=0) si++;
      }
      // (2) What the day could not pair with itself meets the carried position, oldest first.
      for(const sl of daySells){
        let q=sl.qty;
        while(q>0&&buyQueue.length>0){
          const b=buyQueue[0];
          const m=Math.min(q,b.qty);
          close(b,sl,m,false);
          b.qty-=m; q-=m;
          if(b.qty<=0) buyQueue.shift();
        }
        // A sell beyond the inventory opens a SHORT rather than being discarded (v1175).
        if(q>0) shortQueue.push({qty:q,price:sl.price,date:sl.date,time:sl.time});
      }
      for(const b of dayBuys){
        let q=b.qty;
        while(q>0&&shortQueue.length>0){
          const sh=shortQueue[0];
          const m=Math.min(q,sh.qty);
          close(sh,{price:b.price,date:b.date,time:b.time},m,true);
          sh.qty-=m; q-=m;
          if(sh.qty<=0) shortQueue.shift();
        }
        if(q>0) buyQueue.push({qty:q,price:b.price,date:b.date,time:b.time});
      }
    }
    // Remaining unmatched buys = open position; compute qty-weighted avg cost
    if(buyQueue.length){
      const totalQty=buyQueue.reduce((s,b)=>s+b.qty,0);
      if(totalQty>0){
        openAvgCostMap[sym]=+(buyQueue.reduce((s,b)=>s+b.price*b.qty,0)/totalQty).toFixed(2);
        openPositionLotsMap[sym]=buyQueue
          .filter(b=>b.qty>0&&b.date)
          .map(b=>({qty:b.qty,date:b.date}));
      }
    }
  });

  if(!roundTrips.length) return null;

  const wins=roundTrips.filter(r=>r.pnlPct>0);
  const losses=roundTrips.filter(r=>r.pnlPct<=0);
  const winPcts=wins.map(r=>r.pnlPct).sort((a,b)=>a-b);
  const lossPcts=losses.map(r=>r.pnlPct).sort((a,b)=>a-b);
  const percentile=(arr,p)=>arr.length?arr[Math.min(Math.floor(arr.length*p),arr.length-1)]:0;
  const median=(arr)=>percentile(arr,0.5);

  const avgWinPct=meanArr(winPcts);
  const avgLossPct=meanArr(lossPcts);
  const medianWinPct=median(winPcts);
  const medianLossPct=median(lossPcts);
  const p75Win=percentile(winPcts,0.75);
  const p25Loss=percentile(lossPcts,0.25);
  const winRate=roundTrips.length>0?(wins.length/roundTrips.length*100):0;
  const avgHoldDays=meanArr(roundTrips.map(r=>r.holdDays));
  const avgCapital=meanArr(roundTrips.map(r=>r.capital));

  const baselineSL=roundPct05(Math.abs(medianLossPct));
  const baselineTGT=roundPct05(Math.abs(medianWinPct));
  const minExitPct=+Math.max(1,medianWinPct).toFixed(2);

  const stats={
    roundTrips:roundTrips.length, winners:wins.length, losers:losses.length,
    winRate:+winRate.toFixed(1),
    avgWinPct:+avgWinPct.toFixed(2), avgLossPct:+avgLossPct.toFixed(2),
    medianWinPct:+medianWinPct.toFixed(2), medianLossPct:+medianLossPct.toFixed(2),
    p75Win:+p75Win.toFixed(2), p25Loss:+p25Loss.toFixed(2),
    avgHoldDays:+avgHoldDays.toFixed(1), avgCapital:+Math.round(avgCapital),
    adaptiveSL:baselineSL, adaptiveTGT:baselineTGT, minExitPct,
    riskReward:+Math.abs(avgWinPct/avgLossPct).toFixed(2),
    openAvgCostMap, // {symbol: avgCost} from unmatched FIFO buy legs
    openPositionLotsMap, // {symbol:[{qty,date}]} for quantity-weighted open-position age
  };

  // Add netPnl (with charges) per trip and store full array for renderPerformance.
  // DP (₹15.34) is charged once per ISIN per sell day — track which combos already charged.
  const dpCharged=new Set();
  const tripsData=roundTrips.map(r=>{
    const intra=r.holdDays===0;
    const dpKey=r.sym+'|'+r.sellDate;
    const skipDp=intra||dpCharged.has(dpKey);
    if(!intra) dpCharged.add(dpKey);
    const bc=calcZerodhaCharges(r.buyPrice,r.qty,false,intra,false);
    const sc=calcZerodhaCharges(r.sellPrice,r.qty,true,intra,skipDp);
    const charges=+(bc+sc).toFixed(0);
    const buyCharges=+bc.toFixed(2), sellCharges=+sc.toFixed(2);
    const netPnl=+((r.sellPrice-r.buyPrice)*r.qty-charges).toFixed(0);
    const netPnlPct=r.capital>0?+(netPnl/r.capital*100).toFixed(2):r.pnlPct;
    return{...r,charges,buyCharges,sellCharges,netPnl,netPnlPct};
  });
  stats.tripsData=tripsData;
  refreshExitPolicyFromFeedback(stats);

  // Avg charge as % of turnover (buy+sell value) across all valid round trips
  const _ctTrips=tripsData.filter(r=>r.buyPrice>0&&r.sellPrice>0&&r.qty>0&&r.charges>=0);
  stats.avgChargePct=_ctTrips.length
    ? +Math.max(0,_ctTrips.reduce((s,r)=>s+r.charges/((r.buyPrice+r.sellPrice)*r.qty)*100,0)/_ctTrips.length).toFixed(3)
    : null;

  const bookedByDate={};
  tripsData.forEach(r=>{
    if(!bookedByDate[r.sellDate]) bookedByDate[r.sellDate]={total:0,count:0};
    bookedByDate[r.sellDate].total+=r.netPnl;
    bookedByDate[r.sellDate].count+=1;
  });
  const dates=Object.keys(bookedByDate).sort((a,b)=>new Date(b)-new Date(a));
  stats.lastBooked=dates.length?{
    date:dates[0],
    total:+bookedByDate[dates[0]].total.toFixed(0),
    count:bookedByDate[dates[0]].count
  }:null;

  // Build lastDate / lastDayRows / lastDayTotal for the latest-session panel
  const lastDate=dates.length?dates[0]:null;
  const lastDayBySym={};
  tripsData.filter(r=>r.sellDate===lastDate).forEach(r=>{
    if(!lastDayBySym[r.sym]) lastDayBySym[r.sym]={sym:r.sym,lots:0,buyVal:0,sellVal:0,qty:0,gross:0,charges:0};
    const e=lastDayBySym[r.sym];
    const sameDay=r.holdDays===0;
    const sessionCost=(Number(r.sellCharges)||0)+(sameDay?(Number(r.buyCharges)||0):0);
    e.lots++;e.buyVal+=r.buyPrice*r.qty;e.sellVal+=r.sellPrice*r.qty;e.qty+=r.qty;
    e.gross+=(r.sellPrice-r.buyPrice)*r.qty;
    e.charges+=sessionCost;
  });
  const lastDayRows=Object.values(lastDayBySym).map(e=>({
    sym:e.sym,lots:e.lots,
    qty:e.qty,
    capital:+e.buyVal.toFixed(2),
    buyPrice:e.qty>0?+(e.buyVal/e.qty).toFixed(2):0,
    sellPrice:e.qty>0?+(e.sellVal/e.qty).toFixed(2):0,
    charges:+e.charges.toFixed(0),
    grossPnl:+e.gross.toFixed(0),
    netPnl:+(e.gross-e.charges).toFixed(0),
    netPnlPct:e.buyVal>0?+((e.gross-e.charges)/e.buyVal*100).toFixed(2):null
  }));
  stats.lastDate=lastDate;
  stats.lastDayRows=lastDayRows;
  stats.lastDayTotal=+lastDayRows.reduce((s,r)=>s+r.netPnl,0).toFixed(0);

  // Build last buy date per symbol (latest buy trade date, no FIFO needed)
  const lastBuyDateMap={};
  Object.entries(bySymbol).forEach(([sym,trades])=>{
    const buys=trades.filter(t=>t.type==='buy').map(t=>t.date).filter(Boolean).sort();
    if(buys.length) lastBuyDateMap[sym]=buys[buys.length-1];
  });
  stats.lastBuyDateMap=lastBuyDateMap;
  LAST_BUY_DATE_MAP=lastBuyDateMap;


  console.log('TRADEBOOK:',stats.roundTrips,'round trips,',stats.winners,'winners ('+stats.winRate+'%), exit policy SL:'+stats.adaptiveSL+'% TGT:'+stats.adaptiveTGT+'% review:'+stats.holdLimitDays+'d');
  return stats;
}

// Zerodha charge calculator for one leg. Rates from Zerodha Equity Trading Charges.csv.
// isIntraday=true → MIS rates, false → CNC/delivery rates.
// skipDp=true suppresses the ₹15.34 DP charge (use for 2nd+ trips of same ISIN on same sell day).
function calcZerodhaCharges(price, qty, isSell, isIntraday, skipDp){
  return sumChargeParts(calcZerodhaChargesSplit(price,qty,isSell,!!isIntraday,!!skipDp));
}

// Returns per-component breakdown (same rates as calcZerodhaCharges).
function calcZerodhaChargesSplit(price, qty, isSell, isIntraday, skipDp){
  const posVal=price*Math.abs(qty);
  const brokerage=isIntraday?Math.min(0.0003*posVal,20):0;
  const stt=isIntraday?(isSell?0.00025*posVal:0):0.001*posVal;
  const txn=0.0000307*posVal;
  const sebi=0.000001*posVal;
  const gst=0.18*(brokerage+sebi+txn);
  const stamp=isSell?0:(isIntraday?0.00003:0.00015)*posVal;
  const dp=(isSell&&!isIntraday&&!skipDp)?15.34:0;
  return {brokerage,stt,txn,sebi,gst,stamp,dp};
}

function planBasketExport(capital, selected){
  const baseContext=getTodayTradeTimingContext();
  const timing=getCurrentTradeTimingDecision(baseContext);
  let exportList=(selected||[]).filter(s=>!getPriceBandBlockReason(s)
    &&meetsRecommendationBar(s)&&passesIntradayValidation(s));
  let basketAlloc=computeAlloc(capital,exportList);
  const legsFor=s=>{
    const qty=capital>0?(basketAlloc[s.symbol]?.qty||0):1;
    if(!(qty>0)) return 0;
    const policy=basketAlloc[s.symbol]?.exitPolicy||getRowExitPolicy(s,basketAlloc[s.symbol]?.buyPrice||s.price);
    const split=splitQty(qty);
    const runnerPct=getRunnerTargetPct(policy);
    return (split.runner>0&&runnerPct>policy.targetPct)?2:1;
  };
  const orderCount=()=>exportList.reduce((count,s)=>count+legsFor(s),0);
  while(exportList.length&&orderCount()>20){
    exportList=exportList.slice(0,-1);
    basketAlloc=computeAlloc(capital,exportList);
  }
  // timingBlocked is retained as a permanently-false field so existing callers keep working.
  return {exportList,basketAlloc,orderCount:orderCount(),timingBlocked:false,timing};
}


async function exportBasket(){
  const capital=getEffectiveCapital();
  const selList=FILT.filter(s=>SELECTED.has(s.symbol));
  if(!selList.length){showToast('Select at least one stock first.',3000,true);return;}
  const bandRejected=selList.filter(s=>getPriceBandBlockReason(s)).length;
  const {exportList,basketAlloc}=planBasketExport(capital,selList);
  const limitOmitted=Math.max(0,selList.length-bandRejected-exportList.length);

  const harvestPlan=computeHarvestPlan();
  const active=getActiveTargetInfo();

  const orders=[];
  let rejectedCount=bandRejected;
  let orderSeq=0;
  // One buy LEG. v1115: a stock now emits up to two of these — a BASE leg whose GTT sells at the
  // row's own target, and a RUNNER leg whose GTT sells further out. Each leg carries its own GTT, so
  // the split exit is armed the moment the buys fill and never needs re-arming by hand.
  const pushBuyOrder=(s,qty,targetPct,leg)=>{
    if(qty<=0||!(targetPct>0)) return;
    const sym=s.symbol;
    const name=s.name||sym;
    orders.push({
      id:Date.now()+orderSeq++,
      instrument:{
        tradingsymbol:sym,scripCode:'',type:'EQ',symbol:sym,
        segment:'NSE',exchange:'NSE',tickSize:0.01,lotSize:1,
        company:name,tradable:true,precision:2,
        fullName:sym,niceName:sym,niceNameHTML:sym,stockWidget:true,
        exchangeToken:0,instrumentToken:0,isin:'',
        related:[],underlying:null,auctionNumber:null,
        isEquity:true,isWeekly:false
      },
      weight:0,
      params:{
        transactionType:'BUY',product:'CNC',orderType:'MARKET',
        validity:'DAY',validityTTL:1,
        quantity:qty,price:0,
        triggerPrice:0,disclosedQuantity:0,lastPrice:Number(s.price)||0,
        variety:'regular',
        // v1083 (owner): TARGET ONLY. The stop leg is no longer exported — the owner manages losses
        // manually. The stop is still computed and shown (SL % column, Open Positions, allocation
        // sizing all keep using getRowStopDistancePct); it simply never leaves the app as an order.
        gtt:{target:targetPct},
        tags:[leg==='runner'?'RUN':'TGT']
      },
      _meta:{leg:leg||'base',sym,targetPct,fullQty:null}
    });
  };
  exportList.forEach(s=>{
    const am = basketAlloc[s.symbol];
    if(am?.rejected){rejectedCount++;return;} // skip cost-floor rejections
    const qty = capital > 0 ? (am?.qty || 0) : 1;
    if(qty===0) return;
    const policy=am?.exitPolicy||getRowExitPolicy(s,am?.buyPrice||s.price);
    if(!policy.viable){rejectedCount++;return;}
    pushBuyOrder(s,qty,policy.targetPct,'base');
  });
  orders.forEach(o=>{
    const total=orders.filter(x=>x._meta.sym===o._meta.sym).reduce((n,x)=>n+x.params.quantity,0);
    o._meta.fullQty=total;
  });

  if(!orders.length){showToast('Capital too low to buy even 1 share of any selected stock.',4000,true);return;}
  if(orders.length>20) throw new Error(`Basket planning invariant failed: ${orders.length} orders`);
  // Independent defense in depth: computeAlloc already applies this cap, but never save a
  // market order unless its notional is still at or below 0.10% of the latest daily turnover.
  const impactViolation=exportList.find(s=>{
    const am=basketAlloc[s.symbol];
    const qty=am?.qty||(capital>0?0:1);
    if(!(qty>0)) return false;
    const budgetPrice=am?.buyPrice||getBuyPrice(s);
    const turnoverCap=getTurnoverAllocationCap(s);
    return !(turnoverCap>0)||qty*budgetPrice>turnoverCap+0.01;
  });
  if(impactViolation){
    showToast(`Basket stopped: ${impactViolation.symbol} exceeds the 0.10% daily-turnover market-impact rail. Nothing exported.`,6000,true);
    return;
  }
  if(capital>0){
    // MARKET orders export with price: 0. Validate affordability against the
    // same buffered LTP references used by computeAlloc(), never against JSON price.
    const exportedDebit=exportList.reduce((sum,s)=>{
      const am=basketAlloc[s.symbol];
      const qty=am?.qty||0;
      const budgetPrice=am?.buyPrice||getBuyPrice(s);
      return sum+(am?.debit??((qty*budgetPrice)+calcZerodhaCharges(budgetPrice,qty,false,false,false)));
    },0);
    if(exportedDebit>capital+0.001){
      console.error('Basket exceeds capital',{capital,exportedDebit,orders});
      showToast(`Basket needs ${fmtINR(exportedDebit)} including estimated buy charges, above capital ${fmtINR(capital)}. Nothing exported.`,6000,true);
      return;
    }
  }
  // _meta is internal bookkeeping (which leg, which symbol) — it must never reach the saved file.
  const payload=orders.map(o=>{const c={...o};delete c._meta;return c;});
  const saved=await saveBasketToScannerUploads(payload,'Zerodha_Basket_Buy');
  if(!saved) return;
  const rejNote = rejectedCount>0
    ? ` · ${rejectedCount} skipped (eligibility/allocation)`
    : '';
  const targetNote=` · GTT target attached per leg · ≤0.10% daily turnover`;
  const srcLabel=active.source==='manual'?'manual':active.source==='goal'?'goal-led':'Harvest';
  const policySummary=summarizeRowExitPolicies(exportList.filter(s=>basketAlloc[s.symbol]?.qty>0));
  const targetRange=policySummary
    ?(Math.abs(policySummary.targetMax-policySummary.targetMin)<0.001?`${policySummary.targetMin.toFixed(2)}%`:`${policySummary.targetMin.toFixed(2)}–${policySummary.targetMax.toFixed(2)}%`)
    :'—';
  const planNote=` · per-stock targets ${targetRange} (${srcLabel} ${active.tgtPct.toFixed(2)}% anchor)`;
  const floorNote=harvestPlan.warning?` · target floor active`:``;
  const limitNote=limitOmitted>0?` · ${limitOmitted} lower-priority stock${limitOmitted===1?'':'s'} omitted to keep the basket within Zerodha's 20-order limit`:'';
  const marketNote=(MARKET_INTRADAY&&MARKET_INTRADAY.advPct!=null&&MARKET_INTRADAY.advPct<0.5)?` · market confirmation enforced at ${(MARKET_INTRADAY.advPct*100).toFixed(0)}% breadth`:'';
  const splitNote=` · one order per stock, each with its own target`;   // v1177: splits retired
  showToast(`<strong>Saved ${orders.length} CNC MARKET BUY orders</strong> for ${new Set(orders.map(o=>o._meta.sym)).size} stocks in Scanner Uploads as Zerodha_Basket_Buy JSON${splitNote}${targetNote}${planNote}${floorNote}${rejNote}${limitNote}${marketNote}`);
}

function splitQty(qty){
  const q=Math.floor(Number(qty)||0);
  if(q<=0) return {base:0,runner:0};
  if(q<2) return {base:q,runner:0};
  const base=Math.ceil(q/2);
  return {base,runner:q-base};
}
function getRunnerTargetPct(policy){
  const base=Number(policy&&policy.targetPct);
  if(!(base>0)) return null;
  const reach=getReachableTargets();
  const cap=Number(policy&&policy.capacityPct);
  const want=reach.runnerPct>0?reach.runnerPct:(cap>0?cap*1.5:base);
  return Math.max(base,Math.floor(want*20)/20);
}
async function saveBasketToScannerUploads(orders, filename){
  if(orders.length>20) throw new Error(`Refusing to truncate basket with ${orders.length} orders`);
  const root=await FS.getStoredUploadDirHandle?.().catch(()=>null);
  if(!root){
    showToast('Open the Scanner Uploads folder first, then export the basket again.',5000,true);
    return false;
  }
  let uploadHandle=root;
  if(uploadHandle.name!=='Scanner Uploads'){
    try{uploadHandle=await uploadHandle.getDirectoryHandle('Scanner Uploads');}
    catch(e){uploadHandle=null;}
  }
  if(!uploadHandle){
    showToast('Scanner Uploads folder was not found under the selected local folder.',5000,true);
    return false;
  }
  try{
    if(uploadHandle.queryPermission&&await uploadHandle.queryPermission({mode:'readwrite'})!=='granted'){
      showToast('Write access to Scanner Uploads is not available. Re-open the folder and try again.',6000,true);
      return false;
    }
    const fileHandle=await uploadHandle.getFileHandle(filename+'.json',{create:true});
    const writable=await fileHandle.createWritable();
    await writable.write(JSON.stringify(orders,null,2));
    await writable.close();
    return true;
  }catch(e){
    console.error('Basket save failed',e);
    showToast('Could not save the basket into Scanner Uploads: '+(e?.message||e),6000,true);
    return false;
  }
}

function switchTab(n){
  document.querySelectorAll('#mainTabs .tab').forEach((t,i)=>t.classList.toggle('act',i===n));
  document.querySelectorAll('.tp').forEach((t,i)=>t.classList.toggle('act',i===n));
  updateTabCounts();
  if(n===1) renderMethodology();
  if(n===2) renderPerformance();
  if(n===3) renderPostClose();
  // v1101: a hidden grid has clientWidth 0, so balancing on the tab it lives in is the only moment
  // the column count can actually be computed. rAF lets the tab paint first.
  requestAnimationFrame(balanceGrids);
}
function updateTabCounts(){
  const c0=document.getElementById('tabCount0');
  const c1=document.getElementById('tabCount1');
  const c3=document.getElementById('tabCount3');
  if(c0) c0.textContent=FILT.length?'('+FILT.length+')':'';
  if(c1) c1.textContent=RADAR.features.length?'('+RADAR.features.length+')':'';
  if(c3){const s=postCloseAuditStatus();c3.textContent=s.audit?'(✓)':'';}
}

// ── NSE Direct Fetch ──
function nseDate(){
  // Returns {ddmmyyyy, ddmmyy} for the previous TRADING day
  // Skips weekends; NSE holidays are not enumerable so we skip Sat/Sun only
  const d=new Date();
  d.setDate(d.getDate()-1);            // start from yesterday
  const dow=d.getDay();
  if(dow===0) d.setDate(d.getDate()-2); // Sun → Fri
  if(dow===6) d.setDate(d.getDate()-1); // Sat → Fri
  const dd=String(d.getDate()).padStart(2,'0');
  const mm=String(d.getMonth()+1).padStart(2,'0');
  const yyyy=String(d.getFullYear());
  const yy=yyyy.slice(2);
  return{ddmmyyyy:dd+mm+yyyy, ddmmyy:dd+mm+yy, label:`${dd}-${mm}-${yyyy}`};
}


// ── File Processing ──
function setMsg(m){document.getElementById('ldMsg').textContent=m;}
function setLoadMsg(m){
  const source=String(FILE_LOAD_STATUS?.source||'').trim();
  setMsg(source?`${m} · ${source}`:m);
}
function setLoading(on,msg){
  const el=document.getElementById('ldSt');
  if(msg) setMsg(msg);
  if(el) el.classList.toggle('on',!!on);
}
function getExpectedInputFiles(){
  const nd=nseDate();
  const c=istClock(),todayDd=String(c.day).padStart(2,'0')+String(c.month).padStart(2,'0')+String(c.year);
  const currentReportDate=c.mins>=DAY_END_MIN?todayDd:nd.ddmmyyyy;
  const zipKey='Reports-Daily-Multiple.zip';
  const canonical=[
    {key:'ALL NSE.csv',label:'📈 ALL NSE.csv',match:name=>isScannerCsvName(name)},
    {key:zipKey,label:'🏛 Reports-Daily-Multiple.zip',match:name=>isReportsZipName(name)},
    {key:'Holdings.csv',label:'🛡 Holdings.csv',match:name=>isExactCsvName(name,'Holdings.csv')},
    {key:'Positions.csv',label:'📊 Positions.csv',match:name=>isExactCsvName(name,'Positions.csv')},
    {key:'Orders.csv',label:'🧾 Orders.csv',match:name=>isExactCsvName(name,'Orders.csv')},
    {key:'TRADEBOOK.csv',label:'📒 TRADEBOOK.csv',match:name=>isExactCsvName(name,'TRADEBOOK.csv')},
    {key:'NSE Holidays.csv',label:'📅 NSE Holidays.csv',match:name=>isExactCsvName(name,'NSE Holidays.csv')},
  ];
  const nse=[
    {key:'block.csv',label:'block.csv',parent:zipKey,nseType:'block'},
    {key:'bulk.csv',label:'bulk.csv',parent:zipKey,nseType:'bulk'},
    {key:'CM_52_wk_High_low_'+nd.ddmmyyyy+'.csv',label:'CM_52_wk_High_low_'+nd.ddmmyyyy+'.csv',parent:zipKey,nseType:'52w'},
    {key:'REG1_IND'+nd.ddmmyy+'.csv',label:'REG1_IND'+nd.ddmmyy+'.csv',parent:zipKey,nseType:'surv'},
    {key:'sec_bhavdata_full_'+nd.ddmmyyyy+'.csv',label:'sec_bhavdata_full_'+nd.ddmmyyyy+'.csv',parent:zipKey,nseType:'bhav'},
    {key:'sec_list_'+nd.ddmmyyyy+'.csv',label:'sec_list_'+nd.ddmmyyyy+'.csv',parent:zipKey,nseType:'price_band'},
    {key:'MA'+nd.ddmmyy+'.csv',label:'MA'+nd.ddmmyy+'.csv (Market Activity)',parent:zipKey,nseType:'market'},
    {key:'C_VAR1_'+currentReportDate+'_6.DAT',label:'C_VAR1_'+currentReportDate+'_6.DAT (VaR EOD)',parent:zipKey,nseType:'var_eod'},
    {key:'eq_band_changes_'+currentReportDate+'.csv',label:'eq_band_changes_'+currentReportDate+'.csv',parent:zipKey,nseType:'band_change'},
    {key:'NSE_CM_security_'+nd.ddmmyyyy+'.csv.gz',label:'NSE_CM_security_'+nd.ddmmyyyy+'.csv.gz',parent:zipKey,nseType:'security_master'},
  ];
  return {canonical,nse,all:[...canonical,...nse]};
}
function fileStatusClock(){const c=istClock();return String(c.h).padStart(2,'0')+':'+String(c.m).padStart(2,'0')+' IST';}
function getReadableStatusNames(files=[]){
  return (files||[]).map(f=>f?.name||f?.path||f).filter(Boolean);
}
function isExpectedStatusPresent(item,names){
  const hasZip=names.some(name=>isReportsZipName(name));
  return item.parent?hasZip:names.some(name=>item.match?.(name));
}
function setFileLoadStatus(source,files=[],missingNote='not in folder'){
  const expected=getExpectedInputFiles();
  const names=getReadableStatusNames(files);
  FILE_LOAD_STATUS={source:source||null,when:fileStatusClock(),files:expected.all.map(item=>{
    const present=isExpectedStatusPresent(item,names);
    return {key:item.key,label:item.label,parent:item.parent||null,state:present?'pending':'missing',note:present?'':missingNote};
  })};
  renderFileLoadStatus();
}
function mergeFileLoadStatus(source,files=[],missingNote='not in Drive'){
  const names=getReadableStatusNames(files);
  if(!FILE_LOAD_STATUS.files?.length){
    setFileLoadStatus(source,files,missingNote);
    return;
  }
  if(!names.length){
    renderFileLoadStatus();
    return;
  }
  const expected=getExpectedInputFiles();
  const byKey=new Map(FILE_LOAD_STATUS.files.map(item=>[item.key,item]));
  expected.all.forEach(item=>{
    if(!isExpectedStatusPresent(item,names)) return;
    const existing=byKey.get(item.key);
    if(existing){existing.state='pending';existing.note='';}
    else FILE_LOAD_STATUS.files.push({key:item.key,label:item.label,parent:item.parent||null,state:'pending',note:''});
  });
  FILE_LOAD_STATUS.source=source||FILE_LOAD_STATUS.source;
  FILE_LOAD_STATUS.when=fileStatusClock();
  renderFileLoadStatus();
}
function updateFileLoadStatus(key,state,note=''){
  const item=FILE_LOAD_STATUS.files?.find(f=>f.key===key);
  if(!item) return;
  item.state=state;item.note=note;renderFileLoadStatus();
}
function updateFileLoadStatusByNseType(type,state='loaded',note=''){
  const item=getExpectedInputFiles().nse.find(f=>f.nseType===type);
  if(item) updateFileLoadStatus(item.key,state,note);
}
function renderFileStatusList(){
  if(!FILE_LOAD_STATUS.files?.length) return '';
  const icon={pending:'…',loaded:'✓',stale:'⚠',missing:'—'};
  const color={pending:'var(--t2)',loaded:'var(--green)',stale:'var(--amber)',missing:'var(--t3)'};
  return `<div style="display:grid;grid-template-columns:1fr;gap:2px">${FILE_LOAD_STATUS.files.map(f=>`<div style="display:flex;gap:7px;align-items:flex-start;color:${color[f.state]||'var(--t2)'};${f.parent?'padding-left:18px;font-size:12.5px':''}"><span style="width:12px;text-align:center;font-weight:800">${icon[f.state]||'…'}</span><span style="flex:1;color:var(--t2)">${escHtml(f.label)}${f.note?` <span style="color:${color[f.state]||'var(--t3)'}">(${escHtml(f.note)})</span>`:''}</span></div>`).join('')}</div>`;
}
function renderFileLoadStatus(){
  const el=document.getElementById('fileLoadChecklist');
  if(el) el.innerHTML=renderFileStatusList();
}

function captureScannerRuntime(){
  return {
    mode:MARKET_MODE,ALL,FILT,RADAR,_tvLoadedThisSession,
    lastRawTV:window._lastRawTV,lastScannerSessionTag:window._lastScannerSessionTag
  };
}
function restoreScannerRuntime(s){
  MARKET_MODE=s.mode;ALL=s.ALL;FILT=s.FILT;RADAR=s.RADAR;_tvLoadedThisSession=s._tvLoadedThisSession;
  window._lastRawTV=s.lastRawTV;window._lastScannerSessionTag=s.lastScannerSessionTag;
}
function compactRankingRows(rows){
  // Compact startup-display cache for the Radar composite ranking. Group parts and the
  // per-feature contribution list are session-only; a fresh upload restores full detail.
  return (rows||[]).map(s=>({
    symbol:s.symbol,name:s.name,sector:s.sector,
    price:s.price,day:s.day,priceChange:s.priceChange,
    score:s.score,rocketScore:s.rocketScore,rank:s.rank,
    setup:s.setup,risk:s.risk,series:s.series,band:s.band??null,status:s.status,
    basketEligible:s.basketEligible!==false,eqEligible:s.eqEligible!==false,
    stretch:s.stretch,rangePct:s.rangePct,sessionVolatilityPct:s.sessionVolatilityPct??null,open1d:s.open1d??null,relvol:s.relvol??null,gap:s.gap??null,depthImbalance:s.depthImbalance??null,depthPct:s.depthPct??null,depthLive:!!s.depthLive,
    gapSigned:s.gapSigned??null,changeOpen:s.changeOpen??null,
    turnover:s.turnover,atr:s.atr??null,quality:s.quality??null,
    high1d:s.high1d??null,low1d:s.low1d??null,vwap:s.vwap??null,bollUpper:s.bollUpper??null,keltUpper:s.keltUpper??null,
    price1h:s.price1h??null,price15m:s.price15m??null,price5m:s.price5m??null,
    stage:s.stage??null,stageLabel:s.stageLabel??null,legTrendPct:s.legTrendPct??null,legHighPct:s.legHighPct??null,
    fundamentalTrigger:Number(s.fundamentalTrigger)||0,fundamental:s.fundamental||null,
    modelTriggers:(s.modelTriggers||[]).slice(0,12),recommendationTriggerBlocked:!!s.recommendationTriggerBlocked,recommendationTriggerReasons:(s.recommendationTriggerReasons||[]).slice(0,12),
    igniteReady:!!s.igniteReady,igniteStrength:s.igniteStrength??null,ignitePct:s.ignitePct??0,compositePct:s.compositePct??null,setupPct:s.setupPct??null,upStreak:s.upStreak??null,upStreakPct:s.upStreakPct??null,feasibility:s.feasibility??null,directionConfirmed:!!s.directionConfirmed,marketCap:s.marketCap??null,
    entryReady:s.entryReady!==false,entryTiming:s.entryTiming||null,
    preResults:s.preResults?{resultsDate:s.preResults.resultsDate,resultsSource:s.preResults.resultsSource,
      daysToResults:s.preResults.daysToResults,weekChangePct:s.preResults.weekChangePct,
      driftPct:s.preResults.driftPct??null,driftSource:s.preResults.driftSource??null,
      quietRise:!!s.preResults.quietRise,inWindow:!!s.preResults.inWindow,drift:!!s.preResults.drift}:null,
    r4d:s.r4d?{inDigestion:!!s.r4d.inDigestion,daysSinceResults:s.r4d.daysSinceResults??null,resultsDayMovePct:s.r4d.resultsDayMovePct??null,topDecileCut:s.r4d.topDecileCut??null,wasResultsRocket:s.r4d.wasResultsRocket??null,reaccumulating:!!s.r4d.reaccumulating,blocked:!!s.r4d.blocked,reason:s.r4d.reason||null}:null,
    rocketReady:!!s.rocketReady,gateReasons:(s.gateReasons||[]).slice(0,9),_held:!!s._held,
    meta:{delivery:s.meta?.delivery??null,trades:s.meta?.trades??null,flags:(s.meta?.flags||[]).slice(0,12),band:s.meta?.band??null}
  }));
}
function applySavedFiltersForMode(mode){
  const ids=['fSearch','fRisk','fRows','fMinTurnover','fCapital','fMaxAlloc','fRiskPerTrade'];
  const prev={};
  ids.forEach(id=>{const el=document.getElementById(id);if(el)prev[id]=el.value;});
  try{
    const st=JSON.parse(localStorage.getItem(modeKey(SCANNER_STORE,mode))||'{}');
    const shared=JSON.parse(localStorage.getItem(SHARED_FILTER_STORE)||'{}');
    const map={risk:'fRisk',rows:'fRows',minTurnover:'fMinTurnover'};
    Object.entries(map).forEach(([k,id])=>{const el=document.getElementById(id);if(el&&st[k]!=null)el.value=st[k];});
    const capEl=document.getElementById('fCapital');if(capEl&&shared.capital!=null)capEl.value=shared.capital;
    const maxEl=document.getElementById('fMaxAlloc');if(maxEl&&shared.maxAlloc!=null)maxEl.value=shared.maxAlloc;
    const rkEl=document.getElementById('fRiskPerTrade');if(rkEl&&shared.riskPerTrade!=null)rkEl.value=shared.riskPerTrade;
  }catch(e){}
  return ()=>ids.forEach(id=>{const el=document.getElementById(id);if(el&&prev[id]!=null)el.value=prev[id];});
}async function processScannerUpload(scannerFile, mode, options={}){
  if(!scannerFile) return false;
  // App receipt time remains the one session clock. File metadata, Drive metadata
  // and BUILD_TS are deployment/storage facts, never trading-session facts.
  const receivedAt=Date.now();
  const original=captureScannerRuntime();
  const restoreFilters=applySavedFiltersForMode(mode);
  let completed=false;
  MARKET_MODE=mode;
  try{
    setLoadMsg('Parsing stock TradingView data...');
    const text=await scannerFile.text();
    const raw=parseCSV(text);
    const ok=isAllNseFilename(scannerFile.name)||looksLikeAllNseRows(raw);
    if(!ok){console.warn('Non-scanner CSV ignored:',scannerFile.name,'rows:',raw.length);return false;}
    setLoadMsg('Scoring '+raw.length+' stocks with the Radar composite...');
    await new Promise(r=>setTimeout(r,60));
    window._lastRawTV=raw;
    const sessionTag=scannerSessionTag(scannerFile.name,raw,text);
    const uploadSession=getModelTradingDate(receivedAt);
    window._lastScannerSessionTag=sessionTag;
    ALL=radarScoreRows(raw);
    // v1076: build the regime AFTER scoring — it needs the zip's index rows plus the live intraday
    // breadth that radarScoreRows computes. Display + outcome stamping only; never a scoring input.
    try{MARKET_REGIME=buildMarketRegime();}catch(e){console.warn('regime build failed',e);MARKET_REGIME=null;}
    const fileTag=scannerFile.name+' · '+raw.length+' stocks';
    try{const ft=document.getElementById('fileTag');if(ft)ft.textContent=fileTag;}catch(e){}
    FS.set(modeKey(ALL_STORE,mode),{schema:ALL_STORE_SCHEMA,data:compactRankingRows(ALL),fileTag,rockets:RADAR.rockets,continuationCount:RADAR.continuationCount,featureCount:RADAR.features.length,ts:new Date().toISOString()});
    if(mode==='stock'){
      // The Harvest target and executed-entry feedback keep learning from flagged
      // candidates' later attainable highs; the scorer itself stays stateless.
      const threshold=getEffectiveTgtPct()||TRADEBOOK_STATS?.adaptiveTGT||4;
      const eligibleCandidates=getDisplayedEntryCandidates(ALL).filter(s=>s.price>0);
      // v1128: plus a stratified control sample from the bands BELOW the bar, so those bands are
      // observed on every session rather than only on the days they reach the top 20.
      const controlRows=getScoreBandControlSample(ALL,new Set(eligibleCandidates.map(s=>s.symbol)));
      const controlSet=new Set(controlRows.map(s=>s.symbol));
      const allocCtx=getAllocationPassContext();
      const recommendations=eligibleCandidates.concat(controlRows)
        .map((s,i)=>{
          let targetPct=null,stopPct=null,targetReachable=null;
          try{
            const pol=getRowExitPolicy(s,getBuyPrice(s),allocCtx?.active);
            targetPct=Number(pol?.targetPct)>0?Number(pol.targetPct):null;
            stopPct=Number(pol?.stopPct)>0?Number(pol.stopPct):null;
            targetReachable=pol?.reachable===true;
          }catch(e){}
          return {symbol:s.symbol,entryPrice:s.price,score:s.score,rank:i+1,
            // v1128: a control row is graded exactly like a pick but is NOT one — it is excluded
            // from every recommendation metric so the app never reports buying what it did not.
            control:controlSet.has(s.symbol)||undefined,
            stage:Number.isFinite(+s.stage)?+s.stage:null,
            upStreak:Number.isFinite(+s.upStreak)?+s.upStreak:null,
            upStreakPct:Number.isFinite(+s.upStreakPct)?+s.upStreakPct:null,
            compositePct:Number.isFinite(+s.compositePct)?+s.compositePct:null,
            ignitePct:Number.isFinite(+s.ignitePct)?+s.ignitePct:null,
            setupPct:Number.isFinite(+s.setupPct)?+s.setupPct:null,
            directionConfirmed:!!s.directionConfirmed,
            rocketReady:s.rocketReady===true,
            targetReachable,
            fundamentalTrigger:Number.isFinite(Number(s.fundamentalTrigger))?Number(s.fundamentalTrigger):0,
            radarRank:s.rank??null,entryReady:s.entryReady!==false,entryTiming:s.entryTiming||null,
            targetPct,stopPct,
            high1dAtIssue:Number(s.high1d)>0?Number(s.high1d):null,
            low1dAtIssue:Number(s.low1d)>0?Number(s.low1d):null,
            issueMinute:(()=>{const c=istClock();return Number.isFinite(c&&c.mins)?c.mins-DAY_START_MIN:null;})(),
            issueClock:(()=>{const c=istClock();if(!c||!Number.isFinite(c.mins))return null;
              const h=Math.floor(c.mins/60),m=c.mins%60;
              return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');})(),
            rocketOutcome:ROCKET_OUTCOME.PENDING,rocketHorizonDays:ROCKET_HORIZON_DAYS,
            features:{}};
        });
      window._lastObservedDailyMoves=buildObservedDailyMoves(raw);
      window._lastStockOutcomeScan={
        date:uploadSession,sourceDate:uploadSession,ts:receivedAt,threshold,
        rows:window._lastObservedDailyMoves||[],
        recommendations
      };
      recordRecommendationOutcomeScan(window._lastStockOutcomeScan);
      const completedAudit=runPostCloseAudit(); // inert before 16:00; refreshed close can arm gates for the next issue
      if(completedAudit)applyLearnedRecommendationGates(ALL);
      recordDisplayedEntryCohort({date:uploadSession,candidates:eligibleCandidates});
      // Indicator-orientation watch: fire-and-forget so compression never delays rankings.
      recordIndicatorWatch(uploadSession).catch(e=>console.warn('indicator watch record failed',e));
      try{recordSessionWatch(uploadSession,receivedAt,raw);}catch(e){console.warn('session watch failed',e);}
      syncExecutedRecommendedEntries();
    }
    FILT=[...ALL];_tvLoadedThisSession=true;
    completed=true;
    return true;
  }finally{
    restoreFilters();
    if(!completed) restoreScannerRuntime(original);
  }
}

function parseMarketDepth(text){
  const rows=parseCSV(text);
  if(!rows||!rows.length) return 0;
  let n=0,date='',time='',adv=0,dec=0,unch=0;
  for(const r of rows){
    const sym=normSym(r['Symbol']||'');
    if(!sym) continue;
    const b=Number(r['BuyQty'])||0, sl=Number(r['SellQty'])||0, tot=b+sl;
    const imbRaw=r['Imbalance'];
    NSE_DEPTH[sym]={
      series:String(r['Series']||'').trim().toUpperCase(),
      iep:Number(r['IEP'])||0, prevClose:Number(r['PrevClose'])||0,
      gapPct:Number(r['GapPct']),
      buyQty:b, sellQty:sl, bookQty:tot,
      // Recomputed rather than trusted: a stored ratio and its own numerator must not disagree.
      imbalance:tot>0?(b-sl)/tot:null,
      atoBuyQty:Number(r['AtoBuyQty'])||0, atoSellQty:Number(r['AtoSellQty'])||0,
      preOpenQty:Number(r['PreOpenQty'])||0, preOpenTurnover:Number(r['PreOpenTurnover'])||0,
      bidTop:Number(r['BidTop'])||0, askTop:Number(r['AskTop'])||0
    };
    date=date||String(r['BookDate']||''); time=time||String(r['BookTime']||'');
    if(!adv){adv=Number(r['MktAdvances'])||0;dec=Number(r['MktDeclines'])||0;unch=Number(r['MktUnchanged'])||0;}
    n++;
  }
  NSE_DEPTH_META=n?{date,time,rows:n,advances:adv,declines:dec,unchanged:unch}:null;
  return n;
}

function deriveLiveBookImbalance(book,row){
  if(!book) return null;
  const B=+book.buyQty||0, S=+book.sellQty||0, tot0=B+S;
  if(!(tot0>0)) return null;
  const H=+row.high1d, L=+row.low1d, P=+row.price, V=+row.dayVolume;
  // No usable range or volume yet: the book stands as it opened. Fail to the known quantity.
  if(!(V>0)||!(H>L)||!(P>0)) return {imb:(B-S)/tot0,source:'pre-open',signedVol:0,bookWeight:1};
  const mult=((P-L)-(H-P))/(H-L);
  const signed=V*Math.max(-1,Math.min(1,mult));
  const w=Math.max(0,1-(V/tot0));
  const num=(B-S)*w+signed, den=tot0*w+V;
  if(!(den>0)) return {imb:0,source:'consumed',signedVol:signed,bookWeight:0};
  return {imb:num/den,source:'rolled',signedVol:signed,mult,bookWeight:w};
}
const DEPTH_MARKET_STORE='rs_depth_market_v1';
function buildDepthMarketRead(){
  const meta=NSE_DEPTH_META;
  if(!meta) return null;
  const eq=Object.keys(NSE_DEPTH).map(k=>NSE_DEPTH[k])
    .filter(r=>r.series==='EQ'&&r.imbalance!=null&&r.bookQty>=DEPTH_MIN_BOOK_QTY);
  if(eq.length<50) return null;
  const im=eq.map(r=>r.imbalance).sort((a,b)=>a-b);
  const med=im[Math.floor(im.length/2)];
  const totBuy=eq.reduce((n,r)=>n+r.buyQty,0), totSell=eq.reduce((n,r)=>n+r.sellQty,0);
  const wtd=(totBuy+totSell)>0?(totBuy-totSell)/(totBuy+totSell):null;
  const bookBreadth=eq.filter(r=>r.imbalance>0).length/eq.length;
  const adv=+meta.advances||0, dec=+meta.declines||0;
  const priceBreadth=(adv+dec)>0?adv/(adv+dec):null;
  return {date:meta.date,time:meta.time,n:eq.length,
          medianImbalance:med,weightedImbalance:wtd,bookBreadth,priceBreadth,
          divergence:(priceBreadth!=null)?(bookBreadth-priceBreadth):null,
          totalBuyQty:totBuy,totalSellQty:totSell,advances:adv,declines:dec};
}
function recordDepthMarketRead(){
  try{
    const r=buildDepthMarketRead();
    if(!r||!r.date) return;
    const store=FS.get(DEPTH_MARKET_STORE)||{days:{}};
    store.days=store.days||{};
    store.days[r.date]={med:+r.medianImbalance.toFixed(4),
      wtd:r.weightedImbalance!=null?+r.weightedImbalance.toFixed(4):null,
      bookBreadth:+r.bookBreadth.toFixed(4),
      priceBreadth:r.priceBreadth!=null?+r.priceBreadth.toFixed(4):null,
      n:r.n,at:r.time};
    const keys=Object.keys(store.days).sort();
    while(keys.length>60){delete store.days[keys.shift()];}
    FS.set(DEPTH_MARKET_STORE,store);
  }catch(e){console.warn('recordDepthMarketRead failed',e);}
}
function depthBookIsCurrent(){
  const d=NSE_DEPTH_META&&String(NSE_DEPTH_META.date||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d||'')) return null;   // no stamp: unknown, fail open as before
  return d===getSessionDate();
}
function getDepthPctMap(){
  if(depthBookIsCurrent()===false) return {};
  const src=[];
  for(const k in NSE_DEPTH){
    const r=NSE_DEPTH[k];
    if(r.series!=='EQ'||!(r.bookQty>=DEPTH_MIN_BOOK_QTY)) continue;
    const lv=DEPTH_LIVE[k];
    const b=lv&&lv.buyQty>0&&lv.sellQty>0?lv.buyQty:r.buyQty;
    const sl=lv&&lv.buyQty>0&&lv.sellQty>0?lv.sellQty:r.sellQty;
    const tot=b+sl;
    if(!(tot>0)) continue;
    src.push({sym:k,imb:(b-sl)/tot,live:!!lv});
  }
  const out={};
  if(src.length<50) return out;                 // too thin to be a cross-section
  src.sort((a,b)=>a.imb-b.imb);
  const n=src.length;
  src.forEach((r,i)=>{out[r.sym]={pct:n>1?i/(n-1):1,imb:r.imb,live:r.live};});
  return out;
}
const RADAR_DEPTH_IN_SCORE=true;   // v1139: one word reverts the score to v1138
const DEPTH_MIN_BOOK_QTY=1000;      // a book too small to mean anything
const DEPTH_MIN_PREOPEN_TURNOVER=2e5;
async function processFiles(files,sourceLabel,opts={}){
  const silent=!!opts.silent; // watcher refreshes: no overlay, no toasts, corner pill only
  if(!(await ensureDriveReadyForLoad())){
    if(!silent) setLoading(false);
    return false;
  }
  setFileLoadStatus(sourceLabel||'Scanner Uploads',files,'not in folder');
  // Surveillance rules must exist before REG1 parsing; the unauthorized-boot path can
  // reach here without initApp having seeded them.
  if(!SURV_CUSTOM_RULES.length){try{loadSurvRules();}catch(e){}}
  // Any deliberate or automatic load resets the folder-watch baseline so the watcher
  // does not immediately re-process the files it (or the user) just loaded.
  try{_folderWatchAllNseLastModified=getAllNseLastModified([...files]);}catch(e){}
  if(!silent) setLoading(true,String(FILE_LOAD_STATUS.source?`Processing selected files... · ${FILE_LOAD_STATUS.source}`:'Processing selected files...'));
  // Upload CHANGED canonical input files to Drive in the background. Rankings are built
  // from the selected local files immediately, because the market does not wait for Drive.
  saveInputsInBackground(files,{silent});
  NSE_BHAV={};NSE_52W={};NSE_SURV={};NSE_BULK={};NSE_BLOCK={};NSE_PRICE_BAND={};NSE_VAR={};NSE_NEXT_BAND={};NSE_SECURITY_MASTER={};NSE_DEAL_NET={};NSE_CORP_ACTION={};NSE_BOARD_MEETING={};NSE_ANNOUNCE={};NSE_MARKET=null;NSE_INDEX={};NSE_NAME_TO_SYM={};NSE_BAND_HIT={};NSE_NEW_HL_BYNAME={};NSE_INDEX_GROUP_BYNAME={};NSE_INDEX_GROUP_BYSYM={};MARKET_REGIME=null;NSE_STATUS={};NSE_SERIES={};NSE_DEPTH={};NSE_DEPTH_META=null;KITE_TOKEN={};
  let tvFile=null,nseZip=null,holdFile=null,posFile=null,ordFile=null,tbFile=null,holidayFile=false,holidayFileName='',depthFile=null,kiteFile=null;
  for(const f of files){
    const name=inputNameLower(f.name);
    if(isReportsZipName(f.name)){nseZip=nseZip||f;continue;}
    if(!isCsvLikeFile(f))continue;
    if(isScannerCsvName(f.name)){tvFile=f;continue;}
    if(name==='market depth.csv'){depthFile=f;continue;}
    if(name==='kite instruments.csv'){kiteFile=f;continue;}
    if(name==='positions.csv'){posFile=f;continue;}
    if(name==='holdings.csv'){holdFile=f;continue;}
    if(name==='orders.csv'){ordFile=f;continue;}
    if(name==='tradebook.csv'){tbFile=f;continue;}
    if(name==='nse holidays.csv'){
      try{
        const text=await f.text();
        if(detectNSE(f.name,text)==='holidays'){holidayFile=true;holidayFileName=f.name;updateFileLoadStatus('NSE Holidays.csv','loaded');}
      }catch(e){console.warn('Could not parse NSE Holidays.csv:',f.name,e);}
      continue;
    }
  }
  if(!tvFile&&!nseZip&&!holdFile&&!posFile&&!ordFile&&!tbFile&&!holidayFile&&!depthFile&&!kiteFile){
    if(!silent){
      setLoading(false);
      showToast('No files recognised. Upload the NSE scanner and/or Zerodha input files.',4000,true);
    }
    return false;
  }

  if(kiteFile){
    try{
      for(const r of (parseCSV(await kiteFile.text())||[])){
        const sy=normSym(r['Symbol']||''),t=Number(r['Token'])||0;
        if(sy&&t) KITE_TOKEN[sy]=t;
      }
      updateFileLoadStatus('Kite Instruments.csv',Object.keys(KITE_TOKEN).length?'loaded':'empty');
    }catch(e){console.warn('Could not parse Kite Instruments.csv:',e);}
  }
  if(depthFile){
    try{
      const n=parseMarketDepth(await depthFile.text());
      updateFileLoadStatus('Market Depth.csv',n?'loaded':'empty');
      if(n) recordDepthMarketRead();
    }catch(e){console.warn('Could not parse Market Depth.csv:',e);}
  }
  if(nseZip){
    setLoadMsg('Unzipping NSE data...');
    try{
      const outerZip=await JSZip.loadAsync(nseZip);
      // Helper: process all entries in a JSZip object (recurses into nested zips)
      async function processZipEntries(zipObj){
        for(const[filename,entry]of Object.entries(zipObj.files)){
          if(entry.dir)continue;
          const fn=filename.toLowerCase().split('/').pop();
          // Nested zip (e.g. NSE zip inside an outer zip) — recurse
          if(fn.endsWith('.zip')){
            try{
              const innerBuf=await entry.async('arraybuffer');
              const innerZip=await JSZip.loadAsync(innerBuf);
              await processZipEntries(innerZip);
            }catch(e){console.warn('Nested zip error:',fn,e);}
            continue;
          }
          // CSV inside the NSE reports ZIP — names inside this ZIP contain dates.
          if(isNseTextReport(fn)){
            setLoadMsg('Parsing '+fn+'...');
            const text=await readNseArchiveEntryText(fn,entry);
            const type=detectNSE(fn,text);
            if(type) updateFileLoadStatusByNseType(type,'loaded');
          }
        }
      }
      await processZipEntries(outerZip);
      updateFileLoadStatus('Reports-Daily-Multiple.zip','loaded');
      // v1098: fold this session's official closes into the dated price history BEFORE the scanner
      // file is scored, so the drift map the scorer reads already includes today's bhav.
      try{ recordPriceHistoryFromBhav(); }catch(e){ console.error('price history:',e); }
    }catch(e){console.error('ZIP error:',e);}
  }
  await refreshNseFundamentals();

  if(!tvFile&&!nseZip&&!holdFile&&!posFile&&!ordFile&&!tbFile&&!holidayFile){
    if(!silent){
      setLoading(false);
      showToast('TradingView CSV not found in the selected Scanner Uploads folder.',4000,true);
    }
    return false;
  }

  if(holdFile){
    setLoadMsg('Processing holdings...');
    const holdText=await holdFile.text();
    HOLDINGS=parseHoldings(holdText);
    PORTFOLIO_FILE_DATES.holdings=fileDateISO(holdFile.lastModified); // v1079
    try{FS.set(HOLD_STORE,{holdings:HOLDINGS,costMap:HOLD_COST_MAP});}catch(e){}
    updateFileLoadStatus('Holdings.csv','loaded');
  }
  // v557: ORDERS are parsed BEFORE positions, because the orders' own row dates are the most
  // trustworthy signal of which session the portfolio files describe (see resolvePortfolioStaleness).
  if(ordFile){
    setLoadMsg('Processing orders...');
    const ordText=await ordFile.text();
    ORDERS_TODAY=parseOrders(ordText);
    if(ORDERS_TODAY) ORDERS_TODAY._loadedThisSession=true;
    try{FS.set(ORDERS_STORE,{orders:ORDERS_TODAY,sourcePath:ordFile.name,lastModified:ordFile.lastModified});}catch(e){}
    const _ord=resolvePortfolioStaleness();
    updateFileLoadStatus('Orders.csv',_ord.ordersStale?'stale':'loaded',_ord.ordersStale?`prior session ${_ord.portfolioDate||'unknown'} - excluded from today`:'');
  }
  if(posFile){
    setLoadMsg('Processing positions...');
    const posText=await posFile.text();
    const posHash=(function(t){let h=0;for(let i=0;i<t.length;i++){h=((h<<5)-h)+t.charCodeAt(i);h|=0;}return h;})(posText);
    const today=getSessionDate();
    const positionsCurrent=isPositionsFileCurrent(posFile);
    POSITIONS=positionsCurrent?parsePositions(posText):[];
    PORTFOLIO_FILE_DATES.positions=fileDateISO(posFile.lastModified); // v1079
    try{FS.set(POS_STORE,{positions:POSITIONS,hash:posHash,sessionDate:today,sourceDate:inputFileSessionDate(posFile),stale:!positionsCurrent});}catch(e){}
    updateFileLoadStatus('Positions.csv',positionsCurrent?'loaded':'stale',positionsCurrent?'':'stale - ignored');
  }
  if(tbFile){
    setLoadMsg('Analyzing tradebook...');
    const tbText=await tbFile.text();
    const parsedTradebook=parseTradebook(tbText);
    if(parsedTradebook){
      const selected=keepFullerTradebookHistory(parsedTradebook,tbFile.name,tbFile.lastModified);
      TRADEBOOK_STATS=selected.stats;
      reconcileSameDayExitOpportunities();
      if(selected.persist) try{FS.set(TRADEBOOK_STORE,selected.persist);}catch(e){}
      if(selected.meta) try{FS.set(TRADEBOOK_META_STORE,selected.meta);}catch(e){}
    }
    updateFileLoadStatus('TRADEBOOK.csv','loaded');
  }

  invalidateTargetAnchorCaches();
  const scannerJobs=[];
  if(tvFile)scannerJobs.push({mode:'stock',file:tvFile});
  for(const job of scannerJobs){
    const ok=await processScannerUpload(job.file,job.mode);
    if(ok&&job.mode==='stock') updateFileLoadStatus('ALL NSE.csv','loaded');
  }
  const stockScannerProcessed=scannerJobs.some(j=>j.mode==='stock');

  syncExecutedRecommendedEntries();
  // Final render after all files are processed — ensures Latest Session uses fresh orders.
  // applyFilters() re-runs held-stock suppression with fresh holdings data only when
  // holdings/positions were updated (avoids double render lag when TV CSV was also uploaded).
  if(stockScannerProcessed){
    const rt=captureScannerRuntime();
    try{
      MARKET_MODE='stock';
      assessExecutedEntryOutcomeScan(window._lastStockOutcomeScan);
      recordSameDayExitOpportunity(window._lastStockOutcomeScan);
      if(TRADEBOOK_STATS?.tripsData?.length){
        refreshExitPolicyFromFeedback(TRADEBOOK_STATS);
        FS.set(TRADEBOOK_STORE,TRADEBOOK_STATS);
      }
    }finally{restoreScannerRuntime(rt);}
  }
  if(!silent) setLoadMsg('Rendering rankings...');
  renderTradingDashboardNow();
  if(!silent) setLoading(false);
  saveBrainInBackground('Brain saved after file processing');
  if(FIRST_INGEST_DONE){
    try{
      if(KITE_API&&fetchBudgetLeft()>0)
        setTimeout(()=>{ try{ fetchCandlesInApp({auto:true}); }catch(e){} },1200);
    }catch(e){}
  }
  FIRST_INGEST_DONE=true;
  return true;
}

document.getElementById('fInDir').addEventListener('change',e=>{
  if(!e.target.files.length) return;
  const files=Array.from(e.target.files);
  const sourceLabel=files[0]?.webkitRelativePath?.split(/[\\/]/)[0]||undefined;
  processFiles(files,sourceLabel).catch(error=>{
    console.error('File input load failed',error);
    setLoading(false);
    showToast('Could not load the selected files: '+(error?.message||error),6000,true);
  });
});


// ══════════════════════════════════════════════════
// SCANNER FILTER PERSISTENCE
// ══════════════════════════════════════════════════


// ── Async app init: load brain file → hydrate all state → render ──
async function initApp(){
  // Establish helper state before any hydrated/folder input can start the refresh pipeline. This
  // is a localhost probe capped at 1.5s; failure is explicitly tolerated by detectKiteApi().
  try{ await detectKiteApi(); }catch(e){}
  updateModeUI();
  setLoading(true,'Loading latest cloud data...');
  // Step 0: Restore an active Drive token for this browser session and load cloud brain data.
  const brain=await FS.init();
  if(!brain&&!FS.hasFolder()){
    console.log('INIT: Google Drive is not authorized; skipping cloud hydration until user reconnects.');
    try{loadFilterState();}catch(e){}
    showDriveAuthRequiredState();
    updateFolderUI();
    setLoading(false);
    return;
  }
  if(brain){
    FS.load(brain);
    // Load NSE holidays first (compact calendar is intentionally persisted).
    try{const hols=brain[NSE_HOLIDAYS_STORE];if(Array.isArray(hols)&&hols.length) NSE_HOLIDAYS=new Set(hols);}catch(e){}

    // Step 1: Restore the compact Radar ranking cache for immediate display.
    try{
      const saved=brain[modeKey(ALL_STORE)];
      if(saved?.schema===ALL_STORE_SCHEMA&&saved.data&&saved.data.length){
        ALL=saved.data.map(s=>({...s,symbol:normSym(s.symbol)})).filter(s=>s.symbol);
        RADAR.rockets=Number(saved.rockets)||0;
        RADAR.continuationCount=Number(saved.continuationCount)||0;
        FILT=[...ALL];
        SELECTED=new Set(ALL.filter(s=>s.basketEligible!==false).slice(0,20).map(s=>s.symbol));
        if(saved.fileTag){const ft=document.getElementById('fileTag');if(ft)ft.textContent=saved.fileTag;}
        console.log('INIT: restored',ALL.length,'ranked stocks from the Radar cache');
      } else if(saved?.data?.length){
        console.log('INIT: pre-Radar ranking cache found; waiting for a fresh upload instead of restoring engine-era rows.');
      }
    }catch(e){console.error('INIT step1 data failed:',e);}

    // Step 2: Restore surveillance P&L correlation accumulator
    try{const sc=brain[SURV_CORR_STORE];if(sc&&typeof sc==='object') SURV_CORR_ACC=sc;}catch(e){}

    // Purge stale identity-column entries (one-time cleanup, no write-back needed)
    {const _pNF=new Set(['scripcode','symbol','nse exclusive','status','series']);
    Object.keys(SURV_CORR_ACC).forEach(k=>{const c=SURV_CORR_ACC[k]?.col||'';const hl=c.trim().toLowerCase();if(_pNF.has(hl)||/^filler/i.test(c.trim())) delete SURV_CORR_ACC[k];});}

  } else {
    if(FS.needsReconnect()){
      console.log('INIT: Google Drive needs authorization — showing reconnect prompt.');
      setTimeout(()=>{
        const bar=document.getElementById('infoBar');
        if(bar) bar.innerHTML=`<span class="info-pill pill-amber" style="cursor:pointer;font-weight:700" onclick="connectCloudStorage()" title="Click to authorize Google Drive and load the latest cloud brain">⚠ Google Drive needs authorization — click to connect</span>`;
      },200);
    } else {
      console.log('INIT: no connected Google Drive brain found — connect Drive to load or save cloud state.');
    }
  }

  // Restore configured surveillance rules, or seed the defaults for a fresh/reset brain,
  // before REG1 ZIP hydration so surveillance monitoring is active on the first new scan.
  try{loadSurvRules();}catch(e){SURV_CUSTOM_RULES=SURV_SEED_RULES.map(r=>({key:survRuleKey(r.column),column:r.column,label:r.label}));}

  // Restore saved filters BEFORE hydration: hydration renders, and rendering saves filter
  // state, so reading them back afterwards would persist blank inputs over the real ones.
  try{loadFilterState();}catch(e){console.error('INIT loadFilterState failed:',e);}

  // Prefer the same local upload folder used by Load Files; Drive copies are fallback.
  try{await hydrateSessionCSVsFromPreferredInputs('INIT');}catch(e){console.warn('INIT: input hydration failed',e);}

  // Rankings render first; performance analytics are scheduled below as an idle task.
  try{const pe=document.getElementById('perfContent');if(pe&&!PERF_RENDERED)pe.innerHTML=`<div style="text-align:center;padding:60px 40px;color:var(--t2)"><div style="font-size:38px;margin-bottom:14px">📈</div><div style="font-size:17px;font-weight:700;color:var(--t1);margin-bottom:8px">Calculating performance</div><div>Rankings load first; trade analytics continue automatically.</div></div>`;}catch(e){}

  // Step 3: Render stats without blocking on Performance analytics.
  try{if(ALL.length) renderStats();}catch(e){console.error('INIT step3 renderStats failed:',e);}

  // Step 4: Render methodology
  try{renderMethodology();}catch(e){console.error('INIT step4 renderMethodology failed:',e);}

  // Step 5: Re-apply filter state now that the tradebook can supply the learned Max Alloc.
  try{loadFilterState();}catch(e){console.error('INIT step5 loadFilterState failed:',e);}

  // Step 6: Show header + dash before applyFilters so renderTable works into a visible element
  try{
    document.getElementById('hdrR').style.display='flex';
    document.getElementById('dash').style.display='block';
    document.getElementById('noDataBanner').style.display=ALL.length?'none':'flex';
  }catch(e){console.error('INIT step6 visibility failed:',e);}

  // Step 7: Apply filters and render table — runs once, cleanly, with all filters restored
  try{applyFilters();}catch(e){console.error('INIT step7 applyFilters failed:',e);}
  setLoading(false);
  schedulePerformanceRender();
  // Radar-style auto-refresh: watch the granted local folder for new/changed files.
  startFolderWatch();
}
initApp();

function saveFilterState(){
  if(!FILTERS_RESTORED) return; // never persist the blank pre-restore inputs
  const state={
    search:document.getElementById('fSearch')?.value||'',
    risk:document.getElementById('fRisk')?.value||'',
    rows:document.getElementById('fRows')?.value||'',
    minTurnover:document.getElementById('fMinTurnover')?.value||'0',
    exportExcluded:[...EXPORT_EXCLUDED].slice(0,200),
    sortCol:SCOL,
    sortDir:SDIR,
  };
  localStorage.setItem(modeKey(SCANNER_STORE), JSON.stringify(state));
  const maxAllocEl=document.getElementById('fMaxAlloc');
  const capEl=document.getElementById('fCapital');
  // The fields hold only manual overrides now; an empty field means "use the computed
  // default" (shown in the placeholder), so we persist the raw value as-is.
  const tradeInputs={
    capital:capEl?.value||'',
    maxAlloc:maxAllocEl?.value||'',
    tgtOverride:document.getElementById('fTgtOverride')?.value||'',
    riskPerTrade:document.getElementById('fRiskPerTrade')?.value||''
  };
  localStorage.setItem(SHARED_FILTER_STORE, JSON.stringify(tradeInputs)); // offline mirror
  // Sync the account-level trading inputs across devices via the brain, but only when they
  // actually changed (not on search/risk/rows keystrokes) so we don't churn Drive writes.
  try{
    const sig=JSON.stringify(tradeInputs);
    if(sig!==_lastTradeInputSig){
      _lastTradeInputSig=sig;
      FS.set(TRADE_INPUTS_STORE,tradeInputs);
      saveBrainInBackground();
    }
  }catch(e){}
}

function loadFilterState(){
  try{
    const state=JSON.parse(localStorage.getItem(modeKey(SCANNER_STORE))||'{}');
    const shared=JSON.parse(localStorage.getItem(SHARED_FILTER_STORE)||'{}');
    if(state.search!=null){const el=document.getElementById('fSearch');if(el)el.value=state.search;}
    if(state.risk!=null){const el=document.getElementById('fRisk');if(el)el.value=state.risk;}
    if(state.rows!=null){const el=document.getElementById('fRows');if(el)el.value=state.rows;}
    if(state.minTurnover!=null){const el=document.getElementById('fMinTurnover');if(el)el.value=state.minTurnover;}
    EXPORT_EXCLUDED=new Set(Array.isArray(state.exportExcluded)?state.exportExcluded.map(normSym).filter(Boolean):[]);
    // Trade inputs PREFER the Drive-synced brain (so laptop and phone agree); localStorage
    // is the fallback when the brain has none yet (offline / first run).
    let ti=null; try{ti=FS.get(TRADE_INPUTS_STORE);}catch(e){}
    const pick=(k)=>(ti&&ti[k]!=null)?ti[k]:(shared[k]!=null?shared[k]:state[k]);
    const sharedCapital=pick('capital'), sharedMaxAlloc=pick('maxAlloc'), sharedTgt=pick('tgtOverride');
    const sharedRisk=pick('riskPerTrade');
    if(sharedCapital){const el=document.getElementById('fCapital');if(el)el.value=sharedCapital;}
    if(sharedMaxAlloc){const el=document.getElementById('fMaxAlloc');if(el)el.value=sharedMaxAlloc;}
    if(sharedTgt){const el=document.getElementById('fTgtOverride');if(el)el.value=sharedTgt;}
    if(sharedRisk){const el=document.getElementById('fRiskPerTrade');if(el)el.value=sharedRisk;}
    // Prime the change-gate so the first save after load doesn't needlessly rewrite the brain.
    _lastTradeInputSig=JSON.stringify({capital:sharedCapital||'',maxAlloc:sharedMaxAlloc||'',tgtOverride:sharedTgt||'',riskPerTrade:sharedRisk||''});
    updateFilterPlaceholders(); // empty fields show + use the computed defaults
    // Legacy engine sort columns migrate to the Radar rank ordering once.
    const legacy=new Set(['_rank','rocketScore','snapshotChange','tslRefPoints','velocityPotential','delivPct','volume']);
    if(state.sortCol&&!legacy.has(state.sortCol))SCOL=state.sortCol;
    if(state.sortDir&&!legacy.has(state.sortCol||''))SDIR=state.sortDir;
  }catch(e){console.warn('Could not load filter state',e);}
  FILTERS_RESTORED=true;
}
// ── Fixed horizontal scrollbar always at viewport bottom ──
function initFixedScroll(){
  const tblW   = document.getElementById('tblW');
  const bar    = document.getElementById('fixedHScroll');
  const inner  = document.getElementById('fixedHScrollInner');
  if(!tblW||!bar||!inner) return;

  function reposition(){
    const rect = tblW.getBoundingClientRect();
    // Only show when table is wider than viewport and partially visible
    const tableWider = tblW.scrollWidth > tblW.clientWidth;
    const tableVisible = rect.top < window.innerHeight && rect.bottom > 0;
    if(tableWider && tableVisible){
      const left  = Math.max(rect.left, 0);
      const right = Math.min(rect.right, window.innerWidth);
      bar.style.display = 'block';
      bar.style.left    = left  + 'px';
      bar.style.width   = (right - left) + 'px';
      inner.style.width = tblW.scrollWidth + 'px';
    } else {
      bar.style.display = 'none';
    }
  }

  new ResizeObserver(reposition).observe(tblW);
  window.addEventListener('scroll', reposition, {passive:true});
  window.addEventListener('resize', reposition, {passive:true});
  reposition();

  let syncing = false;
  tblW.addEventListener('scroll', () => {
    if(syncing) return; syncing=true;
    bar.scrollLeft = tblW.scrollLeft;
    syncing=false;
  });
  bar.addEventListener('scroll', () => {
    if(syncing) return; syncing=true;
    tblW.scrollLeft = bar.scrollLeft;
    syncing=false;
  });
}
initFixedScroll();


// ── NSE filename hints ──
function initNSELinks(){
  const nd=nseDate();
  const el=document.getElementById('nseDateLabel');
  if(el) el.textContent='(prev trading day: '+nd.label+')';
  const expected=getExpectedInputFiles();
  const nseFiles=expected.nse.map(f=>f.label);
  const allFiles=expected.all.map(f=>f.label);
  var grid=document.getElementById('nseLinkGrid');
  if(grid){
    grid.innerHTML=nseFiles.map(function(f){
      return '<span class="nse-link-btn">'+f+'</span>';
    }).join('');
  }
  var dashGrid=document.getElementById('requiredFilesGrid');
  if(dashGrid){
    dashGrid.innerHTML=allFiles.map(function(f){
      return '<span class="nse-link-btn">'+f+'</span>';
    }).join('');
  }
}
initNSELinks();
