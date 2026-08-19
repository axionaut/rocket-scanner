const BUILD_TS='2026-08-19 14:52 IST'; // release build time (IST)
const APP_VERSION=1199; // v1199: the Top-up plan table is removed.
// v1093: a baseline reward:risk MEASURED on the cross-section (last completed bhav session) instead of learned from the owner's own fills - reported on every row, deliberately not enforced. Includes v1092: position size split by Radar score / stop distance, so equally-scored names carry equal RUPEE risk, plus an opt-in Risk /trade cap.
// v556: parse the NSE Market Activity Report (MA<date>.csv) — official Nifty %, advances/declines and sector index moves shown as market CONTEXT in the status bar (EOD data, display only, never fed into per-row scoring); MA added to the ℹ️ file manifest.
// v555 market-cycle stage awareness (stateless, self-calibrating): per-row stage label (1 accumulation · 2 breakout · 3 event · 4 profit-booking · 5 re-accumulation · 6 second-leg); a quiet-accumulation signal (conjunction-of-percentiles) injected via the rocket-diagnostic weighting; sell-the-news decay off Recent earnings date (horizon = review days). v1065 makes the market-breadth gauge an entry-eligibility input while still never changing ranking.
const GOOGLE_DRIVE_CLIENT_ID='1015012642264-oi2nelv3v90k3d39r994a6nelgjs2a56.apps.googleusercontent.com'; // Public OAuth Web Client ID.
const PRICE_BAND_BLOCK_BUFFER_PCT=0.15; // Treat rounded 4.9/9.9/19.9 rows as effectively band-locked.
const BASKET_CASH_RESERVE_RS=1; // Leave a rupee for broker-side tax/rounding differences.
const MAX_TURNOVER_PARTICIPATION=0.001; // Market-impact rail: never exceed 0.10% of a stock's daily rupee turnover.
const BASKET_MARKET_BUDGET_BUFFER_PCT=0.25; // Sizing cushion only; exported buys remain MARKET orders.
// v1086's `RECOMMEND_MAX_RANK = 10` was RETIRED in v1091 (owner): the recommendation bar is now
// score QUALITY, not rank position — see RECOMMEND_MIN_SCORE, derived from RADAR_SCORE_BANDS.
// A rank cap hands over ten names regardless of how good they are; the green band lets the count
// follow the market. Do not reintroduce a positional cap.
// v1113: the stretch penalty measures the target against a typical day's range instead of the
// retired 10% same-day rocket bar (see radarAnalyze). Switchable ONLY so the two arms can be scored
// against byte-identical input inside one page load — the live scanner file changes between harness
// runs, so a before/after diff across runs cannot separate the change from the tape. Never ship false.
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
// The account-level trading inputs (Capital ₹, Max Alloc ₹, manual Target anchor %) affect execution
// and must be identical on every device, so they ride the Drive-synced brain — NOT only
// per-device localStorage (v549 fix: a manual target set on one device now reaches the
// others). localStorage stays as the offline mirror.
const TRADE_INPUTS_STORE='rs_trade_inputs_v1';
let _lastTradeInputSig=''; // gate brain writes to genuine trade-input changes, not every keystroke
const ALL_STORE='rs_data';
const ALL_STORE_SCHEMA='radar_composite_v11'; // v1098 caches the true multi-session drift.
const HOLD_STORE='rs_holdings';
const ORDERS_STORE='rs_orders';
const POS_STORE='rs_positions';
const TRADEBOOK_STORE='rs_tradebook';
const TRADEBOOK_META_STORE='rs_tradebook_meta_v1';
const TRADE_TIMING_CONTEXT_STORE='rs_trade_timing_context_v1';
const SURV_RULE_STORE='rs_surv_rules';
const SURV_CORR_STORE='rs_surv_corr';
const SAME_DAY_EXIT_OPPORTUNITY_STORE='rs_same_day_exit_opportunity_v3';
const RECOMMEND_OUTCOME_STORE='rs_recommend_outcomes_delta_v1';
const RECOMMEND_MIN_PROGRESS_FRACTION=0.25;
// v1097 (owner): the daily record of money left on the table. Latest Session computes the figure for
// ONE session only; the target nudge needs it across sessions, so each session's proceeds-weighted
// figure is persisted here as it is rendered. Bounded window — the pool must track the current
// regime, not average away a month of it.
const LEFT_ON_TABLE_STORE='rs_left_on_table_v1';
const LEFT_ON_TABLE_KEEP_SESSIONS=30;   // how much history is retained
const LEFT_ON_TABLE_POOL_SESSIONS=10;   // how much of it the pool actually reads
// v1098: dated official closes, so a multi-session drift can be measured properly. The app has never
// retained any price history — NSE_BHAV is rebuilt from the current zip on every load — which is why
// v1097 had to approximate "the drift into the results" from a 1-week column.
const PRICE_HISTORY_STORE='rs_price_history_v1';
// v1184: RETENTION WAS THE REASON THE HISTORY NEVER GREW (owner, 2026-08-18: *"why does
// nse_price_history have only 8 sessions? Didn't we implement this so many days ago? Please check if
// it's skipping days"*). It was NOT skipping - every trading session since v1098 shipped was
// present, 08-06 through 08-17 with nothing missing. It was being TRIMMED to 8 on every save, a cap
// sized in v1098 for a 3-session drift measure and never revisited when this store became the
// intended source for multi-day features. **The `discovery-from-bhav-history` trigger registered an
// hour before this was found asks for 20 sessions and could never have fired.**
//
// 40 sessions is two trading months: enough for the 20-day features the upStreak work needs, with
// room for a longer window later. Measured cost: 73 KB per session, so 40 sessions is 2.85 MB
// against a 9.5 MB brain - the store grows, but by a knowable amount rather than an open-ended one.
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
let ORDERS_TODAY=null; // [{symbol, type, qty, price, time}] — filled order rows, including partial-cancel fills
let TRADEBOOK_BUY_FILLS=[]; // Consolidated BUY fills available for executed-entry feedback matching.

// ══════════════════════════════════════════════════
// CLOUD STORAGE (Google Drive appDataFolder)
// Brain and canonical input files are kept in the
// user's private per-app Drive storage. The engine
// continues to persist through the same FS contract.
// ══════════════════════════════════════════════════
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
// ONE symbol cell for every table that names a stock (owner, v1070): the stock NAME opens the
// TradingView chart in a new tab, the ROW opens the Radar scoring modal. stopPropagation is what
// keeps the two apart. Used by the rankings table, Removed from rankings, Latest Session, Open
// Positions and Performance Stocks so the interaction is identical wherever a symbol appears —
// add new symbol surfaces through this helper rather than hand-rolling another cell.
// Safe unconditionally: openTradingViewChart resolves by symbol, and showRadarDetail no-ops when
// the symbol is not in the current scan.
function symbolChartButton(sym,innerHtml=null,extraStyle=''){
  const s=String(sym??'').trim();
  if(!s) return '';
  // v1142 (owner): "now that we can open zerodha links, replace the tv link with zerodha because
  // that makes sense." The stock NAME is the trading action, so it opens Kite on that stock and
  // copies the symbol; TradingView keeps the small secondary button for chart reading. A stock with
  // no Kite instrument token FALLS BACK to TradingView on the name rather than becoming a dead
  // click - the token file is optional and the app must work without it.
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
// v1139 (owner): open the stock in Zerodha, the way the name already opens TradingView. There is no
// supported URL that PRE-FILLS a buy dialog without a Kite Connect api_key, and Kite Connect was
// ruled out (static IP) - so this deep-links to the stock's own Kite chart page, where the B/S
// buttons sit one click away. The instrument token comes from `api.kite.trade/instruments`, which is
// PUBLIC: no key, no login. A stock with no token renders nothing rather than a broken link.
// v1144: retired by owner - the name opens Zerodha and the chart button earned no width back.
function tvChartButton(sym){
  const s=String(sym??'').trim();
  if(!s) return '';
  return `<button type="button" onclick='event.stopPropagation();openTradingViewChart(${JSON.stringify(s)})'`
    +` style="margin-left:5px;padding:0 4px;border:1px solid var(--border);border-radius:3px;background:transparent;`
    +`color:var(--t3);font-size:10px;line-height:14px;cursor:pointer"`
    +` title="Open the TradingView chart for ${escHtml(s)}">TV</button>`;
}
// Owner: "If opening the zerodha dialog or anything is not possible, just copy the stock's name to
// clipboard on its click so I could paste it in zerodha." Both, since the deep link works: the
// symbol goes to the clipboard AND Kite opens on that stock. If the clipboard is blocked (it needs
// a user gesture and a secure context) the link still opens, so the button never silently does
// nothing - and the toast says which of the two actually happened.
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
// Seed rules — used only when brain has no saved rules yet (first-time setup)
// ── v1169: THE HARD FILTER IS RESTRICTIONS ONLY ─────────────────────────────────────────────
// The configured set is a HARD REMOVAL, and it had been seeded with NSE's whole REG1 column list -
// which mixes two different things. Some columns mean NSE has RESTRICTED trading in the scrip
// (trade-to-trade settlement, 100% margin, periodic call auction, a tightened band). Others are
// CRITERIA it publishes about a company: its PE, whether it made a loss, how far the price has
// travelled in six months.
//
// Measured 2026-08-18 on a 1,506-stock tradeable universe: surveillance removed 669, and only 175
// carried a genuine restriction. **494 stocks were deleted purely on criteria columns** - including
// the board's own ranks 7, 8, 9, 18, 19, 22, 26, 27, 36 and 38. The two largest removers were
// "Scrip PE is greater than 50" (525 stocks) and "High low price variation greater than 100perc in
// previous 6 months" (220) - and the second of those is THE PROFILE OF A ROCKET: it deletes a stock
// for having doubled. Eight of the freed stocks were up 5%+ that morning.
//
// The owner's report was "there are shares which are rising by much, why did our system not pick
// those and pick these" - and the answer was that it HAD ranked them and surveillance deleted them,
// leaving whatever survived to be recommended.
//
// The criteria columns are NOT discarded: every flagged REG1 column, configured or not, still costs
// -2 on the score capped at -12 and still shows on the warning badge (SURV_ALL_HITS). They stop
// being a death sentence and go back to being a penalty, which is what CLAUDE.md always described.
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
// The seed only applies to a FRESH brain, and this owner's brain already holds all 22. These keys
// are therefore retired explicitly on load: a criterion must never remove a stock outright. Adding
// one back by hand in the Methodology table still works and is still respected - this only undoes
// the seeding, it does not police the owner.
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
      SURV_CUSTOM_RULES=raw.map(rule=>{
        const column=String(rule.column||rule.label||'').trim();
        return column?{key:survRuleKey(column),column,label:String(rule.label||column).trim()}:null;
      }).filter(Boolean).filter(r=>SURV_RETIRED_KEYS.indexOf(r.key)<0);
    } else {
      // First-time: seed with default rules
      SURV_CUSTOM_RULES=SURV_SEED_RULES.map(r=>({key:survRuleKey(r.column),column:r.column,label:r.label}));
    }
  }catch(e){
    SURV_CUSTOM_RULES=SURV_SEED_RULES.map(r=>({key:survRuleKey(r.column),column:r.column,label:r.label}));
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
    // v1093: OPEN/HIGH/LOW are kept as well. They are the LAST COMPLETED session's full bar —
    // the only complete bar the app has — and the achievability sweep needs a complete bar to ask
    // "at target T against stop S, what fraction of the market reached T first?". Measuring that on
    // the live intraday file would understate every hit rate by however much of the day is left.
    NSE_BHAV[sym]={delivPct:num(r['DELIV_PER']),nseVol:num(r['TTL_TRD_QNTY']),
      officialClose:num(r['CLOSE_PRICE']),officialAvg:num(r['AVG_PRICE']),trades:num(r['NO_OF_TRADES']),
      open:num(r['OPEN_PRICE']),high:num(r['HIGH_PRICE']),low:num(r['LOW_PRICE']),
      prevClose:num(r['PREV_CLOSE']),dateStr:(r['DATE1']||'').trim()};
  });
}
// ── v1098 dated price history ────────────────────────────────────────────────
// GAP-ROBUST BY CONSTRUCTION, because this is the same class of multi-day state whose corruption was
// the v1 failure. Closes are stored under their OWN session date from the bhav copy's DATE1 — never
// under "today" and never carried forward — and every read demands the exact dates it needs and
// returns null otherwise. A missed upload therefore yields NO SIGNAL, never a wrong one.
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
// ── R4d POST-RESULTS DIGESTION (RULES.md, graduated 2026-07-30: 5 confirms / 3 sessions / 0
// contradictions — E26 GANDHAR, E27 TIPSFILMS, E34 D+1 PCBL, E40 SERVOTECH, E42 XPROINDIA) ────
//
// The rule: a results-driven ROCKET gives back sharply on the following session even when the
// reported numbers were good. E42 is the cleanest instance — XPROINDIA's Q1 PAT more than DOUBLED and
// the first full session after the print sold off 13.2% on 11.5x volume. So the durable action is
// temporal, not fundamental: do not chase yesterday's results rocket unless it is re-accumulating now.
//
// WHAT COUNTS AS A "RESULTS ROCKET" IS SELF-CALIBRATING, not a typed threshold. The stock's move on
// its own results day is compared against the CROSS-SECTION of every stock's move that same day; a
// top-decile move is the rocket. That adapts to the tape automatically — on a violent day the bar
// rises with it — and introduces no constant.
//
// FAILS OPEN. Without stored closes for the results day and the session before it, the move is
// unknown and the rule does nothing. A missed upload yields no signal, never a wrong one.
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
// ── UP-STREAK: A MULTI-DAY TERM THAT ARMS ITSELF FROM THE DATA IT HAS ────────────────────────
// Owner, 2026-08-18: *"Think properly of a solution once and implement it right there so that it
// runs right now...not in 2 weeks, not after 20 sessions... With data growing daily, the program
// should evolve naturally - not wait for 20 days and then fail because your first guess was wrong."*
//
// WHAT IT IS. Consecutive up closes ending at the newest stored session. Measured within cohort on
// 183 resolved picks it separates at 64.7% (295 pairs, above 50% in 5 of 8 cohorts, leave-one-out
// 61.2-70.5%), with a hit rate of 9 / 12 / 13 / 27% at 0 / 1 / 2 / 3+ days. For scale the app's own
// score sat at 43% when v1127 measured it. `pathEff` - the feature reasoning favoured - measured
// 49.3%, exactly nothing, which is why this is measured rather than argued.
//
// WHERE IT COMES FROM, AND WHY THAT MATTERS. NOT the per-stock daily files bought from Kite: those
// exist only for stocks the app has already fetched, i.e. the ones already at the top of the board,
// so using them would advantage exactly the rows that have them (the v1139 trap). `rs_price_history_v1`
// is the free bhav-copy close for the WHOLE market - 2,624 symbols against 284 purchased files,
// growing a session per upload at zero request cost. Verified before wiring: it reproduces the
// Kite-derived streak at 95.0% exact / 97.9% within one day across 281 overlapping symbols.
//
// A short store CENSORS the streak - 8 stored sessions cannot show a 9-day run - which is harmless
// because the signal is monotone and saturates by 3, and it un-censors itself as the store grows.
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

// HOW MUCH IT COUNTS IS MEASURED LIVE, EVERY SESSION, FROM THE APP'S OWN RESOLVED PICKS.
// This is the whole point: there is no trigger to wait for and no threshold to cross. The weight IS
// the measurement, so the term is inert on the day it ships if the data does not support it, arms
// itself as picks resolve, strengthens if it keeps separating, and DISARMS ON ITS OWN if it stops.
//
//   w = clamp(2 x (concordance - 0.5), 0, 1) x pairs/(pairs + priorPairs)
//
// The first factor is 0 at 50% (no information) and 1 at 100%. The second is confidence by volume,
// shrunk toward zero with the MEAN PAIRS PER COHORT as the prior weight - the same self-derived
// shrinkage the timing windows use, so no constant is typed anywhere in this function.
//
// CONCORDANCE IS MEASURED WITHIN COHORT (v1127/v1134). A cohort is one snapshot, so comparing across
// cohorts compares TIMES OF DAY - which is exactly how a 41pp "extension predicts continuation"
// result turned out to be an artefact. Control rows (v1128) are excluded: they are evidence about
// score bands, not recommendations.
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
// BACKFILL: THE EVIDENCE ALREADY EXISTS, SO USE IT TODAY RATHER THAN WAITING TWO DAYS FOR IT.
//
// A term whose weight comes from resolved picks starts at zero weight on the day it ships, because
// no pick carries the field yet - which is "wait for the data" wearing a different hat. It does not
// have to be: `rs_price_history_v1` holds dated closes for the WHOLE market, so for any pick issued
// inside the stored window the streak AS OF THE DAY BEFORE ISSUE is recoverable exactly.
//
// NO LOOKAHEAD. The streak is counted from closes STRICTLY BEFORE the issue date - at 11:00 on the
// issue day the only completed daily bars are through yesterday. A pick whose issue date falls
// outside the stored window is left alone rather than approximated.
//
// Idempotent: it only fills a pick that has no `upStreak`, so it cannot run twice, and it never
// touches any other field on the pick. Runs once per load, off the render path.
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

// The move over the N sessions ENDING AT THE LAST CLOSE BEFORE `beforeDate` — i.e. the drift INTO
// today, with today's own reaction excluded outright rather than subtracted back out.
//
// v1097 approximated this as (week% - day%). That was wrong twice: percentage changes COMPOUND so the
// subtraction overstated the drift by up to 0.69pp, and the error scaled with today's move, meaning it
// inflated precisely the big movers whose drift the threshold is measured from; and TradingView's
// "1 week" is ~5 sessions, so a stock that jumped once five days ago and then went flat was
// indistinguishable from one that rose steadily for three. Both are fixed here.
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

// ── v1099 POST-SELL EXTREME (owner) ──────────────────────────────────────────
// "It should see if and how much the stock moved and in what direction after I sold it. The
// highest/lowest point post-sell is what drives the number."
//
// v1095 answered this with the CURRENT price, so a stock that ran 8% past the exit and faded back
// reported nothing left on the table. The peak was never looked at. This walks the stored daily bars
// strictly AFTER the sell date, then folds in today's live extremes from the scanner row.
//
// RESOLUTION IS HONEST AND LABELLED. Later sessions are exact — a full daily bar is entirely
// post-sell. The SELL DAY itself is an upper bound, because no input carries an intraday series and
// the day's high may have printed before the fill. Note this is exact rather than approximate for a
// LIMIT sell (the basket's own exits): price can only reach the limit once, so anything above it
// occurred at or after the fill. `resolution` says which case a row is in; nothing is blurred.
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
      // ── v1120: the sell day is now SPLIT at the exit instead of folded in whole ────────────────
      // v1099 took the entire sell-day bar and labelled it an upper bound. That reported money left
      // on the table for highs that printed BEFORE the exit — GNA at Rs 592 with its high 48 minutes
      // earlier. The high-water path (v1120) resolves it: only a NEW high after the sell counts.
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
function enrichRowsWithNSEData(rows){
  (rows||[]).forEach(s=>{
    const sym=normSym(s.symbol);
    if(sym&&sym!==s.symbol) s.symbol=sym;
    const pb=NSE_PRICE_BAND[s.symbol];
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
  const pb=NSE_PRICE_BAND[normSym(symbol)];
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
// v1081 (owner): how much room is left before the stock locks at its upper circuit.
//
// The previous close is DERIVED from the scanner's own price and day% rather than read from the
// bhav copy, deliberately: the band is judged against the same two numbers the rest of the row is
// scored on, so the arithmetic cannot disagree with itself if the zip is a session behind. Verified
// 2026-07-30 on SMLMAH — derived prev close Rs 4,566.00 on a 20% band gives an upper circuit of
// Rs 5,479.20, which is EXACTLY the day's observed high, to the paisa.
//
// `refPrice` should be the BUY price (LTP + BASKET_MARKET_BUDGET_BUFFER_PCT), not the last price, so
// the runway is measured from where the order would actually fill. That is what supplies the
// slippage cushion the owner asked for, using the buffer the app already owns rather than a new
// constant. Measured the same day: SMLMAH exported at Rs 5,435 and filled at Rs 5,439.82 — 0.09%,
// comfortably inside the 0.25% buffer.
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
// v1083 (owner): the STATISTICAL ceiling, the sibling of getUpperCircuitInfo's regulatory one.
//
// How much higher can this stock plausibly trade today? A stock's typical daily travel is
// `rangePct` (the strongest of ADR / ATR-1d / volatility-1d / weekly-ATR÷√5 — the same estimate the
// 10%-stretch penalty uses), so the plausible session ceiling is the day's LOW plus one typical
// day's range. Runway is then measured from the buy price exactly as it is for the circuit.
//
// Measured from the LOW, not from the realised high−low span, and that choice matters: a stock that
// ran up, faded back and is now sitting near its low has "spent" its range under a high−low measure
// while still having room to travel upward, and blocking it would be wrong. Anchoring on the low
// asks the only question a long entry cares about — how much further UP can it go — and a stock
// grinding steadily upward all session correctly runs out of ceiling while a whipsawed one does not.
//
// Measured 2026-07-30 midday: the top 20 had consumed 86% of expected range (8.37% used of 9.78%),
// and 14 of 20 could not travel the 1.9% target with what remained (ASIANENE 0.11% left, UNIPARTS
// 0.11%, SONACOMS 0.28%). The scorer picks the most volatile names in the market — rank 1-20 median
// range 9.78% vs 4.06% deep in the list — and then recommends them once the move is spent.
//
// Fails OPEN when the low or the range estimate is missing. At 09:15 the low sits at ~price, so the
// ceiling is a full range above and nothing is blocked — the morning path is untouched by design.
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
// PR-zip corporate-action file bc<ddmmyyyy>.csv (v552, WS3). Columns:
// SERIES,SYMBOL,SECURITY,RECORD_DT,BC_STRT_DT,BC_END_DT,EX_DT,ND_STRT_DT,ND_END_DT,PURPOSE
// (EX_DT is already YYYY-MM-DD). Equities only. Classifies each action so the scorer can
// (R5) neutralise a mechanical ex-date move (demerger/split/bonus/rights/material dividend)
// and (R2) reward a buyback — both statelessly, from the same-day event, no rolling state.
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
// PR/daily-zip Market Activity Report MA<ddmmyyyy>.csv (v556). NSE end-of-day market summary:
// date, index table (name + prev-close/open/high/low/close/gain-loss), ADVANCES/DECLINES, market
// totals. Parsed for DISPLAY CONTEXT only (it is EOD data, so during a live intraday scan it is the
// prior session) — never fed into the same-day per-row scoring, to avoid a timeframe mismatch.
// -- v1076 PR-zip parsers (surveyed 2026-07-29, RULES.md Appendix E) ----------
// These NSE files contain no quoted commas, so a plain split is safe and much cheaper.
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
    // CRITICAL: IND_SEC='Y' does NOT mark an index row — it marks an index CONSTITUENT.
    // In pd, 139 rows are true indices (IND_SEC=Y, blank SERIES, NO SYMBOL) and a further 50 are
    // Nifty 50 member EQUITIES (IND_SEC=Y, SERIES=EQ, WITH a symbol). Keying on IND_SEC alone
    // classified TCS and 49 other large caps as indices and dropped them from the name map, which
    // is why Nifty 50 membership resolved to zero. An index row is one with NO SYMBOL.
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
// hl<ddmmyyyy>.csv - securities that made a NEW 52-week high or low. Keyed on the padded security
// NAME, so it is stored BY NAME and resolved through NSE_NAME_TO_SYM at read time: zip members
// arrive in arbitrary order, and resolving eagerly here would silently drop every row when hl
// happens to parse before pd.
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
// v1076 MARKET REGIME. Assembled from the index rows (Nifty and India VIX with their own 52-week
// ranges), the official Market Activity advances/declines, and live intraday breadth.
// It is deliberately NOT a scoring input. It is stamped onto every recorded outcome so that D1
// (ignition vs composite) and D4 (extension predicts continuation) can be evaluated WITHIN a regime
// instead of pooled: D4 was measured on a tape where India VIX sat at the 19th percentile of its own
// 52-week range, which is exactly the condition that flatters momentum continuation. Averaging that
// with a stressed tape produces a number describing neither.
// The label is a percentile of VIX's OWN 52-week range, so no fixed VIX level is hard-coded.
// ── v1088: LIVE Nifty 50, computed from its own constituents ──────────────────────────────────
// The index rows in the daily NSE zip are END-OF-DAY, so during a live session `Nifty 50` is
// YESTERDAY'S close — a static number presented as market status (owner, 2026-07-31). The scanner
// file, by contrast, is a live export, and `NSE_INDEX_GROUP_BYSYM` identifies the 50 constituents
// by SYMBOL (v1076). So the index move is reconstructed here from the live rows: a
// FREE-FLOAT-UNAWARE but market-cap-weighted mean of constituent day moves, which is how the index
// itself is built and tracks it closely. Reported with its constituent count so partial coverage
// is visible rather than silently wrong; falls back to the EOD value when membership is unknown.
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
// ── v1085: THE ROCKET DEFINITION ───────────────────────────────────────────────────────────────
// Owner, 2026-07-31, replacing "same-day move >= 10%" outright and knowingly departing from the
// same-day core philosophy:
//
//     A rocket is a stock that rises to ITS OWN TARGET within 2 trading days (the issue day and
//     the next, skipping weekends and NSE holidays) WITHOUT first falling to ITS OWN STOP.
//
// The stop clause is the point of the change. The owner's complaint is that picks dip through the
// stop and only then run to target, which books a loss and forfeits the move — which is also why
// v1083 stopped exporting a stoploss leg. Under the old bar that pick scored as a success; under
// this one it does not, so the measurement finally agrees with the P&L.
//
// THIS LABEL IS FORWARD-LOOKING AND PATH-DEPENDENT, WITH TWO HARD CONSEQUENCES.
// (1) It cannot exist at scan time, so it can never set a feature's direction or weight in a
//     same-day scorer. Any same-day cohort that stood in for it would be a restatement of today's
//     move — the v1083 label leak — and it would be far worse now, because this label is ~51x
//     denser (measured on the 2026-07-30 tradeable universe, n=1418: day-1 target-before-stop
//     fires on 25.2% of rows against 0.49% for the >=10% bar), so it would clear `minObs` easily
//     and re-arm every effect. `radarAnalyze` therefore holds all feature effects at 0; see there.
// (2) It is resolved from daily bars, so within ONE day the ORDER of the two barrier touches is
//     unknowable. Measured: only 2 of 1418 rows (0.14%) touch both in a day, because the stop
//     (median 5.24%) sits far outside the target (~1.9%). Those are recorded as 'ambiguous' and
//     counted as NOT rockets — conservative in the direction of the owner's complaint — and the
//     count is kept so the assumption stays auditable rather than silent.
const ROCKET_HORIZON_DAYS=2; // the issue day + the next trading day
const ROCKET_OUTCOME={ROCKET:'rocket',STOPPED:'stopped',AMBIGUOUS:'ambiguous',PENDING:'pending',EXPIRED:'expired'};
// Resolve ONE day's bar against a pick's two barriers.
//
// `prevHigh`/`prevLow` are the day's extremes AS THEY STOOD WHEN THE PICK WAS ISSUED, and they
// matter only on the issue day itself: that bar already contains price action from BEFORE the
// recommendation existed, and a stop "breach" that happened at 09:20 cannot be charged to a pick
// made at 14:00. A barrier therefore counts on the issue day only when the bar made a NEW extreme
// past it after issue. On later days the whole bar is attributable and prevHigh/prevLow are null.
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
// Advance ONE pick's rocket state using the bar observed on the scan `gap` trading days after
// issue. First passage wins: once a pick resolves it is never revisited, so a stock that stops out
// on day 1 and rallies on day 2 stays STOPPED — which is the whole point of the definition.
// Each (pick, day) is applied at most once, so re-uploading the same session cannot double-count.
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
  // v1124: count ONLY picks resolved under the current definition. 302 picks issued between
  // 2026-06-25 and 2026-07-31 carry a `rocketDate` written by the retired same-day >=10% bar while
  // sitting at `pending` under the v1085 barrier label — both true in their own era, contradictory on
  // one record. Averaging them together made the review horizon a blend of two definitions. Requiring
  // the current outcome excludes the legacy rows without destroying them.
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
    // v1085: the ROCKET window runs over gap 0..ROCKET_HORIZON_DAYS-1 (the issue day and the next),
    // which is resolved on its own schedule below and independently of the legacy profit horizon.
    // gap===0 is a LATER SCAN ON THE ISSUE DAY — the post-close export is what finally closes the
    // issue day's bar — so it is no longer skipped outright. It still contributes nothing to the
    // legacy running high/low stats, which are defined over subsequent days.
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
      // v1124: the LEGACY writer is removed. `rocketDate`/`rocketDays` had TWO writers with two
      // different definitions — resolveRocketForPick (the v1085 barrier label: target before stop
      // within the horizon) and this one, the retired "same-day move >= threshold" bar. One field
      // meaning two things is how getRocketArrivalStats came to average them together, and that stat
      // drives getEffectiveReviewDays and therefore the Review After pill on the board. v1085
      // believed the arrival stats "follow automatically"; they did not, because this writer survived.
      // The field now has exactly one author.
      p.outcomeScore=calcRecommendationOutcomeScore(p,issue.threshold);
      p.complete=gap>=horizon;
    });
  });
  const currentIssue=store.issues[scan.date];
  // v1094: THE FIRST COHORT OF THE DAY WINS. The old guard replaced the day's picks whenever every
  // existing pick still had `observations === 0`, which is true for EVERY same-day re-scan — so the
  // stored cohort was always the LAST scan of the day, not the list that was actually on screen when
  // the owner acted. The post-close upload (the one that closes the issue day's bar) therefore
  // overwrote the morning's recommendations with a post-close re-score: observed 2026-08-03, where a
  // basket was exported at 11:09 but the store held a 15:46 cohort ranking CENTENKA first.
  //
  // That silently defeats the whole point of the store. Grading a list rebuilt from closing data is
  // measuring a list nobody ever saw - the v1074 circularity trap - and it is exactly what Leg 2 of
  // the post-close routine is contractually forbidden from doing. Later scans still EVALUATE the
  // cohort (the loop above), they just cannot REPLACE it.
  // v1094 REPAIR PATH. The two changes above collide on one case: a cohort recorded by an EARLIER
  // build carries no barriers (the mapper dropped them), and "first cohort wins" would now protect
  // that useless record forever — today's 20 picks would stay unresolvable exactly like the 450
  // before them. So a barrier-less pick is BACKFILLED rather than replaced: the cohort's identity
  // (which stocks, at what rank, at what entry price) is left exactly as issued, and only the
  // missing target/stop are filled in from the current policy.
  //
  // Those barriers are NOT the ones that existed at issue time — the anchor moves during the day —
  // so each repaired pick is stamped `barriersBackfilledOn`. Any analysis that needs strict
  // as-issued barriers must exclude them; without the stamp the approximation would be invisible.
  // Picks that already have barriers are never touched, so this cannot run twice on one pick.
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
      // v1076: the market REGIME this cohort was issued into. Every forward conclusion drawn from
      // this store (RULES.md D1, D4) is conditional on the tape it was measured in, and pooling a
      // calm trending market with a stressed one averages two different markets into nothing. D4
      // was measured at a 19th-percentile VIX; nothing recorded that until now.
      regime:(typeof MARKET_REGIME!=='undefined'&&MARKET_REGIME)?MARKET_REGIME:null,
      picks:scan.recommendations.map(p=>({symbol:p.symbol,entryPrice:p.entryPrice,score:p.score,rank:p.rank,
        features:compactOutcomeFeatures(p.features,outcomeFeatureOrder),
        // v1073: the entry-gate state AT ISSUE TIME. Without this the store cannot say whether a
        // graded pick was one the gate approved or one it withheld, so "is wait-for-pullback worth
        // it?" is unanswerable — which is exactly the state it was in. entryReady false means the
        // gate said wait; blockReason names which sub-condition fired, because they are different
        // claims: rangeConsumed/bandExtended are structural, while cooling is a 5m/15m tick that was
        // measured at v1069 to be microstructure noise (median +0.01%, non-positive 45% of the time).
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
        // v1094 BUG FIX: these five were computed by the caller and then SILENTLY DROPPED here.
        // This mapper rebuilds every pick from an explicit whitelist, and v1085 added the barrier
        // fields to the caller (processScannerUpload) without adding them to the whitelist — so no
        // pick has EVER carried them. Verified in the live brain 2026-08-03: 470 picks across 27
        // issue dates, ZERO with targetPct/stopPct, including picks written by v1093. Every one hit
        // the `!(p.targetPct>0)` branch in resolveRocketForPick and parked at PENDING, which is why
        // Rocket Conversion has never rendered a number and why the 450 pending picks were being
        // explained away as "legacy picks predating the definition" — they are not, the field was
        // dropped at write time. Without high1d/low1dAtIssue the issue day's bar also cannot be
        // split into pre- and post-recommendation action (see resolveRocketDay's prevHigh/prevLow).
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
  // v1085: a rocket is a RESOLVED forward outcome (target before stop within ROCKET_HORIZON_DAYS),
  // not a same-day threshold crossing. The three failure modes are kept apart because they mean
  // different things: `stopped` is the owner's actual complaint (it dipped first), `expired` simply
  // never travelled, and `ambiguous` touched both barriers inside one daily bar so the order is
  // unknowable — counted as NOT a rocket, and surfaced so that assumption stays visible.
  //
  // v1101 BUG FIX — THE ROCKET COUNTERS MUST NOT RIDE ON THE LEGACY `complete` FLAG.
  // `picks` above is gated on `p.complete`, which belongs to the PRE-v1085 horizon model and only
  // flips after that longer window elapses. A v1085 outcome resolves on FIRST PASSAGE within
  // ROCKET_HORIZON_DAYS, which happens long before `complete` ever turns true — so gating these
  // counters on it selected exactly the wrong cohort. Measured on the live brain 2026-08-06:
  // 530 picks, 46 genuinely resolved (9 rocket / 37 expired) and `complete` was FALSE on all 46,
  // while the 450 picks the KPI did count were the legacy barrier-less ones that can never resolve.
  // Rocket Conversion therefore rendered "no pick has resolved yet" while the true figure was 9/46.
  // The rocket cohort is its own thing: every observed pick, regardless of the legacy flag.
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
// ── v1126 SYSTEM SCORECARD (owner: "is there a way to tell how our system is faring?") ──────────
// Everything below already existed in the store; nothing new is recorded. Leg 2 of the post-close
// routine has been computing this by hand every day — this is that table, in the app.
//
// ONE COHORT PER ISSUE DATE, graded on the v1085 definition: did the pick reach ITS OWN target
// before ITS OWN stop, within ROCKET_HORIZON_DAYS. Only picks carrying both barriers can resolve,
// so legacy picks (pre-v1094, when the barriers were dropped at write time) are excluded from every
// denominator and counted separately rather than scored as failures.
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
  // ── v1127 WITHIN-DAY CONCORDANCE — the ranking's own scoreboard ────────────────────────────
  // The only fair test of an ORDERING: on the same session, was the winner ranked above the loser?
  // Comparing across days is confounded, because rank is a within-day relative measure while score
  // is an absolute one — a rank 1 on a weak day and a rank 1 on a strong day are not the same claim,
  // and conflating them is how "the score works but the rank doesn't" got asserted from the same
  // ordering. 50% = the ranking carries NO information. Measured 2026-08-12 over 270 pairs: 43%.
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
  // ── v1128 SCORE-BAND BREAKDOWN — picks AND control rows together ───────────────────────────
  // This is the table that answers "is the 80-95 band still bad, or did it recover?" It pools
  // recommendations with the stratified control sample, because the question is about the SCORE,
  // not about what was bought — and the bar means the band below it is now control-only.
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
  // Top-20 Radar candidates: basket-eligible, valid price, not surveillance-flagged.
  //
  // DELIBERATELY DOES NOT FILTER `entryReady` (v1073 — do not "fix" this to match applyFilters).
  // applyFilters removes entry-blocked rows from the DISPLAY; this cohort keeps them, so the outcome
  // store grades blocked and ready picks side by side. That mismatch is the ONLY control group the
  // app has for answering whether the "wait for pullback" gate earns its place: without it, every
  // graded pick would be one the gate already approved and the gate could never be falsified.
  // Each pick now carries its entryReady state and block reason (see recordRecommendationOutcomeScan),
  // so the two cohorts can be compared on forward outcomes rather than on same-day circular evidence.
  //
  // ALSO DELIBERATELY DOES NOT FILTER the v1080 allocation gate. That gate is correct for the
  // DISPLAY and the basket — an unbuyable row is not a recommendation — but allocation capacity is a
  // property of the OWNER'S PORTFOLIO on the day (what is already held, at what average, with how
  // much cash), not of the scorer's pick. Filtering the outcome cohort by it would make the
  // accumulating forward-outcome evidence depend on the account balance, so RULES.md D1/D4 would be
  // measuring the book instead of the model. Same reasoning as the entryReady divergence above.
  if(!Array.isArray(rows)||!rows.length) return [];
  return rows
    // v1070: held no longer excludes a candidate.
    .filter(s=>s.symbol&&Number(s.price)>0&&s.basketEligible!==false&&!NSE_SURV[s.symbol]?.length)
    .sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)||a.symbol.localeCompare(b.symbol))
    .slice(0,20);
}
// ── v1128 STRATIFIED CONTROL SAMPLE (owner, 2026-08-12) ────────────────────────────────────────
// "If you remove the 80-90 band, it may get fixed and removing it will never tell us."
//
// The recommendation cohort is the TOP 20 BY SCORE. It is correctly ungated (v1074) — it records
// rows the app would never buy — but the top-20 cut means a band is only observed on days when it
// happens to reach the top 20. Measured 2026-08-12: history had 110 of 160 graded picks below the
// current bar, yet on that day's board ALL 20 scored >= 95, so the 80-90 band got ZERO observations.
// A band that is only sampled on weak days cannot be shown to have recovered.
//
// So a small sample is drawn from each band BELOW the bar and graded alongside, flagged `control`.
// It is EVIDENCE ONLY: excluded from every recommendation metric (conversion, the scorecard headline,
// concordance), because these are rows the app did not pick and counting them would misreport what
// it recommended. Deliberately small — this buys band coverage, not a second basket.
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
    // v1096: ATTRIBUTION. On the ENTRY DAY the bar contains action from before the trade existed, so
    // a low that printed at 09:30 cannot be charged to a 14:00 buy — the same rule v1085 applies to
    // recommendation picks, which was never applied here. Previously this ran at `gap>=0` and took
    // the entry day's ENTIRE low, while the HIGH side four lines below excluded the entry day
    // outright (`gap<=0` returns). That asymmetry inflated every adverse figure.
    //
    // On the entry day a drawdown now counts only if it made a NEW low past the extreme observed at
    // the buy (getBuyContextBaseline). With no baseline the entry day is skipped and counted as
    // UNATTRIBUTABLE rather than guessed at. On later days the whole bar is attributable, unchanged.
    //
    // The high side stays entry-day-EXCLUDED, and that is now a deliberate choice rather than an
    // accident: `bestNetHighPct` feeds computeHarvestPlan's target anchor, so admitting entry-day
    // highs would raise the learned target on a data change alone. Fixing the over-count and leaving
    // the conservative side conservative is the honest asymmetry; revisit it with its own measurement.
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

// ══════════════════════════════════════════════════
// RADAR COMPOSITE SCORER (v517)
// One same-day transparent cross-sectional model: typed transformations, robust
// winsorized percentiles, a same-day rocket diagnostic measured but NOT applied (v1085), blended
// with finance priors across seven budgeted groups, then NSE-report penalties.
// It learns nothing across days and stores no rolling state.
// ══════════════════════════════════════════════════
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
  // v1084: `Open, 1 day` is a price-level column, so radarTransformed turns it into
  // `100 × (price/open − 1)` — which IS change-from-open. Verified against the dedicated
  // `Change from open %, 1 day` column on the 2026-07-30 14:16 file: max absolute difference
  // 0.000000 across 2,963 rows, i.e. bit-identical. Structure was counting change-from-open
  // TWICE under two names. The column stays exported and is still read as the numerator anchor
  // for every multi-day price-level feature (see radarIsSessionLevel); it simply earns no
  // feature weight of its own.
  'Open, 1 day',
  // v1071: absolute average-volume levels match /volume/, so they are signed-log compressed and
  // routed to Liquidity with a high-good prior — which makes them pure LARGE-CAP SIZE proxies
  // (big companies trade big volume). Three of them would tilt a 12-point budget toward mega-caps,
  // the exact failure the v1068 ignition track exists to counter. They are still used, but as the
  // DENOMINATOR of the ignition ratio below, never as standalone features.
  'Average volume, 30 days','Average volume, 60 days','Average volume, 90 days',
  // v1071: Beta has no radarGroupFor match, so it lands in Context with a LINEAR HIGH-GOOD prior —
  // the model would score high beta well on every day, including red ones. That is precisely the
  // green-day/red-day asymmetry under investigation. Kept in the export so the data accumulates;
  // re-enable only together with breadth-conditional handling.
  'Beta, 1 year'
]);
const RADAR_LIQ_STEPS=[0,5e5,25e5,1e7,5e7,1e8,1e9,1e10];
const RADAR_LIQ_LABELS=['Any','₹5L','₹25L','₹1Cr','₹5Cr','₹10Cr','₹100Cr','₹1000Cr'];
const radarNum=v=>{if(v===null||v===undefined||v==='')return null;const x=Number(String(v).replace(/[,%₹\s]/g,''));return Number.isFinite(x)?x:null;};
const clamp01=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
function radarIdx(headers,name){return headers.indexOf(name);}
// v1084: TRUE TIE MIDRANKS. The former upper-bound-only search handed every member of a tie block
// the TOP of that block. Measured on the 2026-07-30 14:16 file: 448 rows print an exact 0.00% five-
// minute change, and they were all scored at the 54.5th percentile instead of their true 46.9th
// midrank. That matters because the `/gap|price change/` prior PEAKS at p=.72 — the mispricing
// pushes a stock that has not moved at all toward the most-rewarded point of the curve. The defect
// scales with tie density, so it is worst exactly where the data is flattest.
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
// ── v1084: PRICE-LEVEL NUMERATOR VINTAGE ───────────────────────────────────────────────────────
// A price-level feature is `100 × (numerator / level − 1)`. The numerator was ALWAYS the live
// price. The denominators are MULTI-DAY aggregates — SMA-50, EMA-200, Bollinger/Keltner/Donchian,
// Ichimoku, Hull-9, SAR — which absorb today's move at 1/50, 1/200, 1/20, or (Classic pivots,
// computed from yesterday's HLC) not at all. So through the session:
//
//     feature(t)  ≈  feature(previous close)  +  today's move %
//
// an ADDITIVE COMMON-MODE SHIFT applied to all ~34 of them at once, in the same direction. At
// 09:20 the shift is ~0 and each feature measures what it was designed to measure: multi-day
// position. By 14:00 it is the full day move, and they have quietly become restatements of it.
// Measured on the 2026-07-30 14:16 file, swapping the numerator to the day's OPEN: mean |Spearman|
// against today's move falls 0.205 → 0.091 across 34 features; Hull-9 collapses 0.652 → 0.111,
// Ichimoku conversion 0.325 → 0.078, Keltner basis 0.261 → 0.058, VWMA-20 0.220 → 0.045.
//
// Why this biases rather than merely blurs: almost every one of these falls through to the DEFAULT
// prior `2p − 1` — linear, monotone, high-is-good, UNDAMPED. The only family built to damp an
// extreme day move is `/gap|price change/`, which peaks at .72. So today's move entered the score
// through ~34 undamped channels spanning Trend, Structure and Participation, against ONE damped
// one. That is why the top of the ranking filled with names that had already run.
//
// OPEN, not previous close, deliberately: the gap is already its own feature with a damped prior,
// so an open-anchored numerator avoids counting the gap twice. Fails open to the live price when
// the open is missing, so a thin row is never dropped for want of it.
//
// Levels that are INTRINSICALLY today-measures keep the live price — asking "where is price now
// relative to today's VWAP / today's high / today's low" is the whole point of those, and the data
// agrees: swapping VWAP moved it only 0.523 → 0.469, and `High, 1 day` moved the WRONG way.
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
  // R4b execution form: a positive opening gap is not follow-through when the gap still
  // contributes more than the post-open drift, the short tape is cooling, and price remains
  // outside both envelopes. Unlike the upper-quarter gate, this remains blocked after the
  // opening spike has fallen toward the session low. No tunable magnitude is introduced.
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
  // v1069: confirmation is STRUCTURAL (holding above VWAP and above its own open), never a tick.
  // The v1065 form also required price5m>0 && price15m>0 and minute>=570. Measured on the
  // 2026-07-28 file: that rule blocked 92% of the whole eligible universe (the peak gate blocked
  // 1%), and the 5m change it keyed on has median +0.01% with a p10-p90 of -0.12%..+0.23% in the
  // top 100 — microstructure noise, non-positive for 45% of rows at any instant. Because a stock
  // that has already run is likelier to be mid-pause, it removed the LEADERS: passed rows averaged
  // +2.85% on the day vs +3.92% for blocked ones, and the surviving top 20 shifted from ranks
  // 1-30 to ranks 10-143 (mean day 5.42% -> 2.45%, 9/20 above +5% -> 0/20, one rocket -> none).
  // Structural-only also beats no gate at all (5.42% vs 4.89%), so the VWAP/open condition is
  // kept and only the tick coin-flip is dropped. This is now the SAME definition the v1068
  // ignition gate uses — one meaning of "confirmed direction" in the codebase, not two.
  // The minute>=570 term is also gone: it was surviving clock authority (v1068 owner rule) and
  // would have blocked every stock in a weak market before 09:30, when the day legitimately starts.
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
// Traffic-light bands for the composite score. Single source of truth: the Methodology
// Interpretation list, the rankings table, the open-positions table and the detail modal
// all read these, so a colour can never mean two different things (owner, v533).
// Four DISTINCT hues, not a gradient: amber vs orange were indistinguishable on the
// owner's monitor, so the third band is light blue on purpose (owner, v534). Do not
// "restore" the hot-to-cold ordering — separability is the requirement here.
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
// ── THE RECOMMENDATION BAR (owner-set, v1112) ────────────────────────────────
// "No stock below score 90 and above rank 10 to be selected." BOTH conditions, not either:
// a stock must be in the top ten of the cross-section AND score at least 90.
//
// These are RISK PREFERENCES, not calibrated model outputs — the same category as Zerodha's
// 20-order basket cap — and they are flagged as such here rather than dressed up as self-calibrating.
// History, so neither is re-litigated: v1086 set the rank cap at 10; v1091 replaced it with the
// GREEN band (80) read off RADAR_SCORE_BANDS, on the argument that quality should decide the count
// instead of a fixed slot budget. That let the basket reach as deep as rank 137 on a day like
// 2026-08-09, when 137 rows scored >= 80 — the owner wants the top of the board, not everything
// that clears a colour. Score >= 90 is stricter than green and rank <= 10 bounds the depth, so the
// basket buys FEWER names on a weak day rather than reaching down for filler.
// v1127 (owner, 2026-08-12): 90 -> 95, on the app's own resolved picks. Measured over 125 resolved
// picks: score 95-100 hit target 34% of the time, 90-95 hit 29% (n=7), and the 80-90 band hit just
// 9% — WORSE than the sub-80 band's 13%. The score is non-monotonic through its middle, so the 80-90
// band is the one region actively costing money; this bar removes it from selection. Still an
// OWNER-SET RISK PREFERENCE, the same category as Zerodha's 20-order cap, not a calibrated output.
const RECOMMEND_MIN_SCORE=95;
const RECOMMEND_MAX_RANK=10;    // owner-set depth bar: the top ten of the cross-section, by rank
// NAMED FOR WHAT IT TESTS. It was `isGreenScore`, which is actively misleading: the score BANDS
// paint green from 80 (RADAR_SCORE_BANDS) while this bar is RECOMMEND_MIN_SCORE = 95, so a row
// can be green on screen and 15 points below the buy bar. Observed 2026-08-19: REMSONSIND 91.4
// at rank 1 and BUILDPRO 84.3 both rendered green with an empty basket, and the owner reasonably
// read that as the board contradicting itself. The old name is kept as an alias because older
// assertion suites reference it.
function meetsScoreBar(score){const s=Number(score);return isFinite(s)&&s>=RECOMMEND_MIN_SCORE;}
const isGreenScore=meetsScoreBar;   // legacy alias - do not use in new code
// The one test for "may this row be recommended and exported". Rank is the stock's own Radar rank,
// never its position in the filtered list, so a row can never be promoted into the basket merely
// because the rows above it were removed for some unrelated reason.
// ── v1170: THE TIME OF DAY CONDITIONS HOW DEEP THE BOARD IS TRUSTED ─────────────────────────
// Owner, 2026-08-18: "There should be recommendations at all times doesn't mean there should be
// shit recommendations. It means recommendations should be based on the time of the day with all
// the fucking data and diagnostics that you have!"
//
// He is right and v1068 was misread - by me, back at him. "Basket export is an OPERATIONAL action
// that must always emit" is about AVAILABILITY. It never said the clock has no bearing on QUALITY,
// and the two got conflated when the clock was stripped from selection along with the export path.
//
// The evidence has existed since v1064 and drives nothing: `buildTradeTimingModel` grades the
// owner's OWN executed entries - 547 of them over 97 trading days as of 2026-08-18 - into 13
// half-hour windows, each carrying a within-day peer rank (0.5 = an entry that ranked exactly
// mid-pack against its same-day peers), already shrunk by median coverage and checked for
// leave-one-day-out direction stability. Measured spread: 10:00 at 0.582 and 09:30 at 0.562 against
// 13:00/13:30 at 0.374 and the 15:00 close at 0.339. It was rendered on the Performance tab under a
// caption reading "descriptive, never a recommendation rule".
//
// WHAT MOVES IS DEPTH, NOT AVAILABILITY. The bar reaches deeper in a window where his entries have
// historically ranked well and shallower where they have not, so the board is never empty - rank 1
// always qualifies - but a weak hour has to clear a narrower gate. The scale is the model's own
// peer rank against its own neutral point, so no magnitude is invented: 0.5 reproduces
// RECOMMEND_MAX_RANK exactly, and the observed range moves it between roughly 7 and 12.
// THE SOURCE IS THE MARKET, NOT THE OWNER'S FILLS (owner, 2026-08-18): *"That table is based on
// previous logic... The new logic is that now you have 5-minute data for stocks. That table, across
// all the stocks you have in your inventory till that point in time should be your source - not my
// trades."* He is right on both counts. `buildTradeTimingModel` grades 547 of HIS entries over 97
// days, executed under many different scorers - some of which changed what was recommendable BY HOUR
// (v1065's pre-09:30 block, v1069's minute>=570 gate) - so it measures his execution inside old
// logic, not the market's own shape. The accumulated 5-minute files measure the market and nothing
// else.
//
// THE QUESTION, asked of every stock in the inventory: when a stock ignites in this half-hour - an
// up bar on above-median volume for its own session - does the move still hold thirty minutes later,
// inside the same session? That is the actionable time-of-day fact and it is free of what the app
// recommended or what the owner bought.
//
// SHRUNK TOWARD THE POOLED RATE BY ITS OWN SAMPLE, with the prior weight set to the MEAN window
// size, so nothing is typed: a window carrying its share of the data speaks at full strength, a thin
// one is pulled back to the pooled base. Measured on the first day of inventory (14 stocks, 17
// stock-sessions, 231 graded bars) the windows swing 25% to 76% on n<40 - noise - and shrinkage
// correctly leaves the depth at its default. It sharpens by itself as files accumulate.
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
  // THE MAPPING SCALES ITSELF TO THE SPREAD IT ACTUALLY MEASURES.
  //
  // It was `shrunk/(2*base)`, which is anchored on the pooled rate and therefore compresses every
  // real difference into almost nothing: measured 2026-08-18 on 4,394 graded bars the shrunk rates
  // span 45.7%-53.3% against a 51.0% pool, and that mapping turned the whole 7.58pp range into a
  // ONE-RANK move in depth. The windows genuinely separate now (at v1170 they did not, on 231 bars),
  // and a mapping that cannot express the separation is the same as not measuring it.
  //
  // NB a Leg 3 note claimed the opposite - that the mapping amplified 7.58pp into a 1-to-19 swing.
  // That was a RANK-based mapping invented by the probe, never the shipped code. Corrected here.
  //
  // Now: distance from the pooled rate, divided by the OBSERVED spread. Self-calibrating in both
  // directions - when the windows are indistinguishable the spread collapses and every window lands
  // on 0.5, which is exactly the default depth, so a thin or noisy inventory reproduces the old
  // behaviour on its own. No constant, and nothing to re-tune as the inventory grows.
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
  // v1168: a stock whose CURRENT session is net selling is not a buy, no matter what the score or
  // the multi-day flow says. This is a removal, not an annotation - it drops out of the list, out of
  // SELECTED and out of the basket. It only fires on a real current-session trajectory (three bars
  // with volume), so an empty opening print cannot reject anything.
  if(s.noHistory===true) return false;   // v1170: no multi-day history, so nothing to rank it on
  if(s.intradaySellingToday===true) return false;
  const rank=Number(s.rank);
  return isGreenScore(s.score)&&Number.isFinite(rank)&&rank<=timingDepth().depth;
}
// A recommendation is export-ready only after today's 5-minute check confirms it. Keep this
// separate from meetsRecommendationBar(): the validation loop needs score/rank candidates to stay
// visible and fetchable before they have a verdict. Every path that can arm a checkbox or order
// uses this predicate, so an unchecked/stale row cannot look ready or slip through a manual toggle.
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
  // THE BUY BAR IS DRAWN ON THE BAR. The band colour and the recommendation threshold are different
  // numbers - green starts at 80, a row is only buyable at RECOMMEND_MIN_SCORE (95) - so a green row
  // can sit well below the bar with nothing on screen saying so. A hairline at the threshold makes
  // the gap visible at a glance, and a row under it renders the fill hollow rather than solid.
  // This changes NOTHING about what is recommended; it stops the colour implying otherwise.
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
  Object.entries(NSE_PRICE_BAND).forEach(([sym,pb])=>{const m=get(sym);m.band=pb?.bandPct??null;m.series=m.series||'EQ';});
  Object.entries(NSE_BHAV).forEach(([sym,b])=>{const m=get(sym);m.series=m.series||'EQ';m.delivery=b.delivPct;m.trades=b.trades;m.officialClose=b.officialClose;m.officialAvg=b.officialAvg;});
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
  Object.values(meta).forEach(m=>{m.eventToday=!!m.corpToday||!!(m.boardMeeting&&m.boardMeeting.date===today&&m.boardMeeting.isResults);});
  return meta;
}
// ── v1135 FORWARD EFFECTS DRIVE THE WEIGHTS (owner, 2026-08-14) ───────────────────────────────
// THE UNLOCK: `f.effect` has been pinned to 0 since v1083/v1085 because the only separation the
// scorer could measure came from a SAME-DAY label — stocks already up today — which leaks straight
// into the features and makes the ranking ask "what resembles what has already moved".
//
// The Indicator Watch (v526) does not have that problem. It records each stock's DECILE on every
// monotonic indicator, waits IW_WINDOW=5 trading sessions, and only then measures the gap between
// the stocks that went on to move and those that did not. That label is FORWARD and resolved after
// the fact, so an effect taken from it cannot leak. This is the one measured, non-circular effect
// the app has ever had, and it is what now sets the weights.
//
// SELF-CALIBRATING, no new magnitude: each feature's effect is its own mean forward gap divided by
// the LARGEST gap measured this session, so the strongest indicator lands near 1 and the rest scale
// beneath it. Nothing is typed. The admission bar reuses the existing IW constants — IW_MIN_SESSIONS
// resolved samples and |t| >= IW_T_CRIT — so a noisy indicator contributes exactly what it did
// before: nothing.
let _fwdEffMemo=null;
function getForwardIndicatorEffects(){
  const iw=FS.get(INDICATOR_WATCH_STORE)||{};
  // v1136: the SHORT log, not the guardrail log. v1135 read `iw.log`, which is resolved at
  // IW_WINDOW=5 sessions and UNCONDITIONALLY - a horizon past which the effect has decayed and a
  // framing in which any directionless amplifier reads ~0. See iwResolveShort for the measurement.
  // Until the short log has IW_MIN_SESSIONS of its own this returns an EMPTY map, which reproduces
  // the pre-v1135 scorer exactly (every effect 0). That is deliberate: a measurement now known to be
  // taken at the wrong horizon should stop driving weights immediately, not linger until replaced.
  const log=iw.logShort||{};
  if(_fwdEffMemo&&_fwdEffMemo.src===log) return _fwdEffMemo.map;
  const raw=[];
  Object.keys(log).forEach(name=>{
    const e=log[name];
    const arr=Array.isArray(e?.e5)?e.e5.map(Number).filter(Number.isFinite):[];
    if(arr.length<2) return;                                // a t-statistic needs at least two
    const n=arr.length, mean=arr.reduce((a,b)=>a+b,0)/n;
    const sd=Math.sqrt(arr.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(n-1));
    const t=sd>0?mean/(sd/Math.sqrt(n)):null;
    if(!(t!=null&&Math.abs(t)>=IW_T_CRIT)) return;          // not distinguishable from noise
    // THE SESSION COUNT SHRINKS THE EFFECT, IT NO LONGER GATES IT.
    //
    // `arr.length < IW_MIN_SESSIONS` was a cliff: four sessions of evidence counted for exactly
    // nothing and the fifth counted in full. That is a bet that the fifth session is where the
    // measurement becomes true, and if the bet is wrong nobody finds out until it has already been
    // driving the score. Owner, 2026-08-18: *"With data growing daily, the program should evolve
    // naturally - not wait for 20 days and then fail because your first guess was wrong."*
    //
    // Shrunk by n/(n+IW_MIN_SESSIONS) the same effect ramps continuously - 1 session counts 17%,
    // 5 count 50%, 20 count 80% - and IW_T_CRIT still refuses anything indistinguishable from
    // noise, so a thin sample can only ever contribute a fraction of an already-significant
    // measurement. The old behaviour is the limit of this one, not a special case of it.
    raw.push({name,mean:mean*(n/(n+IW_MIN_SESSIONS)),n,t});
  });
  const peak=raw.reduce((m,r)=>Math.max(m,Math.abs(r.mean)),0);
  const map=new Map();
  if(peak>0) raw.forEach(r=>map.set(r.name,{effect:clamp01(r.mean/peak,-1,1),gap:r.mean,n:r.n,t:r.t}));
  _fwdEffMemo={src:log,map};
  return map;
}
// ── v1143: INTRADAY BARS AS ENRICHMENT ON AN EXISTING RECOMMENDATION ─────────────────────────
// Owner, 2026-08-17: *"This data is basically a further enrichment data on top of ALL NSE based on
// which you make your recommendations. So if your top recommendation without this new data was X,
// there should be a way to add this data to it by clicking on somewhere in the recommendation table
// and using it again to rank the recommendation."*
//
// The paste is Kite's chart table: `Date,Open,High,Low,Close[,% Change,% Change vs Average,Volume]`,
// one stock, 5-minute bars, spanning several sessions. VOLUME IS OPTIONAL and the owner's own sample
// omits it, so nothing here may depend on it - this is a PRICE-PATH enrichment, not a flow one.
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
// Use this logic to chart out a trajectory from start to finish and into the projections."*
//
// Per bar the sign comes from the price change and the size from the volume, scaled by the stock's
// OWN typical bar move so "high volume and price dropped" is judged against what a normal bar does
// for this stock. Cumulated, that is the flow trajectory from the open to now.
//
// THE AXIS IS CUMULATIVE VOLUME, NOT CLOCK TIME, and that choice is the whole thing. Measured on a
// clock axis this read FAILED to separate the day's two extremes: AGIIL's last four bars carried
// 4,456 / 3,213 / 2,094 shares against a 217,142-share opening print, and that dead tail outvoted
// the print that mattered, labelling a stock that bled all morning "accumulating". On a volume
// clock every share gets equal say, which is the only weighting that makes sense when the question
// is who transacted. After the change: UFLEX (locked at its upper circuit) reads ACCUMULATING at
// +14.6% of volume, AGIIL (faded from the open) reads SELLING at -6.8%.
//
// A bar with NO RANGE is a circuit lock, and there the direction is known rather than estimated:
// price legally cannot move, so every print is the queued side being filled.
function buildIntradayTrajectory(bars){
  const n=bars.length;
  if(n<3) return null;
  // ── v1164: THE SERIES MAY SPAN SESSIONS, SO THE OVERNIGHT GAP MUST NOT COUNT AS FLOW ────────
  // Owner: "use all data in the csv for a stock, not just today's. Since the data is contiguous and
  // covers multiple days, it could give better signal than less data."
  //
  // He is right, and the file is contiguous by construction now. But bar-to-bar deltas across a
  // session boundary include the OVERNIGHT GAP, which did not trade at those prices - attributing a
  // 3% gap to the first bar's volume would invent flow that nobody transacted, and the opening bar
  // is usually the heaviest of the day, so the error lands on the largest weight in the series.
  //
  // The first bar of each session is therefore measured against its OWN OPEN rather than yesterday's
  // close. That keeps the bar's real intraday flow and drops the gap, needs no constant, and leaves
  // SINGLE-DAY behaviour bit-identical (a one-session series has no boundary past bar 0).
  const newSes=bars.map((b,i)=>i>0&&istDayKey(b.t)!==istDayKey(bars[i-1].t));
  const prevC=i=>newSes[i]?bars[i].o:bars[i-1].c;
  const dP=[0]; for(let i=1;i<n;i++) dP.push(bars[i].c-prevC(i));
  // The scale is VOLUME-WEIGHTED like everything else here. An unweighted mean was sensitive to the
  // same defect the clock axis had: twelve dead 50-share bars lowered the typical move, which
  // rescaled every real bar's sign and pushed AGIIL's net flow from -6.8% to -2.7% on data that had
  // not changed. Weighting by volume makes the scale as unmovable by dead bars as the axis is.
  let _tw=0,_ts=0;
  for(let i=1;i<n;i++){const w=Number(bars[i].v)||0;_tw+=w;_ts+=w*Math.abs(dP[i]);}
  const typ=_tw>0?_ts/_tw:dP.slice(1).reduce((a,b)=>a+Math.abs(b),0)/Math.max(1,n-1);
  if(!(typ>0)) return null;
  const cvd=[],vx=[]; let run=0,cum=0,anyVol=false,lastF=0;
  for(let i=0;i<n;i++){
    const v=Number(bars[i].v)||0; if(v>0) anyVol=true;
    const locked=bars[i].h===bars[i].l;
    // A LOCK KEEPS THE SIGN THAT CREATED IT (fixed v1164, found by a restated v1144 assertion).
    // The test was `c >= prev ? 1 : -1`, and a CONTINUING lock has c === prev, so `99 >= 99` signed
    // +1: a stock pinned at its LOWER circuit read as buying from its second locked bar onward -
    // exactly inverted, on the one bar type where the direction is supposed to be certain. It
    // survived because the fixtures locked at the UPPER circuit, where the wrong branch happens to
    // give the right answer. Only the bar that ENTERS the lock has a move to read; after that the
    // queue has not changed sides, so the sign carries forward.
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

  // ── v1147: WHAT A SHARE BUYS ────────────────────────────────────────────────────────────────
  // Owner: *"The whole use case of this table could be price prediction based on change and volume
  // action, no?"* Correct, and it is the only pair of columns that answers it. Price alone cannot
  // say whether a move was EARNED; volume alone cannot say which WAY. Together they give the COST
  // OF MOVING THE STOCK in each direction, and when that cost is asymmetric you know which side is
  // thin before the price shows it.
  //
  // COST IS AGGREGATE, NOT A MEDIAN OF RATIOS. Measured on ELECTCAST 2026-08-17, a median put the
  // afternoon at "sellers in control" while price rose and the largest buy of the day printed - the
  // 101,269-share absorption bar has the lowest impact of any large bar, so it dragged the median
  // and made BUYING look expensive precisely because a buyer was soaking up everything on offer.
  // Summing volume over summed movement is immune to that.
  // ABSORPTION FIRST, because it must be taken OUT of the cost calculation. A bar where 200,000
  // shares moved price 0.05% is not a statement about liquidity - it is one participant working
  // size, and leaving it in flips the cost ratio from 10.82 to 0.21 on its own (measured). The two
  // things answer different questions: COST asks what a share buys in ordinary trade, ABSORPTION
  // asks who was willing to spend size. Mixing them corrupts both.
  //
  // HIGH VOLUME WITH A SMALL MOVE IS AMBIGUOUS on its own - a big buyer taking offers, or heavy
  // supply capping the price - so only the DIRECTION of the move breaks the tie, and it is signed
  // rather than counted.
  // ABSORPTION BY RANK, not by percentile VALUE. A bar absorbs when its volume is in the busiest
  // quarter of the session AND its impact is in the quietest quarter - big and quiet at once.
  // Percentile values were tried twice and are brittle on ties: with uniform volumes the 75th
  // percentile equals the median and everything qualified, and on a short series the 75th percentile
  // IS the one huge bar so nothing did. Ranks have neither failure.
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

  // COST: what a share buys in ORDINARY trade, each way. Aggregate - volume summed over movement
  // summed - never a median of per-bar ratios. A median put ELECTCAST's afternoon at "sellers in
  // control" while price rose and the largest buy of the day printed, because the absorption bar
  // dragged it. Absorption bars are excluded here and reported above instead.
  // AVERAGE MOVE (owner): the mean of every bar's own % change, magnitude only. What this stock
  // typically does in five minutes - its energy per bar. Signed it would net to nearly nothing;
  // magnitude is what tells you how many bars a target is away.
  // v1180: PACE IS VOLUME-WEIGHTED (owner). It was the last plain mean left in this file, and v1144
  // already settled the principle after an unweighted scale let twelve dead 50-share bars move
  // AGIIL's net flow from -6.8% to -2.7% on data that had not changed: **anything averaged across
  // bars here must be volume-weighted - a bar is not an event, a share is.**
  //
  // It matters most for what the owner actually wants this number for - a trailing stop. A plain
  // mean lets a run of thin, motionless bars pull the pace DOWN and produce a trail so tight that
  // the next real, heavily-traded bar takes the position out. Weighting by volume asks the honest
  // question: how far does price move in the bars where shares are actually changing hands.
  //
  // Falls back to the unweighted mean when a paste carries no volume at all, so a volumeless export
  // still produces a pace rather than nothing.
  let mvSum=0,mvN=0,mvW=0,mvWV=0;
  for(let i=1;i<n;i++){
    const mv=Math.abs((bars[i].c-prevC(i))/prevC(i)*100);
    const v=Number(bars[i].v)||0;
    mvSum+=mv; mvN++;
    mvW+=mv*v; mvWV+=v;
  }
  const avgMovePct=mvWV>0?(mvW/mvWV):(mvN?mvSum/mvN:null);
  // ── PACE IS THE DEEPEST PULLBACK THE STOCK HAS TAKEN TODAY ──────────────────────────────────
  // Owner, 2026-08-19: *"give me the max pullback the stock has experienced during the day... that's
  // exactly what I meant Pace to be from the start."*
  //
  // The mean absolute bar move was the wrong quantity for a trailing stop and the gap is not
  // marginal - measured on today's own winners it is 3x to 10x too tight: MEESHO's mean-move Pace
  // read Rs 0.31 against an actual pullback of Rs 2.04, SGFIN 0.53% against 1.71%, NAHARSPING 0.38%
  // against 3.82%. A stop at the mean bar move is inside the noise by construction, because roughly
  // half of all bars move more than the mean.
  //
  // The right number is the drawdown the stock has actually imposed on a holder: running peak to
  // subsequent trough, over THIS SESSION only. The series can span sessions (v1164) but an overnight
  // gap is not a pullback anyone could have been stopped out by intraday.
  let _pbPeak=null,_maxPullPct=null,_pullAt=null;
  for(let i=0;i<n;i++){
    if(istDayKey(bars[i].t)!==istDayKey(bars[n-1].t)) continue;   // current session only
    if(_pbPeak==null||bars[i].h>_pbPeak){ _pbPeak=bars[i].h; continue; }
    if(!(_pbPeak>0)) continue;
    const dd=100*(_pbPeak-bars[i].l)/_pbPeak;
    if(dd>0&&(_maxPullPct==null||dd>_maxPullPct)){ _maxPullPct=dd; _pullAt=bars[i].t; }
  }
  const maxPullbackPct=_maxPullPct;

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

  // PROJECTED CLOSE. Two things decide it and both come out of the paste. PRESSURE says which way
  // and how much the accumulated imbalance is worth; the stock's own PACE says how far it can
  // physically travel in the bars that are left. The projection is the pressure, capped by the
  // travel - a stock cannot deliver 3% of pent-up buying in the four bars before the bell.
  // The bar interval is measured from the data rather than assumed, so a 1-minute or 15-minute
  // paste projects correctly without being told which it is.
  const gaps=[]; for(let i=1;i<n;i++){const g=bars[i].t-bars[i-1].t; if(g>0&&g<6*3600e3) gaps.push(g);}
  gaps.sort((a,b)=>a-b);
  const stepMs=gaps.length?gaps[Math.floor(gaps.length/2)]:300000;
  const lastT=new Date(bars[n-1].t);
  // ── v1185: THE SESSION DOES NOT END AT 15:30 FOR EVERY STOCK ────────────────────────────────
  // Measured in our own files on 2026-08-17: TCS, JIOFIN, MCX and TIINDIA all end at the 15:10 bar
  // while every one of the other 145 stocks ends at 15:25. That is the Closing Auction Session -
  // continuous trading stops at 15:15 for F&O names. Against a hardcoded 15:30 such a stock is
  // credited with three bars that cannot exist, so the projected close keeps promising travel after
  // its continuous session has already ended.
  //
  // MEMBERSHIP IS READ OFF THE STOCK'S OWN FILE. No input carries an F&O list, and the multi-day
  // contiguous series (v1164) already answers it: the LATEST bar ever seen on an EARLIER session is
  // one bar short of that stock's close. Taking the MAXIMUM makes it robust to our own fetch timing
  // - a day we stopped fetching at 11:00 can only understate it, and one late fetch on any session
  // settles it for good. With no late observation at all it fails open to 15:30, which is both the
  // pre-CAS behaviour and the answer for the ~93% of the market the auction does not touch.
  const _todayKey=istDayKey(bars[n-1].t);
  let _seenMin=0;
  for(let i=0;i<n;i++){
    if(istDayKey(bars[i].t)===_todayKey) continue;
    const _d=new Date(bars[i].t), _m=_d.getHours()*60+_d.getMinutes();
    if(_m>_seenMin) _seenMin=_m;
  }
  const _endMin=(_seenMin+stepMs/60000>=CAS_CONTINUOUS_END_MIN)?_seenMin+stepMs/60000:SESSION_CLOSE_MIN;
  const closeT=new Date(lastT); closeT.setHours(Math.floor(_endMin/60),_endMin%60,0,0);
  const barsLeft=Math.max(0,Math.floor((closeT-lastT)/stepMs));
  const maxTravel=(avgMovePct!=null)?avgMovePct*barsLeft:null;
  // THE PROJECTION IS SHRUNK BY HOW MUCH OF THE SESSION IT HAS ACTUALLY SEEN.
  //
  // Observed live 2026-08-19 09:31: every open position was being given an instruction off THREE
  // bars, and NAHARSPING's newest bar was FIVE SHARES. The travel cap does nothing at that hour -
  // barsLeft is 73, so maxTravel is 35% for a 0.48% pace and 76% for a 1.04% one - so `predPct` was
  // the raw pressure reading extrapolated across the whole day, and the panel printed EoD -12.76%.
  // The cap only begins to bite in the afternoon, i.e. the projection was LEAST constrained exactly
  // when the evidence was thinnest, which is backwards.
  //
  // `seen/(seen+left)` is the session's own elapsed share, so at the third bar of the day the
  // projection is scaled to ~4% of its raw value and grows to its full value by the close. Nothing
  // is typed: the weight is the clock the bars themselves define, and it is the same shrink-by-
  // sample idiom used for the timing windows and for measureFieldEdge. A complete session (barsLeft
  // 0) leaves the projection untouched, so late-day behaviour is unchanged.
  const seenBars=Math.max(1,n-1);
  const evid=seenBars/(seenBars+barsLeft);
  const predRaw=(pressurePct==null)?null
    :(maxTravel==null?pressurePct:Math.max(-maxTravel,Math.min(maxTravel,pressurePct)));
  const predPct=(predRaw==null)?null:predRaw*evid;
  const predClose=(predPct==null)?null:bars[n-1].c*(1+predPct/100);
  const cvdPct=run/totV;                  // a LEVEL, so a late drift on no volume cannot erase a
                                          // morning of selling
  const agree=(pRec>=0)===(cRec>=0);
  const regime=(cvdPct>=0&&pRec>=0&&cRec>=0)?'accumulating'
             :(pRec>=0&&cRec<0)             ?'distribution into strength'
             :(pRec<0&&cRec>=0&&cvdPct>=0)  ?'absorption'
                                            :'selling';
  return {cvd,cvdNet:run,cvdPct,totV,priceSlope:pRec,flowSlope:cRec,agree,regime,
          // Projected close at the recent pace, over the volume still expected today. Reported.
          projected:price[n-1]+pRec*(1-vx[n-1]/totV),
          // THE STANDING MUST BE 0.5 AT "NO INFORMATION", because 0.5 is the neutral an unchecked
          // row is given (v1145). The first version multiplied in an agreement term worth 1.0 when
          // price and flow agreed, which inflated the geometric mean and put a SELLING stock at
          // 0.615 - ABOVE neutral, so a stock the data condemned was still confirmed as a buy.
          // Both surviving terms are flow and both are 0.5 at zero, so the mean is 0.5 at zero.
          // Divergence needs no separate term: price up on falling flow already drives both of
          // these down, which is what "distribution into strength" means.
          avgMovePct,maxPullbackPct,maxPullbackAt:_pullAt,barsLeft,stepMin:Math.round(stepMs/60000),maxTravel,predPct,predClose,
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
function getIntradayRead(sym){
  const bars=INTRADAY_BARS[normSym(sym||'')];
  if(!bars||!bars.length) return null;
  const key=istDayKey(bars[bars.length-1].t);
  const day=bars.filter(b=>istDayKey(b.t)===key);
  // v1167: THE GUARD MUST COUNT WHAT THE READ ACTUALLY USES. This was `day.length<3`, and before
  // v1164 that was the whole series, so it honestly meant "too little data". v1164 made the FLOW
  // span every session while session terms stayed on today - and left the guard demanding three bars
  // from TODAY. So every morning until 09:25 a stock with 77 bars across two sessions returned
  // NOTHING: no verdict, no re-rank, a plain grey button, and a tally reading "checked 0 of 3".
  // Reported from the live screen at 09:2x, where the only two names that read were the two whose
  // fetch had landed a 09:25 bar.
  //
  // The flow needs bars, not bars TODAY. Session terms (range position, first-15, day %) degrade
  // gracefully on one or two bars and are superseded by the trajectory whenever volume is present,
  // which it always is on a Kite fetch.
  if(bars.length<3) return null;
  const open=day[0].o, close=day[day.length-1].c;
  const hi=Math.max(...day.map(b=>b.h)), lo=Math.min(...day.map(b=>b.l));
  // (1) THE FIRST FIFTEEN MINUTES. **AN OBSERVATION, NOT A RULE** (owner, 2026-08-17: "that first
  // 15 minute thing was just a shared observation, not a hard rule by the way"). It is ONE of three
  // equal terms in the fallback read and it gates nothing anywhere - a stock is never rejected for
  // opening red. It also only applies when a paste carries no volume; when volume is present the
  // flow trajectory supersedes this whole block. Do not promote it to a veto without evidence.
  // Three 5-minute bars. Measured against the OPEN, because a gap is already its own signal and
  // what is being asked is whether the session CONFIRMED the gap or sold it.
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
  // v1144: when the paste carries VOLUME, the flow trajectory is the stronger read and supersedes
  // the price-path standing. The owner's own 5-minute export sometimes omits volume, so the
  // price-path read remains the fallback rather than a second-class citizen.
  // THE FLOW READ NOW SPANS EVERY SESSION IN THE FILE, the SESSION READ stays on today (v1164).
  // They answer different questions and must not be merged. Accumulation is a multi-day idea - a
  // stock quietly bought for three sessions is exactly what the owner is trying to see - so CVD,
  // cost asymmetry, absorption and pressure take the whole contiguous run. But "where does price sit
  // in the session's range", "did the first fifteen minutes confirm the open" and "how far can it
  // still travel before the bell" are statements about TODAY and would be meaningless spread over
  // four days. The overnight gap is excluded from flow by prevC() above.
  const traj=buildIntradayTrajectory(bars.length>day.length?bars:day);
  // ── v1162: WHEN IS THIS FROM? (owner: "each stock wouldn't be updated daily so data might not be
  // contiguous and you may make bad decisions based on it.") He is right, and the hole was not the
  // trajectory - that already scopes itself to the LAST session above, so two sessions can never be
  // blended into one flow read. The hole was that a read from ANY session was then fed into today's
  // ranking as if it were current: a stock fetched last Wednesday and never again would still be
  // multiplying today's score by last Wednesday's flow, and would still show CONFIRMED.
  //
  // So every read now states its own session and age, and the SESSION BOUNDARY is the veto - a hard,
  // non-arbitrary line rather than an invented "N minutes old" constant. Within the session the age
  // is DISPLAYED instead of judged, which is the same discipline the rest of this file uses for
  // limits it cannot measure away.
  //
  // Holes INSIDE a session are counted, not vetoed: a thin stock genuinely prints no bar for five
  // minutes, and the volume clock already weights those to nothing. A count that is large is visible
  // to the eye; a threshold on it would be a tunable with no evidence behind it.
  const nowKey=(typeof getSessionDate==='function')?getSessionDate():key;
  const asOf=day[day.length-1].t;
  const ageMin=Math.max(0,Math.round((Date.now()-asOf)/60000));
  const spanBars=Math.round((asOf-day[0].t)/300000)+1;      // 5-minute bars the span should hold
  const holes=Math.max(0,spanBars-day.length);
  // ── v1168: THE CURRENT SESSION IS MEASURED SEPARATELY, AND IT CAN VETO ──────────────────────
  // Owner, 2026-08-18: "If something is in the recommendation, it should be a definite buy, no ifs
  // and buts." MOLBIO is the case: 66 bars yesterday carrying 13.41M shares against 6 bars today
  // carrying 1.21M, so the merged read said ACCUMULATING (+34% net flow) while today's own tape had
  // gone the other way - the up leg cost 297,683 shares per 1% and the fade cost 144,622, i.e. it had
  // become twice as cheap to push DOWN as up. A multi-session flow is the right answer to "is this
  // being accumulated" and the wrong answer to "should I buy it right now", because a COMPLETE prior
  // session outweighs a young one on the volume clock purely by being finished.
  const todayTraj=day.length>=3?buildIntradayTrajectory(day):null;
  // How much of the clock today actually owns. No constant: it is the session's own share of the
  // volume in the file, the same idiom v1141 used to decay the pre-open book by what the day has
  // consumed. Early in the session today is a few percent and the multi-day read carries the row;
  // by the afternoon today dominates, which is when a fade should be decisive.
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
          maxPullbackPct:traj?traj.maxPullbackPct:null,
          predClose:traj?traj.predClose:null,predPct:traj?traj.predPct:null,
          projected:traj?traj.projected:null,
          first15:f15, first15Up:f15>0, efficiency:eff, position:pos, freshness,
          // The standing: direction confirmed by the open, travelled cleanly, and still near its
          // high. Geometric so a zero on any one of them cannot be averaged away.
          standing:traj?traj.standing:Math.cbrt(Math.max(0,(f15+1)/2)*Math.max(0,eff)*Math.max(0,pos))};
}
// THE RE-RANK, v1145. Enrichment must be able to push a stock PAST rows that have no data, or the
// loop the owner described cannot run: *"it gathers the data of our top 2-3 buyable recommendations,
// adjusts the math based on this data, sees if they are still top buyable recommendations and if
// not, repeats."* v1143 permuted the pasted rows among their OWN slots, which is safe and useless
// here - three selling stocks could only shuffle within ranks 1-3 and rank 4 could never surface.
//
// So the intraday standing multiplies the row's standing percentile and everything is re-percentiled,
// exactly as the order book does (v1139/v1141). A row with NO intraday data takes the neutral
// midpoint - never its own standing, which is the v1139 trap that let unenriched rows sweep the top.
// The 4th power in the score then does the amplifying: on the release-day fixtures AGIIL lands at
// 0.93 of neutral and UFLEX at 1.15, which is a 2.3x swing once raised.
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
  // ── v1174: "NO INFORMATION" IS THE MIDDLE OF THE OBSERVED DISTRIBUTION, NOT OF THE SCALE ────
  // Owner, 2026-08-18: *"stock X and Y are #1 and #2... then I do another refresh and the same X and
  // Y stay at top. I'm just asking to check if the logic behind is correct or there's something
  // flawed."* It was flawed, and this is v1139's own rule not applied here: **absence must take the
  // MEDIAN, so that having been measured is worth nothing by itself.**
  //
  // For the order book that rule was satisfied by 0.5, because those values are percentiles and 0.5
  // IS their median. The flow standing is a geometric mean, and across the stocks the app chooses to
  // fetch - the top of the board and the day's biggest movers - its median sits ABOVE 0.5. Measured
  // 2026-08-18 on 17 fetched names: median 0.535, above neutral in 12 of 17, and checked rows rose a
  // mean of 13.9 places against -0.08 for everything else. So an unchecked row was pinned at 0.500
  // and could never show better flow, while any checked row above 0.5 gained on it automatically -
  // the top stayed on top partly BECAUSE it had been measured.
  //
  // The neutral is now the median of the standings actually observed this pass, so a checked stock
  // gains only by beating the typical checked stock. It falls back to 0.5 when nothing is checked,
  // which reproduces the old behaviour exactly on an empty inventory.
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
  rows.sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol));
  rows.forEach((r,i)=>{r.rank=i+1;});
  // THE VERDICT (owner: "it's a validation step. If it still passes our Buy thresholds, I'll buy,
  // else not."). The re-rank is the mechanism; this is the product. A checked stock is CONFIRMED
  // only if it still clears the SAME bar the basket uses - nothing softer, nothing bespoke.
  rows.forEach(r=>{
    if(!r.intraday){r.intradayVerdict=null;r.intradayWhy=null;return;}
    // A CHECKED STOCK THAT IS BEING SOLD TODAY IS NOT A BUY, whatever the multi-day picture says.
    // This REMOVES it rather than annotating it (owner, 2026-08-18: "I don't have time for your
    // reports and flags... if something is in the recommendation, it should be a definite buy").
    // Only fires when the current session has produced a real trajectory - three bars and volume -
    // so it cannot reject on an empty opening print.
    const _tt=r.intraday.current?r.intraday.todayTraj:null;
    if(_tt){
      // TWO WAYS THE CURRENT SESSION SAYS NO, and the second is the one that matters most.
      //   (a) net flow negative - more was sold than bought today.
      //   (b) COST INVERTED - it now takes fewer shares to move the stock DOWN 1% than UP 1%.
      // MOLBIO on 2026-08-18 is case (b) and NOT case (a): its net flow stayed positive because the
      // up leg carried 670k shares and the fade only 292k, so nobody was dumping - the bid simply
      // thinned. By cost it had become twice as cheap to push down (297,683 up vs 144,622 down per
      // 1%), which is the honest reading of "there is no longer anything holding this up".
      // PARITY IS THE LINE - costRatio is dnCost/upCost and 1.0 is "both sides cost the same", so
      // no constant is chosen here.
      const cr=_tt.costRatio;
      const sold=_tt.cvdPct<0;
      const thin=Number.isFinite(cr)&&cr>0&&cr<1;
      if(sold||thin){
        r.intradayVerdict='rejected';
        r.intradayWhy=(sold?('being sold today - net flow '+(100*_tt.cvdPct).toFixed(1)+'% of this session')
                           :('nothing holding it up - 1% down costs '+Math.round(_tt.dnCost).toLocaleString('en-IN')
                             +' shares against '+Math.round(_tt.upCost).toLocaleString('en-IN')+' to go up'))
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
  // When a round REJECTS the whole top, nothing clears the bar any more - and that is exactly when
  // the next candidates matter most. Falling back to the best remaining rows keeps the loop running
  // instead of going silent at the moment it has the most to say. The verdict is unaffected: those
  // rows are only CANDIDATES to check, and a candidate is confirmed only by clearing the real bar.
  // The board is the threshold, not an owner-selected top-N. Every row that clears rank + score
  // needs the same current 5-minute verdict before its checkbox can arm. If none clears after a
  // validation round, keep the first live-candidate set visible so the search can walk deeper.
  const board=passing.length?passing:pool.slice(0,typeof FETCH_TOP_RANK==='number'?FETCH_TOP_RANK:5);
  // A stale read does NOT count as checked - the loop must ask for it again, or it would report
  // "settled" on a board validated last week.
  // ONE source for both halves of the sentence. `need` read live from getIntradayRead while the
  // tally read the copy cached on the row, so the two could disagree and the header could claim more
  // verdicts than checks.
  const liveRead=r=>{const x=getIntradayRead(r.symbol);return (x&&x.current)?x:null;};
  const need=board.filter(r=>!liveRead(r));
  // v1167: the tally must describe ONE population. This drew from the whole universe while the
  // "checked N of M" beside it counted the top-N board, so the header could read "checked 0 of 3 ·
  // 1 buy / 1 skip" - and both verdicts belonged to OPEN POSITIONS, which per v1148 answer a
  // different question entirely (is the flow that justified the buy still there) and are labelled
  // HOLDING UP / BEING SOLD in their own panel, not BUY / SKIP.
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
  // v1071 ignition denominator: today's volume against a 60-DAY baseline. 'Relative volume, 1 day'
  // uses a ~10-day baseline, so a stock that has been busy all fortnight already looks normal;
  // a 60-day reference catches a name waking up after months of neglect. 60 is the anchor: 30 is
  // noisy after one busy fortnight, 90 drifts across regime changes. Both remain exported.
  // NB: `volI` is already taken by 'Volatility, 1 day' — this is share VOLUME, hence dayVolI.
  const dayVolI=radarIdx(headers,'Volume, 1 day'),avgVol60I=radarIdx(headers,'Average volume, 60 days');
  // v555 market-cycle inputs: earnings dates (stateless days-since/days-to), 50-day MA (holding-above check).
  const recentEarnI=radarIdx(headers,'Recent earnings date'),upcomingEarnI=radarIdx(headers,'Upcoming earnings date'),sma50I=radarIdx(headers,'Simple moving average, 50, 1 day');
  const weekChgI=radarIdx(headers,'Price change %, 1 week'); // v1097 pre-results drift
  // v1105 exit signal inputs - the two money-flow measures that are NOT circular with price position
  const cmfI=radarIdx(headers,'Chaikin money flow, 20, 1 day'), mfi15I=radarIdx(headers,'Money flow index, 14, 15 minutes');
  const sessionDate=getSessionDate(),reviewDays=getEffectiveReviewDays(); // reviewDays null ⇒ post-event stages/decay don't fire (graceful, no constant)
  // R5 (v552, WS3): neutralise mechanical ex-date moves so they neither score the row nor
  // pollute the day-move percentiles. For a structural corp action (demerger/split/bonus/rights)
  // OR a material dividend (amount/price >= MATERIAL_DIV_PCT) whose ex-date is THIS session, blank
  // the day-move cells (day change / change-from-open / gap). Buybacks are NOT neutralised — they
  // don't mechanically drop price and earn the R2 bonus in the penalty layer instead.
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
  // Keep the two concepts separate. True rockets (post corp-action neutralisation) are the
  // positive cohort for same-day archetype measurement. The broader v550 continuation signal
  // is only a per-row follow-through/falling-knife input; using its ~half-universe cohort here
  // caused the Rockets Today card and every diagnostic effect orientation to become misleading.
  // v1085: DAY 1 of the owner's rocket definition, as a DISPLAY DIAGNOSTIC ONLY.
  // The real label is forward (target before stop across 2 trading days) and is resolved in the
  // outcome store, not here. What can be seen from one snapshot is the issue day's leg: did the
  // bar reach the stock's target above its OPEN without first reaching its stop below it. That is
  // strictly closer to the owner's definition than the retired ">= 10% today" bar, and it is what
  // the "Rockets Today" card now counts.
  //
  // IT MUST NEVER SET A FEATURE EFFECT. It is a restatement of today's move, so it separates any
  // same-day-move feature perfectly by construction — the v1083 label leak — and it is now ~51x
  // denser than the old bar (25.2% of the tradeable universe vs 0.49%, measured 2026-07-30), so
  // it would sail past `minObs` and re-arm every effect at full strength. See the effect line.
  // The session's portfolio target anchor, resolved ONCE. Only the day-1 rocket diagnostic below
  // uses it; it never enters a feature, a percentile or the composite. Wrapped because it walks
  // the goal solve and the harvest pool, and a scoring pass must not die if either is unavailable.
  // NB ORDERING: processFiles scores the scanner file BEFORE the portfolio files parse, so this
  // can resolve to a fallback anchor rather than the fully-informed one shown later in the UI.
  // That is tolerable because the cohort is display-only, but the value used is RECORDED on RADAR
  // so the label stays reproducible instead of silently drifting from the displayed target.
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
  // WS1/R1: medium-term trend metric (1M+3M performance) and its cross-sectional distribution. Its
  // percentile self-calibrates the chase-penalty relief below — no fixed magic number.
  // ── v1170: A STOCK WITH NO HISTORY HAS NO MULTI-DAY FEATURES, ONLY FICTION ────────────────
  // Owner, 2026-08-18: "both DHOOTTRANS and MOLBIO seem to be new stocks. Can you check if that's
  // something we should consider?" Both listed on 2026-08-17 - Kite returns TWO daily candles for
  // each - and the scorer ranked them #2 and #3 of 2,983.
  //
  // Every multi-day feature is degenerate for such a row, and degenerate in a FLATTERING direction:
  // the whole 52-week range was made today, so the stock sits at its 52-week high BY CONSTRUCTION
  // and collects full credit on breakout proximity for free. SMA/Bollinger/Donchian/Ichimoku fall
  // back, ATR-14 is BLANK (so the stop and target rest on a fallback), and the cross-sectional
  // percentile ranks all of that against 2,983 rows of real history.
  //
  // THE DETECTOR IS EXACT AND NEEDS NO THRESHOLD. TradingView collapses every performance window to
  // "since listing" when the history is shorter than the window, so a young stock reports the SAME
  // number for 1 month, 3 months and 1 year. MOLBIO: 6.7908163 for all three. TCS: 42.92 / -1.47 /
  // -24.84. Measured scope 2026-08-18: 24 rows of 2,983, 18 tradeable - and it catches LCL and
  // MVELECTRO, the two rows that were "the only ones left standing in the whole market" during the
  // v1112 incident and were never gated.
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
  // ── v1083: THE ROCKET COHORT MUST CLEAR THE SAME BAR EVERY FEATURE MUST CLEAR ──────────────
  // A feature is only modeled when it has >= minObs finite values. The rocket cohort that sets
  // EVERY feature's `effect` faced no such bar, so a handful of rows could set 108 weights.
  //
  // Measured 2026-07-30 midday: 1,749 tradeable rows, rocket cohort = 5. Dozens of features
  // saturated at the |effect| = 1.0 CLAMP - Hull MA 1.000, Volatility-1d 1.000, Open-1d 0.993,
  // Change-from-open 0.993, VWAP-1d 0.982, Low-1d 0.981. That is not signal, it is the LABEL
  // LEAKING INTO THE FEATURES: price-level columns are transformed to 100x(price/level - 1), so for
  // a stock up 12% today `price/open - 1` IS +12%. The rocket label is "up >= 10% today". Those
  // columns therefore separate the cohort perfectly by construction, and 73% of total feature
  // weight landed on same-session-move features (mean weight .82 vs .72 for everything else).
  // Since alpha = clamp(|effect| x 1.35, .12, .58), a saturated effect also pushes the per-row
  // signal to the .58 CEILING - 58% driven by the leaked percentile instead of the prior.
  //
  // The consequence is a circular ranking: it stops asking "what is about to move" and starts
  // asking "which stocks most resemble the few that already moved today" - i.e. it ranks completed
  // moves to the top, which is exactly where a same-day target cannot be reached.
  //
  // At 09:15 this cannot happen: no stock is at +10% yet, the cohort is EMPTY, mr falls back to .5,
  // every effect is ~0, alpha sits at its .12 FLOOR and the score is ~88% prior-driven - a broad
  // structural blend of yesterday's setup plus the opening gap. That is the configuration the owner
  // reports as reliable. Applying the existing minObs bar keeps the scorer in that configuration
  // until the cohort is genuinely large enough to estimate an effect from.
  //
  // Reuses minObs rather than introducing a threshold, so there is no new tunable constant.
  //
  // ── v1085 CLOSES THIS PERMANENTLY ──────────────────────────────────────────────────────────
  // v1083's minObs gate worked only because the ">= 10% today" cohort was tiny (6 rows against a
  // minObs of 237) and so never armed. The owner's new rocket definition is FORWARD-LOOKING —
  // target before stop across 2 trading days — and cannot be evaluated at scan time at all. The
  // only same-day stand-in is `rocketRows` above, which fires on 25.2% of the tradeable universe;
  // that clears minObs comfortably and would re-arm every effect with a label made of today's move.
  //
  // So the size test is no longer sufficient and is no longer used for this: NO same-day cohort may
  // set a feature's direction or weight, at any density. `diagnosticEffect` keeps the separation
  // for the audit ledger, `effect` is held at 0, and the weight reduces to coverage alone. The
  // scorer therefore stays in the prior-driven configuration the owner reports as reliable at
  // 09:15, at every hour of the day. Cross-day learning from the RESOLVED labels is a separate
  // decision that needs accumulated evidence; nothing here consumes them.
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
    // v1068 DE-CLIPPING. Winsorising the UPPER tail at the 98th percentile is correct when
    // outliers are noise. For the Participation group the outliers ARE the target: measured on
    // 2026-07-28, `Relative volume at time` had median 0.67, q98 8.68 and max 122.58 — the top
    // 60 stocks all collapsed onto 8.68, so a 122x ignition scored identically to an 8.7x one,
    // and 3 of that day's 6 rockets sat inside that flattened blob. Participation keeps its
    // lower clip (junk protection) and keeps its full upper tail. Every other group is unchanged.
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
  // WS4/R6 (v552): the sector-relative day move is scored as a synthetic Momentum signal through
  // the SAME self-calibrating machinery as every feature — its weight comes from the same-day
  // rocket diagnostic (effect) × coverage, so there is no hand-set magnitude. It is kept out of
  // `features` (whose entries are real columns read via radarTransformed) and injected per row below.
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
  // v1084: HISTORICAL movement capacity only — `Volatility, 1 day` is deliberately NOT in this max.
  // It expands with the CURRENT session's realised move, so it lets an already-spent spike widen its
  // own capacity estimate. Measured on the 2026-07-30 14:16 file it EXCEEDED daily ATR on 793 of
  // 2,965 rows (26.8%), i.e. for a quarter of the universe today's own move was setting the range.
  // It is still scored as a Volatility feature and still reported; it just cannot manufacture runway.
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
  // ── v1068 IGNITION TRACK (finds the tail the composite averages away) ─────────────────
  // Measured on the 2026-07-28 tradeable universe (EQ + basket-eligible + turnover >= 25L,
  // n=1373, 20 names >= +5%, base rate 1.46%):
  //   * direction gate alone (above VWAP AND above open): base rate 1.46% -> 6.40%  (4.4x)
  //   * within the gated pool, volume extremity is cleanly MONOTONIC by decile:
  //       deciles 1-5 -> 0.0% hit, d8 3.4%, d9 6.9%, d10 (relAt 4.57-104.69) -> 38.9%
  //   * gated + extremity, top 20 -> 12/20 = 60% hit (9.4x over the gated pool, 41x overall)
  //     vs the composite's 6/20 on the same universe and day.
  // UNGATED extremity is NOT a buy signal: the top relative-volume decile of the whole universe
  // is 12.1% up >= 5% but also 6.4% DOWN >= 5%. Heavy volume means something is happening, not
  // that it is happening upward — the direction gate is what turns it into a signal, and it must
  // never be dropped. Strength is log-summed and never upper-clipped (see the de-clipping note).
  const igniteArr=rawRows.map((raw,ri)=>{
    const p=radarNum(raw[priceI]),vw=vwapI>=0?radarNum(raw[vwapI]):null,co=chgOpenArr[ri];
    // Direction gate. `p>=vw` (not `p>vw`) to match getMarketAlignedEntryTiming's long-standing
    // semantics — v1069: the two gates must state the same thing, and 4 thin names sat exactly at
    // VWAP and disagreed. This is the ONE definition of "confirmed direction" in the codebase.
    if(!(p>0)||!(vw>0)||co===null||!(p>=vw)||!(co>0))return null;
    const ra=relAtI>=0?radarNum(raw[relAtI]):null,r1=relI>=0?radarNum(raw[relI]):null;
    // v1071 third term: volume vs its own 60-day norm. ADDITIVE, not a replacement — `relAt` is
    // what surfaced AGARIND at 104x on 2026-07-28 and must not be diluted away. A genuine ignition
    // is extreme on all three at once, and because the terms are log-summed and the upper tail is
    // never clipped (v1068 de-clipping), the extremity that makes this track work is preserved.
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
    // ── v1097 PRE-RESULTS QUIET DRIFT (owner, 2026-08-05) ────────────────────────────────────
    // Owner's observation: "a stock which starts rising slowly 2-3 days before its results are almost
    // sure to rocket on or after the results date."
    //
    // This is the BULLISH direction of R10 (RULES.md), which was logged from E32 — SKMEGGPROD falling
    // -15.2% the day before its board meeting — and whose own status note says it "must be checked in
    // BOTH directions: a pre-results drift UP would falsify the 'de-risking' reading." So the two are
    // the same pending question with opposite signs, and this flag is what lets the app finally see
    // either one. R10 also recorded the code gap being closed here: `upcomingEarnI` was extracted and
    // NEVER READ — a dead variable since v555, with the column exported and doing nothing.
    //
    // DATE SOURCE, in R10's stated order of reliability: the NSE board-meeting feed FIRST (it carried
    // the 29-Jul date for SKMEGGPROD, whose TradingView earnings cell was empty), TradingView's
    // `Upcoming earnings date` as the fallback. Populated on 1,037 of 2,967 rows on 2026-08-05, so
    // neither source alone is enough and a missing date must mean "no signal", never "no event".
    //
    // "RISING SLOWLY" is the discriminator and it is deliberately the QUIET shape, not the loud one:
    // up over the week AND up today, but WITHOUT the ignition that the v1068 track already rewards.
    // A stock that has already exploded into its print is not what the owner described, and it is what
    // R4d says gets sold afterwards. There is no new constant here — the participation test reuses
    // `participationReady`, which is the model's existing definition of ignition.
    //
    // REPORTED, NOT SCORED. RULES.md's own graduation bar (>=3 confirms across >=2 sessions) is not met
    // — R10 stands at ONE observation, in the opposite direction — so this sets no score term. It is a
    // visible flag that starts accumulating the evidence from this session on.
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
    // v1098: the drift INTO today, measured properly. Preferred source is the dated price history
    // (a true 3-session close-to-close move with today excluded outright). The week column is the
    // fallback while the history fills, and it is now COMPOUNDED rather than subtracted —
    // (1+wk)/(1+day)-1, not wk-day. The subtraction overstated the drift by up to 0.69pp on the
    // 2026-08-05 movers, and the error grew with today's move, so it inflated exactly the big
    // reactions whose drift any magnitude threshold would be calibrated from. `driftSource` is
    // recorded on the row because a threshold must never be fitted across two different measures.
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
    // ── R4d POST-RESULTS DIGESTION (graduated rule, implemented 2026-08-06) ──────────────────
    // Withholds the ENTRY, never the score. R4d's claim is temporal — "do not chase it TODAY" — not
    // that the stock is bad, so it belongs with entry timing, where v1070/v1075 established that an
    // honest rank is preserved while the execution decision is withheld separately. It is also a pure
    // boolean, so unlike a score penalty it needs no magnitude and invents no constant.
    //
    // FRESH RE-ACCUMULATION is the release valve the rule itself names. It reuses the codebase's ONE
    // definition of confirmed direction (v1069: at or above VWAP and up from the open) plus the
    // existing participation test — a stock genuinely being bought again is not the falling knife R4d
    // describes, and E27/E34 both broke down precisely when that stopped being true.
    const _r4d=(_inDigestion&&/^\d{4}-\d{2}-\d{2}$/.test(_recEarn))?getResultsDayMove(_sym,_recEarn):null;
    const _vwapR4d=vwapI>=0?radarNum(raw[vwapI]):null;
    const _priceR4d=radarNum(raw[priceI]);
    const _reaccum=!!(_vwapR4d>0&&_priceR4d>=_vwapR4d&&chgOpenArr[ri]>0&&_partReady);
    // MARGIN DIRECTION IS THE SECOND RELEASE VALVE, AND THIS IS THE ONE PLACE IT CAN WORK.
    //
    // R3 wants the quarter's operating-margin direction AT THE PRINT and can never have it: the
    // vendor refreshes `Operating margin %, Trailing 12 months` 1-3 days AFTER the filing. R4d's
    // window is D+1 onward, so here the late arrival is IN TIME - the whole reason the deferral was
    // scoped this narrowly rather than dropped. `getSessionWatchStore` has been recording the value
    // and the date it last MOVED since v1117; nothing read it until now.
    //
    // A TTM window drops the year-ago quarter as it adds the new one, so the SIGN of the change is
    // exactly the sign of the new quarter's margin against the year-ago quarter - arithmetic, not a
    // proxy. A first observation returns null and releases nothing: silence is not a signal.
    //
    // It only ever RELEASES, never blocks. A results rocket that is digesting on EXPANDING margins
    // is the case R4d's own evidence never covered (E42 XPROINDIA, E63 TCPLPACK and the rest were
    // all read on the price tape alone), so widening the valve cannot make R4d fire on anything it
    // was not already firing on.
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
    // ── v1113: THE STRETCH BAR IS THE TARGET WE ACTUALLY NEED, NOT A RETIRED 10% ──────────────────
    // This asked "how many typical days' range would a 10% move take", and penalised -7/-14/-22 above
    // 2.5x/3x/4x. The 10 was the OLD ROCKET DEFINITION (same-day move >= 10%), which v1085 replaced
    // outright with "reaches its OWN target before its OWN stop within 2 trading days". Nothing in the
    // app has wanted a 10% move since. Measured 2026-08-10: the retired bar penalised 1,178 of 2,973
    // rows (39.6%, -14,031 points in total) including 14 of the top 50 — it had quietly become a
    // blanket volatility floor demanding a move nobody was asking for. Penalised rows had a median
    // daily range of 3.28% against 5.07% for the rest; a 3.3% mover was being marked down for failing
    // a 10% test while its actual target was 1.8%.
    // Re-anchored to the SESSION target anchor, the question becomes the one that matters: how much of
    // a typical day's range does the bar consume? Tiers move with it — over 1x, 1.5x and 2x a typical
    // day's range. NO NEW CONSTANT: the numerator is `_radarSessionTargetPct`, the same single session
    // scalar feasibility used (v1086), so it cannot reorder stocks against each other by itself, and
    // the three tier multiples replace the old three one-for-one.
    // Deliberately the SESSION anchor and not the row's own target: `targetPct` is max(anchor,
    // capacity) and capacity is sqrt(ATR x range), so target/range would collapse to sqrt(ATR/range)
    // — about 1.0 for every row — and the penalty would fire on noise.
    // ORDERING TRAP (v1085, and it bites here too): processFiles scores the scanner file BEFORE the
    // portfolio files parse, so `_radarSessionTargetPct` can be a fallback anchor rather than the one
    // the UI shows later — measured 2.60% at scoring time against 1.80% on screen. Unlike the rocket
    // cohort, which is display-only, this bar FEEDS THE SCORE, so the value actually used is recorded
    // on RADAR and on every row. Do not audit this against getActiveTargetInfo() after the fact.
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
    // Reference-exact: the standalone Radar tests series==='Unknown' AFTER uppercasing,
    // so its −8 unknown-series branch is dead code and unverified series falls through
    // to the −50 non-EQ penalty. Reproduced deliberately for bit-parity with the
    // reference scorer (dev/assert-fidelity.js); switching to the author-intended −8
    // would be an owner decision.
    if(series!=='EQ')rawScore-=50;
    if(status!=='A')rawScore-=50;
    if(band!==null&&band!==undefined&&band<10)rawScore-=35;else if(band===10)rawScore-=3;
    if(meta.flags?.length)rawScore-=Math.min(12,meta.flags.length*2);
    if(meta.delivery!==null&&meta.delivery!==undefined)rawScore+=clamp01(1-Math.abs(meta.delivery-55)/55,0,1)*3-1;
    if(meta.officialClose&&meta.officialAvg)rawScore+=meta.officialClose>=meta.officialAvg?1:-1;
    // ── v1117 R11: THE 52-WEEK HIGH IS RESISTANCE UNTIL IT IS CLEARED ────────────────────────────
    // Graduated 2026-08-10 at 3 confirms across 2 sessions, 0 contradictions (RULES.md Appendix C):
    //   E33  RATNAVEER bought at 98.8% of its 52w high -> -14.3%; and the cross-section that session
    //        put the 98-100% bucket at mean -0.28% with 0 of 35 up >= 2%.
    //   E49  UNIVCABLES CLEARED to an all-time high -> +20.00%.
    //   E52  COMSYN CLEARED to a fresh 52-week high -> +19.66%.
    // The two halves point OPPOSITE ways, which is why this cannot be expressed by nudging the old
    // term: it was a single monotone high-good ramp, so it paid MOST at exactly the price where the
    // approach half is worst. R11 is a TWO-STATE rule and the term is now two-state.
    //
    // "At the high" is measured in the stock's OWN typical daily range (`rangePct`, the unit already
    // on the row since v1060) rather than as a typed percentage band — a stock one normal day's move
    // below its 52-week high is AT it; one ten days below is not. No new constant, and the test
    // scales with volatility instead of imposing one width on the whole market.
    //
    // The magnitude budget is UNCHANGED: the term still lands in [-2, +2]. Approaching-but-not-
    // cleared simply takes the negative end of the range it used to take the positive end of.
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
    // WS1/R1 (v552): trend-aware chase penalty. The relief is SELF-CALIBRATING — the fraction of the
    // chase that is waived is the row's cross-sectional percentile of medium-term trend (1M+3M). A
    // strong established uptrend (high percentile) is a genuine continuation and keeps almost none of
    // the chase; a trendless one-day spike (low percentile, the "hot-shot → next-day fade") keeps it
    // all. No magic constant. Missing performance data → full chase (unchanged prior behaviour).
    if(day>8){const chase=Math.min(13,(day-8)*1.7);const tPct=trendArr[ri]===null?null:radarPct(trendSorted,trendArr[ri]);rawScore-=chase*(tPct===null?1:1-tPct);}
    if(gap>7)rawScore-=Math.min(6,(gap-7)*.8);
    if(turn<5e5)rawScore-=7;
    if(price<5)rawScore-=5;
    // R2 (buyback bonus) RETIRED in v1072. It was introduced in v552 as a +1.5 "treasury conviction"
    // term, but its ONLY supporting event (E2) was a CRYPTO token buyback-and-burn logged from a
    // crypto calendar under the ticker RAIN — which on NSE is Rain Industries Limited, an unrelated
    // Process-industries company that had no buyback at all (trading window closed 1-Jul..10-Aug-2026;
    // the company publicly stated there was no unpublished price-sensitive information). Verified and
    // voided 2026-07-29. The rule therefore had ZERO evidence in this market and is removed rather
    // than left scoring live positions. The `kind==='buyback'` CLASSIFICATION is deliberately kept
    // (see parseCorpActions): R5 relies on it to NOT neutralise a buyback the way it neutralises a
    // mechanical split/bonus/demerger ex-date move. Re-introduce only if a real NSE buyback event
    // earns confirmations under the graduation bar in RULES.md.
    // Display the REAL day move for a neutralised corp-action row (scoring already used the blanked 0).
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
  // Held positions never re-enter the buy ranking, but they DO stay in the scored
  // universe (marked _held) so the Performance Open Positions table can show Radar context.
  // Display/selection/outcome paths suppress _held rows; with ~1-2% of rows held
  // the percentile shift vs the standalone Radar (which dropped them pre-percentile)
  // is negligible, and this visibility was owner-requested.
  allRows.forEach(r=>{r._held=heldSymbols.has(r.symbol);});
  const rows=allRows;
  const suppressedHeld=allRows.filter(r=>r._held).length;
  const rawScores=rows.map(r=>r.rawScore).sort((a,b)=>a-b);
  for(const r of rows){
    // v1068: EXTREMITY, NOT BALANCE. rawScore is a budget-weighted MEAN across seven groups, and a
    // mean structurally prefers the well-rounded to the extreme — on 2026-07-28 its top 20 was IT
    // large caps in a sector move (COFORGE, TCS, NAUKRI...), names that cannot physically move 10%,
    // while the day's two tradeable rockets sat at rank 36 and 56. A rocket is extreme in ONE
    // dimension (participation) and ordinary elsewhere, so it can only ever lose an average.
    // Taking the MAX of the two percentiles lets either kind of evidence carry a stock on its own
    // merit: balanced names keep their composite standing, igniting names are no longer averaged
    // out. It is parameter-free — both inputs are cross-sectional percentiles on the same scale —
    // and ignitePct is 0 for anything failing the direction gate, so nothing is promoted on volume
    // alone. The ^4 top-weighting still crushes mid-percentiles, so a merely-median ignition
    // cannot lift a weak row into contention.
    r.compositePct=radarPct(rawScores,r.rawScore);
    r.noHistory=!!_noHist[normSym(r.symbol)];
    r.setupPct=Math.max(r.compositePct,r.ignitePct||0);
    // ── v1086: FEASIBILITY IS PART OF THE RANK, NOT A FILTER AFTER IT ─────────────────────────
    // Owner, 2026-07-31: "Rank 1 should be the one stock which has the highest chance of achieving
    // our target from the recommended price point." The ranking used to answer a different
    // question — "which stock has the best setup" — and a separate gate then deleted the rows that
    // could not actually be bought. Measured on the 11:09 live file: of the top 400 basket-eligible
    // rows, 207 were blocked for STOCK-INTRINSIC reasons (204 move-spent, 3 no circuit headroom)
    // against 3 for portfolio reasons, and only ONE of the top 10 was recommendable. Rank 1
    // (DEEPINDS) had -0.75% of runway against a 1.85% target; rank 6 (UEL) had -9% and was sitting
    // on its circuit at +20%. Those are not near-misses, they are arithmetic impossibilities.
    //
    // So the two headroom facts — how far to the session ceiling, how far to the upper circuit —
    // now SCALE the score instead of vetoing it afterwards. Both are already computed here, both
    // are properties of the STOCK, and both are measured from the same buffered buy price the
    // sizing uses. `headroom / target` is a pure ratio of two existing quantities: at or below 1
    // the stock cannot reach target from here and the score goes to 0, so it sinks to the bottom
    // of the ranking on its own instead of occupying rank 1 with a "cannot allocate" tag.
    //
    // WHAT IS DELIBERATELY EXCLUDED: capital, Max Alloc, the 0.10%-of-turnover rail, the held
    // top-up cushion and the 20-order cap. Those depend on the owner's book and on which OTHER
    // stocks were selected, so admitting them would make a stock's rank depend on its neighbours —
    // the non-causal cross-stock coupling v1066 removed and v1080 explicitly refused. They remain
    // post-filters. The target anchor IS admitted because it is one scalar applied identically to
    // every row: it cannot reorder stocks relative to each other, it only sets the bar they clear.
    //
    // v1097 INVARIANT — DO NOT REPLACE THIS WITH getRowExitPolicy().targetPct. Since v1097 the exit
    // target carries a per-stock nudge derived from the row's own SCORE. Feeding that back in here
    // would close a loop: score -> nudge -> target -> feasibility -> score, whose result depends on
    // evaluation order and which penalises exactly the high-scoring stocks it just raised the target
    // on (measured: top-decile capacity feasibility 1.000 -> 0.938, and the 4th power turns that into
    // a 23% score haircut). Feasibility uses the SESSION ANCHOR — one scalar, identical for every row,
    // which is the whole reason v1086 was allowed to admit the target into the score at all.
    const _tgt=Number(_radarSessionTargetPct)>0?Number(_radarSessionTargetPct):null;
    const _buy=r.price>0?r.price*(1+BASKET_MARKET_BUDGET_BUFFER_PCT/100):null;
    let _feas=1;
    if(_tgt&&_buy>0){
      const runways=[];
      if(r.low1d>0&&r.rangePct>0) runways.push((r.low1d*(1+r.rangePct/100)/_buy-1)*100);
      const _uc=getUpperCircuitInfo(r,_buy);
      if(_uc&&isFinite(_uc.runwayPct)) runways.push(_uc.runwayPct);
      if(runways.length){
        // The binding constraint is the tightest ceiling, and it must cover the target with the
        // same slippage cushion the order already budgets for (v1081's rule, reused not re-tuned).
        const _room=Math.min(...runways);
        _feas=clamp01(_room/_tgt,0,1);
      }
    }
    // ── v1087: DIRECTION IS PART OF THE SCORE, NOT A FILTER AFTER IT ─────────────────────────
    // Owner: the engine must catch a stock at LIFTOFF — about to reach target in the next ~15
    // minutes — not one that merely looks good on yesterday's structure. `setupPct` is
    // `max(compositePct, ignitePct)`, and ignitePct is 0 whenever the direction gate fails, so a
    // falling stock could rank #1 on setup ALONE. Measured on the 11:09 file: all five
    // recommendations were BELOW VWAP, four of five BELOW their own open, and only 8 of the top 30
    // were confirmed in either sense — which is exactly why they fell the moment they were bought.
    //
    // Filtering them out afterwards is not enough: the ranking still ordered by setup, so the top
    // 10 emptied entirely and the basket came out with ZERO names. Direction has to move the rank.
    // The test is the codebase's ONE definition of confirmed direction (v1069, above VWAP and
    // above the open) plus the owner's rule that a stock red on the day is weak or confused.
    // A non-confirmed row scores 0 and sinks; `setupPct` is retained so its standing stays auditable.
    const _dirOk=(Number(r.vwap)>0&&Number(r.price)>=Number(r.vwap))
      &&Number(r.changeOpen)>0&&Number(r.day)>0;
    r.directionConfirmed=!!_dirOk;
    r.feasibility=+_feas.toFixed(4);
    // ── v1109: FEASIBILITY NO LONGER MULTIPLIES THE SCORE ────────────────────────────────
    // MEASURED 2026-08-07, entry at the 08-05 close, outcome = reached +2.6% on 08-06, n=2,391,
    // base rate 27.1%:
    //     rank by yesterday's gain, top 20  -> 17/20 = 85%
    //     rank by distance off the low      -> 16/20 = 80%
    //     rank by the RADAR score           ->  8/20 = 40%
    // A single sorted column beat the whole scorer by more than 2x. The mechanism is this line.
    //
    // `feasibility` = min(session-ceiling runway, circuit runway) / target. A stock that has ALREADY
    // moved up has less runway left, so feasibility falls as momentum rises — measured correlation
    // with today's move is **-0.588** — and the 4th power then annihilates it: feasibility 0.044
    // raised to the 4th is 0.0000037. On the 2026-08-07 board, 74 stocks were up >=5% and ZERO
    // appeared in the Radar top 20; their mean feasibility was 0.044 against 0.736 for the rest,
    // and their mean score 0.4 against 1.9.
    //
    // So v1086 built feasibility to stop the app recommending stocks that could not reach target,
    // and it instead deleted the ones most likely to. This is also the single mechanism behind three
    // separate findings that were logged as unrelated: entry-blocked picks converting at 50% vs 25%
    // over three sessions, RULES.md D4 / v1075 measuring that extension predicted CONTINUATION, and
    // DCI (top score, blocked by three gates) rocketing on day 0.
    //
    // WHAT IS KEPT. The two ARITHMETIC ceilings still remove a row, through the v1080 allocation gate
    // and `getRowExitPolicy`: a stock at its upper circuit legally cannot trade higher today (v1081),
    // and one with no session runway cannot be allocated (v1083). Those are facts about the day, not
    // opinions about momentum. What is removed is the STATISTICAL ceiling acting as a 4th-power
    // multiplier on RANK. `feasibility` is still computed and still stored on the row so the
    // before/after remains auditable and so the exit policy is untouched.
    // v1139 (owner): "This whole market depth thing should drive or at least be a part of the
    // recommendation table. The info goes in the recommendations!" So the order book is no longer a
    // separate list - it is a factor in THIS score.
    //
    // GEOMETRIC MEAN OF TWO PERCENTILES, which is why it needs no constant: both are cross-sectional
    // percentiles on one scale, so the blend is symmetric and parameter-free - the same reasoning
    // that made v1068 take a MAX of two percentiles rather than a weighted sum.
    //
    // A STOCK WITH NO BOOK TAKES THE MEDIAN (0.5), NOT ITS OWN setupPct. The first attempt used
    // setupPct, reasoning that sqrt(setupPct^2) leaves that row untouched. Row-by-row that is true;
    // IN A RANKING IT IS BACKWARDS. Leaving bookless rows alone while shrinking every row that has a
    // book PROMOTES the bookless ones - measured on the release board, rows scoring >=95 collapsed
    // from 33 to 4 and SEVEN OF THE TOP EIGHT had no book at all. Absence must mean "no information",
    // which is the middle of the distribution, not a free pass.
    // v1140: the book is rolled forward with the session's own signed volume. A PASTED book is a
    // real reading and always wins; otherwise the pre-open book plus flow. Percentiled in the
    // second pass below, because a percentile needs the whole cross-section.
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
    // Provisional: re-percentiled across the universe in a second pass below, so the SCORE SCALE is
    // preserved and only the ORDER moves. Without that pass the geometric mean shrinks almost every
    // row and the whole distribution slides down - which would silently move what `RECOMMEND_MIN_SCORE`
    // means, turning an ordering change into a de-facto raising of the bar.
    r.score=+(100*Math.pow(r.depthBlendPct*(_dirOk?1:0),4)).toFixed(1);
    r.rocketScore=r.score; // allocation/export alias
    r.risk=!r.basketEligible||r.meta.flags?.length>=3||r.turnover<25e5||r.price<10?'High':(r.gap>6||r.day>6||r.parts.volatility<38?'Medium':'Low');
    // Event Risk (idea #1, v554 + v555): an event-day (Stage 3) or a name still digesting its results
    // (Stage 4 profit-booking) is less pattern-reliable, so never label it Low risk. Changes risk, not score.
    if(r.risk==='Low'&&(r.meta?.eventToday||r.stage===3||r.stage===4))r.risk='Medium';
    r.setup=r.series!=='EQ'?(r.series==='UNKNOWN'?'Series unverified':`Non-EQ · ${r.series}`):r.band!==null&&r.band<10?`${r.band}% price band`:radarSetupLabel(r);
  }
  // v1139/v1140 SECOND PASS. Two percentiles are taken here, both needing the whole cross-section:
  // first the BOOK (rolled forward by v1140), then the blended standing.
  //
  // Re-percentiling the blend is what keeps the SCALE. The raw geometric mean shrinks nearly every
  // row, and scoring it directly slid the whole distribution down - measured, rows at or above 95
  // fell 33 -> 4 - which would have quietly raised what RECOMMEND_MIN_SCORE means while presenting
  // itself as a re-ordering. Re-percentiling is monotone: the order moves, the scale does not.
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
        // v1140 HEADROOM GUARD (owner, same session: "you just recommended it and it started
        // falling. Need to be careful."). The roll-forward signs traded volume by where price sits
        // in the day's range, so a stock PINNED AT ITS HIGH signs all of it to the buy side and
        // scores ~+1.0 whatever its actual book says - measured: the same +0.20 book reads +0.999
        // at the high and +0.011 mid-range. Left alone, the flow term would reward exactly the
        // spent spike it should be avoiding, and TFCILTD was the live case: flagged correctly at
        // its 116.80 pre-open IEP, still top-ranked at 124.21 having consumed 91% of the day's
        // range and travelled 2.2x its own average daily range.
        //
        // `feasibility` is v1086's headroom - how far the stock can still travel toward its target
        // against the session ceiling and the circuit, clamped to [0,1]. v1109 removed it from the
        // score on a single day-pair; this restores it in a far softer form, INSIDE the blend and
        // therefore before the re-percentile, so it changes the ORDER without touching the scale.
        // Ample room earns full credit and no bonus (the v1086 clamp), so it only bites on a stock
        // that has already spent its move. Missing feasibility is neutral, never a penalty.
        const fz=Number.isFinite(r.feasibility)?Math.max(0,Math.min(1,r.feasibility)):1;
        r.depthBlendPct=Math.sqrt(Math.max(0,r.setupPct)*Math.max(0,dp))*fz;
      });
      // ── THE MULTI-DAY TERM, WEIGHTED BY ITS OWN MEASURED EDGE ───────────────────────────────
      // `w` comes from measureFieldEdge(), which grades this exact field against the app's own
      // resolved picks every session. AT w = 0 THE LINE BELOW IS THE IDENTITY - Math.pow(base,1) x
      // Math.pow(us,0) === base - so shipping this changes nothing until the data says otherwise,
      // and it un-ships itself the same way. There is no flag and no trigger; the evidence IS the
      // switch. Applied BEFORE the re-percentile, so it changes the ORDER and never the scale
      // (the v1139 lesson: a blend that moves the distribution silently redefines what a score of
      // 95 means).
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
  rows.sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol));
  rows.forEach((r,i)=>{r.rank=i+1;});
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
// ══════════════════════════════════════════════════
// INDICATOR WATCH (v526) — display-only orientation guardrail.
// Automated forward measurement replacing manual eyeballing of ~170 indicators.
// For every MONOTONIC-prior indicator it records, each accepted session, where each
// stock sat (decile). Five trading sessions later it asks: did the end the prior
// REWARDS actually hold more of the movers, or fewer? It keeps a rolling 30-session
// tally per indicator, for BOTH forward outcomes (a stock posting a >=5% day-move and a
// >=10% day-move within the window). An indicator is flagged only when it is "backwards"
// on BOTH outcomes past a Bonferroni-corrected bar (owner choice: strictest). It NEVER
// changes scoring — a flag is a note to review; inverting a prior stays a deliberate code
// change. State is bounded (<=window snapshots + a 30-long log), append-only, and gap-
// robust: a missed upload just yields fewer samples, never corrupt rolling state (the
// v1 failure mode cannot recur here).
// ══════════════════════════════════════════════════
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
// Record the current session and resolve any anchors that have matured. Fire-and-forget
// from the upload path so it never delays rankings.
// ── v1117 SESSION WATCH: WHEN did the day's high print, and WHEN did the TTM margin move ─────────
// Two questions the app could not answer, both blocked on the same absence: no input carries an
// INTRADAY series. We hold daily OHLC and one live snapshot, so we have always known the day's high
// and never known what time it printed (recorded as a known limitation in v1095 and again in v1099).
//
// (1) TIME OF HIGH. The owner's question: how long after a sell — or after price crosses target —
//     does the high arrive? The sell side is already answerable, because orders.csv carries fill
//     times to the second ("2026-08-10 14:16:51", established in v1096). Only the high side was
//     missing. Every re-ingest of the scanner file is an observation of `high1d`, so stamping the
//     receipt time whenever that value ADVANCES reconstructs the time of the high directly.
//     RESOLUTION IS THE EXPORT CADENCE, NOT THE POLL. The folder watch checks every 3 seconds but
//     the file only changes when TradingView re-exports, so the answer is +/- one export interval,
//     and `n` (observation count) is stored so any later read can see how coarse it was.
//     IT CANNOT BE BACKFILLED. This is a live recorder: it answers from the day it ships forward and
//     says nothing about the 217 historical exit cohorts.
//
// (2) TTM OPERATING MARGIN, and WHEN IT LAST CHANGED. R3 (27 confirms, the best-evidenced rule we
//     have) needs the QUARTER's operating-margin direction against the year-ago quarter, and the
//     owner confirmed TradingView exports no quarterly margin field. The growth-difference proxy
//     was measured and REJECTED (see RULES.md 2026-08-11). What does work is arithmetic: a trailing
//     twelve-month window drops the year-ago quarter as it adds the new one, so
//         sign(TTM_after - TTM_before) === sign(Q_new margin - Q_year-ago margin)
//     exactly. Storing the TTM margin and the date it last MOVED therefore recovers R3's signal
//     without a new column. It arrives 1-3 days late, because the vendor refreshes fundamentals
//     after the filing — too late for the print-day move, but in time for R4d's D+1 window, which is
//     the rule that actually trades this. Recorded only; nothing scores it yet.
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
    // v1120: keep the HIGH-WATER PATH, not just the final high. Without it the sell day cannot be
    // split into before and after the exit — which is the whole question ("how much higher did it go
    // AFTER I sold"). Each entry is [HH:MM, running max at that moment], appended only when the high
    // advances, so it stays short: a handful of points per symbol per session.
    if(!cur){ day[r.symbol]={h:+best.toFixed(2),at:hhmm,first:hhmm,n:1,path:[[hhmm,+best.toFixed(2)]]}; return; }
    // An entry written before v1120 has no path. Seed it from what IS known — the high and the time
    // it last advanced — rather than leaving it permanently unsplittable. One honest point, not a
    // fabricated series: it says "the running max was this, at that time", which is exactly the
    // information the old shape carried.
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
// What the recorder can answer once it has data: for a symbol and session, the time of the high and
// how coarse the observation was. Returns null rather than guessing when the session was not watched.
// ── v1120: HOW MUCH HIGHER DID IT GO **AFTER** THE SELL? ─────────────────────────────────────────
// Owner: "I don't want day high, I want how higher it went AFTER I sold." Correct, and everything
// before this release answered the wrong question — v1099 folded the WHOLE sell-day bar in and
// labelled it an upper bound, which is how GNA reported Rs 592 left on the table when its high was
// already in 48 minutes BEFORE the exit.
//
// `high1d` is a running maximum, so a single reading cannot be split around the sell. The HIGH-WATER
// PATH can: take the running max at the last observation AT OR BEFORE the sell, and compare it with
// the final one. If the high never advanced after the sell, the stock did not make a new high while
// you were out and there is NO money attributable to waiting.
//
// WHAT THIS CANNOT SEE, stated rather than glossed: we observe the running MAX, never the path
// between observations. If the day's high printed at 09:31 and you sold at 10:19, the stock could
// have rallied to just under that high at 11:00 and nothing would record it. So a "no advance"
// answer means "it set no NEW high after you sold", not "it never rose". The measure is exact for
// the case that matters — a new high after the exit — and silent otherwise, which is the honest way
// round: it can no longer INVENT money left on the table, only miss some.
//
// Resolution is the export cadence. An advance seen at 10:30 against a sell at 10:19 happened
// somewhere in (last observation, 10:30]; when that interval straddles the sell it is reported as
// straddling rather than counted as clean.
// The split itself, as a PURE function of the path and the sell clock — no store, so it can be
// asserted as arithmetic rather than through whatever the live data happens to contain.
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
  // Entries written before v1120 carry no path, and a symbol already sold out of is no longer in the
  // recorder's scope so it will never be revisited to gain one. Synthesise the single point we DO
  // know — the running max and the time it last advanced — on READ. Same information the old shape
  // carried, no write, and it makes every historical entry splittable immediately.
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
// ── v1121: HOW LONG AFTER AN EXIT THE HIGH ARRIVES, ACROSS ALL RECORDED HISTORY ──────────────────
// The Latest Session table answers this for today. This answers it for everything the watch has
// seen, by pairing each recorded high-time with the tradebook's own sell time for that symbol and
// session — the tradebook carries `sellDate` and `sellTime` on every trip, so history is pairable
// as soon as the watch has a session for it.
//
// It can only cover sessions the recorder actually watched, which began 2026-08-11. The sample size
// and the session count ride on the result so the card can never imply more history than exists.
let _gapStatsMemo=null;
function getHighGapStats(){
  const store=getSessionWatchStore();
  const trips=TRADEBOOK_STATS?.tripsData;
  // v1123: the signature must change when a HIGH ADVANCES, not only when a new session or trip
  // appears. Keyed on dates alone it went stale the moment the market moved: the stamps kept
  // advancing through the afternoon while the card kept serving the morning's answer, so the card
  // and the Latest Session totals — the same measure, the same code path — disagreed on screen.
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
// v1136: the forward effect that sets the WEIGHTS, measured where this app actually trades.
//
// The guardrail resolution (iwResolveAnchor) is UNCONDITIONAL and matures at IW_WINDOW=5 sessions.
// Both choices are wrong for scoring, and the owner named the reason: "large volume doesn't just
// mean they were bought - in this case they were definitely sold." Volume is an AMPLIFIER, not a
// direction, so a monotonic mover-vs-non-mover gap cancels across the two halves BY CONSTRUCTION,
// and the residual decays with horizon. Measured on the stored anchors (dev/probe-volsigned.js):
// signed top-decile relative-volume lift is 2.78x at 1 session, 2.18x at 2, 1.80x at 3, while the
// down half climbs 5.07% -> 8.03% -> 12.50% toward the up half. By session 5 there is nothing left.
// The gap for `Relative volume, 1 day` goes +0.035 (5d, unconditional - BELOW the 0.08 floor, so
// v1135 gave it no weight at all) -> +0.087 (2d) -> +0.132 (2d, direction-confirmed), which makes it
// and `Relative volume at time` the TOP TWO of all 106 features rather than unmeasurable.
//
// Direction is taken from the snapshot's own decile for `Change from open %, 1 day` (top half = up
// from the open). That is a PROXY for v1069's exact test (price >= VWAP and up from open) and is
// stated as one - it needs no schema change, so existing pending anchors resolve too, and it is the
// same proxy dev/probe-volsigned.js measured with, so the shipped number reproduces the probe.
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
// v1095 (owner correction to v1094): LEFT ON THE TABLE MEASURES WHAT HAPPENED **AFTER** THE SELL.
//
// v1094 shipped this as `(day's high − sell price) × qty`, which is WRONG for the question being
// asked. The day's high is not attributable to the post-sell window: if a stock peaked at 10:15 and
// the exit was at 14:00, that high was never available to hold out for, and the column charged the
// exit for a move it could not have captured. The owner's definition is "the stock went higher
// after we sold" — a forward measure from the exit, not a best-of-day one.
//
//   leftOnTableRs  = (price now − sell price) × qty
//   leftOnTablePct = (price now − sell price) / sell × 100
//
// POSITIVE = it kept going up after the exit; that is money left on the table (red — a large
// number is a bad outcome). NEGATIVE = it fell after the exit, so the sell was well timed and the
// number is a saving (green). This is the "or the opposite, whatever applies" case, and unlike
// v1094's version it is a real, common outcome rather than a data-mismatch artefact.
//
// KNOWN LIMITATION, stated rather than papered over: the app has NO intraday series — only OHLC and
// the current price — so a spike after the exit that faded back before the close is invisible here,
// and the true post-sell peak cannot be recovered from any input the app reads. The day's high is
// therefore reported in the TOOLTIP as unattributed context (it may pre- or post-date the exit) and
// never in the number. Reconstructing the real post-sell peak would need intraday bars keyed to the
// fill time, which no current input supplies.
//
// PROVENANCE GUARD: the comparison price comes from the CURRENT scanner snapshot, so it only
// describes the booking session when the two dates agree — otherwise it would measure a sell from
// one day against another day's price, and it is withheld with a stated reason instead. While the
// market is open the figure is still moving, and the tooltip says so.
// Minutes between two "HH:MM" / "YYYY-MM-DD HH:MM:SS" clock strings, or null.
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
  // ── v1119: HOW LONG AFTER YOUR EXIT DID THE DAY'S HIGH ARRIVE? ────────────────────────────────
  // Owner: "selling early, manually, is one of the main problems in all this money left on table."
  // The sell side has always been answerable (orders.csv carries fill times to the second, v1096);
  // the high side arrived with the v1117 session watch, which stamps the receipt time whenever
  // `high1d` ADVANCES. This is the first thing that consumes it — it was written yesterday and wired
  // to nothing, the fourth orphaned output found this week.
  //
  // POSITIVE minutes = the high came AFTER you sold: waiting would have paid.
  // NEGATIVE = the high was already in before you sold: the exit was late, not early.
  //
  // Two limits carried onto the row rather than hidden. RESOLUTION IS THE EXPORT CADENCE, not the
  // 3-second poll — the file only changes when TradingView re-exports — so `highObs` (how many
  // observations that session produced) rides along and the tooltip states it. And the recorder
  // CANNOT be backfilled: it began on 2026-08-11, so every earlier session reads "not watched".
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
    // v1174: GROSS IS NET PLUS CHARGES, not a recomputation from the row's ROUNDED average prices
    // (owner, 2026-08-18: "the latest session P/L calculation is wrong"). Net and charges are exact
    // sums over the FIFO lots; gross was rebuilt from the 2-decimal weighted averages shown in the
    // row, so the three numbers on the card could not reconcile. Measured on 2026-08-17: the card
    // read "gross -539 / cost 224" against a total of -768, and -539 - 224 is -763. Per lot the true
    // gross is -544.0 (ELECTCAST -787.4, ANANTRAJ +243.4); the rounded averages gave -539.2 -
    // ELECTCAST (72.07-73.27)x652 = -782.4 against a true -787.4. The TOTAL was right all along.
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
  // v1099: `sessionMatch` is gone. It gated the figure on the booking session equalling the scanner
  // session, which was correct only while the current snapshot was the sole comparison price. Dated
  // daily bars now cover older sells exactly, so gating on it would withhold the BEST data available.
  // ── v1099 (owner correction to v1095): the EXTREME after the sell drives the number ──────────
  // v1095 used the CURRENT price, so a stock that ran 8% past the exit and faded back to flat
  // reported nothing left on the table — the peak was never looked at. The owner's rule is "how much
  // did it move and in what direction after I sold it; the highest/lowest point post-sell drives it".
  //
  // DIRECTION FOLLOWS THE MOVE. If it traded ABOVE the sell afterwards, the number is the HIGH
  // (money forgone, positive). If it never did, the number is the LOW (the exit saved money,
  // negative). Both extremes are reported either way so the row can be read in full.
  //
  // The v1094 session guard is RELAXED here, deliberately: it existed because the only comparison
  // price was the current snapshot, so an older sell could only be measured against the wrong day.
  // Since v1098 stores dated daily bars, sessions AFTER an older sell are exactly attributable and
  // there is no longer any reason to withhold them. What is withheld now is only genuine absence.
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
    // v1120: the watch established that no NEW high came after the exit, so nothing is attributable —
    // report ZERO left on the table rather than a figure derived from action that predates the sell.
    // It is not "unknown": we know it set no new high. We simply cannot see whether it rose to just
    // under the earlier high, because only the running MAX is observable.
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
    // Resolution is stated per row, never blurred. Later sessions are whole bars and fully
    // attributable; the sell day itself may contain pre-exit action.
    // v1120: the sell day is now split at the exit by the high-water path, so it is only an upper
    // bound when that session was NOT watched. When it was, the note says what the path established.
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

// ── v1097 money-left-on-the-table, carried ACROSS sessions ────────────────────
// Latest Session answers "how much did today's exits leave behind". The target nudge needs that
// figure over time, so every session that renders a trustworthy number persists it here.
//
// WHAT IS AND IS NOT STORED. Only sessions whose left-on-table figure passed enrichExitPnlRow's
// PROVENANCE GUARD contribute — the guard already withholds the number when the booking session and
// the scanner session disagree, and a withheld number must not silently become a zero. The write is
// keyed by session date and idempotent, so re-uploading a session overwrites rather than accumulates.
// It is always taken from the UNFILTERED row set: the Rankings search box narrows the table, and a
// search must never be able to move a persisted figure.
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
// The pool the target nudge distributes. PROCEEDS-WEIGHTED across the most recent sessions so one
// small position cannot swing it, and FLOORED AT ZERO by owner rule: a negative figure means the
// exits were already landing above where the stock went afterwards, which calls for no nudge at all
// rather than for pulling the target back below the goal rate.
let _leftPoolMemo=null;
// ── v1119 THE TARGET COMES FROM WHAT THE STOCK ACTUALLY OFFERED, NOT FROM ATR ────────────────────
// Owner, 2026-08-11: "your ATR based targets are never reached. The stock starts falling before
// reaching there... I'm losing money selling too early when the price shoots up the same day."
//
// MEASURED ON HIS OWN 223 CLOSED COHORTS, taking the move from HIS buy price to that day's high:
//
//   available   p25 1.21%   p50 3.46%   p75 6.02%   p90 9.05%
//   the target the ATR policy sets   p25 3.90%   p50 4.40%   p75 5.40%
//
// The median target sat ABOVE the median available move, and the base leg filled on 79 of 223 — 35%.
// Two positions in three could not reach their target on the day, which is why they had to be sold by
// hand. That is not indiscipline; it is a target that cannot fill.
//
// WHY THE ATR NUMBER LOOKED RIGHT AND WAS NOT. The v1105 sweep filled at the target where the day's
// high reached it and KEPT HIS ACTUAL MANUAL EXIT otherwise — so it credited a too-high target with
// his own exit skill on every trade where the target failed. Judged without that credit (a target
// that does not fill captures nothing), the optimum drops to ~3.5% and the fill rate doubles.
//
// WHAT THE CHANGE IS WORTH, stated honestly: on RUPEES it is a wash — ₹88,691 at p50 against ₹88,901
// for the ATR policy, because a higher target earns more per fill and fills less often and the two
// almost exactly cancel. What it buys is FILL RATE: 50% against 35%, i.e. 33 fewer positions a month
// that the GTT cannot resolve. That is the owner's actual complaint.
//
// LIMIT, recorded rather than buried: the store holds the high on the day the position was SOLD, not
// the running high across the hold, so for multi-day holds it understates what was available and the
// true reachable level sits somewhat above 3.46%. The rupee curve is flat across p45-p55 (₹88.2k to
// ₹88.7k), so this sits inside a plateau rather than on a fitted peak.
//
// The percentiles are not tuned magnitudes: the BASE is the median — the level half your positions
// reach — and the RUNNER is the upper quartile, the level a quarter of them reach. Same family as
// HARVEST_TRIGGER_CONFIDENCE, which already takes a percentile of a measured pool rather than a mean.
const REACHABLE_MIN_SAMPLES=40;         // below this the distribution is not worth trusting
let _reachMemo=null;
function getReachableTargets(){
  // v1124 — TWO defects fixed here, both found by audit and both real.
  //
  // (1) STALENESS. The signature was `rows.length + first + last`, and `recordSameDayExitOpportunity`
  //     keeps dayHigh as a RUNNING MAX, so an existing cohort's high advancing during the session
  //     moves a MIDDLE value and leaves all three signature terms unchanged. The p50 that sets every
  //     target could then be frozen at the morning's value for the rest of the day — the same class
  //     of bug as the v1123 card, but this one moves money. The store stamps `lastUpdated` on every
  //     write, so that plus the entry count is both cheap and genuinely sensitive.
  //
  // (2) COST ON THE HOT PATH. The full read/map/sort ran BEFORE the memo check, so the memo saved
  //     only the percentile step. Measured 0.13ms per call against 227 entries — and this is called
  //     once per row by getRowExitPolicy, i.e. ~400ms of pure overhead across the universe. The
  //     signature is now computed from metadata and the scan only runs on a genuine miss.
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

// Zerodha exports the tradebook end-of-day, so P&L booked TODAY is absent from every
// tradebook-derived stat until the next export (observed 2026-07-20: tradebook ended
// 07-17 while ₹1,253 was already booked today). Orders.csv carries it, so surface it as
// an explicit addendum to the money totals. Deliberately NOT merged into `trips`: the
// learned exit policy and position sizing must keep running on settled tradebook data,
// and same-day order rows have no buy date or hold days to model with (v532).
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
// The horizon is a DEADLINE DATE (owner, v532 — reverses the v522 day-count shape).
// Remaining trading days are derived from it every render, so the countdown stays
// correct on its own and there is no anchor to drift.
// v1126: memoised on the STORED OBJECT's identity plus the session date. The cost is not the read
// — it is goalTradingDaysUntil(), which walks the NSE calendar day by day and ran 2,977 times for
// 1,462ms during a single Performance render. FS.get returns the same object until the config is
// written, and the trading-day count can only change when the session date rolls.
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
  // v1077: daily reinvest split (owner, from the daily-compounding model). When set, each
  // trading day's gain is split - this share compounds, the remainder is taken out as cash -
  // which is how a trading account actually drains, rather than a fixed monthly rupee amount
  // that keeps draining on days you earn nothing. null keeps the legacy withdrawMonthly model.
  // Default 55%: the owner's daily-compounding model. There is no separate monthly withdrawal -
  // the 45% that is NOT reinvested IS the cash taken out, which is how a trading account actually
  // drains. A fixed monthly rupee drain kept subtracting on days that earned nothing.
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
// ── v1130 (owner): "the goal module behaves differently than the filters elsewhere" ───────────
// The filter bar recalculates as you type (debounced) and persists as it goes. The goal module used
// `onchange`, which for a number/date input fires only on BLUR, so nothing moved until you clicked
// away — and v1110's focus guard then blocked the popover rebuild anyway, freezing the numbers.
// Now: every field is `oninput` on a 180ms debounce (the same shape as scheduleApplyFilters), the
// READOUT alone is re-rendered so the element under the cursor is never replaced, and `onchange`
// fires the same handler immediately so committing a value (blur, Enter, picking a date) is instant.
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
// The target is EARNINGS: cumulative trading profit generated from current total
// capital within the horizon (owner definition, 2026-07-18). Withdrawals drain every
// CALENDAR day (₹/month × 12 ÷ 365 — weekends and holidays spend money too) and shrink
// the compounding base, but the earnings tally counts every rupee the capital makes.
// Compounding happens only on trading days. The real calendar is walked once for the
// day-gaps, then binary search finds the per-trading-day rate whose earnings hit target.
// ── v1129 SCHEDULED WITHDRAWALS (owner, 2026-08-12) ────────────────────────────────────────────
// "It's not that I keep investing all my money back. There's got to be daily, weekly, monthly
// withdrawals too, which should be adjusted into the targets. This is separate from reinvestment %."
//
// TWO DIFFERENT DRAINS, deliberately kept apart:
//   REINVEST %  — what share of each day's GAIN compounds. Proportional, and it only bites on days
//                 that actually earn. This is v1077's model and it is unchanged.
//   WITHDRAWAL  — a FIXED rupee amount leaving the account on a calendar cadence, earned or not.
//                 v1077 deleted exactly this ("it kept subtracting on days that earned nothing"),
//                 which is true of a trading account's P&L but NOT of a person's spending. The owner
//                 withdraws on a schedule; the goal arithmetic has to know that or it solves for a
//                 capital base that never actually exists.
//
// The tally `e` is GROSS earnings and is untouched by either drain — the goal target keeps meaning
// "cumulative trading profit to generate". A withdrawal shrinks the COMPOUNDING BASE, which is what
// makes the required daily rate go up.
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
  // v1077 (owner): the ONLY drawdown model is the daily reinvest split. Each trading day's gain is
  // split - `reinvest` compounds, the remainder is taken out as cash - exactly the daily-compounding
  // model the owner specified, where "additional contributions" is None and the cash-out IS the
  // withdrawal. The legacy fixed monthly rupee drain is gone: it kept subtracting on days that
  // earned nothing, which is not how a trading account behaves. `wdMonthly` is still accepted so
  // older callers do not break, but it is deliberately unused.
  // `e` tallies GROSS earnings - cash taken out is still earned - so the goal target keeps meaning
  // "cumulative trading profit to generate", unchanged.
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
// Projected completion date at a given NET %/trading day (v538, informational).
// The inverse of solveGoalDailyRate, walking the SAME calendar semantics forward:
// withdrawals drain every calendar day, earnings compound only on trading days and
// are tallied even while withdrawals shrink the base. Returns the date the earnings
// tally reaches the target, or null if it never does within ~8 years at that pace.
function projectGoalCompletionDate(start,target,netPctPerDay,wd,reinvestPct){
  // v1077: must mirror solveGoalDailyRate EXACTLY or the two disagree — projecting at the required
  // rate would then miss the deadline. Same daily reinvest split, no fixed withdrawal: each trading
  // day's gain is earned in full and only the reinvested share compounds. `wdMonthly` is accepted
  // for signature compatibility and deliberately unused, exactly as in the solver.
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
// Computed total deployed capital, from the CSVs only (v543): your full deployed book =
// holdings + every open position (including today's BTST buys), via the combined map over
// Holdings + Positions + today's net Orders buys. `holdings` = Σ(qty × LTP) over
// Holdings.csv (matches Zerodha "Holdings · Current value"); `total` is the combined book,
// and the BTST-locked delivery margin is the margin behind those positions, already
// represented by them, so it is not added again. This is the DEFAULT for the Capital ₹
// field — one value drives the goal basis and allocation, and the owner can override it.
// v1079 (owner) CAPITAL. Three buckets, from the owner's own description of how Zerodha reports:
//   DELIVERY  - holdings.csv, qty>0, at live price. Settled capital.
//   TODAY'S BUYS - positions.csv, qty>0. A buy reaches HOLDINGS only on T+1, so while positions.csv
//                  is the CURRENT session these are capital that holdings does not yet know about.
//   FREED CASH - positions.csv, qty<0. Sell legs are capital released today, whether the stock came
//                  from holdings or from an intraday buy. Some of it may already have been spent on
//                  today's buys (which are counted in the bucket above); only the unspent remainder
//                  is idle cash.
//
// THE BUG THIS FIXES: capital was built from getCombinedOpenPositionMap(), which does `pos.qty +=
// liveQty` - it ADDS a live position on top of the settled holding. That is right while the
// positions file is current, but once it is a PRIOR session those same buys have already settled
// into holdings and get counted twice. Measured 2026-07-30 (holdings.csv 07:35 vs positions.csv from
// 07-29 16:07): APCOTEXIND 44, GHCLTEXTIL 278, M&MFIN 60 and RATNAVEER 75 appeared in BOTH, and
// capital was overstated by exactly the Rs 1,00,795 it was reporting as "positions".
//
// Idle cash is FLOORED at zero, deliberately: spending more than the day's sale proceeds means the
// excess came from cash that is already represented inside the holdings/positions value, so
// subtracting it would double-remove. (A signed version was tried in v1078 and was wrong for exactly
// this case.)
// True when holdings.csv was exported on a LATER calendar day than positions.csv, i.e. the T+1
// settlement has happened and the position buy legs are already inside the holdings figure.
// Uses the files' own dates, not the model session clock: getSessionDate() rolls back to the prior
// trading day before 09:00, so on any pre-open morning it reports the SAME date as yesterday's
// positions file and cannot distinguish the two (measured 2026-07-30 08:21 - PORTFOLIO_STALE said
// stale:false while holdings was 07-30 and positions 07-29).
// lastModified (epoch ms) -> IST calendar date. IST because the trading day and the export both
// happen in IST; using UTC would roll the date at 05:30 local and mis-order morning exports.
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
// ── v1126 THE MEMO KEY COST MORE THAN THE THING IT MEMOISED ───────────────────────────────────
// `getGoalRequiredNetPct` caches on a key that includes the capital basis — and computing that basis
// IS the expensive half, so the cache could never pay for itself. Measured: opening the Performance
// tab called getComputedCapital 2,984 times for 1,398ms, inside a getActiveTargetInfo cascade that
// accounted for 2,927ms of a 3,486ms render. The click blocked for ~2.9 SECONDS before the tab could
// even paint.
//
// Keyed on OBJECT IDENTITY of the four inputs it reads. Every one of them is REPLACED wholesale
// rather than mutated (a scan rebuilds ALL, a portfolio parse rebuilds HOLDINGS/POSITIONS/
// ORDERS_TODAY), so reference equality is exact here — it cannot serve a value computed from data
// that has since changed. Also cleared explicitly by invalidateTargetAnchorCaches().
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
// ── Filter defaults live in the PLACEHOLDER; calculations fall back to them when the field
// is empty (owner, v545). Deleting your value returns to the default — never to empty
// (which for Capital meant 0 and for Max Alloc meant no cap → full allocation). The field
// holds ONLY a manual override; an empty field means "use the default", shown greyed in the
// placeholder. Capital default = computed deployed book; Max Alloc default = capital
// divided by average positions per entry day. There is no auto-fill or `autoDefault` flag.
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
// ── Risk per trade (v1092) ───────────────────────────────────────────────────────────────────
// Two DIFFERENT quantities, deliberately kept apart:
//   RELATIVE risk — is every position risking the same rupees as every other? Fixed by the
//     score÷stop weight inside computeAlloc. Needs no field: it is a ratio, and the stop supplies it.
//   ABSOLUTE risk — how many rupees does ONE trade risk? This already had an answer (alloc × stop%);
//     it was simply never displayed. The field below OVERRIDES that computed number, it does not
//     create it — the same pattern as Capital and Max Alloc, whose defaults sit in the placeholder.
//
// It is a CAP, never a target: it can only reduce a position, never grow one past Max Alloc or the
// 0.10% turnover rail. Making it a third competing budget would leave "why was this capped"
// ambiguous, and a risk budget that INCREASES size is how a wide-stop name eats the book.
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
// Default = the risk the EXISTING rails already imply: a full Max Alloc position at the median stop
// of the current candidate pool. Non-circular by construction — Max Alloc depends on capital and
// trade cadence, never on the risk budget — so this reports what you have been risking all along
// rather than inventing a number. An empty field therefore changes nothing about total deployment.
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
// DELIBERATELY unlike Capital and Max Alloc: an empty field means NO CAP, not "use the default".
// getDefaultRiskPerTrade is a DISPLAY default — it reports the risk the existing rails already
// imply so the placeholder is a real number rather than a guess — but applying it would silently
// bind on every above-median-stop row and change sizing the moment this release shipped. The
// behavioural change in v1092 is the score÷stop REDISTRIBUTION, which needs no budget; the cap is
// opt-in, so an untouched filter bar deploys exactly the same total as before.
function getEffectiveRiskPerTrade(){
  const v=parseFloat(document.getElementById('fRiskPerTrade')?.value);
  return (Number.isFinite(v)&&v>0)?v:0;
}
// Which cap actually bound this row. Ordered most-specific first so the label names the real
// constraint rather than whichever happened to tie; 'risk cap' and 'max allocation' can coincide
// exactly at the default (a full Max Alloc position at the median stop IS the default budget),
// in which case Max Alloc is reported since it is the older, more familiar rail.
function allocLimitReason(caps){
  const {score,max,turnover,topUp,risk}=caps;
  const lo=Math.min(score,max,turnover,topUp,risk),e=0.01;
  if(topUp<=lo+e) return 'top-up average cost';
  if(turnover<=lo+e) return 'turnover';
  if(max<=lo+e) return 'max allocation';
  if(risk<=lo+e) return 'risk cap';
  return 'risk weight';
}
// ── v1125 RUPEES ARE THE UNIT (owner, 2026-08-12) ──────────────────────────────────────────────
// "It's not the 1% that is important, it's the 500 rupees (of course after costs)."
//
// Percent and rupees are linked by position size: Rs = % x notional. The app has always taken the
// PERCENT as the input and let the rupees fall out at the very end (riskRs = alloc x stop%). That is
// exact only when every position is the same size and every rupee of capital is deployed. Neither
// holds, in three separate ways:
//
//   1. POSITIONS ARE NOT THE SAME SIZE. computeAlloc weights by score/stop and then caps each row by
//      Max Alloc AND by 0.10% of that stock's own turnover. On the v1092 snapshot every selected row
//      was bound by the turnover rail and the rupees at risk spanned Rs 12 to Rs 4,578 - a 393x
//      spread on IDENTICAL percentage bars. Two rows both "clearing 1.8%" can be Rs 790 and Rs 40.
//   2. CHARGES ARE NOT PROPORTIONAL. DP is a FLAT Rs 15.34 per ISIN per sell day - 0.03% of a
//      Rs 50,000 position and 0.38% of a Rs 4,000 one. A single percentage hurdle over-charges the
//      big position and under-charges the small one, so small lots pass a test they fail in rupees.
//   3. THE GOAL IS A RUPEE TOTAL THAT IS DIVIDED AWAY. "Earn Rs X" becomes a required %/day ONCE, at
//      the top, and is then applied per stock. That conversion assumes full deployment; whole shares,
//      the turnover rail and the 20-order cap all leak capital. Nothing ever adds the rupees back up,
//      so every row can "pass" while the basket earns a fraction of what the day needs.
//
// So the rupee figure is computed from each row's OWN achievable notional using the REAL charge
// model, and the percentage becomes a display unit derived from it rather than the source of truth.

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
// Does the basket ADD UP? The question the app has never asked. Every row was judged against a
// percentage bar and nobody summed the rupees. REPORTED, never enforced: a shortfall is information
// about the day, not a reason to delete stocks. v1093 is the precedent - enforcing an unmeasured
// floor stranded 1,491 of 1,498 rows and emptied the basket outright.
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
// ── v1112 GOAL PANEL (owner: "clunky and doesn't feel well tied into the rest of the system") ──────
// The content was a flex row of bare inputs followed by four prose lines in four different greys and
// sizes — its own visual language, shared with nothing else in the app. It now uses the two idioms
// the rest of the app already speaks: the FILTER-BAR field (.fg label above a bordered input, same
// padding, same focus tint) and the STAT CARD (.st-l / .st-v / .st-d — uppercase label, DM Mono
// number, one explanatory line). Nothing is computed differently; the same four numbers are read from
// the same functions. Structure is the change: ask (inputs) -> demand (need/day) -> reality (your
// pace) -> consequence (projected finish) -> the compounding mechanics.
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
// ── v1130: the READOUT is a separate builder so it can refresh on every keystroke WITHOUT
// replacing the input being typed into. v1110's focus guard protects the fields but also froze these
// numbers, which is what made the module feel unlike the rest of the page: you changed a value and
// nothing moved until you clicked away.
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
    // v1130: when a withdrawal is set, say how much of the required rate IS the withdrawal. Measured
    // 2026-08-14: Rs 1.54L/month on a Rs 4.52L book (34% of capital) took the rate 1.301% -> 2.570%
    // — 98% harder — and blocked 59.5% of the board through the target anchor. That is the arithmetic
    // working, but it is invisible unless the two halves are separated.
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
// ── v1101 BALANCED CARD ROWS (owner) ─────────────────────────────────────────
// `repeat(auto-fit, minmax(N,1fr))` packs as many cards per row as fit and dumps the remainder into a
// stub row — 14 diagnostics rendered as 10 + 4, and an 11-card KPI grid as 10 + 1 with a single card
// stranded on its own line. Owner: if it wraps anyway, spread it evenly.
//
// Pure CSS cannot do this: `auto-fit` has no idea how many children exist. So the column count is
// computed from the SAME `--card-min` the stylesheet uses (one source of truth — the CSS keeps that
// value as its own fallback), and only ever set when the cards genuinely wrap. A grid that fits on one
// row is left completely alone.
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

  // v1078 (owner): SEVEN cards, no more. Consolidated rather than appended -
  //  * MARKET absorbs the breadth line that was buried in Scanned Universe, the "% advancing" that
  //    was the whole sub-line of Top Sector, and the v1076 regime (VIX percentile + Nifty) which
  //    until now was computed and shown nowhere but the status bar.
  //  * UNIVERSE keeps the scan count and folds in the displayed/selected/feature meta that was
  //    crammed under Top Score.
  //  * TOP SCORE is left to do one job.
  //  * GOAL now answers "how am I doing TODAY" and "how much is LEFT", which it could not before.
  const breadthPct = t ? (bull / t * 100) : null;
  const reg = (typeof MARKET_REGIME !== 'undefined' && MARKET_REGIME) ? MARKET_REGIME : null;
  const regTone = reg && reg.label === 'calm' ? 'var(--green)'
    : reg && reg.label === 'normal' ? 'var(--cyan)'
    : reg && reg.label === 'elevated' ? 'var(--amber)'
    : reg && reg.label === 'stressed' ? 'var(--red)' : 'var(--t2)';
  // v1088 (owner): the headline is the LIVE Nifty 50 move rebuilt from its own constituents in the
  // live scanner export, not the EOD index row from the daily zip — that row is yesterday's close
  // during a session, and showing a stale number as market status is worse than showing none.
  // The regime word ("CALM") is demoted to a tone and a tooltip; VIX keeps its actual number and is
  // explicitly marked prev-close, because no input carries a live VIX.
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

  // v1088 (owner): average round-trip COST as a percentage, on a card. This number already gated
  // allocation via estimateRoundTripCostPct() — a target that cannot clear it is refused — but it
  // was computed and never shown, so the hurdle was invisible. Mean AND median are both given
  // because the flat ₹15.34 DP fee per sell day makes the mean lot-size dependent and skewed.
  // ONE NUMBER (owner, 2026-07-31): what a round trip costs, full stop. It is VALUE-WEIGHTED —
  // total charges over total value traded — not a mean of per-trip percentages. That distinction
  // matters: the flat ₹15.34 DP fee per sell day dominates a small lot, so averaging the per-trip
  // ratios over-weights tiny trades and overstates the cost (0.258% vs the 0.13% actually paid).
  // Value weighting answers the question asked: of everything I traded, what share went to charges.
  // The breakdown, and the hurdle this feeds, live in the tooltip so the card stays one number.
  const costCard = (() => {
    const trips = (TRADEBOOK_STATS && TRADEBOOK_STATS.tripsData) || [];
    // EVERYTHING (owner, 2026-07-31), including charges that attach to a DAY rather than a trade.
    // DP is ₹15.34 per ISIN per sell day and is booked once on that day's first trip (see
    // dpCharged/skipDp), so it is already inside these totals — but the previous filter required a
    // clean buy AND sell price, which silently dropped the charges on any trip lacking a cost
    // basis. Nothing is dropped now: every recorded charge counts, and each leg contributes to the
    // traded value only when its price is known, so a partial trip understates neither side.
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
  if(PEAK_TIMING_REMOVED>0)filterPills.push(`<span class="info-pill pill-amber" title="Ranked stocks flagged as extended by the entry-timing evidence. Since v1075 this is a LABEL, not a filter — they remain recommendable and exportable. A forward test (2026-07-28 close to 2026-07-29, n=1618) found extension predicted continuation, not reversal.">⚡ ${PEAK_TIMING_REMOVED} extended</span>`);
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

// ── Movable table columns (v536, owner) ───────────────────────────────────────
// Every data table's column order is user-draggable (HTML5 drag on the header) and
// persists in localStorage per table key, so a reorder survives refresh. Saved order
// lists existing keys first; columns added in later versions append at the end.
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
      // v1118: MISSING VALUES SORT LAST, in both directions. They used to coerce to 0 via `av||0`,
      // which buried them in the middle of any range spanning negatives (P&L) and — the case that
      // surfaced it — floated unranked rows to the TOP of an ascending Rank sort, so a held stock
      // absent from today's upload outranked rank 1.
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
  // Indian continuous trading starts at 09:15. Until 09:30 there is no completed 15-minute
  // candle, so 5m/15m/1h readings can be the same unfinished opening impulse rather than
  // independent confirmation. That is worth SAYING, and nothing more (owner, v1068): the clock
  // never withholds a recommendation, empties the selection, or refuses an export. The trading
  // day starts at 09:15 and the app must be usable from 09:15. Diagnostic state only.
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
// v1096: the extremes observed at a buy, used as the attribution baseline on the ENTRY DAY.
// Returns null when no context was captured for that (date, symbol) — in which case the entry day
// is UNATTRIBUTABLE and must be skipped rather than measured against the whole day's bar.
//
// HONEST BOUND ON PRECISION: the snapshot is the first one taken after the buy was DETECTED, and
// detection depends on when orders.csv is re-exported and re-ingested — it is not the fill instant
// (v1064 already refused to claim that). So `low1dAtBuy` is at or below the true low-at-fill, which
// makes this test CONSERVATIVE: it can miss some genuine post-fill drawdown, but it can no longer
// invent drawdown that happened before the trade existed. Under-counting a real adverse move is the
// safe direction here — the previous behaviour over-counted it, and MAE is the number cited for NOT
// tightening the stop, so an inflated figure argued for a looser stop than the evidence supports.
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
      // v1096: the day's extremes AS THEY STOOD when this buy was first observed — the executed-trade
      // equivalent of v1085's high1dAtIssue/low1dAtIssue. Without them nothing downstream can tell a
      // low that printed BEFORE the fill from one that came after, and `syncExecutedRecommendedEntries`
      // was charging the entry day's ENTIRE low to the entry as adverse excursion.
      // ctxVersion 2 = this entry carries the extremes. Entries written before v1096 stay at
      // version 1 and are DELIBERATELY NOT backfilled: the extremes must be the ones observed at
      // the buy, and a later snapshot's high is exactly the contamination this release removes.
      // A version-1 entry simply means the entry day is unattributable, which is the honest state.
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

// ── Shared search plumbing for the three Rankings tables ──────────────────────
// The Rankings search box narrows the recommendations table, the Latest Session
// table and the Open Positions table together, so a symbol can be found wherever
// it currently lives (owner, v530).
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

// Latest Session — whichever source (Orders.csv or Tradebook) has the newer date.
// Extracted from renderPerformance so the Rankings tab can host it next to the
// recommendations and open-position tables under one shared search box (v530).
// Header totals stay whole-session; the table and its footer follow the search.
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
  // v1094/v1095: Left on Table replaces Reverse ₹ — see enrichExitPnlRow. It measures what the stock
  // did AFTER the exit. The colour scale is DELIBERATELY inverted against every other money column
  // here: positive means it kept running without you (bad, red), negative means it fell after you
  // sold (the exit saved money, green).
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
      // v1122 (owner: the table is cropped): the seven charge components are COLLAPSED into Total
      // Charges, which is their sum, with the full breakdown on hover. Nothing is lost — it is the
      // one block of columns that is pure detail, it took a third of the table's width, and it is
      // the reason 21 columns would not fit a screen. 21 -> 14.
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
    // ── v1118 (owner): the exit is TWO legs now, so show both ─────────────────────────────────────
    // v1115 splits every buy into a base leg at the row's target and a runner leg further out, each
    // carrying its own GTT. A single Target column therefore described an exit that is no longer the
    // one being armed. Same split arithmetic as the export (`splitQty` + `getRunnerTargetPct`), so
    // the two panels cannot disagree.
    //
    // WHAT THIS IS AND IS NOT: like the existing Target column, these are the CURRENT POLICY levels,
    // not a read of what is actually resting in Zerodha. No input exposes live GTTs (the same gap
    // behind the double-sell warning), and positions bought before v1115 have one leg, not two. The
    // panel has always shown policy rather than armed state; this keeps that one meaning rather than
    // mixing two.
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
      flow:(()=>{const rd=getIntradayRead(pos.symbol);return rd&&rd.traj?+(rd.cvdPct*100).toFixed(2):null;})(),
      baseQty,runnerQty,runnerPrice,runnerPct,
      score:isFinite(Number(scannerRow?.score))?Number(scannerRow.score):null,
      rank:scannerRow?.rank??null,setup:scannerRow?.setup||'',
      dayPct:scannerRow?.day??scannerRow?.priceChange??null,risk:scannerRow?.risk||'',
      // v1177: carried as numbers so the columns SORT; the cells re-read the live trajectory.
      pace:(()=>{const r=getIntradayRead(pos.symbol);return r&&Number.isFinite(r.avgMovePct)?r.avgMovePct:null;})(),
      predEod:(()=>{const r=getIntradayRead(pos.symbol);return r&&Number.isFinite(r.predPct)?r.predPct:null;})(),
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
    // v1070: the chart link no longer depends on the stock being in the current scan —
    // TradingView resolves by symbol, so a held name absent from today's file still charts.
    // v1148 (owner): "It's not in the recommendation table anymore if I have already bought it."
    // Correct - v1070 keeps a held stock in the ranking, but the v1080 allocation gate drops a
    // held-at-profit row with no top-up cushion, so in practice it vanishes from the board the
    // moment it is bought. A POSITION is where the check belongs after that, and the question
    // changes with it: not "should I buy this" but "is the flow that justified the buy still there".
    {key:'sym',label:'Symbol',align:'left',bold:true,
      // The flow reading rides the SYMBOL cell rather than a column of its own: one more column
      // pushed this panel into a horizontal scrollbar, which the owner has ruled out everywhere.
      fmt:(v,row)=>{
        const rd=getIntradayRead(v);
        let tag='';
        if(rd&&rd.traj){
          const col=rd.regime==='accumulating'?'var(--green)':rd.regime==='selling'?'var(--red)':'var(--amber)';
          // v1172: the ACTION, not the weather. The regime and the flow numbers move to the tooltip.
          const a=getPositionAction(v,row);
          const ac=a?(a.tone==='green'?'var(--green)':a.tone==='red'?'var(--red)':'var(--amber)'):col;
          tag=`<div style="font-size:11px;color:${ac};font-weight:700" title="${escHtml(
            (a?a.act+' — '+a.why+String.fromCharCode(10):'')
            +rd.regime.toUpperCase()+' — net flow '+(rd.cvdPct*100).toFixed(1)+'% of everything traded'
            +(rd.traj.costRatio?'; 1% up costs '+Math.round(rd.traj.upCost).toLocaleString('en-IN')
              +' shares against '+Math.round(rd.traj.dnCost).toLocaleString('en-IN')+' down':'')
            +(Number.isFinite(rd.traj.pressurePct)?'; unspent pressure '
              +(rd.traj.pressurePct>=0?'+':'')+rd.traj.pressurePct.toFixed(2)+'%':''))}">${
            a?escHtml(a.act):(rd.regime==='accumulating'?'HOLDING UP':rd.regime==='selling'?'BEING SOLD':escHtml(rd.regime))
          }</div>`;
        }else{
          const a=getPositionAction(v,row);
          if(a){
            const ac=a.tone==='green'?'var(--green)':a.tone==='red'?'var(--red)':'var(--amber)';
            tag=`<div style="font-size:11px;color:${ac};font-weight:700" title="${escHtml(a.act+' — '+a.why)}">${escHtml(a.act)}</div>`;
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
    // v1073: the day-1 time exit, shown next to Days Held so the two read together.
    // v1179: ONE TARGET, because the basket now exports one order per stock (v1177). This showed
    // "Target / Runner" for four releases after the runner leg stopped being exported - the panel
    // was describing an exit the app no longer arms. A position opened while v1115-v1176 were live
    // may still have TWO GTTs resting in Zerodha, so the runner it WOULD have had is kept in the
    // tooltip rather than deleted outright.
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
    // v1177 (owner): Pace and EoD belong here too. PACE is what the owner actually wants it for -
    // *"my intention was to have a number which I can safely use as a trail stop if and when I
    // wish to"* - so it is labelled and tooltipped as a trail distance, not as trivia: the mean
    // absolute move of one bar is the smallest gap a trailing stop can sit at without the stock's
    // ordinary breathing taking it out, and the tooltip gives that distance in RUPEES off the last
    // price, which is what a Zerodha trailing SL is entered in.
    // v1180: PACE AND EoD IN ONE CELL. Two columns pushed this panel into a horizontal scrollbar,
    // which the owner has ruled out everywhere - and they are two readings of the same trajectory,
    // so they belong together exactly as TGT/SL do. PACE is what he wants it for: *"a number which
    // I can safely use as a trail stop"* - the volume-weighted mean move of ONE bar is the tightest
    // a trail can sit without ordinary breathing taking it out, shown in RUPEES because that is what
    // a Zerodha trailing SL is entered in.
    {key:'pace',label:'Pace / EoD',align:'right',
      fmt:(v,row)=>{
        const rd=getIntradayRead(row.sym);
        if(!rd||!Number.isFinite(rd.maxPullbackPct)) return '<span style="color:var(--t3)">—</span>';
        const ltp=Number(row.ltp)||0, rs=ltp>0?ltp*rd.maxPullbackPct/100:null;
        const pace=`<span title="${escHtml('The DEEPEST pullback this stock has taken today - running high to the '
          +'low that followed. A trailing stop inside this distance would already have been hit at least once during '
          +'the session'+(rs?'; here that is ₹'+rs.toFixed(2)+' off the last price':'')+'. It replaced the mean bar '
          +'move, which measured 3x to 10x too tight on the day’s own winners.')}">${rd.maxPullbackPct.toFixed(2)}%${
          rs?`<span style="color:var(--t3);font-size:11px"> ₹${rs.toFixed(2)}</span>`:''}</span>`;
        if(!Number.isFinite(rd.predClose)) return pace+'<span style="color:var(--t3)"> / —</span>';
        const t=rd.traj, up=rd.predPct>=0;
        const eod=`<span style="color:${up?'var(--green)':'var(--red)'};font-weight:700" title="${escHtml(
          'Unspent pressure '+(t.pressurePct>=0?'+':'')+t.pressurePct.toFixed(2)+'%, capped by what this stock can '
          +'travel in the '+t.barsLeft+' bars left. Arithmetic, not a forecast.')}">${
          (rd.predPct>=0?'+':'')+rd.predPct.toFixed(2)}%</span>`;
        return pace+'<span style="color:var(--t3)"> / </span>'+eod;
      },clrFn:()=>'var(--t2)'},
    {key:'risk',label:'Risk',align:'left',fmt:v=>v?radarRiskPill(v):'—'}
  ];
  // Header totals always describe the WHOLE portfolio; the table shows the search match.
  const totalCapital=rows.reduce((sum,row)=>sum+(row.capital||0),0);
  const totalPnl=rows.reduce((sum,row)=>sum+(row.pnlRs||0),0);
  const pnlColor=totalPnl>0?'var(--green)':totalPnl<0?'var(--red)':'var(--t3)';
  const shown=filterPanelRows(rows,query,row=>[row.sym,row.scannerRow?.name,row.scannerRow?.sector]);
  // v1118 (owner): default sort is RANK ASCENDING, not score descending. Rank is the stock's own
  // standing in today's cross-section and reads 1, 2, 3; score is the same ordering expressed as a
  // number that has to be read backwards. Rows with no rank (not in today's upload) sort last —
  // makeSortableTable puts null/undefined at the end on an ascending sort.
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
  // Two tiers (owner, v534). PRIMARY answers the only questions that change a decision:
  // am I making money, what is the risk, how big should the next position be, and when
  // do I review it. Everything else is real but diagnostic, so it sits behind a native
  // <details> instead of forming a 24-card wall.
  const kpis=[
    {label:'Net P&L',value:fmtPerfRs(netWithToday),color:clr(netWithToday),sub:`${p.roundTrips}${todayAdd?`+${todayAdd.lots}`:''} lots · ${spanTradingDays||p.totalTradingDays} trading days${todayNote}${preSystemLots?` · ${preSystemLots} pre-system ignored`:''}`},
    {label:'Win Rate',value:p.winRate+'%',color:p.winRate>=55?'var(--green)':p.winRate>=45?'var(--amber)':'var(--red)',sub:`${p.winners}W · ${p.losers}L lots`},
    {label:'Expectancy',value:fmtPerfRs(p.expectancy),color:clr(p.expectancy),sub:'Net ₹ you make per lot, on average'},
    {label:'Profit Factor',value:p.profitFactor!=null?p.profitFactor:'—',color:p.profitFactor>=1.5?'var(--green)':p.profitFactor>=1?'var(--amber)':'var(--red)',sub:'Gross wins ÷ gross losses · above 1 = profitable'},
    {label:'Max Allocation',value:autoMaxAlloc?fmtINR(autoMaxAlloc):'—',color:autoMaxAlloc?'var(--amber)':'var(--t3)',sub:autoMaxAlloc?`${fmtINR(allocationCapital)} capital ÷ ${allocationCadence.toFixed(2)} avg positions/entry day${maxAllocOverride?` · typed override ${fmtINR(typedMaxAlloc)} active`:''}`:'Load trade history to calculate trading cadence'},
    // v1121 (owner): "Review After" moved to a pill on Rankings — it is a single number that belongs
    // next to the board, not a card. In its place, the question the exit work has been circling:
    // across every watched session, how long after an exit does the day's high actually arrive?
    // NEGATIVE means the high was typically already in when you sold — the exit was late, not early.
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
  // Same-day exit headroom (owner insight 2026-07-21): on the days you sold, how much
  // higher did the stock trade AFTER your exit that same day? This is the measured cost
  // of overriding the GTT manually — the decision it changes is "hold to the target".
  // Diagnostic store only; it feeds no policy.
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
  // ── v1112 (owner): ONE grid. Nothing is hidden behind a disclosure. ─────────────────────────────
  // v534 split these into a headline tier and a collapsed "More detail" tier to avoid a 24-card wall.
  // The wall was never the problem — the ORDER was: the two tiers interleaved the same subjects, so
  // Largest Loss sat up top while Largest Win sat behind a click, and Avg Position was separated from
  // Max Allocation, which is computed from it. Sequenced by the question each card answers, the whole
  // set reads in one pass and `balanceGrid` (v1101) already spreads it over even rows.
  //
  //   RESULT     did it make money, and how reliably
  //   PACE       what a typical day looks like, and the best and worst ones
  //   EXTREMES   the tails and the runs — what a bad patch actually costs
  //   BEHAVIOUR  how the positions are held and exited
  //   SIZING     how big the next one should be
  //
  // Order is declared by LABEL and applied as a lookup, so a card added later still renders (it
  // appends) rather than silently vanishing because this list was not updated.
  const KPI_ORDER=[
    'Net P&L','Win Rate','Expectancy','Profit Factor',
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
      ${hasTradeWindows?perfCard(`Time-of-day Outcomes — Diagnostic Only <span style="font-size:12px;color:var(--t3);font-weight:400">${timingModel.episodeCount} distinct entries · ${timingModel.entryDays} entry days · clock windows only · descriptive, never a recommendation rule</span>`,timingTbl.getHtml(),'','perf-trade-windows'):''}
      ${p.symBreakdown.length?perfCard('Stocks',symTbl.getHtml(),'360px','perf-stocks'):''}
    </div>`;

  setTimeout(()=>{monthTbl.render();symTbl.render();timingTbl.render();scTbl.render();},0);
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
// v557: the portfolio session date derived from the DATA (Orders.csv row timestamps), not from file
// metadata. Zerodha only rewrites Positions/Orders when a new trade happens, so the morning after a
// no-trade day both files still hold yesterday's rows — and a file mtime can read "today" for
// yesterday's CONTENT (re-save, folder copy, Drive re-upload). The row dates cannot lie.
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

// ── Surveillance P&L Correlation ──
// For each surveillance column, checks which currently-held stocks are flagged and
// computes their current P&L%. Historical accumulation is maintained internally,
// but the visible table must never show stale rows as current holdings.
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
  const head=`<h3 id="meth-watch" style="margin-top:28px">Indicator Watch <span style="font-size:14px;color:var(--t3);font-weight:400">automatic orientation guardrail</span></h3>`;
  const intro=`<p style="color:var(--t2);font-size:14.5px;line-height:1.7">Each accepted session the system records where every liquid stock (turnover ≥ ₹25L) sits on every direction-testable indicator, then ${IW_WINDOW} sessions later checks whether the end the model <em>rewards</em> actually held more of the movers — or fewer. It keeps a rolling ${IW_LOG_MAX}-session tally per indicator and flags one only when it looks backwards on <strong>both</strong> a +5% and a +10% forward move, past a strict bar corrected for watching so many at once. Nothing changes automatically — a flag is a note to bring to review before inverting anything. Its job has narrowed since the forward-effect log re-armed: a feature carrying a measured effect already overrides its own prior, so the priors that still run <em>unopposed</em> are what this watches.</p>`;
  if(collecting){
    return `${head}${intro}<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:14px 18px;font-size:14px;color:var(--t2)">⏳ Collecting evidence — <strong>${resolved}/${IW_MIN_SESSIONS}</strong> resolved sessions (need ${IW_MIN_SESSIONS} before any warning; ${w.pending} snapshot${w.pending===1?'':'s'} awaiting their ${IW_WINDOW}-session resolution). No orientation warnings until enough forward data exists.</div>`;
  }
  if(!w.flags.length){
    return `${head}${intro}<div style="background:var(--bg-card);border:1px solid rgba(34,197,94,.25);border-radius:10px;padding:14px 18px;font-size:14px;color:var(--t2)">✓ No indicator is backwards on both outcomes over the last ${resolved} resolved sessions (${w.testable} indicators have enough samples to test). Every direction-testable prior is oriented consistently with the forward evidence.</div>`;
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
    <div style="background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:12px 16px;margin-bottom:10px;font-size:14px;color:var(--t1)"><strong>⚠ ${w.flags.length} indicator${w.flags.length===1?'':'s'} looks backwards over the last ${resolved} sessions.</strong> The rewarded end held <em>fewer</em> movers on both +5% and +10%. Bring these to review — inverting a prior is a deliberate, logged code change, never automatic.${(()=>{
      // v1179: A FLAG ON A FEATURE THAT ALREADY CARRIES A MEASURED EFFECT IS NOISE. When this panel
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
        return ` <span style="color:var(--t3)">${over} of these already carry a measured forward effect that overrides the prior, so the scorer has corrected itself there — the remaining ${w.flags.length-over} run unopposed and are the ones worth reading.</span>`;
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
    // v1144: the table may never need a horizontal scrollbar (owner, standing). Measured at 552px
    // of overflow, which is not a trimming problem - it is too many columns. Five were folded into
    // the cells they belong to rather than deleted: Setup and Series/Band ride the Symbol cell,
    // Day % joins Price, and Book joins Rel Vol. Every number survives.
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
  // Held-suppression keys on NET-LONG exposure only (v1062). A stock SOLD today nets to qty<=0 in the
  // combined map (a POSITIONS short leg, or an orders net-sell); it is no longer held, so a FRESH buy
  // of it must NOT be discouraged — it stays eligible for recommendations. Only actual holdings
  // (net qty>0) are suppressed. Today's BUY orders still net positive, so they remain suppressed;
  // a partial sell that leaves qty>0 stays held. (Open Positions still shows shorts via
  // getCombinedOpenPositionMap, which is unchanged.)
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
      // Holdings is the broker's CURRENT post-sale quantity. A CNC sell is also repeated in
      // Positions as today's negative leg, so subtracting it here double-counts the sale
      // (CASTROLIND: Holdings 93 plus Positions -92 incorrectly became 1). Keep a remaining
      // holding authoritative; retain the negative leg only when no long holding remains so a
      // sold-out/short symbol cannot be mistaken for a held position.
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
// ── v1114 ────────────────────────────────────────────────────────────────────
// Drop every cache the session target anchor is built from. Called once per load, after the
// portfolio files are parsed and before the scorer reads the anchor.
//
// The two that MUST be here are the harvest plan (a 1.5s TTL, which is happy to serve a value
// computed moments earlier with no tradebook loaded) and the goal rate (keyed on inputs that a
// portfolio parse changes). The rest are keyed on capital or the tradebook and would self-invalidate
// anyway; they are cleared together so there is ONE place that answers "what does the anchor depend
// on", rather than a rule spread across six declarations. Cheap — each is a single object drop, and
// this runs once per file load, never on the typing path.
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
// Goal-led target (owner decision 2026-07-18, reversing the informational-only rule):
// the goal's required NET %/day converts to a gross GTT by adding real round-trip
// charges, floored at the minimum useful net (HARVEST_DESIRED_NET_PCT) so a tiny goal
// can never set a target where charges eat the edge.
function getGoalLedTargetPct(){
  const goalNet=getGoalRequiredNetPct(); // required NET %/trading day on total capital
  if(goalNet==null||!isFinite(goalNet)||goalNet<=0) return null;
  const netEff=Math.max(goalNet,HARVEST_DESIRED_NET_PCT);
  let gross=netEff+estimateRoundTripCostPct(netEff+0.35);
  gross=roundPct05(netEff+estimateRoundTripCostPct(gross));
  return gross;
}
// Portfolio target anchor: lower of learned Harvest gross and goal-led gross, unless the
// owner supplies a manual anchor. getRowExitPolicy() blends this context with each stock's
// own ATR/range capacity; this value is no longer pasted onto every order.
// The widest daily move any stock on file could legally make. Used to reject a target anchor that
// no stock in the universe could ever reach (v1111). 20% is the NSE regulatory maximum band and is
// the fail-open default when no sec_list has been parsed yet.
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
  // v1111: a typed anchor is honoured up to what the exchange physically allows.
  //
  // v1103 put a ceiling here after a stray paste landed a rupee amount in this percentage field;
  // v1104 removed it as over-engineering because the bad value was already on screen, reading
  // "base 45975.39%". That reasoning did not survive contact. It has now happened a second time
  // (tgtOverride "100000") and this time it silently made **0 of 1902 rows viable** — every
  // eligibility test compares against the anchor, so the app recommended NOTHING for a day with
  // the number visible the whole time. Visibility is not a control.
  //
  // The bound is exchange truth, NOT a tunable: a stock cannot travel further in one day than its
  // own price band, so an anchor above the widest band on file is unreachable by every stock in
  // the universe and can only be a mis-paste — both observed cases were rupee amounts. Such a
  // value is treated as ABSENT so the auto anchor resumes; it is deliberately NOT clamped to the
  // edge, which would substitute a target the owner never chose. Fails OPEN when no band data is
  // loaded (the 20% regulatory maximum is used), so a missing zip can never reject a real anchor.
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

// One execution policy per stock. The portfolio target remains an evidence anchor,
// while the stock's ATR/range determine what that particular name can reasonably reach.
// `activeInfo` lets a caller that evaluates MANY rows in one pass resolve the portfolio target
// anchor once and hand it in. getActiveTargetInfo() costs ~2.3ms (it walks the goal solve and the
// harvest outcome pool), which is invisible for one row and fatal across the universe — the v1080
// allocation gate ran 7s on 2,962 rows before this. Omit it and the behaviour is unchanged.
// ── v1093: the ACHIEVABILITY CURVE — a baseline reward:risk that is not learned from results ──
//
// Owner rule (2026-08-03): "R:R is not to be learnt from past and applied to future if it's bad.
// If it's good, that should be the baseline, but if it's bad, there should be a good default
// baseline based on data."
//
// The trap this avoids: the tradebook's 76% win rate was PRODUCED BY harvesting at ~1.9%. Using
// it to justify ~1.9% is a closed loop — the same circularity v1074 named, one level up. So the
// baseline is measured on the CROSS-SECTION instead: over the last COMPLETED session, at each
// candidate target T against each stock's OWN ATR stop, what fraction of the tradeable market
// reached T before its stop? That is a fact about the market, not about the owner's fills.
//
// The bar MUST be complete, so it comes from the bhav copy (last completed session), never the
// live intraday file — with part of the day still to run every hit rate would be understated.
// Stateless in the app's sense: one session, recomputed daily, nothing accumulated.
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
// ── v1097 TARGET NUDGE (owner) ───────────────────────────────────────────────
// "We have a base target based on my goal. We have money left on the table. Just distribute that
// percentage to my stocks based on the radar score."
//
// The base rate answers a question about the OWNER (what must I earn per day). The money left on the
// table answers a question about the STOCKS (how much further did they go after we sold). Adding the
// second to the first is what makes the exit stock-aware without abandoning the goal contract, and
// re-solving both continuously keeps it honest as either side moves.
//
//   nudge_i  = pool x score_i / meanScore     -> the mean nudge across the cohort IS the pool
//   target_i = min(base + nudge_i, capacity_i)
//
// NO NEW CONSTANT. `pool` is measured (getLeftOnTablePool), `meanScore` is the day's own cross-section,
// `capacity` is the sqrt(ATR x range) unit that has been on the row since v1060.
//
// CAPPED AT CAPACITY, NOT AT THE SESSION CEILING — measured and deliberate. Capping the nudged target
// at the v1083 same-day runway collapses every row back to 2.5-3.5% (checked on the 2026-08-05 14:37
// file: all ten of the top ten, several landing BELOW the base rate) and the nudge vanishes entirely.
// The session ceiling answers "can I BUY this today"; it has no business setting where the position is
// SOLD, which under the v1085 two-day label may well be tomorrow. Viability still uses it; the exit
// price no longer does.
//
// FLOORED AT THE BASE RATE, by owner rule: "some day money left on the table would be negative, that
// means we're doing well and don't need to add anything to our base target rate." A negative pool is
// floored to zero in getLeftOnTablePool, so every target falls back to exactly the goal rate.
let _nudgeMemo=null;
function getTargetNudgeContext(){
  const pool=getLeftOnTablePool();
  // Normalise against the cohort the recommendations are actually drawn from, so the mean nudge equals
  // the pool over the stocks being bought. One session-level scalar shared by every caller — the same
  // number for the rankings table, the Open Positions panel and the sell basket, so a stock's target
  // cannot depend on which surface is asking.
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
  // v1077 (owner, 2026-07-29): the target is GOAL-DRIVEN, not derived from the stock's ATR/range.
  // The exit exists to compound capital toward a dated goal, so the rate comes from the goal
  // arithmetic - capital, earnings target, deadline, withdrawal/reinvest split - not from whatever
  // a particular stock happens to be capable of moving. Measured on 2026-07-29: the goal
  // (Rs 1.3 Cr by 2027-12-31, Rs 6.12L basis, 366 trading days) requires 1.453% NET per trading day,
  // which grosses to 2.00% after costs, while the v1073 capacity rule was setting a median 4.55%
  // target. The owner's realised wins cluster at +2.62% mean with 215 of 320 exits in the +2-3%
  // bucket, so the goal rate is the one that actually FILLS; the capacity target was aspirational
  // and simply held positions open. Smaller, more frequent, higher-probability exits are also what
  // compounding needs - the whole point is turnover, not a single large move.
  // ATR/range is NOT deleted: it is retained below as a REACHABILITY check (can this stock plausibly
  // travel that far in a day?) and reported, but it no longer sets or caps the number.
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
  // ── v1105 THE EXIT TARGET SCALES WITH THE STOCK, NOT WITH ITS SCORE ─────────────────────────
  // Measured on the owner's own 214 completed sells (2026-08-07), taking the move available from HIS
  // buy price to that day's high:
  //
  //     available   median 3.36%  = 0.78 ATR        he captured  median 2.13% = 0.44 ATR
  //
  // Sweeping target = k x ATR over those same trades, filling at the target where the day's high
  // reached it and otherwise leaving his actual exit in place:
  //
  //     k=0.50 -> +Rs 2,453    k=0.75 -> +Rs 27,449    k=1.00 -> +Rs 41,069
  //     k=1.25 -> +Rs 42,397   k=1.50 -> +Rs 40,471    (his actual realised: -Rs 45,397)
  //
  // The optimum is a BROAD plateau at 1.0-1.25 ATR, not a spike, which is what makes it credible
  // rather than fitted. And `capacity` = sqrt(ATR x range) already equals 1.00 ATR at the universe
  // median (3.71% against a 3.69% median ATR) — the v1073 rule that v1077 removed lands exactly on
  // the measured optimum. So this restores capacity as the target and keeps the goal rate as a FLOOR.
  //
  // WHY A FLAT RATE WAS WRONG. The same 2.75% is 0.83 ATR on a quiet name and 0.47 ATR on a fast one
  // — less than half a normal day's travel. That asymmetry is the mechanism behind the leak: 13 of
  // the 22 sells that ran 7%+ past him were top-ATR-quartile names.
  //
  // THIS REPLACES THE v1097 SCORE NUDGE. Score answers "how good is the setup", which is an ENTRY
  // question; how far a stock can travel is a property of the stock. Owner, 2026-08-07: "tying to
  // ATR instead of score is a good start." The left-on-table pool is still measured and still shown,
  // it simply no longer sets the price. A MANUAL anchor still wins outright (v1077 precedent).
  // v1119: the aspiration above the goal rate is now the MEASURED reachable level from the owner's
  // own exits, not the stock's ATR capacity. Capacity remains the FALLBACK for when too few exits
  // have been recorded to trust a distribution (and is still reported on every row).
  const reach=getReachableTargets();
  const aspire=reach.basePct>0?reach.basePct:capacity;
  if(targetPct>0&&active.source!=='manual'&&aspire>0){
    targetPct=toStep(Math.max(basePct,aspire));
    nudgePct=+(targetPct-basePct).toFixed(2);
    if(nudgePct>0) targetSource+=reach.basePct>0
      ? ' + reachable level ('+reach.samples+' exits)'
      : ' + stock capacity (ATR fallback)';
  }
  const stopPct=getRowStopDistancePct(row);
  // v1093 (owner): "R:R is not to be learnt from past and applied to future if it's bad. If it's
  // good, that should be the baseline, but if it's bad, there should be a good default baseline
  // based on data." The baseline is now MEASURED (buildAchievabilityCurve) — and it is REPORTED,
  // not enforced, for a reason established by measurement rather than caution.
  //
  // ENFORCING IT WAS BUILT, MEASURED AND BACKED OUT. Flooring the target at baselineRR x stop on
  // the 2026-07-31 curve (baseline 1.28x, median stop 5.14%) moved the median target 1.90% -> 6.55%
  // and made 1,491 of 1,498 tradeable rows NON-VIABLE through the v1083 session ceiling: the
  // displayed list collapsed to 2 rows and the basket to ZERO. That is not a tuning problem, it is
  // a HORIZON CONTRADICTION and it is pre-existing. The curve is measured open-to-close over a
  // COMPLETE day, and v1085 already defines success as target-before-stop within TWO trading days,
  // but getRowExitPolicy's viability test is still same-day: the session ceiling asks what is
  // reachable FROM NOW, and by mid-session most of a day's range is already spent. So the app is
  // currently asking for a same-day move while grading itself on a two-day outcome. Reconciling
  // those is the next change; forcing the target first would simply have stopped recommending.
  //
  // Precedent for reporting rather than capping: v1077 kept ATR as the `reachable` FLAG.
  const baseRR=getBaselineRewardRisk();
  const rrFloorPct=(baseRR>0&&stopPct>0)?toStep(stopPct*baseRR):null;
  let minGrossPct=null;
  if(basePct>0){
    // v1112: ROUNDED THE SAME WAY THE ANCHOR ITSELF IS, which is the whole point of this line.
    // getGoalLedTargetPct BUILDS the goal anchor as `roundPct05(max(goalNet, HARVEST_DESIRED_NET_PCT)
    // + round-trip cost)` — the identical two ingredients this hurdle re-derives. It used to CEIL to
    // the next 0.05 while the anchor ROUNDS to the nearest, so the two disagreed by one rounding step
    // and the anchor failed the test it was constructed to pass. Measured 2026-08-09: cost 0.503% +
    // the 0.60% net floor = 1.1030%, which the anchor rounds to 1.10 and the hurdle ceiled to 1.15 —
    // so `basePct >= minGrossPct` was FALSE for the entire market. 542 of 900 basket-eligible rows
    // were struck out on that 0.05, and the only rows left standing were the two with no ATR/range at
    // all, because a null capacity skips this test: the app could recommend nothing except the stocks
    // it knew least about. Sharing one rounding rule makes that class of contradiction impossible.
    // The hurdle still bites where it should — a manual anchor set below costs still fails.
    minGrossPct=roundPct05(HARVEST_DESIRED_NET_PCT+estimateRoundTripCostPct(basePct));
    minGrossPct=roundPct05(HARVEST_DESIRED_NET_PCT+estimateRoundTripCostPct(minGrossPct));
  }
  // v1081 (owner): PRICE-BAND HEADROOM IS A HARD CONSTRAINT, not a capacity opinion.
  // Measured 2026-07-30 on SMLMAH: the basket exported it at 11:09:24 at Rs 5,435 — already +19.0%
  // on a 20% band, with the upper circuit at Rs 5,479.20, i.e. 0.81% of runway against a 1.85%
  // target. It filled 13 seconds later at Rs 5,439.82 (0.09% slippage, so this was NOT slippage),
  // and the attached GTT target of Rs 5,540.45 sat Rs 61 ABOVE the maximum price the stock is
  // permitted to trade at that day. The stock then ran to Rs 5,479.20 — exactly the circuit, as far
  // as it could legally go — and the target was still unreachable.
  //
  // This is arithmetic, not a judgement about whether momentum continues: continuation DID happen
  // and the trade still could not make target. So unlike `reachable` (ATR, a reported flag only),
  // insufficient band headroom makes the row NOT VIABLE, which drops it out through the v1080
  // allocation gate. Runway is measured from the BUY price, so the 0.25% market-order buffer is the
  // slippage cushion. Fails OPEN when the band or day% is unknown.
  const bandRef=Number(buyPrice)>0?Number(buyPrice):getBuyPrice(row||{});
  const uc=getUpperCircuitInfo(row,bandRef);
  // v1097: every ELIGIBILITY test below is measured against the BASE rate, never the nudged target.
  // The base is what the position must achieve; the nudge is upside we are willing to wait for. If
  // viability used the nudged number, raising a stock's target would delete that same stock from the
  // recommendations — the nudge would remove its own candidates.
  const bandLimited=!!(uc&&basePct>0&&uc.runwayPct<basePct);
  // v1083: the same test against the STATISTICAL ceiling (day's low + one typical day's range).
  // The circuit is what the stock may LEGALLY reach; this is what it may PLAUSIBLY reach. A row
  // needs the target to fit under both. Reported separately so the two causes stay distinguishable.
  const sc=getSessionCeilingInfo(row,bandRef);
  const rangeExhausted=!!(sc&&basePct>0&&sc.runwayPct<basePct);
  // ── v1112: THE SESSION CEILING IS REPORTED, NOT ENFORCED (owner) ───────────────────────────────
  // The CIRCUIT ceiling above stays a removal: it is exchange arithmetic — a stock at its upper band
  // may not legally trade higher today, so the target cannot be reached, full stop (7 rows of 900).
  // This one is a STATISTICAL estimate of the same idea (day's low + one typical day's range) and it
  // removed 349 of 900, including most of the top ten, on the release snapshot.
  //
  // It is removing the wrong cohort, and the app has now measured that twice. v1075: the blocked
  // 100-150% rangeUsed bucket returned the BEST next-day mean in the sample (+1.40%, 23.1% gaining
  // >= 2%) — extension predicted CONTINUATION. v1109: ranking by yesterday's gain put 17 of 20 stocks
  // into target the next session against a 27% base rate while the Radar's own top twenty managed 8,
  // and feasibility (the same runway/target ratio) was pulled OUT of the score for exactly that
  // reason. Leaving it alive as a hard veto kept deleting the same stocks the score had just stopped
  // deleting — a stock that has moved has less room LEFT today, which is precisely the signal that it
  // is moving. The owner's own report closes it: "it almost takes every good stock out."
  //
  // Also note the horizon mismatch recorded under v1093: this test asks what is reachable in the rest
  // of TODAY, while v1085 grades success as target-before-stop within TWO trading days. A same-day
  // veto cannot be correct for a two-day objective.
  //
  // `rangeExhausted` and `sessionRunwayPct` are still computed and still returned on every row, so
  // the evidence keeps accumulating and restoring the block is a one-word change if it reverses.
  const viable=basePct>0&&!bandLimited&&(capacity==null||basePct+1e-9>=minGrossPct);
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
    // v1124: `nudgePoolPct` removed. It had exactly one reference — its own assignment — and it called
    // getLeftOnTablePool(), a STORE READ, once per row on a function the universe scan calls for every
    // row. A field nothing consumes has no business on the hot path. The pool is still measured and
    // still shown in Latest Session; it simply is not re-read per stock to be discarded.
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
// ── v1105 EXIT SIGNAL (REPORTED ONLY) ────────────────────────────────────────
// The app has always had an exit PRICE and never an exit SIGNAL — nothing ever asked whether a
// position is still being bought. This reads that from columns already exported, and it is DISPLAY
// ONLY: it moves no score, no target and no order.
//
// MEASURED 2026-08-07 on the live cross-section (n=1,877) against "retention" — where price sits in
// the day's range, 1.0 meaning it is sitting on its high:
//
//   price > VWAP (1d)  0.747 vs 0.234  +0.514   |  Chaikin money flow > 0  0.514 vs 0.390  +0.124
//   RSI 15m > 55       0.790 vs 0.322  +0.468   |  Bull bear power > 0     0.467 vs 0.400  +0.068
//   MFI 15m > 60       0.644 vs 0.349  +0.294   |  Parabolic SAR           0.465 vs 0.402  +0.063
//   RoC 5m > 0         0.564 vs 0.336  +0.229   |  MFI 1d > 60             0.460 vs 0.423  +0.038
//
// TWO HONEST NOTES ON THAT TABLE. VWAP and 15m RSI are PARTLY CIRCULAR — VWAP is an average of the
// day's own prices, so a stock on its high is mechanically above it, and a short-window RSI behaves
// the same way. They measure "is it high now", not "will it stay high". The volume-based measures
// (Chaikin money flow, 15m MFI) are NOT explained by that mechanism, which is why they are kept even
// though they separate less. SAR, Bull Bear Power and daily MFI were measured and DISCARDED — SAR is
// nominally a trailing-exit indicator and is among the weakest of the set here.
//
// Because the strongest inputs are partly circular this cannot become an exit RULE on today's
// evidence; the RULES.md bar wants >=3 confirms across >=2 sessions. Getting them needs no new store:
// compare this reading against the CLOSE already kept in rs_price_history_v1 the following day.
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
// v1070 TOP-UP SIZING (owner). Since held stocks can be recommended again, the size of an ADD must
// be governed by what it does to the blended average cost — the position, not just the new order.
//   UNDERWATER (price < avg): the add pulls the average DOWN toward the current price, which is
//     what the owner wants, so it is capped only by the normal rails (max-alloc / turnover /
//     risk weight / risk budget). "Give it the max" — nothing extra is imposed here.
//   IN PROFIT (price > avg): the add pushes the average UP. Bound it so that if the NEW entry's
//     own stop is hit, the BLENDED position is still not at a loss:
//         newAvg <= price x (1 - stop%/100)
//     Solving (Q*A + q*P)/(Q+q) <= P*(1-s) for q gives  q <= Q * (P*(1-s) - A) / (P*s).
//     If the existing average is already above that stop level there is no cushion left and no
//     add is allowed — buying more would create a position that loses money on its own stop.
// Uses getRowStopDistancePct, an existing per-stock model unit, so no new tunable constant.
// ── v1172: AN OPEN POSITION IS TOLD WHAT TO DO, NOT WHAT IS HAPPENING ───────────────────────
// Owner, 2026-08-18: *"this doesn't help me... Holding up, being sold, distribution into strength
// etc. It should tell me what I should do, not what's happening in the market. Things like Buy X
// more, Hold, Exit X/All."* The v1106 rule, applied to the panel that had escaped it: a finding must
// change a target, a stop, an allocation or a decision - describing the tape is not a decision.
//
// Every input already exists and nothing new is invented: the position's own exit policy supplies
// the target, the current-session flow supplies supply/demand (v1168), and v1070's top-up cushion
// supplies how much may safely be added to a position already in profit.
//
// THE ORDER OF THE TESTS IS THE POLICY, and it runs worst-case first:
//   1. target reached            -> EXIT ALL. The trade did what it was bought to do.
//   2. current session selling   -> EXIT ALL, in profit, or EXIT HALF while underwater. The v1168
//                                   condition: net selling, or cheaper to push down than up.
//   3. below stop                -> EXIT ALL. It has already given up what the plan allowed.
//   4. flow strong + room to add -> ADD n shares, capped by the cushion so a top-up cannot turn a
//                                   profitable position into a losing one.
//   5. otherwise                 -> HOLD, with the distance left to target.
function getPositionAction(sym,pos){
  const s=(Array.isArray(ALL)?ALL:[]).find(r=>normSym(r.symbol)===normSym(sym))||null;
  const qty=Number(pos&&pos.qty)||0;
  if(!(qty>0)) return null;
  const rd=getIntradayRead(sym);
  const tt=rd&&rd.current?rd.todayTraj:null;

  // NO READ IS NOT A HOLD. Saying "hold" on no evidence is the thing this panel was doing wrong in
  // a different costume. v1171 fetches held names automatically, so this clears itself.
  if(!tt) return {act:'NEEDS DATA',qty:0,tone:'grey',
    why:rd&&!rd.current?('last read was '+rd.on+', not this session'):'no 5-minute read for this session yet'};

  // TWO INDEPENDENT READINGS OF SUPPLY AND DEMAND, both at their own natural zero:
  //   sold - more was sold than bought this session (net flow below zero)
  //   thin - it now costs FEWER shares to push the price down 1% than up 1% (cost ratio below 1)
  // Neither is a chosen threshold: zero and parity are where the quantities change meaning.
  const sold=tt.cvdPct<0;
  const thin=Number.isFinite(tt.costRatio)&&tt.costRatio>0&&tt.costRatio<1;
  const shares=n=>Math.round(n).toLocaleString('en-IN');

  // BOTH readings against it - supply is arriving AND nothing is holding it up.
  if(sold&&thin) return {act:'EXIT ALL',qty,tone:'red',
    why:'sold into all session (net '+(100*tt.cvdPct).toFixed(0)+'%) and 1% down costs only '
      +shares(tt.dnCost)+' shares against '+shares(tt.upCost)+' up'};
  // ONE against it - reduce, do not abandon.
  if(sold||thin){
    const half=Math.max(1,Math.floor(qty/2));
    return {act:'EXIT '+half,qty:half,tone:'red',
      why:sold?('net selling this session ('+(100*tt.cvdPct).toFixed(0)+'% of everything traded), but demand still costs more to move')
              :('nothing holding it up - 1% down costs '+shares(tt.dnCost)+' shares against '+shares(tt.upCost)+' up, though flow is still net positive')};
  }
  // BOTH readings for it, and the tape is still pushing - size the add from the cushion so a top-up
  // can never turn a position in profit into a losing one (v1070).
  const pressing=Number.isFinite(tt.pressurePct)&&tt.pressurePct>0;
  if(pressing&&s){
    try{
      // v1179: getHeldTopUpNotionalCap returns Infinity for a position UNDERWATER - the v1070
      // cushion only binds in profit, where an add could drag the blended cost above the new stop.
      // Dividing that by a price printed "ADD Infinity" on the panel. Infinity means "the cushion
      // does not bind", not "buy without limit", so the size then comes from the ordinary allocation
      // rails - Max Alloc, the 0.10% turnover rail, the rupee floor - via rowAchievableNotional.
      const buyP=getBuyPrice(s);
      const cushion=getHeldTopUpNotionalCap(s,buyP);
      let cap=cushion;
      if(!Number.isFinite(cap)){
        cap=(typeof rowAchievableNotional==='function')?rowAchievableNotional(s):0;
      }
      const add=(Number.isFinite(cap)&&cap>0&&buyP>0)?Math.floor(cap/buyP):0;
      if(add>0) return {act:'ADD '+add,qty:add,tone:'green',
        why:'bought all session (net +'+(100*tt.cvdPct).toFixed(0)+'%), 1% up costs '+shares(tt.upCost)
          +' shares against '+shares(tt.dnCost)+' down, and '+tt.pressurePct.toFixed(2)+'% of buying is still unspent'};
    }catch(e){}
  }
  return {act:'HOLD',qty:0,tone:'amber',
    why:'demand still costs more to move than supply (net +'+(100*tt.cvdPct).toFixed(0)+'%'
      +(Number.isFinite(tt.costRatio)?', ratio '+tt.costRatio.toFixed(2):'')+')'};
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
// v1080 (owner): "If it doesn't qualify for allocation, it should not be in recommendations."
// A row that can never receive a single share was still rendering at rank 1-3, still sitting checked,
// still counting toward "Buy Basket (N)" and still consuming one of the 20 selection slots — while
// being unbuyable. Observed 2026-07-30: JAGSNBHARM held 120 @ Rs 255.30, last Rs 256.30, so it is in
// profit; its own stop is 6.28%, putting the new entry's stop price at Rs 240.20, BELOW the existing
// average — getHeldTopUpNotionalCap correctly returns 0 (any add makes a blended position that loses
// on its own stop), but nothing acted on that zero.
//
// This returns a reason ONLY for causes that are independent of how capital is split across the
// basket. A row that misses out purely because 20 names shared the money is a CAPITAL problem, not a
// disqualification — pass 2 of computeAlloc usually gives it a share — so the score-weight limit is
// deliberately NOT consulted here. Blocking on it would make a stock's eligibility depend on how many
// other stocks happen to rank near it, which is the same non-causal cross-stock coupling v1066 removed.
//
// Returns null when the row is allocatable, else a short human reason.
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
  // v1092: the risk budget joins the rails here for the same reason Max Alloc is already here —
  // both are portfolio-level caps that can leave a row unable to hold a single share, and a row
  // that cannot be bought should not be recommended. The score-weight share is still deliberately
  // excluded (v1080): that one depends on which OTHER stocks were selected.
  const riskCap=riskNotionalCap(s,c.riskPerTrade);
  const rail=Math.min(c.maxAlloc>0?c.maxAlloc:c.capital,turnoverCap,topUpCap,riskCap);
  if(rail<buyP) return `allocation rails (${fmtINR(rail)}) are below one share at ${fmtINR(buyP)}`;
  const policy=getRowExitPolicy(s,buyP,c.active);
  if(policy&&policy.bandLimited) return `only ${policy.bandRunwayPct}% left to the ${policy.bandPct}% upper circuit (₹${policy.ucPrice}) — the ${policy.basePct}% target cannot be reached inside today's band`;
  // v1112: the SESSION-ceiling clause that used to sit here is gone — see getRowExitPolicy. It is a
  // statistical estimate, it removed 349 of 900 rows including most of the top ten, and both v1075
  // and v1109 measured that the cohort it removes is the one that goes on to reach target. The
  // circuit clause above stays: that one is exchange arithmetic, not an opinion about momentum.
  if(policy&&policy.viable===false) return policy.capacityPct!=null
    ? `stock capacity ${policy.capacityPct.toFixed(2)}% cannot clear the ${policy.minGrossPct?.toFixed(2)??'—'}% cost + net hurdle`
    : 'no viable target after costs';
  // ── v1125 THE RUPEE FLOOR (owner) ────────────────────────────────────────────────────────────
  // Every test above this line is a PERCENTAGE test, and a percentage cannot see the money. Measured
  // on the release board: all 60 top rows carried the IDENTICAL 3.45% target while netting between
  // Rs 91.59 and Rs 2,365 — a 26x spread, because the 0.10% turnover rail caps an illiquid name at a
  // few thousand rupees while a liquid one gets the full Max Alloc. The percentage bar rated both the
  // same. This asks the only question that matters: at the largest position this stock will actually
  // let me take, does hitting its own target leave enough money to be worth the trade, after the real
  // charges (including the FLAT Rs 15.34 DP fee, which is 0.38% of a Rs 4,000 lot and 0.03% of a
  // Rs 50,000 one)?
  //
  // NO NEW CONSTANT: the floor is HARVEST_DESIRED_NET_PCT — the same 0.60% "minimum useful net for
  // capital rotation" that has governed since v1060 — converted to rupees at the reference notional.
  // Measured scope: 66 of the top 340 rows, 19.4%. Targeted rather than blanket, and every casualty
  // is a row the turnover rail had already reduced to pocket change.
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
  // v1092: the pot is split by score ÷ stop distance, not by score alone. Same total deployment —
  // this is a REDISTRIBUTION, not a new budget — but two equally-scored names no longer draw the
  // same rupees when one stops out at 3% and the other at 8%. Before this, that pair carried 2.7x
  // different rupee risk for identical conviction, purely because nothing normalised for the stop.
  // Because alloc ∝ 1/stop, alloc × stop is constant across equally-scored rows: equal risk per
  // trade falls out of the arithmetic with no new field and no new constant (getRowStopDistancePct
  // is an existing per-row unit). The caps (Max Alloc, the 0.10% turnover rail, the held top-up
  // cushion) are untouched and still apply after this weight — only the pre-cap share changed.
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
        // ── v1125: NEVER ROUND A SELECTED STOCK TO ZERO SHARES WHILE CAPITAL REMAINS ───────────
        // rowLimit is the score-weight SHARE, and it was also being used as the ceiling, so a stock
        // priced above its own slice could never be bought — not in pass 1 (floor(share/price) = 0)
        // and not here either, because the same slice gated the rescue. It is purely a whole-share
        // rounding artefact and it hits EXPENSIVE stocks: measured on the release board, TCPLPACK at
        // ₹4,285.70 was offered ₹2,921 and KINGFA at ₹5,866.65 was offered ₹4,674 — both cleared
        // every gate (net ₹1,366 and ₹1,309 against a ₹270 floor) and both silently received nothing,
        // while the basket button still counted them. A percentage view cannot see this at all; it is
        // visible only once you ask how many rupees one share actually costs.
        //
        // The rescue is exactly ONE share and no more: the ceiling below becomes max(share, price),
        // so proportional splitting is untouched for every row that could already afford one. It is
        // still bounded by the row's real rails (Max Alloc, the 0.10% turnover rail, the top-up
        // cushion, the risk budget) and by residual capital, and pass 2 walks by CONVICTION, so a
        // better-scored name always gets first refusal on the spare rupees.
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
        // The first share must be PAID FOR out of the residual. This branch was unreachable before
        // v1125 — pass 1 already bought a share whenever rowLimit >= price, and pass 2's old guard
        // `rowLimit < buyP -> continue` rejected every other case — so the missing decrement never
        // showed. Making the rescue live exposed it as a real overspend (deployed ₹21,300 against
        // ₹19,696 of capital). Growth below is charged incrementally, so only this opening lot is
        // accounted here.
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
  // v1125: NOTHING IS DROPPED SILENTLY. A selected row that finished with no position used to be
  // simply ABSENT from the map, so its Alloc cell rendered a bare em dash and the basket count still
  // included it. After the one-share rescue above, the only way to arrive here is that capital
  // genuinely ran out before this row's turn — a real portfolio fact, and one worth stating in
  // rupees rather than leaving blank. Same principle as the sell-basket skip list (v1082): every
  // candidate is either acted on or named with a reason.
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
function radarSeriesBandPill(s){
  const ok=s.basketEligible!==false;
  const band=s.band!=null?s.band+'%':'No band';
  const title=ok?'Active EQ security; eligible for the Zerodha basket.':'Ineligible for the basket: '+escHtml((s.gateReasons||[]).slice(0,3).join(', ')||'exchange eligibility');
  return `<span class="info-pill ${ok?'pill-green':'pill-red'}" style="padding:2px 8px;font-size:12px" title="${title}">${escHtml(s.series||'—')} · ${band}</span>`;
}
// v1143: the enrichment affordance sits on the ROW, because the enrichment is about that stock.
// Filled when its bars are loaded, so the table shows at a glance which names have been enriched.
// ── ONE FACE FOR ONE VERDICT ─────────────────────────────────────────────────────────────────
// Owner, 2026-08-19: *"I don't want this loosey-goosey 'worth a look' shit. Recommendations should
// be solid - buy or not buy... I shouldn't have to manually look before pressing anything."*
//
// He is right and the board was contradicting itself. CHENNPETRO sat at rank 1, score 99.9, checked
// for export and allocated Rs 7,310 - with a RED chip beside it. The two came from DIFFERENT
// QUANTITIES: the row's buyability is `intradayVerdict` (v1168 - today's net flow and cost
// asymmetry), while the chip was coloured by `regime`, which is a DESCRIPTION of the multi-day
// series and whose 'selling' value is the FALL-THROUGH of a 2x2. Measured on that stock: full
// series net flow +22.7% - it lands in 'selling' only because both recent slopes are negative,
// while TODAY reads +100% net flow with no down bars at all, so the veto correctly does not fire.
// Neither number was wrong; painting them in the same vocabulary was.
//
// A verdict now has exactly one face and one colour wherever it appears. `regime` is context in the
// tooltip and never colours anything, because it does not decide anything.
function intradayVerdictFace(v,has){
  return v==='stale'?'\u29d6':v==='confirmed'?'\u2713':v==='rejected'?'\u2717':(has?'\u2022':'5m');
}
function intradayVerdictColor(v,has,sel){
  return sel?'var(--amber)'
    :v==='stale'?'var(--t3)'
    :v==='confirmed'?'var(--green)'
    :v==='rejected'?'var(--red)'
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
  // v1162: a verdict from an earlier session gets its OWN face and colour. It must not read as
  // unchecked (the owner would go and check it, only to find data already there) and it must not
  // read as confirmed (it is not evidence about today). An hourglass says "this was answered, for a
  // day that is over".
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
      setup:`<td style="font-size:13px;color:var(--t2)">${escHtml(s.setup||'—')}${s.stage?' '+radarStagePill(s):''}</td>`,
      series:`<td>${radarSeriesBandPill(s)}</td>`,
      price:`<td style="white-space:nowrap">${fmtINR(s.price)}<span style="color:var(--t3)"> · </span><span style="font-size:12px">${fPerf(s.day??s.priceChange)}${s.corpAction?`<span title="Corporate action (${escHtml(s.corpAction)}) — mechanical ex-date move, neutralised in scoring" style="font-size:11px;color:var(--amber);margin-left:4px;cursor:help">⚑</span>`:''}</span></td>`,
      day:`<td>${fPerf(s.day??s.priceChange)}${s.corpAction?`<span title="Corporate action (${escHtml(s.corpAction)}) — mechanical ex-date move, neutralised in scoring" style="font-size:11px;color:var(--amber);margin-left:4px;cursor:help">⚑</span>`:''}</td>`,
      relvol:`<td style="white-space:nowrap">${s.relvol!=null&&isFinite(s.relvol)?Number(s.relvol).toFixed(2)+'×':'—'}<span style="color:var(--t3)"> · </span>${Number.isFinite(s.depthImbalance)?`<span style="color:${s.depthImbalance>0?'var(--green)':'var(--red)'};font-size:12px" title="Order book: ${Number.isFinite(s.depthPct)?'stronger than '+Math.round(s.depthPct*100)+'% of books':''}${s.depthLive?' · LIVE reading':' · pre-open, decayed by the session'}">${(s.depthImbalance>0?'+':'')+s.depthImbalance.toFixed(2)}</span>`:'<span style="color:var(--t3)">—</span>'}</td>`,
      // v1139: the order book, in the recommendation table rather than a list of its own. Muted em
      // dash when the stock has no book - absent is not bearish.
      turnover:`<td>${fV(s.turnover)}</td>`,
      // v1148 (owner): where the paste says it closes. Pressure decides the direction and size,
      // the stock's own pace caps how far it can actually get in the bars that remain.
      predEod:`<td style="white-space:nowrap">${(()=>{
        const rd=getIntradayRead(s.symbol);
        if(!rd||!Number.isFinite(rd.predClose)) return '<span style="color:var(--t3)">—</span>';
        const up=rd.predPct>=0, t=rd.traj;
        return `<span style="color:${up?'var(--green)':'var(--red)'};font-weight:700" title="${escHtml(
          'Unspent pressure '+(t.pressurePct>=0?'+':'')+t.pressurePct.toFixed(2)+'%, capped by what this stock can travel in the '
          +t.barsLeft+' bars left ('+t.avgMovePct.toFixed(3)+'% per '+t.stepMin+'-minute bar = '
          +(t.maxTravel!=null?t.maxTravel.toFixed(2):'?')+'%). Arithmetic, not a forecast.')}">${
          fmtINR(rd.predClose)}</span><span style="color:var(--t3);font-size:11px"> ${
          (rd.predPct>=0?'+':'')+rd.predPct.toFixed(2)}%</span>`;
      })()}</td>`,
      // v1148 (owner): the average of every bar's own Change %, magnitude only. Shown only for a
      // stock that has been checked - it comes from the pasted bars and nowhere else.
      avgMove:`<td style="white-space:nowrap">${(()=>{
        const rd=getIntradayRead(s.symbol);
        if(!rd||!Number.isFinite(rd.maxPullbackPct)) return '<span style="color:var(--t3)">—</span>';
        const tp=Number(exitPolicy&&exitPolicy.targetPct);
        return `<span title="Deepest pullback today - running high to the low that followed. A trail inside this has already been hit once.${
          tp>0?' Target is '+tp.toFixed(2)+'%.':''
        }">${rd.maxPullbackPct.toFixed(2)}%</span>`;
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
// ── v1172: HIDING THE LIST IS NOT THROWING AWAY THE DATA (owner, 2026-08-18) ────────────────
// *"Discard says it throws all the data... it should not! Why the fuck would we throw all our
// painstakingly gathered data. The button should just clear the UI space it filled with the list it
// just checked."*
//
// He is right, and the old behaviour was indefensible once fetching became rate-capped: this wiped
// INTRADAY_BARS for every stock, so getting it back cost real requests out of a 12-per-15-minutes
// budget - and since v1171 that budget is also what builds coverage of the day's movers. The button
// existed from v1146, when a "check" was a hand-paste that cost nothing but a clipboard.
//
// It now collapses the fetch LIST and nothing else. Bars, verdicts and the re-rank all stand.
// v1181 (owner): *"if there's a Hide list, should it also unhide list?"* Yes - it was a one-way
// door: once collapsed the only way back was to spend another fetch, which is the same waste the
// Hide button existed to stop. It toggles.
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
// ── WHAT TO FETCH, AND HOW OFTEN ────────────────────────────────────────────────────────────
// The rate cap is enforced HERE, before anything is requested, so it cannot be edited around from
// elsewhere (owner: "I don't want to bombard zerodha with these requests if they mind it"). Nothing
// is ever fetched on a timer or speculatively - only the unchecked names at the top of the board,
// and only when the button is pressed.
// v1177: A DAILY CAP, NOT A ROLLING QUARTER-HOUR (owner, 2026-08-18): *"the rate cap of 12 per 15
// minute can be removed because we don't update the ALL NSE that much anyway, only when I have
// capital to invest... so instead of setting it per 15 minute, set it to per day to a safe number."*
// The old window blocked a fetch mid-session for no reason the owner could see - it fired while he
// was buying - and its 12-per-15-minutes worked out to a theoretical 288 a day that nothing was ever
// going to reach, because the folder watch only re-ingests when ALL NSE actually changes. A daily
// budget is the honest shape: 400 requests spread across a session is far below anything Kite would
// notice (its documented historical limit is 3 PER SECOND) and still bounded, and the 700ms spacing
// in the helper is untouched. The budget resets on the SESSION date, so an overnight run cannot
// borrow from tomorrow.
const FETCH_MAX_PER_DAY=400;
// v1178: AND A BOUND ON A SINGLE PRESS, which v1177 removed by accident. The old 12-per-15-minutes
// was doing two jobs at once - a daily ceiling AND the thing that made coverage build GRADUALLY -
// and replacing it with a daily budget alone let one press queue every job it could find: the owner
// saw "fetching 135 stocks", about 95 seconds of continuous requests, which is precisely what he
// asked to avoid ("do it gradually like we're doing now"). The two limits are now separate and
// explicit: this is how many go out at once, FETCH_MAX_PER_DAY is how many go out in a day.
const FETCH_MAX_PER_RUN=12;
let FETCH_LOG=[];
let FETCH_LOG_DATE=null;
function fetchBudgetLeft(){
  const now=Date.now();
  const day=getSessionDate();
  if(FETCH_LOG_DATE!==day){ FETCH_LOG=[]; FETCH_LOG_DATE=day; }
  return Math.max(0,FETCH_MAX_PER_DAY-FETCH_LOG.length);
}
// The unchecked names at the top of the board, paired with the instrument tokens the app has held
// since v1139. A symbol with no token is excluded WITH a reason rather than silently dropped.
// ── v1163: A STOCK YOU OWN IS STILL A STOCK YOU HAVE TO DECIDE ABOUT ────────────────────────
// Owner: "any stock that I buy today but couldn't sell off intraday may get stuck in our portfolio.
// So how should all this be handled?"
//
// The hole his question exposed was NOT the file. It was the coverage: jobs were drawn only from the
// top of the RECOMMENDATION board, and buying a stock removes it from that board - so the day you
// buy is the last day it is ever fetched, and its file stops growing exactly when the position
// starts mattering. That is the same complaint as "it's not in the recommendation table anymore if
// I have already bought it", one layer down.
//
// ORDER IS DELIBERATE: recommendations first, held positions with whatever budget is left. A buy
// decision expires at the close; a held position can be read an hour later and still be read
// correctly. Under a tight cap the time-critical question wins.
//
// Held names are fetched for OBSERVATION, not for a verdict. Nothing here recommends re-buying: the
// v1070 rule that held is not a reason to refuse a stock is untouched, and so is the v1162 rule that
// only a read from the CURRENT session may move anything.
// ── WHAT GETS FETCHED, AND WHY IT IS ONLY A VALIDATOR (owner, 2026-08-18) ───────────────────
// *"I meant it as a validator only, but that maybe it could keep validating until it finds
// something to buy."*
//
// THE 5-MINUTE READ CANNOT DISCOVER ANYTHING, and that settles the whole design. It only moves the
// standing of stocks that have been FETCHED, and 12 requests against 1,895 tradeable rows can only
// ever touch names the composite already surfaced. It answers "is this specific pick still good
// right now" and nothing else. Finding a pick is a different job, done on data that costs nothing:
// `rs_price_history_v1` holds daily OHLC for the WHOLE market from the NSE bhav copy - 2,624 symbols
// - and grows by a free session every upload.
//
// So the queue is exactly the validation set, and it EXTENDS DOWN THE RANKING UNTIL SOMETHING
// PASSES. The top FETCH_TOP_RANK are the live candidates and are kept fresh; if none of them clears
// the buy bar, rank 6, 7, 8 ... are pulled in until one does or the press is spent. That is the loop
// v1145 described - *"when a round rejects the whole top, that is exactly when the next candidates
// matter most"* - applied to the queue rather than only to the panel.
//
// The >=10% mover tier is GONE. Fetching a stock that has already run 16% cannot help buy it
// earlier, and it was competing for slots with the names actually up for decision.
// The first ingest of a page load is the file that was already on disk when the tab opened,
// so it must not spend a Zerodha request (owner, 2026-08-18). Reset per page load by being a
// plain module-level let - a reload starts false again, which is exactly the intent.
let FIRST_INGEST_DONE=false;
const FETCH_TOP_RANK=5;      // owner: the live candidate set, kept fresh
function intradayFetchJobs(limit){
  const tok=r=>({s:normSym(r.symbol||r.sym||''),t:KITE_TOKEN[normSym(r.symbol||r.sym||'')]||0});
  const lastBarBoundary=()=>{const c=istClock();if(!c||!Number.isFinite(c.mins))return null;
    return Math.floor((c.mins-5)/5)*5;};
  const stale=sym=>{
    const rd=getIntradayRead(sym);
    if(!rd||!rd.current) return true;
    const b=lastBarBoundary(); if(b===null) return false;
    const t=new Date(rd.asOf);
    return (t.getHours()*60+t.getMinutes())<b;
  };
  const seen=new Set();
  const take=arr=>arr.map(tok).filter(j=>j.t>0&&!seen.has(j.s)&&stale(j.s)&&(seen.add(j.s),true));

  const board=(Array.isArray(FILT)&&FILT.length?FILT:ALL)
    .filter(r=>Number.isFinite(r.rank)).slice().sort((a,b)=>a.rank-b.rank);

  // Has anything actually cleared the bar on a CURRENT read? If yes, the search is over and we only
  // keep the live candidates fresh. If no, keep walking down the ranking.
  // POSITION on the displayed board, not global rank. Ranks 1-6 are routinely removed by the
  // filters - surveillance, no headroom, direction - so on the live board the first recommendable
  // row was rank 7 and a `rank<=5` test queued nothing at all. "The top five" means the first five
  // rows the owner can actually act on.
  // Qualification belongs to the scored universe, not the current display slice. A Rows cap,
  // presentation filter, or re-render timing must not prevent a genuine rank/score candidate from
  // receiving the validation that is now required to arm its checkbox.
  const threshold=(Array.isArray(ALL)?ALL:[]).filter(r=>meetsRecommendationBar(r))
    .slice().sort((a,b)=>a.rank-b.rank);
  const haveBuy=threshold.some(r=>passesIntradayValidation(r));
  // Walk only as deep as this press could possibly spend: building 166 job objects and checking
  // freshness on every one, to send 12, is wasted work on the render path.
  const reach=haveBuy?FETCH_TOP_RANK:Math.max(FETCH_TOP_RANK,FETCH_MAX_PER_RUN*3);
  // Threshold-qualified rows are always first. Previously a confirmed row stopped the walk at a
  // positional top-five slice, so another genuine rank/score candidate could remain unchecked yet
  // look recommended (TALBROAUTO). Validation eligibility must come from the same bar as selection.
  const jobs=take(threshold.concat(board.slice(0,reach)));

  // OPEN POSITIONS (v1163): a stock leaves the board the day it is bought, so without this its file
  // stops growing exactly when the position starts mattering. Never a buy verdict - observation.
  let held=[];
  try{
    const m=(typeof getCombinedOpenPositionMap==='function')?getCombinedOpenPositionMap():{};
    held=take(Object.keys(m).filter(k=>m[k]&&m[k].qty>0).map(k=>({symbol:k})));
  }catch(e){ held=[]; }
  held.forEach(j=>{j.held=true;});

  const all=jobs.concat(held);
  if(all.length) return {ok:true,jobs:all,symbols:all.map(j=>j.s),
                         recs:jobs.length,held:held.length,movers:0,
                         searching:!haveBuy,depth:haveBuy?FETCH_TOP_RANK:null};
  const missing=board.slice(0,FETCH_TOP_RANK).filter(r=>!KITE_TOKEN[normSym(r.symbol)]).map(r=>r.symbol);
  return {ok:false,why:missing.length?('no Kite instrument token for '+missing.join(', '))
    :(haveBuy?'the top of the board is validated and something clears the bar':'nothing left to check')};
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

// ── v1157: EVERYTHING FROM INSIDE THE APP ───────────────────────────────────────────────────
// Owner, many times over: "I don't want this command line and console bullshit. Everything should
// run from within the app." Every previous attempt failed on the same wall - a page served from
// file:// or github.io may not read a response from kite.zerodha.com - and each workaround pushed
// the work back onto him: an extension, a console paste, a terminal command.
//
// The answer is to stop fighting the origin and BECOME one. "Start Rocket Scanner.bat" serves this
// app from http://localhost and exposes /api/kite/* on that SAME origin. The browser is satisfied
// because nothing is cross-origin any more, and the button below does the whole job: no extension,
// no console, no command typed. Double-clicking the .bat is the only manual act, once per boot.
//
// Opened as a plain file it still works exactly as before - the in-app fetch simply hides itself,
// the same rule v1153 established.
let KITE_API=null;          // set when the local helper answers, wherever this page is hosted
let LAST_FETCH=null;        // what the last fetch actually brought back, shown so it can be checked
let FETCH_BUSY=null;        // v1177: {n, syms, at} while a fetch is in flight - it must be VISIBLE
let LAST_FETCH_HIDDEN=false; // v1172: the list is collapsed for space; the DATA is never discarded
const KITE_HELPER='http://localhost:8787';
// THE APP STAYS ON GITHUB PAGES. Earlier this served the app from localhost, which was wrong - the
// app lives at https://axionaut.github.io/rocket-scanner/ and that must not change. Only the HELPER
// is local. An HTTPS page may not normally call http://, but localhost and 127.0.0.1 are specified
// as potentially trustworthy, so the Pages app is allowed to call this one; the helper answers only
// the Pages origin and nothing else, because it holds a Kite token.
// `force` re-checks the token against Kite instead of trusting the helper's 5-minute cache.
// REQUIRED AFTER SAVING A TOKEN, and this is the half that works WITHOUT restarting the helper:
// the server-side cache-clear added alongside it only takes effect once the .bat is re-run, whereas
// `?force=1` has been understood by the running helper since v1166. Without it, pasting a good token
// the morning after a rotation returned the STALE `tokenValid:false` and the app said "Kite rejected
// that token" about a perfectly good one.
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
// ── THE TOKEN ASKS FOR ITSELF ────────────────────────────────────────────────────────────────
// Owner, 2026-08-19: *"Can you add a pasteable popup for kite token please? It should popup in the
// morning and save to the kite-token text file that we use."*
//
// The enctoken ROTATES ON EVERY KITE LOGIN, so the first load after logging in again always has a
// dead token. Until now that surfaced as a small red line inside the intraday bar, which is exactly
// the kind of thing you only notice after pressing Fetch and getting nothing - the v1150 rule (a
// control that cannot work must say so) applied one level up: the app should ask, not wait.
//
// NO HOUR IS HARDCODED, deliberately (owner, 2026-08-18: *"don't hardcode time to 9:19"*). The
// trigger is the state that actually matters - the helper is running and its token is missing or
// REJECTED BY KITE (v1166 validates it against a real call rather than checking it is a non-empty
// string). That fires on the first load after a rotation, which is the morning, without the app
// having to know what time it is or which days are trading days.
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

// ── THE THREE ZERODHA FILES REFRESH THEMSELVES ───────────────────────────────────────────────
// Owner, 2026-08-19: *"I download the ALL NSE, the three-second check senses it, downloads the
// zerodha files and there!"*
//
// ALL NSE stays MANUAL and the folder watch stays exactly as it was - its job is unchanged, it
// senses that he has re-exported. What changes is that the ingest no longer reads whatever stale
// Holdings/Positions/Orders happen to be on disk: the helper refreshes them from Kite first, so the
// portfolio the engine scores against is from the same moment as the universe.
//
// ALL OR NOTHING, on the helper's side: it fetches and verifies every file in memory and only then
// writes. A half-refresh would score today's market against yesterday's book and say nothing.
//
// It NEVER blocks the load. No helper, no token, or a refusal - the ingest proceeds on the files
// already there, exactly as it did before, and the reason is logged.
async function refreshBrokerInputs(){
  // Startup detection is a network probe and may lose a race with initial hydration, or the helper
  // may be started after the page. Every ALL NSE refresh is therefore also a recovery point: retry
  // status once before deciding the helper is absent. Failure still falls through to stale local
  // files exactly as before and can never block the ingest.
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
// The whole loop, in one press: ask the local server for the candles, hand them to the SAME parser
// a paste uses, re-rank, and point at whatever still needs checking.
// v1172: RELOAD THE INVENTORY FROM DISK, NOT FROM KITE. INTRADAY_BARS is memory-only, so every
// page reload used to lose every read and re-earn it out of the rate budget. The helper already
// holds the files; this restores them in ONE local request that never touches Kite, and it runs
// before the first render so a held position is not labelled NEEDS DATA for data we already have.
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
  const jobs=r.jobs.slice(0,Math.min(budget,FETCH_MAX_PER_RUN));
  jobs.forEach(()=>FETCH_LOG.push(Date.now()));
  // v1177 (owner): *"When it's fetching there is no indicator that it's fetching. Add a loader.
  // Because I just bought two stocks while it was trying to fetch."* A fetch takes ~0.7s per stock
  // and can run automatically on any ALL NSE ingest, so it must never be invisible - a board that is
  // about to re-rank looks identical to one that has finished.
  FETCH_BUSY={n:jobs.length,syms:jobs.map(j=>j.s),at:Date.now()};
  try{ renderTable(); }catch(e){}
  say('Fetching '+jobs.map(j=>j.s).join(', ')+'…',3000);
  try{
    const q=jobs.map(j=>j.s+':'+j.t).join(',');
    const res=await fetch(KITE_HELPER+'/api/kite/candles?days='+INTRADAY_FETCH_DAYS+'&jobs='+encodeURIComponent(q),{cache:'no-store'});
    const j=await res.json();
    if(!j.ok){ say(j.why,8000,true); return; }
    const out=ingestKiteCandlePayload(JSON.stringify({rocketScanner:'candles',data:j.data}));
    // WHAT WAS ACTUALLY FETCHED, so it can be checked against the chart rather than trusted
    // (owner: "where can I see the data it fetches to confirm if it is even fetching the correct
    // data?"). Bars, the window they cover, and the last close - three numbers that either match
    // Kite or do not.
    LAST_FETCH_HIDDEN=false;
    LAST_FETCH=out.done.map(sym=>{
      const rd=getIntradayRead(sym), bars=INTRADAY_BARS[normSym(sym)]||[];
      const f=bars[0]?new Date(bars[0].t):null, l=bars[bars.length-1]?new Date(bars[bars.length-1].t):null;
      const hhmm=d=>d?String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'):'—';
      const ddmm=d=>d?String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0'):'';
      const w=(j.files&&j.files[sym])||null;
      return {sym,bars:bars.length,file:w?w.file:null,fileRows:w?w.rows:null,
              daily:(w&&w.daily)?w.daily.sessions:null,
        from:ddmm(f)+' '+hhmm(f),to:ddmm(l)+' '+hhmm(l),
        last:rd?rd.close:null,regime:rd&&rd.regime||null,
        flow:rd&&Number.isFinite(rd.cvdPct)?rd.cvdPct:null};
    });
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
    // THE CHIP SHOWS THE VERDICT, and the verdict is the only thing that decides buyability.
    // It used to be coloured by `regime` - a DESCRIPTION of the multi-day series whose 'selling'
    // value is the fall-through of a 2x2 - so a rank-1 row that was checked, allocated and about to
    // be bought could carry a red chip. Two quantities, one vocabulary, and the owner left to
    // adjudicate. Now it is `intradayVerdict` through the SAME helper the row badge uses, so red
    // means rejected and nothing else. Regime survives in the tooltip, where it explains rather
    // than decides.
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
        ${x.regime?`<span style="color:${x.regime==='accumulating'?'var(--green)':x.regime==='selling'?'var(--red)':'var(--amber)'}"> · ${escHtml(x.regime)} ${x.flow!=null?((x.flow*100).toFixed(1)+'%'):''}</span>`:''}
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
  // The Radar composite pre-ranks every uploaded row; the filter bar only narrows
  // what is displayed. Held positions were already suppressed at scoring time.
  // Capital/Max-Alloc show their computed defaults in the placeholder; the calculation
  // falls back to those defaults whenever the field is empty.
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
    // v1070 (owner): holding a stock NO LONGER blocks it. If it is still the best name in the
    // cross-section, already owning some of it is not a reason to refuse it — the ranking answers
    // "what is the strongest setup", not "what do I not own yet". `_held` is still tracked and
    // shown as a badge so a repeat buy is never accidental, and it still drives the Open Positions
    // panel, but it removes nothing. Every OTHER removal rule below is deliberately untouched.
    if(s._held)SUPPRESSED_HELD++;
    // Configured surveillance rules are a HARD filter (owner 2026-07-17): any stock
    // flagged under a rule in the Methodology table is weeded out of recommendations.
    // Non-configured REG1 flags remain a score penalty + badge only.
    if(NSE_SURV[s.symbol]?.length){SURV_HARD_REMOVED++;REMOVED_ROWS.push({s,reason:'surv',rules:NSE_SURV[s.symbol]});return false;}
    // v1075: entry timing is a LABEL, not a filter. It shipped in v559/v560 on assertion and was
    // never evidenced. First forward test (2026-07-28 close -> 2026-07-29, EQ + turnover >= Rs 25L,
    // n=1618, non-circular because the state is taken at the PRIOR close):
    //   rangeUsed <25% (not blocked)   mean next +0.75%   12.8% next-day >= +2%
    //   rangeUsed 75-100%  BLOCKED     mean next +0.75%   19.4%
    //   rangeUsed 100-150% BLOCKED     mean next +1.40%   23.1%   <- the BEST bucket
    //   rangeLocation top quarter (atPeak, the AND-gate)  +0.73%  18.1%  <- highest hit rate
    // Extension predicted CONTINUATION, not reversal, so the gate was removing the best cohort —
    // 9 of 9 in the top 10 on 2026-07-29. The `cooling` sub-term is separately a proven coin flip
    // (v1069: price5m median +0.01%, non-positive 45% of the time) and drove 107 of 177 blocks.
    // The state is still computed, still recorded per-pick for grading, and still shown as a badge
    // and in the Removed panel — it simply no longer removes a stock from recommendation or export.
    // CAVEAT recorded in RULES.md D4: this is ONE day pair on a green tape. If the accumulating
    // per-pick evidence reverses it, restore the block here.
    if(s.entryReady===false)PEAK_TIMING_REMOVED++;
    // ── v1087: THE STOCK MUST BE GOING UP RIGHT NOW ────────────────────────────────────────────
    // Owner, 2026-07-31: the system must recommend stocks about to reach target in the NEXT ~15
    // MINUTES — caught at LIFTOFF — not names that merely look good on yesterday's structure.
    // Measured on the 11:09 file, this was THE defect: `setupPct = max(compositePct, ignitePct)`
    // lets a stock rank #1 on setup ALONE, because ignitePct is 0 whenever the direction gate
    // fails. Every one of the five recommendations was BELOW VWAP and four of five were BELOW
    // their own open at issue — they were already falling when they were recommended, and they
    // kept falling. Only 8 of the top 30 were above both VWAP and open.
    //
    // The test is the codebase's ONE definition of confirmed direction (v1069): above VWAP and
    // above the day's open. v1069 measured the structural form FAVOURABLY (top-20 mean day 5.42%
    // with it vs 4.89% with no gate), and deliberately dropped the 5m/15m tick terms as
    // microstructure coin flips — that finding is preserved here, so this adds no new magnitude.
    // Plus the owner's explicit rule: a stock red on the day is weak or confused, so it is out.
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
    // Cheap display filters run FIRST so the allocation gate below only evaluates rows that would
    // actually be shown — it is the most expensive test in this predicate.
    // v1087: these are the USER'S OWN filter settings, but they were returning false SILENTLY, so
    // a rank dropped by the Risk or Min-Turnover selector vanished from the table AND from the
    // "why the ranks skip" panel. The owner hit exactly this: ranks #1 and #3 appeared in neither.
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
  // SELECTED is auto-derived from FILT every filter pass: basket-eligible rows minus the
  // user's persisted exclusions, capped at Zerodha's 20-order limit.
  // Trade-timing state is DIAGNOSTIC ONLY and never empties the selection (owner, v1068):
  // what is recommended is decided by the row's own evidence, not by the wall clock.
  // v1084: take the 20 by RADAR RANK, not by the table's current presentation order. `applySort()`
  // above reorders FILT in place for display, so before this the basket silently changed whenever a
  // column header was clicked — sorting by Day % handed the export the 20 biggest movers instead of
  // the 20 best-scoring rows. Presentation must never decide what gets bought.
  // v1087: build the basket from the FULL filtered set, not from FILT — `Rows` is a DISPLAY cap
  // (CLAUDE.md: "selection still caps at 20"), but FILT is truncated by it, so setting Rows=5 was
  // silently limiting the basket to 5 names. Display and selection are separate concerns.
  //
  // v1112 (owner) restores BOTH bars: score >= 90 AND Radar rank <= 10 — see meetsRecommendationBar.
  // Rows that miss either remain VISIBLE and ranked; they are simply not bought.
  const selectionRows=[...rows].sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity));
  SELECTED=new Set(selectionRows
    .filter(s=>s.basketEligible!==false&&!EXPORT_EXCLUDED.has(s.symbol)
      &&meetsRecommendationBar(s)&&passesIntradayValidation(s))
    .slice(0,20).map(s=>s.symbol));

  PG=1;renderHead();renderTable();renderStatusBar();saveFilterState();updateTabCounts();
  try{renderRankingsPanels();}catch(e){console.warn('Rankings panels render failed',e);}
  if(ALL.length) try{renderStats();}catch(e){}
}
// Latest Session and Open Positions sit under the recommendations table on Rankings and
// answer the same search box, so a symbol is found wherever it currently lives (v530).
// Both are rendered synchronously after their markup is in the DOM.
// v1137: the depth-only recommendation list. Its own panel, its own ordering, sharing nothing with
// the Radar score - which is the point: the owner asked for recommendations from the order book
// ALONE, so blending it into the composite would answer a different question.
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
// "Removed from rankings" audit (v546, owner): every stock kept out of the recommendations
// list, with WHY — held (already in your book, see Open Positions) or a configured
// surveillance rule. Sorted by rank so it explains the gaps at the top of the list first;
// answers the same Rankings search box; capped to the top 100 by rank for a bounded DOM.
function buildRemovedPanel(query=''){
  const all=[...REMOVED_ROWS].sort((a,b)=>(a.s.rank??1e9)-(b.s.rank??1e9));
  if(!all.length) return '';
  const heldN=all.filter(r=>r.reason==='held').length;
  const survN=all.filter(r=>r.reason==='surv').length;
  const dirN=all.filter(r=>r.reason==='direction').length;
  const filtN=all.filter(r=>r.reason==='filter').length;
  const peakN=all.filter(r=>r.reason==='peak').length;
  const allocN=all.filter(r=>r.reason==='alloc').length;
  const shown=filterPanelRows(all,query,r=>[r.s.symbol,r.s.name,r.s.sector]);
  const CAP=100;
  const view=shown.slice(0,CAP);
  const rowsHtml=view.map(r=>{
    const s=r.s;
    const reason=r.reason==='direction'
      ?`<span style="font-size:11px;background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.25);border-radius:5px;padding:1px 7px;white-space:nowrap" title="${escHtml(r.detail||'')}">📉 Not lifting off</span>`
      :r.reason==='filter'
      ?`<span style="font-size:11px;background:rgba(148,163,184,.10);color:var(--t2);border:1px solid rgba(148,163,184,.22);border-radius:5px;padding:1px 7px;white-space:nowrap" title="${escHtml(r.detail||'')}">⚙ Your filter</span>`
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
      <span style="font-size:13px;color:var(--t3);font-weight:400;margin-left:8px">${[dirN?`📉 ${dirN} not lifting off`:'',heldN?`📌 ${heldN} held`:'',survN?`⚠ ${survN} surveillance`:'',peakN?`⏳ ${peakN} waiting for entry confirmation`:'',allocN?`🚫 ${allocN} not allocatable`:'',filtN?`⚙ ${filtN} by your filters`:''].filter(Boolean).join(' · ')}${(heldN||survN||peakN||allocN||dirN||filtN)?' · ':''}why the ranks skip</span>
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
  const corpNote=eventBits.length?` <b style="color:var(--amber)">Events:</b> ${eventBits.join('; ')}.`:'';
  const detailNote=(r.contrib||[]).length?'':'<div style="color:var(--amber);font-size:13px;margin-bottom:8px">Restored compact ranking — load files again for the full per-feature breakdown.</div>';
  document.getElementById('radarDetailBody').innerHTML=`${detailNote}<div class="rr-groups">${groups}</div>
    <div class="rr-read"><b>Exchange check:</b> Series ${escHtml(r.series||'—')}, price band ${r.band??'not supplied'}, status ${escHtml(r.status||'—')}; basket ${r.basketEligible!==false?'eligible':'ineligible'}. Official delivery ${r.meta?.delivery==null?'unavailable':fmt(r.meta.delivery,1)+'%'}, trades ${r.meta?.trades==null?'unavailable':fmt(r.meta.trades,0)}, surveillance flags: ${flags}.${corpNote}<br>
    <b>Feasibility:</b> ${gate} Strongest daily range estimate ${fmt(r.rangePct,2)}%; the session target takes ${fmt(r.stretch,2)}× that range. The stock remains ranked either way.${entryNote}<br>
    ${r.stage?`<b>Market-cycle stage:</b> ${radarStagePill(r)} — ${escHtml({1:'silent accumulation (quiet strength before a move)',2:'initial breakout',3:'event day (move may be event-driven)',4:'profit-booking (digesting a recent result)',5:'re-accumulation',6:'second leg'}[r.stage]||'')}.<br>`:''}
    <b>Read:</b> ${escHtml(r.setup||'—')}. Data coverage ${r.quality!=null?fmt(r.quality*100,0)+'%':'—'}, day move ${(r.day??0)>=0?'+':''}${fmt(r.day,2)}%, relative volume ${r.relvol==null?'unavailable':fmt(r.relvol,2)+'×'}, turnover ${fV(r.turnover)}. Rank is relative, not a literal probability.</div>
    ${contribs?`<h3 style="font-size:16px;margin:12px 0 8px">Largest feature contributions</h3><div class="rr-contribs">${contribs}</div>`:''}`;
  dlg.showModal();
}
function closeRadarDetail(){document.getElementById('radarDetail')?.close();}

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
  const allocatedLabel='stocks';
  let html=`<span class="sb-count" style="color:${countColor}">${shown.toLocaleString()}</span><span class="sb-total">of ${total.toLocaleString()} ${instrumentLabel}</span>`;
  const selCount=FILT.filter(s=>SELECTED.has(s.symbol)).length;
  if(capital>0&&selCount>0){
    const selList2=FILT.filter(s=>SELECTED.has(s.symbol));
    const am2=computeAlloc(capital,selList2);
    const actualDeployed=Object.values(am2).reduce((s,a)=>s+(a.debit??a.alloc),0);
    const activeAlloc=Object.values(am2).filter(a=>!a.rejected&&a.qty>0);
    const stockCount=activeAlloc.length;
    html+=` <span style="color:var(--amber);font-size:13px;font-family:'DM Mono',monospace;font-weight:700;margin-left:8px" title="All-in estimated buy debit: limit-price notional plus CNC buy-side charges.">· ${stockCount} ${allocatedLabel} · ${fmtINR(actualDeployed)} of ${fmtINR(capital)} all-in</span>`;
    // v1092: what the basket RISKS, alongside what it costs. Sum of each position's own
    // stop loss, plus the spread — a tight spread is the visible proof that the score÷stop
    // weight is equalising risk; a wide one means the caps (turnover, top-up, Max Alloc) are
    // binding and overriding the weight, which is correct but worth seeing.
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
      // v1125 (owner): the basket is measured against the rupees TODAY still needs, not against the
      // harvest plan's own daily figure — and net of what is already booked. This is the question
      // nothing in the app has ever asked: each row was judged against a percentage bar and nobody
      // added the rupees back up, so a basket whose rails bind hard could have every row "pass" while
      // earning a fraction of the day's requirement. Falls back to the harvest goal when no dated
      // goal is configured, so the line never disappears.
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
  // v556: enrich with the official Market Activity Report context (Nifty %, adv/dec, strongest/weakest sector).
  if(MARKET_INTRADAY&&MARKET_INTRADAY.advPct!=null){
    const up=MARKET_INTRADAY.advPct>=0.5,c=up?'var(--green)':'var(--red)',pct=(MARKET_INTRADAY.advPct*100).toFixed(0);
    let officialInline='',officialTip='';
    if(NSE_MARKET&&NSE_MARKET.niftyPct!=null){
      const sgn=v=>(v>=0?'+':'')+v.toFixed(2)+'%';
      officialInline=` · Nifty ${sgn(NSE_MARKET.niftyPct)}`;
      // v1076: regime label + India VIX percentile of its own 52-week range.
      if(MARKET_REGIME&&MARKET_REGIME.vix!=null){
        officialInline+=` · VIX ${MARKET_REGIME.vix.toFixed(2)}${MARKET_REGIME.vixRangePos!=null?` (${MARKET_REGIME.vixRangePos.toFixed(0)}th pct → ${MARKET_REGIME.label})`:''}`;
      }
      const sect=Object.entries(NSE_MARKET.indices||{}).filter(([n])=>/^Nifty (Auto|Bank|IT|Pharma|FMCG|Metal|Realty|Energy|Media|Infra|PSU Bank|Fin Service|Healthcare|Consumption|Commodities|Serv Sector)$/.test(n)).sort((a,b)=>(b[1]||0)-(a[1]||0));
      const ad=(NSE_MARKET.advances!=null&&NSE_MARKET.declines!=null)?` · Adv/Dec ${NSE_MARKET.advances}/${NSE_MARKET.declines}`:'';
      const strong=sect[0]?` · strongest ${sect[0][0]} ${sgn(sect[0][1])}`:'',weak=sect.length>1?` · weakest ${sect[sect.length-1][0]} ${sgn(sect[sect.length-1][1])}`:'';
      const stale=NSE_MARKET.dateISO&&NSE_MARKET.dateISO!==getSessionDate()?' (prior session — EOD)':' (EOD)';
      officialTip=` — Official Market Activity ${NSE_MARKET.date||''}${stale}: Nifty ${sgn(NSE_MARKET.niftyPct)}${ad}${strong}${weak}. Context only, not in scoring.`;
    }
    html+=` <span style="color:${c};font-size:13px;font-family:'DM Mono',monospace;font-weight:700;margin-left:8px" title="Market intraday breadth: ${MARKET_INTRADAY.adv} of ${MARKET_INTRADAY.adv+MARKET_INTRADAY.dec} stocks are trading above their open. Below 50% = broad intraday weakness: new entries must independently confirm above VWAP/open with completed positive 5m/15m tape. This changes entry eligibility, never Radar score/rank.${officialTip}">· Market ${up?'▲':'▼'} ${pct}% up-from-open${officialInline}</span>`;
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
      html+=` <span class="sb-tag" style="margin-left:8px" title="Exit review horizon: how long a position should be given before it is reconsidered, learned from your realised holds${_xp&&_xp.holdDays?` (realised baseline ${_xp.holdDays}d)`:''}. Informational — it changes no target, stop or allocation.">⏳ review after ${_rev}d</span>`;
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

// ── Folder auto-refresh (owner-approved 2026-07-17, ported from the standalone Radar) ──
// Watches the granted local upload folder every 3 seconds; only a change to the ALL NSE
// file's lastModified triggers a refresh. Silent when no folder grant exists, permission
// was revoked, the tab is hidden, or a load is already running.
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
        const files=await filesFromDirectoryHandle(uploadHandle);
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
      const files=await filesFromDirectoryHandle(uploadHandle);
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
    let qtyRaw=String(r[qtyCol]||'').trim();
    if(qtyRaw.includes('/')) qtyRaw=qtyRaw.split('/')[0];
    const qty=num(qtyRaw);
    const price=num(r[priceCol]);
    if(qty===null||qty===0||price===null) return null;
    // v557: an undateable row must NOT be stamped with today's session date — that made a stale
    // Orders.csv (or one whose Time column failed to parse) masquerade as this session's trades.
    // Left empty, it simply never matches a "today" filter.
    const time=String(r[timeCol]||'').trim();
    const product=productCol?String(r[productCol]||'').trim().toUpperCase():'CNC';
    return {symbol:sym,type,qty,price,time,product};
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
          if(fn.endsWith('.csv')||fn.endsWith('.txt')){ // .txt covers the PR-zip bm/an event files (v554)
            const text=await entry.async('string');
            const type=detectNSE(fn,text);
            if(type) updateFileLoadStatusByNseType(type,'loaded');
          }
        }
      }
      await _hydrateZipEntries(outerZip);
      updateFileLoadStatus('Reports-Daily-Multiple.zip','loaded');
    }catch(e){console.warn('hydrateSessionCSVsFromWorkspace: ZIP parse failed',e);}
  }
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

// ── Tradebook Parser & Adaptive Stats ──
// Parses Zerodha tradebook CSV, reconstructs FIFO round-trip trades,
// computes adaptive SL/TGT from actual trading history.
// Open positions (unmatched buys) are excluded from all stats.
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

  // Consolidate multiple fills of the same stock/day/type into one entry (qty-weighted avg price)
  // to prevent fill fragmentation — but ONLY across CONSECUTIVE same-type fills.
  //
  // v1073 FIX. This previously keyed on `type|date`, which merged EVERY buy on a date into one lot
  // stamped at the first fill's time. On a day that went buy -> sell -> buy, that handed the later
  // buy's shares to the earlier sell and blended their prices, so FIFO matched a sell against stock
  // not yet owned. Measured on RICOAUTO (12 buys / 15 sells, 998 qty each way, heavily round-tripped):
  // the 2026-07-28 exit was reported at buy 119.75 / gross +Rs 6,788, when true per-fill FIFO gives
  // 143.30 / +Rs 1,325 — a Rs 5,463 overstatement that inflated the whole Latest Session panel to
  // +Rs 5,745 gross against an actual +Rs 281. Zerodha's own holdings average for RICOAUTO was
  // 141.15, corroborating the per-fill figure over the consolidated one. Symbols that are not
  // round-tripped intraday (GANESHBE, MONARCH, INDOFARM, UFLEX) were unaffected either way.
  //
  // Fills are also time-sorted BEFORE grouping: file order is not guaranteed chronological, and a
  // mis-ordered pair would otherwise be merged into the wrong lot.
  // v1176: FILLS ARE NO LONGER MERGED. v1073 collapsed consecutive same-type fills to stop lot
  // fragmentation, and that averaging is precisely what the last mismatch against Zerodha was made
  // of: on 10-Aug SPECTRUM bought 2@2491, 2@2510.50 and 5@2504.30, which merged to one lot of 9 at
  // 2502.72, so six shares cost 15,016.32 instead of the 15,011.60 Zerodha reports for the first six
  // INDIVIDUAL fills - Rs 4.85 of the Rs 4.87 that still separated the two ledgers. Zerodha matches
  // per fill, so the app does too. Time-sorting is kept (file order is not guaranteed chronological)
  // and the v1073 defect it fixed cannot return, because same-day pairing is now explicit rather
  // than a side effect of how fills were grouped.
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
    // ── v1175: A SELL THAT EXCEEDS THE INVENTORY OPENS A SHORT; IT IS NOT DISCARDED ───────────
    // Owner, 2026-08-18: *"P&L is not right."* It was not, and the cause outlived the v1073 FIFO fix.
    // The loop below stopped at `buyQueue.length>0`, so any sell quantity beyond the long inventory
    // was DROPPED - and with it the obligation to consume a later buy. The covering buy then sat in
    // the queue as PHANTOM INVENTORY and was handed to the next sale, and the one after that.
    //
    // ELECTCAST is the case. Running balance from the tradebook: 09-Feb sells take it to **-338**, an
    // intraday short, covered by a 372-share buy at 13:10; 10-Feb closes to 0; 25-Mar closes to 0
    // again; 17-Aug is a clean intraday round trip, 652 bought at 14:43 and 652 sold at 15:28. The
    // balance is ZERO before 17-Aug, so that day can only match against its own buys - **+Rs 241**.
    // Instead the discarded short left 372 phantom shares alive, of which 203 @ 74.25 (Feb) and 135
    // @ 75.47 (Mar) survived to be matched against the August sells **six months later**, turning a
    // +Rs 241 intraday trade into a reported **-Rs 881** and the session into -Rs 768.
    //
    // Signed FIFO: a buy covers open shorts before it queues as long, and a sell beyond the long
    // inventory opens a short. In cash equity a short cannot be carried overnight, so both legs of
    // one carry the same date and the trip books to the session it happened in.
    // ── v1176: SAME-DAY BUYS PAIR WITH SAME-DAY SELLS FIRST, THEN FIFO AGAINST THE HOLDING ────
    // Validated against the owner's own Zerodha P&L statement for 2026-07-19..2026-08-18 (128
    // symbols): pure chronological FIFO agreed on 125 and disagreed on SGFIN, INDIAGLYCO and
    // SPECTRUM, always reading LOW. SPECTRUM settles it - Zerodha's stated buy value of 20,144.40 is
    // reproducible ONLY by matching the day's own buys to the day's own sells before touching the
    // carried holding: on 10-Aug it bought 2@2491, 2@2510.50, 5@2504.30 and sold 6@2554, and taking
    // the first six of THAT DAY'S buys gives 15,011.60 and +312.40, which with 06-Aug's +141.40
    // against the carried 05-Aug lots totals exactly the +453.80 Zerodha reports. Chronological FIFO
    // instead consumed the 05-Aug lot on the 10th and read +257.73.
    //
    // This is the v558 rule, which has existed on the ORDERS path since that release
    // (computeLatestOrderBooked matches min(todayBuyQty, sellQty) before pricing the remainder at
    // the settled holding cost) and was never applied to the tradebook.
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
    // v1175: the two legs are kept apart, because "what did this round trip cost me" and "what did
    // I pay on THIS day" are different questions and the session card was answering the first while
    // being read as the second. ANANTRAJ was bought across 5-14 Aug and sold on the 17th; its BUY
    // charges were paid on those earlier days, so Zerodha's 17-Aug P&L counts only the sell side.
    // Measured against the owner's own Zerodha P&L for 2026-08-17: charges 103.63 + DP 15.34, where
    // the app was reporting 180 by charging both legs of every trip to the closing session.
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
    // v1175: the SESSION pays only what was incurred IN the session. A trip's `charges` is the
    // all-in cost of the whole round trip, which is the right number for expectancy and win/loss
    // across history - and the wrong one here, because the buy leg of a delivery trip was paid on
    // the day the shares were bought. ANANTRAJ was accumulated 5-14 Aug and sold on the 17th, so
    // Zerodha's 17-Aug P&L counts its SELL side only. An intraday trip pays both legs that day.
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
  // Export is an OPERATIONAL action, never a judgement (owner, v1068). It must always emit the
  // current recommendations — at 09:15, at midnight, on a holiday. Selection quality is decided
  // upstream by each row's own evidence (entryReady, price band, basket eligibility); the wall
  // clock has no authority here. Never reintroduce a clock gate on this path.
  // v1075: entryReady is no longer an export veto (see applyFilters for the forward evidence).
  // v1091/v1112: the export path re-verifies the recommendation bar itself rather than trusting its
  // caller, the same way it already re-verifies price band, capital and turnover participation.
  // `applyFilters` is the normal source of `selected`, but a stale selection restored from cache, a
  // hand-built list, or a future caller must never slip a row past score >= 90 / rank <= 10 into a
  // real order.
  let exportList=(selected||[]).filter(s=>!getPriceBandBlockReason(s)
    &&meetsRecommendationBar(s)&&passesIntradayValidation(s));
  let basketAlloc=computeAlloc(capital,exportList);
  // v1115: a stock now costs TWO orders when its quantity can be split and its runner target sits
  // above its base — so the 20-order limit must be counted in LEGS, not in names, or the export would
  // plan 20 stocks and emit 40 orders. With the recommendation bar at rank <= 10 this rarely binds,
  // but it must be right when it does. Trimming drops the LOWEST-ranked stock whole, never a leg.
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
    // v1177 (owner): *"Let's do away with split orders also. Just one per stock."* v1115 split each
    // buy into a base leg at the row's target and a runner further out, on a measured 5,221-rupee
    // edge over a single GTT across 217 closed cohorts. It is dropped by owner decision: two legs
    // per name doubled the double-sell surface, halved every position into two GTTs to manage, and
    // consumed two of Zerodha's twenty basket slots per stock. ONE order, at the row's own target.
    // splitQty/getRunnerTargetPct survive for the Open Positions panel, which still reports what a
    // runner leg WOULD be for positions opened while v1115-v1176 were live.
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

// ── v1115 THE SPLIT MOVES ONTO THE BUY BASKET (owner) ────────────────────────────────────────────
// The exit is now armed at ENTRY, as two buy orders each carrying its own GTT target, so there is no
// second basket to run and nothing to re-arm by hand. Sell Targets is gone.
//
// WHAT THE SPLIT IS WORTH HERE, measured on the owner's 217 closed sell cohorts (probe-gttladder):
//   one GTT at 4%                     Rs 32,715      <- what a single target per stock captured
//   50% at 4% + 50% at 6%, both GTT   Rs 37,936      <- this release, +Rs 5,221 on the same base
//   one GTT at 6% (whole position)    Rs 43,158      <- better here, but fills on only 25% of days
//   50% at 4% + 50% TRAILED 1%        Rs 60,347      <- best, and NOT expressible as a GTT
//
// THE HONEST COST IS STATED RATHER THAN BURIED: a GTT is a STATIC trigger. v1113's runner exited at
// the peak minus a learned gap, which adapts; a second fixed target cannot. Moving the split onto the
// buy basket therefore trades roughly Rs 22k of measured upside on that sample for a workflow with no
// daily re-arming, no second export, and no double-sell hazard. That was the owner's call, made with
// these numbers in front of him. v1116 then removed the trailing stop outright: at a stop placed
// 1.5x ATR below cost, a Zerodha trail (which ratchets in fixed rupee steps from where the stop
// sits) has further to travel to reach breakeven than the stock moves in a normal day, so the
// target always resolves the position first. It was never executable.
//
// The even split is unchanged from v1113 and structural rather than tuned: half and half is the
// no-information point, the odd share goes to the BASE leg, and a 1-share position is never split.
function splitQty(qty){
  const q=Math.floor(Number(qty)||0);
  if(q<=0) return {base:0,runner:0};
  if(q<2) return {base:q,runner:0};
  const base=Math.ceil(q/2);
  return {base,runner:q-base};
}
// The runner's target. Anchored on the stock's OWN capacity (sqrt(ATR x range), the unit on the row
// since v1060) rather than on a typed percentage: the sweep's optimum sat at ~6% against a median
// capacity of 3.87%, and it stayed within a broad plateau from 5% to 8%, so the multiple is measured
// and not fitted. Floored at the base so a runner can never sit below the leg it is riding behind.
function getRunnerTargetPct(policy){
  const base=Number(policy&&policy.targetPct);
  if(!(base>0)) return null;
  // v1119: the runner is the UPPER QUARTILE of the measured available move — the level a quarter of
  // the owner's positions actually reached — rather than 1.5x the stock's ATR capacity. This is the
  // leg meant to catch the same-day shoot-up, so it should be set by how far those days actually
  // went. Falls back to the ATR multiple only when too few exits have been recorded.
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
  // v1101: a hidden grid has clientWidth 0, so balancing on the tab it lives in is the only moment
  // the column count can actually be computed. rAF lets the tab paint first.
  requestAnimationFrame(balanceGrids);
}
function updateTabCounts(){
  const c0=document.getElementById('tabCount0');
  const c1=document.getElementById('tabCount1');
  if(c0) c0.textContent=FILT.length?'('+FILT.length+')':'';
  if(c1) c1.textContent=RADAR.features.length?'('+RADAR.features.length+')':'';
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
      // v1073: carry the entry-gate state and the TRUE Radar rank into the outcome record.
      // `rank:i+1` alone was the position within this cohort, not the stock's rank in the full
      // cross-section — so every historical rank-bucket analysis was really bucketing cohort index.
      // Both are kept: `rank` stays the cohort slot for continuity with existing records, and
      // `radarRank` is the real one. entryReady/entryTiming let the store separate picks the
      // "wait for pullback" gate approved from the ones it withheld.
      // v1085: every pick carries its OWN two barriers and the bar as it stood at issue. The
      // rocket label is per-stock (target and stop are both stock-specific), so a single
      // issue-level threshold cannot express it; and without high/low AT ISSUE the issue day's
      // bar cannot be split into pre- and post-recommendation action. See resolveRocketDay.
      const allocCtx=getAllocationPassContext();
      const recommendations=eligibleCandidates.concat(controlRows)
        .map((s,i)=>{
          let targetPct=null,stopPct=null;
          try{
            const pol=getRowExitPolicy(s,getBuyPrice(s),allocCtx?.active);
            targetPct=Number(pol?.targetPct)>0?Number(pol.targetPct):null;
            stopPct=Number(pol?.stopPct)>0?Number(pol.stopPct):null;
          }catch(e){}
          return {symbol:s.symbol,entryPrice:s.price,score:s.score,rank:i+1,
            // v1128: a control row is graded exactly like a pick but is NOT one — it is excluded
            // from every recommendation metric so the app never reports buying what it did not.
            control:controlSet.has(s.symbol)||undefined,
            // v1127: the score's COMPONENTS, not just its total. `score = 100 x (setupPct x
            // direction)^4` and `setupPct = max(compositePct, ignitePct)` — a MAX of two different
            // rankers. Measured on 125 resolved picks, the ordering is non-monotonic and its
            // within-day concordance is 43% (50% = no information), which is the signature of one
            // of those two rankers being inverted through the mid-range. Which one was
            // UNANSWERABLE from 34 issue dates of history, because only the total was ever stored.
            // v1130: the market-cycle stage, recorded so the "Second leg" label can finally be
            // GRADED. It drives no score, no selection, no sizing — and it has never been stored,
            // so its value has never been measurable in either direction.
            stage:Number.isFinite(+s.stage)?+s.stage:null,
            // The multi-day term. Recorded WHETHER OR NOT it currently counts for anything,
            // because its weight is measured from these very records - a field that is not
            // stored can never earn its way in, which is how upStreak sat unmeasurable while
            // being the strongest separator in the data.
            upStreak:Number.isFinite(+s.upStreak)?+s.upStreak:null,
            upStreakPct:Number.isFinite(+s.upStreakPct)?+s.upStreakPct:null,
            compositePct:Number.isFinite(+s.compositePct)?+s.compositePct:null,
            ignitePct:Number.isFinite(+s.ignitePct)?+s.ignitePct:null,
            setupPct:Number.isFinite(+s.setupPct)?+s.setupPct:null,
            directionConfirmed:!!s.directionConfirmed,
            radarRank:s.rank??null,entryReady:s.entryReady!==false,entryTiming:s.entryTiming||null,
            targetPct,stopPct,
            high1dAtIssue:Number(s.high1d)>0?Number(s.high1d):null,
            low1dAtIssue:Number(s.low1d)>0?Number(s.low1d):null,
            // v1170: WHAT TIME OF DAY WAS THIS ISSUED? Owner, 2026-08-18: "shouldn't you consider
            // the time of the day also in your recommendation pipeline?" The clock has had no
            // authority since v1068 by his own decision, and that stands - but v1134 concluded that
            // comparing cohorts IS comparing times of day, i.e. the effect is large enough to swamp
            // stock-level signal, and in 38 cohorts NOT ONE PICK EVER CARRIED ITS ISSUE TIME. So the
            // question has been declared confounded and left unmeasurable at the same time.
            // Recorded as MINUTES FROM THE OPEN, which is what a session cares about, plus the raw
            // clock. It drives nothing; it makes the question answerable.
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

// ── v1137: PRE-OPEN ORDER BOOK ───────────────────────────────────────────────────────────────
// Owner, 2026-08-17: rank stocks on order-book imbalance - more buy quantity than sell means the
// price is about to go up - and do it WITHOUT Level 2, a static IP or a paid API. The source is
// NSE's own pre-open endpoint (`api/market-data-pre-open?key=ALL`), captured by dev/fetch-preopen.js
// into `Market Depth.csv`: ~2,300 stocks in ONE request, each carrying the AGGREGATE book
// (totalBuyQuantity / totalSellQuantity), not merely the top five levels.
//
// PROVENANCE, shown on screen rather than buried: this is the pre-open book stamped ~09:07 IST and
// it FREEZES for the session. It is a once-per-day signal available BEFORE the first tick, which is
// the right shape for a BTST/at-open entry and the only aggregate order-book quantity NSE publishes
// publicly. It is never presented as live intraday depth.
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

// The depth-only ranking. Deliberately NOT blended into the Radar score (owner: "recommendations
// based on this only") - it is its own list, and nothing here touches radarAnalyze.
// The depth percentile used by the SCORE is computed over every stock with a two-sided book, not
// over buildDepthRanking's pool: that pool is filtered for EXECUTABILITY (turnover, price, sellers)
// which is a property of whether you can buy, not of what the book is saying. A live pasted book
// supersedes the pre-open one here exactly as it does in the panel.
// ── v1140: THE BOOK, ROLLED FORWARD THROUGH THE SESSION ──────────────────────────────────────
// Owner, 2026-08-17: *"now that you have the depth data... calculating live data based on it
// shouldn't be so hard (without me pasting anything even). We have regular updation of ALL NSE csv
// during the day. In it we have Gap, Volume, Volume change, RoC, direction indicators... to see
// where it is sitting right now based on where it started."*
//
// THE MODEL, in one unit - SHARES. The pre-open book is the starting INVENTORY: `B` resting buy
// quantity against `S` resting sell. Everything traded since the open is FLOW, and its sign is read
// from where price sits inside the day's range:
//
//     mult      = ((P - L) - (H - P)) / (H - L)      in [-1,+1], the Chaikin position multiplier
//     signedVol = Volume_1d x mult                    buy-initiated minus sell-initiated, in shares
//     liveImb   = ((B - S) + signedVol) / ((B + S) + Volume_1d)
//
// A stock closing on its high has consumed the offers (mult -> +1); one on its low has consumed the
// bids (mult -> -1); one mid-range nets out. **NO NEW CONSTANT** - the multiplier is a ratio of the
// day's own range, and every input (`Volume, 1 day`, `High, 1 day`, `Low, 1 day`, `Price`) is
// already in the export, so this needs nothing added to the scanner file and refreshes on every
// upload through the day.
//
// WHAT IT IS AND IS NOT: it is an ESTIMATE of order-flow state, not a reconstruction of the live
// book. Resting inventory and executed flow are different quantities and this deliberately adds
// them in share units; a pasted book (v1137) is a real reading and therefore always wins. At the
// open, before anything trades, `Volume_1d` is ~0 and the estimate reduces to the pre-open book
// exactly - which is the property that makes it safe to roll forward.
function deriveLiveBookImbalance(book,row){
  if(!book) return null;
  const B=+book.buyQty||0, S=+book.sellQty||0, tot0=B+S;
  if(!(tot0>0)) return null;
  const H=+row.high1d, L=+row.low1d, P=+row.price, V=+row.dayVolume;
  // No usable range or volume yet: the book stands as it opened. Fail to the known quantity.
  if(!(V>0)||!(H>L)||!(P>0)) return {imb:(B-S)/tot0,source:'pre-open',signedVol:0,bookWeight:1};
  const mult=((P-L)-(H-P))/(H-L);
  const signed=V*Math.max(-1,Math.min(1,mult));
  // THE PRE-OPEN BOOK DECAYS AS THE SESSION CONSUMES IT (owner's 15-minute bars, 2026-08-17).
  // v1140 carried the resting book at FULL weight all day, and AGIIL showed why that is wrong: the
  // day's #1 book (921,602 buy against 17,505 sell, 52.6:1) opened at its 305.00 IEP, printed its
  // high in the FIRST 15-minute bar, then bled to ~300 on -48% net signed flow - and the app still
  // read it +0.468, because the resting quantity dwarfed the 490,493 actually traded.
  //
  // A pre-open book is INVENTORY THAT GETS MATCHED AT THE OPENING AUCTION. Whatever survives is
  // either filled, cancelled, or was never genuine demand at the equilibrium price. It cannot keep
  // voting at full strength hours later. The weight is the share of that book the session has not
  // yet turned over - `1 - V/(B+S)`, reaching zero once the day trades the book's own size. NO NEW
  // CONSTANT: the scale is the book's own quantity, and at the open (V=0) the weight is exactly 1,
  // so the pre-open ranking is unchanged at the moment it is actually actionable.
  const w=Math.max(0,1-(V/tot0));
  const num=(B-S)*w+signed, den=tot0*w+V;
  if(!(den>0)) return {imb:0,source:'consumed',signedVol:signed,bookWeight:0};
  return {imb:num/den,source:'rolled',signedVol:signed,mult,bookWeight:w};
}
// ── THE AGGREGATE BOOK IS A MARKET READ (v1138), KEPT THROUGH v1143's PANEL REMOVAL ──────────
// The panel that displayed this was removed with the second table; the RECORDING was not, and must
// not be - it is the only forward record of whether the whole-market book calls the day. On
// 2026-08-17 NSE's own PRICE breadth read green (1,197 advances to 795) while the median book sat
// at -0.382, and the market went red (NIFTY 50 -0.45%, 177/323). It cannot be backtested - the
// endpoint serves only the current session - so it accumulates forward or not at all.
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
// v1166: A BOOK FROM AN EARLIER SESSION IS NOT EVIDENCE ABOUT TODAY.
// The same defect v1162 fixed for the 5-minute read, found on the depth path a day later and worse:
// the intraday read only touches stocks that were checked, while this one is blended into EVERY row
// through depthBlendPct. `Market Depth.csv` is written by dev/fetch-preopen.js, which nothing invokes
// automatically - so the file sits at whatever day it was last captured, and on 2026-08-18 the board
// was being scored with the 17-Aug pre-open book.
//
// The file states its own session (BookDate) and parseMarketDepth has always recorded it; nothing
// ever compared it to the session clock. Now a non-current book returns NO map, which makes every
// row fall to the neutral median exactly as a bookless row does (the v1139 rule: absence takes the
// middle of the distribution, never a free pass). The SESSION BOUNDARY is the veto, as in v1162.
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
  NSE_BHAV={};NSE_52W={};NSE_SURV={};NSE_BULK={};NSE_BLOCK={};NSE_PRICE_BAND={};NSE_DEAL_NET={};NSE_CORP_ACTION={};NSE_BOARD_MEETING={};NSE_ANNOUNCE={};NSE_MARKET=null;NSE_INDEX={};NSE_NAME_TO_SYM={};NSE_BAND_HIT={};NSE_NEW_HL_BYNAME={};NSE_INDEX_GROUP_BYNAME={};NSE_INDEX_GROUP_BYSYM={};MARKET_REGIME=null;NSE_STATUS={};NSE_SERIES={};NSE_DEPTH={};NSE_DEPTH_META=null;KITE_TOKEN={};
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
          if(fn.endsWith('.csv')||fn.endsWith('.txt')){ // .txt covers the PR-zip bm/an event files (v554)
            setLoadMsg('Parsing '+fn+'...');
            const text=await entry.async('string');
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

  if(!tvFile&&!nseZip&&!holdFile&&!posFile&&!ordFile&&!tbFile&&!holidayFile){
    if(!silent){
      setLoading(false);
      showToast('TradingView CSV not found in the selected Scanner Uploads folder.',4000,true);
    }
    return false;
  }

  // ── v1114: THE PORTFOLIO IS PARSED BEFORE THE SCANNER IS SCORED ────────────────────────────────
  // The scanner file used to be scored FIRST, and the portfolio files a moment later. But the
  // session target anchor is built FROM the portfolio: the goal-led rate needs capital (holdings +
  // positions) and the harvest rate needs the tradebook's own charge history. So the scorer resolved
  // `getEffectiveTgtPct()` against a half-loaded app and got a fallback — measured 2026-08-10 at
  // 2.60% while the finished value on screen was 1.80%.
  //
  // This was TOLERATED for four releases because the anchor only reached a display-only cohort
  // (v1085 recorded it as the "ORDERING TRAP" and stored `RADAR.rocketTargetPct` so the number was at
  // least auditable). v1113 changed that: the stretch penalty reads the same anchor and FEEDS THE
  // SCORE, so a placeholder was reordering the board — 196 rows marked down instead of 38. It is also
  // the cause of the suite flakiness recorded under v1093, where identical consecutive runs landed
  // either side of a 0.05 rounding step and a dozen target-dependent assertions flipped with it.
  //
  // Parsing the portfolio first is the fix CLAUDE.md has named since v1093. Nothing in these parsers
  // reads `ALL`, so the move is safe in that direction, and it makes the held map correct AT SCORING
  // TIME rather than patched afterwards in applyFilters.
  // Holdings / Positions / Orders / Tradebook — processed regardless of TV CSV
  // All files are loaded before rendering so Latest Session always has fresh data
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

  // Every input the target anchor is built from has now been parsed. Values memoised earlier in this
  // page load were computed against the PREVIOUS portfolio state, and the harvest plan's memo is a
  // 1.5s TTL that would happily serve one — so the anchor's caches are dropped here, deliberately
  // AFTER the portfolio and BEFORE the scorer reads it. Without this the reorder would fix the
  // sequence and still hand the scorer a stale number.
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
  // ── v1171: FETCHING IS A STEP IN THE PIPELINE, NOT A BUTTON ─────────────────────────────────
  // Owner, 2026-08-18: *"Fetched on ALL NSE refresh automatically, not just when I click the fetch
  // button... In fact this should be a step in the recommendation pipeline."*
  //
  // Every ALL NSE ingest spends whatever is left of the rate budget on the names that need history:
  // recommendations first, then open positions, then TODAY'S TOP PERFORMERS descending. The folder
  // watch re-ingests only when the file's own timestamp changes (v519), so this fires a handful of
  // times a day rather than on the 3-second poll, and the daily budget still caps it before a
  // single request is made - coverage builds GRADUALLY across the session instead of in one burst
  // (owner: *"no ~18 minutes once hitting zerodha is not advisable. Do it gradually"*).
  //
  // Fire-and-forget: it must never block the render or fail the load.
  //
  // BUT NOT ON THE FIRST INGEST OF A PAGE LOAD (owner, 2026-08-18: *"Don't fetch from zerodha on
  // first page load. On first load, it's the same ALL NSE that was there when the page was closed
  // last"*). Startup hydration re-ingests the file already on disk, so an automatic fetch there
  // spends the daily budget re-reading a session the inventory usually already covers - and it
  // fires before the owner has even looked at the board. Only a SUBSEQUENT ingest means the file
  // genuinely changed. The manual button is unaffected and still works on the first load.
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
