const BUILD_TS='2026-07-21 12:38 IST'; // release build time (IST)
const APP_VERSION=542; // Folder-watch quiescence guard: auto-refresh ingests only after the upload folder is stable for a full interval (files are overwritten in place, so a mid-download tick waits) — dropped the pointless ALL-NSE-present check.
const GOOGLE_DRIVE_CLIENT_ID='1015012642264-oi2nelv3v90k3d39r994a6nelgjs2a56.apps.googleusercontent.com'; // Public OAuth Web Client ID.
const PRICE_BAND_BLOCK_BUFFER_PCT=0.15; // Treat rounded 4.9/9.9/19.9 rows as effectively band-locked.
const BASKET_CASH_RESERVE_RS=1; // Leave a rupee for broker-side tax/rounding differences.
const BASKET_MARKET_BUDGET_BUFFER_PCT=0.25; // Sizing cushion only; exported buys remain MARKET orders.
const SYSTEM_TRADE_START_DATE='2026-04-01'; // Adaptive stats use trades closed from this date onward.
const HARVEST_DAILY_NET_GOAL_RS=15000; // North-star daily pure-profit goal, never a forced capital assumption.
const HARVEST_DESIRED_NET_PCT=0.60; // Minimum useful net profit after charges for capital rotation.
const TSL_GAP_PERCENTILE=0.75;
const TSL_GAP_RETENTION_FLOOR=70;
const TSL_GAP_MIN_SAMPLES=8;
const TSL_GAP_MIN_PCT=1.5;
const TSL_GAP_MAX_PCT=6.0;
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
let PERF_TRADE_WINDOWS=[]; // cached trade window rows from renderPerformance — used by current-window pill
let PERF_LATEST_SUMMARY=null; // cached latest session summary from buildLatestSessionPanel — used by renderStats card
let PERF_RENDERED=false; // true after background or foreground performance calculation
let PERF_RENDER_QUEUED=false;
let PERF_RENDER_WAITING_FOR_VISIBLE=false;
let ENGINE_DATA={}; // legacy engine metadata shell; the Radar composite keeps its own RADAR state
let SUPPRESSED_HELD=0; // count of stocks hidden because already held in POSITIONS
let SURV_HARD_REMOVED=0; // count of stocks weeded out by configured surveillance rules
let SELECTED=new Set(); // symbols selected for basket — recomputed from FILT each applyFilters
let EXPORT_EXCLUDED=new Set(); // symbols the user unchecked from export — persisted in rs_filters
// Startup hydration renders (and therefore calls applyFilters → saveFilterState) before
// the saved filters have been read back into the DOM. Without this latch those empty
// inputs overwrite the stored state, so every refresh reset the user's filters.
let FILTERS_RESTORED=false;
let FILE_LOAD_STATUS={source:null,when:null,files:[]};
// Radar composite scorer state (v517): one same-day transparent cross-sectional model.
let RADAR={headers:[],matrix:[],features:[],ids:{},rockets:0,ms:0,sourceNote:'',scoredAt:null};
const SCANNER_STORE='rs_filters';
const SHARED_FILTER_STORE='rs_filters_shared';
const ALL_STORE='rs_data';
const ALL_STORE_SCHEMA='radar_composite_v1'; // same-day transparent composite scorer (v517)
const HOLD_STORE='rs_holdings';
const ORDERS_STORE='rs_orders';
const POS_STORE='rs_positions';
const POS_TSL_STORE='rs_position_tsl';
const TRADEBOOK_STORE='rs_tradebook';
const TRADEBOOK_META_STORE='rs_tradebook_meta_v1';
const SURV_RULE_STORE='rs_surv_rules';
const SURV_CORR_STORE='rs_surv_corr';
const SAME_DAY_EXIT_OPPORTUNITY_STORE='rs_same_day_exit_opportunity_v3';
const RECOMMEND_OUTCOME_STORE='rs_recommend_outcomes_delta_v1';
const RECOMMEND_MIN_PROGRESS_FRACTION=0.25;
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
  return {...base,...incoming};
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
  return getActiveStopDistancePct(s?.atr);
}
function getTslMomentumTightenPct(row,peakProfitPct=0){
  const speed=Math.max(0,Number(row?.priceChange)||0,Number(row?.snapshotChange)||0,Number(row?.rocketMove)||0);
  const room=Math.max(0,Number(row?.velocityPotential)||0);
  const pullback=Math.max(0,Number(row?.pullbackFromHighPct)||0);
  const retention=Number(row?.peakRetention);
  let tighten=Math.min(2.5,speed/10);
  tighten+=Math.min(0.5,room/40);
  tighten+=Math.min(0.5,pullback/30);
  if(Number.isFinite(retention)&&retention>=80) tighten+=0.25;
  else if(Number.isFinite(retention)&&retention>=70) tighten+=0.15;
  if(peakProfitPct>0) tighten+=Math.min(0.75,peakProfitPct/20);
  return Math.max(0,Math.min(2.5,tighten));
}
function getRecommendedTslPoints(row,opts={}){
  const price=Number(opts.price??row?.price);
  if(!(price>0)) return null;
  const tighten=getTslMomentumTightenPct(row,Number(opts.peakProfitPct)||0);
  const basePoints=getZerodhaMinTrailPoints(price);
  if(!(basePoints>0)) return null;
  return +Math.max(0.05,basePoints*(1-Math.min(0.35,tighten/10))).toFixed(2);
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
const SURV_SEED_RULES=[
  {column:'Default',label:'Default'},
  {column:'Insolvency_Resolution_Process(IRP)',label:'Insolvency Resolution Process (IRP)'},
  {column:'ICA',label:'ICA'},
  {column:'Under BZ/SZ Series',label:'Under BZ/SZ Series'},
  {column:'Company has failed to pay Annual listing fee',label:'Listing fee unpaid'},
  {column:'Derivative contracts in the scrip to be moved out of F and O',label:'F&O removal'},
  {column:'The Overall encumbered share in the scrip is more than 50 Percent.',label:'Encumbered share > 50%'},
  {column:'ESM',label:'ESM'},
  {column:'GSM',label:'GSM'},
  {column:'Long_Term_Additional_Surveillance_Measure (Long Term ASM)',label:'Long Term ASM'},
  {column:'Short_Term_Additional_Surveillance_Measure (Short Term ASM)',label:'Short Term ASM'},
  {column:'Unsolicited_SMS',label:'Unsolicited SMS'},
  {column:'Social Media Platforms',label:'Social Media Platforms'},
  {column:'Pledge',label:'Pledge'},
  {column:'Loss making',label:'Loss making'},
  {column:'EPS in the scrip is zero (4 trailing quarters)',label:'EPS = 0 (4 trailing quarters)'},
  {column:'Scrip PE is greater than 50 (4 trailing quarters)',label:'PE > 50 (4 trailing quarters)'},
  {column:'Less than 100 unique PAN traded in previous 30 days',label:'PAN < 100 (30d)'},
  {column:'Mandatory Market making period in SME scrip is over',label:'SME market making over'},
  {column:'SME scrip is not regularly traded',label:'SME not regularly traded'},
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
      }).filter(Boolean);
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
    NSE_BHAV[sym]={delivPct:num(r['DELIV_PER']),nseVol:num(r['TTL_TRD_QNTY']),
      officialClose:num(r['CLOSE_PRICE']),officialAvg:num(r['AVG_PRICE']),trades:num(r['NO_OF_TRADES'])};
  });
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
function getRocketArrivalStats(){
  const issues=Object.values((FS.get(RECOMMEND_OUTCOME_STORE)||{}).issues||{});
  const days=issues.flatMap(issue=>(issue.picks||[]).map(p=>p.rocketDays)).filter(v=>v!=null&&isFinite(v)&&v>0);
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
    if(gap==null||gap<=0) return;
    if(gap>horizon){
      (issue.picks||[]).forEach(p=>{p.complete=true;});
      return;
    }
    (issue.picks||[]).forEach(p=>{
      const row=rowMap[p.symbol];
      if(!row||!(p.entryPrice>0)) return;
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
      if(!p.rocketDate&&(row.rocketMove??row.priceChange)!=null&&(row.rocketMove??row.priceChange)>=issue.threshold){
        p.rocketDate=scan.date;p.rocketDays=gap;
      }
      p.outcomeScore=calcRecommendationOutcomeScore(p,issue.threshold);
      p.complete=gap>=horizon;
    });
  });
  const currentIssue=store.issues[scan.date];
  if(scan.recommendations?.length&&(!currentIssue||(currentIssue.picks||[]).every(p=>(p.observations||0)===0))){
    store.issues[scan.date]={
      date:scan.date,threshold:scan.threshold,horizonDays:adaptiveHorizon,
      picks:scan.recommendations.map(p=>({symbol:p.symbol,entryPrice:p.entryPrice,score:p.score,rank:p.rank,
        features:compactOutcomeFeatures(p.features,outcomeFeatureOrder),
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
  const observedPicks=issues.flatMap(i=>(i.picks||[]).filter(p=>p.observations>0));
  const observedRockets=observedPicks.filter(p=>p.rocketDate&&p.rocketDays!=null);
  const assessed=issues.flatMap(issue=>(issue.picks||[])
    .filter(p=>p.complete&&p.observations>0)
    .map(p=>({p,threshold:issue.threshold})));
  const picks=assessed.map(x=>x.p);
  const rockets=picks.filter(p=>p.rocketDate);
  const currentHorizon=getAdaptiveOutcomeHorizonDays();
  const fastRockets=rockets.filter(p=>(p.rocketDays??currentHorizon)<=getOutcomeCheckpointDays(p.horizonDays||currentHorizon));
  const delayedRockets=rockets.length-fastRockets.length;
  const upsides=picks.map(p=>p.bestHighProfitPct).filter(v=>v!=null);
  const scored=assessed.map(({p,threshold})=>calcRecommendationOutcomeScore(p,threshold)).filter(v=>v!=null&&isFinite(v));
  const failures=assessed.filter(({p,threshold})=>calcRecommendationOutcomeScore(p,threshold)<0);
  const earlyFailures=assessed.filter(({p,threshold})=>p.conversionAssessed&&!p.rocketDate&&calcRecommendationOutcomeScore(p,threshold)<0);
  return {
    evaluated:picks.length,rockets:rockets.length,
    fastRockets:fastRockets.length,delayedRockets,earlyFailures:earlyFailures.length,
    failures:failures.length,
    conversionPct:picks.length?+(rockets.length/picks.length*100).toFixed(1):null,
    rocketArrivalCount:observedRockets.length,
    avgRocketDays:observedRockets.length?+(meanArr(observedRockets.map(p=>p.rocketDays)).toFixed(1)):null,
    avgBestHighPct:upsides.length?+meanArr(upsides).toFixed(2):null,
    avgOutcomeScore:scored.length?+meanArr(scored).toFixed(3):null,
    issueDays:issues.length,horizonDays:currentHorizon
  };
}
function getDisplayedEntryCandidates(rows){
  // Top-20 actionable Radar candidates: basket-eligible, valid price, not held.
  if(!Array.isArray(rows)||!rows.length) return [];
  const heldPos=getHeldPositionMap();
  return rows
    .filter(s=>s.symbol&&Number(s.price)>0&&s.basketEligible!==false&&!s._held&&!heldPos[s.symbol]&&!NSE_SURV[s.symbol]?.length)
    .sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)||a.symbol.localeCompare(b.symbol))
    .slice(0,20);
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
    if(entryRef>0&&row.low1d>0&&gap>=0){
      const adverse=Math.max(0,((entryRef-row.low1d)/entryRef)*100);
      if(entry.maxAdversePct==null||adverse>entry.maxAdversePct){
        entry.maxAdversePct=+adverse.toFixed(2);
        changed=true;
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
// winsorized percentiles, a shrunk same-day rocket-archetype diagnostic blended
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
const RADAR_LIQ_STEPS=[0,5e5,25e5,1e7,5e7,1e8,1e9,1e10];
const RADAR_LIQ_LABELS=['Any','₹5L','₹25L','₹1Cr','₹5Cr','₹10Cr','₹100Cr','₹1000Cr'];
const radarNum=v=>{if(v===null||v===undefined||v==='')return null;const x=Number(String(v).replace(/[,%₹\s]/g,''));return Number.isFinite(x)?x:null;};
const clamp01=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
function radarIdx(headers,name){return headers.indexOf(name);}
function radarPct(sorted,x){if(x===null||!sorted.length)return null;let lo=0,hi=sorted.length;while(lo<hi){const m=(lo+hi)>>1;if(sorted[m]<=x)lo=m+1;else hi=m;}return clamp01((lo-.5)/sorted.length);}
function radarQuant(a,p){if(!a.length)return null;const z=(a.length-1)*p,l=Math.floor(z),f=z-l;return a[l]+(a[Math.min(a.length-1,l+1)]-a[l])*f;}
function radarGroupFor(h){
  const s=h.toLowerCase();
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
function radarTransformed(raw,f,priceI){
  const rv=raw[f.i];
  if(f.rating)return RADAR_RATING[String(rv).toLowerCase()]??null;
  let x=radarNum(rv);
  if(x===null)return null;
  if(radarIsPriceLevel(f.name)){const p=radarNum(raw[priceI]);if(p&&x)return 100*(p/x-1);}
  if(/volume|turnover|market capitalization|shareholder/.test(f.name.toLowerCase()))return Math.sign(x)*Math.log1p(Math.abs(x));
  if(f.name==='Price to earnings ratio')return Math.sign(x)*Math.log1p(Math.abs(x));
  if(f.name==='Price')return Math.log1p(Math.max(0,x));
  return x;
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
// Score number + proportional bar, both tinted by the band.
function radarScoreCell(score,title=''){
  const s=Number(score);
  if(score===null||score===undefined||!isFinite(s)) return '<span class="sc-m" style="color:var(--t3)">—</span>';
  const c=radarScoreColor(s);
  return `<span class="sc-m" style="color:${c}"${title?` title="${escHtml(title)}"`:''}>${s.toFixed(1)}</span>`
    +`<span class="score-bar"><i style="width:${Math.max(0,Math.min(100,s))}%;background:${c}"></i></span>`;
}
function radarSetupLabel(r){
  const b=[];
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
  // Signed net deal quantity (BUY − SELL) across bulk + block files, matching the Radar:
  // net buying earns +1.5, net selling −1.5 in the penalty layer.
  Object.entries(NSE_DEAL_NET).forEach(([sym,net])=>{get(sym).bulkNet=Number(net)||0;});
  Object.entries(SURV_ALL_HITS).forEach(([sym,hits])=>{get(sym).flags=Object.keys(hits||{});});
  return meta;
}
function radarAnalyze(headers,rawRows,supplements={},heldSymbols=new Set()){
  const priceI=radarIdx(headers,'Price'),targetI=radarIdx(headers,'Price change %, 1 day'),sectorI=radarIdx(headers,'Sector'),symbolI=radarIdx(headers,'Symbol'),descI=radarIdx(headers,'Description');
  if(symbolI<0||priceI<0||targetI<0)throw Error('Expected Symbol, Price, and Price change %, 1 day columns.');
  const rockets=rawRows.map((r,i)=>({i,y:radarNum(r[targetI])})).filter(x=>x.y!==null&&x.y>=10).map(x=>x.i),rset=new Set(rockets);
  const sectorBuckets={};
  for(const r of rawRows){const s=r[sectorI]||'Unknown',v=radarNum(r[targetI]);if(v!==null)(sectorBuckets[s]??=[]).push(clamp01(v,-10,10));}
  const sectorMeans=Object.fromEntries(Object.entries(sectorBuckets).map(([s,a])=>[s,a.reduce((x,y)=>x+y,0)/a.length])),sectorSorted=Object.values(sectorMeans).sort((a,b)=>a-b);
  const minObs=Math.max(25,Math.floor(rawRows.length*.08));
  const features=[];
  for(let i=0;i<headers.length;i++){
    const name=headers[i],rating=/rating/i.test(name);
    if([symbolI,descI,sectorI,targetI].includes(i)||/ - Currency$/.test(name))continue;
    const f={i,name,group:radarGroupFor(name),rating};
    let vals=[];
    for(let ri=0;ri<rawRows.length;ri++){const v=radarTransformed(rawRows[ri],f,priceI);if(v!==null)vals.push(v);}
    vals.sort((a,b)=>a-b);
    if(vals.length<minObs||vals[0]===vals[vals.length-1])continue;
    const q02=radarQuant(vals,.02),q98=radarQuant(vals,.98),wins=vals.map(v=>clamp01(v,q02,q98)).sort((a,b)=>a-b);
    f.sorted=wins;f.coverage=vals.length/rawRows.length;
    let ar=[],ao=[];
    for(let ri=0;ri<rawRows.length;ri++){
      let v=radarTransformed(rawRows[ri],f,priceI);
      if(v===null)continue;
      const p=radarPct(wins,clamp01(v,q02,q98));
      (rset.has(ri)?ar:ao).push(p);
    }
    const mr=ar.length?ar.reduce((a,b)=>a+b,0)/ar.length:.5,mo=ao.length?ao.reduce((a,b)=>a+b,0)/ao.length:.5;
    f.effect=clamp01((mr-mo)*2,-1,1);
    f.reliability=Math.sqrt(f.coverage)*(rockets.length/(rockets.length+12));
    f.weight=(.07+Math.abs(f.effect))*.6+.4*Math.sqrt(f.coverage);
    features.push(f);
  }
  const turnI=radarIdx(headers,'Price × volume (turnover), 1 day'),relI=radarIdx(headers,'Relative volume, 1 day'),relAtI=radarIdx(headers,'Relative volume at time'),volChgI=radarIdx(headers,'Volume change %, 1 day'),gapI=radarIdx(headers,'Gap %, 1 day'),adrI=radarIdx(headers,'Average daily range %'),atrI=radarIdx(headers,'Average true range %, 14, 1 day'),atrWeekI=radarIdx(headers,'Average true range %, 14, 1 week'),volI=radarIdx(headers,'Volatility, 1 day'),highI=radarIdx(headers,'High, 1 day'),lowI=radarIdx(headers,'Low, 1 day');
  const allRows=rawRows.map((raw,ri)=>{
    const parts={},weights={},contrib=[];
    for(const g in RADAR_GROUPS){parts[g]=0;weights[g]=0;}
    let observed=0;
    for(const f of features){
      let v=radarTransformed(raw,f,priceI);
      if(v===null)continue;
      v=clamp01(v,radarQuant(f.sorted,.02),radarQuant(f.sorted,.98));
      const p=radarPct(f.sorted,v),learn=Math.sign(f.effect||1)*(2*p-1),alpha=clamp01(Math.abs(f.effect)*1.35,.12,.58),sig=alpha*learn+(1-alpha)*radarPrior(f,p),w=f.weight;
      parts[f.group]+=sig*w;weights[f.group]+=w;observed++;
      contrib.push({name:f.name,group:f.group,p,sig,impact:sig*w});
    }
    let rawScore=0;
    for(const g in RADAR_GROUPS){
      parts[g]=weights[g]?50+50*parts[g]/weights[g]:50;
      if(g==='context'){const sp=radarPct(sectorSorted,sectorMeans[raw[sectorI]||'Unknown']??0);parts[g]=parts[g]*.7+sp*100*.3;}
      rawScore+=parts[g]*RADAR_GROUPS[g].budget/100;
    }
    const symbol=normSym(raw[symbolI]),meta=supplements[symbol]||{},series=String(meta.series||'Unknown').toUpperCase(),band=meta.band,status=String(meta.status||'A').toUpperCase();
    const eqEligible=series==='EQ'&&status==='A',basketEligible=eqEligible&&(band===null||band===undefined||band>=10);
    const day=radarNum(raw[targetI])||0,turn=radarNum(raw[turnI])||0,price=radarNum(raw[priceI])||0,gap=Math.abs(radarNum(raw[gapI])||0),quality=features.length?observed/features.length:0;
    const relvol=radarNum(raw[relI]),relAt=radarNum(raw[relAtI]),volChg=radarNum(raw[volChgI]);
    const atrPct=radarNum(raw[atrI]);
    const rangePct=Math.max(radarNum(raw[adrI])||0,atrPct||0,radarNum(raw[volI])||0,(radarNum(raw[atrWeekI])||0)/Math.sqrt(5));
    const stretch=rangePct?10/rangePct:99;
    const participationReady=(relvol||0)>=1.2||(relAt||0)>=1.5||(volChg||0)>=30;
    const impulseReady=(day>=.5&&day<8)||parts.momentum>=62||parts.trend>=65;
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
    if(meta.high52&&meta.low52&&meta.high52>meta.low52)rawScore+=(clamp01((price-meta.low52)/(meta.high52-meta.low52))-.5)*4;
    if(meta.bulkNet)rawScore+=meta.bulkNet>0?1.5:-1.5;
    if(stretch>4)rawScore-=22;else if(stretch>3)rawScore-=14;else if(stretch>2.5)rawScore-=7;
    if(!participationReady)rawScore-=7;
    if(!impulseReady)rawScore-=5;
    if(day>8)rawScore-=Math.min(13,(day-8)*1.7);
    if(gap>7)rawScore-=Math.min(6,(gap-7)*.8);
    if(turn<5e5)rawScore-=7;
    if(price<5)rawScore-=5;
    return {symbol,name:String(raw[descI]||symbol),sector:raw[sectorI]||'',rawScore,parts,contrib,quality,
      price,day,priceChange:day,turnover:turn,relvol,gap,rangePct,stretch,atr:atrPct,
      high1d:highI>=0?radarNum(raw[highI]):null,low1d:lowI>=0?radarNum(raw[lowI]):null,rocketToday:day>=10,
      rocketReady,gateReasons,series,band:band??null,status,eqEligible,basketEligible,meta};
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
    r.score=+(100*Math.pow(radarPct(rawScores,r.rawScore),4)).toFixed(1);
    r.rocketScore=r.score; // allocation/export alias
    r.risk=!r.basketEligible||r.meta.flags?.length>=3||r.turnover<25e5||r.price<10?'High':(r.gap>6||r.day>6||r.parts.volatility<38?'Medium':'Low');
    r.setup=r.series!=='EQ'?(r.series==='UNKNOWN'?'Series unverified':`Non-EQ · ${r.series}`):r.band!==null&&r.band<10?`${r.band}% price band`:radarSetupLabel(r);
  }
  rows.sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol));
  rows.forEach((r,i)=>{r.rank=i+1;});
  return {rows,features,rockets:rockets.length,suppressedHeld,ids:{priceI,targetI,sectorI,symbolI,descI}};
}
// Score the current upload (object rows from parseCSV) through the Radar composite.
function radarScoreRows(objRows){
  const headers=objRows?._headers||Object.keys(objRows?.[0]||{});
  const matrix=(objRows||[]).map(o=>headers.map(h=>o[h]??''));
  const heldPos=getHeldPositionMap();
  const held=new Set(Object.keys(heldPos).map(normSym));
  const t0=performance.now();
  const result=radarAnalyze(headers,matrix,buildRadarSupplements(),held);
  RADAR={headers,matrix,features:result.features,ids:result.ids,rockets:result.rockets,ms:performance.now()-t0,sourceNote:'',scoredAt:Date.now()};
  SUPPRESSED_HELD=result.suppressedHeld;
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
const IW_MIN_SESSIONS=20;    // need this many resolved samples before any evaluation
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
      if(!(elapsed>=IW_WINDOW)){stillPending.push(a);continue;}
      await iwResolveAnchor(store,a);
    }
    store.pending=stillPending;
    store.updatedAt=new Date().toISOString();
    FS.set(INDICATOR_WATCH_STORE,store);
  }catch(e){console.warn('recordIndicatorWatch failed',e);}
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

function enrichExitPnlRow(row){
  const qty=Number(row?.qty)||0;
  const buy=Number(row?.buyPrice);
  const sell=Number(row?.sellPrice);
  const current=currentPriceForSymbol(row?.sym);
  const out={...row};
  if(qty>0&&isFinite(buy)&&buy>0&&isFinite(sell)&&sell>0){
    out.priceDiff=+(sell-buy).toFixed(2);
    out.grossPnl=+((sell-buy)*qty).toFixed(0);
  }else{
    out.priceDiff=null;
    out.grossPnl=null;
  }
  if(qty>0&&isFinite(sell)&&sell>0&&current!=null){
    out.currentPrice=+current.toFixed(2);
    out.reversePnl=+((sell-current)*qty).toFixed(0);
    out.reverseStatus=out.reversePnl>0?'Cheaper re-entry':out.reversePnl<0?'Costlier re-entry':'Flat re-entry';
  }else{
    out.currentPrice=current!=null?+current.toFixed(2):null;
    out.reversePnl=null;
    out.reverseStatus='No live price';
  }
  return out;
}

function summarizeExitPnlRows(rows){
  const known=(rows||[]).filter(r=>r&&r.capital>0&&r.netPnl!=null);
  const capital=known.reduce((s,r)=>s+(r.capital||0),0);
  const net=known.reduce((s,r)=>s+(r.netPnl||0),0);
  const gross=known.reduce((s,r)=>s+(r.grossPnl||0),0);
  const charges=known.reduce((s,r)=>s+(r.charges||0),0);
  const reverse=(rows||[]).filter(r=>r.reversePnl!=null).reduce((s,r)=>s+r.reversePnl,0);
  const reverseCount=(rows||[]).filter(r=>r.reversePnl!=null).length;
  return {known,capital,net,gross,charges,reverse,reverseCount,pct:capital>0?+(net/capital*100).toFixed(2):null};
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
    const avgSell=sells.reduce((s,o)=>s+o.price*o.qty,0)/totalSellQty;
    const holdingAvg=getHoldingAvgCost(sym);
    const isSameDay=buys.length>0;
    const isDelivery=!isSameDay;
    let avgBuy, matchedQty, noAvgCost=false;
    if(isDelivery){
      matchedQty=totalSellQty;
      if(holdingAvg!=null){
        avgBuy=holdingAvg;
      } else {
        // If tradebook has the same sell date, use its exact FIFO-realized row.
        const tradebookRow=TRADEBOOK_STATS?._loadedThisSession
          && TRADEBOOK_STATS.lastDate===session.date
          && TRADEBOOK_STATS.lastDayRows?.find(r=>r.sym===sym);
        if(tradebookRow){
          rows.push(enrichExitPnlRow({...tradebookRow,_sort:tradebookRow.netPnl}));
          return;
        }
        // Holdings.csv not loaded or stock not found — show row with unknown P&L.
        avgBuy=null;
        noAvgCost=true;
      }
    } else {
      const totalBuyQty=buys.reduce((s,o)=>s+o.qty,0);
      if(totalBuyQty<=0) return;
      avgBuy=buys.reduce((s,o)=>s+o.price*o.qty,0)/totalBuyQty;
      matchedQty=Math.min(totalBuyQty,totalSellQty);
    }
    const skipDp=isSameDay||dpCharged.has(sym);
    if(!isSameDay) dpCharged.add(sym);
    if(noAvgCost){
      // No avg cost available — show sell-only charges, P&L unknown
      const scS=calcZerodhaChargesSplit(avgSell,matchedQty,true,false,skipDp);
      const _brok=+scS.brokerage.toFixed(2),_stt=+scS.stt.toFixed(2),_txn=+scS.txn.toFixed(2);
      const _sebi=+scS.sebi.toFixed(2),_gst=+scS.gst.toFixed(2),_stamp=+scS.stamp.toFixed(2),_dp=+scS.dp.toFixed(2);
      const charges=+sumChargeParts({_brok,_stt,_txn,_sebi,_gst,_stamp,_dp}).toFixed(0);
      rows.push(enrichExitPnlRow({sym,lots:sells.length,qty:matchedQty,capital:null,buyPrice:null,sellPrice:+avgSell.toFixed(2),_brok,_stt,_txn,_sebi,_gst,_stamp,_dp,charges,winRate:null,netPnl:null,netPnlPct:null,_sort:-Infinity,_noAvgCost:true}));
      return;
    }
    const bcS=calcZerodhaChargesSplit(avgBuy,matchedQty,false,isSameDay,false);
    const scS=calcZerodhaChargesSplit(avgSell,matchedQty,true,isSameDay,skipDp);
    const _brok=+(bcS.brokerage+scS.brokerage).toFixed(2);
    const _stt=+(bcS.stt+scS.stt).toFixed(2);
    const _txn=+(bcS.txn+scS.txn).toFixed(2);
    const _sebi=+(bcS.sebi+scS.sebi).toFixed(2);
    const _gst=+(bcS.gst+scS.gst).toFixed(2);
    const _stamp=+(bcS.stamp+scS.stamp).toFixed(2);
    const _dp=+(bcS.dp+scS.dp).toFixed(2);
    const charges=+sumChargeParts({_brok,_stt,_txn,_sebi,_gst,_stamp,_dp}).toFixed(0);
    const netPnl=+((avgSell-avgBuy)*matchedQty-charges).toFixed(0);
    const capital=avgBuy*matchedQty;
    const netPnlPct=capital>0?+(netPnl/capital*100).toFixed(2):null;
    rows.push(enrichExitPnlRow({sym,lots:sells.length,qty:matchedQty,capital,buyPrice:+avgBuy.toFixed(2),sellPrice:+avgSell.toFixed(2),_brok,_stt,_txn,_sebi,_gst,_stamp,_dp,charges,winRate:netPnl>0?100:0,netPnl,netPnlPct,_sort:netPnl}));
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
      const rows=TRADEBOOK_STATS.lastDayRows.map(r=>enrichExitPnlRow({...r,_sort:r.netPnl}));
      return {source:'Tradebook',date:tbDate,total:+rows.reduce((s,r)=>s+r.netPnl,0).toFixed(0),rows,unknownRows:0};
    }
    return orderBooked;
  }
  if(orderBooked) return orderBooked;
  if(tbLoaded){
    const rows=TRADEBOOK_STATS.lastDayRows.map(r=>enrichExitPnlRow({...r,_sort:r.netPnl}));
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
function getGoalConfig(){
  const g=FS.get(GOAL_STORE)||{};
  const target=(Number(g.target)>0)?Number(g.target):10000000;
  const withdrawMonthly=Math.max(0,Number(g.withdrawMonthly)||0);
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
  return {target,endDate,days:goalTradingDaysUntil(endDate),withdrawMonthly};
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
function onGoalChange(){
  const t=parseFloat(document.getElementById('goalTarget')?.value);
  const e=String(document.getElementById('goalEnd')?.value||'').trim();
  const w=parseFloat(document.getElementById('goalWd')?.value);
  const cur=getGoalConfig();
  FS.set(GOAL_STORE,{
    target:t>0?t:cur.target,
    endDate:/^\d{4}-\d{2}-\d{2}$/.test(e)?e:cur.endDate,
    withdrawMonthly:w>=0?w:cur.withdrawMonthly
  });
  renderStats();
  renderGoalPopover();
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
function solveGoalDailyRate(start,target,days,wdMonthly){
  if(!(start>0)||!(days>0)||!(target>0)) return null;
  const wdDaily=Math.max(0,Number(wdMonthly)||0)*12/365;
  // gaps[i] = calendar days between trading step i-1 and i (1 = consecutive weekdays).
  const gaps=[];
  {
    const cur=new Date(getSessionDate()+'T12:00:00Z');
    let n=0,guard=0,gap=0;
    while(n<days&&guard++<2600){
      cur.setUTCDate(cur.getUTCDate()+1);
      gap++;
      const dow=cur.getUTCDay();
      if(dow!==0&&dow!==6&&!NSE_HOLIDAYS.has(cur.toISOString().slice(0,10))){gaps.push(gap);gap=0;n++;}
    }
  }
  const earned=r=>{
    let c=start,e=0;
    for(const g of gaps){
      c-=wdDaily*(g-1);            // non-trading days: spending continues, no earning
      if(c<=0){c=Math.max(0,c);continue;}
      const gain=c*r;
      e+=gain;                     // profit tally: withdrawals never erase what was earned
      c=c+gain-wdDaily;            // trading day: earn, then that day's spending
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
function projectGoalCompletionDate(start,target,netPctPerDay,wdMonthly){
  if(!(start>0)||!(target>0)||!(netPctPerDay>0)) return null;
  const r=netPctPerDay/100;
  const wdDaily=Math.max(0,Number(wdMonthly)||0)*12/365;
  const cur=new Date(getSessionDate()+'T12:00:00Z');
  let c=start,e=0,guard=0;
  while(guard++<2600){
    cur.setUTCDate(cur.getUTCDate()+1);
    const dow=cur.getUTCDay();
    if(dow===0||dow===6||NSE_HOLIDAYS.has(cur.toISOString().slice(0,10))){
      c=Math.max(0,c-wdDaily); // non-trading day: spending continues, no earning
      continue;
    }
    if(c>0){
      const gain=c*r;          // trading day: earn first, then that day's spending
      e+=gain;c=c+gain-wdDaily;
      if(c<0)c=0;
      if(e>=target) return cur.toISOString().slice(0,10);
    }else{
      c=Math.max(0,c-wdDaily);
    }
  }
  return null;
}
// Goal capital basis (v540, owner correction): the basis is your working book =
// live market value of what you hold + idle cash freed by selling that you have NOT
// put back to work. `invested` (holdings + positions + today's net buys at live price)
// already contains everything rebought, so only the LEFTOVER sell cash is added:
//   idleCash = max(0, today's sells − today's buys).
// Recycled sell cash (rebought same day) is therefore counted once, in the position it
// bought — never twice (the v539 bug added ALL sells and inflated ~₹7.5L vs ~₹5.5L; the
// v539 over-correction dropped ALL sells and lost genuinely idle cash). The manual
// "Capital ₹" filter field stays excluded (it is a basket-sizing input, and any external
// idle cash it represents is the owner's call to leave out).
function getGoalFreeCapitalParts(){
  const cap=parseFloat(document.getElementById('fCapital')?.value)||0;
  let sells=0,buys=0;
  if(ORDERS_TODAY?._loadedThisSession){
    const today=getSessionDate();
    (ORDERS_TODAY||[]).forEach(o=>{
      if(normOrderDate(o.time)!==today) return;
      const val=(Number(o.qty)||0)*(Number(o.price)||0);
      if(o.type==='SELL') sells+=val;
      else if(o.type==='BUY') buys+=val;
    });
  }
  const idleCash=Math.max(0,sells-buys); // sell proceeds not redeployed today = free cash
  let invested=0;
  try{
    const liveBySym=new Map(ALL.map(r=>[r.symbol,Number(r.price)||0]));
    Object.values(getCombinedOpenPositionMap()).forEach(p=>{
      const qty=Number(p.qty)||0;
      if(!(qty>0)) return;
      const px=liveBySym.get(p.symbol)||Number(p.ltp)||Number(p.avg)||0;
      invested+=qty*px;
    });
  }catch(e){}
  return {cap,sells,buys,idleCash,invested,free:invested+idleCash,total:Math.max(0,invested+idleCash)};
}
function getGoalPortfolioBasis(){return getGoalFreeCapitalParts().total;}
let _goalRateCache=null;
// Required NET %/trading day toward the goal, on FREE capital. Informational only:
// this compass display never alters harvest targets, scoring, or allocation.
function getGoalRequiredNetPct(){
  const g=getGoalConfig();
  const basis=getGoalPortfolioBasis();
  const days=goalRemainingDays(g);
  const key=[g.target,g.endDate,days,g.withdrawMonthly,Math.round(basis)].join('|');
  if(_goalRateCache?.key===key) return _goalRateCache.v;
  const r=solveGoalDailyRate(basis,g.target,days,g.withdrawMonthly);
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
  if(n>0) return `<div style="font-size:9px;color:var(--green)">🎉 ${Math.round(n).toLocaleString('en-IN')} steps</div>`;
  if(n<0) return `<div style="font-size:9px;color:var(--red)">💪 ${Math.max(1,Math.ceil(Math.abs(n)/100))} pushups</div>`;
  return '';
}
function buildGoalPopoverContent(){
  const g=getGoalConfig();
  const _in='background:transparent;border:1px solid var(--border-hi);border-radius:5px;color:var(--t1);font-size:10.5px;padding:2px 6px;font-family:inherit';
  const _lbl='font-size:8.5px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:1px';
  const remaining=goalRemainingDays(g);
  const wdDaily=g.withdrawMonthly*12/365;
  const basis=getGoalPortfolioBasis();
  const req=getGoalRequiredNetPct();
  const reqLine=basis>0
    ?(remaining>0
      ?(req!=null
        ?`<span style="color:var(--amber);font-weight:700">Required now: +${req.toFixed(2)}%/trading day</span> · ≈ ₹${goalFmtRs(basis*req/100)}/day earnings on book ₹${goalFmtRs(basis)}`
        :`<span style="color:var(--red);font-weight:700">Not reachable</span> — earning ₹${goalFmtRs(g.target)} in ${remaining} sessions needs more than 50%/day from total ₹${goalFmtRs(basis)}`)
      :`<span style="color:var(--amber);font-weight:700">Deadline reached</span> — pick a later date`)
    :`Enter Capital ₹ in the filter bar (or load holdings) to compute the required %/day.`;
  return `<div style="font-size:12px;color:var(--t1);margin-bottom:10px;font-weight:700">Goal</div>
  <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
    <span><span style="${_lbl}">Earn ₹ (profit)</span><input id="goalTarget" type="number" value="${g.target}" style="width:92px;${_in}" onchange="onGoalChange()" title="Trading profit to generate from current total capital within the horizon — not a balance to reach."></span>
    <span><span style="${_lbl}">By (deadline)</span><input id="goalEnd" type="date" min="${getSessionDate()}" value="${g.endDate}" style="width:126px;${_in}" onchange="onGoalChange()" title="Deadline for the earnings target. Trading days left are counted from today to this date, skipping weekends and NSE holidays."></span>
    <span><span style="${_lbl}">Withdraw ₹/mo</span><input id="goalWd" type="number" value="${g.withdrawMonthly}" style="width:76px;${_in}" onchange="onGoalChange()"></span>
  </div>
  <div style="font-size:11px;line-height:1.6;color:var(--t2);margin-top:10px">${reqLine}</div>
  ${(()=>{
    // Projected finish at the ACTIVE target's expected net (v538, informational): the
    // date the earnings tally would reach the goal if every trading day netted what the
    // system's chosen target nets after charges. A best-case pace, not a forecast —
    // said explicitly so it cannot be read as one.
    if(!(basis>0)) return '';
    let at=null;try{at=getActiveTargetInfo();}catch(e){}
    if(!at?.tgtPct) return '';
    const netPct=+(at.tgtPct-estimateRoundTripCostPct(at.tgtPct)).toFixed(3);
    if(!(netPct>0)) return '';
    const proj=projectGoalCompletionDate(basis,g.target,netPct,g.withdrawMonthly);
    const srcLbl=at.source==='goal'?'goal-led':'Harvest';
    const rate=`${at.tgtPct.toFixed(1)}% gross ≈ ${netPct.toFixed(2)}% net/day`;
    if(!proj) return `<div style="font-size:11px;line-height:1.6;margin-top:6px;color:var(--red)">At the active ${srcLbl} target (${rate}) you don't reach the goal within 8 years — the target is too low for this book plus withdrawals. Raise the target or extend the deadline.</div>`;
    // Lead with a plain, readable date; express the deadline gap in months (or days when
    // close) so nothing has to be mentally converted.
    const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const readable=d=>{const [y,m,dd]=d.split('-');return `${+dd} ${MON[+m-1]} ${y}`;};
    const late=proj>g.endDate;
    const calDays=Math.abs(Math.round((new Date(proj+'T12:00:00Z')-new Date(g.endDate+'T12:00:00Z'))/86400000));
    const gap=calDays<=1?'right on your deadline'
      :calDays<45?`≈ ${calDays} days ${late?'after':'ahead of'} your ${readable(g.endDate)} deadline`
      :`≈ ${Math.round(calDays/30)} months ${late?'after':'ahead of'} your ${readable(g.endDate)} deadline`;
    return `<div style="font-size:11px;line-height:1.6;margin-top:6px;color:var(--t2)">At the active ${srcLbl} target (${rate}, hit every session) you'd reach the goal around <b style="color:${late?'var(--amber)':'var(--green)'}">${readable(proj)}</b> — ${gap}. Best-case pace, not a forecast.</div>`;
  })()}
  <div style="font-size:10px;line-height:1.5;color:var(--t3);margin-top:6px">${remaining} trading day${remaining===1?'':'s'} left until ${g.endDate} (weekends and NSE holidays excluded) · withdrawal drains ≈ ₹${goalFmtRs(wdDaily)}/calendar day (weekends and holidays included). Informational — never changes targets or allocation.</div>`;
}
function renderGoalPopover(){
  const content=document.getElementById('goalPopoverContent');
  if(content) content.innerHTML=buildGoalPopoverContent();
}
function buildGoalCard(){
  const g=getGoalConfig();
  const parts=getGoalFreeCapitalParts();
  const basis=parts.total;
  const days=goalRemainingDays(g);
  const req=days>0?solveGoalDailyRate(basis,g.target,days,g.withdrawMonthly):null;
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
  const badge=ach!=null?(onTrack?'<span style="color:var(--green);font-size:11px">✓ on track</span>':'<span style="color:var(--amber);font-size:11px">behind</span>'):'<span style="color:var(--t3);font-size:11px">no 30d trades</span>';
  const freeStr=parts.idleCash>0
    ?`basis ₹${goalFmtRs(basis)} (held ${goalFmtRs(parts.invested)} + freed cash ${goalFmtRs(parts.idleCash)})`
    :`basis ₹${goalFmtRs(basis)} (live market value of holdings + positions)`;
  const title='Required NET earnings per NSE trading day, as % of your working book = live market value of holdings + positions + today\'s net buys, PLUS idle cash freed by selling that was not redeployed (max(0, today\'s sells − today\'s buys)). Recycled sell cash is counted once inside the position it rebought, never twice; the manual Capital ₹ field is excluded. Informational only; does not change targets.';
  return `<div class="st" title="${title}"><div class="st-l">Goal · earn ₹${goalFmtRs(g.target)} · ${days} td left</div><div class="st-v" style="color:${col}">${reqStr}%/day ${badge}</div><div class="st-d">${freeStr} · need ${needRs!=null?'₹'+goalFmtRs(needRs)+'/day':'—/day'} · achieved ${ach!=null?(ach*100).toFixed(2)+'%/day':'—/day'} (30d)</div></div>`;
}
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
    const reverseStr=pnlSummary.reverseCount?`reverse ${fmtSignedINR(pnlSummary.reverse)}`:'reverse —';
    const unknownWarning=booked.unknownRows>0?` · <span style="color:var(--amber)">&#9888; excludes ${booked.unknownRows} row${booked.unknownRows===1?'':'s'} with unknown cost</span>`:'';
    bookedCard=`
      <div class="st"><div class="st-l">${bookedLabel}</div><div class="st-v" style="color:${booked.total>=0?'var(--green)':'var(--red)'}">${fmtSignedINR(booked.total)}</div><div class="st-d">${dateLabel} · ${srcLabel} · ${grossStr} · ${costStr} · ${reverseStr}${unknownWarning}${repsTotal}</div></div>`;
  }

  const slTgtCard=(()=>{
    if(!TRADEBOOK_STATS?.adaptiveSL) return '';
    const harvestPlan=computeHarvestPlan();
    const active=getActiveTargetInfo();
    const _sl=TRADEBOOK_STATS.adaptiveSL.toFixed(2);
    const _tgt=(active.tgtPct||harvestPlan.targetPct||TRADEBOOK_STATS.adaptiveTGT).toFixed(2);
    const rr=(parseFloat(_sl)>0?(parseFloat(_tgt)/parseFloat(_sl)):0).toFixed(2);
    const reviewDays=getEffectiveReviewDays();
    const holdStr=reviewDays?` · review &gt;${reviewDays}d`:'';
    const learnedStr=harvestPlan.sampleCount?` · ${harvestPlan.sampleCount} move samples`:'';
    const opportunity=getSameDayExitOpportunitySummary();
    const opportunityStr=opportunity.exits?` · <span style="color:var(--amber)" title="${opportunity.exits} symbol/date exit${opportunity.exits===1?'':'s'} compared with the same day's ALL NSE high; ${opportunity.upsideExits} day high${opportunity.upsideExits===1?'':'s'} exceeded your quantity-weighted average sell price.">${opportunity.upsideExits}/${opportunity.exits} exit${opportunity.exits===1?'':'s'} left upside</span>`:'';
    const costStr=` · <span style="color:var(--t2)" title="Estimated round-trip charges as % of buy capital">cost ~${harvestPlan.costPct.toFixed(2)}%</span>`;
    const netStr=` · net ~${harvestPlan.expectedNetPct.toFixed(2)}%`;
    const confStr=harvestPlan.confidence!=null?` · hit ${(harvestPlan.confidence*100).toFixed(0)}% hist`:'';
    // Show which target is driving the export and where the other one sits.
    const srcStr=active.source==='goal'
      ? ` · <span style="color:var(--amber)" title="Goal-led target is lower than the learned Harvest ${active.harvestPct.toFixed(2)}%, so it drives the basket (higher hit rate, still meets your goal after charges).">goal-led (Harvest ${active.harvestPct.toFixed(2)}%)</span>`
      : (active.goalPct!=null?` · <span style="color:var(--t2)" title="Learned Harvest is at or below the goal-led ${active.goalPct.toFixed(2)}%, so Harvest drives the basket.">Harvest-led (goal ${active.goalPct.toFixed(2)}%)</span>`:` · ${harvestPlan.source}`);
    return `<div class="st"><div class="st-l">SL / Harvest GTT</div><div class="st-v" style="font-size:15px"><span style="color:var(--red)">−${_sl}%</span><span style="color:var(--t3);font-size:12px"> / </span><span style="color:var(--green)">+${_tgt}%</span></div><div class="st-d">R:R ${rr}${costStr}${netStr}${confStr}${srcStr}${learnedStr}${holdStr}${opportunityStr}</div></div>`;
  })();

  const topScore=top&&isFinite(top.score)?Number(top.score).toFixed(1):'—';
  const riskCounts={Low:0,Medium:0,High:0};
  FILT.forEach(s=>{if(riskCounts[s.risk]!=null)riskCounts[s.risk]++;});
  const medianRisk=Object.entries(riskCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—';
  const selCount=FILT.filter(s=>SELECTED.has(s.symbol)).length;
  const rocketsCard=`<div class="st"><div class="st-l">Rockets Today</div><div class="st-v" style="color:var(--fire)">${(RADAR.rockets||0).toLocaleString()}</div><div class="st-d">same-day ≥10% movers · shape today's archetype diagnostic</div></div>`;
  const scoreCard=`<div class="st"><div class="st-l">Top Score</div><div class="st-v" style="color:${radarScoreColor(top?.score)}">${topScore}</div><div class="st-d">${FILT.length.toLocaleString()} displayed · ${selCount} selected for export · median risk ${medianRisk} · ${RADAR.features.length||0} modeled features</div></div>`;

  document.getElementById('statsBar').innerHTML=`
    <div class="st"><div class="st-l">Scanned Universe</div><div class="st-v">${t.toLocaleString()}</div><div class="st-d"><span style="color:var(--green)">${bull} up</span> · <span style="color:var(--red)">${t-bull} down/flat</span> · breadth ${t?(bull/t*100).toFixed(0):'—'}%</div></div>
    ${scoreCard}
    ${rocketsCard}
    ${slTgtCard}
    <div class="st"><div class="st-l">Top Sector</div><div class="st-v" style="font-size:15px;color:var(--green)">${topSec}</div><div class="st-d">${topSecPct.toFixed(0)}% advancing</div></div>${bookedCard}${buildGoalCard()}`;

  const filterPills=[];
  if(SUPPRESSED_HELD>0)filterPills.push(`<span class="info-pill pill-rose" title="Held positions (Holdings + Positions + today's net Orders buys) never re-enter the buy ranking.">📌 ${SUPPRESSED_HELD} held suppressed</span>`);
  const inelig=ALL.filter(s=>s.basketEligible===false).length;
  if(inelig>0)filterPills.push(`<span class="info-pill pill-orange" title="Non-EQ series, inactive status, or a price band below 10% — visible in the ranking with penalties, but never exported to the basket.">⚠ ${inelig} basket-ineligible (ranked with penalties)</span>`);

  // Row 2: analysis / insight pills
  const infoPills=[];
  if(PERF_TRADE_WINDOWS.length){
    const {mins}=istNow();
    const curBucket=Math.floor(mins/30)*30;
    const cw=PERF_TRADE_WINDOWS.find(r=>r.hour===curBucket);
    if(cw){
      const hh=Math.floor(curBucket/60),mm=curBucket%60,h12=hh===0?12:hh>12?hh-12:hh,mer=hh<12?'AM':'PM';
      const slotLabel=h12+':'+(mm===0?'00':String(mm).padStart(2,'0'))+' '+mer;
      const buyPart=cw.bWin!=null?`Buy ${cw.bWin}% win`:'';
      const sellPart=cw.sWin!=null?`Sell ${cw.sWin}% win`:'';
      const sigPart=cw.action!=='&mdash;'?` · <strong>${cw.action}</strong>`:'';
      const parts=[buyPart,sellPart].filter(Boolean).join(' · ');
      if(parts)infoPills.push(`<span class="info-pill" style="background:rgba(99,102,241,.12);border-color:rgba(99,102,241,.3);color:var(--t2)" title="Historical win rates for the current 30-min slot from your tradebook">🕐 ${slotLabel}: ${parts}${sigPart}</span>`);
    }
  }
  try{
    const opportunity=getSameDayExitOpportunitySummary();
    if(opportunity.exits){
      const realisedText=opportunity.avgRealised==null?'':` · realised ${opportunity.avgRealised>=0?'+':''}${opportunity.avgRealised.toFixed(2)}%`;
      infoPills.push(`<span class="info-pill pill-amber" title="One exit means one symbol on one sell date. Sell fills are quantity-weighted; ALL NSE supplies that day's high. The average is weighted by sold value and includes 0% when the high did not exceed your average sell price. Diagnostic only; it does not change the Harvest GTT target.">🎯 ${opportunity.exits} exit${opportunity.exits===1?'':'s'}${realisedText} · ${opportunity.upsideExits} left upside · missed +${opportunity.avgMissed.toFixed(2)}% (${fmtINR(opportunity.missedValue)}) · diagnostic</span>`);
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
function makeSortableTable(id, cols, rows, defaultSortKey, defaultDir=-1, rowStyleFn=null, totalsRow=null){
  cols=applyColOrder(id,cols.slice());
  const thStyle=(align)=>`padding:6px 10px;text-align:${align};cursor:pointer;user-select:none;white-space:nowrap`;
  const tdStyle=(align,extra='')=>`padding:7px 10px;text-align:${align};white-space:nowrap${extra?';'+extra:''}`;
  let sortKey=defaultSortKey, sortDir=defaultDir;
  function render(){
    const sorted=[...rows].sort((a,b)=>{
      const av=a[sortKey],bv=b[sortKey];
      if(typeof av==='string') return sortDir*av.localeCompare(bv);
      return sortDir*((av||0)-(bv||0));
    });
    const thead=`<thead><tr style="color:var(--t3);border-bottom:1px solid var(--border)">${
      cols.map(c=>`<th data-key="${c.key}" style="${thStyle(c.align||'right')}">${c.label}${sortKey===c.key?(sortDir>0?' ▲':' ▼'):''}</th>`).join('')
    }</tr></thead>`;
    const tbody=`<tbody>${sorted.map(row=>{const _rs=rowStyleFn?rowStyleFn(row):'';return`<tr style="border-bottom:1px solid var(--border);color:var(--t1);${_rs}">${
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
  return {render,getHtml:()=>`<table id="${id}" style="width:100%;border-collapse:collapse;font-size:12px;font-family:'DM Mono',monospace"></table>`};
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
  return `<div style="padding:14px 16px;color:var(--t3);font-size:12px">No ${noun} matches "${escHtml(String(query||'').trim())}".</div>`;
}

// Latest Session — whichever source (Orders.csv or Tradebook) has the newer date.
// Extracted from renderPerformance so the Rankings tab can host it next to the
// recommendations and open-position tables under one shared search box (v530).
// Header totals stay whole-session; the table and its footer follow the search.
function buildLatestSessionPanel(query=''){
  const clr=(v)=>v===0?'var(--t2)':v>0?'var(--green)':'var(--red)';
  const fmtPerfRs=(v)=>fmtSignedINR(v);
  const fmtPct=(v)=>(v>=0?'+':'')+v.toFixed(2)+'%';
  const card=inner=>`<div id="rank-latest-session-card" style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden">${inner}</div>`;
  const summary=getLatestBookedSummary();
  PERF_LATEST_SUMMARY=summary; // cache for the renderStats card — single source of truth
  const orderBooked=summary?.source==='Orders.csv'?summary:null;

  if(orderBooked){
    const allRows=orderBooked.rows;
    const latestDate=orderBooked.date||getSessionDate();
    const latestTotal=orderBooked.total;
    const latestUnknownRows=orderBooked.unknownRows||0;
    const latestUnknownWarning=latestUnknownRows>0?` <span style="font-size:10px;color:var(--amber);font-weight:700">&#9888; excludes ${latestUnknownRows} row${latestUnknownRows===1?'':'s'} with unknown cost</span>`:'';
    const rows=filterPanelRows(allRows,query,r=>[r.sym]);
    const shownSummary=summarizeExitPnlRows(rows);
    const shownTotal=rows.reduce((s,r)=>s+(r.netPnl||0),0);
    const _chFmt=v=>fmtNegINR(v);const _chClr=()=>'var(--red)';
    // Totals ride the component's totalsRow (keyed by column) so they follow any
    // user-dragged column order — the old hand-built tfoot assumed a fixed sequence.
    const _dash={totFmt:()=>'—',totClrFn:()=>'var(--t3)'};
    const _signTot={totFmt:v=>v!=null?fmtPerfRs(v):'—',totClrFn:v=>v!=null?(v>=0?'var(--green)':'var(--red)'):'var(--t3)'};
    const _chTot={totFmt:v=>fmtNegINR(v),totClrFn:()=>'var(--red)'};
    const latestCols=[
      {key:'sym',label:'Symbol',align:'left',fmt:v=>v,clrFn:()=>'var(--t1)',bold:true,totFmt:v=>v??'',totClrFn:()=>'var(--t2)'},
      {key:'lots',label:'Trades',align:'right',fmt:v=>v,clrFn:()=>'var(--t2)',..._dash},
      {key:'buyPrice',label:'Buy ₹',align:'right',fmt:(v,r)=>v!=null?Number(v).toLocaleString('en-IN',INR_2):`<span style="color:var(--amber);font-size:10px" title="Load Holdings.csv to see avg cost">avg cost?</span>`,clrFn:()=>'var(--t2)',..._dash},
      {key:'sellPrice',label:'Sell ₹',align:'right',fmt:v=>Number(v).toLocaleString('en-IN',INR_2),clrFn:()=>'var(--t2)',..._dash},
      {key:'priceDiff',label:'Diff ₹',align:'right',fmt:v=>v!=null?fmtSignedINR(v).replace('₹','₹/sh '):'—',clrFn:v=>v!=null?clr(v):'var(--t3)',..._dash},
      {key:'currentPrice',label:'Now ₹',align:'right',fmt:v=>v!=null?Number(v).toLocaleString('en-IN',INR_2):'—',clrFn:()=>'var(--t2)',..._dash},
      {key:'reversePnl',label:'Reverse ₹',align:'right',bold:true,fmt:(v,r)=>v!=null?`<span title="${escHtml(r.reverseStatus||'')}">${fmtPerfRs(v)}</span>`:'—',clrFn:v=>v!=null?clr(v):'var(--t3)',..._signTot},
      {key:'_brok',label:'Brokerage',align:'right',fmt:_chFmt,clrFn:_chClr,..._chTot},
      {key:'_stt',label:'STT/CTT',align:'right',fmt:_chFmt,clrFn:_chClr,..._chTot},
      {key:'_txn',label:'Txn',align:'right',fmt:_chFmt,clrFn:_chClr,..._chTot},
      {key:'_gst',label:'GST',align:'right',fmt:_chFmt,clrFn:_chClr,..._chTot},
      {key:'_sebi',label:'SEBI',align:'right',fmt:_chFmt,clrFn:_chClr,..._chTot},
      {key:'_stamp',label:'Stamp',align:'right',fmt:_chFmt,clrFn:_chClr,..._chTot},
      {key:'_dp',label:'DP',align:'right',fmt:_chFmt,clrFn:_chClr,..._chTot},
      {key:'charges',label:'Total Charges',align:'right',bold:true,fmt:fmtNegINR,clrFn:()=>'var(--red)',..._chTot},
      {key:'grossPnl',label:'Gross P&L',align:'right',bold:true,fmt:v=>v!=null?fmtPerfRs(v):'—',clrFn:v=>v!=null?clr(v):'var(--t3)',..._signTot},
      {key:'netPnl',label:'Net P&L',align:'right',bold:true,fmt:(v,r)=>v!=null?fmtPerfRs(v):`<span style="color:var(--amber);font-size:10px">unknown</span>`,clrFn:(v)=>v!=null?clr(v):'var(--amber)',..._signTot},
      {key:'netPnlPct',label:'P&L %',align:'right',bold:true,fmt:v=>v!=null?fmtPct(v):`<span style="color:var(--amber);font-size:10px">unknown</span>`,clrFn:v=>v!=null?clr(v):'var(--amber)',totFmt:v=>v==null?'--':fmtPct(v),totClrFn:v=>v==null?'var(--t3)':v>=0?'var(--green)':'var(--red)'},
    ];
    const _sum=k=>rows.reduce((s,r)=>s+(r[k]||0),0);
    const latestTotals=(rows.length>1||latestUnknownRows>0)?{
      sym:`Total (${rows.length})${latestUnknownRows?` <span style="color:var(--amber)">&#9888; excludes ${latestUnknownRows} unknown</span>`:''}`,
      reversePnl:shownSummary.reverseCount?shownSummary.reverse:null,
      _brok:_sum('_brok'),_stt:_sum('_stt'),_txn:_sum('_txn'),_gst:_sum('_gst'),_sebi:_sum('_sebi'),_stamp:_sum('_stamp'),_dp:_sum('_dp'),
      charges:_sum('charges'),
      grossPnl:shownSummary.known.length?shownSummary.gross:null,
      netPnl:shownTotal,
      netPnlPct:shownSummary.pct
    }:null;
    const latestTbl=makeSortableTable('rank-latest-session',latestCols,rows,'_sort',-1,null,latestTotals);
    const emptyNote=String(query||'').trim()
      ?panelNoMatchHtml(query,'booked trade')
      :`<div style="padding:12px 16px;color:var(--t3);font-size:12px">No sell orders found in Orders.csv — only sell orders generate P&L rows.</div>`;
    const html=card(`
      <div style="padding:10px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--border)">
        <span style="font-size:10px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.1em">Latest Session — ${latestDate} <span style="font-weight:400;color:var(--t3)">(Orders.csv · holdings/same-day buys)</span>${panelFilterTag(allRows,rows,query)}</span>
        <span style="font-size:15px;font-weight:800;color:${clr(latestTotal)};font-family:'DM Mono',monospace">${allRows.length?fmtPerfRs(latestTotal):''} <span style="font-size:10px;color:var(--t3);font-weight:400">${allRows.length?'net of charges':''}</span>${latestUnknownWarning}</span>
      </div>
      ${rows.length?`<div style="overflow-x:auto">${latestTbl.getHtml()}</div>`:emptyNote}`);
    const render=()=>{if(rows.length)latestTbl.render();};
    return {html,render};
  }

  if(summary?.source==='Tradebook'){
    const allRows=summary.rows.map(r=>{
      const capital=r.capital??((r.buyPrice||0)*(r.qty||0));
      const netPnlPct=r.netPnlPct??(capital>0?+(r.netPnl/capital*100).toFixed(2):null);
      return enrichExitPnlRow({...r,capital,netPnlPct,_sort:r.netPnl});
    });
    const tbDate=summary.date||'';
    const tbTotal=+(allRows.reduce((s,r)=>s+r.netPnl,0)).toFixed(0);
    const rows=filterPanelRows(allRows,query,r=>[r.sym]);
    const tbSummary=summarizeExitPnlRows(rows);
    const shownTotal=+(rows.reduce((s,r)=>s+r.netPnl,0)).toFixed(0);
    const _dash={totFmt:()=>'—',totClrFn:()=>'var(--t3)'};
    const _signTot={totFmt:v=>v!=null?fmtPerfRs(v):'—',totClrFn:v=>v!=null?(v>=0?'var(--green)':'var(--red)'):'var(--t3)'};
    const tbCols=[
      {key:'sym',label:'Symbol',align:'left',fmt:v=>`<span style="font-weight:700;font-size:12px">${escHtml(v)}</span>`,totFmt:v=>v??'',totClrFn:()=>'var(--t2)'},
      {key:'lots',label:'Lots',align:'right',fmt:v=>`<span style="color:var(--t2)">${v}</span>`,..._dash},
      {key:'buyPrice',label:'Buy ₹',align:'right',fmt:v=>`<span style="font-family:'DM Mono',monospace">${Number(v).toLocaleString('en-IN',INR_2)}</span>`,..._dash},
      {key:'sellPrice',label:'Sell ₹',align:'right',fmt:v=>`<span style="font-family:'DM Mono',monospace">${Number(v).toLocaleString('en-IN',INR_2)}</span>`,..._dash},
      {key:'priceDiff',label:'Diff ₹',align:'right',fmt:v=>v!=null?fmtSignedINR(v).replace('₹','₹/sh '):'—',clrFn:v=>v!=null?clr(v):'var(--t3)',..._dash},
      {key:'currentPrice',label:'Now ₹',align:'right',fmt:v=>v!=null?Number(v).toLocaleString('en-IN',INR_2):'—',clrFn:()=>'var(--t2)',..._dash},
      {key:'reversePnl',label:'Reverse ₹',align:'right',bold:true,fmt:(v,r)=>v!=null?`<span title="${escHtml(r.reverseStatus||'')}">${fmtPerfRs(v)}</span>`:'—',clrFn:v=>v!=null?clr(v):'var(--t3)',..._signTot},
      {key:'charges',label:'Charges ₹',align:'right',bold:true,fmt:fmtNegINR,clrFn:()=>'var(--red)',totFmt:v=>fmtNegINR(v),totClrFn:()=>'var(--red)'},
      {key:'grossPnl',label:'Gross P&L',align:'right',bold:true,fmt:v=>v!=null?fmtPerfRs(v):'—',clrFn:v=>v!=null?clr(v):'var(--t3)',..._signTot},
      {key:'netPnl',label:'Net P&L',align:'right',bold:true,fmt:fmtPerfRs,clrFn:clr,..._signTot},
      {key:'netPnlPct',label:'P&L %',align:'right',bold:true,fmt:v=>v!=null?fmtPct(v):'--',clrFn:v=>v!=null?clr(v):'var(--t3)',totFmt:v=>v==null?'--':fmtPct(v),totClrFn:v=>v==null?'var(--t3)':v>=0?'var(--green)':'var(--red)'},
    ];
    const tbTotals=rows.length>1?{
      sym:`Total (${rows.length})`,
      reversePnl:tbSummary.reverseCount?tbSummary.reverse:null,
      charges:rows.reduce((s,r)=>s+(r.charges||0),0),
      grossPnl:tbSummary.known.length?tbSummary.gross:null,
      netPnl:shownTotal,
      netPnlPct:tbSummary.pct
    }:null;
    const tbTbl=makeSortableTable('rank-latest-session',tbCols,rows,'_sort',-1,null,tbTotals);
    const html=card(`
      <div style="padding:10px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--border)">
        <span style="font-size:10px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.1em">Latest Session — ${tbDate} <span style="font-weight:400;color:var(--t3)">(Tradebook · charges included)</span>${panelFilterTag(allRows,rows,query)}</span>
        <span style="font-size:15px;font-weight:800;color:${clr(tbTotal)};font-family:'DM Mono',monospace">${fmtPerfRs(tbTotal)} <span style="font-size:10px;color:var(--t3);font-weight:400">net of charges</span></span>
      </div>
      ${rows.length?`<div style="overflow-x:auto">${tbTbl.getHtml()}</div>`:panelNoMatchHtml(query,'booked trade')}`);
    const render=()=>{if(rows.length)tbTbl.render();};
    return {html,render};
  }

  return {html:card(`<div style="padding:14px 16px;color:var(--t3);font-size:12px">
      <span style="font-weight:600;color:var(--t2)">Latest Session</span> — Upload <strong>Tradebook.csv</strong> or <strong>Orders.csv</strong> to see session P&amp;L.
    </div>`),render:()=>{}};
}

// One current-position view: the live portfolio merge plus the existing Radar context.
// It reads the exit-policy helpers but never feeds anything back into scoring.
// `query` filters only what is DISPLAYED — TSL state is always computed and persisted
// from the full position set, so searching can never prune the TSL store.
function buildOpenPositionsPanel(query=''){
  const adaptiveTGT=getEffectiveTgtPct()||(TRADEBOOK_STATS?.adaptiveTGT||3.7);
  const reviewDays=getEffectiveReviewDays()||5;
  const scannerBySymbol=new Map(ALL.map(row=>[row.symbol,row]));
  const tslStore=getPositionTslStore();
  const tslNext=tslStore.gapModel?{gapModel:tslStore.gapModel}:{};
  let tslChanged=false;
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
    const stopPct=getRowStopDistancePct(scannerRow);
    const targetPrice=avg?tickPrice(avg*(1+adaptiveTGT/100)):null;
    const stopPrice=avg?tickPrice(avg*(1-stopPct/100)):null;
    const tslInfo=calcPositionTSL({
      sym:pos.symbol,qty,avgCost:avg,ltp,scannerRow,adaptiveSL:stopPct,
      adaptiveTGT,prev:tslStore[pos.symbol]
    });
    if(tslInfo){
      tslNext[pos.symbol]=tslInfo;
      if(JSON.stringify(tslStore[pos.symbol]||{})!==JSON.stringify(tslInfo)) tslChanged=true;
    }
    rows.push({
      sym:pos.symbol,qty,avg,ltp,pnlPct,pnlRs,capital,daysHeld,targetPrice,stopPrice,
      tslPoints:tslInfo?.trailStepPoints??tslInfo?.trailPoints??null,
      score:isFinite(Number(scannerRow?.score))?Number(scannerRow.score):null,
      rank:scannerRow?.rank??null,setup:scannerRow?.setup||'',
      dayPct:scannerRow?.day??scannerRow?.priceChange??null,risk:scannerRow?.risk||'',
      scannerRow
    });
  });

  if(!rows.length){
    if(Object.keys(tslStore).some(isPositionTslSymbolKey)) FS.set(POS_TSL_STORE,tslStore.gapModel?{gapModel:tslStore.gapModel}:{});
    return {html:'',table:null};
  }
  if(Object.keys(tslStore).some(sym=>isPositionTslSymbolKey(sym)&&!tslNext[sym])) tslChanged=true;
  if(tslChanged) FS.set(POS_TSL_STORE,tslNext);

  const daysFmt=(v)=>{
    if(v==null) return '<span style="color:var(--t3)">—</span>';
    const color=v>reviewDays?'var(--red)':v>=reviewDays?'var(--amber)':'var(--t1)';
    return `<span title="Quantity-weighted age of remaining FIFO buy lots" style="color:${color};font-weight:${v>reviewDays?700:500}">${v}d</span>`;
  };
  const cols=[
    {key:'sym',label:'Symbol',align:'left',bold:true,fmt:(v,row)=>row.scannerRow?`<button onclick="showRadarDetail(${escHtml(JSON.stringify(String(v)))})" style="padding:0;border:0;background:transparent;color:var(--t1);font:inherit;font-weight:700;cursor:pointer" title="Show Radar scoring breakdown">${escHtml(v)}</button>`:escHtml(v)},
    {key:'qty',label:'Qty',align:'right',fmt:v=>v,clrFn:()=>'var(--t2)'},
    {key:'avg',label:'Avg ₹',align:'right',fmt:v=>v!=null?Number(v).toLocaleString('en-IN',INR_2):'—',clrFn:()=>'var(--t2)'},
    {key:'ltp',label:'LTP ₹',align:'right',fmt:v=>v!=null?Number(v).toLocaleString('en-IN',INR_2):'—',clrFn:()=>'var(--t1)'},
    {key:'pnlPct',label:'P&L %',align:'right',bold:true,fmt:v=>v!=null?(v>=0?'+':'')+v.toFixed(2)+'%':'—',clrFn:v=>v==null?'var(--t3)':v>0?'var(--green)':v<0?'var(--red)':'var(--t2)'},
    {key:'pnlRs',label:'P&L ₹',align:'right',fmt:v=>v!=null?fmtSignedINR(v):'—',clrFn:v=>v==null?'var(--t3)':v>0?'var(--green)':v<0?'var(--red)':'var(--t2)'},
    {key:'capital',label:'Capital ₹',align:'right',fmt:v=>v!=null?fmtINR(v):'—',clrFn:()=>'var(--t2)'},
    {key:'daysHeld',label:'Days Held',align:'right',fmt:daysFmt,clrFn:()=>'var(--t1)'},
    {key:'targetPrice',label:'Target ₹',align:'right',fmt:v=>v!=null?fmtINR(v)+`<span style="font-size:10px;color:var(--t3);margin-left:4px">+${adaptiveTGT}%</span>`:'—',clrFn:()=>'var(--green)'},
    {key:'stopPrice',label:'SL ₹',align:'right',fmt:(v,row)=>v!=null?fmtINR(v)+`<span style="font-size:10px;color:var(--t3);margin-left:4px">-${getRowStopDistancePct(row.scannerRow).toFixed(2)}%</span>`:'—',clrFn:()=>'var(--red)'},
    {key:'tslPoints',label:'TSL pts',align:'right',bold:true,fmt:v=>v!=null?Number(v).toFixed(2):'—',clrFn:v=>v==null?'var(--t3)':'var(--amber)'},
    {key:'score',label:'Radar Score',align:'right',bold:true,fmt:v=>radarScoreCell(v),clrFn:()=>'var(--t1)'},
    {key:'rank',label:'Rank',align:'right',fmt:v=>v??'—',clrFn:()=>'var(--t2)'},
    {key:'setup',label:'Setup',align:'left',fmt:v=>v?`<span style="font-size:11px;color:var(--t2)">${escHtml(v)}</span>`:'<span style="color:var(--t3)">not in this upload</span>'},
    {key:'dayPct',label:'Day %',align:'right',fmt:fPerf,clrFn:()=>'var(--t2)'},
    {key:'risk',label:'Risk',align:'left',fmt:v=>v?radarRiskPill(v):'—'}
  ];
  // Header totals always describe the WHOLE portfolio; the table shows the search match.
  const totalCapital=rows.reduce((sum,row)=>sum+(row.capital||0),0);
  const totalPnl=rows.reduce((sum,row)=>sum+(row.pnlRs||0),0);
  const pnlColor=totalPnl>0?'var(--green)':totalPnl<0?'var(--red)':'var(--t3)';
  const shown=filterPanelRows(rows,query,row=>[row.sym,row.scannerRow?.name,row.scannerRow?.sector]);
  const table=makeSortableTable('rank-open-positions',cols,shown,'score',-1);
  const radarNote=ALL.length
    ?'Radar context is from the current ALL NSE upload. Click a symbol for its scoring breakdown.'
    :'Load ALL NSE.csv to add Radar score, rank, setup, day change, and risk.';
  const html=`<div id="rank-open-positions-card" style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden">
    <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px">
        <span style="font-size:11px;font-weight:800;color:var(--t1);text-transform:uppercase;letter-spacing:.08em">Open Positions${panelFilterTag(rows,shown,query)}</span>
        <span style="font-size:12px;font-weight:700;color:${pnlColor}">${rows.length} live position${rows.length===1?'':'s'} · ${fmtINR(totalCapital)} deployed · ${fmtSignedINR(totalPnl)}</span>
      </div>
      <div style="font-size:12px;color:var(--t2);line-height:1.5">Live merge of Holdings, Positions, and today's net buys. Held stocks stay excluded from new recommendations; Target, SL, and TSL use the existing exit policy. ${radarNote}</div>
    </div>
    ${shown.length?`<div style="overflow-x:auto">${table.getHtml()}</div>`:panelNoMatchHtml(query,'open position')}
  </div>`;
  return {html,table:shown.length?table:null};
}

// ── Recommendation tracking visualization (v535) ──────────────────────────────
// Built ONLY from data the app already records (owner constraint): the shortlist
// outcome store keeps, per issue date, each pick's rank/score plus running outcome
// aggregates (best high + day, worst low, final close, rocket day). Granularity is
// one point per TRADING DAY — intraday refreshes are deliberately deduped at record
// time — and per-pick history is aggregate, not a day-by-day polyline. The two
// panels below draw exactly what exists and nothing more.
function buildRecommendationTrackingHTML(){
  const issues=Object.values((FS.get(RECOMMEND_OUTCOME_STORE)||{}).issues||{})
    .filter(i=>i?.date&&Array.isArray(i.picks)&&i.picks.length)
    .sort((a,b)=>a.date<b.date?-1:1);
  if(!issues.length) return '';
  const pct=v=>(v>=0?'+':'')+Number(v).toFixed(1)+'%';
  const dd=d=>d.slice(8); // day-of-month column label; full date rides the tooltip

  // ── Panel A — shortlist rank heatmap: one column per session, one row per symbol.
  // Sequential single-hue ramp (cyan, deeper = better rank). The exception gets the
  // ink: 84.7% of completed picks rocket, so ONLY the failures are marked (red
  // underline). Rockets are the quiet norm.
  const bySym={};
  issues.forEach(issue=>(issue.picks||[]).forEach(p=>{
    if(!p?.symbol) return;
    const e=bySym[p.symbol]??={symbol:p.symbol,cells:{},n:0,bestRank:Infinity,last:''};
    e.cells[issue.date]=p; e.n++;
    if(p.rank&&p.rank<e.bestRank) e.bestRank=p.rank;
    if(issue.date>e.last) e.last=issue.date;
  }));
  const heatRows=Object.values(bySym).sort((a,b)=>b.n-a.n||a.bestRank-b.bestRank||(a.last<b.last?1:-1));
  const rankAlpha=r=>!r?0.22:r<=5?0.85:r<=10?0.58:r<=15?0.38:0.22;
  const CELL='width:20px;height:14px;border-radius:2px;flex:0 0 20px;';
  const headHtml=`<div style="display:flex;gap:2px;align-items:flex-end;margin-left:96px">${issues.map(i=>`<span style="${CELL}font-size:8.5px;color:var(--t3);text-align:center;font-family:'DM Mono',monospace;height:auto" title="${i.date}">${dd(i.date)}</span>`).join('')}</div>`;
  const rowsHtml=heatRows.map(row=>{
    const cells=issues.map(issue=>{
      const p=row.cells[issue.date];
      if(!p) return `<span style="${CELL}background:rgba(148,163,184,.06)"></span>`;
      const failed=p.complete&&!p.rocketDate;
      const outcome=p.rocketDate?`rocketed d${p.rocketDays}`:p.complete?`no +10% within ${p.horizonDays||''}d`:`pending · ${p.observations||0} obs`;
      const tip=`${row.symbol} · ${issue.date} · rank ${p.rank??'—'} · score ${p.score!=null?Number(p.score).toFixed(1):'—'} · ${outcome}${p.bestHighProfitPct!=null?` · best ${pct(p.bestHighProfitPct)}`:''}`;
      return `<span style="${CELL}background:rgba(6,182,212,${rankAlpha(p.rank)});${failed?'box-shadow:inset 0 -2px 0 var(--red);':''}" title="${escHtml(tip)}"></span>`;
    }).join('');
    return `<div style="display:flex;gap:2px;align-items:center;margin-top:2px"><span style="width:92px;flex:0 0 92px;font-size:10px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:4px" title="${escHtml(row.symbol)} · shortlisted ${row.n}× · best rank ${row.bestRank}">${escHtml(row.symbol)}</span>${cells}</div>`;
  }).join('');
  const heatHtml=`
    <div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:2px">Shortlist tracking — rank per session</div>
    <div style="font-size:10px;color:var(--t3);margin-bottom:8px">${heatRows.length} symbols × ${issues.length} sessions · one cell per trading day (intraday refreshes are deduped at record time) · deeper cyan = better rank</div>
    ${headHtml}
    <div style="max-height:300px;overflow:auto;overflow-x:visible">${rowsHtml}</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:8px;font-size:10px;color:var(--t3)">
      ${[['1–5',0.85],['6–10',0.58],['11–15',0.38],['16+',0.22]].map(([l,a])=>`<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:12px;height:10px;border-radius:2px;background:rgba(6,182,212,${a})"></span>rank ${l}</span>`).join('')}
      <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:12px;height:10px;border-radius:2px;background:rgba(6,182,212,.4);box-shadow:inset 0 -2px 0 var(--red)"></span>completed without a +10% move</span>
      <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:12px;height:10px;border-radius:2px;background:rgba(148,163,184,.06)"></span>not shortlisted</span>
    </div>`;

  // ── Panel B — outcome ranges for one issue date: what each pick did after being
  // recommended. Position carries the story (bar above/below the entry baseline);
  // green/red is redundant with position, so the deutan 6–8 ΔE band is covered by
  // secondary encoding per the palette validator's own rule.
  const desc=[...issues].reverse();
  const defaultIssue=(desc.find(i=>(i.picks||[]).some(p=>p.observations>0))||desc[0]).date;
  if(!PERF_TRACK_ISSUE||!issues.some(i=>i.date===PERF_TRACK_ISSUE)) PERF_TRACK_ISSUE=defaultIssue;
  const sel=issues.find(i=>i.date===PERF_TRACK_ISSUE);
  const picks=[...(sel.picks||[])].sort((a,b)=>(a.rank||99)-(b.rank||99));
  const observed=picks.filter(p=>p.observations>0&&p.bestHighProfitPct!=null);
  const unobserved=picks.length-observed.length;
  const lo=Math.min(-2,...observed.map(p=>p.worstLowProfitPct??0))-1;
  const hi=Math.max(12,...observed.map(p=>p.bestHighProfitPct??0))+1;
  const X=v=>((v-lo)/(hi-lo)*100).toFixed(2)+'%';
  const rocketed=observed.filter(p=>p.rocketDate).length;
  const optHtml=desc.map(i=>`<option value="${i.date}" ${i.date===PERF_TRACK_ISSUE?'selected':''}>${i.date}</option>`).join('');
  const trackRows=observed.map(p=>{
    const wl=Math.min(0,p.worstLowProfitPct??0),bh=Math.max(0,p.bestHighProfitPct??0);
    const fc=p.finalCloseProfitPct;
    const outcome=p.rocketDate?`rocketed d${p.rocketDays}`:p.complete?'no +10% within window':'pending';
    const tip=`${p.symbol} · rank ${p.rank??'—'} · best high ${pct(p.bestHighProfitPct)} (d${p.bestDays??'—'}) · worst ${p.worstLowProfitPct!=null?pct(p.worstLowProfitPct):'—'} · final close ${fc!=null?pct(fc):'—'} · ${outcome}`;
    return `<div style="display:flex;align-items:center;gap:8px;margin-top:3px;${p.complete?'':'opacity:.55'}" title="${escHtml(tip)}">
      <span style="width:92px;flex:0 0 92px;font-size:10px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right">${escHtml(p.symbol)}</span>
      <span style="position:relative;flex:1;height:16px">
        <span style="position:absolute;left:${X(0)};top:0;bottom:0;width:1px;background:var(--border-hi)"></span>
        <span style="position:absolute;left:${X(10)};top:0;bottom:0;width:1px;background:rgba(251,191,36,.45)"></span>
        ${wl<0?`<span style="position:absolute;left:${X(wl)};width:calc(${X(0)} - ${X(wl)});top:4px;height:8px;background:var(--red);border-radius:4px 0 0 4px"></span>`:''}
        ${bh>0?`<span style="position:absolute;left:${X(0)};width:calc(${X(bh)} - ${X(0)});top:4px;height:8px;background:var(--green);border-radius:0 4px 4px 0"></span>`:''}
        ${fc!=null?`<span style="position:absolute;left:${X(fc)};top:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;background:var(--t1);box-shadow:0 0 0 2px var(--bg-card)"></span>`:''}
      </span>
      <span style="width:84px;flex:0 0 84px;font-size:10px;color:var(--t3);font-family:'DM Mono',monospace">${pct(p.bestHighProfitPct)}${p.bestDays!=null?` d${p.bestDays}`:''}</span>
    </div>`;
  }).join('');
  const dumbHtml=`
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:18px 0 2px">
      <span style="font-size:11px;font-weight:700;color:var(--t1)">Pick outcomes after recommendation</span>
      <select onchange="PERF_TRACK_ISSUE=this.value;renderPerformance()" style="padding:3px 8px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--t1);font-size:11px;font-family:'DM Mono',monospace">${optHtml}</select>
      <span style="font-size:10px;color:var(--t3)">${observed.length} observed picks · ${rocketed} rocketed${unobserved?` · ${unobserved} awaiting first next-session observation`:''}</span>
    </div>
    <div style="font-size:10px;color:var(--t3);margin-bottom:8px">Bar spans worst low → best high vs entry price · dot = latest close · amber line = the +10% rocket bar · dimmed rows still in their window</div>
    ${observed.length?trackRows:`<div style="font-size:11px;color:var(--t3);padding:8px 0">No observations yet for this date — picks are first measured on the next session's upload.</div>`}
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:8px;font-size:10px;color:var(--t3)">
      <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:12px;height:8px;border-radius:0 4px 4px 0;background:var(--green)"></span>above entry (best high)</span>
      <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:12px;height:8px;border-radius:4px 0 0 4px;background:var(--red)"></span>below entry (worst low)</span>
      <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:var(--t1);box-shadow:0 0 0 2px var(--bg-card)"></span>latest close</span>
      <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:1px;height:10px;background:rgba(251,191,36,.65)"></span>+10% target</span>
    </div>`;

  return `<div style="padding:14px 16px;border-bottom:1px solid var(--border)">${heatHtml}${dumbHtml}</div>`;
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
    el.innerHTML=`<div style="padding:12px 16px"><div style="text-align:center;padding:60px 40px;color:var(--t2)"><div style="font-size:16px;font-weight:700;color:var(--t1);margin-bottom:8px">No Tradebook Loaded</div><div>Upload TRADEBOOK.csv to see performance analytics. Open Positions and Latest Session are on the Rankings tab.</div></div></div>`;
    return;
  }

  const clr=(v)=>v===0?'var(--t2)':v>0?'var(--green)':'var(--red)';
  const fmtPerfRs=(v)=>fmtSignedINR(v);
  const fmtPct=(v)=>(v>=0?'+':'')+v.toFixed(2)+'%';

  const allTripsRaw=tb.tripsData||[];
  if(!allTripsRaw.length&&tb.roundTrips>0){
    el.innerHTML=`<div style="padding:12px 16px"><div style="text-align:center;padding:60px 40px;color:var(--t2)"><div style="font-size:16px;font-weight:700;color:var(--t1);margin-bottom:8px">Re-upload TRADEBOOK.csv</div><div>Brain has ${tb.roundTrips} trades stored in the old format. Re-upload TRADEBOOK.csv once to rebuild with full trip data.</div></div></div>`;
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
  const recPos=getRecommendedPositionSize(p);
  applyLearnedMaxAllocDefault(recPos);
  const posRatio=(p.avgCapital>0&&recPos.value)?recPos.value/p.avgCapital:null;
  const recPosSub=recPos.value
    ? `${recPos.source}${posRatio?` · ${(posRatio*100).toFixed(0)}% of avg`:''}`
    : recPos.source;

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
    {label:'Recommended Position',value:recPos.value?fmtINR(recPos.value):'—',color:recPos.value?'var(--amber)':'var(--t3)',sub:`Auto-fills Max Alloc · ${recPosSub}`},
    {label:'Review After',value:effectiveReviewDays?effectiveReviewDays+'d':'—',color:effectiveReviewDays?'var(--amber)':'var(--t3)',sub:exitPolicy&&exitPolicy.velocityPctPerDay!=null?`Exit review horizon · realised baseline ${exitPolicy.holdDays}d`:'Re-upload tradebook to learn'},
    {label:'Max Drawdown',value:p.maxDrawdown>0?fmtSignedINR(-p.maxDrawdown):'—',color:'var(--red)',sub:'Worst peak-to-trough fall in this period'},
    {label:'Largest Loss',value:fmtSignedINR(p.largestLossRs),color:'var(--red)',sub:'Worst single lot, net of charges'},
    {label:'Avg Hold',value:p.avgHoldDays+'d',color:'var(--t1)',sub:'How long a position actually lasts'},
  ];
  if(recSummary.evaluated){
    kpis.push({label:'Rocket Conversion',value:recSummary.conversionPct+'%',color:recSummary.conversionPct>=20?'var(--green)':recSummary.conversionPct>=10?'var(--amber)':'var(--red)',sub:`Picks that hit the target · ${recSummary.rockets}/${recSummary.evaluated} completed`});
  }
  // Same-day exit headroom (owner insight 2026-07-21): on the days you sold, how much
  // higher did the stock trade AFTER your exit that same day? This is the measured cost
  // of overriding the GTT manually — the decision it changes is "hold to the target".
  // Diagnostic store only; it feeds no policy.
  const exitOpp=getSameDayExitOpportunitySummary();
  if(exitOpp.exits>=5){
    const activeTgt=(typeof getEffectiveTgtPct==='function')?getEffectiveTgtPct():null;
    const missColor=activeTgt!=null&&exitOpp.avgMissed>=activeTgt?'var(--red)':exitOpp.avgMissed>=1?'var(--amber)':'var(--green)';
    kpis.push({label:'Same-Day Exit Headroom',value:'+'+exitOpp.avgMissed.toFixed(2)+'%',color:missColor,sub:`Stock kept rising past your exit on ${exitOpp.upsideExits}/${exitOpp.exits} sell days · ${fmtINR(exitOpp.missedValue)} left same-day${activeTgt!=null?` · active target is ${activeTgt.toFixed(1)}%`:''}`});
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
    {label:'Avg Positions/Entry Day',value:p.avgPositionsPerEntryDay.toFixed(2),color:'var(--t1)',sub:`${p.positionCount} positions across ${p.entryDays} entry days`},
  ];
  if(recSummary.evaluated){
    const bestUpside=recSummary.avgBestHighPct;
    detailKpis.push(
      {label:'Shortlist Best High (mean)',value:bestUpside!=null?(bestUpside>=0?'+':'')+bestUpside.toFixed(2)+'%':'—',color:bestUpside!=null?(bestUpside>=0?'var(--green)':'var(--red)'):'var(--t3)',sub:'Avg best GROSS high a shortlisted pick reached · pre-cost, not the target'},
      {label:'Time to Rocket (mean)',value:recSummary.avgRocketDays!=null?recSummary.avgRocketDays+'d':'—',color:recSummary.avgRocketDays!=null?'var(--amber)':'var(--t3)',sub:`Mean days to convert · the ${recSummary.horizonDays}d window comes from the 75th percentile, not this mean`}
    );
  }
  if(entrySummary.completed){
    detailKpis.push(
      {label:'Entry Best Net (mean)',value:(entrySummary.avgBestNet>=0?'+':'')+entrySummary.avgBestNet.toFixed(2)+'%',color:entrySummary.avgBestNet>=0?'var(--green)':'var(--red)',sub:`Avg best NET high after entry · Harvest uses a percentile of this pool, not the mean`},
      {label:'Entry Peak Velocity',value:(entrySummary.avgVelocity>=0?'+':'')+entrySummary.avgVelocity.toFixed(3)+'%/d',color:entrySummary.avgVelocity>=0?'var(--green)':'var(--red)',sub:`Speed to peak · ${entrySummary.positive}/${entrySummary.completed} positive · display only, feeds nothing`}
    );
  }

  const kpiCard=k=>`
    <div class="kpi-card">
      <div class="kpi-lbl">${k.label}</div>
      <div class="kpi-val" style="color:${k.color}">${k.value}</div>
      <div class="kpi-sub">${k.sub}</div>
    </div>`;
  const kpiHtml=`<div class="kpi-grid">`+kpis.map(kpiCard).join('')+'</div>'
    +`<details class="perf-more"><summary>More detail (${detailKpis.length} diagnostics)</summary>`
    +`<div class="kpi-grid" style="margin-top:10px">`+detailKpis.map(kpiCard).join('')+'</div></details>';

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
    {key:'sym',label:'Symbol',align:'left',fmt:v=>v,clrFn:()=>'var(--t1)',bold:true},
    {key:'netPnl',label:'Net P&L',align:'right',bold:true,fmt:fmtPerfRs,clrFn:clr},
    {key:'trades',label:'Lots',align:'right',fmt:v=>v,clrFn:()=>'var(--t2)'},
    {key:'winRate',label:'Win%',align:'right',fmt:v=>v+'%',clrFn:v=>v>=60?'var(--green)':v>=40?'var(--amber)':'var(--red)'},
    {key:'avgPct',label:'Avg%',align:'right',fmt:fmtPct,clrFn:clr},
    {key:'edge',label:'Edge',align:'right',bold:true,fmt:v=>v.toFixed(2),clrFn:v=>v>100?'var(--green)':v>0?'var(--amber)':'var(--red)'},
  ];
  const symTbl=makeSortableTable('perf-sym',symCols,symRows,'edge',-1);

  const timeFmt=v=>{const hh=Math.floor(v/60),mm=v%60,h12=hh===0?12:hh>12?hh-12:hh,mer=hh<12?'AM':'PM';return h12+':'+(mm===0?'00':String(mm).padStart(2,'0'))+' '+mer;};
  const _buyMap=Object.fromEntries((p.hourBreakdown||[]).map(r=>[r.hour,{...r,edge:+((r.winRate*r.avgPct)*Math.min(1,r.trades/5)).toFixed(2)}]));
  const _sellMap=Object.fromEntries((p.sellHourBreakdown||[]).map(r=>[r.hour,{...r,edge:+((r.winRate*r.avgPct)*Math.min(1,r.trades/5)).toFixed(2)}]));
  const _allHours=[...new Set([...Object.keys(_buyMap),...Object.keys(_sellMap)].map(Number))].sort((a,b)=>a-b);
  const _med=arr=>{if(!arr.length)return 0;const s=[...arr].sort((a,b)=>a-b);return s[Math.floor(s.length/2)];};
  const _medBuy=_med(Object.values(_buyMap).map(r=>r.edge));
  const _medSell=_med(Object.values(_sellMap).map(r=>r.edge));
  const tradeWindowRows=_allHours.map(h=>{
    const b=_buyMap[h], s=_sellMap[h];
    const bEdge=b?b.edge:null, sEdge=s?s.edge:null;
    const goodBuy=bEdge!=null&&bEdge>=_medBuy;
    const goodSell=sEdge!=null&&sEdge>=_medSell;
    let action='&mdash;', actionC='var(--t3)';
    if(goodBuy&&goodSell){action='Enter + Exit';actionC='var(--cyan)';}
    else if(goodBuy){action='Enter';actionC='var(--green)';}
    else if(goodSell){action='Exit';actionC='var(--amber)';}
    return {hour:h,bTrades:b?b.trades:null,bWin:b?b.winRate:null,bEdge,sTrades:s?s.trades:null,sWin:s?s.winRate:null,sEdge,action,actionC};
  });
  PERF_TRADE_WINDOWS=tradeWindowRows;
  const NA='<span style="color:var(--t3)">&mdash;</span>';
  const winClr=v=>v>=60?'var(--green)':v>=40?'var(--amber)':'var(--red)';
  const edgeClr=v=>v>2?'var(--green)':v>0?'var(--amber)':'var(--red)';
  const tradeWindowCols=[
    {key:'hour',label:'Time',align:'left',fmt:timeFmt,clrFn:()=>'var(--t1)'},
    {key:'bTrades',label:'Buy Lots',align:'right',fmt:v=>v??NA,clrFn:()=>'var(--t2)'},
    {key:'bWin',label:'Buy Win%',align:'right',fmt:v=>v!=null?v+'%':NA,clrFn:v=>v!=null?winClr(v):'var(--t3)'},
    {key:'bEdge',label:'Buy Edge',align:'right',bold:true,fmt:v=>v!=null?v.toFixed(2):NA,clrFn:v=>v!=null?edgeClr(v):'var(--t3)'},
    {key:'sTrades',label:'Sell Lots',align:'right',fmt:v=>v??NA,clrFn:()=>'var(--t2)'},
    {key:'sWin',label:'Sell Win%',align:'right',fmt:v=>v!=null?v+'%':NA,clrFn:v=>v!=null?winClr(v):'var(--t3)'},
    {key:'sEdge',label:'Sell Edge',align:'right',bold:true,fmt:v=>v!=null?v.toFixed(2):NA,clrFn:v=>v!=null?edgeClr(v):'var(--t3)'},
    {key:'action',label:'Signal',align:'left',fmt:(v,row)=>`<span style="color:${row.actionC};font-weight:700">${v}</span>`,clrFn:()=>''},
  ];
  const {mins:_twMins}=istNow();const _twBucket=Math.floor(_twMins/30)*30;
  const tradeWindowTbl=makeSortableTable('tbl-trade-windows',tradeWindowCols,tradeWindowRows,'hour',1,row=>row.hour===_twBucket?'background:rgba(99,102,241,.12);outline:1px solid rgba(99,102,241,.3);outline-offset:-1px':'');
  const hasTradeWindows=tradeWindowRows.length>0;

  const periodPills=['all','1m','3m','6m','1y'].map(p=>{
    const active=PERF_PERIOD_FILTER===p;
    const label=p==='all'?'All':p==='1m'?'1M':p==='3m'?'3M':p==='6m'?'6M':'1Y';
    return `<button onclick="PERF_PERIOD_FILTER='${p}';renderPerformance()" style="padding:5px 14px;border-radius:20px;border:1px solid ${active?'var(--amber)':'var(--border)'};background:${active?'rgba(251,191,36,.15)':'transparent'};color:${active?'var(--amber)':'var(--t3)'};font-size:12px;font-weight:${active?700:500};cursor:pointer">${label}</button>`;
  }).join('');
  const periodPillsHtml=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
    <span style="font-size:11px;color:var(--t3);font-weight:600;text-transform:uppercase;letter-spacing:.06em">Period</span>
    ${periodPills}
  </div>`;

  const perfCard=(title,content,maxH,id)=>`
    <div ${id?`id="${id}" `:''}style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;margin-top:12px;overflow:hidden">
      <div style="padding:10px 16px;font-size:10px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid var(--border)">${title}</div>
      <div style="overflow:auto${maxH?';max-height:'+maxH:''}">${content}</div>
    </div>`;

  const _navLink=(id,label,show)=>show?`<a href="#${id}" onclick="event.preventDefault();scrollToSection('${id}')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:11px;font-weight:600;text-decoration:none;cursor:pointer;white-space:nowrap">${label}</a>`:'';
  const perfNav=`<nav style="position:sticky;top:var(--hdr-h,72px);z-index:50;background:var(--bg);padding:8px 0 10px;margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--border);box-shadow:0 2px 8px rgba(0,0,0,0.3);overflow-x:auto;-webkit-overflow-scrolling:touch">
    ${_navLink('perf-kpi','📊 KPIs',true)}
    ${_navLink('perf-monthly','📅 Monthly',monthRows.length>0)}
    ${_navLink('perf-trade-windows','🕐 Trading Windows',hasTradeWindows)}
    ${_navLink('perf-stocks','📈 Stocks',p.symBreakdown.length>0)}
    ${_navLink('perf-outcomes','Outcome Feedback',true)}
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
  let trackingHtml='';
  try{trackingHtml=buildRecommendationTrackingHTML();}catch(e){console.warn('Recommendation tracking viz failed',e);}
  const outcomeHtml=perfCard('Recommendation Outcome Feedback',
    trackingHtml
    +`<div style="padding:14px 16px;color:var(--t2);font-size:12px;line-height:1.7"><div><strong style="color:var(--t1)">Actual entries:</strong> ${entryOutcomeText}</div><div style="margin-top:8px"><strong style="color:var(--t1)">Eligible shortlist:</strong> ${outcomeText}</div><div style="margin-top:8px"><strong style="color:var(--t1)">Same-day exit opportunity:</strong> ${escapeText}</div><div style="margin-top:8px;color:var(--t3)">Earlier trading-day feature states versus the later current 1D top-1% outcome train raw rocket relevance. Completed shortlist and executed-entry outcomes are shown as confidence context only, while tradebook costs plus hard high-move outcomes refine sizing, review timing, and the single Harvest target.</div></div>`,'','perf-outcomes');

  el.innerHTML=`
    <div style="padding:12px 16px">
      ${perfNav}
      ${periodPillsHtml}
      <div style="font-size:10px;color:var(--t3);margin-bottom:12px">${periodLabel} · ${p.roundTrips} lots</div>
      <div id="perf-kpi">${kpiHtml}</div>
      ${monthRows.length?perfCard('Monthly Breakdown',monthTbl.getHtml(),'','perf-monthly'):''}
      ${hasTradeWindows?perfCard('Trading Windows <span style="font-size:10px;color:var(--t3);font-weight:400">Buy Edge &gt; 2 = Enter · Sell Edge &gt; 2 = Exit · hover Edge columns to sort</span>',tradeWindowTbl.getHtml(),'','perf-trade-windows'):''}
      ${p.symBreakdown.length?perfCard('Stocks',symTbl.getHtml(),'360px','perf-stocks'):''}
      ${outcomeHtml}
    </div>`;

  setTimeout(()=>{monthTbl.render();symTbl.render();tradeWindowTbl.render();},0);
}

function schedulePerformanceRender(){
  if(document.visibilityState==='hidden'){
    PERF_RENDER_WAITING_FOR_VISIBLE=true;
    return;
  }
  if(PERF_RENDER_QUEUED) return;
  PERF_RENDER_QUEUED=true;
  const el=document.getElementById('perfContent');
  if(el&&!PERF_RENDERED) el.innerHTML=`<div style="text-align:center;padding:60px 40px;color:var(--t2)"><div style="font-size:34px;margin-bottom:14px">📈</div><div style="font-size:15px;font-weight:700;color:var(--t1);margin-bottom:8px">Calculating performance</div><div>Rankings are ready while trade analytics finish in the background.</div></div>`;
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
  if(!(ts>0)) return getSessionDate();
  const ist=new Date(ts+5.5*3600000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth()+1).padStart(2,'0')}-${String(ist.getUTCDate()).padStart(2,'0')}`;
}
function isCurrentSessionFile(file){
  return inputFileSessionDate(file)===getSessionDate();
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
      fmt:(v,r)=>`<span style="font-size:11px;color:${r.active?'var(--t1)':'var(--t3)'}">${escHtml(v)}${r.inactiveNote?`<div style="font-size:10px;color:var(--red);margin-top:2px">${r.inactiveNote}</div>`:''}</span>`,
      totFmt:()=>`<span style="font-size:11px;color:var(--t2);font-weight:700">Total</span>`},
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
      fmt:(v,r)=>`<button onclick="removeSurvRule('${v}')" style="padding:4px 8px;border-radius:6px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.08);color:var(--red);font-size:10px;font-weight:700;cursor:pointer">Remove</button>`,
      totFmt:()=>''},
  ];
  const hfTotalsFlagged=hfRows.reduce((s,r)=>s+(r.active?(r.flagged||0):0),0);
  _methTbls.hf=makeSortableTable('tbl-hf',hfCols,hfRows,'flagged',-1,null,{
    criteria:null,flagged:hfTotalsFlagged,ruleKey:null,
  });

  const survActiveThisSession=SURV_HEADERS.length>0;
  const survMeta=survActiveThisSession
    ? `<div style="font-size:11px;color:var(--t3);margin-top:8px">REG1 file active this session. Configured rules above are a hard filter — flagged stocks are removed from Rankings entirely. Every other flagged REG1 column still subtracts up to 12 points from the Radar composite score and appears on the stock's ⚠ badge.</div>`
    : `<div style="margin-top:8px;padding:8px 10px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;font-size:11px;color:var(--red)">NSE REG1 data not active — surveillance rules cannot filter until a REG1 file is loaded.</div>`;

  return `
    <h3 id="meth-filters" style="margin-top:28px">Surveillance Hard Filters (NSE REG1)</h3>
    <p style="color:var(--t3);font-size:11px;margin-bottom:10px">Each row is an exact REG1 column. Any stock flagged under a configured column is weeded out of Rankings, basket selection, and outcome tracking. Exchange series, status and price band separately govern basket eligibility.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <input id="survRuleInput" type="text" placeholder="${SURV_HEADERS.length?'Type to search REG1 columns…':'Load NSE ZIP to enable suggestions'}" list="survRuleDatalist" onkeydown="if(event.key==='Enter'){event.preventDefault();addSurvRule();}" style="flex:1;min-width:260px;padding:9px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;color:var(--t1);font-size:12px;outline:none">
      <datalist id="survRuleDatalist">${datalistHtml}</datalist>
      <button class="btn" onclick="addSurvRule()" style="font-weight:700">+ Add Rule</button>
    </div>
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div style="overflow-x:auto">${_methTbls.hf.getHtml()}</div>
    </div>
    <div style="font-size:10px;color:var(--t3);margin-top:7px">Held P&L is live, unrealised P&L for your currently held stocks flagged by that exact REG1 column. A stock with multiple flags appears in each relevant row, so rule-level P&L is not totalled.</div>
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
    return `<div style="padding:12px 14px;background:rgba(148,163,184,.06);border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--t3);margin-top:12px">${msg}</div>`;
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
      return `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:4px;padding:2px 6px;margin:2px 3px 2px 0;white-space:nowrap;font-family:'DM Mono',monospace"><span style="font-weight:700;color:var(--amber);font-size:11px">${escHtml(sym)}</span><span style="color:${pnlColor};font-size:10px">${pnlStr}</span></span>`;
    }).join('');
    return {col:r.col,sessions:r.sessions,lastCount:r.lastCount,winRate:r.winRate,avgPnl:r.avgPnl,pnlRs:r.pnlRs,pnlPct:r.pnlPct,
      verdict,_conf:conf,_maxSess:maxSess,heldPills,_heldCount:stocks.length,_addBtn:0};
  });
  const scCols=[
    {key:'col',label:'Surveillance Column',align:'left',fmt:(v)=>`<span style="font-size:11px" title="${escHtml(v)}">${escHtml(v)}</span>`},
    {key:'lastCount',label:'Holdings Flagged',align:'right',fmt:(v)=>`<span style="color:var(--t3);font-family:'DM Mono',monospace">${v}</span>`},
    {key:'pnlRs',label:'Unrealised P&L ₹',align:'right',fmt:(v)=>`<span style="color:${v<0?'var(--red)':v>0?'var(--green)':'var(--t3)'};font-weight:700;font-family:'DM Mono',monospace" title="Total current unrealised P&L in rupees across holdings currently flagged by this column">${fmtSignedINR(v)}</span>`},
    {key:'pnlPct',label:'Unrealised P&L %',align:'right',fmt:(v)=>`<span style="color:${v<0?'var(--red)':v>0?'var(--green)':'var(--t3)'};font-weight:700;font-family:'DM Mono',monospace" title="Capital-weighted current unrealised P&L percentage across holdings currently flagged by this column">${v>=0?'+':''}${v.toFixed(2)}%</span>`},
    {key:'verdict',label:'Signal',align:'left',fmt:(v)=>`<span style="color:${v.startsWith('🚫')?'var(--red)':v.startsWith('✅')?'var(--green)':'var(--amber)'};font-weight:700">${v}</span>`},
    {key:'heldPills',label:'Held Positions',align:'left',fmt:(v,row)=>v||`<span style="color:var(--t3);font-size:11px">—</span>`},
    {key:'_addBtn',label:'',align:'right',fmt:(v,row)=>`<button onclick="addSurvRule(${escHtml(JSON.stringify(row.col))})" style="padding:4px 8px;border-radius:6px;border:1px solid rgba(34,197,94,.3);background:rgba(34,197,94,.08);color:var(--green);font-size:10px;font-weight:700;cursor:pointer">Add</button>`},
  ];
  _methTbls.sc=makeSortableTable('tbl-sc',scCols,scRows,'pnlPct',1); // worst weighted P&L% first
  return `
    <h4 id="meth-surv-corr" style="margin:16px 0 6px;font-size:13px;color:var(--t2)">📊 Surveillance P&L Correlation
      <button onclick="if(confirm('Reset surveillance correlation accumulator?')){SURV_CORR_ACC={};SURV_CORR_LAST_TAG=null;FS.set(SURV_CORR_STORE,{});_refreshHFSection();}" style="margin-left:12px;padding:3px 8px;border-radius:6px;border:1px solid var(--border);background:none;color:var(--t3);font-size:10px;cursor:pointer">Reset</button>
    </h4>
    <p style="font-size:11px;color:var(--t3);margin-bottom:8px">For each surveillance column, shows the total current unrealised P&L in ₹ and the capital-weighted unrealised P&L% of your <em>currently held stocks</em> flagged by that column. A deep negative P&L% means those flagged holdings are underwater. Signal = 🚫 Filter when weighted P&L% &lt; −0.5%. A stock with several flags appears in each relevant rule row, so rows are not totalled.</p>
    ${staleNote}
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div style="overflow-x:auto">${_methTbls.sc.getHtml()}</div>
    </div>`;
}

function renderMethodology(){
  try{ return _renderMethodologyInner(); }
  catch(err){
    console.error('renderMethodology error:',err);
    const mc=document.getElementById('methContent');
    if(mc) mc.innerHTML=`<div style="padding:20px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);border-radius:10px;color:var(--red);font-family:'DM Mono',monospace;font-size:12px"><strong>Methodology render error</strong><pre style="margin-top:10px;white-space:pre-wrap;font-size:11px;color:var(--t2)">${escHtml(err&&err.stack||String(err))}</pre></div>`;
  }
}
function buildRadarLedgerHTML(){
  if(!RADAR.headers.length) return '<p style="color:var(--t3);font-size:12px">Load files to audit every screener column. The ledger is rebuilt from each fresh upload.</p>';
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
    else if(f){use=radarIsPriceLevel(h)?'Converted to % distance from current price, then ranked':'Winsorized and cross-sectionally percentile-ranked';group=RADAR_GROUPS[f.group].label;w=f.weight;sep=f.effect;}
    else use=cov===0?'Empty in this snapshot; retained in audit':'Constant, sparse, or non-numeric; retained in audit';
    return `<tr><td style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:600;color:var(--t1);white-space:normal;min-width:230px">${escHtml(h)}</td><td style="font-size:11px;color:var(--t2)">${escHtml(use)}</td><td style="font-size:10px;color:var(--cyan);text-transform:uppercase;font-weight:700">${group}</td><td style="font-weight:700">${w?w.toFixed(3):'0'}</td><td><span style="display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;background:${cov>.9?'var(--green)':cov>.5?'var(--amber)':'var(--red)'}"></span>${(cov*100).toFixed(0)}%</td><td>${sep===null?'—':`<span class="${sep>=0?'pos':'neg'}">${sep>=0?'+':''}${(sep*100).toFixed(1)} pp</span>`}</td></tr>`;
  }).join('');
  return `<div class="corr-wrap"><table class="ct"><thead><tr><th>Column / Feature</th><th>Use</th><th>Group</th><th>Model Weight</th><th>Coverage</th><th>Today-Rocket Separation</th></tr></thead><tbody>${ledgerRows}</tbody></table></div>`;
}
function buildIndicatorWatchHTML(){
  let w;try{w=evaluateIndicatorWatch();}catch(e){return '';}
  const resolved=w.resolvedSessions||0;
  const collecting=resolved<IW_MIN_SESSIONS;
  const head=`<h3 id="meth-watch" style="margin-top:28px">Indicator Watch <span style="font-size:12px;color:var(--t3);font-weight:400">automatic orientation guardrail</span></h3>`;
  const intro=`<p style="color:var(--t2);font-size:12.5px;line-height:1.7">Each accepted session the system records where every liquid stock (turnover ≥ ₹25L) sits on every direction-testable indicator, then ${IW_WINDOW} sessions later checks whether the end the model <em>rewards</em> actually held more of the movers — or fewer. It keeps a rolling ${IW_LOG_MAX}-session tally per indicator and flags one only when it looks backwards on <strong>both</strong> a +5% and a +10% forward move, past a strict bar corrected for watching so many at once. Nothing changes automatically — a flag is a note to bring to review before inverting anything.</p>`;
  if(collecting){
    return `${head}${intro}<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:14px 18px;font-size:12px;color:var(--t2)">⏳ Collecting evidence — <strong>${resolved}/${IW_MIN_SESSIONS}</strong> resolved sessions (need ${IW_MIN_SESSIONS} before any warning; ${w.pending} snapshot${w.pending===1?'':'s'} awaiting their ${IW_WINDOW}-session resolution). No orientation warnings until enough forward data exists.</div>`;
  }
  if(!w.flags.length){
    return `${head}${intro}<div style="background:var(--bg-card);border:1px solid rgba(34,197,94,.25);border-radius:10px;padding:14px 18px;font-size:12px;color:var(--t2)">✓ No indicator is backwards on both outcomes over the last ${resolved} resolved sessions (${w.testable} indicators have enough samples to test). Every direction-testable prior is oriented consistently with the forward evidence.</div>`;
  }
  const rows=w.flags.map(f=>{
    const dir=f.sign>0?'rewards its HIGH end':'rewards its LOW end';
    return `<tr>
      <td style="font-weight:700;color:var(--t1)">${escHtml(f.name)}</td>
      <td style="font-size:11px;color:var(--t2)">prior ${dir}</td>
      <td style="color:var(--red);font-weight:700;font-family:'DM Mono',monospace">${f.e5.mean>0?'+':''}${f.e5.mean} (n${f.e5.n})</td>
      <td style="color:var(--red);font-weight:700;font-family:'DM Mono',monospace">${f.e10.mean>0?'+':''}${f.e10.mean} (n${f.e10.n})</td>
    </tr>`;
  }).join('');
  return `${head}${intro}
    <div style="background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:12px 16px;margin-bottom:10px;font-size:12px;color:var(--t1)"><strong>⚠ ${w.flags.length} indicator${w.flags.length===1?'':'s'} looks backwards over the last ${resolved} sessions.</strong> The rewarded end held <em>fewer</em> movers on both +5% and +10%. Bring these to review — inverting a prior is a deliberate, logged code change, never automatic.</div>
    <div style="overflow-x:auto"><table class="ct" style="min-width:620px"><thead><tr><th>Indicator</th><th>Prior orientation</th><th title="Mean forward decile gap (mover minus non-mover), normalized; negative vs the rewarded end = backwards">+5% forward gap</th><th>+10% forward gap</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function _renderMethodologyInner(){
  const mc=document.getElementById('methContent');
  if(!mc) return;
  const groupsHTML=Object.values(RADAR_GROUPS).map(g=>`<div class="rr-group"><b>${g.label}<i>${g.budget}%</i></b><span>${g.desc}</span><meter min="0" max="20" value="${g.budget}"></meter></div>`).join('');
  const diagHTML=`
    <div class="rr-diag">
      <div><b>${RADAR.rockets||0}</b><span>same-day ≥10% rockets</span></div>
      <div><b>${RADAR.features.length||0}</b><span>informative modeled features</span></div>
      <div><b>${RADAR.headers.length||0}</b><span>screener columns audited</span></div>
      <div><b>${RADAR.ms?(RADAR.ms/1000).toFixed(2)+'s':'—'}</b><span>parse + score time</span></div>
    </div>`;
  const hardFiltersHTML=buildHardFilterMethodologyHTML(ENGINE_DATA);
  mc.innerHTML=`
    <nav style="position:sticky;top:var(--hdr-h,72px);z-index:50;background:var(--bg);padding:8px 0 10px;margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--border);box-shadow:0 2px 8px rgba(0,0,0,0.3);overflow-x:auto;-webkit-overflow-scrolling:touch">
      <a href="#meth-scoring" onclick="event.preventDefault();scrollToSection('meth-scoring')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:11px;font-weight:600;text-decoration:none;cursor:pointer">⚙ Scoring System</a>
      <a href="#meth-ledger" onclick="event.preventDefault();scrollToSection('meth-ledger')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:11px;font-weight:600;text-decoration:none;cursor:pointer">📒 Feature Ledger</a>
      <a href="#meth-watch" onclick="event.preventDefault();scrollToSection('meth-watch')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:11px;font-weight:600;text-decoration:none;cursor:pointer">🧭 Indicator Watch</a>
      <a href="#meth-filters" onclick="event.preventDefault();scrollToSection('meth-filters')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:11px;font-weight:600;text-decoration:none;cursor:pointer">🛡 Surveillance</a>
      <a href="#meth-guide" onclick="event.preventDefault();scrollToSection('meth-guide')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:11px;font-weight:600;text-decoration:none;cursor:pointer">📖 Use & Risk</a>
    </nav>
    <h3 id="meth-scoring">Radar Composite — Same-Day Transparent Scoring</h3>
    <p><strong>Evidence boundary:</strong> one day's cross-section cannot train or validate tomorrow's probability. The score is a transparent relative ranking built from robust market-wide normalization, a same-day rocket-archetype diagnostic, and engineered continuation priors. It is a research screener, not investment advice.</p>
    <div class="m-grid">
      <div class="m-card"><h4>Composite Architecture</h4><p>Every informative screener column enters through a typed transformation, a robust percentile, and a budgeted feature group. Exchange reports add authoritative series, price band, status, delivery, trades, 52-week range, surveillance and deal context.</p><div class="rr-groups" style="margin-top:10px">${groupsHTML}</div></div>
      <div class="m-card"><h4>What the Score Does</h4><ol style="padding-left:18px;color:var(--t2);font-size:12px;line-height:1.7">
        <li>Winsorizes transformed numeric inputs at the 2nd and 98th percentiles.</li>
        <li>Converts values to ranks across the uploaded universe, preventing unit scale from dominating.</li>
        <li>Measures each feature’s separation between today’s ≥10% movers and the rest, then heavily shrinks it because today supplies few rockets.</li>
        <li>Blends that diagnostic with finance-aware priors for momentum, participation, breakout structure, liquidity, volatility and trend.</li>
        <li>Cross-checks official delivery, close versus average price, 52-week position, deal activity and surveillance flags.</li>
        <li>Strongly penalizes non-EQ, inactive and sub-10% price-band securities while retaining them in the visible ranking for audit. Only eligible securities enter the basket.</li>
        <li>Penalizes a required 10% move above 2.5 normal daily ranges; moves above three ranges receive a severe penalty.</li>
      </ol>${diagHTML}</div>
      <div class="m-card"><h4>Held Suppression & Basket</h4><p>Held positions (Holdings + Positions + today's net Orders buys) never re-enter the buy ranking. The basket keeps the learned exit system: quantities come from the charge-aware score-weighted allocator, and every exported order carries the Harvest GTT target plus the ATR-scaled capped stop (${SL_MIN_PCT.toFixed(1)}%–${SL_MAX_PCT.toFixed(1)}%).</p></div>
      <div class="m-card"><h4>What Still Learns</h4><p>The scorer itself is stateless by design. The execution layer keeps learning from your own results: the Harvest GTT target from flagged candidates' later attainable highs, the adaptive stop and review horizon from realised tradebook outcomes, position sizing from realised risk, and the same-day exit diagnostic from your sells against that day's highs.</p></div>
    </div>
    <h3 id="meth-ledger" style="margin-top:28px">Feature Ledger <span style="font-size:12px;color:var(--t3);font-weight:400">(${RADAR.features.length||0} modeled of ${RADAR.headers.length||0} columns)</span></h3>
    ${buildRadarLedgerHTML()}
    ${buildIndicatorWatchHTML()}
    <div id="meth-hf-wrap">${hardFiltersHTML}</div>
    <h3 id="meth-guide" style="margin-top:28px">Use & Risk</h3>
    <div class="m-grid">
      <div class="m-card"><h4>Entry Workflow</h4><ol style="padding-left:18px;color:var(--t2);font-size:12px;line-height:1.7">
        <li>Upload a screener snapshot at a consistent time.</li>
        <li>Start with liquid, low- or medium-risk names whose top contributions span several groups.</li>
        <li>Reject candidates driven by one heroic feature, corporate-action distortions, circuits, stale prints, surveillance restrictions, or news you have not checked.</li>
        <li>Demand confirmation: hold above VWAP/opening range, participation that persists, and a pre-defined invalidation price.</li>
        <li>Cap position size from account risk, not from enthusiasm. Enthusiasm has never met a denominator it respected.</li>
      </ol></div>
      <div class="m-card"><h4>Interpretation</h4><ul style="padding-left:18px;color:var(--t2);font-size:12px;line-height:1.7">
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
    {key:'score',label:'Rocket Score',s:1},
    {key:'symbol',label:'Symbol',s:1},
    {key:'setup',label:'Setup',s:1},
    {key:'series',label:'Series / Band',s:1},
    {key:'stretch',label:'10% Stretch',s:1},
    {key:'price',label:'Price ₹',s:1},
    {key:'day',label:'Day %',s:1},
    {key:'relvol',label:'Rel Vol',s:1},
    {key:'turnover',label:'Liquidity',s:1},
    {key:'alloc',label:'Alloc ₹',s:0},
    {key:'risk',label:'Risk',s:1},
  ]);
}
let COLS=getCols();

function updateSelectAll(){
  const allSyms=FILT.map(s=>s.symbol);
  const allChecked=allSyms.length>0&&allSyms.every(sym=>SELECTED.has(sym));
  const sa=document.getElementById('chk-all');
  if(sa){sa.indeterminate=!allChecked&&SELECTED.size>0&&allSyms.some(sym=>SELECTED.has(sym));sa.checked=allChecked;}
  renderBasketBtn();
}
function toggleSelectAll(checked){
  if(checked){
    FILT.forEach(s=>EXPORT_EXCLUDED.delete(s.symbol));
    SELECTED=new Set(FILT.filter(s=>s.basketEligible!==false).slice(0,20).map(s=>s.symbol));
  } else {
    FILT.forEach(s=>{if(s.basketEligible!==false)EXPORT_EXCLUDED.add(s.symbol);});
    SELECTED.clear();
  }
  saveFilterState();
  renderTable();
  renderBasketBtn();
}
function toggleStock(sym,checked){
  if(checked){EXPORT_EXCLUDED.delete(sym);SELECTED.add(sym);}
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
    heldPos[pos.symbol]={qty:pos.qty,avg:pos.avg};
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
      pos.qty+=liveQty;
      if(pos.qty<=0) pos.avg=liveAvg||pos.avg||0;
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
        pos.qty-=sQty-bQty;
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
// The single active target: whichever is LOWER — the learned Harvest gross or the
// goal-led gross. A lower goal-led target hits more often while still meeting the
// owner's stated need; Harvest remains the ceiling and the fallback.
function getActiveTargetInfo(){
  const harvest=computeHarvestPlan().targetPct;
  const goal=getGoalLedTargetPct();
  if(goal!=null&&goal<harvest) return {tgtPct:goal,source:'goal',harvestPct:harvest,goalPct:goal};
  return {tgtPct:harvest,source:'harvest',harvestPct:harvest,goalPct:goal};
}
function getEffectiveTgtPct(){
  return getActiveTargetInfo().tgtPct;
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

function getZerodhaMinTrailPoints(price){
  if(!(price>0)) return 0.05;
  if(price<50) return 0.05;
  if(price<100) return 0.10;
  if(price<250) return 0.25;
  if(price<500) return 0.50;
  if(price<1000) return 1;
  if(price<2500) return 2;
  if(price<10000) return 5;
  if(price<20000) return 25;
  return 50;
}

function getPositionTslStore(){
  const store=FS.get(POS_TSL_STORE)||{};
  return store&&typeof store==='object'?store:{};
}
function isPositionTslSymbolKey(key){
  return key&&key!=='gapModel';
}
function clampTslGapPct(value){
  const n=Number(value);
  if(!Number.isFinite(n)) return null;
  return +clampNum(n,TSL_GAP_MIN_PCT,TSL_GAP_MAX_PCT).toFixed(2);
}
function buildPositionTslGapModel(rows, sessionDate){
  const survivors=(rows||[])
    .filter(s=>s?.rocketToday&&s._hardFiltered!==true)
    .map(s=>({
      pullback:Number(s.pullbackFromHighPct),
      retention:Number(s.peakRetention)
    }))
    .filter(s=>Number.isFinite(s.pullback)&&Number.isFinite(s.retention)&&s.retention>=TSL_GAP_RETENTION_FLOOR);
  if(survivors.length<TSL_GAP_MIN_SAMPLES) return null;
  const raw=percentileValue(survivors.map(s=>s.pullback),TSL_GAP_PERCENTILE);
  const gapPct=clampTslGapPct(raw);
  if(gapPct==null) return null;
  return {gapPct,samples:survivors.length,date:sessionDate||getSessionDate(),updatedAt:new Date().toISOString()};
}
function persistPositionTslGapModel(rows, sessionDate){
  const model=buildPositionTslGapModel(rows,sessionDate);
  if(!model) return null;
  const store=getPositionTslStore();
  const next={...store,gapModel:model};
  if(JSON.stringify(store.gapModel||{})!==JSON.stringify(model)) FS.set(POS_TSL_STORE,next);
  return model;
}
function resolvePositionTslGap({scannerRow, adaptiveTGT, gapModel, sessionDate}){
  const model=(gapModel&&typeof gapModel==='object')?gapModel:null;
  const modelSamples=Number(model?.samples)||0;
  const modelGap=clampTslGapPct(model?.gapPct);
  const today=sessionDate||getSessionDate();
  if(model&&model.date===today&&modelSamples>=TSL_GAP_MIN_SAMPLES&&modelGap!=null){
    return {gapPct:modelGap,basis:`learned from ${modelSamples} rockets`,source:'learned',samples:modelSamples,date:model.date};
  }
  const age=model?.date?tradingDaysBetween(model.date,today):null;
  if(model&&modelGap!=null&&modelSamples>=TSL_GAP_MIN_SAMPLES&&age!=null&&age<=5){
    return {gapPct:modelGap,basis:`recent (${String(model.date).slice(5)})`,source:'recent',samples:modelSamples,date:model.date};
  }
  const targetPct=(adaptiveTGT&&isFinite(adaptiveTGT)&&adaptiveTGT>0)?adaptiveTGT:4.2;
  const atrPct=(scannerRow?.atr!=null&&isFinite(scannerRow.atr)&&scannerRow.atr>0)?scannerRow.atr:null;
  const fallback=clampTslGapPct(Math.max(targetPct/2,atrPct||0));
  return {gapPct:fallback??TSL_GAP_MIN_PCT,basis:'ATR fallback',source:'atr',samples:0,date:null};
}

function calcPositionTSL({sym, qty, avgCost, ltp, scannerRow, adaptiveSL, adaptiveTGT, prev}){
  if(!sym||!(qty>0)||!(avgCost>0)||!(ltp>0)||!(adaptiveSL>0)) return null;
  const store=getPositionTslStore();
  const gapModel=store.gapModel||null;
  const prevPosition=(prev&&typeof prev==='object')?prev:{};
  const targetPct=(adaptiveTGT&&isFinite(adaptiveTGT)&&adaptiveTGT>0)?adaptiveTGT:4.2;
  const dayHigh=(scannerRow?.high1d!=null&&isFinite(scannerRow.high1d))?Number(scannerRow.high1d):null;
  const avgChanged=prevPosition?.avg!=null&&Math.abs(prevPosition.avg-avgCost)/avgCost>0.01;
  const qtyIncreased=prevPosition?.qty!=null&&qty>prevPosition.qty;
  const reset=!!(avgChanged||qtyIncreased);
  const storedPeak=(!reset&&prevPosition?.peak!=null&&isFinite(prevPosition.peak))?Number(prevPosition.peak):0;
  const peak=+Math.max(storedPeak,ltp,dayHigh||0).toFixed(2);
  const peakProfitPct=+(((peak-avgCost)/avgCost)*100).toFixed(2);
  const rocketToday=!!scannerRow?.rocketToday;
  const storedMode=!reset&&prevPosition?.mode==='trail'?'trail':null;
  const mode=(storedMode==='trail'||peakProfitPct>=targetPct||rocketToday)?'trail':'protect';
  const gap=resolvePositionTslGap({scannerRow,adaptiveTGT:targetPct,gapModel,sessionDate:getSessionDate()});
  const gapPct=gap.gapPct;
  const tightenPct=getTslMomentumTightenPct(scannerRow,peakProfitPct);
  const effectiveGapPct=clampTslGapPct(Math.max(TSL_GAP_MIN_PCT,gapPct-tightenPct));
  const minStep=getZerodhaMinTrailPoints(avgCost);
  const candidate=+tickPrice(Math.max(0,peak*(1-effectiveGapPct/100))).toFixed(2);
  const fixedStop=+tickPrice(Math.max(0,avgCost*(1-adaptiveSL/100))).toFixed(2);
  const storedTsl=(!reset&&prevPosition?.tsl!=null&&isFinite(prevPosition.tsl))?Number(prevPosition.tsl):null;
  const activeTsl=mode==='trail'?+Math.max(storedTsl||0,candidate).toFixed(2):fixedStop;
  const lockPct=activeTsl!=null?+(((activeTsl-avgCost)/avgCost)*100).toFixed(2):null;
  const distancePoints=activeTsl!=null?+Math.max(0,ltp-activeTsl).toFixed(2):null;
  return {
    tsl:activeTsl,
    rawTsl:activeTsl,
    candidateTsl:candidate,
    trailPoints:+minStep.toFixed(2),
    trailStepPoints:+minStep.toFixed(2),
    minTrailPoints:minStep,
    distancePoints,
    rawDistancePoints:distancePoints,
    gapPct:effectiveGapPct,
    gapBasePct:gapPct,
    gapTightenPct:+tightenPct.toFixed(2),
    lockPct,
    targetPct:+targetPct.toFixed(2),
    basis:gap.basis,
    gapSource:gap.source,
    gapSamples:gap.samples,
    gapDate:gap.date,
    peak,
    peakProfitPct,
    mode,
    atrPct:(scannerRow?.atr!=null&&isFinite(scannerRow.atr))?+Number(scannerRow.atr).toFixed(2):null,
    avg:+avgCost.toFixed(2),
    qty,
    reset,
    updatedAt:new Date().toISOString()
  };
}

let _allocMemo=null; // single-entry memo: renderTable and renderStatusBar share one pass
function computeAlloc(capital, selList){
  if(!capital||!selList.length) return {};
  const maxAllocEl=document.getElementById('fMaxAlloc');
  const maxAllocV=maxAllocEl?parseFloat(maxAllocEl.value)||0:0;
  const effTgt=getEffectiveTgtPct();
  const memoKey=capital+'|'+maxAllocV+'|'+effTgt+'|'+selList.map(s=>s.symbol+':'+s.price+':'+s.rocketScore).join(',');
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
    const tgtPct=(effTgt!=null&&isFinite(effTgt))?effTgt:((s.tgtPct!=null&&isFinite(s.tgtPct))?s.tgtPct:null);
    if(tgtPct===null||tgtPct<=0) return {ok:true,skip:true};
    const sellP=buyP*(1+tgtPct/100);
    const buyChg=calcZerodhaCharges(buyP,qty,false);
    const sellChg=calcZerodhaCharges(sellP,qty,true);
    const charges=buyChg+sellChg;
    return {ok:true,expectedNet:qty*buyP*(tgtPct/100)-charges,charges,tgtPct};
  }

  const rawScore=s=>Math.max(0,Number(s.rocketScore)||0);
  const totalRawScore=selList.reduce((sum,s)=>sum+rawScore(s),0)||1;
  const sortedSel=[...selList].sort((a,b)=>rawScore(b)-rawScore(a));
  const allocMap={},limits={};

  for(const s of sortedSel){
    const buyP=getBuyPrice(s);
    if(!(buyP>0)) continue;
    const rowLimit=Math.min(spendableCapital*(rawScore(s)/totalRawScore),cap);
    limits[s.symbol]=rowLimit;
    const qty=affordableQty(rowLimit,buyP,rowLimit);
    if(qty<=0) continue;
    const ev=evalNet(s,buyP,qty);
    allocMap[s.symbol]={alloc:qty*buyP,debit:buyDebit(buyP,qty),buyCharges:calcZerodhaCharges(buyP,qty,false,false,false),qty,buyPrice:buyP,
      limit:rowLimit,stopDistancePct:getRowStopDistancePct(s),expectedNet:ev.expectedNet,charges:ev.charges,tgtPct:ev.tgtPct};
  }

  let deployed=Object.values(allocMap).reduce((sum,am)=>sum+am.debit,0);
  let residual=spendableCapital-deployed;
  let progress=true;
  while(residual>0&&progress){
    progress=false;
    for(const s of sortedSel){
      const rowLimit=limits[s.symbol]||0;
      let am=allocMap[s.symbol];
      if(!am){
        const buyP=getBuyPrice(s);
        if(!(buyP>0)||rowLimit<buyP||buyDebit(buyP,1)>residual+0.001) continue;
        const qty=1,ev=evalNet(s,buyP,qty);
        allocMap[s.symbol]={alloc:qty*buyP,debit:buyDebit(buyP,qty),buyCharges:calcZerodhaCharges(buyP,qty,false,false,false),qty,buyPrice:buyP,
          limit:rowLimit,stopDistancePct:getRowStopDistancePct(s),expectedNet:ev.expectedNet,charges:ev.charges,tgtPct:ev.tgtPct};
        am=allocMap[s.symbol];
      }
      const buyP=am.buyPrice;
      const nextDebit=buyDebit(buyP,am.qty+1),incremental=nextDebit-am.debit;
      if(incremental>residual+0.001||am.alloc+buyP>am.limit+0.5) continue;
      am.qty++; am.alloc+=buyP; am.debit=nextDebit; am.buyCharges=calcZerodhaCharges(buyP,am.qty,false,false,false);
      const ev=evalNet(s,buyP,am.qty);
      if(!ev.skip){am.expectedNet=ev.expectedNet;am.charges=ev.charges;am.tgtPct=ev.tgtPct;}
      residual-=incremental; deployed+=incremental; progress=true;
    }
  }
  Object.values(allocMap).forEach(am=>delete am.limit);
  _allocMemo={key:memoKey,val:allocMap};
  return allocMap;
}
function getRecommendedPositionSize(perfStats){
  const trips=getAdaptiveTradeTrips(TRADEBOOK_STATS?.tripsData||[]).filter(r=>r&&r.capital>0&&isFinite(r.netPnl)&&isFinite(r.netPnlPct));
  const avgActual=perfStats?.avgCapital||TRADEBOOK_STATS?.avgCapital||0;
  if(trips.length<20||!(avgActual>0)) return {value:avgActual?Math.round(avgActual):null,source:'Need more closed trades for learned sizing'};

  const wins=trips.filter(r=>r.netPnl>0), losses=trips.filter(r=>r.netPnl<=0);
  const median=(arr)=>{const a=arr.filter(v=>isFinite(v)).sort((x,y)=>x-y);return a.length?a[Math.floor(a.length/2)]:null;};
  const avgWinPct=wins.length?meanArr(wins.map(r=>r.netPnlPct)):0;
  const avgLossPct=losses.length?meanArr(losses.map(r=>r.netPnlPct)):0;
  const winRate=trips.length?wins.length/trips.length:0;
  const payoff=avgLossPct<0?avgWinPct/Math.abs(avgLossPct):0;
  const kelly=payoff>0?winRate-(1-winRate)/payoff:0;
  const profitFactor=perfStats?.profitFactor??null;
  const adaptiveSL=capSLDistancePct(TRADEBOOK_STATS?.adaptiveSL||Math.abs(perfStats?.avgLossPct||0)||3)||3;
  const medianLossRs=median(losses.map(r=>Math.abs(r.netPnl)));
  const baseRiskRs=medianLossRs&&medianLossRs>0?medianLossRs:avgActual*(adaptiveSL/100);
  const expectancy=perfStats?.expectancy||0;
  const lossStreak=perfStats?.maxLossStreak||0;
  let riskMult=0.75;
  if(kelly>0) riskMult+=Math.min(0.45,kelly*1.25);
  if(profitFactor!=null) riskMult+=Math.max(-0.25,Math.min(0.25,(profitFactor-1)*0.35));
  if(expectancy>0&&baseRiskRs>0) riskMult+=Math.min(0.25,expectancy/(baseRiskRs*3));
  if(lossStreak>=3) riskMult-=Math.min(0.25,(lossStreak-2)*0.05);
  riskMult=Math.max(0.35,Math.min(1.5,riskMult));
  const learnedRiskRs=baseRiskRs*riskMult;
  let rec=adaptiveSL>0?learnedRiskRs/(adaptiveSL/100):avgActual;
  rec=Math.max(avgActual*0.4,Math.min(avgActual*2.0,rec));
  return {value:Math.round(rec),source:`Learned risk ${fmtINR(Math.round(learnedRiskRs))} @ SL ${adaptiveSL}%`,riskRs:Math.round(learnedRiskRs),kellyPct:kelly*100,riskMult};
}
function applyLearnedMaxAllocDefault(recPos=null){
  const el=document.getElementById('fMaxAlloc');
  if(!el||String(el.value||'').trim()) return false;
  let rec=recPos;
  if(!rec){
    const trips=getAdaptiveTradeTrips(TRADEBOOK_STATS?.tripsData||[]);
    if(trips.length) rec=getRecommendedPositionSize(computePerfStats(trips));
  }
  const value=rec?.value;
  if(!(value>0)) return false;
  el.value=String(Math.round(value));
  el.dataset.autoDefault='1';
  el.title=rec?.source?`Default from Performance Position Size: ${rec.source}`:'Default from Performance Position Size';
  return true;
}
function recomputeAlloc(){
  const capital=parseFloat(document.getElementById('fCapital').value)||0;
  if(!capital){document.querySelectorAll('.alloc-cell').forEach(el=>el.innerHTML='<span style="color:var(--t3);font-size:11px">—</span>');return;}
  const selList=FILT.filter(s=>SELECTED.has(s.symbol));
  const allocMap=computeAlloc(capital, selList);
  const unitLabel='shares';
  document.querySelectorAll('.alloc-cell').forEach(el=>{
    const sym=el.dataset.sym;
    if(!SELECTED.has(sym)){el.innerHTML='<span style="color:var(--t3);font-size:11px">—</span>';return;}
    const am=allocMap[sym];
    if(!am){el.innerHTML='<span style="color:var(--red);font-size:10px">price too high</span>';return;}
    el.innerHTML=`<span style="color:var(--amber);font-weight:700;font-family:'DM Mono',monospace;font-size:12px">${fmtINR(am.alloc)}</span><div style="font-size:9px;color:var(--t3);margin-top:1px">${am.qty} ${unitLabel}</div>`;
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
  const capital=parseFloat(document.getElementById('fCapital').value)||0;
  const selList=FILT.filter(s=>SELECTED.has(s.symbol));
  const sb=document.getElementById('statusBar');
  // update status bar — triggered via renderStatusBar, so leave it
}

function renderHead(){
  COLS=getCols(); // refresh in case ENGINE_DATA changed
  const allChecked=FILT.length>0&&FILT.every(s=>SELECTED.has(s.symbol));
  const someChecked=FILT.some(s=>SELECTED.has(s.symbol));
  document.getElementById('tHead').innerHTML='<tr>'+COLS.map(c=>{
    if(c.key==='chk'){
      return`<th data-key="chk" style="width:32px;text-align:center;padding:8px 6px">
        <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
          <input type="checkbox" id="chk-all" ${allChecked?'checked':''} title="Select / deselect all for the basket export"
            style="width:14px;height:14px;accent-color:var(--amber);cursor:pointer"
            onchange="toggleSelectAll(this.checked)">
          <span style="font-size:7px;color:var(--t3);letter-spacing:.3px;font-weight:700;text-transform:uppercase">Export</span>
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
  return `<span class="info-pill ${cls}" style="padding:2px 8px;font-size:10px">${escHtml(risk||'—')}</span>`;
}
function radarSeriesBandPill(s){
  const ok=s.basketEligible!==false;
  const band=s.band!=null?s.band+'%':'No band';
  const title=ok?'Active EQ security; eligible for the Zerodha basket.':'Ineligible for the basket: '+escHtml((s.gateReasons||[]).slice(0,3).join(', ')||'exchange eligibility');
  return `<span class="info-pill ${ok?'pill-green':'pill-red'}" style="padding:2px 8px;font-size:10px" title="${title}">${escHtml(s.series||'—')} · ${band}</span>`;
}
function renderTable(){
  const capital=parseFloat(document.getElementById('fCapital').value)||0;
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
    const canBuy=s.basketEligible!==false;
    const stretchColor=s.stretch<=2.5?'var(--green)':s.stretch>3?'var(--red)':'var(--amber)';
    // Cells are keyed and joined in COLS order so they always match the (possibly
    // user-reordered) header (v536).
    const cellH={
      chk:`<td style="text-align:center"><input type="checkbox" ${isSelected?'checked':''} ${canBuy?'':'disabled'} style="width:14px;height:14px;accent-color:var(--amber);cursor:${canBuy?'pointer':'not-allowed'}" onclick="event.stopPropagation()" onchange="toggleStock('${s.symbol}',this.checked)" title="${canBuy?'Include in the Zerodha basket export':'Ineligible for the basket'}"></td>`,
      rank:`<td style="font-family:'DM Mono',monospace;font-weight:800;color:var(--t1);text-align:right">${s.rank??'—'}</td>`,
      score:`<td>${radarScoreCell(s.score,'Relative same-day composite score (0-100 percentile, top-weighted). It is a ranking, not a probability.')}</td>`,
      symbol:`<td style="font-family:'Plus Jakarta Sans',sans-serif"><div style="font-weight:700;font-size:13px;color:var(--t1)">${s.symbol}${(()=>{const flags=s.meta?.flags||[];if(!flags.length)return '';return `<span style="font-size:8px;background:rgba(239,68,68,.15);color:var(--red);border-radius:4px;padding:1px 5px;margin-left:5px;font-weight:700;vertical-align:middle" title="NSE surveillance flags: ${escHtml(flags.join(' · '))}">⚠ ${flags.length}</span>`;})()}</div><div style="font-size:9px;color:var(--t3);max-width:220px;overflow:hidden;text-overflow:ellipsis">${escHtml(s.name||'')}</div></td>`,
      setup:`<td style="font-size:11px;color:var(--t2)">${escHtml(s.setup||'—')}</td>`,
      series:`<td>${radarSeriesBandPill(s)}</td>`,
      stretch:`<td style="color:${stretchColor};font-weight:700" title="A 10% move is this many multiples of the strongest daily-range estimate. Lower is more feasible.">${s.stretch!=null&&isFinite(s.stretch)?Number(s.stretch).toFixed(1)+'×':'—'}</td>`,
      price:`<td>${fmtINR(s.price)}</td>`,
      day:`<td>${fPerf(s.day??s.priceChange)}</td>`,
      relvol:`<td>${s.relvol!=null&&isFinite(s.relvol)?Number(s.relvol).toFixed(2)+'×':'—'}</td>`,
      turnover:`<td>${fV(s.turnover)}</td>`,
      alloc:`<td class="alloc-cell" data-sym="${s.symbol}">${(()=>{
        if(!am) return '<span style="color:var(--t3);font-size:11px">—</span>';
        return `<span style="color:var(--amber);font-weight:700;font-family:'DM Mono',monospace;font-size:12px">${fmtINR(am.alloc)}</span><div style="font-size:9px;color:var(--t3);margin-top:1px">${am.qty} ${unitLabel}</div>`;
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
function applyFilters(){
  // The Radar composite pre-ranks every uploaded row; the filter bar only narrows
  // what is displayed. Held positions were already suppressed at scoring time.
  const q=(document.getElementById('fSearch')?.value||'').trim().toLowerCase();
  const risk=document.getElementById('fRisk')?.value||'';
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
  let rows=ALL.filter(s=>{
    if(s._held){SUPPRESSED_HELD++;return false;}
    // Configured surveillance rules are a HARD filter (owner 2026-07-17): any stock
    // flagged under a rule in the Methodology table is weeded out of recommendations.
    // Non-configured REG1 flags remain a score penalty + badge only.
    if(NSE_SURV[s.symbol]?.length){SURV_HARD_REMOVED++;return false;}
    return (s.turnover||0)>=minTurn&&(!risk||s.risk===risk)&&(!q||[s.symbol,s.name,s.sector].join(' ').toLowerCase().includes(q));
  });
  rows.sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity));
  FILT=rowCap!=null?rows.slice(0,rowCap):rows;
  applySort();

  // SELECTED is auto-derived from FILT every filter pass: basket-eligible rows minus the
  // user's persisted exclusions, capped at Zerodha's 20-order limit.
  SELECTED=new Set(FILT.filter(s=>s.basketEligible!==false&&!EXPORT_EXCLUDED.has(s.symbol)).slice(0,20).map(s=>s.symbol));

  PG=1;renderHead();renderTable();renderStatusBar();saveFilterState();updateTabCounts();
  try{renderRankingsPanels();}catch(e){console.warn('Rankings panels render failed',e);}
  if(ALL.length) try{renderStats();}catch(e){}
}
// Latest Session and Open Positions sit under the recommendations table on Rankings and
// answer the same search box, so a symbol is found wherever it currently lives (v530).
// Both are rendered synchronously after their markup is in the DOM.
function renderRankingsPanels(){
  const q=rankingsSearchQuery();
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
function showRadarDetail(sym){
  const r=ALL.find(x=>x.symbol===sym);
  const dlg=document.getElementById('radarDetail');
  if(!r||!dlg) return;
  // innerHTML (not textContent) so the score carries its band colour; both interpolations are escaped.
  document.getElementById('radarDetailTitle').innerHTML=`${escHtml(r.symbol)} · <span style="color:${radarScoreColor(r.score)}">${isFinite(r.score)?Number(r.score).toFixed(1):'—'}</span> · ${escHtml(r.risk||'—')} risk`;
  const groups=Object.entries(RADAR_GROUPS).map(([k,g])=>`<div class="rr-group"><b>${g.label}<i>${r.parts?fmt(r.parts[k],0):'—'}/100</i></b><meter min="0" max="100" value="${r.parts?.[k]??0}"></meter></div>`).join('');
  const contribs=[...(r.contrib||[])].sort((a,b)=>Math.abs(b.impact)-Math.abs(a.impact)).slice(0,36).map(x=>`<div class="rr-contrib"><div><b>${escHtml(x.name)}</b><small>${RADAR_GROUPS[x.group]?.label||x.group} · percentile ${fmt(x.p*100,0)}</small></div><b class="${x.impact>=0?'pos':'neg'}">${x.impact>=0?'+':''}${fmt(x.impact,3)}</b></div>`).join('');
  const gate=r.rocketReady?'Meets the model’s high-feasibility criteria.':'Feasibility cautions: '+escHtml((r.gateReasons||[]).join(', ')||'not evaluated')+'.';
  const flags=(r.meta?.flags||[]).length?escHtml(r.meta.flags.join(', ')):'none';
  const detailNote=(r.contrib||[]).length?'':'<div style="color:var(--amber);font-size:11px;margin-bottom:8px">Restored compact ranking — load files again for the full per-feature breakdown.</div>';
  document.getElementById('radarDetailBody').innerHTML=`${detailNote}<div class="rr-groups">${groups}</div>
    <div class="rr-read"><b>Exchange check:</b> Series ${escHtml(r.series||'—')}, price band ${r.band??'not supplied'}, status ${escHtml(r.status||'—')}; basket ${r.basketEligible!==false?'eligible':'ineligible'}. Official delivery ${r.meta?.delivery==null?'unavailable':fmt(r.meta.delivery,1)+'%'}, trades ${r.meta?.trades==null?'unavailable':fmt(r.meta.trades,0)}, surveillance flags: ${flags}.<br>
    <b>Feasibility:</b> ${gate} Strongest daily range estimate ${fmt(r.rangePct,2)}%; a 10% move is ${fmt(r.stretch,2)}× that range. The stock remains ranked either way.<br>
    <b>Read:</b> ${escHtml(r.setup||'—')}. Data coverage ${r.quality!=null?fmt(r.quality*100,0)+'%':'—'}, day move ${(r.day??0)>=0?'+':''}${fmt(r.day,2)}%, relative volume ${r.relvol==null?'unavailable':fmt(r.relvol,2)+'×'}, turnover ${fV(r.turnover)}. Rank is relative, not a literal probability.</div>
    ${contribs?`<h3 style="font-size:14px;margin:12px 0 8px">Largest feature contributions</h3><div class="rr-contribs">${contribs}</div>`:''}`;
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
  if(risk)tags.push(risk+' risk');
  const turnIdx=+(document.getElementById('fMinTurnover')?.value||0);
  if(turnIdx>0)tags.push('TO≥'+RADAR_LIQ_LABELS[turnIdx]);
  const q=(document.getElementById('fSearch')?.value||'').trim();
  if(q)tags.push('“'+escHtml(q)+'”');
  const capital=parseFloat(document.getElementById('fCapital').value)||0;
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
    const stockCount=Object.keys(am2).length;
    html+=` <span style="color:var(--amber);font-size:11px;font-family:'DM Mono',monospace;font-weight:700;margin-left:8px" title="All-in estimated buy debit: limit-price notional plus CNC buy-side charges.">· ${stockCount} ${allocatedLabel} · ${fmtINR(actualDeployed)} of ${fmtINR(capital)} all-in</span>`;
    // Expected net at the ACTIVE GTT% (lower of Harvest / goal-led) — feedback, not input.
    const harvestPlan=computeHarvestPlan();
    const active=getActiveTargetInfo();
    const tgtPct=active.tgtPct;
    if(tgtPct>0){
      let totalNet=0;
      for(const sym in am2){
        const a=am2[sym];
        if(a.rejected) continue;
        if(a.expectedNet!=null && isFinite(a.expectedNet)){
          totalNet+=a.expectedNet;
        }
      }
      const goalCoverage=harvestPlan.dailyGoal>0?Math.max(0,totalNet)/harvestPlan.dailyGoal:0;
      const srcLbl=active.source==='goal'?'goal-led':'harvest';
      const needed=harvestPlan.capitalNeeded?` Capital needed for ${fmtINR(harvestPlan.dailyGoal)} at this learned edge: ${fmtINR(harvestPlan.capitalNeeded)}.`:'';
      const warn=harvestPlan.warning?` Warning: ${harvestPlan.warning}`:'';
      const tip=`Active ${srcLbl} GTT ${tgtPct.toFixed(2)}% (lower of Harvest ${active.harvestPct.toFixed(2)}%${active.goalPct!=null?` / goal-led ${active.goalPct.toFixed(2)}%`:''}), charge-aware net. Source: ${harvestPlan.source}.${needed}${warn}`;
      const color=totalNet>=0?'var(--green)':'var(--red)';
      html+=` <span style="color:${color};font-size:11px;font-family:'DM Mono',monospace;font-weight:700;margin-left:8px" title="${tip}">· 🎯 ${fmtINR(totalNet)} net @ ${srcLbl} ${tgtPct.toFixed(1)}% · ${(goalCoverage*100).toFixed(0)}% of ${fmtINR(harvestPlan.dailyGoal)}</span>`;
      if(harvestPlan.warning){
        html+=` <span style="color:var(--amber);font-size:11px;font-family:'DM Mono',monospace;font-weight:700;margin-left:8px" title="${harvestPlan.warning}">· target floor active</span>`;
      }
    }
  } else if(capital>0){
    html+=` <span style="color:var(--t3);font-size:11px;margin-left:8px">· select ${instrumentLabel} to allocate ${fmtINR(capital)}</span>`;
  }
  if(SUPPRESSED_HELD>0)html+=` <span class="sb-tag" style="margin-left:8px" title="Held positions (Holdings + Positions + today's net Orders buys) never re-enter the buy ranking. See Open Positions on the Performance tab.">📌 ${SUPPRESSED_HELD} held suppressed</span>`;
  if(SURV_HARD_REMOVED>0)html+=` <span class="sb-tag sb-tag-red" style="margin-left:4px" title="Weeded out by the configured surveillance rules in the Methodology table (hard filter).">⚠ ${SURV_HARD_REMOVED} surveillance removed</span>`;
  if(tags.length){html+=`<span class="sb-sep">|</span>`;html+=tags.map(t=>`<span class="sb-tag">${t}</span>`).join('');}
  if(isFiltered)html+=`<button class="sb-clear" onclick="clearFilters()">✕ Clear filters</button>`;
  const el=document.getElementById('statusBar');
  if(el)el.innerHTML=html;
}

function clearFilters(){
  ['fSearch','fRisk','fRows'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const turnEl=document.getElementById('fMinTurnover');if(turnEl)turnEl.value='0';
  applyLearnedMaxAllocDefault();
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
      content.innerHTML=`<div style="font-size:12px;color:var(--t1);margin-bottom:8px;font-weight:700">${src} ${escHtml(FILE_LOAD_STATUS.when||'')}</div>${renderFileStatusList()}`;
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
// Watches the granted local upload folder every 15 seconds; any change to file names,
// sizes, or timestamps re-ingests the folder automatically. Silent when no folder grant
// exists, permission was revoked, the tab is hidden, or a load is already running.
let _folderWatchTimer=null,_folderWatchSig='',_folderWatchBusy=false,_folderWatchPendingSig='';
// Only actual input files participate in change detection. The app itself writes
// rocket_brain.json into the upload folder on every brain save — including it in the
// signature made each refresh re-trigger the next one in an endless loop.
function isWatchedInputFile(name){
  const n=inputNameLower(name);
  return isScannerCsvName(name)||isReportsZipName(name)||
    ['holdings.csv','positions.csv','orders.csv','tradebook.csv','nse holidays.csv'].includes(n)||
    isLooseNseSupportCsvName(name);
}
function folderSignature(files){
  return (files||[]).filter(f=>isWatchedInputFile(f?.name)).map(f=>`${f.name}:${f.size}:${f.lastModified}`).sort().join('|');
}
// Small corner pill instead of the full loader/toast: auto-refresh must never interrupt.
function showAutoRefreshIndicator(state){
  let el=document.getElementById('autoRefreshPill');
  if(!el){
    el=document.createElement('div');
    el.id='autoRefreshPill';
    el.style.cssText="position:fixed;bottom:16px;left:16px;z-index:998;padding:6px 12px;border-radius:20px;background:var(--bg-raised);border:1px solid var(--border-hi);color:var(--t2);font-size:11px;font-family:'DM Mono',monospace;box-shadow:0 4px 16px rgba(0,0,0,.35);display:none;align-items:center;gap:6px";
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
    const sig=folderSignature(local.files);
    if(!sig) return;
    if(!_folderWatchSig){_folderWatchSig=sig;_folderWatchPendingSig=sig;return;} // baseline, no re-run
    if(sig===_folderWatchSig){_folderWatchPendingSig=sig;return;} // unchanged since last ingest
    // The set changed vs the last ingested one. Do NOT ingest yet — first require the
    // folder to have SETTLED, i.e. the signature is identical to the previous tick, so no
    // file is still being written in the last ~15s. This is the two-monitor guard:
    // `document.hidden` is false while the tab merely sits on another monitor, so a tick
    // can fire mid-download; without this, it would ingest a half-written or incomplete
    // set (a partial ALL NSE distorts every percentile). Files are OVERWRITTEN in place on
    // each download, so their size/mtime is in flux until each finishes — the signature
    // moves every tick and we keep waiting until the whole set stops changing. (No
    // ALL-NSE-present check: the owner always overwrites it so it is never absent, and
    // requiring it would wrongly block portfolio-only auto-refresh.)
    if(sig!==_folderWatchPendingSig){_folderWatchPendingSig=sig;return;} // still changing → wait a cycle
    _folderWatchSig=sig;
    _folderWatchPendingSig=sig;
    _folderWatchBusy=true;
    showAutoRefreshIndicator('refreshing');
    const ok=await processFiles(local.files,local.sourceLabel+' · auto-refresh',{silent:true});
    showAutoRefreshIndicator(ok?'done':'hide');
  }catch(e){
    console.warn('Folder watch tick failed',e);
    showAutoRefreshIndicator('hide');
  }
  finally{_folderWatchBusy=false;}
}
function startFolderWatch(){
  if(_folderWatchTimer) return;
  _folderWatchTimer=setInterval(folderWatchTick,15000);
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


// ── Holdings & Trailing SL ──
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
    const time=String(r[timeCol]||'').trim()||getSessionDate();
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
          if(fn.endsWith('.csv')){
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
    updates[HOLD_STORE]={holdings:HOLDINGS,costMap:HOLD_COST_MAP,sourcePath:holdFile.path,lastModified:holdFile.lastModified};
    updateFileLoadStatus('Holdings.csv','loaded');
  }
  if(posFile?.text){
    const today=getSessionDate();
    const positionsCurrent=isCurrentSessionFile(posFile);
    POSITIONS=positionsCurrent?parsePositions(posFile.text):[];
    updates[POS_STORE]={positions:POSITIONS,sessionDate:today,sourcePath:posFile.path,lastModified:posFile.lastModified,sourceDate:inputFileSessionDate(posFile),stale:!positionsCurrent};
    updateFileLoadStatus('Positions.csv',positionsCurrent?'loaded':'stale',positionsCurrent?'':'stale - ignored');
  }
  if(ordFile?.text){
    ORDERS_TODAY=parseOrders(ordFile.text);
    if(ORDERS_TODAY) ORDERS_TODAY._loadedThisSession=true;
    updates[ORDERS_STORE]={orders:ORDERS_TODAY,sourcePath:ordFile.path,lastModified:ordFile.lastModified};
    updateFileLoadStatus('Orders.csv','loaded');
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

  // Consolidate multiple fills of same stock/day/type into one entry (qty-weighted avg price).
  // This matches Zerodha's per-day P&L approach and prevents fill fragmentation.
  Object.keys(bySymbol).forEach(sym=>{
    const grps={};const order=[];
    bySymbol[sym].forEach(t=>{
      const k=t.type+'|'+t.date;
      if(!grps[k]){grps[k]={type:t.type,qty:0,totalVal:0,date:t.date,time:t.time};order.push(grps[k]);}
      grps[k].qty+=t.qty; grps[k].totalVal+=t.price*t.qty;
    });
    bySymbol[sym]=order.map(g=>({...g,price:g.qty?g.totalVal/g.qty:0}));
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
    const buyQueue=[];
    for(const t of trades){
      if(t.type==='buy'){
        buyQueue.push({qty:t.qty,price:t.price,date:t.date,time:t.time});
      } else if(t.type==='sell'){
        let sellQty=t.qty;
        while(sellQty>0&&buyQueue.length>0){
          const b=buyQueue[0];
          const matched=Math.min(sellQty,b.qty);
          const pnlPct=((t.price-b.price)/b.price)*100;
          const holdDays=Math.round((new Date(t.date)-new Date(b.date))/86400000);
          const capital=b.price*matched;
          roundTrips.push({sym,buyPrice:b.price,sellPrice:t.price,qty:matched,pnlPct,holdDays,capital,buyDate:b.date,sellDate:t.date,buyTime:b.time,sellTime:t.time});
          b.qty-=matched;
          sellQty-=matched;
          if(b.qty<=0) buyQueue.shift();
        }
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
    const netPnl=+((r.sellPrice-r.buyPrice)*r.qty-charges).toFixed(0);
    const netPnlPct=r.capital>0?+(netPnl/r.capital*100).toFixed(2):r.pnlPct;
    return{...r,charges,netPnl,netPnlPct};
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
    if(!lastDayBySym[r.sym]) lastDayBySym[r.sym]={sym:r.sym,lots:0,buyVal:0,sellVal:0,qty:0,netPnl:0,charges:0};
    const e=lastDayBySym[r.sym];
    e.lots++;e.buyVal+=r.buyPrice*r.qty;e.sellVal+=r.sellPrice*r.qty;e.qty+=r.qty;e.netPnl+=r.netPnl;e.charges+=r.charges;
  });
  const lastDayRows=Object.values(lastDayBySym).map(e=>({
    sym:e.sym,lots:e.lots,
    qty:e.qty,
    capital:+e.buyVal.toFixed(2),
    buyPrice:e.qty>0?+(e.buyVal/e.qty).toFixed(2):0,
    sellPrice:e.qty>0?+(e.sellVal/e.qty).toFixed(2):0,
    charges:+e.charges.toFixed(0),
    netPnl:+e.netPnl.toFixed(0),
    netPnlPct:e.buyVal>0?+(e.netPnl/e.buyVal*100).toFixed(2):null
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
  let exportList=(selected||[]).filter(s=>!getPriceBandBlockReason(s));
  let basketAlloc=computeAlloc(capital,exportList);
  const orderCount=()=>exportList.reduce((count,s)=>{
    const qty=capital>0?(basketAlloc[s.symbol]?.qty||0):1;
    return count+(qty>0?1:0);
  },0);
  while(exportList.length&&orderCount()>20){
    exportList=exportList.slice(0,-1);
    basketAlloc=computeAlloc(capital,exportList);
  }
  return {exportList,basketAlloc,orderCount:orderCount()};
}


async function exportBasket(){
  const capital=parseFloat(document.getElementById('fCapital').value)||0;
  const selList=FILT.filter(s=>SELECTED.has(s.symbol));
  if(!selList.length){showToast('Select at least one stock first.',3000,true);return;}
  const bandRejected=selList.filter(s=>getPriceBandBlockReason(s)).length;
  const {exportList,basketAlloc}=planBasketExport(capital,selList);
  const limitOmitted=Math.max(0,selList.length-bandRejected-exportList.length);

  const harvestPlan=computeHarvestPlan();
  const active=getActiveTargetInfo();
  const adaptiveTGT=roundPct05(active.tgtPct||harvestPlan.targetPct||(TRADEBOOK_STATS?TRADEBOOK_STATS.adaptiveTGT:3.7));

  const orders=[];
  let rejectedCount=bandRejected;
  let orderSeq=0;
  const pushBuyOrder=(s,qty,targetPct)=>{
    if(qty<=0) return;
    const sym=s.symbol;
    const name=s.name||sym;
    const slDistance=getRowStopDistancePct(s);
    const stoplossPct=-roundPct05(slDistance);
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
        gtt:{target:targetPct,stoploss:stoplossPct},
        tags:['TGT','SL']
      }
    });
  };
  exportList.forEach(s=>{
    const am = basketAlloc[s.symbol];
    if(am?.rejected){rejectedCount++;return;} // skip cost-floor rejections
    const qty = capital > 0 ? (am?.qty || 0) : 1;
    if(qty===0) return;
    pushBuyOrder(s,qty,adaptiveTGT);
  });

  if(!orders.length){showToast('Capital too low to buy even 1 share of any selected stock.',4000,true);return;}
  if(orders.length>20) throw new Error(`Basket planning invariant failed: ${orders.length} orders`);
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
  const saved=await saveBasketToScannerUploads(orders,'Zerodha_Basket_Buy');
  if(!saved) return;
  const rejNote = rejectedCount>0
    ? ` · ${rejectedCount} skipped (eligibility/allocation)`
    : '';
  const targetNote=` · target + SL GTT per stock`;
  const srcLabel=active.source==='goal'?'goal-led':'Harvest';
  const planNote=` · ${srcLabel} ${adaptiveTGT.toFixed(2)}% GTT`;
  const floorNote=harvestPlan.warning?` · target floor active`:``;
  const limitNote=limitOmitted>0?` · ${limitOmitted} lower-priority stock${limitOmitted===1?'':'s'} omitted to keep the basket within Zerodha's 20-order limit`:'';
  showToast(`<strong>Saved ${orders.length} CNC MARKET BUY orders</strong> in Scanner Uploads as Zerodha_Basket_Buy JSON${targetNote}${planNote}${floorNote}${rejNote}${limitNote}`);
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
  return `<div style="display:grid;grid-template-columns:1fr;gap:2px">${FILE_LOAD_STATUS.files.map(f=>`<div style="display:flex;gap:7px;align-items:flex-start;color:${color[f.state]||'var(--t2)'};${f.parent?'padding-left:18px;font-size:10.5px':''}"><span style="width:12px;text-align:center;font-weight:800">${icon[f.state]||'…'}</span><span style="flex:1;color:var(--t2)">${escHtml(f.label)}${f.note?` <span style="color:${color[f.state]||'var(--t3)'}">(${escHtml(f.note)})</span>`:''}</span></div>`).join('')}</div>`;
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
    stretch:s.stretch,rangePct:s.rangePct,relvol:s.relvol??null,gap:s.gap??null,
    turnover:s.turnover,atr:s.atr??null,quality:s.quality??null,
    rocketReady:!!s.rocketReady,gateReasons:(s.gateReasons||[]).slice(0,9),_held:!!s._held,
    meta:{delivery:s.meta?.delivery??null,trades:s.meta?.trades??null,flags:(s.meta?.flags||[]).slice(0,12),band:s.meta?.band??null}
  }));
}
function applySavedFiltersForMode(mode){
  const ids=['fSearch','fRisk','fRows','fMinTurnover','fCapital','fMaxAlloc'];
  const prev={};
  ids.forEach(id=>{const el=document.getElementById(id);if(el)prev[id]=el.value;});
  try{
    const st=JSON.parse(localStorage.getItem(modeKey(SCANNER_STORE,mode))||'{}');
    const shared=JSON.parse(localStorage.getItem(SHARED_FILTER_STORE)||'{}');
    const map={risk:'fRisk',rows:'fRows',minTurnover:'fMinTurnover'};
    Object.entries(map).forEach(([k,id])=>{const el=document.getElementById(id);if(el&&st[k]!=null)el.value=st[k];});
    const capEl=document.getElementById('fCapital');if(capEl&&shared.capital!=null)capEl.value=shared.capital;
    const maxEl=document.getElementById('fMaxAlloc');if(maxEl&&shared.maxAlloc!=null)maxEl.value=shared.maxAlloc;
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
    const fileTag=scannerFile.name+' · '+raw.length+' stocks';
    try{const ft=document.getElementById('fileTag');if(ft)ft.textContent=fileTag;}catch(e){}
    FS.set(modeKey(ALL_STORE,mode),{schema:ALL_STORE_SCHEMA,data:compactRankingRows(ALL),fileTag,rockets:RADAR.rockets,featureCount:RADAR.features.length,ts:new Date().toISOString()});
    if(mode==='stock'){
      // The Harvest target and executed-entry feedback keep learning from flagged
      // candidates' later attainable highs; the scorer itself stays stateless.
      const threshold=getEffectiveTgtPct()||TRADEBOOK_STATS?.adaptiveTGT||4;
      const eligibleCandidates=getDisplayedEntryCandidates(ALL).filter(s=>s.price>0);
      const recommendations=eligibleCandidates
        .map((s,i)=>({symbol:s.symbol,entryPrice:s.price,score:s.score,rank:i+1,features:{}}));
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
  try{_folderWatchSig=folderSignature([...files]);_folderWatchPendingSig=_folderWatchSig;}catch(e){}
  if(!silent) setLoading(true,String(FILE_LOAD_STATUS.source?`Processing selected files... · ${FILE_LOAD_STATUS.source}`:'Processing selected files...'));
  // Upload CHANGED canonical input files to Drive in the background. Rankings are built
  // from the selected local files immediately, because the market does not wait for Drive.
  saveInputsInBackground(files,{silent});
  NSE_BHAV={};NSE_52W={};NSE_SURV={};NSE_BULK={};NSE_BLOCK={};NSE_PRICE_BAND={};NSE_DEAL_NET={};NSE_STATUS={};NSE_SERIES={};
  let tvFile=null,nseZip=null,holdFile=null,posFile=null,ordFile=null,tbFile=null,holidayFile=false,holidayFileName='';
  for(const f of files){
    const name=inputNameLower(f.name);
    if(isReportsZipName(f.name)){nseZip=nseZip||f;continue;}
    if(!isCsvLikeFile(f))continue;
    if(isScannerCsvName(f.name)){tvFile=f;continue;}
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
  if(!tvFile&&!nseZip&&!holdFile&&!posFile&&!ordFile&&!tbFile&&!holidayFile){
    if(!silent){
      setLoading(false);
      showToast('No files recognised. Upload the NSE scanner and/or Zerodha input files.',4000,true);
    }
    return false;
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
          if(fn.endsWith('.csv')){
            setLoadMsg('Parsing '+fn+'...');
            const text=await entry.async('string');
            const type=detectNSE(fn,text);
            if(type) updateFileLoadStatusByNseType(type,'loaded');
          }
        }
      }
      await processZipEntries(outerZip);
      updateFileLoadStatus('Reports-Daily-Multiple.zip','loaded');
    }catch(e){console.error('ZIP error:',e);}
  }

  const scannerJobs=[];
  if(tvFile)scannerJobs.push({mode:'stock',file:tvFile});
  for(const job of scannerJobs){
    const ok=await processScannerUpload(job.file,job.mode);
    if(ok&&job.mode==='stock') updateFileLoadStatus('ALL NSE.csv','loaded');
  }
  const stockScannerProcessed=scannerJobs.some(j=>j.mode==='stock');

  if(!scannerJobs.length&&!nseZip&&!holdFile&&!posFile&&!ordFile&&!tbFile&&!holidayFile){
    if(!silent){
      setLoading(false);
      showToast('TradingView CSV not found in the selected Scanner Uploads folder.',4000,true);
    }
    return false;
  }

  // Holdings / Positions / Orders / Tradebook — processed regardless of TV CSV
  // All files are loaded before rendering so Latest Session always has fresh data
  if(holdFile){
    setLoadMsg('Processing holdings...');
    const holdText=await holdFile.text();
    HOLDINGS=parseHoldings(holdText);
    try{FS.set(HOLD_STORE,{holdings:HOLDINGS,costMap:HOLD_COST_MAP});}catch(e){}
    updateFileLoadStatus('Holdings.csv','loaded');
  }
  if(posFile){
    setLoadMsg('Processing positions...');
    const posText=await posFile.text();
    const posHash=(function(t){let h=0;for(let i=0;i<t.length;i++){h=((h<<5)-h)+t.charCodeAt(i);h|=0;}return h;})(posText);
    const today=getSessionDate();
    const positionsCurrent=isCurrentSessionFile(posFile);
    POSITIONS=positionsCurrent?parsePositions(posText):[];
    try{FS.set(POS_STORE,{positions:POSITIONS,hash:posHash,sessionDate:today,sourceDate:inputFileSessionDate(posFile),stale:!positionsCurrent});}catch(e){}
    updateFileLoadStatus('Positions.csv',positionsCurrent?'loaded':'stale',positionsCurrent?'':'stale - ignored');
  }
  if(ordFile){
    setLoadMsg('Processing orders...');
    const ordText=await ordFile.text();
    ORDERS_TODAY=parseOrders(ordText);
    if(ORDERS_TODAY) ORDERS_TODAY._loadedThisSession=true;
    try{FS.set(ORDERS_STORE,{orders:ORDERS_TODAY,sourcePath:ordFile.name,lastModified:ordFile.lastModified});}catch(e){}
    updateFileLoadStatus('Orders.csv','loaded');
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
document.getElementById('fMaxAlloc')?.addEventListener('input',e=>{delete e.target.dataset.autoDefault;});


// ══════════════════════════════════════════════════
// SCANNER FILTER PERSISTENCE
// ══════════════════════════════════════════════════


// ── Async app init: load brain file → hydrate all state → render ──
async function initApp(){
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
  try{const pe=document.getElementById('perfContent');if(pe&&!PERF_RENDERED)pe.innerHTML=`<div style="text-align:center;padding:60px 40px;color:var(--t2)"><div style="font-size:34px;margin-bottom:14px">📈</div><div style="font-size:15px;font-weight:700;color:var(--t1);margin-bottom:8px">Calculating performance</div><div>Rankings load first; trade analytics continue automatically.</div></div>`;}catch(e){}

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
  localStorage.setItem(SHARED_FILTER_STORE, JSON.stringify({
    capital:document.getElementById('fCapital')?.value||'',
    maxAlloc:maxAllocEl?.dataset.autoDefault==='1'?'':(maxAllocEl?.value||'')
  }));
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
    const sharedCapital=shared.capital!=null?shared.capital:state.capital;
    const sharedMaxAlloc=shared.maxAlloc!=null?shared.maxAlloc:state.maxAlloc;
    if(sharedCapital){const el=document.getElementById('fCapital');if(el)el.value=sharedCapital;}
    if(sharedMaxAlloc){const el=document.getElementById('fMaxAlloc');if(el)el.value=sharedMaxAlloc;}
    applyLearnedMaxAllocDefault();
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
