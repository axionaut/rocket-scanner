const BUILD_TS='2026-06-24 12:10 IST'; // replaced at commit time with IST datetime
const APP_VERSION=438; // Persisted snapshot restore + prior-day delta mRMR release.
const GOOGLE_DRIVE_CLIENT_ID='1015012642264-oi2nelv3v90k3d39r994a6nelgjs2a56.apps.googleusercontent.com'; // Public OAuth Web Client ID.
const HARD_FILTER_SCHEMA='structural_tradeability_v2';
const SNAPSHOT_MIN_GAP_MINUTES=1;
const SNAPSHOT_GAP_MIN_QUALITY_SAMPLES=5;
const SNAPSHOT_GAP_WEIGHT_MIN=0.25;
const SNAPSHOT_GAP_WEIGHT_MAX=1.75;
const NSE_OPEN_MINUTES=9*60+15;
const NSE_CLOSE_MINUTES=15*60+30;
const STOCK_RUNWAY_CEILING_PCT=19.5; // UC-style ceiling retained only for legacy helpers; entry-ceiling filtering is disabled.
const PRICE_BAND_BLOCK_BUFFER_PCT=0.15; // Treat rounded 4.9/9.9/19.9 rows as effectively band-locked.
const BASKET_CASH_RESERVE_RS=1; // Leave a rupee for broker-side tax/rounding differences.
const SYSTEM_TRADE_START_DATE='2026-04-01'; // Adaptive stats use trades closed from this date onward.
// mRMR v434-delta: only daily/intraday-changeable fields enter the learning vector.
// Every scoring feature is current-minus-comparison-snapshot; slow fundamentals are filter/display-only.
const DELTA_FEATURE_SCHEMA='all_retained_features_intrinsic_baseline_plus_prior_day_deltas_v2';
const PRIMARY_PRIOR_DAY_WEIGHT=0.70;
const SECONDARY_INTRADAY_WEIGHT=0.30;
const CURRENT_EVIDENCE_WEIGHT=0.70;
const HISTORICAL_MEMORY_WEIGHT=0.30;
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
  if(brand) brand.textContent='Intrinsic Baseline + Prior-Day mRMR';
  document.querySelectorAll('.currency-lbl').forEach(el=>{el.textContent='₹';});
  const minTurn=document.getElementById('fMinTurnover');
  if(minTurn){
    minTurn.placeholder='e.g. 10000000';
    minTurn.title='Min turnover (Price × Volume) in ₹. Blank = no filter.';
  }
}
let ALL=[],FILT=[],PG=1,PGSZ=100,SCOL='rocketScore',SDIR=-1;
let _tvLoadedThisSession=false; // true once a TV CSV has been processed this session
let _scanSavedDate=null; // date string (YYYY-MM-DD) of the brain-restored scan, set on init
let SCORE_MAP={}; // {symbol → rocketScore} for ALL parsed stocks including filtered-out ones
let PERF_PERIOD_FILTER='all'; // 'all' | '1m' | '3m' | '6m' | '1y'
let PERF_TRADE_WINDOWS=[]; // cached trade window rows from renderPerformance — used by current-window pill
let PERF_LATEST_SUMMARY=null; // cached latest session summary from renderPerformance — used by renderStats card
let PERF_RENDERED=false; // true after background or foreground performance calculation
let PERF_RENDER_QUEUED=false;
let ENGINE_DATA={};
let REMOVED={uc:0,surv:0,liq:0,fscore:0,atr:0};
let SUPPRESSED_HELD=0; // count of stocks hidden because already held in POSITIONS
let SELECTED=new Set(); // symbols selected for basket — recomputed from FILT each applyFilters
let SHOW_FILTERED_CANDIDATES=false;
let KEEP_FILTER_OVERRIDES=new Set();
const SCANNER_STORE='rs_filters';
const SHARED_FILTER_STORE='rs_filters_shared';
const ALL_STORE='rs_data';
const CORR_STORE='rs_corr';
const CORR_SCHEMA='intrinsic_baseline_plus_prior_trading_day_delta_top10_1d_mrmr_v4';
const ROCKET_TOP_FRACTION=0.10;
const SNAPSHOT_HISTORY_DECAY=0.95;
const SNAPSHOT_STATE_STORE='rs_snapshot_mrmr_v1';
const SNAPSHOT_STATE_SCHEMA='intrinsic_baseline_prior_trading_day_primary_v3';
const METH_STORE='rs_meth';
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
const REC_COUNT_STORE='rs_rec_count';
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
  const meth=brain?.[modeKey(METH_STORE)]||brain?.[METH_STORE]||{};
  return getOutcomeFeatureOrderFromWeights(meth.weights,meth.features);
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
let TRADEBOOK_STATS=null; // Includes the realised exit-policy baseline, later refined by outcome learning.
let LAST_BUY_DATE_MAP={}; // Legacy latest-buy map retained for stored-brain compatibility.
let ORDERS_TODAY=null; // [{symbol, type, qty, price, time}] — COMPLETE orders only
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
    for(let i=0;i<80;i++){
      if(window.google?.accounts?.oauth2) return true;
      await new Promise(r=>setTimeout(r,50));
    }
    return false;
  }

  async function init(){
    restoreSession();
    await restoreLocalDirectoryHandle();
    updateFolderUI();
    if(!isConnected()&&localStorage.getItem(PROVIDER_STORE)==='drive'){
      try{
        const restored=await connect({silent:true});
        if(restored?.ok){
          updateFolderUI();
          return restored.brain||await readLocalBrain();
        }
      }catch(e){console.warn('Silent Drive reconnect failed',e);}
    }
    if(!isConnected()) return await readLocalBrain();
    try{
      const brain=await read();
      return brain||await readLocalBrain();
    }catch(e){console.warn('Drive startup read failed',e);return await readLocalBrain();}
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
      const brain=JSON.parse(await hit.blob.text());
      writeLocalBrain(brain).catch(e=>console.warn('Local brain mirror failed after Drive read',e));
      return brain;
    }
    catch(e){console.warn('FS.read invalid cloud brain',e);return null;}
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
      if(_brainLoaded||Object.keys(_brain||{}).length) await writeLocalBrain(_brain);
      updateFolderUI();
      return true;
    }catch(e){console.warn('Local folder permission failed',e);_localDirHandle=null;return false;}
  }

  async function restoreLocalDirectoryHandle(){
    try{
      const handle=await getLocalStore(LOCAL_HANDLE_KEY);
      if(!handle) return false;
      _localDirHandle=handle;
      const granted=!_localDirHandle.queryPermission||await _localDirHandle.queryPermission({mode:'readwrite'})==='granted';
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
    const opts={mode:'readwrite'};
    if(await handle.queryPermission(opts)==='granted') return true;
    return await handle.requestPermission(opts)==='granted';
  }

  async function writeLocalBrainFile(data){
    if(!_localDirHandle||!data||typeof data!=='object') return false;
    try{
      if(!(await requestLocalPermission(_localDirHandle))) return false;
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
      if(!(await requestLocalPermission(_localDirHandle))) return;
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
    _brain=pruneBrainForStorage(raw);
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

  return {init,connect,needsReconnect,isConfigured,setClientId,isConnected,read,readUploadText,readUploadFile,saveUploadedInputs,write,set,setMultiple,get,load,loadFromDisk,ensureLoaded,refreshCloudIndex,verifyConnection,getBrain,reset,folderName,hasFolder,setLocalDirectoryHandle,hasLocalBrainFolder};
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
function saveInputsInBackground(files){
  if(!files?.length||!FS.hasFolder()) return;
  idleTask(()=>{
    FS.saveUploadedInputs(files)
      .then(n=>{if(n) showToast(`Saved ${n} input file${n!==1?'s':''} to Drive in background.`,2500);})
      .catch(e=>showToast('Background Drive input save failed: '+(e.message||e),5000,true));
  },1800);
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
  try{if(ALL.length&&ENGINE_DATA&&ENGINE_DATA.features) renderMethodology();}catch(e){console.warn('Methodology render failed',e);}
  try{if(ALL.length) applyFilters();}catch(e){console.warn('Fast ranking render failed',e);}
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
    const reason=result.reason==='google_library'?'Google authorization library could not load.':result.reason==='popup_failed'?'Google authorization popup was closed or blocked.':'Google Drive connection failed: '+result.reason;
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
    const hydratedCount=await hydrateSessionCSVsFromWorkspace();
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
    'rscanner_v4_corr':CORR_STORE,'rscanner_v5_corr':CORR_STORE,
    'rscanner_v4_meth':METH_STORE,'rscanner_v5_meth':METH_STORE
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
  const _bsEl=document.getElementById('lastScanVal');
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

// ── Day definition: IST 9:00 — 16:00 ──
// Single source of truth. Used for market hours guard, Auto Vol,
// and session-date labeling for position expiry. Anything outside
// this window is "yesterday" or "tomorrow."
const DAY_START_MIN = 9*60;   // 9:00 AM IST = 540
const DAY_END_MIN   = 16*60;  // 4:00 PM IST = 960
const DAY_LENGTH_MIN= DAY_END_MIN - DAY_START_MIN; // 420

function istNow(){
  const now=new Date();
  const istMs=now.getTime()+5.5*60*60*1000;
  const ist=new Date(istMs);
  // Use UTC methods on the shifted Date — handles midnight wrap correctly
  const h=ist.getUTCHours(), m=ist.getUTCMinutes();
  return {h, m, mins:h*60+m, dateMs:istMs};
}
function isMarketHours(){
  const {mins}=istNow();
  return mins>=DAY_START_MIN && mins<=DAY_END_MIN;
}
// Session date: rolls over at 16:00 IST.
// 9:00–16:00 IST → today's calendar date
// 16:00 onwards → next calendar date (treated as "tomorrow's" session)
function getSessionDate(){
  const {mins, dateMs}=istNow();
  const ist=new Date(dateMs);
  if(mins>=DAY_END_MIN) ist.setUTCDate(ist.getUTCDate()+1);
  const y=ist.getUTCFullYear();
  const m=String(ist.getUTCMonth()+1).padStart(2,'0');
  const d=String(ist.getUTCDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

// ── Auto Volume: minutes since day-start × configurable multiplier ──
const LIQ_MIN_VOL_DEFAULT=500;
function calcAutoVolume(){
  const mult=parseFloat(document.getElementById('fVolMult')?.value)||LIQ_MIN_VOL_DEFAULT;
  const {mins}=istNow();
  const minsFromOpen=mins-DAY_START_MIN;
  if(minsFromOpen<=0) return mult;
  if(minsFromOpen>=DAY_LENGTH_MIN) return Math.round(DAY_LENGTH_MIN*mult);
  return Math.round(minsFromOpen*mult);
}
let VOL_AUTO=true;
let _initInProgress=true; // suppresses applyFilters inside setAutoVolume during startup
function setAutoVolume(){
  if(!VOL_AUTO) return;
  const v=calcAutoVolume();
  const el=document.getElementById('fVol');
  if(el&&el.value!=String(v)){
    el.value=v;
    if(ALL.length&&!_initInProgress) applyFilters();
  }
  if(el) el.style.color='var(--cyan)';
  const lbl=document.getElementById('volAutoLabel');
  if(lbl){lbl.textContent='(auto)';lbl.style.display='';}
}
setInterval(function(){if(VOL_AUTO&&ALL.length)setAutoVolume();},60000);
function onVolChange(){
  const el=document.getElementById('fVol');
  if(!el) return;
  if(el.value===''){
    VOL_AUTO=true;
    setAutoVolume();
  } else {
    VOL_AUTO=false;
    el.style.color='var(--t1)';
    const lbl=document.getElementById('volAutoLabel');
    if(lbl){lbl.textContent='';lbl.style.display='none';}
  }
  applyFilters();
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
  return lines.slice(1).map(l=>{
    const v=splitLine(l);
    const o={};
    hdrs.forEach((h,i)=>o[h]=(v[i]!==undefined?v[i].trim():''));
    return o;
  }).filter(r=>Object.values(r).some(v=>v));
}
function num(v){
  if(v===null||v===undefined)return null;
  const s=String(v).trim().replace(/,/g,'');
  if(!s||s==='-'||s==='—'||/^n\/?a$/i.test(s))return null;
  const x=parseFloat(s);
  return Number.isFinite(x)?x:null;
}
function normSym(s){return String(s||'').trim().replace(/^[A-Z]+:/,'').replace(/_/g,'-').toUpperCase();}
function escHtml(s){return String(s??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));}
function findHeader(hdrs,patterns){return hdrs.find(h=>patterns.some(p=>p.test(h.trim())))||null;}
function meanArr(arr){return arr.length?arr.reduce((s,v)=>s+v,0)/arr.length:0;}
function roundPct05(v){return +(Math.round(v/0.05)*0.05).toFixed(2);}
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
function getHardFilterRowsFromEngine(E){
  if(!E) return [];
  const rm=E.removed||{};
  const survRows=syncSurvRuleRows(E.survRuleRows||[]);
  return [
    ...survRows.map(row=>({
      key:'surv_'+row.key,
      label:row.label,
      criteria:row.column,
      removed:row.active?(row.removed||0):null,
      flagged:row.active?(row.flagged||0):0,
      active:!!row.active,
      missing:false,
      kind:'surv',
      ruleKey:row.key,
    })),
    {key:'low_liquidity',label:'Low Liquidity',criteria:`Volume < Min Vol OR Shareholders < Min Sh (filter bar)`,removed:rm.liq||0,active:true,kind:'core'},
  ];
}
function persistMethodologySnapshot(){
  if(!ENGINE_DATA||!ENGINE_DATA.features||!ENGINE_DATA.features.length) return;
  try{
    const methSave={
      targetCorr:ENGINE_DATA.targetCorr||{},
      targetCorrToday:ENGINE_DATA.targetCorrToday||{},
      mrmr:ENGINE_DATA.mrmr||{},
      weights:ENGINE_DATA.weights||{},
      features:ENGINE_DATA.features||[],
      labels:ENGINE_DATA.labels||{},
      top10Feats:ENGINE_DATA.top10Feats||[],
      accSessions:ENGINE_DATA.accSessions,
      laggedNote:ENGINE_DATA.laggedNote||'',
      marketBreadth:ENGINE_DATA.marketBreadth,
      useAccCorr:ENGINE_DATA.useAccCorr,
      sectorCol:ENGINE_DATA.sectorCol,
      industryCol:ENGINE_DATA.industryCol,
      totalParsed:ENGINE_DATA.totalParsed||0,
      hardFilterSchema:ENGINE_DATA.hardFilterSchema||HARD_FILTER_SCHEMA,
      removed:{...(ENGINE_DATA.removed||{})},
      survSize:ENGINE_DATA.survSize||0,
      survRuleRows:syncSurvRuleRows(ENGINE_DATA.survRuleRows||[]),
      recommendationFeedback:ENGINE_DATA.recommendationFeedback||null,
      executedEntryFeedback:ENGINE_DATA.executedEntryFeedback||null,
      snapshotElapsedMinutes:ENGINE_DATA.snapshotElapsedMinutes??null,
      snapshotDisplayElapsedMinutes:ENGINE_DATA.snapshotDisplayElapsedMinutes??null,
      snapshotPairs:ENGINE_DATA.snapshotPairs||0,
      deltaFeatureSchema:ENGINE_DATA.deltaFeatureSchema||DELTA_FEATURE_SCHEMA
    };
    FS.set(modeKey(METH_STORE),methSave);
  }catch(e){
    console.warn('Could not save methodology data',e);
  }
}

// ── NSE Parsers ──
function parseBhavdata(text){
  parseCSV(text).forEach(r=>{
    const sym=normSym(r['SYMBOL']);
    if(!sym||(r['SERIES']||'').trim()!=='EQ')return;
    NSE_BHAV[sym]={delivPct:num(r['DELIV_PER']),nseVol:num(r['TTL_TRD_QNTY'])};
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
  rows.forEach(r=>{
    const sym=normSym(symCol?r[symCol]:r['Symbol']);if(!sym)return;
    // Track non-EQ series — BE/BZ/SZ/SM/ST can't be bought normally
    if(seriesCol){const s=(r[seriesCol]||'').trim().toUpperCase();if(s&&s!=='EQ')NSE_NON_EQ.add(sym);}
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
}
function parseDeal(text,map){
  parseCSV(text).forEach(r=>{
    const sym=normSym(r['Symbol']);if(!sym)return;
    if((r['Buy/Sell']||'').trim().toUpperCase()==='BUY')map[sym]=true;
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
  if(!Array.isArray(rows)||!rows.length) return [];
  const heldPos=getHeldPositionMap();
  const reDrop=parseFloat(document.getElementById('fReDrop')?.value);
  const dropPct=isFinite(reDrop)&&reDrop>=0?reDrop:1;
  return rows.map(s=>({...s,_features:s._features||{}}))
    .filter(s=>!getFilterBarReason(s))
    .filter(s=>!applyHeldDisplayState(s,heldPos,dropPct))
    .sort((a,b)=>(b.rocketScore||0)-(a.rocketScore||0))
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
    if(gap==null||gap<=0) return;
    if(gap>horizon){entry.complete=true;changed=true;return;}
    const row=rowMap[entry.symbol];
    if(!row||entry.evaluatedThrough===scan.date) return;
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
function getOutcomeFeedbackSamples(){
  const samples=[];
  Object.values((FS.get(RECOMMEND_OUTCOME_STORE)||{}).issues||{}).forEach(issue=>{
    (issue.picks||[]).forEach(p=>{
      if(!p.complete||!(p.observations>0)||!p.features) return;
      const score=p.outcomeScore!=null?p.outcomeScore:calcRecommendationOutcomeScore(p,issue.threshold);
      if(score!=null&&isFinite(score)) samples.push({features:p.features,score,weight:1,source:'recommendation'});
    });
  });
  Object.values((FS.get(ENTRY_OUTCOME_STORE)||{}).entries||{}).forEach(entry=>{
    if(!entry.complete||!(entry.observations>0)||!entry.features) return;
    const score=calcExecutedEntryOutcomeScore(entry);
    if(score!=null&&isFinite(score)) samples.push({features:entry.features,score,weight:1.25,source:'entry'});
  });
  return samples;
}
function featureSignatureSimilarity(currentFeatures,sampleFeatures,features,weights){
  let sum=0,total=0,matched=0;
  for(const f of features){
    const a=currentFeatures?.[f],b=sampleFeatures?.[f];
    if(a==null||b==null||!isFinite(a)||!isFinite(b)) continue;
    const denom=Math.max(1,Math.abs(a)+Math.abs(b));
    const sim=clampNum(1-(Math.abs(a-b)/denom),0,1);
    const w=Math.max(0.0001,weights?.[f]||0);
    sum+=sim*w;total+=w;matched++;
  }
  return matched>=5&&total>0?{similarity:sum/total,matched}:null;
}
function buildOutcomeReliabilityModel(features,weights){
  const samples=getOutcomeFeedbackSamples();
  const rankedFeatures=getOutcomeFeatureOrderFromWeights(weights,features);
  const active=samples.length>=OUTCOME_FEEDBACK_MIN_SAMPLES&&rankedFeatures.length>=5;
  return {samples,features:rankedFeatures,active};
}
function getOutcomeReliabilityAdjustment(currentFeatures,model,weights){
  if(!model?.active) return {delta:0,confidence:0,samples:model?.samples?.length||0,matched:0};
  const matches=[];
  model.samples.forEach(sample=>{
    const sim=featureSignatureSimilarity(currentFeatures,sample.features,model.features,weights);
    if(sim&&sim.similarity>=0.35) matches.push({...sim,score:sample.score,weight:sample.weight||1});
  });
  matches.sort((a,b)=>b.similarity-a.similarity);
  const top=matches.slice(0,12);
  const denom=top.reduce((sum,m)=>sum+(m.similarity*m.weight),0);
  if(!denom) return {delta:0,confidence:0,samples:model.samples.length,matched:0};
  const evidence=top.reduce((sum,m)=>sum+(m.score*m.similarity*m.weight),0)/denom;
  const avgSimilarity=top.reduce((sum,m)=>sum+m.similarity,0)/top.length;
  const sampleConfidence=Math.min(1,model.samples.length/(model.samples.length+30));
  const confidence=clampNum(sampleConfidence*avgSimilarity,0,0.65);
  return {
    delta:+clampNum(evidence*confidence*OUTCOME_SCORE_ADJ_MAX,-OUTCOME_SCORE_ADJ_MAX,OUTCOME_SCORE_ADJ_MAX).toFixed(2),
    confidence:+confidence.toFixed(3),
    samples:model.samples.length,
    matched:top.length,
    evidence:+evidence.toFixed(3)
  };
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
  stats.adaptiveSL=stats.exitPolicy.slPct;
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
function pearson(xs,ys){
  const p=[];
  for(let i=0;i<xs.length;i++)if(xs[i]!==null&&ys[i]!==null&&!isNaN(xs[i])&&!isNaN(ys[i]))p.push([xs[i],ys[i]]);
  if(p.length<30)return 0;
  const n=p.length;let sx=0,sy=0,sxy=0,sx2=0,sy2=0;
  for(const[x,y]of p){sx+=x;sy+=y;sxy+=x*y;sx2+=x*x;sy2+=y*y;}
  const d=Math.sqrt((n*sx2-sx*sx)*(n*sy2-sy*sy));return d===0?0:(n*sxy-sx*sy)/d;
}
function pctRank(arr){
  const it=arr.map((v,i)=>({v,i})).filter(x=>x.v!==null&&!isNaN(x.v));
  it.sort((a,b)=>a.v-b.v);
  const n=it.length,res=new Array(arr.length).fill(null);if(!n)return res;
  let i=0;
  while(i<n){let j=i;while(j<n&&it[j].v===it[i].v)j++;const r=n>1?((i+j-1)/2)/(n-1):0.5;for(let k=i;k<j;k++)res[it[k].i]=r;i=j;}
  return res;
}
function spearman(xs,ys){
  return pearson(pctRank(xs),pctRank(ys));
}

function emptySnapshotRuntime(){
  return {schema:SNAPSHOT_STATE_SCHEMA,latest:null,previousTradingDay:null,completed:0,lastOutcome:null,lastTag:null};
}
function buildDecodedSnapshot({stamp,symbols,prices,featureRows,features,sessionTag}){
  return {...stamp,symbols:[...symbols],prices,featureRows,featureCols:[...features],features:null,sessionTag:sessionTag||null};
}
// Every retained analytical field is eligible for mRMR.
// On a valid prior-trading-day comparison it is expressed strictly as current-minus-prior.
// The first-ever upload has no comparator, so it uses only fields that are already
// intrinsically daily/intraday delta-like in ALL NSE (change, momentum, oscillator state,
// relative volume, ratings centred on neutral, etc.). Raw price-level fields wait for a
// real previous-trading-day snapshot; they are never scored as raw levels.
function isDynamicMrmrFeature(feature){
  return !!String(feature||'').trim();
}
function isDynamicScaleFeature(feature){
  const f=String(feature||'').toLowerCase();
  // These are already relative, bounded, oscillatory or point-valued. Their comparison
  // delta is a direct point difference, never a percent-of-a-percent.
  if(/(^|_)(change|performance|return|pct|percent|percentage|ratio|rsi|stoch|cci|mfi|adx|dmi|atr|aroon|oscillator|momentum|rate_of_change|roc|relative_volume|volatility|gap|rating|delivery|range_pos|pct_from|peak_retention|sector_breadth|sector_rel_strength|industry_breadth|bull_bear_power|chaikin|macd|ultimate)(_|$)/.test(f)) return false;
  // Everything else numeric is a scale/level field: price, volume, turnover, pivots,
  // bands, averages, cloud lines, market cap, shareholder counts and similar values.
  // A real prior-day comparison converts it to a percentage delta.
  return true;
}
function isIntrinsicBaselineFeature(feature){
  const f=String(feature||'').toLowerCase();
  // First-upload baseline: only fields that already encode current daily/intraday movement
  // or a meaningful technical state are usable before a prior snapshot exists.
  return /(^|_)(change|performance|return|gap|momentum|rate_of_change|roc|relative_volume|volatility|average_daily_range|atr|adx|dmi|rsi|stoch|cci|mfi|aroon|oscillator|macd|bull_bear_power|chaikin|ultimate|rating|delivery|range_pos|pct_from|peak_retention|pct_to_upper_band|sector_breadth|sector_rel_strength|industry_breadth)(_|$)/.test(f);
}
function intrinsicBaselineValue(feature,value){
  const v=Number(value);
  if(!isFinite(v)||!isIntrinsicBaselineFeature(feature)) return null;
  const f=String(feature||'').toLowerCase();
  // Text ratings are converted to 1..5 and centred on Neutral (=3).
  if(/rating/.test(f)) return v-3;
  // Bounded oscillators and range-position measures are expressed as deviation from neutral.
  if(/(rsi|mfi|stoch|aroon|range_pos|peak_retention|delivery_pct|sector_breadth|industry_breadth)/.test(f)) return v-50;
  // ADX/DMI are conventionally interpreted around 25 rather than 0.
  if(/(^|_)(adx|dmi)(_|$)/.test(f)) return v-25;
  // Change/return/performance, MACD, CCI, ROC, momentum and similar fields already have
  // a meaningful zero point, so their supplied daily/intraday value is the baseline delta.
  return v;
}
function deltaFeatureValue(feature,currentValue,previousValue){
  const current=Number(currentValue), previous=Number(previousValue);
  if(!isFinite(current)||!isFinite(previous)) return null;
  if(isDynamicScaleFeature(feature)){
    if(previous===0) return null;
    return ((current-previous)/Math.abs(previous))*100;
  }
  return current-previous;
}
function buildComparisonFeatureRows(previous,current,features){
  const rows={};
  const currentSymbols=current?.symbols||[];
  currentSymbols.forEach(symbol=>{
    const now=current.featureRows?.[symbol]||{};
    const prior=previous?.featureRows?.[symbol]||null;
    const vector={};
    features.forEach(feature=>{
      vector[feature]=deltaFeatureValue(feature,now[feature],prior?.[feature]);
    });
    rows[symbol]=vector;
  });
  return rows;
}
function buildIntrinsicBaselineFeatureRows(current,features){
  const rows={};
  (current?.symbols||[]).forEach(symbol=>{
    const now=current.featureRows?.[symbol]||{};
    const vector={};
    features.forEach(feature=>{vector[feature]=intrinsicBaselineValue(feature,now[feature]);});
    rows[symbol]=vector;
  });
  return rows;
}
function intrinsicBaselineCorrelation(current,currentEligibleSymbols,currentTargetSymbols,features){
  const eligible=currentEligibleSymbols instanceof Set?currentEligibleSymbols:new Set(currentEligibleSymbols||[]);
  const comparisonRows=buildIntrinsicBaselineFeatureRows(current,features);
  const matchedSymbols=(current.symbols||[]).filter(symbol=>eligible.has(symbol));
  const correlation={};
  for(const feature of features){
    const xs=[],ys=[];
    matchedSymbols.forEach(symbol=>{
      const value=comparisonRows[symbol]?.[feature];
      if(value==null||!isFinite(value)) return;
      xs.push(value);ys.push(currentTargetSymbols.has(symbol)?1:0);
    });
    correlation[feature]=pearson(xs,ys);
  }
  return {correlation,matched:matchedSymbols.length,comparisonRows};
}
function snapshotCorrelationToCurrentTarget(previous,current,currentEligibleSymbols,currentTargetSymbols,features){
  // Every current live-eligible symbol is a 0/1 observation. Every mRMR input is a strict dynamic delta:
  // current snapshot minus comparison snapshot. Static/fundamental fields are absent from FEATS.
  const eligible=currentEligibleSymbols instanceof Set?currentEligibleSymbols:new Set(currentEligibleSymbols||[]);
  const comparisonRows=buildComparisonFeatureRows(previous,current,features);
  const matchedSymbols=[];
  for(const symbol of current.symbols||[]){
    if(eligible.has(symbol)&&previous?.featureRows?.[symbol]) matchedSymbols.push(symbol);
  }
  const correlation={};
  for(const feature of features){
    const xs=[],ys=[];
    matchedSymbols.forEach(symbol=>{
      const value=comparisonRows[symbol]?.[feature];
      if(value==null||!isFinite(value)) return;
      xs.push(value); ys.push(currentTargetSymbols.has(symbol)?1:0);
    });
    correlation[feature]=pearson(xs,ys);
  }
  return {correlation,matched:matchedSymbols.length,comparisonRows};
}
function snapshotPriceMoves(previous,current){
  const currentIndex=new Map((current.symbols||[]).map((symbol,index)=>[symbol,index]));
  const out={};
  (previous.symbols||[]).forEach((symbol,index)=>{
    const ci=currentIndex.get(symbol);
    const prior=previous.prices?.[index], now=ci==null?null:current.prices?.[ci];
    if(prior>0&&now>0) out[symbol]=+(((now/prior)-1)*100).toFixed(2);
  });
  return out;
}
function blendCorrelation(currentValue,historicalValue,currentWeight=0.70){
  const c=isFinite(currentValue)?currentValue:null;
  const h=isFinite(historicalValue)?historicalValue:null;
  if(c==null) return h??0;
  if(h==null) return c;
  return currentWeight*c+(1-currentWeight)*h;
}
function updateCorrelationEMA(storeKey,incoming,weightCurrent=0.70){
  const prior=ACC_CORR?.[storeKey]||{};
  const next={...prior};
  Object.entries(incoming||{}).forEach(([feature,value])=>{
    if(value==null||!isFinite(value)) return;
    next[feature]=blendCorrelation(value,prior[feature],weightCurrent);
  });
  ACC_CORR={...(ACC_CORR||{}),[storeKey]:next};
  return next;
}
function getAverageLearningHorizon(){
  const count=Number(ACC_CORR?.elapsedCount||0);
  const total=Number(ACC_CORR?.elapsedTotalMinutes||0);
  return count>0&&isFinite(total)?{minutes:total/count,count}:null;
}
async function advanceSnapshotLearning({rows,features,priceKey,sessionTag,targetSymbols,eligibleSymbols,advance=true,snapshotTimestamp=Date.now()}){
  if(!SNAPSHOT_RUNTIME||SNAPSHOT_RUNTIME.schema!==SNAPSHOT_STATE_SCHEMA) SNAPSHOT_RUNTIME=emptySnapshotRuntime();
  if(ACC_CORR?.corrSchema!==CORR_SCHEMA){
    ACC_CORR={corr:{},intradayCorr:{},sessions:0,learnSessions:0,corrSchema:CORR_SCHEMA,
      seedBaselineDate:null,seedBaselineCorr:{},baselineSessions:0};
  }
  const runtime=SNAPSHOT_RUNTIME;
  const stamp=snapshotStamp(snapshotTimestamp);
  const targetSet=targetSymbols instanceof Set?targetSymbols:new Set(targetSymbols||[]);
  const eligibleSet=eligibleSymbols instanceof Set?eligibleSymbols:new Set(eligibleSymbols||[]);
  const targetCorrToday=Object.fromEntries(features.map(f=>[f,null]));
  const cleanRows=rows.filter(row=>row.symbol&&priceKey&&row[priceKey]>0);
  const symbols=cleanRows.map(row=>row.symbol);
  const prices=Float32Array.from(cleanRows,row=>row[priceKey]);
  const featureRows=Object.fromEntries(cleanRows.map(row=>[row.symbol,Object.fromEntries(features.map(f=>[f,row[f]??null]))]));
  const currentSnapshot=buildDecodedSnapshot({stamp,symbols,prices,featureRows,features,sessionTag});

  let note='Waiting for first-upload intrinsic daily-delta baseline';
  let primaryCorr=null,intradayCurrent=null,primaryIntervalMoves={},displayIntervalMoves={},scoringFeatureRows={};
  let primarySnapshot=null,primaryValid=false,intradayUpdated=false,baselineActive=false,baselineCreated=false;
  let displayIntervalElapsedMinutes=null;
  const duplicate=!!sessionTag&&runtime.lastTag===sessionTag&&runtime.latest?.sessionDate===stamp.sessionDate;

  if(!advance){
    note='Rankings refreshed without advancing snapshot learning';
  }else if(duplicate){
    // A duplicate upload keeps the existing state and still renders the available score mode below.
    note='Duplicate snapshot ignored; retained existing scoring state';
  }else if(!stamp.baselineEligible){
    note='Outside NSE snapshot hours; no learning snapshot saved';
  }else{
    const latest=runtime.latest;
    const stale=latest&&stamp.timestamp<=latest.timestamp;

    // Display-only Snap Chg compares against the most recent earlier upload. It is deliberately
    // independent of the scoring comparator: same-day changes may be displayed but never score.
    const displaySnapshot=latest&&latest.timestamp<stamp.timestamp
      ?latest
      :(runtime.previousTradingDay&&runtime.previousTradingDay.timestamp<stamp.timestamp
        ?runtime.previousTradingDay:null);
    if(displaySnapshot){
      displayIntervalMoves=snapshotPriceMoves(displaySnapshot,currentSnapshot);
      displayIntervalElapsedMinutes=Math.max(1,Math.round((stamp.timestamp-displaySnapshot.timestamp)/60000));
    }

    // The primary comparator is ONLY the immediately previous NSE trading day.
    if(runtime.previousTradingDay&&tradingDaysBetween(runtime.previousTradingDay.sessionDate,stamp.sessionDate)===1){
      primarySnapshot=runtime.previousTradingDay;
    }else if(latest&&tradingDaysBetween(latest.sessionDate,stamp.sessionDate)===1){
      primarySnapshot=latest;
    }

    const primaryPair=primarySnapshot&&stamp.inSession&&targetSet.size>0
      ?snapshotCorrelationToCurrentTarget(primarySnapshot,currentSnapshot,eligibleSet,targetSet,features):null;
    primaryValid=!!primaryPair&&primaryPair.matched>=100;

    if(primaryValid){
      primaryCorr=primaryPair.correlation;
      scoringFeatureRows=primaryPair.comparisonRows||{};
      primaryIntervalMoves=snapshotPriceMoves(primarySnapshot,currentSnapshot);
      features.forEach(f=>{targetCorrToday[f]=primaryCorr[f]??null;});
    }

    // Same-day snapshot comparisons build secondary context only. They never create,
    // replace or rescue a prior-day score.
    if(!stale&&latest&&latest.sessionDate===stamp.sessionDate&&stamp.inSession&&targetSet.size>0){
      const gap=(stamp.timestamp-latest.timestamp)/60000;
      if(gap>=SNAPSHOT_MIN_GAP_MINUTES){
        const intradayPair=snapshotCorrelationToCurrentTarget(latest,currentSnapshot,eligibleSet,targetSet,features);
        if(intradayPair.matched>=100){
          intradayCurrent=intradayPair.correlation;
          updateCorrelationEMA('intradayCorr',intradayCurrent,0.70);
          intradayUpdated=true;
        }
      }
    }

    if(primaryValid){
      const intradayHistory=ACC_CORR.intradayCorr||{};
      const historical=ACC_CORR.corr||{};
      const currentEvidence={},finalCorr={};
      features.forEach(f=>{
        const primary=primaryCorr[f];
        const secondary=intradayHistory[f];
        currentEvidence[f]=isFinite(secondary)?blendCorrelation(primary,secondary,PRIMARY_PRIOR_DAY_WEIGHT):primary;
        finalCorr[f]=blendCorrelation(currentEvidence[f],historical[f],CURRENT_EVIDENCE_WEIGHT);
      });
      const primaryElapsed=Math.round((stamp.timestamp-primarySnapshot.timestamp)/60000);
      ACC_CORR={...ACC_CORR,corr:finalCorr,sessions:(ACC_CORR.sessions||0)+1,learnSessions:(ACC_CORR.learnSessions||0)+1,
        elapsedCount:(ACC_CORR.elapsedCount||0)+1,elapsedTotalMinutes:(ACC_CORR.elapsedTotalMinutes||0)+primaryElapsed,
        corrSchema:CORR_SCHEMA,lastUpdated:new Date().toISOString(),lastPrimaryDate:primarySnapshot.sessionDate,lastCurrentDate:stamp.sessionDate};
      runtime.completed=(runtime.completed||0)+1;
      runtime.lastOutcome={sourceTimestamp:primarySnapshot.timestamp,completedAt:stamp.timestamp,elapsedMinutes:primaryElapsed,
        matched:Object.keys(primaryIntervalMoves).length,rockets:targetSet.size,primaryDate:primarySnapshot.sessionDate,currentDate:stamp.sessionDate,intradayUpdated};
      note=`Primary: ${primarySnapshot.sessionDate} → ${stamp.sessionDate} current 1D top ${Math.round(ROCKET_TOP_FRACTION*100)}% target (${primaryPair.matched} matched)${intradayUpdated?' · same-day context refreshed':''}`;
    }else{
      // First-ever baseline exception. This is not a same-day fallback: it learns only from
      // intrinsic daily/intraday delta fields already present in ALL NSE, such as price-change,
      // volume-change, momentum, oscillators and centred technical ratings.
      const canCreateBaseline=!latest&&!ACC_CORR.seedBaselineDate&&stamp.inSession&&targetSet.size>0;
      const canUseSeedToday=ACC_CORR.seedBaselineDate===stamp.sessionDate&&(!latest||latest.sessionDate===stamp.sessionDate);
      if(canCreateBaseline){
        const seed=intrinsicBaselineCorrelation(currentSnapshot,eligibleSet,targetSet,features);
        const seedCorr=seed.correlation||{};
        ACC_CORR={...ACC_CORR,corr:seedCorr,seedBaselineCorr:seedCorr,seedBaselineDate:stamp.sessionDate,
          baselineSessions:(ACC_CORR.baselineSessions||0)+1,sessions:(ACC_CORR.sessions||0)+1,
          corrSchema:CORR_SCHEMA,lastUpdated:new Date().toISOString(),lastCurrentDate:stamp.sessionDate};
        scoringFeatureRows=seed.comparisonRows||{};
        features.forEach(f=>{targetCorrToday[f]=seedCorr[f]??null;});
        baselineActive=true;baselineCreated=true;
        note=`Baseline: first-upload intrinsic daily/intraday deltas against current 1D top ${Math.round(ROCKET_TOP_FRACTION*100)}% target (${seed.matched} live-eligible stocks)`;
      }else if(canUseSeedToday){
        scoringFeatureRows=buildIntrinsicBaselineFeatureRows(currentSnapshot,features);
        baselineActive=true;
        note='Baseline: first-upload intrinsic daily/intraday delta model retained; same-day snapshots remain secondary context only';
      }else if(primaryPair&&primaryPair.matched<100){
        note=`WARMUP: immediate prior-day snapshot matched only ${primaryPair.matched} live-eligible stocks; 100 required`;
      }else if(stale){
        note='Older or same-time snapshot ignored; baseline preserved';
      }else{
        const latestDate=latest?.sessionDate||null;
        if(latestDate&&latestDate!==stamp.sessionDate&&tradingDaysBetween(latestDate,stamp.sessionDate)!==1){
          note='WARMUP: immediate previous trading-day snapshot is missing; baseline cannot bridge a skipped trading day';
        }else if(latestDate===stamp.sessionDate){
          note='WARMUP: same-day snapshot stored as secondary context only; immediate prior-day comparison is required';
        }else{
          note='WARMUP: immediate previous trading-day comparison is required';
        }
      }
    }

    if(!stale){
      if(latest&&latest.sessionDate!==stamp.sessionDate){
        runtime.previousTradingDay=tradingDaysBetween(latest.sessionDate,stamp.sessionDate)===1?latest:null;
      }
      runtime.latest=currentSnapshot;
      runtime.lastTag=sessionTag||null;
      window._snapshotRuntimeDirty=true;
    }
  }

  // Reload / Drive hydration must never create a new baseline or erase an existing one.
  // It reuses the persisted immediate-prior-day comparator and learned vector for the
  // already-saved latest snapshot. This path is also used for an exact duplicate upload.
  let restoredPrimaryEvidence=false;
  let restoredBaselineEvidence=false;
  const learned=ACC_CORR?.corr||{};
  const hasLearnedVector=Object.keys(learned).length>0;

  if(!primaryValid&&!baselineActive&&hasLearnedVector){
    const retainedPrior=runtime.previousTradingDay;
    const retainedMatched=retainedPrior
      ?(currentSnapshot.symbols||[]).filter(symbol=>eligibleSet.has(symbol)&&retainedPrior.featureRows?.[symbol]).length
      :0;

    if(retainedPrior&&tradingDaysBetween(retainedPrior.sessionDate,stamp.sessionDate)===1&&retainedMatched>=100){
      scoringFeatureRows=buildComparisonFeatureRows(retainedPrior,currentSnapshot,features);
      restoredPrimaryEvidence=true;
      if(!advance) note=`Restored prior-day scoring state: ${retainedPrior.sessionDate} → ${stamp.sessionDate} (${retainedMatched} matched)`;
      else if(duplicate) note=`Duplicate snapshot ignored; restored prior-day scoring state (${retainedMatched} matched)`;
    }else if(ACC_CORR.seedBaselineDate===stamp.sessionDate){
      scoringFeatureRows=buildIntrinsicBaselineFeatureRows(currentSnapshot,features);
      restoredBaselineEvidence=true;
      if(!advance) note='Restored first-upload intrinsic baseline scoring state';
      else if(duplicate) note='Duplicate snapshot ignored; restored intrinsic baseline scoring state';
    }
  }

  const hasPrimaryComparison=primaryValid||restoredPrimaryEvidence;
  const hasBaselineEvidence=baselineActive||restoredBaselineEvidence;
  const hasScoringEvidence=hasPrimaryComparison||hasBaselineEvidence;
  if(!hasScoringEvidence) scoringFeatureRows=buildComparisonFeatureRows(null,currentSnapshot,features);

  const targetCorr={};
  features.forEach(feature=>{targetCorr[feature]=hasScoringEvidence?(learned[feature]??0):0;});
  if(ACC_CORR){ACC_CORR.laggedNote=note;FS.set(modeKey(CORR_STORE),ACC_CORR);}
  return {targetCorr,targetCorrToday,completedNow:hasPrimaryComparison?1:0,note,runtime,
    hadPriorCorr:(ACC_CORR?.learnSessions||0)>0,hasPrimaryComparison,hasBaselineEvidence,hasScoringEvidence,baselineCreated,
    primaryCorr,intradayCurrent,intervalMoves:displayIntervalMoves,scoringFeatureRows,deltaFeatureSchema:DELTA_FEATURE_SCHEMA,
    intervalElapsedMinutes:displayIntervalElapsedMinutes,
    freshSignalCount:hasScoringEvidence?Object.values(targetCorrToday).filter(v=>v!=null&&isFinite(v)&&Math.abs(v)>0.0001).length:0};
}

// ── Engine ──
async function runEngine(raw, sessionTag, options={}){
  if(!raw.length) return;
  const advanceSnapshot=options.advanceSnapshot!==false;

  // ── Auto-detect columns from CSV headers ──
  const allHeaders = Object.keys(raw[0]);

  // Find symbol/name. Every retained rating column is converted to an ordered numeric feature.
  const symCol   = allHeaders.find(h => raw.slice(0,5).every(r => /^[A-Z0-9&.-]{1,20}$/.test((r[h]||'').trim()))) || allHeaders[0];
  const nameCol  = allHeaders.find(h => h !== symCol && raw.slice(0,5).some(r => (r[h]||'').trim().length > 10 && isNaN(parseFloat(r[h])))) || '';
  const RATING_MAP={'strong sell':1,'sell':2,'neutral':3,'buy':4,'strong buy':5};
  const ratingValue=v=>RATING_MAP[String(v||'').trim().toLowerCase()]??null;
  const ratingCols=allHeaders.filter(h=>{
    if(!/rating/i.test(h)) return false;
    const sample=raw.slice(0,50).map(r=>ratingValue(r[h])).filter(v=>v!=null);
    return sample.length>0;
  });
  const ratingColSet=new Set(ratingCols);

  // Numeric detection: sample first 50 rows (skip blanks), column is numeric
  // if at least 30% of non-blank values parse as a real finite number
  const numericCols = allHeaders.filter(h => {
    if(h === symCol || h === nameCol || ratingColSet.has(h)) return false;
    const nonBlank = raw.slice(0, 50).map(r => (r[h]||'').trim()).filter(v => v !== '');
    if(nonBlank.length < 3) return false;
    const numericCount = nonBlank.filter(v => {
      const n = parseFloat(v.replace(/,/g,''));
      return isFinite(n);
    }).length;
    return (numericCount / nonBlank.length) >= 0.3;
  });

  // Map column header → safe JS key (lowercase, alphanumeric + underscore)
  function safeKey(h){ return h.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''); }
  const COL_MAP = {}; // safeKey → original header
  numericCols.forEach(h => { COL_MAP[safeKey(h)] = h; });
  // Convert every retained textual rating into a 1..5 ordered numeric mRMR feature.
  ratingCols.forEach(h => { COL_MAP[safeKey(h)] = h; });

  // ── Known special mappings for derived features ──
  // These tell us which safeKey holds which meaning for computed features
  const findKey = pattern => Object.keys(COL_MAP).find(k => pattern.test(k)) || null;
  const K = {
    price:        findKey(/^price$/),
    price_change: findKey(/price_change.*1_day|1_day.*price_change|^change.*1_day$/),
    atr_pct:      findKey(/average_true_range_.*14.*1_day|atr_.*14.*1_day/),
    perf_1w:      findKey(/performance.*1_week|perf.*1_week|1_week.*perf/),
    volume:       findKey(/^volume_1_day$|^volume$/),
    turnover:     findKey(/price_volume_turnover_1_day/),
    market_cap:   findKey(/market_capitalization|market_cap/),
    shareholders: findKey(/number_of_shareholders/),
    piotroski:    findKey(/piotroski/),
    high_1d:      findKey(/^high_1_day$/),
    low_1d:       findKey(/^low_1_day$/),
    vwap:         findKey(/volume_weighted_average_price.*1_day/),
  };
  const parsed = raw.map(r => {
    const d = {};
    // Parse numeric columns, then convert textual ratings to 1..5.
    for(const [key, col] of Object.entries(COL_MAP)){
      d[key] = ratingColSet.has(col)?ratingValue(r[col]):num(r[col]);
    }
    d.symbol = normSym(r[symCol]);
    d.name   = (r[nameCol]||'').trim();
    return d;
  });

  // ── Auto-detect Sector / Industry columns ──
  // Look for text columns with repeated categorical values (not unique per row like name/symbol)
  const SECTOR_PATTERNS = /^sector$/i;
  const INDUSTRY_PATTERNS = /^industry$/i;
  let sectorCol = allHeaders.find(h => SECTOR_PATTERNS.test(h.trim())) || null;
  let industryCol = allHeaders.find(h => INDUSTRY_PATTERNS.test(h.trim())) || null;
  // Fallback: detect any text column with 5-50 unique values (categorical grouping)
  if(!sectorCol || !industryCol){
    const candidates = allHeaders.filter(h => h!==symCol && h!==nameCol && !ratingColSet.has(h) && !numericCols.includes(h));
    for(const h of candidates){
      const vals = raw.slice(0,200).map(r=>(r[h]||'').trim()).filter(v=>v);
      const uniq = new Set(vals);
      if(vals.length>=50 && uniq.size>=5 && uniq.size<=50){
        if(!sectorCol) sectorCol=h;
        else if(!industryCol) industryCol=h;
      }
    }
  }
  // Attach sector/industry text to parsed rows
  if(sectorCol) parsed.forEach((d,i) => { d._sector = (raw[i][sectorCol]||'').trim(); });
  if(industryCol) parsed.forEach((d,i) => { d._industry = (raw[i][industryCol]||'').trim(); });

  // ── Computed features — only those requiring external data or text decoding ──
  // All other derived features removed: mRMR will discover correlations from raw columns
  parsed.forEach(d => {
    // MA rating: text → numeric (required to use as a feature)
    // NSE enrichment: not in the TradingView CSV, so add it here.
    const bh=NSE_BHAV[d.symbol]||{}, wk=NSE_52W[d.symbol]||{}, pb=NSE_PRICE_BAND[d.symbol]||{};
    d.delivery_pct = bh.delivPct ?? null;
    d.nse_vol      = bh.nseVol   ?? null;
    d.high_52w     = wk.high52w  ?? null;
    d.low_52w      = wk.low52w   ?? null;
    d.price_band_pct = pb.bandPct ?? null;
    d.pct_to_upper_band = (d.price_band_pct!=null&&K.price_change&&d[K.price_change]!=null) ? (d.price_band_pct-d[K.price_change]) : null;
    const price=d[K.price], h52=d.high_52w, l52=d.low_52w;
    if(price!=null&&h52!=null&&l52!=null&&(h52-l52)>0){
      d.range_pos         = ((price-l52)/(h52-l52))*100;
      d.pct_from_52w_high = ((price-h52)/h52)*100;
    } else { d.range_pos=null; d.pct_from_52w_high=null; }
    // Peak retention: how much of today's range has the stock held?
    const hi1d=K.high_1d?d[K.high_1d]:null, lo1d=K.low_1d?d[K.low_1d]:null;
    if(price!=null&&hi1d!=null&&lo1d!=null&&(hi1d-lo1d)>0){
      d.peak_retention=((price-lo1d)/(hi1d-lo1d))*100;
    } else { d.peak_retention=null; }
  });

  // FEATS: every retained numeric or converted-rating analytical field in ALL NSE,
  // plus NSE-derived fields. Redundancy is handled by mRMR, not by pre-pruning.
  const NSE_DERIVED = ['delivery_pct','range_pos','pct_from_52w_high','peak_retention','price_band_pct','pct_to_upper_band'];
  const ALL_CANDIDATE_FEATURES = [...new Set([...Object.keys(COL_MAP), ...NSE_DERIVED])];
  const FEATS = [...ALL_CANDIDATE_FEATURES];

  const LABELS = {};
  for(const key of Object.keys(COL_MAP)) LABELS[key] = COL_MAP[key];
  LABELS.delivery_pct      = 'Delivery %';
  LABELS.range_pos         = '52W Range Position %';
  LABELS.pct_from_52w_high = '% From 52W High';
  LABELS.peak_retention    = 'Peak Retention %';
  LABELS.price_band_pct    = 'NSE Price Band %';
  LABELS.pct_to_upper_band = '% To Upper Band';

  // ── Market breadth context (full universe, before filters) ──
  const allAdvancing = parsed.filter(d => {
    const pc = K.price_change ? d[K.price_change] : null;
    return pc !== null && pc > 0;
  }).length;
  const marketBreadth = parsed.length > 0 ? allAdvancing / parsed.length : 0.5;
  const totalParsed = parsed.length;
  window._lastObservedDailyMoves=parsed.map(d=>({
      symbol:d.symbol,
      price:K.price?d[K.price]:null,
      priceChange:K.price_change?d[K.price_change]:null,
      high1d:K.high_1d?d[K.high_1d]:null,
      low1d:K.low_1d?d[K.low_1d]:null,
      rocketMove:getIntradayRocketMove(d,K.price,K.price_change,K.high_1d)
    })).filter(d=>d.symbol);
  // ── Compute Sector / Industry breadth features (full universe) ──
  if(sectorCol && K.price_change){
    const secMap={};
    parsed.forEach(d=>{
      const s=d._sector; if(!s) return;
      if(!secMap[s]) secMap[s]={up:0,total:0,changes:[]};
      const pc=d[K.price_change];
      secMap[s].total++;
      if(pc!=null&&pc>0) secMap[s].up++;
      if(pc!=null) secMap[s].changes.push(pc);
    });
    Object.values(secMap).forEach(s=>{
      s.changes.sort((a,b)=>a-b);
      s.median=s.changes.length?s.changes[Math.floor(s.changes.length/2)]:0;
    });
    parsed.forEach(d=>{
      const s=secMap[d._sector];
      d.sector_breadth = s && s.total>=3 ? (s.up/s.total)*100 : null;
      const pc=K.price_change?d[K.price_change]:null;
      d.sector_rel_strength = (s && pc!=null && s.total>=3) ? pc - s.median : null;
    });
    FEATS.push('sector_breadth','sector_rel_strength');
    LABELS.sector_breadth='Sector Breadth %';
    LABELS.sector_rel_strength='Sector Relative Strength';
  }
  if(industryCol && K.price_change){
    const indMap={};
    parsed.forEach(d=>{
      const ind=d._industry; if(!ind) return;
      if(!indMap[ind]) indMap[ind]={up:0,total:0};
      indMap[ind].total++;
      const pc=d[K.price_change];
      if(pc!=null&&pc>0) indMap[ind].up++;
    });
    parsed.forEach(d=>{
      const ind=indMap[d._industry];
      d.industry_breadth = ind && ind.total>=3 ? (ind.up/ind.total)*100 : null;
    });
    FEATS.push('industry_breadth');
    LABELS.industry_breadth='Industry Breadth %';
  }

  const learningUniverse=parsed.filter(d=>d.symbol&&(!K.price||d[K.price]!==0));
  const FEATS_UNIQUE=[...new Set(FEATS)];
  FEATS.length=0;FEATS.push(...FEATS_UNIQUE);
  let snapshotLearning=null; // populated after current tradeability filters create today’s top-10% label

  // ── Recommendation filters ──
  // These rows remain in learningUniverse and snapshots; only live eligibility is filtered.
  const _liqMinVol=parseFloat(document.getElementById('fVolMult')?.value)||LIQ_MIN_VOL_DEFAULT;
  const _liqMinTurnover=parseFloat(document.getElementById('fMinTurnover')?.value)||0;
  REMOVED={uc:0,surv:0,nonEq:0,liq:0,fscore:0,atr:0,survRules:{}};
  const filtered=parsed.filter(d=>{
    const pc=K.price_change?d[K.price_change]:null;
    const _track=(bucket)=>{
      d._hardFiltered=true;
      d._filterBucket=bucket;
      REMOVED[bucket]++;
    };
    if(!d.symbol||(K.price&&d[K.price]===0)){_track('liq');return false;}
    // Upper circuit — stock-only market structure filter
    const priceBand=d.price_band_pct;
    const ucCeiling=(priceBand!=null&&isFinite(priceBand)&&priceBand>0)?priceBand:STOCK_RUNWAY_CEILING_PCT;
    const ucBuffer=(priceBand!=null&&isFinite(priceBand)&&priceBand>0)?PRICE_BAND_BLOCK_BUFFER_PCT:0;
    if(pc!==null&&pc>=ucCeiling-ucBuffer){_track('uc');return false;}
    // Non-EQ series (BE/BZ/SZ/SM/ST) — stock-only T2T settlement filter
    if(NSE_NON_EQ.has(d.symbol)){_track('nonEq');return false;}
    // Surveillance — stock-only user custom rules
    if(NSE_SURV[d.symbol]){
      _track('surv');
      const rules=Array.isArray(NSE_SURV[d.symbol])?NSE_SURV[d.symbol]:[];
      if(rules.length){const primary=rules[0];REMOVED.survRules[primary]=(REMOVED.survRules[primary]||0)+1;}
      return false;
    }
    // Liquidity floor — volume, turnover, or shareholders below threshold
    const sh=K.shareholders?d[K.shareholders]:null;
    const vol=K.volume?d[K.volume]:null;
    const tv=K.turnover?d[K.turnover]:null;
    const volFloor=_liqMinVol;
    if((sh!==null&&sh<500)||(vol!==null&&vol<volFloor)||(tv!==null&&_liqMinTurnover>0&&tv<_liqMinTurnover)){
      _track('liq');return false;
    }
    // Piotroski — stock-only fundamental data filter
    const pio=K.piotroski?d[K.piotroski]:null;
    if(pio===0){_track('fscore');return false;}
    // ATR — zero/negative values are invalid; blanks pass through as unknown
    const atr=K.atr_pct?d[K.atr_pct]:null;
    if(atr!==null&&atr<=0){_track('atr');return false;}
    d._hardFiltered=false;
    d._filterBucket='';
    return true;
  });
  // Current-day target: the top 10% of live-eligible stocks by 1D price change.
  // This is deliberately calculated only after current tradeability exclusions.
  const targetRanked=filtered
    .map((d,i)=>({i,value:K.price_change?d[K.price_change]:null}))
    .filter(x=>x.value!=null&&isFinite(x.value))
    .sort((a,b)=>b.value-a.value);
  const targetCount=Math.max(1,Math.floor(targetRanked.length*ROCKET_TOP_FRACTION));
  const currentTop10Symbols=new Set(targetRanked.slice(0,targetCount).map(x=>filtered[x.i].symbol));
  snapshotLearning=await advanceSnapshotLearning({rows:learningUniverse,features:FEATS,priceKey:K.price,
    sessionTag,targetSymbols:currentTop10Symbols,eligibleSymbols:new Set(filtered.map(d=>d.symbol)),advance:advanceSnapshot,snapshotTimestamp:options.snapshotTimestamp||Date.now()});

  // Expose current full-universe values for outcome and diagnostics only.
  window._lastEngineFeats = FEATS;
  window._lastParsedFiltered = filtered;
  window._lastParsedForSnapshot = learningUniverse;

  const targetCorr=snapshotLearning.targetCorr;
  const targetCorrToday=snapshotLearning.targetCorrToday;
  const freshSignalCount=snapshotLearning.freshSignalCount;
  const currentUploadLearned=snapshotLearning.completedNow>0;
  // Strict gate: same-day evidence and historical memory never create a tradable score without today's direct prior-trading-day comparison.
  const hasRecommendationEvidence=!!snapshotLearning.hasScoringEvidence;
  const useFreshCorr=true;
  const scoringSource=snapshotLearning.hasPrimaryComparison?'immediate_prior_trading_day_primary':(snapshotLearning.hasBaselineEvidence?'first_upload_intrinsic_daily_delta_baseline':'warmup_missing_immediate_prior_trading_day');
  const laggedNote=snapshotLearning.note;
  const recOutcomeSummary=getRecommendationOutcomeSummary();
  const entryOutcomeSummary=getExecutedEntryOutcomeSummary();
  const recommendationFeedback={samples:recOutcomeSummary.evaluated,rockets:recOutcomeSummary.rockets,failures:recOutcomeSummary.failures};
  const executedEntryFeedback={samples:entryOutcomeSummary.completed,profitable:entryOutcomeSummary.positive};

  // Keep price_change reference for stats display
  const withPC=filtered.map((d,i)=>({i,pc:K.price_change?d[K.price_change]:null})).filter(x=>x.pc!==null);
  withPC.sort((a,b)=>b.pc-a.pc);

  // Every post-baseline mRMR comparison uses retained-feature deltas from the valid prior trading-day snapshot.
  // The first-ever upload uses only intrinsic daily/intraday deltas already supplied by ALL NSE.
  const scoringFeatureRows=snapshotLearning.scoringFeatureRows||{};
  const scoringRows=learningUniverse.map(d=>scoringFeatureRows[d.symbol]||{});
  // Older mRMR redundancy rule: average absolute Pearson correlation across all peer features.
  const interCorr={};
  for(let a=0;a<FEATS.length;a++)for(let b=a+1;b<FEATS.length;b++){
    const f1=FEATS[a],f2=FEATS[b];
    const r=pearson(scoringRows.map(row=>row[f1]),scoringRows.map(row=>row[f2]));
    interCorr[f1+'|'+f2]=r;interCorr[f2+'|'+f1]=r;
  }
  const mrmr={};
  for(const f of FEATS){
    const rel=Math.abs(targetCorr[f])||0;
    const peers=FEATS.filter(g=>g!==f).map(g=>Math.abs(interCorr[f+'|'+g]||0));
    const red=mean(peers)||0;
    const score=rel/(1+red);
    mrmr[f]={rel,red,baseScore:score,reliability:1,score,accountability:null};
  }
  const totalMRMR=FEATS.reduce((s,f)=>s+mrmr[f].score,0)||1;
  const weights={};
  for(const f of FEATS)weights[f]=mrmr[f].score/totalMRMR;
  const outcomeReliabilityModel=buildOutcomeReliabilityModel(FEATS,weights);

  const pctls={};
  for(const f of FEATS)pctls[f]=pctRank(filtered.map(d=>scoringFeatureRows[d.symbol]?.[f]??null));
  const results=filtered.map((d,idx)=>{
    let rawScore=0;
    for(const f of FEATS){
      const w=weights[f],p=pctls[f][idx];
      // Older rule: missing feature value contributes the 35th percentile instead of disappearing from the denominator.
      const percentile=p===null?0.35:p;
      rawScore+=w*(targetCorr[f]>=0?percentile:(1-percentile));
    }
    const mrmrScore=hasRecommendationEvidence?Math.round(rawScore*1000)/10:0;
    const currentFeatures=Object.fromEntries(FEATS.map(f=>[f,scoringFeatureRows[d.symbol]?.[f]??null]));
    // Outcome learning remains visible as confidence evidence only. It never alters Rocket Score or rank.
    const outcomeReliability=hasRecommendationEvidence?getOutcomeReliabilityAdjustment(currentFeatures,outcomeReliabilityModel,weights):{delta:0,confidence:0,matched:0};
    const score=mrmrScore;

    const vol=(K.volume?d[K.volume]:null);
    const flags=[];
    if(NSE_BULK[d.symbol]) flags.push('BULK');
    if(NSE_BLOCK[d.symbol]) flags.push('BLK');
    // Surveillance rules flagging this stock — used to show a warning badge in the table
    const _survRules=NSE_SURV[d.symbol]||null;
    const _isSurv=Array.isArray(_survRules)&&_survRules.length>0;

    return{
      symbol:d.symbol, name:d.name,
      sector:d._sector||'', industry:d._industry||'',
      sectorBreadth:d.sector_breadth??null,
      price:(K.price?d[K.price]:null),
      priceChange:(K.price_change?d[K.price_change]:null),
      snapshotChange:snapshotLearning.intervalMoves?.[d.symbol]??null,
      rocketMove:getIntradayRocketMove(d,K.price,K.price_change,K.high_1d),
      volume:vol,
      marketCap:(K.market_cap?d[K.market_cap]:null),
      atr:(K.atr_pct?d[K.atr_pct]:null),
      high1d:(K.high_1d?d[K.high_1d]:null),
      low1d:(K.low_1d?d[K.low_1d]:null),
      vwap:(K.vwap?d[K.vwap]:null),
      piotroski:(K.piotroski?d[K.piotroski]:null),
      shareholders:(K.shareholders?d[K.shareholders]:null),
      perf1w:(K.perf_1w?d[K.perf_1w]:null),
      delivPct:d.delivery_pct,
      rangePos:d.range_pos,
      pctFrom52wHigh:d.pct_from_52w_high,
      rocketScore:score, mrmrScore, outcomeAdj:outcomeReliability.delta,
      outcomeReliability:outcomeReliability.confidence, outcomeEvidence:outcomeReliability.matched,
      flags,
      isSurv:_isSurv, survRules:_survRules,
      // Calculated SL/Target per stock — adaptive from tradebook if available
      slPct: (()=>{
        if(TRADEBOOK_STATS&&TRADEBOOK_STATS.adaptiveSL) return -TRADEBOOK_STATS.adaptiveSL;
        const atr=K.atr_pct?d[K.atr_pct]:null;
        return atr>0 ? -(atr*1.5) : null;
      })(),
      tgtPct: (()=>{
        if(TRADEBOOK_STATS&&TRADEBOOK_STATS.adaptiveTGT) return TRADEBOOK_STATS.adaptiveTGT;
        const atr=K.atr_pct?d[K.atr_pct]:null;
        const p1w=K.perf_1w?d[K.perf_1w]:null;
        const dailyMove=p1w!=null?Math.abs(p1w)/5:null;
        const slBase=atr>0?atr*1.5:1.0;
        const rrFloor=slBase*1.5;
        return dailyMove!=null?Math.max(rrFloor,dailyMove):rrFloor;
      })(),
    };
  });

  // Compute top 10 mRMR features (sorted by weight descending)
  const top10Feats=[...FEATS].sort((a,b)=>(weights[b]||0)-(weights[a]||0)).slice(0,10);
  // Attach ALL feature values to each result for dynamic column display
  results.forEach((r,idx)=>{
    const d=filtered[idx];
    r._features={};
    for(const f of FEATS){
      r._features[f]=scoringFeatureRows[d.symbol]?.[f]??null;
    }
  });
  // ── Score ALL parsed stocks (including hard-filter exclusions) into SCORE_MAP ──
  SCORE_MAP={};
  results.forEach(r=>{SCORE_MAP[r.symbol]=r.rocketScore;});
  const _sf={};
  for(const f of FEATS)_sf[f]=filtered.map(d=>scoringFeatureRows[d.symbol]?.[f]??null).filter(v=>v!=null&&!isNaN(v)).sort((a,b)=>a-b);
  const _filtSet=new Set(filtered.map(d=>d.symbol));
  parsed.forEach(d=>{
    if(_filtSet.has(d.symbol))return;
    let rs=0;
    for(const f of FEATS){
      const w=weights[f],v=scoringFeatureRows[d.symbol]?.[f]??null;
      const arr=_sf[f];
      let rank=0.35;
      if(v!=null&&!isNaN(v)&&arr.length){
        let lo=0,hi=arr.length;
        while(lo<hi){const mid=(lo+hi)>>1;if(arr[mid]<=v)lo=mid+1;else hi=mid;}
        rank=arr.length>1?Math.min(1,Math.max(0,(lo-0.5)/(arr.length-1))):0.5;
      }
      rs+=w*(targetCorr[f]>=0?rank:(1-rank));
    }
    SCORE_MAP[d.symbol]=hasRecommendationEvidence?Math.round(rs*1000)/10:0;
  });
  parsed.forEach(d=>{d.rocketScore=SCORE_MAP[d.symbol]??null;});
  ENGINE_DATA={targetCorr,targetCorrToday,mrmr,weights,features:FEATS,labels:LABELS,top10Feats,accSessions:ACC_CORR?.sessions||0,laggedNote:laggedNote||'',
    marketBreadth:marketBreadth,
    recommendationFeedback,executedEntryFeedback,
    outcomeScoreOverlay:{active:outcomeReliabilityModel.active,samples:outcomeReliabilityModel.samples.length,features:outcomeReliabilityModel.features.length,maxAdjustment:0,mode:'confidence_badge_only'},
    scoringModel:'prior_trading_day_delta_current_1d_top10_mrmr',
    deltaFeatureSchema:DELTA_FEATURE_SCHEMA,
    deltaOnlyFeatureCount:FEATS.length,
    excludedSlowFeatureCount:0,
    useFreshCorr, hasRecommendationEvidence, currentUploadLearned, freshSignalCount,
    scoringSource,
    useAccCorr: snapshotLearning.hadPriorCorr,
    snapshotElapsedMinutes:SNAPSHOT_RUNTIME?.lastOutcome?.elapsedMinutes??null,
    snapshotDisplayElapsedMinutes:snapshotLearning.intervalElapsedMinutes??null,
    snapshotPairs:SNAPSHOT_RUNTIME?.completed||0,
    sectorCol: sectorCol?true:false, industryCol: industryCol?true:false,
    totalParsed: totalParsed,
    hardFilterSchema:HARD_FILTER_SCHEMA,
    removed: {...REMOVED},
    survSize: Object.keys(NSE_SURV).length,
    survRuleRows: getSurvRules().map(rule=>({
      key:rule.key,label:rule.label,column:rule.column,
      active:SURV_HEADERS.map(h=>String(h).trim().toLowerCase()).includes(rule.column.toLowerCase()),
      flagged:SURV_RULE_HITS[rule.key]||0,
      removed:REMOVED.survRules?.[rule.key]||0,
    }))
  };
  COLS=getCols(); // refresh dynamic columns
  // Persist compact methodology summaries; the O(n²) pair matrix is recomputed per run.
  try{
    const methSave={targetCorr:ENGINE_DATA.targetCorr,targetCorrToday,mrmr:ENGINE_DATA.mrmr,weights:ENGINE_DATA.weights,
      features:ENGINE_DATA.features,labels:ENGINE_DATA.labels,top10Feats:ENGINE_DATA.top10Feats,accSessions:ENGINE_DATA.accSessions,laggedNote:ENGINE_DATA.laggedNote,
      marketBreadth:ENGINE_DATA.marketBreadth,useFreshCorr:ENGINE_DATA.useFreshCorr,hasRecommendationEvidence:ENGINE_DATA.hasRecommendationEvidence,currentUploadLearned:ENGINE_DATA.currentUploadLearned,freshSignalCount:ENGINE_DATA.freshSignalCount,scoringSource:ENGINE_DATA.scoringSource,useAccCorr:ENGINE_DATA.useAccCorr,sectorCol:ENGINE_DATA.sectorCol,industryCol:ENGINE_DATA.industryCol,
      totalParsed:totalParsed,hardFilterSchema:HARD_FILTER_SCHEMA,removed:{...REMOVED},survSize:Object.keys(NSE_SURV).length,
      recommendationFeedback,executedEntryFeedback,outcomeScoreOverlay:ENGINE_DATA.outcomeScoreOverlay,
      snapshotElapsedMinutes:ENGINE_DATA.snapshotElapsedMinutes,snapshotDisplayElapsedMinutes:ENGINE_DATA.snapshotDisplayElapsedMinutes,
      snapshotPairs:ENGINE_DATA.snapshotPairs,scoringModel:ENGINE_DATA.scoringModel,deltaFeatureSchema:ENGINE_DATA.deltaFeatureSchema};
    FS.set(modeKey(METH_STORE),methSave);
  }catch(e){console.warn('Could not save methodology data',e);}
  persistMethodologySnapshot();
  return results;
}

// ── Rendering ──
function getHoldingAvgCost(symbol){
  if(!symbol) return null;
  // 1. Holdings.csv cost map (most accurate — Zerodha settled avg)
  if(HOLD_COST_MAP[symbol]!=null) return HOLD_COST_MAP[symbol];
  // 2. Holdings.csv all rows (includes qty=0 closed positions)
  const hrow=HOLDINGS_ALL?.find(h=>h.symbol===symbol&&h.avgCost!=null);
  if(hrow?.avgCost!=null) return hrow.avgCost;
  // 3. Positions.csv (T+1 unsettled — one day lag acceptable)
  const prow=POSITIONS?.find(p=>p.symbol===symbol&&p.avg!=null);
  if(prow?.avg!=null) return prow.avg;
  return null;
  // Note: openAvgCostMap intentionally excluded here — it's for open position display
  // only, not for sell P&L calculation (tradebook is one day late so sells appear open)
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
        // Holdings.csv not loaded or stock not found — show row with unknown P&L
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
      rows.push({sym,lots:sells.length,qty:matchedQty,capital:null,buyPrice:null,sellPrice:+avgSell.toFixed(2),_brok,_stt,_txn,_sebi,_gst,_stamp,_dp,charges,winRate:null,netPnl:null,netPnlPct:null,_sort:-Infinity,_noAvgCost:true});
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
    rows.push({sym,lots:sells.length,qty:matchedQty,capital,buyPrice:+avgBuy.toFixed(2),sellPrice:+avgSell.toFixed(2),_brok,_stt,_txn,_sebi,_gst,_stamp,_dp,charges,winRate:netPnl>0?100:0,netPnl,netPnlPct,_sort:netPnl});
  });
  const total=rows.reduce((s,r)=>s+(r.netPnl||0),0);
  // Only return Orders.csv result if there are actual sell rows — if today only has buys,
  // fall through to tradebook so yesterday's session P&L shows instead of ₹0.
  if(!rows.length) return null;
  return {source:'Orders.csv',date:session.date,total,rows,hasOrders:session.orders.length>0};
}

function getLatestBookedSummary(){
  const orderBooked=computeLatestOrderBooked();
  const currentOrderSession=ORDERS_TODAY?._loadedThisSession?getLatestOrderSession():null;
  const hasCurrentSellOrders=!!currentOrderSession?.orders?.some(o=>o.type==='SELL');
  const tbLoaded=TRADEBOOK_STATS?._loadedThisSession&&TRADEBOOK_STATS?.lastDayRows?.length;

  // Current-session sell orders are fresher than a completed prior-day tradebook export.
  // Even if some P&L fields are incomplete, do not replace today's sells with yesterday's session.
  if(hasCurrentSellOrders) return orderBooked||{source:'Orders.csv',date:currentOrderSession.date,total:0,rows:[],hasOrders:true};

  // If both available, pick whichever has the more recent date
  if(orderBooked&&tbLoaded){
    const ordDate=orderBooked.date||'';
    const tbDate=TRADEBOOK_STATS.lastDate||'';
    if(tbDate>ordDate){
      // Tradebook has a newer session (e.g. GTT triggered day after Orders.csv)
      const rows=TRADEBOOK_STATS.lastDayRows.map(r=>({...r,_sort:r.netPnl}));
      return {source:'Tradebook',date:tbDate,total:+rows.reduce((s,r)=>s+r.netPnl,0).toFixed(0),rows};
    }
    return orderBooked;
  }
  if(orderBooked) return orderBooked;
  if(tbLoaded){
    const rows=TRADEBOOK_STATS.lastDayRows.map(r=>({...r,_sort:r.netPnl}));
    return {source:'Tradebook',date:TRADEBOOK_STATS.lastDate||'',total:+rows.reduce((s,r)=>s+r.netPnl,0).toFixed(0),rows};
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

function renderStats(){
  const t=ALL.length;
  const bull=ALL.filter(s=>(s.priceChange||0)>0).length;
  const totalParsed=ENGINE_DATA?.totalParsed||t;
  const top=ALL[0];

  // Score spread: shows if engine is differentiating
  const scores=ALL.map(s=>s.rocketScore).filter(v=>isFinite(v));
  const scoreMax=scores.length?Math.max(...scores).toFixed(1):'—';
  const scoreMin=scores.length?Math.min(...scores).toFixed(1):'—';
  const scoreSpread=scores.length?(Math.max(...scores)-Math.min(...scores)).toFixed(1):'—';

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
    bookedCard=`
      <div class="st"><div class="st-l">${bookedLabel}</div><div class="st-v" style="color:${booked.total>=0?'var(--green)':'var(--red)'}">${fmtSignedINR(booked.total)}</div><div class="st-d">${dateLabel} · ${srcLabel} · net of charges</div></div>`;
  }

  const slTgtCard=(()=>{
    if(!TRADEBOOK_STATS?.adaptiveSL) return '';
    const _sl=TRADEBOOK_STATS.adaptiveSL.toFixed(2);
    const _tgt=(getEffectiveTgtPct()||TRADEBOOK_STATS.adaptiveTGT).toFixed(2);
    const _runner=(getRunnerTgtPct()||parseFloat(_tgt)*1.5).toFixed(2);
    const rr=(parseFloat(_sl)>0?(parseFloat(_tgt)/parseFloat(_sl)):0).toFixed(2);
    const policy=TRADEBOOK_STATS.exitPolicy;
    const targetPolicy=getOutcomeTargetPolicy();
    const reviewDays=getEffectiveReviewDays();
    const holdStr=reviewDays?` · review &gt;${reviewDays}d`:'';
    const learnedStr=targetPolicy?.confidence>0?` · ${targetPolicy.evidenceCount} outcome-adjusted`:'';
    const opportunity=getSameDayExitOpportunitySummary();
    const opportunityStr=opportunity.exits?` · <span style="color:var(--amber)" title="${opportunity.exits} symbol/date exit${opportunity.exits===1?'':'s'} compared with the same day's ALL NSE high; ${opportunity.upsideExits} day high${opportunity.upsideExits===1?'':'s'} exceeded your quantity-weighted average sell price.">${opportunity.upsideExits}/${opportunity.exits} exit${opportunity.exits===1?'':'s'} left upside</span>`:'';
    const nudge=getMissedOppNudge();
    const nudgeStr=nudge>0?` · <span style="color:var(--amber);font-size:10px" title="Same-day missed upside averages ${opportunity.avgMissed.toFixed(2)}%. 25% of that is added to TGT.">missed opp +${nudge.toFixed(2)}%</span>`:'';
    const _cp=TRADEBOOK_STATS.avgChargePct!=null?Math.abs(TRADEBOOK_STATS.avgChargePct):null;
    const costStr=(_cp!=null&&_cp>0)?` · <span style="color:var(--t2)" title="Avg total Zerodha charges as % of round-trip turnover (buy+sell value), across all tradebook trips">cost ~${_cp.toFixed(2)}%</span>`:'';
    return `<div class="st"><div class="st-l">SL / TGT1 / TGT2</div><div class="st-v" style="font-size:15px"><span style="color:var(--red)">−${_sl}%</span><span style="color:var(--t3);font-size:12px"> / </span><span style="color:var(--green)">+${_tgt}%</span><span style="color:var(--t3);font-size:12px"> / </span><span style="color:var(--green)">+${_runner}%</span></div><div class="st-d">R:R ${rr}${costStr} · self-correcting exit policy${learnedStr}${holdStr}${opportunityStr}${nudgeStr}</div></div>`;
  })();

  document.getElementById('statsBar').innerHTML=`
    <div class="st"><div class="st-l">Eligible Universe</div><div class="st-v">${t.toLocaleString()}</div><div class="st-d">of ${totalParsed.toLocaleString()} parsed · <span style="color:var(--green)">${bull} up</span> · <span style="color:var(--red)">${t-bull} down/flat</span></div></div>
    ${slTgtCard}
    <div class="st"><div class="st-l">Score Spread</div><div class="st-v">${scoreSpread}</div><div class="st-d">${scoreMax} top · ${scoreMin} low</div></div>
    <div class="st"><div class="st-l">Top Sector</div><div class="st-v" style="font-size:15px;color:var(--green)">${topSec}</div><div class="st-d">${topSecPct.toFixed(0)}% advancing</div></div>
    <div class="st"><div class="st-l">Breadth</div><div class="st-v" style="color:var(--cyan)">${ENGINE_DATA.marketBreadth!=null?(ENGINE_DATA.marketBreadth*100).toFixed(0):(bull/t*100).toFixed(0)}%</div><div class="st-d">market context only · ${ENGINE_DATA.accSessions||0} learned horizons</div></div>${bookedCard}`;

  // Row 1: hard-filter removal pills
  const filterPills=[];
  if(REMOVED.nonEq>0)filterPills.push(`<span class="info-pill pill-orange" title="Non-EQ series (BE/BZ/SZ/SM/ST) — T2T settlement, excluded from recommendations and retained in learning.">⚠ ${REMOVED.nonEq} non-EQ removed</span>`);
  if(REMOVED.surv>0){const _sre=Object.entries(REMOVED.survRules||{}).sort((a,b)=>b[1]-a[1]).slice(0,5);const _srm=Object.fromEntries(getSurvRules().map(r=>[r.key,r.label]));const _srtip=_sre.map(([k,v])=>`${_srm[k]||k}: ${v}`).join(' · ');filterPills.push(`<span class="info-pill pill-red" title="Surveillance-flagged — excluded from recommendations and retained in learning. Top rules: ${escHtml(_srtip)}">⚠ ${REMOVED.surv} surveillance removed</span>`);}
  if(REMOVED.liq>0)filterPills.push(`<span class="info-pill pill-blue">🚫 ${REMOVED.liq} low liquidity removed</span>`);
  if(REMOVED.fscore>0)filterPills.push(`<span class="info-pill pill-gray">🚫 ${REMOVED.fscore} zero F-Score removed</span>`);
  if(REMOVED.atr>0)filterPills.push(`<span class="info-pill pill-amber">🚫 ${REMOVED.atr} zero/invalid ATR removed</span>`);
  const topUpCt=FILT.filter(s=>s._isTopUp).length;
  if(topUpCt>0)filterPills.push(`<span class="info-pill pill-fire" title="Already in portfolio — shown as top-up candidates.">↑ ${topUpCt} top-up</span>`);
  if(SUPPRESSED_HELD>0)filterPills.push(`<span class="info-pill pill-rose" title="Short positions and zero-qty holdings are always hidden.">📌 ${SUPPRESSED_HELD} held</span>`);
  const bulkCt=ALL.filter(s=>s.flags.includes('BULK')).length;
  const blkCt=ALL.filter(s=>s.flags.includes('BLK')).length;
  if(bulkCt>0)filterPills.push(`<span class="info-pill pill-lime">📦 ${bulkCt} bulk deals</span>`);
  if(blkCt>0)filterPills.push(`<span class="info-pill pill-purple">🧱 ${blkCt} block deals</span>`);

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
      infoPills.push(`<span class="info-pill pill-amber" title="One exit means one symbol on one sell date. Sell fills are quantity-weighted; ALL NSE supplies that day's high. The average is weighted by sold value and includes 0% when the high did not exceed your average sell price.">🎯 ${opportunity.exits} exit${opportunity.exits===1?'':'s'}${realisedText} · ${opportunity.upsideExits} left upside · missed +${opportunity.avgMissed.toFixed(2)}% (${fmtINR(opportunity.missedValue)}) · TGT +${opportunity.nudge.toFixed(2)}%</span>`);
    }
  }catch(e){}

  // Update surveillance P&L correlation accumulator if both data sources are ready
  if(HOLDINGS?.length&&Object.keys(SURV_ALL_HITS).length) try{updateSurvCorrelation();}catch(e){}
  const infoBarEl=document.getElementById('infoBar');
  infoBarEl.innerHTML=`<div style="display:flex;gap:6px;flex-wrap:wrap">${[...filterPills,...infoPills].join('')}</div>`;
  void infoBarEl.offsetHeight;
}

function makeSortableTable(id, cols, rows, defaultSortKey, defaultDir=-1, rowStyleFn=null, totalsRow=null){
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
        const display=c.totFmt?c.totFmt(v):(v!=null?v:'');
        return `<td style="${tdStyle(c.align||'right','font-weight:700;color:var(--t1)')}">${display}</td>`;
      }).join('')
    }</tr></tfoot>`:'';
    const tbl=document.getElementById(id);
    if(tbl){tbl.innerHTML=thead+tbody+tfoot;attachSort(tbl);}
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

function renderPerformance(){
  PERF_RENDERED=true;
  const el=document.getElementById('perfContent');
  if(!el) return;
  const hdrEl=document.querySelector('.hdr');
  if(hdrEl) document.documentElement.style.setProperty('--hdr-h',hdrEl.offsetHeight+'px');
  const tb=TRADEBOOK_STATS;
  if(!tb){
    el.innerHTML=`<div style="text-align:center;padding:80px 40px;color:var(--t2)"><div style="font-size:36px;margin-bottom:16px">📒</div><div style="font-size:16px;font-weight:700;color:var(--t1);margin-bottom:8px">No Tradebook Loaded</div><div>Upload TRADEBOOK.csv to see performance analytics.</div></div>`;
    return;
  }
  // Re-apply the realised tradebook exit policy after tradebook refresh.
  if(tb.tripsData?.length){
    refreshExitPolicyFromFeedback(tb);
    try{FS.set(TRADEBOOK_STORE,tb);}catch(e){}
  }
  const clr=(v)=>v===0?'var(--t2)':v>0?'var(--green)':'var(--red)';
  const fmtPerfRs=(v)=>fmtSignedINR(v);
  const fmtPct=(v)=>(v>=0?'+':'')+v.toFixed(2)+'%';

  const allTripsRaw=tb.tripsData||[];
  if(!allTripsRaw.length&&tb.roundTrips>0){
    // Old brain data — tripsData field didn't exist before this version
    el.innerHTML=`<div style="text-align:center;padding:80px 40px;color:var(--t2)"><div style="font-size:36px;margin-bottom:16px">🔄</div><div style="font-size:16px;font-weight:700;color:var(--t1);margin-bottom:8px">Re-upload TRADEBOOK.csv</div><div>Brain has ${tb.roundTrips} trades stored in the old format. Re-upload TRADEBOOK.csv once to rebuild with full trip data.</div></div>`;
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

  const learningHorizon=getAverageLearningHorizon();
  const kpis=[
    {label:'Net P&L',value:fmtPerfRs(p.totalNetPnlRs),color:clr(p.totalNetPnlRs),sub:`${p.roundTrips} lots · ${spanTradingDays||p.totalTradingDays} trading days${preSystemLots?` · ${preSystemLots} pre-system ignored`:''}`},
    {label:'Expectancy',value:fmtPerfRs(p.expectancy),color:clr(p.expectancy),sub:'Net ₹ per FIFO lot'},
    {label:'Profit Factor',value:p.profitFactor!=null?p.profitFactor:'—',color:p.profitFactor>=1.5?'var(--green)':p.profitFactor>=1?'var(--amber)':'var(--red)',sub:'Gross wins ÷ gross losses'},
    {label:'Win Rate',value:p.winRate+'%',color:p.winRate>=55?'var(--green)':p.winRate>=45?'var(--amber)':'var(--red)',sub:`${p.winners}W · ${p.losers}L lots`},
    {label:'Profitable Days',value:p.pctProfitableDays+'%',color:p.pctProfitableDays>=60?'var(--green)':p.pctProfitableDays>=50?'var(--amber)':'var(--red)',sub:`${p.profitableDays} of ${p.totalTradingDays} days`},
    {label:'Avg P&L/Trading Day',value:fmtPerfRs(p.avgDailyPnl),color:clr(p.avgDailyPnl),sub:`On ${p.totalTradingDays} days traded, net of charges`},
    {label:'Avg P&L/Cal Day',value:avgCalDayPnl!=null?fmtPerfRs(avgCalDayPnl):'—',color:avgCalDayPnl!=null?clr(avgCalDayPnl):'var(--t3)',sub:calDayCount?`Over ${calDayCount} calendar days`:'Insufficient date range'},
    {label:'Largest Win',value:fmtSignedINR(p.largestWinRs),color:'var(--green)',sub:'Single lot, net'},
    {label:'Max Win Streak',value:p.maxWinStreak+' days',color:p.maxWinStreak>=5?'var(--green)':p.maxWinStreak>=3?'var(--amber)':'var(--t1)',sub:'Consecutive profitable days'},
    {label:'Avg Hold',value:p.avgHoldDays+'d',color:'var(--t1)',sub:'Avg position duration'},
    {label:'Avg Position',value:fmtINR(p.avgCapital||0),color:'var(--t1)',sub:'Observed avg capital per position'},
    {label:'Avg Positions/Entry Day',value:p.avgPositionsPerEntryDay.toFixed(2),color:'var(--t1)',sub:`${p.positionCount} positions across ${p.entryDays} entry days`},
    {label:'Avg Learning Horizon',value:learningHorizon?learningHorizon.minutes.toFixed(1)+' min':'—',color:learningHorizon?'var(--cyan)':'var(--t3)',sub:learningHorizon?`${learningHorizon.count} learned snapshot horizons`:'Starts with the next learned horizon'},
    {label:'Recommended Position',value:recPos.value?fmtINR(recPos.value):'—',color:recPos.value?'var(--amber)':'var(--t3)',sub:recPosSub},
    {label:'Review After',value:effectiveReviewDays?effectiveReviewDays+'d':'—',color:effectiveReviewDays?'var(--amber)':'var(--t3)',sub:exitPolicy&&exitPolicy.velocityPctPerDay!=null?`Realised baseline ${exitPolicy.holdDays}d · rocket timing floor`:'Re-upload tradebook to learn'},
    {label:'Largest Loss',value:fmtSignedINR(p.largestLossRs),color:'var(--red)',sub:'Single lot, net'},
    {label:'Max Drawdown',value:p.maxDrawdown>0?fmtSignedINR(-p.maxDrawdown):'—',color:'var(--red)',sub:'Peak-to-trough in period'},
    {label:'Max Loss Streak',value:p.maxLossStreak+' days',color:p.maxLossStreak>=5?'var(--red)':p.maxLossStreak>=3?'var(--amber)':'var(--green)',sub:'Consecutive losing days'},
    {label:'Best Day',value:p.maxProfitDay?fmtSignedINR(p.maxProfitDay.pnl):'—',color:p.maxProfitDay&&p.maxProfitDay.pnl>0?'var(--green)':'var(--t3)',sub:p.maxProfitDay?p.maxProfitDay.date+' · '+p.maxProfitDay.count+' lots':'No data'},
    {label:'Worst Day',value:p.maxLossDay?fmtSignedINR(p.maxLossDay.pnl):'—',color:p.maxLossDay&&p.maxLossDay.pnl<0?'var(--red)':'var(--t3)',sub:p.maxLossDay?p.maxLossDay.date+' · '+p.maxLossDay.count+' lots':'No data'},
  ];
  if(recSummary.evaluated){
    const bestUpside=recSummary.avgBestHighPct;
    kpis.splice(11,0,
      {label:'Rocket Conversion',value:recSummary.conversionPct+'%',color:recSummary.conversionPct>=20?'var(--green)':recSummary.conversionPct>=10?'var(--amber)':'var(--red)',sub:`Score overlay · ${recSummary.rockets}/${recSummary.evaluated} completed picks`},
      {label:'Shortlist Peak',value:bestUpside!=null?(bestUpside>=0?'+':'')+bestUpside.toFixed(2)+'%':'—',color:bestUpside!=null?(bestUpside>=0?'var(--green)':'var(--red)'):'var(--t3)',sub:'Score overlay + TGT policy'},
      {label:'Avg Time to Rocket',value:recSummary.avgRocketDays!=null?recSummary.avgRocketDays+'d':'—',color:recSummary.avgRocketDays!=null?'var(--amber)':'var(--t3)',sub:recSummary.rocketArrivalCount?`Sets ${recSummary.horizonDays}d learning window · ${recSummary.rocketArrivalCount} conversions`:`Sets ${recSummary.horizonDays}d learning window`}
    );
  }
  if(entrySummary.completed){
    kpis.splice(11,0,
      {label:'Entry Peak / Day',value:(entrySummary.avgVelocity>=0?'+':'')+entrySummary.avgVelocity.toFixed(3)+'%/d',color:entrySummary.avgVelocity>=0?'var(--green)':'var(--red)',sub:`Score overlay · ${entrySummary.positive}/${entrySummary.completed} positive`},
      {label:'Entry Peak Net',value:(entrySummary.avgBestNet>=0?'+':'')+entrySummary.avgBestNet.toFixed(2)+'%',color:entrySummary.avgBestNet>=0?'var(--green)':'var(--red)',sub:`Feeds TGT policy · ${entrySummary.topups} top-ups`}
    );
  }
  const kpiHtml=`<div class="kpi-grid">`+kpis.map(k=>`
    <div class="kpi-card">
      <div class="kpi-lbl">${k.label}</div>
      <div class="kpi-val" style="color:${k.color}">${k.value}</div>
      <div class="kpi-sub">${k.sub}</div>
    </div>`).join('')+'</div>';

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
  adaptiveAllTrips.forEach(r=>{
    const ym=r.sellDate.substring(0,7);
    if(!monthMap[ym]) monthMap[ym]={month:ym,pnl:0,trades:0,days:0,_dates:new Set(),_minDate:r.sellDate,_maxDate:r.sellDate};
    monthMap[ym].pnl+=r.netPnl; monthMap[ym].trades++; monthMap[ym]._dates.add(r.sellDate);
    if(r.sellDate<monthMap[ym]._minDate) monthMap[ym]._minDate=r.sellDate;
    if(r.sellDate>monthMap[ym]._maxDate) monthMap[ym]._maxDate=r.sellDate;
  });
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

  // Latest Session — pick whichever source (Orders.csv or Tradebook) has the newer date.
  let todayHtml='';
  const _latestSummary=getLatestBookedSummary();
  PERF_LATEST_SUMMARY=_latestSummary; // cache for renderStats card — single source of truth
  const orderBooked=_latestSummary?.source==='Orders.csv'?_latestSummary:null;
  if(orderBooked){
    const latestRows=orderBooked.rows;
    const latestDate=orderBooked.date||getSessionDate();
    const latestTotal=orderBooked.total;
    const latestKnownRows=latestRows.filter(r=>r.capital>0&&r.netPnl!=null);
    const latestCapital=latestKnownRows.reduce((s,r)=>s+r.capital,0);
    const latestKnownNet=latestKnownRows.reduce((s,r)=>s+r.netPnl,0);
    const latestTotalPct=latestCapital>0?+(latestKnownNet/latestCapital*100).toFixed(2):null;
    const _chFmt=v=>fmtNegINR(v);const _chClr=()=>'var(--red)';
    const latestCols=[
      {key:'sym',label:'Symbol',align:'left',fmt:v=>v,clrFn:()=>'var(--t1)',bold:true},
      {key:'lots',label:'Trades',align:'right',fmt:v=>v,clrFn:()=>'var(--t2)'},
      {key:'buyPrice',label:'Buy ₹',align:'right',fmt:(v,r)=>v!=null?Number(v).toLocaleString('en-IN',INR_2):`<span style="color:var(--amber);font-size:10px" title="Load Holdings.csv to see avg cost">avg cost?</span>`,clrFn:()=>'var(--t2)'},
      {key:'sellPrice',label:'Sell ₹',align:'right',fmt:v=>Number(v).toLocaleString('en-IN',INR_2),clrFn:()=>'var(--t2)'},
      {key:'_brok',label:'Brokerage',align:'right',fmt:_chFmt,clrFn:_chClr},
      {key:'_stt',label:'STT/CTT',align:'right',fmt:_chFmt,clrFn:_chClr},
      {key:'_txn',label:'Txn',align:'right',fmt:_chFmt,clrFn:_chClr},
      {key:'_gst',label:'GST',align:'right',fmt:_chFmt,clrFn:_chClr},
      {key:'_sebi',label:'SEBI',align:'right',fmt:_chFmt,clrFn:_chClr},
      {key:'_stamp',label:'Stamp',align:'right',fmt:_chFmt,clrFn:_chClr},
      {key:'_dp',label:'DP',align:'right',fmt:_chFmt,clrFn:_chClr},
      {key:'charges',label:'Total Charges',align:'right',bold:true,fmt:fmtNegINR,clrFn:()=>'var(--red)'},
      {key:'netPnl',label:'Net P&L',align:'right',bold:true,fmt:(v,r)=>v!=null?fmtPerfRs(v):`<span style="color:var(--amber);font-size:10px">unknown</span>`,clrFn:(v)=>v!=null?clr(v):'var(--amber)'},
      {key:'netPnlPct',label:'P&L %',align:'right',bold:true,fmt:v=>v!=null?fmtPct(v):`<span style="color:var(--amber);font-size:10px">unknown</span>`,clrFn:v=>v!=null?clr(v):'var(--amber)'},
    ];
    const latestTbl=makeSortableTable('perf-latest',latestCols,latestRows,'_sort',-1);
    const headerNote=latestRows.length?'':`<div style="padding:12px 16px;color:var(--t3);font-size:12px">No sell orders found in Orders.csv — only sell orders generate P&L rows.</div>`;
    todayHtml=`<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden">
      <div style="padding:10px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--border)">
        <span style="font-size:10px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.1em">Latest Session — ${latestDate} <span style="font-weight:400;color:var(--t3)">(Orders.csv · holdings/same-day buys)</span></span>
        <span style="font-size:15px;font-weight:800;color:${clr(latestTotal)};font-family:'DM Mono',monospace">${latestRows.length?fmtPerfRs(latestTotal):''} <span style="font-size:10px;color:var(--t3);font-weight:400">${latestRows.length?'net of charges':''}</span></span>
      </div>
      ${latestRows.length?`<div style="overflow-x:auto">${latestTbl.getHtml()}</div>`:headerNote}
    </div>`;
    setTimeout(()=>{
      latestTbl.render();
      const _lt=document.getElementById('perf-latest');
      if(_lt&&latestRows.length>1){
        const _sum=(k)=>latestRows.reduce((s,r)=>s+(r[k]||0),0);
        const _c=v=>v>0?'var(--red)':'var(--t2)';
        const _p=v=>fmtPerfRs(v);
        const td=(v,extra='')=>`<td style="padding:7px 10px;text-align:right;white-space:nowrap;font-weight:700;${extra}">${v}</td>`;
        const tfoot=document.createElement('tfoot');
        tfoot.innerHTML=`<tr style="border-top:2px solid var(--border-hi);background:rgba(148,163,184,.05)">
          <td style="padding:7px 10px;font-weight:700;color:var(--t2);white-space:nowrap">Total (${latestRows.length})</td>
          ${td('—','color:var(--t3)')}
          ${td('—','color:var(--t3)')}
          ${td('—','color:var(--t3)')}
          ${td(fmtNegINR(_sum('_brok')),'color:var(--red)')}
          ${td(fmtNegINR(_sum('_stt')),'color:var(--red)')}
          ${td(fmtNegINR(_sum('_txn')),'color:var(--red)')}
          ${td(fmtNegINR(_sum('_gst')),'color:var(--red)')}
          ${td(fmtNegINR(_sum('_sebi')),'color:var(--red)')}
          ${td(fmtNegINR(_sum('_stamp')),'color:var(--red)')}
          ${td(fmtNegINR(_sum('_dp')),'color:var(--red)')}
          ${td(fmtNegINR(_sum('charges')),'color:var(--red)')}
          ${td(_p(latestTotal),'color:'+(latestTotal>=0?'var(--green)':'var(--red)'))}
          ${td(latestTotalPct==null?'--':fmtPct(latestTotalPct),'color:'+(latestTotalPct==null?'var(--t3)':latestTotalPct>=0?'var(--green)':'var(--red)'))}
        </tr>`;
        _lt.appendChild(tfoot);
      }
    },0);
  } else if(_latestSummary?.source==='Tradebook'){
    const tbRows=_latestSummary.rows.map(r=>{
      const capital=r.capital??((r.buyPrice||0)*(r.qty||0));
      const netPnlPct=r.netPnlPct??(capital>0?+(r.netPnl/capital*100).toFixed(2):null);
      return {...r,capital,netPnlPct,_sort:r.netPnl};
    });
    const tbDate=_latestSummary.date||'';
    const tbTotal=+(tbRows.reduce((s,r)=>s+r.netPnl,0)).toFixed(0);
    const tbCapital=tbRows.reduce((s,r)=>s+(r.capital||0),0);
    const tbTotalPct=tbCapital>0?+(tbTotal/tbCapital*100).toFixed(2):null;
    const tbCols=[
      {key:'sym',label:'Symbol',align:'left',fmt:v=>`<span style="font-weight:700;font-size:12px">${escHtml(v)}</span>`},
      {key:'lots',label:'Lots',align:'right',fmt:v=>`<span style="color:var(--t2)">${v}</span>`},
      {key:'buyPrice',label:'Buy ₹',align:'right',fmt:v=>`<span style="font-family:'DM Mono',monospace">${Number(v).toLocaleString('en-IN',INR_2)}</span>`},
      {key:'sellPrice',label:'Sell ₹',align:'right',fmt:v=>`<span style="font-family:'DM Mono',monospace">${Number(v).toLocaleString('en-IN',INR_2)}</span>`},
      {key:'charges',label:'Charges ₹',align:'right',bold:true,fmt:fmtNegINR,clrFn:()=>'var(--red)'},
      {key:'netPnl',label:'Net P&L',align:'right',bold:true,fmt:fmtPerfRs,clrFn:clr},
      {key:'netPnlPct',label:'P&L %',align:'right',bold:true,fmt:v=>v!=null?fmtPct(v):'--',clrFn:v=>v!=null?clr(v):'var(--t3)'},
    ];
    const tbTbl=makeSortableTable('perf-latest',tbCols,tbRows,'_sort',-1);
    todayHtml=`<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden">
      <div style="padding:10px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--border)">
        <span style="font-size:10px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.1em">Latest Session — ${tbDate} <span style="font-weight:400;color:var(--t3)">(Tradebook · charges included)</span></span>
        <span style="font-size:15px;font-weight:800;color:${clr(tbTotal)};font-family:'DM Mono',monospace">${fmtPerfRs(tbTotal)} <span style="font-size:10px;color:var(--t3);font-weight:400">net of charges</span></span>
      </div>
      <div style="overflow-x:auto">${tbTbl.getHtml()}</div>
    </div>`;
    setTimeout(()=>{
      tbTbl.render();
      const _lt=document.getElementById('perf-latest');
      if(_lt&&tbRows.length>1){
        const tfoot=document.createElement('tfoot');
        const totCh=tbRows.reduce((s,r)=>s+(r.charges||0),0);
        tfoot.innerHTML=`<tr style="border-top:2px solid var(--border-hi);background:rgba(148,163,184,.05)">
          <td style="padding:7px 10px;font-weight:700;color:var(--t2)">Total (${tbRows.length})</td>
          <td style="padding:7px 10px;text-align:right;color:var(--t3)">—</td>
          <td style="padding:7px 10px;text-align:right;color:var(--t3)">—</td>
          <td style="padding:7px 10px;text-align:right;color:var(--t3)">—</td>
          <td style="padding:7px 10px;text-align:right;font-weight:700;color:var(--red)">${fmtNegINR(totCh)}</td>
          <td style="padding:7px 10px;text-align:right;font-weight:700;color:${tbTotal>=0?'var(--green)':'var(--red)'}">${fmtSignedINR(tbTotal)}</td>
          <td style="padding:7px 10px;text-align:right;font-weight:700;color:${tbTotalPct==null?'var(--t3)':tbTotalPct>=0?'var(--green)':'var(--red)'}">${tbTotalPct==null?'--':fmtPct(tbTotalPct)}</td>
        </tr>`;
        _lt.appendChild(tfoot);
      }
    },0);
  } else {
    todayHtml=`<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;margin-bottom:12px;padding:14px 16px;color:var(--t3);font-size:12px">
      <span style="font-weight:600;color:var(--t2)">Latest Session</span> — Upload <strong>Tradebook.csv</strong> or <strong>Orders.csv</strong> to see session P&amp;L.
    </div>`;
  }

  // ── Time-Stop Alert: open positions held past the learned review horizon ──
  // Built from HOLDINGS + POSITIONS (qty>0). Days held is quantity-weighted from
  // unmatched FIFO tradebook buy lots, so small top-ups do not reset old holdings.
  // Action thresholds are derived from this user's own tradebook below.
  let timeStopHtml='', timeStopTblObj=null;
  (function(){
    if(!allTrips.length) return;
    const adaptiveSL=TRADEBOOK_STATS?.adaptiveSL||3.5;
    const adaptiveTGT=getEffectiveTgtPct()||(TRADEBOOK_STATS?.adaptiveTGT||3.7);
    // Apply the net profit-per-day horizon learned from closed tradebook outcomes.
    const cutoffDays=getEffectiveReviewDays()||5;
    const _longRows=allTrips.filter(t=>t.holdDays>cutoffDays);
    const _longWins=_longRows.filter(t=>t.netPnlPct>0).length;
    const _longTotal=_longRows.length;
    const _longPnl=_longRows.reduce((s,t)=>s+(t.netPnl||0),0);
    const _longWR=_longTotal?Math.round(_longWins/_longTotal*100):0;

    // ── Build live open-position rows ──
    const _rows=[];
    const _tslStore=FS.get(POS_TSL_STORE)||{};
    const _tslNext={};
    let _tslChanged=false;
    const _addPos=(sym,qty,avg,ltpHint)=>{
      if(!sym||qty<=0) return;
      const scannerRow=ALL.find(s=>s.symbol===sym);
      const ltp=scannerRow?.price
        ||(POSITIONS?.find(p=>p.symbol===sym)?.ltp)
        ||(HOLDINGS?.find(h=>h.symbol===sym)?.ltp)
        ||ltpHint||null;
      const avgCost=avg||HOLD_COST_MAP[sym]||null;
      const pnlPct=(avgCost&&ltp)?+((ltp-avgCost)/avgCost*100).toFixed(2):null;
      const pnlRs=(avgCost&&ltp&&qty)?+((ltp-avgCost)*qty).toFixed(0):null;
      const daysHeld=getOpenPositionDaysHeld(sym,qty);
      const capDeployed=(avgCost&&qty)?+(avgCost*qty).toFixed(0):null;
      const tgtPrice=avgCost?tickPrice(avgCost*(1+adaptiveTGT/100)):null;
      const slPrice=avgCost?tickPrice(avgCost*(1-adaptiveSL/100)):null;
      // Distance to SL: positive = above SL (safe), negative = breached SL
      const distSL=(ltp!=null&&slPrice!=null&&slPrice>0)?+((ltp-slPrice)/slPrice*100).toFixed(2):null;
      const tslInfo=calcPositionTSL({sym,qty,avgCost,ltp,scannerRow,adaptiveSL,adaptiveTGT,prev:_tslStore[sym]});
      if(tslInfo){
        _tslNext[sym]=tslInfo;
        if(JSON.stringify(_tslStore[sym]||{})!==JSON.stringify(tslInfo)) _tslChanged=true;
      }
      const signal=null; // computed below after all rows collected — needs cross-row normalisation
      const rawTsl1Price=tslInfo?.tsl1??null;
      const rawTsl2Price=tslInfo?.tsl2??tslInfo?.tsl??null;
      const tsl1Price=actionableSellTrigger(rawTsl1Price,ltp);
      const tsl2Price=actionableSellTrigger(rawTsl2Price,ltp);
      _rows.push({sym,qty,avg:avgCost,ltp,pnlPct,pnlRs,daysHeld,capDeployed,tgtPrice,slPrice,distSL,
        tslPrice:tsl2Price,tslRawPrice:rawTsl2Price,tslGapPct:tslInfo?.gapPct2??tslInfo?.gapPct??null,tslPeakPct:tslInfo?.peakProfitPct??null,
        tslLockPct:tslInfo?.lockPct2??tslInfo?.lockPct??null,tslPoints:tslInfo?.trailPoints2??tslInfo?.trailStepPoints??tslInfo?.trailPoints??null,
        tslDistance:tslInfo?.distancePoints2??tslInfo?.distancePoints??null,tslBasis:tslInfo?.basis2||tslInfo?.basis||'',
        tsl1Price,tsl1RawPrice:rawTsl1Price,tsl1GapPct:tslInfo?.gapPct1??null,tsl1LockPct:tslInfo?.lockPct1??null,
        tsl1Points:tslInfo?.trailPoints1??null,tsl1Distance:tslInfo?.distancePoints1??null,tsl1Basis:tslInfo?.basis1||'',tsl1TargetPct:tslInfo?.targetPct1??adaptiveTGT,
        tsl2Price,tsl2RawPrice:rawTsl2Price,tsl2GapPct:tslInfo?.gapPct2??null,tsl2LockPct:tslInfo?.lockPct2??null,
        tsl2Points:tslInfo?.trailPoints2??null,tsl2Distance:tslInfo?.distancePoints2??null,tsl2Basis:tslInfo?.basis2||'',tsl2TargetPct:tslInfo?.targetPct2??(getRunnerTgtPct(scannerRow,avgCost,adaptiveTGT)||adaptiveTGT*1.5),signal,
        _sortDays:daysHeld==null?-1:daysHeld});
    };
    Object.values(getCombinedOpenPositionMap()).forEach(pos=>{
      if(pos.qty>0) _addPos(pos.symbol,pos.qty,pos.avg,pos.ltp);
    });
    if(!_rows.length){
      if(Object.keys(_tslStore).length) FS.set(POS_TSL_STORE,{});
      return; // nothing to show
    }
    if(Object.keys(_tslStore).some(sym=>!_tslNext[sym])) _tslChanged=true;
    if(_tslChanged) FS.set(POS_TSL_STORE,_tslNext);

    // ── Signal: composite exit urgency score ──
    // Components: P&L% (40%), P&L ₹ (30%), Days Held (20%), Distance to SL (10%)
    // All normalised to [-1,+1] across current rows. Lower = more urgent to exit.
    // Days Held contribution is sign-flipped: more days → more negative (penalise time drag on losers).
    // 0d positions get null — too early to judge.
    {
      const _norm=(vals)=>{
        const clean=vals.filter(v=>v!=null&&isFinite(v));
        if(!clean.length) return vals.map(()=>0);
        const mn=Math.min(...clean), mx=Math.max(...clean);
        return vals.map(v=>(v==null||!isFinite(v))?null:(mx===mn?0:2*(v-mn)/(mx-mn)-1));
      };
      const eligible=_rows.filter(r=>r.daysHeld!=null&&r.daysHeld>=1);
      if(eligible.length){
        const nPnlPct =_norm(eligible.map(r=>r.pnlPct));
        const nPnlRs  =_norm(eligible.map(r=>r.pnlRs));
        const nDays   =_norm(eligible.map(r=>r.daysHeld));  // flipped below
        const nDistSL =_norm(eligible.map(r=>r.distSL));
        eligible.forEach((r,i)=>{
          const pp=nPnlPct[i]??0, pr=nPnlRs[i]??0, dy=nDays[i]??0, sl=nDistSL[i]??0;
          r.signal=+((pp + pr + (-dy) + sl) / 4).toFixed(2);
        });
      }
    }

    // Negative signal = underperforming (exit candidates), positive = holding well
    const _negCount=_rows.filter(r=>r.signal!=null&&r.signal<0).length;
    const _posCount=_rows.filter(r=>r.signal!=null&&r.signal>=0).length;
    const _flaggedCap=_rows.filter(r=>r.signal!=null&&r.signal<0).reduce((s,r)=>s+(r.capDeployed||0),0);
    const _totalCap=_rows.reduce((s,r)=>s+(r.capDeployed||0),0);
    const _flaggedPct=_totalCap?Math.round(_flaggedCap/_totalCap*100):0;

    const _daysFmt=v=>{
      if(v==null) return '<span style="color:var(--t3)">—</span>';
      const c=v>cutoffDays?'var(--red)':v>=cutoffDays?'var(--amber)':'var(--t1)';
      return `<span title="Quantity-weighted age of remaining FIFO buy lots" style="color:${c};font-weight:${v>cutoffDays?700:500}">${v}d</span>`;
    };
    const cols=[
      {key:'sym',label:'Symbol',align:'left',fmt:v=>v,clrFn:()=>'var(--t1)',bold:true},
      {key:'qty',label:'Qty',align:'right',fmt:v=>v,clrFn:()=>'var(--t2)'},
      {key:'avg',label:'Avg ₹',align:'right',fmt:v=>v!=null?Number(v).toLocaleString('en-IN',INR_2):'—',clrFn:()=>'var(--t2)'},
      {key:'ltp',label:'LTP ₹',align:'right',fmt:v=>v!=null?Number(v).toLocaleString('en-IN',INR_2):'—',clrFn:()=>'var(--t1)'},
      {key:'pnlPct',label:'P&L %',align:'right',bold:true,fmt:v=>v!=null?(v>=0?'+':'')+v.toFixed(2)+'%':'—',clrFn:v=>v==null?'var(--t3)':v>0?'var(--green)':v<0?'var(--red)':'var(--t2)'},
      {key:'pnlRs',label:'P&L ₹',align:'right',fmt:v=>v!=null?fmtSignedINR(v):'—',clrFn:v=>v==null?'var(--t3)':v>0?'var(--green)':v<0?'var(--red)':'var(--t2)'},
      {key:'capDeployed',label:'Capital ₹',align:'right',fmt:fmtINR,clrFn:()=>'var(--t2)'},
      {key:'_sortDays',label:'Days Held',align:'right',fmt:(v,r)=>_daysFmt(r.daysHeld),clrFn:()=>'var(--t1)'},
      {key:'tgtPrice',label:'Target ₹',align:'right',fmt:(v,r)=>v!=null?fmtINR(v)+`<span style="font-size:10px;color:var(--t3);margin-left:4px">+${adaptiveTGT}%</span>`:'—',clrFn:()=>'var(--green)'},
      {key:'slPrice',label:'SL ₹',align:'right',fmt:(v,r)=>v!=null?fmtINR(v)+`<span style="font-size:10px;color:var(--t3);margin-left:4px">-${adaptiveSL}%</span>`:'—',clrFn:()=>'var(--red)'},
      {key:'tsl1Price',label:'TSL 1 Trigger ₹',align:'right',bold:true,fmt:(v,r)=>v!=null?fmtINR(v)+`<div style="font-size:10px;color:var(--t3);margin-top:1px">gap ${Number(r.tsl1Distance??0).toLocaleString('en-IN',INR_2)} · step ${Number(r.tsl1Points??0).toLocaleString('en-IN',INR_2)}</div><div style="font-size:10px;color:var(--t3);margin-top:1px">${Number(r.tsl1GapPct??0).toFixed(2)}% gap</div>`:'—',clrFn:(v,r)=>v==null?'var(--t3)':r.tsl1LockPct>0?'var(--green)':r.tsl1LockPct===0?'var(--amber)':'var(--red)'},
      {key:'tsl2Price',label:'TSL 2 Trigger ₹',align:'right',bold:true,fmt:(v,r)=>v!=null?fmtINR(v)+`<div style="font-size:10px;color:var(--t3);margin-top:1px">gap ${Number(r.tsl2Distance??0).toLocaleString('en-IN',INR_2)} · step ${Number(r.tsl2Points??0).toLocaleString('en-IN',INR_2)}</div><div style="font-size:10px;color:var(--t3);margin-top:1px">${Number(r.tsl2GapPct??0).toFixed(2)}% gap</div>`:'—',clrFn:(v,r)=>v==null?'var(--t3)':r.tsl2LockPct>0?'var(--green)':r.tsl2LockPct===0?'var(--amber)':'var(--red)'},
      {key:'signal',label:'Signal',align:'right',bold:true,fmt:v=>v!=null?(v>=0?'+':'')+v.toFixed(2):'—',clrFn:v=>v==null?'var(--t3)':v>0?'var(--green)':v<0?'var(--red)':'var(--t2)'},
    ];
    // Sort: signal ascending (worst first), then days desc
    const _sorted=[..._rows].sort((a,b)=>(a.signal??999)-(b.signal??999)||b._sortDays-a._sortDays);
    timeStopTblObj=makeSortableTable('perf-timestop',cols,_sorted,'signal',1);

    // ── Header summary ──
    const _summaryColor=_negCount>0?'var(--red)':'var(--green)';
    const _summaryIcon=_negCount>0?'🛑':'✅';
    const _summaryText=_negCount>0
      ?`<strong style="color:var(--red)">${_negCount}</strong> of ${_rows.length} positions with negative signal (${_flaggedPct}% of capital ${fmtINR(_flaggedCap)} underperforming)`
      :`All ${_rows.length} positions showing positive signal.`;

    const _badges=[
      _negCount>0?`<span style="padding:3px 10px;border-radius:12px;background:rgba(239,68,68,.18);color:var(--red);font-weight:700;font-size:11px">🛑 ${_negCount} NEGATIVE</span>`:'',
      _posCount>0?`<span style="padding:3px 10px;border-radius:12px;background:rgba(34,197,94,.12);color:var(--green);font-weight:700;font-size:11px">✅ ${_posCount} POSITIVE</span>`:'',
    ].filter(Boolean).join(' ');

    const _evidence=_longTotal>0
      ?`<div style="font-size:11px;color:var(--t3);margin-top:6px;line-height:1.5"><strong style="color:var(--t2)">Signal</strong> = avg(P&amp;L%, P&amp;L ₹, −Days Held, Dist-to-SL), all cross-normalised to [−1,+1]. Days Held is quantity-weighted across the remaining FIFO buy lots. Equal weights — lower = more urgent to exit. The tradebook exit policy reviews positions after <strong style="color:var(--amber)">${cutoffDays}d</strong>; historically, trips beyond it had a <strong style="color:${_longWR<50?'var(--red)':'var(--amber)'}">${_longWR}% win rate</strong> across ${_longTotal} lots (net ${fmtSignedINR(_longPnl)}).</div>`
      :'';

    timeStopHtml=`<div id="perf-timestop-card" style="background:var(--bg-card);border:1px solid ${_negCount>0?'rgba(239,68,68,.4)':'var(--border)'};border-radius:10px;margin-bottom:12px;overflow:hidden">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px">
          <span style="font-size:11px;font-weight:800;color:${_summaryColor};text-transform:uppercase;letter-spacing:.08em">${_summaryIcon} Open Positions</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${_badges}</div>
        </div>
        <div style="font-size:12px;color:var(--t2);line-height:1.5">${_summaryText}</div>
        ${_evidence}
      </div>
      <div style="overflow-x:auto">${timeStopTblObj.getHtml()}</div>
    </div>`;
  })();

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
    ${_navLink('perf-timestop-card','📊 Positions',!!timeStopHtml)}
    ${_navLink('perf-kpi','📊 KPIs',true)}
    ${_navLink('perf-outcomes','Outcome Feedback',true)}

    ${_navLink('perf-monthly','📅 Monthly',monthRows.length>0)}
    ${_navLink('perf-trade-windows','🕐 Trading Windows',hasTradeWindows)}
    ${_navLink('perf-stocks','📈 Stocks',p.symBreakdown.length>0)}
  </nav>`;
  const entryOutcomeText=entrySummary.completed
    ? `${entrySummary.completed} actual recommended buys assessed over their adaptive outcome windows (${entrySummary.topups} top-ups). Their average best net opportunity is ${entrySummary.avgBestNet>=0?'+':''}${entrySummary.avgBestNet.toFixed(2)}%; their best observed peak velocity averages ${entrySummary.avgVelocity>=0?'+':''}${entrySummary.avgVelocity.toFixed(3)}%/day. These outcomes provide confidence context only and refine the two-leg target policy with sample-size confidence.`
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
  const outcomeHtml=perfCard('Recommendation Outcome Feedback',
    `<div style="padding:14px 16px;color:var(--t2);font-size:12px;line-height:1.7"><div><strong style="color:var(--t1)">Actual entries:</strong> ${entryOutcomeText}</div><div style="margin-top:8px"><strong style="color:var(--t1)">Eligible shortlist:</strong> ${outcomeText}</div><div style="margin-top:8px"><strong style="color:var(--t1)">Same-day exit opportunity:</strong> ${escapeText}</div><div style="margin-top:8px;color:var(--t3)">Dynamic current-minus-prior-trading-day feature deltas versus the current 1D top-10% target train raw mRMR relevance. Completed shortlist and executed-entry outcomes are shown as confidence context only, while tradebook and missed-opportunity evidence refine sizing, review timing, and TGT1/TGT2.</div></div>`,'','perf-outcomes');

  el.innerHTML=`
    <div style="padding:12px 16px">
      ${todayHtml}
      ${timeStopHtml}
      ${perfNav}
      ${periodPillsHtml}
      <div style="font-size:10px;color:var(--t3);margin-bottom:12px">${periodLabel} · ${p.roundTrips} lots</div>
      <div id="perf-kpi">${kpiHtml}</div>
      ${outcomeHtml}
      ${monthRows.length?perfCard('Monthly Breakdown',monthTbl.getHtml(),'','perf-monthly'):''}
      ${hasTradeWindows?perfCard('Trading Windows <span style="font-size:10px;color:var(--t3);font-weight:400">Buy Edge &gt; 2 = Enter · Sell Edge &gt; 2 = Exit · hover Edge columns to sort</span>',tradeWindowTbl.getHtml(),'','perf-trade-windows'):''}
      ${p.symBreakdown.length?perfCard('Stocks',symTbl.getHtml(),'360px','perf-stocks'):''}
    </div>`;

  setTimeout(()=>{monthTbl.render();symTbl.render();tradeWindowTbl.render();if(timeStopTblObj)timeStopTblObj.render();},0);
}

function schedulePerformanceRender(){
  if(PERF_RENDER_QUEUED) return;
  PERF_RENDER_QUEUED=true;
  const el=document.getElementById('perfContent');
  if(el&&!PERF_RENDERED) el.innerHTML=`<div style="text-align:center;padding:60px 40px;color:var(--t2)"><div style="font-size:34px;margin-bottom:14px">📈</div><div style="font-size:15px;font-weight:700;color:var(--t1);margin-bottom:8px">Calculating performance</div><div>Rankings are ready while trade analytics finish in the background.</div></div>`;
  idleTask(()=>{
    PERF_RENDER_QUEUED=false;
    renderPerformance();
    try{if(ALL.length) renderStats();}catch(e){console.warn('Stats refresh after performance failed',e);}
  },900);
}

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
    const tag=window._lastScannerSessionTag||ACC_CORR?.lastTag||scannerSessionTag(fileName,raw);
    if(!ACC_CORR||ACC_CORR.lastTag!==tag) ACC_CORR={...(ACC_CORR||{corr:{},sessions:0}),lastTag:tag};
    ALL=await runEngine(raw,tag,{advanceSnapshot:false})||[];
    ALL.sort((a,b)=>b.rocketScore-a.rocketScore);
    const rc=FS.get(modeKey(REC_COUNT_STORE))||{}, rcD=rc[getSessionDate()]||{};
    ALL.forEach(s=>{s.seen=rcD[s.symbol]||0;});
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
  if(ENGINE_DATA){ENGINE_DATA.survRuleRows=syncSurvRuleRows(ENGINE_DATA.survRuleRows||[]);persistMethodologySnapshot();}
  _refreshHFSection();
  await refreshRankingsAfterSurvRuleChange();
  showToast(`<strong>Added hard filter</strong> &mdash; ${escHtml(column)}. It will be applied whenever that REG1 column is flagged.`,3500);
}
async function removeSurvRule(key){
  SURV_CUSTOM_RULES=SURV_CUSTOM_RULES.filter(rule=>rule.key!==key&&survRuleKey(rule.column||rule.label)!==key);
  saveSurvRules();
  rebuildActiveSurveillanceHits();
  if(ENGINE_DATA){ENGINE_DATA.survRuleRows=syncSurvRuleRows(ENGINE_DATA.survRuleRows||[]);persistMethodologySnapshot();}
  _refreshHFSection();
  await refreshRankingsAfterSurvRuleChange();
  showToast('Surveillance rule removed.',2500);
}
function buildHardFilterMethodologyHTML(E){
  const rows=getHardFilterRowsFromEngine(E);
  const survRows=rows.filter(r=>r.kind==='surv');
  const survRemoved=survRows.reduce((s,r)=>s+(r.active&&r.removed!=null?r.removed:0),0);

  // ── Surveillance Table — only surv rows, all with Remove buttons ──
  const addedRuleKeys=new Set(getSurvRules().map(r=>r.key));
  const availableCols=(SURV_FILE_RULES.length>0?SURV_FILE_RULES:SURV_HEADERS.filter(h=>{
    const hl=h.trim().toLowerCase();
    return !['scripcode','symbol','nse exclusive','status','series'].includes(hl)&&!/^filler/i.test(h.trim());
  })).map(r=>r.column||r).filter(h=>!addedRuleKeys.has(survRuleKey(h)));
  const datalistHtml=availableCols.map(col=>`<option value="${escHtml(col)}"></option>`).join('');

  const hfRows=survRows.map(row=>({
    criteria:row.criteria,
    removedSort:row.active&&row.removed!=null?(row.removed||0):-1,
    active:row.active, kind:row.kind, missing:!!row.missing, ruleKey:row.ruleKey||'',
    inactiveNote:row.missing
      ?'⚠ Column not found in REG1 file — ALL stocks blocked as precaution. Remove and re-add with correct column name.'
      :(!row.active?'Inactive — REG1 column not found in last upload':''),
  }));
  const hfCols=[
    {key:'criteria',label:'REG1 Column',align:'left',
      fmt:(v,r)=>`<span style="font-size:11px;color:${r.missing?'var(--amber)':r.active?'var(--t1)':'var(--t3)'}">${escHtml(v)}${r.inactiveNote?`<div style="font-size:10px;color:${r.missing?'var(--amber)':'var(--red)'};margin-top:2px">${r.inactiveNote}</div>`:''}</span>`,
      totFmt:()=>`<span style="font-size:11px;color:var(--t2);font-weight:700">Total</span>`},
    {key:'removedSort',label:'Removed',align:'right',
      fmt:(v)=>v>=0?`<span style="color:${v>0?'var(--red)':'var(--t3)'};font-weight:700;font-family:'DM Mono',monospace">${v.toLocaleString()}</span>`:'&mdash;',
      totFmt:(v)=>`<span style="color:var(--red);font-weight:700;font-family:'DM Mono',monospace">${v.toLocaleString()}</span>`},
    {key:'ruleKey',label:'',align:'right',
      fmt:(v,r)=>`<button onclick="removeSurvRule('${v}')" style="padding:4px 8px;border-radius:6px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.08);color:var(--red);font-size:10px;font-weight:700;cursor:pointer">Remove</button>`,
      totFmt:()=>''},
  ];
  const hfTotalsRemoved=hfRows.reduce((s,r)=>s+(r.removedSort>=0?r.removedSort:0),0);
  _methTbls.hf=makeSortableTable('tbl-hf',hfCols,hfRows,'removedSort',-1,null,{
    criteria:null,removedSort:hfTotalsRemoved,ruleKey:null,
  });

  const survSize=E?.survSize??0;
  const survActiveThisSession=SURV_HEADERS.length>0;
  const survMeta=survActiveThisSession
    ? `<div style="font-size:11px;color:var(--t3);margin-top:8px">REG1 file active this session. Removed counts are primary-rule removals and don't double-count.</div>`
    : (survSize>0
      ? `<div style="font-size:11px;color:var(--amber);margin-top:8px">Showing last saved run (${survSize} flagged). Load NSE ZIP this session to refresh.</div>`
      : `<div style="margin-top:8px;padding:8px 10px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;font-size:11px;color:var(--red)">NSE REG1 data not active — surveillance rows shown for configuration only, won't filter until a REG1 file is loaded.</div>`);

  const totalRemoved=(REMOVED.uc||0)+(REMOVED.surv||0)+(REMOVED.nonEq||0)+(REMOVED.liq||0)+(REMOVED.fscore||0)+(REMOVED.atr||0);
  return `
    <h3 id="meth-filters" style="margin-top:28px">Hard Filters <span style="font-size:12px;color:var(--t3);font-weight:400">(${totalRemoved} removals in latest saved run)</span></h3>

    <h4 style="margin:20px 0 8px;font-size:12px;color:var(--t2);font-weight:700;text-transform:uppercase;letter-spacing:.5px">Surveillance Filters (NSE REG1)</h4>
    <p style="color:var(--t3);font-size:11px;margin-bottom:10px">Each row is an exact REG1 column. Any stock flagged under that column is removed from scanning.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <input id="survRuleInput" type="text" placeholder="${SURV_HEADERS.length?'Type to search REG1 columns…':'Load NSE ZIP to enable suggestions'}" list="survRuleDatalist" onkeydown="if(event.key==='Enter'){event.preventDefault();addSurvRule();}" style="flex:1;min-width:260px;padding:9px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;color:var(--t1);font-size:12px;outline:none">
      <datalist id="survRuleDatalist">${datalistHtml}</datalist>
      <button class="btn" onclick="addSurvRule()" style="font-weight:700">+ Add Rule</button>
    </div>
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div style="overflow-x:auto">${_methTbls.hf.getHtml()}</div>
    </div>
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
    const ltp=ALL.find(s=>s.symbol===sym)?.price
      ||POSITIONS?.find(p=>p.symbol===sym)?.ltp
      ||HOLDINGS?.find(h=>h.symbol===sym)?.ltp
      ||null;
    const avg=pos.avg||HOLD_COST_MAP[sym]||HOLDINGS?.find(h=>h.symbol===sym)?.avgCost||null;
    if(!(ltp>0)||!(avg>0)) return;
    const pnlPct=+(((ltp-avg)/avg)*100).toFixed(2);
    Object.keys(hitCols).forEach(col=>{
      const label=String(col||'').trim();
      const lower=label.toLowerCase();
      if(!label||nonFlag.has(lower)||/^filler/i.test(label)) return;
      const key=survRuleKey(label);
      if(!key) return;
      if(!rowsByCol[key]) rowsByCol[key]={key,col:label,stocks:[]};
      rowsByCol[key].stocks.push({sym,pnlPct});
    });
  });
  return Object.values(rowsByCol).map(row=>{
    row.stocks.sort((a,b)=>a.pnlPct-b.pnlPct);
    const avgPnl=row.stocks.reduce((sum,s)=>sum+s.pnlPct,0)/row.stocks.length;
    const wins=row.stocks.filter(s=>s.pnlPct>0).length;
    return {...row,sessions:10,lastCount:row.stocks.length,avgPnl,winRate:wins/row.stocks.length*100};
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
    if(!SURV_CORR_ACC[row.key]) SURV_CORR_ACC[row.key]={col:row.col,key:row.key,sessions:0,winRate:0,avgPnl:0,lastCount:0};
    const acc=SURV_CORR_ACC[row.key];
    const n=acc.sessions+1;
    acc.winRate=(acc.winRate*(n-1)+row.winRate)/n;
    acc.avgPnl=(acc.avgPnl*(n-1)+row.avgPnl)/n;
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
    const verdict=r.sessions<2?'❓':r.winRate<35&&r.avgPnl<-0.5?'🚫 Filter':r.winRate>65&&r.avgPnl>0.5?'✅ Safe':'📊 Neutral';
    const stocks=r.stocks||[];
    const heldPills=stocks.map(({sym,pnlPct})=>{
      const pnlColor=pnlPct>=0?'var(--green)':'var(--red)';
      const pnlStr=pnlPct!=null?(pnlPct>=0?'+':'')+pnlPct.toFixed(1)+'%':'—';
      return `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:4px;padding:2px 6px;margin:2px 3px 2px 0;white-space:nowrap;font-family:'DM Mono',monospace"><span style="font-weight:700;color:var(--amber);font-size:11px">${escHtml(sym)}</span><span style="color:${pnlColor};font-size:10px">${pnlStr}</span></span>`;
    }).join('');
    return {col:r.col,sessions:r.sessions,lastCount:r.lastCount,winRate:r.winRate,avgPnl:r.avgPnl,
      verdict,_conf:conf,_maxSess:maxSess,heldPills,_heldCount:stocks.length,_addBtn:0};
  });
  const scCols=[
    {key:'col',label:'Surveillance Column',align:'left',fmt:(v)=>`<span style="font-size:11px" title="${escHtml(v)}">${escHtml(v)}</span>`},
    {key:'lastCount',label:'Holdings Flagged',align:'right',fmt:(v)=>`<span style="color:var(--t3);font-family:'DM Mono',monospace">${v}</span>`},
    {key:'avgPnl',label:'Avg Unrealised P&L%',align:'right',fmt:(v)=>`<span style="color:${v<0?'var(--red)':v>0?'var(--green)':'var(--t3)'};font-weight:700;font-family:'DM Mono',monospace" title="Average unrealised P&L% of your holdings currently flagged by this column">${v>=0?'+':''}${v.toFixed(2)}%</span>`},
    {key:'verdict',label:'Signal',align:'left',fmt:(v)=>`<span style="color:${v.startsWith('🚫')?'var(--red)':v.startsWith('✅')?'var(--green)':'var(--amber)'};font-weight:700">${v}</span>`},
    {key:'heldPills',label:'Held Positions',align:'left',fmt:(v,row)=>v||`<span style="color:var(--t3);font-size:11px">—</span>`},
    {key:'_addBtn',label:'',align:'right',fmt:(v,row)=>`<button onclick="addSurvRule(${escHtml(JSON.stringify(row.col))})" style="padding:4px 8px;border-radius:6px;border:1px solid rgba(34,197,94,.3);background:rgba(34,197,94,.08);color:var(--green);font-size:10px;font-weight:700;cursor:pointer">Add</button>`},
  ];
  _methTbls.sc=makeSortableTable('tbl-sc',scCols,scRows,'avgPnl',1); // worst avg P&L first
  return `
    <h4 id="meth-surv-corr" style="margin:16px 0 6px;font-size:13px;color:var(--t2)">📊 Surveillance P&L Correlation
      <button onclick="if(confirm('Reset surveillance correlation accumulator?')){SURV_CORR_ACC={};SURV_CORR_LAST_TAG=null;FS.set(SURV_CORR_STORE,{});_refreshHFSection();}" style="margin-left:12px;padding:3px 8px;border-radius:6px;border:1px solid var(--border);background:none;color:var(--t3);font-size:10px;cursor:pointer">Reset</button>
    </h4>
    <p style="font-size:11px;color:var(--t3);margin-bottom:8px">For each surveillance column, shows how your <em>currently held stocks</em> flagged by that column are performing (average unrealised P&L%). A column with deep negative avg P&L means your flagged holdings are underwater — consider tightening SLs or exiting. Signal = 🚫 Filter when avg P&L &lt; −0.5%.</p>
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
function _renderMethodologyInner(){
  const E=ENGINE_DATA;
  if(!E||!E.features||!E.features.length||!E.mrmr||!E.weights||!E.targetCorr)return;
  // Guard all potentially missing fields
  if(!E.labels) E.labels={};
  if(E.accSessions==null) E.accSessions=0;
  if(!E.laggedNote) E.laggedNote='';
  if(!E.targetCorrToday) E.targetCorrToday={};
  const sorted=[...E.features].sort((a,b)=>E.mrmr[b].score-E.mrmr[a].score);
  const maxW=sorted.reduce((m,f)=>Math.max(m,E.weights[f]||0),0)||1;
  const NSE_FEATS=new Set(['delivery_pct','price_band_pct']);
  const CALC_FEATS=new Set(['range_pos','pct_from_52w_high','pct_to_upper_band','peak_retention','sector_breadth','sector_rel_strength','industry_breadth']);
  const getFeatureSource=f=>{
    if(NSE_FEATS.has(f)) return 'NSE';
    if(CALC_FEATS.has(f)) return 'Calc';
    return 'TV';
  };
  const rs = {
  };
  const scoreCorrSource = E.hasRecommendationEvidence
    ?'Prior-day feature deltas are scoring candidates for the current top-10% 1D mover set'
    :'First upload baseline saved; recommendations start after the next valid snapshot';
  const sessLabel = `${E.accSessions||0} learned horizons · ${E.laggedNote||'waiting for the next snapshot'}`;
  const breadthPct=E.marketBreadth!=null?(E.marketBreadth*100).toFixed(0):'?';
  const recFeedback=E.recommendationFeedback;
  const entryFeedback=E.executedEntryFeedback;
  const overlay=E.outcomeScoreOverlay||{};
  const feedbackText=`Shortlist outcomes: ${recFeedback?.samples||0}; executed-entry outcomes: ${entryFeedback?.samples||0}. Raw mRMR relevance learns which prior-day-to-current dynamic deltas distinguish the current top 10% by 1D move. Completed recommendation and entry outcomes remain confidence context only and continue refining targets, sizing, and review timing.`;
  const breadthCardHTML=`<div class="breadth-bar">
    <div class="breadth-badge" style="color:var(--cyan)">${breadthPct}% Breadth</div>
    <div class="breadth-meta">
      <div style="color:var(--t1);font-weight:600">${scoreCorrSource}</div>
      <div>Breadth: ${E.marketBreadth!=null?(E.marketBreadth*100).toFixed(0)+'%':'?'} · ${sessLabel}</div>
    </div>
    <div class="breadth-sessions">
      <span>🐂 ${rs.bull||0}</span>
      <span>🐻 ${rs.bear||0}</span>
      <span>➡ ${rs.neutral||0}</span>
    </div>
  </div>`;
  const mc=document.getElementById('methContent');
  if(!mc) return;

  mc.innerHTML=''; // clear before rebuild

  let wtHTML=`<table class="ct"><thead><tr><th>Feature</th><th>Src</th><th>Accumulated Rocket r</th><th>Latest Rocket r</th><th>Direction</th><th>Rank Redundancy</th><th>mRMR Score</th><th class="bar-cell">Weight</th><th>Wt%</th></tr></thead><tbody>`;
  for(const f of sorted){
    const tc=E.targetCorr[f],m=E.mrmr[f],w=E.weights[f];
    const dir=tc>=0?'<span style="color:var(--green)">↑</span>':'<span style="color:var(--red)">↓</span>';
    const bw=Math.round((w||0)/maxW*100),bc=(tc||0)>=0?'var(--green)':'var(--red)';
    const srcType=getFeatureSource(f);
    const src=srcType==='NSE'?'<span style="color:var(--cyan);font-size:9px;font-weight:700">NSE</span>':srcType==='Calc'?'<span style="color:var(--purple);font-size:9px;font-weight:700">Calc</span>':'<span style="color:var(--t3);font-size:9px">TV</span>';
    const todayR=E.targetCorrToday?.[f];
    const todayCell=todayR!=null&&!isNaN(todayR)?`<span style="color:${todayR>=0?'var(--green)':'var(--red)'};font-size:10px">${(todayR??0).toFixed(3)}</span>`:'—';
    const _n=v=>isFinite(v)?v:0;
    const tcS=tc!=null&&isFinite(tc)?tc.toFixed(3):'—'; const redS=m&&m.red!=null&&isFinite(m.red)?m.red.toFixed(3):'—'; const scS=m&&m.score!=null&&isFinite(m.score)?m.score.toFixed(4):'—'; const wS=w!=null&&isFinite(w)?(w*100).toFixed(1):'—';
    wtHTML+=`<tr>
      <td style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:600;color:var(--t1)">${E.labels[f]||f}</td><td>${src}</td><td style="color:${(tc||0)>=0?'var(--green)':'var(--red)'};font-weight:600">${tcS}</td><td>${todayCell}</td><td>${dir}</td><td>${redS}</td><td style="font-weight:700">${scS}</td><td class="bar-cell"><span class="cb" style="width:${bw}%;background:${bc};opacity:.5"></span></td><td style="font-weight:800">${wS}%</td>
    </tr>`;
  }
  wtHTML+='</tbody></table>';
  // Section counts for display
  const _featureCount=sorted.length;

  const hardFiltersHTML=buildHardFilterMethodologyHTML(E);
  mc.innerHTML=`
    <nav style="position:sticky;top:var(--hdr-h,72px);z-index:50;background:var(--bg);padding:8px 0 10px;margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--border);box-shadow:0 2px 8px rgba(0,0,0,0.3);overflow-x:auto;-webkit-overflow-scrolling:touch">
      <a href="#meth-filters" onclick="event.preventDefault();scrollToSection('meth-filters')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:11px;font-weight:600;text-decoration:none;cursor:pointer">🛡 Hard Filters</a>
      <a href="#meth-surv-corr" onclick="event.preventDefault();scrollToSection('meth-surv-corr')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:11px;font-weight:600;text-decoration:none;cursor:pointer">📊 Surv P&L</a>
      <a href="#meth-breadth" onclick="event.preventDefault();scrollToSection('meth-breadth')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:11px;font-weight:600;text-decoration:none;cursor:pointer">Breadth</a>
      <a href="#meth-engine" onclick="event.preventDefault();scrollToSection('meth-engine')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:11px;font-weight:600;text-decoration:none;cursor:pointer">⚙ Engine</a>
      <a href="#meth-weights" onclick="event.preventDefault();scrollToSection('meth-weights')" style="padding:4px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--t2);font-size:11px;font-weight:600;text-decoration:none;cursor:pointer">📊 Weights (${_featureCount})</a>
    </nav>
    <div id="meth-hf-wrap">${hardFiltersHTML}</div>
    <div id="meth-breadth">${breadthCardHTML}</div>
    <h3 id="meth-engine" style="margin-top:18px">Scoring Engine — Prior-Day Primary mRMR</h3>
    <p id="mrmrLearningModeNote"><strong>Current learning mode:</strong> The current top 10% of live-eligible stocks by 1D change are the target. A first-ever upload scores from ALL NSE’s intrinsic daily/intraday delta fields already present in the file. From the next valid session onward, every retained numeric/rating feature uses its immediately previous-trading-day delta. Same-day snapshots provide secondary accumulated context only and never create or rescue a skipped-day score.</p>
    <div class="m-grid">
      <div class="m-card"><h4>Learning Target</h4><p>The current top 10% by 1D change receive label 1. The first upload uses existing intrinsic daily/intraday deltas in ALL NSE to establish a scored baseline. Thereafter every retained numeric and converted-rating feature enters mRMR as a current-minus-immediately-prior-trading-day delta. A skipped normal trading day still keeps the scanner in WARMUP.</p></div>
      <div class="m-card"><h4>📡 How the Engine Learns</h4><p>Each current upload compares today’s 1D top-10% target with dynamic deltas versus the immediately previous trading-day snapshot. That direct comparison has 70% of fresh evidence; accumulated same-day snapshots have 30%. Final correlation then uses 70% fresh evidence and 30% historical memory.</p></div>
      <div class="m-card"><h4>Outcome Self-Correction</h4><p>${feedbackText} Outcome evidence is displayed as confidence context only. It does not add or subtract points from Rocket Score.</p></div>
      <div class="m-card"><h4>Feature Self-Correction</h4><p>Features that repeatedly separate future rockets from non-rockets strengthen; one-off relationships fade as more transitions arrive. mRMR uses average absolute Pearson correlation across all feature peers so redundant indicators cannot cast duplicate votes.</p></div>
      <div class="m-card"><h4>🎯 Max 1D Filter</h4><p>Set <em>Max 1D %</em> in the filter bar to hide stocks that have already moved too much today (default 5%). Entry-ceiling filtering has been removed; strong candidates are no longer hidden just because current price is above a calculated buy ceiling.</p></div>
      <div class="m-card"><h4>🚫 Recommendation Filters</h4><p>The learning universe keeps every valid parsed NSE symbol. Recommendation eligibility separately excludes zero-price rows, stocks at/near their NSE price band, non-EQ series, surveillance-flagged stocks, insufficient liquidity, and invalid ATR. Delivery, peak retention, RVOL, DMI, MFI, RSI, and sell pressure are <strong>features, not hard filters</strong>. Currently filtered from recommendations: ${(REMOVED.uc||0)+(REMOVED.surv||0)+(REMOVED.nonEq||0)+(REMOVED.liq||0)+(REMOVED.fscore||0)+(REMOVED.atr||0)} stocks.</p></div>
      <div class="m-card"><h4>Regime-Agnostic Learning</h4><p>Market breadth is shown as context only. The scanner uses one recency-adjusted top-rocket correlation accumulator across all market conditions, so bull, neutral, and bear days do not create separate scoring histories.</p></div>
      <div class="m-card"><h4>📊 Sector & Industry Breadth</h4><p>${E.sectorCol?'<span style="color:var(--green)">✓</span> Sector breadth, sector relative strength':'<span style="color:var(--red)">✗</span> No Sector column detected'}${E.industryCol?', <span style="color:var(--green)">✓</span> industry breadth':''} — computed from today\'s full universe and fed into mRMR as features. Stocks outperforming their sector score higher regardless of market direction.</p></div>
    </div>

    <p style="color:var(--t3);font-style:italic;margin-top:4px">⚠ Quantitative screening only. Not financial advice. Past momentum ≠ future returns.</p>

    <h3 id="meth-weights" style="margin-top:28px">Feature Weights <span style="font-size:12px;color:var(--t3);font-weight:400">(${_featureCount})</span></h3>
    <div class="corr-wrap">${wtHTML}</div>`;
  setTimeout(()=>{_methTbls.hf?.render();_methTbls.sc?.render();},0);
}

// Fixed columns + dynamic top 10 mRMR features (skip empty ones)
function getCols(){
  const intervalMinutes=ENGINE_DATA?.snapshotDisplayElapsedMinutes;
  const intervalLabel=intervalMinutes!=null?`Chg ${intervalMinutes}m%`:'Snap Chg%';
  const fixed=[
    {key:'chk',label:'',s:0},
    {key:'rocketScore',label:'Score',s:1},{key:'symbol',label:'Symbol',s:1},
    {key:'price',label:'Price ₹',s:1},{key:'snapshotChange',label:intervalLabel,s:1},
    {key:'priceChange',label:'Chg 1D%',s:1},{key:'delivPct',label:'Deliv%',s:1},
    {key:'alloc',label:'Alloc ₹',s:0},{key:'volume',label:'Volume',s:1},
  ];
  // Dynamic columns from mRMR features — skip any that are all null across displayed stocks
  const allFeats=ENGINE_DATA?.top10Feats||[];
  const labels=ENGINE_DATA?.labels||{};
  const pool=FILT.length?FILT:ALL;
  // Features already shown as fixed columns — skip from dynamic to avoid duplicates
  const fixedFeatKeys=new Set(['delivery_pct','price','volume','volume_1_day']);
  if(ENGINE_DATA?.features){
    const pcPat=/price_change.*1_day|1_day.*price_change|^change.*1_day$/;
    ENGINE_DATA.features.forEach(f=>{if(pcPat.test(f))fixedFeatKeys.add(f);});
  }
  const dynamic=[];
  for(const f of allFeats){
    if(dynamic.length>=10) break;
    if(fixedFeatKeys.has(f)) continue;
    // Check if at least one stock has a non-null value for this feature
    const hasData=pool.some(s=>s._features&&s._features[f]!=null);
    if(!hasData) continue;
    dynamic.push({key:'_feat_'+f,featKey:f,label:labels[f]||f,s:1,isDynamic:true});
  }
  // If we didn't get 10 from top10, try further features
  if(dynamic.length<10&&ENGINE_DATA?.features){
    const weights=ENGINE_DATA.weights||{};
    const remaining=[...ENGINE_DATA.features]
      .filter(f=>!allFeats.includes(f)&&!fixedFeatKeys.has(f))
      .sort((a,b)=>(weights[b]||0)-(weights[a]||0));
    for(const f of remaining){
      if(dynamic.length>=10) break;
      const hasData=pool.some(s=>s._features&&s._features[f]!=null);
      if(!hasData) continue;
      dynamic.push({key:'_feat_'+f,featKey:f,label:labels[f]||f,s:1,isDynamic:true});
    }
  }
  return [...fixed,...dynamic];
}
let COLS=getCols(); // initialize, updated on each engine run

function updateSelectAll(){
  const allSyms=FILT.map(s=>s.symbol);
  const allChecked=allSyms.length>0&&allSyms.every(sym=>SELECTED.has(sym));
  const sa=document.getElementById('chk-all');
  if(sa){sa.indeterminate=!allChecked&&SELECTED.size>0&&allSyms.some(sym=>SELECTED.has(sym));sa.checked=allChecked;}
  renderBasketBtn();
}
function toggleSelectAll(checked){
  if(checked)FILT.forEach(s=>SELECTED.add(s.symbol));
  else FILT.forEach(s=>SELECTED.delete(s.symbol));
  renderTable();
  renderBasketBtn();
}
function toggleStock(sym,checked){
  if(checked)SELECTED.add(sym);else SELECTED.delete(sym);
  updateSelectAll();
  recomputeAlloc();
}

// ── Score-weighted allocation across selected stocks ──
function getBuyPrice(s){
  const ltp=s.price>0?s.price:0;
  const vwap=s.vwap;
  const atrMargin=(s.atr!=null&&ltp>0)?(ltp*s.atr*0.25/100):0;
  const candidate=vwap>0?Math.min(vwap+atrMargin,ltp):ltp;
  return parseFloat(tickPrice(candidate).toFixed(2));
}
function getRunwayCeilingPct(s){
  return (s&&s.price_band_pct!=null&&isFinite(s.price_band_pct)&&s.price_band_pct>0)?s.price_band_pct:STOCK_RUNWAY_CEILING_PCT;
}
function getMaxEntry(s){
  const ceiling=getRunwayCeilingPct(s);
  if(!isFinite(ceiling)) return null;
  const pc=s.priceChange;
  if(s.price==null||s.price<=0||pc==null||!isFinite(pc)) return null;
  const tgt=getEffectiveTgtPct()||3.7;
  const openPrice=s.price/(1+pc/100);
  return tickPrice(openPrice*(1+ceiling/100)/(1+tgt/100));
}
function getFilterBarReason(s){
  const minScore=parseFloat(document.getElementById('fMinScore')?.value)||0;
  const fvol=parseFloat(document.getElementById('fVol')?.value)||0;
  const fMinMarketCap=parseFloat(document.getElementById('fMinMarketCap')?.value)||0;
  const _fMin1Dv=document.getElementById('fMin1D')?.value||'';
  const fMin1D=_fMin1Dv!==''?parseFloat(_fMin1Dv):-Infinity;
  const _fMax1Dv=document.getElementById('fMax1D')?.value||'';
  const fMax1D=_fMax1Dv!==''?parseFloat(_fMax1Dv):Infinity;
  const fPriceMin=parseFloat(document.getElementById('fPriceMin')?.value)||0;
  const fPriceMax=parseFloat(document.getElementById('fPriceMax')?.value)||0;
  const bandReason=getPriceBandBlockReason(s);
  if(bandReason) return bandReason;
  if(minScore>0&&s.rocketScore<minScore) return `Score ${s.rocketScore?.toFixed?.(1)||s.rocketScore} < ${minScore}`;
  if(fvol>0&&s.volume!=null&&s.volume<fvol) return `Volume ${Math.round(s.volume).toLocaleString('en-IN')} < ${Math.round(fvol).toLocaleString('en-IN')}`;
  if(fMinMarketCap>0&&s.marketCap!=null&&s.marketCap<fMinMarketCap) return `MCap ₹${fV(s.marketCap)} < ₹${fV(fMinMarketCap)}`;
  if(fMin1D>-Infinity&&s.priceChange!=null&&s.priceChange<fMin1D) return `1D ${s.priceChange.toFixed(2)}% < ${fMin1D}%`;
  if(fMax1D<Infinity&&s.priceChange!=null&&s.priceChange>fMax1D) return `1D ${s.priceChange.toFixed(2)}% > ${fMax1D}%`;
  if(fPriceMin>0&&s.price!=null&&s.price<fPriceMin) return `Price ${fmtINR(s.price)} < ${fmtINR(fPriceMin)}`;
  if(fPriceMax>0&&s.price!=null&&s.price>fPriceMax) return `Price ${fmtINR(s.price)} > ${fmtINR(fPriceMax)}`;
  return '';
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
function applyHeldDisplayState(s,heldPos,dropPct){
  const pos=heldPos[s.symbol];
  if(!pos) return '';
  const {qty,avg}=pos;
  const cur=s.price;
  if(qty<=0) return 'Held/closed or short today';
  if(!avg||cur==null||cur<=0) return 'Held, avg cost unavailable';
  const dropFromAvg=((avg-cur)/avg)*100;
  if(dropFromAvg>=dropPct){
    s._isTopUp=true; s._heldAvg=avg; s._heldQty=qty; s._topUpDrop=+dropFromAvg.toFixed(2);
    return '';
  }
  return `Held: only ${dropFromAvg.toFixed(2)}% below avg, needs ${dropPct}%`;
}
function toggleFilteredCandidates(){
  SHOW_FILTERED_CANDIDATES=!SHOW_FILTERED_CANDIDATES;
  applyFilters();
}
function keepFilteredCandidate(sym){
  KEEP_FILTER_OVERRIDES.add(sym);
  applyFilters();
}
function removeFilterOverride(sym){
  KEEP_FILTER_OVERRIDES.delete(sym);
  applyFilters();
}
// ── Effective learnt TGT% (gross sell-price delta from buy) ──
// Tradebook TGT is the base; missed opportunity nudge is added when available.
// Fallback when no tradebook = median of per-stock tgtPct in current FILT (ATR-derived).
function getMissedOppNudge(){
  try{return getSameDayExitOpportunitySummary().nudge||0;}
  catch(e){return 0;}
}

function getOutcomeTargetPolicy(){
  const realised=TRADEBOOK_STATS?.adaptiveTGT;
  if(!(realised>0)) return null;
  const recPicks=Object.values((FS.get(RECOMMEND_OUTCOME_STORE)||{}).issues||{})
    .flatMap(issue=>(issue.picks||[]).filter(p=>p.complete&&p.observations>0));
  const entryRows=Object.values((FS.get(ENTRY_OUTCOME_STORE)||{}).entries||{})
    .filter(e=>e.complete&&e.observations>0);
  const recPositive=recPicks.map(p=>p.bestHighProfitPct).filter(v=>v!=null&&isFinite(v)&&v>0);
  const entryPositive=entryRows.map(e=>e.bestNetHighPct).filter(v=>v!=null&&isFinite(v)&&v>0);
  const evidenceCount=recPicks.length+entryRows.length;
  const positiveCount=recPositive.length+entryPositive.length;
  if(evidenceCount<OUTCOME_FEEDBACK_MIN_SAMPLES||!positiveCount){
    return {baseTgt:realised,runnerTgt:roundPct05(realised*1.5),confidence:0,evidenceCount,positiveCount};
  }
  const weightedEvidence=(entryValue,recValue)=>{
    const parts=[];
    if(entryValue!=null&&entryPositive.length) parts.push({v:entryValue,w:entryPositive.length});
    if(recValue!=null&&recPositive.length) parts.push({v:recValue,w:recPositive.length});
    const weight=parts.reduce((sum,p)=>sum+p.w,0);
    return weight?parts.reduce((sum,p)=>sum+p.v*p.w,0)/weight:null;
  };
  const reachable=weightedEvidence(percentileValue(entryPositive,0.35),percentileValue(recPositive,0.35));
  const upper=weightedEvidence(percentileValue(entryPositive,0.75),percentileValue(recPositive,0.75));
  const successRate=positiveCount/evidenceCount;
  const confidence=Math.min(0.65,evidenceCount/(evidenceCount+30))*successRate;
  const baseOpportunity=Math.max(realised,reachable||realised);
  const baseTgt=roundPct05(realised+((baseOpportunity-realised)*confidence));
  const runnerFallback=baseTgt*1.5;
  const runnerFloor=baseTgt+Math.max(0.5,baseTgt*0.25);
  const runnerCeiling=baseTgt*1.75;
  const learnedRunner=upper||runnerFallback;
  const runnerTgt=roundPct05(clampNum(learnedRunner,runnerFloor,runnerCeiling));
  return {baseTgt,runnerTgt,confidence:+confidence.toFixed(3),evidenceCount,positiveCount,
    reachable:reachable==null?null:+reachable.toFixed(2),upper:upper==null?null:+upper.toFixed(2)};
}

function getEffectiveTgtPct(){
  const nudge=getMissedOppNudge();
  const policy=getOutcomeTargetPolicy();
  if(policy?.baseTgt>0) return roundPct05(policy.baseTgt+nudge);
  const vals = (typeof FILT !== 'undefined' ? FILT : []).map(s => s.tgtPct).filter(v => v != null && isFinite(v) && v > 0);
  if(!vals.length) return null;
  vals.sort((a,b)=>a-b);
  return roundPct05(vals[Math.floor(vals.length/2)]+nudge);
}

function getRunnerTgtPct(row=null,buyPrice=null,baseTarget=null){
  const nudge=getMissedOppNudge();
  const policy=getOutcomeTargetPolicy();
  const base=(baseTarget&&isFinite(baseTarget)&&baseTarget>0)?Number(baseTarget):getEffectiveTgtPct();
  let runner=policy?.runnerTgt>0?policy.runnerTgt+nudge:(base>0?base*1.5:null);
  if(!(runner>0)) return null;
  const atr=row?.atr!=null&&isFinite(row.atr)&&row.atr>0?Number(row.atr):null;
  const entry=(buyPrice&&isFinite(buyPrice)&&buyPrice>0)?Number(buyPrice):((row?.price&&isFinite(row.price)&&row.price>0)?Number(row.price):null);
  const dayHigh=(row?.high1d&&isFinite(row.high1d)&&row.high1d>0)?Number(row.high1d):null;
  const dayHighPct=(entry>0&&dayHigh>entry)?((dayHigh-entry)/entry*100):null;
  if(base>0){
    const minRunner=base+0.25;
    let floor=minRunner;
    let ceiling=Math.max(floor,base*1.8);
    if(atr>0){
      floor=Math.max(floor,base+(atr*0.5));
      ceiling=Math.min(ceiling,Math.max(floor,base+(atr*1.5)));
    }
    if(dayHighPct!=null){
      const reachable=Math.max(floor,dayHighPct);
      runner=Math.max(runner,Math.min(reachable,ceiling));
      ceiling=Math.min(ceiling,reachable);
    }
    runner=clampNum(runner,floor,ceiling);
  }
  const rounded=roundPct05(runner);
  return rounded>base?rounded:roundPct05(base+0.25);
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

function calcPositionTSL({sym, qty, avgCost, ltp, scannerRow, adaptiveSL, adaptiveTGT, prev}){
  if(!sym||!(qty>0)||!(avgCost>0)||!(ltp>0)||!(adaptiveSL>0)) return null;
  const dayHigh=scannerRow?.high1d;
  const peak=+Math.max(ltp, (dayHigh!=null&&isFinite(dayHigh))?dayHigh:0).toFixed(2);
  const peakProfitPct=+(((peak-avgCost)/avgCost)*100).toFixed(2);
  const protective=tickPrice(avgCost*(1-adaptiveSL/100));
  const target1=(adaptiveTGT&&isFinite(adaptiveTGT)&&adaptiveTGT>0)?adaptiveTGT:4.2;
  const target2=getRunnerTgtPct(scannerRow,avgCost,target1)||target1*1.5;
  const atrPct=(scannerRow?.atr!=null&&isFinite(scannerRow.atr)&&scannerRow.atr>0)?scannerRow.atr:null;
  const minStep=getZerodhaMinTrailPoints(avgCost);
  const avgChanged=prev?.avg!=null&&Math.abs(prev.avg-avgCost)/avgCost>0.01;
  const qtyIncreased=prev?.qty!=null&&qty>prev.qty;
  const reset=!!(avgChanged||qtyIncreased);

  // Proper Zerodha GTT TSL for the split-GTT system:
  // Zerodha's "Trailing points" field is the ratchet step, not the stop distance.
  // So the table shows the actual stop-loss trigger price separately from the step.
  // TSL trigger = LTP - gap points. Gap % = max(half of that leg's target %, Daily ATR%).
  const calcLeg=(targetPct, prevKey)=>{
    const floorPct=targetPct/2;
    const gapPct=Math.max(floorPct, atrPct||0);
    const gapPoints=tickPrice(Math.max(minStep, ltp*gapPct/100));
    const rawTsl=tickPrice(Math.max(0, ltp-gapPoints));
    const stepPoints=+minStep.toFixed(2);
    const tsl=rawTsl;
    return {
      targetPct:+targetPct.toFixed(2),
      floorPct:+floorPct.toFixed(2),
      gapPct:+gapPct.toFixed(2),
      trailPoints:stepPoints,
      trailStepPoints:stepPoints,
      gapPoints:+gapPoints.toFixed(2),
      rawTsl:+rawTsl.toFixed(2),
      tsl:+tsl.toFixed(2),
      lockPct:+(((tsl-avgCost)/avgCost)*100).toFixed(2),
      distancePoints:+Math.max(0,ltp-tsl).toFixed(2),
      rawDistancePoints:+Math.max(0,ltp-rawTsl).toFixed(2),
      basis:atrPct!=null&&atrPct>=floorPct?'ATR floor':'Half-target floor'
    };
  };

  const leg1=calcLeg(target1,'tsl1');
  const leg2=calcLeg(target2,'tsl2');
  return {
    // Legacy aliases point to the runner leg, because that is the one usually managed manually.
    tsl:leg2.tsl,
    rawTsl:leg2.rawTsl,
    trailPoints:leg2.trailPoints,
    trailStepPoints:leg2.trailPoints,
    minTrailPoints:minStep,
    distancePoints:leg2.distancePoints,
    rawDistancePoints:leg2.rawDistancePoints,
    gapPct:leg2.gapPct,
    lockPct:leg2.lockPct,
    basis:leg2.basis,
    tsl1:leg1.tsl,
    rawTsl1:leg1.rawTsl,
    trailPoints1:leg1.trailPoints,
    gapPct1:leg1.gapPct,
    lockPct1:leg1.lockPct,
    distancePoints1:leg1.distancePoints,
    targetPct1:leg1.targetPct,
    basis1:leg1.basis,
    tsl2:leg2.tsl,
    rawTsl2:leg2.rawTsl,
    trailPoints2:leg2.trailPoints,
    gapPct2:leg2.gapPct,
    lockPct2:leg2.lockPct,
    distancePoints2:leg2.distancePoints,
    targetPct2:leg2.targetPct,
    basis2:leg2.basis,
    peak,
    peakProfitPct,
    atrPct:atrPct!=null?+atrPct.toFixed(2):null,
    avg:+avgCost.toFixed(2),
    qty,
    reset,
    updated:getSessionDate()
  };
}

function computeAlloc(capital, selList){
  if(!capital||!selList.length) return {};
  const maxAllocEl=document.getElementById('fMaxAlloc');
  const maxAllocV=maxAllocEl?parseFloat(maxAllocEl.value)||0:0;
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
    const effTgt=getEffectiveTgtPct();
    const tgtPct=(effTgt!=null&&isFinite(effTgt))?effTgt:((s.tgtPct!=null&&isFinite(s.tgtPct))?s.tgtPct:null);
    if(tgtPct===null||tgtPct<=0) return {ok:true,skip:true};
    const sellP=buyP*(1+tgtPct/100);
    const buyChg=calcZerodhaCharges(buyP,qty,false);
    const sellChg=calcZerodhaCharges(sellP,qty,true);
    const charges=buyChg+sellChg;
    return {ok:true,expectedNet:qty*buyP*(tgtPct/100)-charges,charges,tgtPct};
  }

  const topupPctEl=document.getElementById('fTopupAlloc');
  const topupMult=Math.min(1,Math.max(0.1,((topupPctEl?parseFloat(topupPctEl.value)||50:50)/100)));
  const rawScore=s=>Math.max(0,Number(s.rocketScore)||0);
  const totalRawScore=selList.reduce((sum,s)=>sum+rawScore(s),0)||1;
  const sortedSel=[...selList].sort((a,b)=>rawScore(b)-rawScore(a));
  const allocMap={},limits={};

  // Top-up percentage is a hard TOTAL allocation cap, not a per-leg setting.
  // Both TGT1/TGT2 orders subsequently share this one quantity allocation.
  for(const s of sortedSel){
    const buyP=getBuyPrice(s);
    if(!(buyP>0)) continue;
    const normalBudget=Math.min(spendableCapital*(rawScore(s)/totalRawScore),cap);
    const rowLimit=s._isTopUp?normalBudget*topupMult:normalBudget;
    limits[s.symbol]=rowLimit;
    const qty=affordableQty(rowLimit,buyP,rowLimit);
    if(qty<=0) continue;
    const ev=evalNet(s,buyP,qty);
    allocMap[s.symbol]={alloc:qty*buyP,debit:buyDebit(buyP,qty),buyCharges:calcZerodhaCharges(buyP,qty,false,false,false),qty,buyPrice:buyP,
      limit:rowLimit,expectedNet:ev.expectedNet,charges:ev.charges,tgtPct:ev.tgtPct};
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
          limit:rowLimit,expectedNet:ev.expectedNet,charges:ev.charges,tgtPct:ev.tgtPct};
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
  const adaptiveSL=TRADEBOOK_STATS?.adaptiveSL||Math.abs(perfStats?.avgLossPct||0)||3;
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
  const holdCount=(HOLDINGS&&HOLDINGS.length>0)||(POSITIONS&&POSITIONS.length>0)?1:0;
  const buyBtn=document.getElementById('basketBtn');
  if(buyBtn){
    const cntSpan=document.getElementById('basketCount');
    if(cntSpan)cntSpan.textContent=buyCount>0?`(${buyCount})`:'';
    buyBtn.disabled=buyCount===0;
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
      return`<th style="width:32px;text-align:center;padding:8px 6px">
        <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
          <input type="checkbox" id="chk-all" ${allChecked?'checked':''} title="Select / deselect all"
            style="width:14px;height:14px;accent-color:var(--amber);cursor:pointer"
            onchange="toggleSelectAll(this.checked)">
          <span style="font-size:8px;color:var(--t3);letter-spacing:.3px;font-weight:700;text-transform:uppercase">ALL</span>
        </div>
      </th>`;
    }
    const arr=c.key===SCOL?(SDIR===-1?'▼':'▲'):'';
    const sortKey=c.isDynamic?c.key:c.key;
    const shortLabel=c.isDynamic?(c.label.length>25?c.label.substring(0,25)+'…':c.label):c.label;
    const tooltip=c.isDynamic?c.label:'';
    return`<th class="${c.key===SCOL?'sorted':''}" ${c.s?`onclick="doSort('${sortKey}')"`:''} ${tooltip?`title="${tooltip}"`:''} ${c.isDynamic?'style="font-size:10px;max-width:90px;white-space:normal;word-wrap:break-word;line-height:1.2"':''}>${shortLabel}<span class="sa">${arr}</span></th>`;
  }).join('')+'</tr>';
  // fix indeterminate state
  const sa=document.getElementById('chk-all');
  if(sa&&!allChecked&&someChecked)sa.indeterminate=true;
}

function fmt(v,d=2){return v===null||v===undefined||isNaN(v)?'—':Number(v).toFixed(d);}
const INR_2={minimumFractionDigits:2,maximumFractionDigits:2};
function fmtINR(v){return v===null||v===undefined||isNaN(v)?'—':'₹'+Number(v).toLocaleString('en-IN',INR_2);}
function fmtSignedINR(v){return v===null||v===undefined||isNaN(v)?'—':(v>=0?'+':'−')+'₹'+Math.abs(Number(v)).toLocaleString('en-IN',INR_2);}
function fmtNegINR(v){return v>0?'−₹'+Number(v).toLocaleString('en-IN',INR_2):'—';}
function fV(v){if(v===null||isNaN(v))return'—';if(v>=1e7)return(v/1e7).toFixed(2)+'Cr';if(v>=1e5)return(v/1e5).toFixed(2)+'L';if(v>=1e3)return(v/1e3).toFixed(2)+'K';return Number(v).toLocaleString('en-IN',INR_2);}
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

function renderTable(){
  const capital=parseFloat(document.getElementById('fCapital').value)||0;
  // Allocation only across SELECTED instruments
  const selList=FILT.filter(s=>SELECTED.has(s.symbol));
  const allocMap=computeAlloc(capital, selList);
  const unitLabel='shares';

  const start=(PG-1)*PGSZ,pg=FILT.slice(start,start+PGSZ);

  document.getElementById('tBody').innerHTML=pg.map((s,i)=>{
    const rk=start+i+1;
    const isSelected=SELECTED.has(s.symbol);
    const am=allocMap[s.symbol];


    // Fixed cells
    const filterBadge=s._forceKept
      ? `<span style="font-size:8px;background:rgba(34,197,94,.14);color:var(--green);border-radius:4px;padding:1px 5px;margin-left:5px;font-weight:700;vertical-align:middle" title="Kept this session despite filter: ${escHtml(s._filterReason||'override')}">KEPT</span>`
      : s._filterPreview
        ? `<span style="font-size:8px;background:rgba(251,191,36,.14);color:var(--amber);border-radius:4px;padding:1px 5px;margin-left:5px;font-weight:700;vertical-align:middle" title="${escHtml(s._filterReason||'filtered')}">FILTERED</span>`
        : '';
    const filterAction=s._filterPreview
      ? `<button onclick="keepFilteredCandidate('${s.symbol}')" title="Keep this stock in Rankings for this page session only" style="margin-left:6px;padding:2px 6px;border-radius:5px;border:1px solid rgba(34,197,94,.35);background:rgba(34,197,94,.1);color:var(--green);font-size:9px;font-weight:800;cursor:pointer">Keep</button>`
      : s._forceKept
        ? `<button onclick="removeFilterOverride('${s.symbol}')" title="Remove this filter override" style="margin-left:6px;padding:2px 6px;border-radius:5px;border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.08);color:var(--red);font-size:9px;font-weight:800;cursor:pointer">Unkeep</button>`
        : '';

    let cells=`
      <td style="text-align:center"><input type="checkbox" ${isSelected?'checked':''} ${s._filterPreview?'disabled':''} style="width:14px;height:14px;accent-color:var(--amber);cursor:${s._filterPreview?'not-allowed':'pointer'}" onchange="toggleStock('${s.symbol}',this.checked)"></td>
      <td><span class="sc-m">${isNaN(s.rocketScore)?'?':s.rocketScore.toFixed(1)}</span></td>
      <td style="font-family:'Plus Jakarta Sans',sans-serif"><div style="font-weight:700;font-size:13px;color:var(--t1)">${s.symbol}${(()=>{const sv=s.seen||0;if(!sv) return '';return`<sub style="font-size:11px;color:var(--amber);font-weight:700;margin-left:3px;font-family:'DM Mono',monospace" title="Seen ${sv}× today">${sv}×</sub>`;})()}${filterBadge}${filterAction}${s._isTopUp?`<span style="font-size:8px;background:rgba(251,146,60,.15);color:var(--fire);border-radius:4px;padding:1px 5px;margin-left:5px;font-weight:700;vertical-align:middle">↑ TOP-UP</span>`:''}${(()=>{const c=Number(s.outcomeReliability||0),n=Number(s.outcomeEvidence||0);if(!(c>0)||!(n>0)) return '';const pct=Math.round(c*100);return `<span style="font-size:8px;background:rgba(167,139,250,.14);color:var(--purple);border-radius:4px;padding:1px 5px;margin-left:5px;font-weight:700;vertical-align:middle" title="Outcome-pattern confidence only. It does not change Rocket Score or rank. ${n} historical matches.">◉ ${pct}% CONF</span>`;})()}${(()=>{if(!s.isSurv) return '';const labels=(s.survRules||[]).map(k=>{const r=SURV_CUSTOM_RULES.find(x=>x.key===k);return r?r.label:k;}).join(' · ');return `<span style="font-size:8px;background:rgba(239,68,68,.15);color:var(--red);border-radius:4px;padding:1px 5px;margin-left:5px;font-weight:700;vertical-align:middle" title="NSE Surveillance: ${escHtml(labels)}">⚠ SURV</span>`;})()}</div><div style="font-size:9px;color:${s._filterPreview?'var(--amber)':'var(--t3)'};max-width:220px;overflow:hidden;text-overflow:ellipsis">${s._filterPreview||s._forceKept?escHtml(s._filterReason||'filtered'):(s.name+(s._isTopUp&&s._heldAvg?` · avg ${fmtINR(s._heldAvg)}`:''))}</div></td>
      <td>${fmtINR(s.price)}</td>
      <td>${fPerf(s.snapshotChange)}</td>
      <td>${fPerf(s.priceChange)}</td>
      <td>${fDel(s.delivPct)}</td>
      <td class="alloc-cell" data-sym="${s.symbol}">${(()=>{
        if(!am) return '<span style="color:var(--t3);font-size:11px">—</span>';
        return `<span style="color:var(--amber);font-weight:700;font-family:'DM Mono',monospace;font-size:12px">${fmtINR(am.alloc)}</span><div style="font-size:9px;color:var(--t3);margin-top:1px">${am.qty} ${unitLabel}</div>`;
      })()}</td>
      <td>${fV(s.volume)}</td>`;

    // Dynamic mRMR feature cells — from COLS (already filtered for non-empty)
    for(const c of COLS){
      if(!c.isDynamic) continue;
      const v=s._features?s._features[c.featKey]:null;
      if(v===null||v===undefined) cells+='<td style="color:var(--t3);font-size:11px">—</td>';
      else if(typeof v==='number'){
        const c=v>0?'var(--green)':v<0?'var(--red)':'var(--t2)';
        cells+=`<td style="color:${c};font-weight:600;font-size:11px">${v>=1000?fV(v):v.toFixed(v>=100?0:v>=10?1:2)}</td>`;
      } else cells+=`<td style="font-size:10px;color:var(--t2)">${v}</td>`;
    }
    let _trStyle=s._filterPreview?'background:rgba(251,191,36,.035);outline:1px dashed rgba(251,191,36,.22);outline-offset:-1px':(s._forceKept?'background:rgba(34,197,94,.035);outline:1px solid rgba(34,197,94,.18);outline-offset:-1px':(s._isTopUp?'background:rgba(251,146,60,.05);outline:1px solid rgba(251,146,60,.18);outline-offset:-1px':''));
    if(isSelected&&!s._forceKept&&!s._filterPreview) _trStyle='background:rgba(251,191,36,.04);outline:1px solid rgba(251,191,36,.12);outline-offset:-1px';
    return`<tr style="${_trStyle}">${cells}</tr>`;
  }).join('');
  renderPgn();
  updateSelectAll();
}

function renderPgn(){
  const tot=FILT.length,tp=Math.ceil(tot/PGSZ),c=document.getElementById('pgn');
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
function doSort(col){if(SCOL===col)SDIR*=-1;else{SCOL=col;SDIR=-1;}applySort();PG=1;renderHead();renderTable();saveFilterState();}
function applySort(){
  const col=SCOL;
  FILT.sort((a,b)=>{
    let va,vb;
    if(col.startsWith('_feat_')){
      const fk=col.substring(6);
      va=a._features?a._features[fk]:null;
      vb=b._features?b._features[fk]:null;
    } else {
      va=a[col];vb=b[col];
    }
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
  ALL.forEach(x=>{delete x._filterReason;delete x._filterPreview;delete x._forceKept;delete x._isTopUp;delete x._heldAvg;delete x._heldQty;delete x._topUpDrop;});
  const hiddenReasons={};
  const visible=[];
  ALL.forEach(x=>{
    const reason=getFilterBarReason(x);
    if(reason) hiddenReasons[x.symbol]=reason;
    else visible.push(x);
  });
  FILT=visible;

  // ── Already-held suppression ──
  // If a stock is in current POSITIONS (long, qty>0), hide it from recommendations
  // UNLESS its current price has dropped at least Re-entry Drop % below avg buy price.
  // Rationale: averaging down at a meaningfully lower price improves blended cost;
  // re-buying at or above entry just doubles risk without improving the position.
  SUPPRESSED_HELD=0;
  {
    const reDrop=parseFloat(document.getElementById('fReDrop')?.value);
    const dropPct=isFinite(reDrop)&&reDrop>=0?reDrop:1;
    const heldPos=getHeldPositionMap();
    if(Object.keys(heldPos).length){
      FILT=FILT.filter(x=>{
        const reason=applyHeldDisplayState(x,heldPos,dropPct);
        if(!reason) return true;
        hiddenReasons[x.symbol]=reason;
        SUPPRESSED_HELD++;
        return false;
      });
    }
  }

  applySort();

  // Hard cap at 20 (Zerodha basket limit).
  if(FILT.length>20){
    const capped=FILT.slice(0,20);
    FILT.slice(20).forEach(x=>{hiddenReasons[x.symbol]='Outside current top-20 display cap';});
    FILT=capped;
  }

  const currentSyms=new Set(FILT.map(s=>s.symbol));
  const overrideRows=[];
  KEEP_FILTER_OVERRIDES.forEach(sym=>{
    const s=ALL.find(x=>x.symbol===sym);
    if(!s||currentSyms.has(sym)) return;
    s._forceKept=true;
    s._filterReason=hiddenReasons[sym]||getFilterBarReason(s)||'Display filter override';
    overrideRows.push(s);
    currentSyms.add(sym);
  });
  const previewRows=[];
  if(SHOW_FILTERED_CANDIDATES){
    ALL.filter(s=>!currentSyms.has(s.symbol)&&hiddenReasons[s.symbol])
      .sort((a,b)=>(b.rocketScore||0)-(a.rocketScore||0))
      .slice(0,20)
      .forEach(s=>{s._filterPreview=true;s._filterReason=hiddenReasons[s.symbol];previewRows.push(s);});
  }
  FILT=[...overrideRows,...FILT,...previewRows];
  applySort();

  // SELECTED is auto-derived from FILT every filter pass. Checkboxes are a
  // post-filter convenience for tweaking the export — not persisted state.
  SELECTED=new Set(FILT.filter(s=>!s._filterPreview).map(s=>s.symbol));

  PG=1;renderHead();renderTable();renderStatusBar();saveFilterState();updateTabCounts();
  if(ALL.length) try{renderStats();}catch(e){}
}


function renderStatusBar(){
  const total=ALL.length,shown=FILT.length;
  const tags=[];
  const minScore2=parseFloat(document.getElementById('fMinScore')?.value)||0;
  const fscore=4;
  const fvol2=parseFloat(document.getElementById('fVol')?.value)||0;
  const fMinMarketCap2=parseFloat(document.getElementById('fMinMarketCap')?.value)||0;
  const _fMin1Dv2=document.getElementById('fMin1D')?.value||'';
  const fMin1D=_fMin1Dv2!==''?parseFloat(_fMin1Dv2):-Infinity;
  if(minScore2>0)tags.push('Score≥'+minScore2);
  if(fscore>0)tags.push('F≥'+fscore);
  if(fMin1D>-Infinity)tags.push('1D≥'+fMin1D+'%');
  if(fvol2>0){const n=fvol2;tags.push('Vol≥'+(n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(0)+'K':n));}
  if(fMinMarketCap2>0)tags.push('MCap≥₹'+fV(fMinMarketCap2));
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
    // Expected net at learnt TGT% — feedback, not input
    const tgtPct=getEffectiveTgtPct();
    if(tgtPct>0){
      let totalNet=0;
      for(const sym in am2){
        const a=am2[sym];
        if(a.rejected) continue;
        if(a.expectedNet!=null && isFinite(a.expectedNet)){
          totalNet+=a.expectedNet;
        }
      }
      const tgtSrc=TRADEBOOK_STATS&&TRADEBOOK_STATS.adaptiveTGT?'tradebook + outcome learning':'ATR fallback + missed opp';
      const tip=`Sum of (qty × buy × ${tgtPct.toFixed(2)}% − estimated round-trip costs) across selected ${instrumentLabel}. Source: ${tgtSrc}.`;
      const color=totalNet>=0?'var(--green)':'var(--red)';
      html+=` <span style="color:${color};font-size:11px;font-family:'DM Mono',monospace;font-weight:700;margin-left:8px" title="${tip}">· 🎯 ${fmtINR(totalNet)} net @ ${tgtPct.toFixed(1)}%</span>`;
    }
  } else if(capital>0){
    html+=` <span style="color:var(--t3);font-size:11px;margin-left:8px">· select ${instrumentLabel} to allocate ${fmtINR(capital)}</span>`;
  }
  if(tags.length){html+=`<span class="sb-sep">|</span>`;html+=tags.map(t=>`<span class="sb-tag">${t}</span>`).join('');}
  const previewCt=FILT.filter(s=>s._filterPreview).length;
  const keptCt=FILT.filter(s=>s._forceKept).length;
  html+=`<button class="sb-clear" onclick="toggleFilteredCandidates()" title="Review high-score engine candidates hidden by display filters" style="border-color:${SHOW_FILTERED_CANDIDATES?'rgba(251,191,36,.45)':'var(--border)'};color:${SHOW_FILTERED_CANDIDATES?'var(--amber)':'var(--t2)'}">${SHOW_FILTERED_CANDIDATES?'Hide':'Show'} filtered${previewCt?` (${previewCt})`:''}</button>`;
  if(keptCt) html+=`<span class="sb-tag" title="Session-only. Clears on refresh, upload, or page reload.">${keptCt} kept this session</span>`;
  if(isFiltered)html+=`<button class="sb-clear" onclick="clearFilters()">✕ Clear filters</button>`;
  const el=document.getElementById('statusBar');
  if(el)el.innerHTML=html;
}

function clearFilters(){
  ['fMinScore','fMin1D','fCapital','fMaxAlloc','fPriceMin'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const maxPriceEl=document.getElementById('fPriceMax');if(maxPriceEl)maxPriceEl.value='1200';
  const max1Del=document.getElementById('fMax1D');if(max1Del)max1Del.value='5';
  const minTurnEl=document.getElementById('fMinTurnover');if(minTurnEl)minTurnEl.value='10000000';
  const minMCapEl=document.getElementById('fMinMarketCap');if(minMCapEl)minMCapEl.value='500000000';
  const reDropEl=document.getElementById('fReDrop');if(reDropEl)reDropEl.value='1';
  const topupEl=document.getElementById('fTopupAlloc');if(topupEl)topupEl.value='50';
  const minScoreEl=document.getElementById('fMinScore');if(minScoreEl)minScoreEl.value='70';
  applyLearnedMaxAllocDefault();
  VOL_AUTO=true;setAutoVolume();
  applyFilters();
  localStorage.removeItem(SCANNER_STORE);
}


function toggleRequiredFilesPopover(){
  const pop=document.getElementById('requiredFilesPopover');
  if(!pop) return;
  const isHidden=pop.style.display==='none';
  if(isHidden){
    pop.style.display='block';
    const content=document.getElementById('requiredFilesPopoverContent');
    if(!content.innerHTML){
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

async function openUploadFolderPicker(){
  if(window.showDirectoryPicker){
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
      await processFiles(files);
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
    sessions:brain[modeKey(CORR_STORE)]?.sessions||0,
    features:brain[modeKey(METH_STORE)]?.features?.length||0
  };
  const json=JSON.stringify(out);
  out._sizeKB=Math.round(json.length/1024);
  const blob=new Blob([json],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`rocket_brain_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  const s=out._summary;
  showToast(`<strong>Brain exported</strong> (${out._sizeKB} KB) · ${s.sessions} sessions · ${s.features} features · ${s.stocks} stocks`);
}

function importBrain(event){
  const file=event.target.files[0];
  if(!file)return;
  const reader=new FileReader();
  reader.onload=async function(e){
    try{
      const brain=JSON.parse(e.target.result);
      const isExport=!!(brain._version&&brain._version.startsWith('rscanner_brain'));
      const isRawBrain=!!(brain&&typeof brain==='object'&&(brain[CORR_STORE]||brain[ALL_STORE]||brain[TRADEBOOK_STORE]||brain[SNAPSHOT_STATE_STORE]));
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
      const s=brain._summary||{sessions:data[CORR_STORE]?.sessions||0};
      showToast(`<strong>Brain imported</strong> — ${s.sessions||0} sessions · Reloading...`, 3000);
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
  const sessions=ACC_CORR?.sessions||1;
  const toast=document.createElement('div');
  toast.className='brain-toast';
  toast.id='brainToast';
  toast.innerHTML=`
    <div class="brain-toast-msg"><strong>Brain updated</strong> · ${sessions} session${sessions!==1?'s':''} accumulated</div>
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
  // Stage 2: second click → final warning with stock-session count
  if(btn._stage===1){
    const brain=FS.getBrain()||{};
    const s=brain[CORR_STORE]?.sessions||0;
    btn._stage=2;
    btn.innerHTML=`🗑 CONFIRM: clear ${s} learned horizons?`;
    btn.style.background='rgba(239,68,68,.25)';btn.style.borderColor='var(--red)';btn.style.color='#fff';
    setTimeout(()=>{if(btn._stage===2){btn._stage=0;btn.innerHTML='🗑 Reset Brain';btn.style.background='';btn.style.borderColor='rgba(239,68,68,.3)';btn.style.color='var(--red)';}},6000);
    return;
  }
  // Stage 3: clear learned/runtime state. The next upload becomes a fresh baseline.
  FS.reset({});
  localStorage.removeItem(SCANNER_STORE);
  localStorage.removeItem(SHARED_FILTER_STORE);
  ACC_CORR=null;SNAPSHOT_RUNTIME=null;
  ALL=[]; FILT=[]; ENGINE_DATA={};
  HOLDINGS=[]; POSITIONS=[]; ORDERS_TODAY=null; TRADEBOOK_STATS=null; LAST_BUY_DATE_MAP={};
  HOLD_COST_MAP={}; SURV_CORR_ACC={};
  btn._stage=0;
  btn.innerHTML='🗑 Reset Brain';btn.style.background='';btn.style.borderColor='rgba(239,68,68,.3)';btn.style.color='var(--red)';
  showToast('<strong>Brain reset.</strong> Cleared accumulated learning and saved filters. The next upload will establish a new snapshot baseline. Uploaded input files remain in Google Drive.',7000);
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
    if(status!=='COMPLETE') return null;
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
  if(holFile?.text) parseNSEHolidays(holFile.text);
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
            detectNSE(fn,text);
          }
        }
      }
      await _hydrateZipEntries(outerZip);
    }catch(e){console.warn('hydrateSessionCSVsFromWorkspace: ZIP parse failed',e);}
  }
  let scannerHydrated=false;
  if(scannerEntry?.file){
    try{scannerHydrated=await processScannerUpload(scannerEntry.file,'stock',{restoreOnly:true});}
    catch(e){
      console.error('hydrateSessionCSVsFromWorkspace: ALL NSE parse failed',e);
      showToast('Stored ALL NSE.csv could not be loaded: '+(e?.message||e),6000,true);
    }
  }
  const updates={};
  if(holdFile?.text){
    HOLDINGS=parseHoldings(holdFile.text);
    updates[HOLD_STORE]={holdings:HOLDINGS,costMap:HOLD_COST_MAP,sourcePath:holdFile.path,lastModified:holdFile.lastModified};
  }
  if(posFile?.text){
    const today=getSessionDate();
    POSITIONS=isCurrentSessionFile(posFile)?parsePositions(posFile.text):[];
    updates[POS_STORE]={positions:POSITIONS,sessionDate:today,sourcePath:posFile.path,lastModified:posFile.lastModified,sourceDate:inputFileSessionDate(posFile),stale:!isCurrentSessionFile(posFile)};
  }
  if(ordFile?.text){
    ORDERS_TODAY=parseOrders(ordFile.text);
    if(ORDERS_TODAY) ORDERS_TODAY._loadedThisSession=true;
    updates[ORDERS_STORE]={orders:ORDERS_TODAY,sourcePath:ordFile.path,lastModified:ordFile.lastModified};
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
    trades.filter(t=>t.type==='buy').map(t=>({symbol,date:t.date,qty:t.qty,price:t.price}))
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

// COST leg target: recover estimated full-position CNC buy + sell charges using this child leg.
function getCostCoverTargetPct(buyPrice, costQty, parentQty){
  if(!(buyPrice>0)||!(costQty>0)||!(parentQty>0)) return 0.05;
  const parentBuyCharges=calcZerodhaCharges(buyPrice,parentQty,false,false,false);
  let pct=0;
  for(let i=0;i<8;i++){
    const sellPrice=buyPrice*(1+pct/100);
    const parentSellCharges=calcZerodhaCharges(sellPrice,parentQty,true,false,false);
    pct=((parentBuyCharges+parentSellCharges)/(buyPrice*costQty))*100;
  }
  return roundPct05(Math.max(0.05,pct+0.05));
}

function planBasketExport(capital, selected){
  let exportList=(selected||[]).filter(s=>!getPriceBandBlockReason(s));
  let basketAlloc=computeAlloc(capital,exportList);
  const orderCount=()=>exportList.reduce((count,s)=>{
    const qty=capital>0?(basketAlloc[s.symbol]?.qty||0):1;
    return count+(qty>=3?3:(qty===2?2:(qty===1?1:0)));
  },0);
  while(exportList.length&&orderCount()>20){
    exportList=exportList.slice(0,-1);
    basketAlloc=computeAlloc(capital,exportList);
  }
  return {exportList,basketAlloc,orderCount:orderCount()};
}


function exportBasket(){
  const capital=parseFloat(document.getElementById('fCapital').value)||0;
  const selList=FILT.filter(s=>SELECTED.has(s.symbol));
  if(!selList.length){showToast('Select at least one stock first.',3000,true);return;}
  const bandRejected=selList.filter(s=>getPriceBandBlockReason(s)).length;
  const {exportList,basketAlloc}=planBasketExport(capital,selList);
  const limitOmitted=Math.max(0,selList.length-bandRejected-exportList.length);

  // Target-only entries: no stop-loss GTT is exported on any child order.
  const adaptiveTGT=roundPct05(getEffectiveTgtPct()||(TRADEBOOK_STATS?TRADEBOOK_STATS.adaptiveTGT:3.7));
  let runnerTGT=roundPct05(getRunnerTgtPct(null,null,adaptiveTGT)||adaptiveTGT*1.5);

  const orders=[];
  let rejectedCount=bandRejected;
  let splitCount=0;
  let costCoverCount=0;
  let orderSeq=0;
  const pushBuyOrder=(s,qty,buyPrice,targetPct,label)=>{
    if(qty<=0) return;
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
        transactionType:'BUY',product:'CNC',orderType:'LIMIT',
        validity:'DAY',validityTTL:1,
        quantity:qty,price:parseFloat(tickPrice(buyPrice).toFixed(2)),
        triggerPrice:0,disclosedQuantity:0,lastPrice:0,
        variety:'regular',
        gtt:{target:targetPct},
        tags:label?[label]:[]
      }
    });
  };
  exportList.forEach(s=>{
    const am = basketAlloc[s.symbol];
    if(am?.rejected){rejectedCount++;return;} // skip cost-floor rejections
    const qty = capital > 0 ? (am?.qty || 0) : 1;
    if(qty===0) return;
    const buyPrice=am?.buyPrice||getBuyPrice(s);
    if(qty>=3){
      // All three child BUY orders are mandatory whenever parent quantity permits it.
      const costQty=Math.max(1,Math.floor(qty/3));
      const remainingQty=qty-costQty;
      const baseQty=Math.ceil(remainingQty/2);
      const runnerQty=remainingQty-baseQty;
      if(costQty+baseQty+runnerQty!==qty||costQty<=0||baseQty<=0||runnerQty<=0){
        throw new Error(`Invalid 3-leg basket split for ${s.symbol}: ${qty} -> ${costQty}+${baseQty}+${runnerQty}`);
      }
      const costTarget=getCostCoverTargetPct(buyPrice,costQty,qty);
      runnerTGT=roundPct05(getRunnerTgtPct(s,buyPrice,adaptiveTGT)||adaptiveTGT*1.5);
      pushBuyOrder(s,costQty,buyPrice,costTarget,'COST');
      pushBuyOrder(s,baseQty,buyPrice,adaptiveTGT,'TGT1');
      pushBuyOrder(s,runnerQty,buyPrice,runnerTGT,'TGT2');
      splitCount++;costCoverCount++;
    } else if(qty===2){
      // Three positive order quantities are impossible for a two-share allocation.
      runnerTGT=roundPct05(getRunnerTgtPct(s,buyPrice,adaptiveTGT)||adaptiveTGT*1.5);
      pushBuyOrder(s,1,buyPrice,adaptiveTGT,'TGT1');
      pushBuyOrder(s,1,buyPrice,runnerTGT,'TGT2');
      splitCount++;
    } else {
      pushBuyOrder(s,qty,buyPrice,adaptiveTGT,'TGT1');
    }
  });

  if(!orders.length){showToast('Capital too low to buy even 1 share of any selected stock.',4000,true);return;}
  if(orders.length>20) throw new Error(`Basket planning invariant failed: ${orders.length} orders`);
  if(capital>0){
    const exportedDebit=orders.reduce((sum,order)=>{
      const qty=order.params.quantity,price=order.params.price;
      return sum+(qty*price)+calcZerodhaCharges(price,qty,false,false,false);
    },0);
    if(exportedDebit>capital+0.001){
      console.error('Basket exceeds capital',{capital,exportedDebit,orders});
      showToast(`Basket needs ${fmtINR(exportedDebit)} including estimated buy charges, above capital ${fmtINR(capital)}. Nothing exported.`,6000,true);
      return;
    }
  }
  downloadBasket(orders,'Zerodha_Basket_Buy');
  const rejNote=rejectedCount>0?` · ${rejectedCount} skipped (eligibility/allocation)`:'';
  const splitNote=splitCount>0?` · split ${splitCount} stocks across TGT1 / TGT2${costCoverCount?` / COST (${costCoverCount} cost-cover legs)`:''}`:'';
  const limitNote=limitOmitted>0?` · ${limitOmitted} lower-priority stock${limitOmitted===1?'':'s'} omitted to keep complete multi-leg plans within Zerodha's 20-order limit`:'';
  showToast(`<strong>Exported ${orders.length} BUY orders</strong> as Zerodha_Basket_Buy JSON${splitNote}${rejNote}${limitNote}`);
}

// ── Basket export helper: Zerodha limits 20 orders per basket ──
function downloadBasket(orders, filename){
  if(orders.length>20) throw new Error(`Refusing to truncate basket with ${orders.length} orders`);
  const blob=new Blob([JSON.stringify(orders,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=filename+'.json';
  a.click();
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
  if(c1) c1.textContent=ENGINE_DATA?.features?'('+ENGINE_DATA.features.length+')':'';
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
function setLoading(on,msg){
  const el=document.getElementById('ldSt');
  if(msg) setMsg(msg);
  if(el) el.classList.toggle('on',!!on);
}

function captureScannerRuntime(){
  return {
    mode:MARKET_MODE,ALL,FILT,ENGINE_DATA,ACC_CORR,SNAPSHOT_RUNTIME,
    REMOVED,SCORE_MAP,COLS,_tvLoadedThisSession,
    lastRawTV:window._lastRawTV,lastScannerSessionTag:window._lastScannerSessionTag,
    lastEngineFeats:window._lastEngineFeats,lastParsedFiltered:window._lastParsedFiltered,lastParsedForSnapshot:window._lastParsedForSnapshot,
    snapshotRuntimeDirty:window._snapshotRuntimeDirty
  };
}
function restoreScannerRuntime(s){
  MARKET_MODE=s.mode;ALL=s.ALL;FILT=s.FILT;ENGINE_DATA=s.ENGINE_DATA;ACC_CORR=s.ACC_CORR;SNAPSHOT_RUNTIME=s.SNAPSHOT_RUNTIME;
  REMOVED=s.REMOVED;SCORE_MAP=s.SCORE_MAP;COLS=s.COLS;_tvLoadedThisSession=s._tvLoadedThisSession;
  window._lastRawTV=s.lastRawTV;window._lastScannerSessionTag=s.lastScannerSessionTag;
  window._lastEngineFeats=s.lastEngineFeats;window._lastParsedFiltered=s.lastParsedFiltered;window._lastParsedForSnapshot=s.lastParsedForSnapshot;
  window._snapshotRuntimeDirty=s.snapshotRuntimeDirty;
}
function compactRankingRows(rows){
  const featureKeys=ENGINE_DATA?.top10Feats||[];
  return (rows||[]).map(s=>({
    symbol:s.symbol,name:s.name,sector:s.sector,industry:s.industry,sectorBreadth:s.sectorBreadth,
    price:s.price,priceChange:s.priceChange,snapshotChange:s.snapshotChange,rocketMove:s.rocketMove,
    volume:s.volume,marketCap:s.marketCap,atr:s.atr,
    high1d:s.high1d,low1d:s.low1d,vwap:s.vwap,piotroski:s.piotroski,shareholders:s.shareholders,
    perf1w:s.perf1w,delivPct:s.delivPct,rangePos:s.rangePos,pctFrom52wHigh:s.pctFrom52wHigh,
    rocketScore:s.rocketScore,flags:s.flags||[],isSurv:!!s.isSurv,survRules:s.survRules||null,
    slPct:s.slPct,tgtPct:s.tgtPct,seen:s.seen||0,
    _features:Object.fromEntries(featureKeys.filter(f=>s._features?.[f]!=null).map(f=>[f,s._features[f]]))
  }));
}
function getIntradayRocketMove(row,priceKey,changeKey,highKey){
  const closeMove=changeKey?Number(row?.[changeKey]):null;
  const price=priceKey?Number(row?.[priceKey]):null;
  const high=highKey?Number(row?.[highKey]):null;
  let highMove=null;
  if(isFinite(price)&&price>0&&isFinite(closeMove)&&1+(closeMove/100)>0&&isFinite(high)&&high>0){
    const priorClose=price/(1+(closeMove/100));
    if(priorClose>0) highMove=((high-priorClose)/priorClose)*100;
  }
  if(isFinite(highMove)&&isFinite(closeMove)) return Math.max(highMove,closeMove);
  if(isFinite(highMove)) return highMove;
  return isFinite(closeMove)?closeMove:null;
}
function snapshotHasData(snapshot){
  return !!(snapshot&&(/^(u16|f32|f32-gzip)-column-v1$/.test(snapshot.format)?snapshot.symbols?.length&&snapshot.data:snapshot.stocks));
}
function bytesToBase64(bytes){
  let binary='';
  for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary);
}
function base64ToBytes(text){
  const binary=atob(text||''),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return bytes;
}
async function gzipBytes(bytes){
  if(typeof CompressionStream==='undefined') return null;
  const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzipBytes(bytes){
  if(typeof DecompressionStream==='undefined') throw new Error('This browser cannot decompress packed snapshots.');
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function snapshotStamp(timestamp=Date.now()){
  const shifted=new Date(timestamp+5.5*60*60*1000);
  const minutes=shifted.getUTCHours()*60+shifted.getUTCMinutes();
  return {
    timestamp,
    sessionDate:`${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth()+1).padStart(2,'0')}-${String(shifted.getUTCDate()).padStart(2,'0')}`,
    minutes,
    inSession:minutes>=NSE_OPEN_MINUTES&&minutes<=NSE_CLOSE_MINUTES,
    baselineEligible:minutes>=DAY_START_MIN&&minutes<=NSE_CLOSE_MINUTES,
  };
}
function isValidSnapshotTransition(previous,current){
  // Retained for diagnostics: valid primary transitions are consecutive NSE trading days only.
  return !!previous&&!!current&&!!(previous.baselineEligible??previous.inSession)&&!!current.inSession&&
    tradingDaysBetween(previous.sessionDate,current.sessionDate)===1&&current.timestamp>previous.timestamp;
}
async function packFloat32Values(values){
  const array=values instanceof Float32Array?values:Float32Array.from(values||[],v=>isFinite(v)?v:NaN);
  const raw=new Uint8Array(array.buffer,array.byteOffset,array.byteLength),compressed=await gzipBytes(raw);
  return {format:compressed?'f32-gzip-v1':'f32-v1',length:array.length,data:bytesToBase64(compressed||raw)};
}
async function unpackFloat32Values(source){
  if(!source?.data) return new Float32Array(0);
  const packed=base64ToBytes(source.data),bytes=source.format==='f32-gzip-v1'?await gunzipBytes(packed):packed;
  const view=new Float32Array(bytes.buffer,bytes.byteOffset,Math.floor(bytes.byteLength/4));
  return new Float32Array(view);
}
async function decodeSnapshotState(source){
  if(!source||source.schema!==SNAPSHOT_STATE_SCHEMA) return emptySnapshotRuntime();
  const decodeOne=async packed=>packed?{
    ...packed,
    prices:await unpackFloat32Values(packed.prices),
    featureRows:await decodeScannerSnapshot(packed.features),
    featureCols:packed.features?.cols||packed.featureCols||[],
  }:null;
  return {...source,latest:await decodeOne(source.latest),previousTradingDay:await decodeOne(source.previousTradingDay)};
}
async function encodeSnapshotState(runtime){
  const encodeOne=async snapshot=>snapshot?{
    timestamp:snapshot.timestamp,sessionDate:snapshot.sessionDate,minutes:snapshot.minutes,
    inSession:snapshot.inSession,baselineEligible:snapshot.baselineEligible??snapshot.inSession,symbols:snapshot.symbols,
    prices:await packFloat32Values(snapshot.prices),
    features:snapshot.features||await packScannerSnapshot(
      snapshot.symbols.map(symbol=>({symbol,...(snapshot.featureRows[symbol]||{})})),snapshot.featureCols||[]
    ),
  }:null;
  return {schema:SNAPSHOT_STATE_SCHEMA,latest:await encodeOne(runtime.latest),previousTradingDay:await encodeOne(runtime.previousTradingDay),
    completed:runtime.completed||0,lastOutcome:runtime.lastOutcome||null,lastTag:runtime.lastTag||null};
}
async function packScannerSnapshot(rows,cols){
  const clean=(rows||[]).filter(d=>normSym(d.symbol));
  const values=new Float32Array(clean.length*cols.length);
  clean.forEach((d,r)=>cols.forEach((f,c)=>{
    const v=Number(d[f]);
    values[r*cols.length+c]=isFinite(v)?v:NaN;
  }));
  const raw=new Uint8Array(values.buffer),compressed=await gzipBytes(raw);
  return {format:compressed?'f32-gzip-column-v1':'f32-column-v1',cols,symbols:clean.map(d=>normSym(d.symbol)),
    data:bytesToBase64(compressed||raw)};
}
async function decodeScannerSnapshot(source){
  const out={};
  if(source?.format==='f32-column-v1'||source?.format==='f32-gzip-column-v1'){
    const packed=base64ToBytes(source.data),bytes=source.format==='f32-gzip-column-v1'?await gunzipBytes(packed):packed;
    const values=new Float32Array(bytes.buffer,bytes.byteOffset,Math.floor(bytes.byteLength/4));
    (source.symbols||[]).forEach((sym,r)=>{
      const obj={};(source.cols||[]).forEach((f,c)=>{const v=values[r*source.cols.length+c];obj[f]=isFinite(v)?v:null;});
      out[normSym(sym)]=obj;
    });
    return out;
  }
  if(source?.format==='u16-column-v1'){
    const bytes=base64ToBytes(source.data),values=new Uint16Array(bytes.buffer,bytes.byteOffset,Math.floor(bytes.byteLength/2));
    (source.symbols||[]).forEach((sym,r)=>{
      const obj={};(source.cols||[]).forEach((f,c)=>{
        const q=values[r*source.cols.length+c],min=source.mins?.[c],max=source.maxs?.[c];
        obj[f]=q===65535||min==null||max==null?null:(max===min?min:min+(q/65534)*(max-min));
      });
      out[normSym(sym)]=obj;
    });
    return out;
  }
  if(source?.cols){Object.entries(source.stocks||{}).forEach(([sym,vals])=>{const obj={};source.cols.forEach((f,i)=>obj[f]=vals[i]);out[normSym(sym)]=obj;});return out;}
  Object.entries(source?.stocks||source||{}).forEach(([sym,features])=>{if(features&&typeof features==='object')out[normSym(sym)]=features;});
  return out;
}
function applySavedFiltersForMode(mode){
  const ids=['fMinScore','fPriceMin','fPriceMax','fMin1D','fMax1D','fVol','fVolMult','fMinTurnover','fMinMarketCap','fCapital','fMaxAlloc','fReDrop','fTopupAlloc'];
  const prev={};
  ids.forEach(id=>{const el=document.getElementById(id);if(el)prev[id]=el.value;});
  try{
    const st=JSON.parse(localStorage.getItem(modeKey(SCANNER_STORE,mode))||'{}');
    const shared=JSON.parse(localStorage.getItem(SHARED_FILTER_STORE)||'{}');
    const map={minScore:'fMinScore',priceMin:'fPriceMin',priceMax:'fPriceMax',fMin1D:'fMin1D',fMax1D:'fMax1D',fvol:'fVol',volMult:'fVolMult',minTurnover:'fMinTurnover',minMarketCap:'fMinMarketCap',reDrop:'fReDrop',topupAlloc:'fTopupAlloc'};
    Object.entries(map).forEach(([k,id])=>{const el=document.getElementById(id);if(el&&st[k]!=null)el.value=st[k];});
    const capEl=document.getElementById('fCapital');if(capEl&&shared.capital!=null)capEl.value=shared.capital;
    const maxEl=document.getElementById('fMaxAlloc');if(maxEl&&shared.maxAlloc!=null)maxEl.value=shared.maxAlloc;
  }catch(e){}
  return ()=>ids.forEach(id=>{const el=document.getElementById(id);if(el&&prev[id]!=null)el.value=prev[id];});
}
async function processScannerUpload(scannerFile, mode, options={}){
  if(!scannerFile) return false;
  const original=captureScannerRuntime();
  const restoreFilters=applySavedFiltersForMode(mode);
  let completed=false;
  MARKET_MODE=mode;
  ACC_CORR=FS.get(modeKey(CORR_STORE,mode));
  const correlationCompatible=ACC_CORR?.corrSchema===CORR_SCHEMA;
  SNAPSHOT_RUNTIME=await decodeSnapshotState(FS.get(modeKey(SNAPSHOT_STATE_STORE,mode)));
  window._snapshotRuntimeDirty=false;
  if(!correlationCompatible&&SNAPSHOT_RUNTIME){
    SNAPSHOT_RUNTIME={...SNAPSHOT_RUNTIME,completed:0,lastOutcome:null};
    window._snapshotRuntimeDirty=true;
  }
  try{
    setMsg('Parsing stock TradingView data...');
    const text=await scannerFile.text();
    const raw=parseCSV(text);
    const ok=isAllNseFilename(scannerFile.name)||looksLikeAllNseRows(raw);
    if(!ok){console.warn('Non-scanner CSV ignored:',scannerFile.name,'rows:',raw.length);return false;}
    setMsg('Running stock mRMR engine across '+raw.length+' stocks...');
    await new Promise(r=>setTimeout(r,60));
    window._lastRawTV=raw;
    const sessionTag=scannerSessionTag(scannerFile.name,raw,text);
    const uploadSession=inputFileSessionDate(scannerFile);
    const isDuplicateSession=!!(SNAPSHOT_RUNTIME?.lastTag===sessionTag&&SNAPSHOT_RUNTIME?.latest?.sessionDate===uploadSession);
    window._lastScannerSessionTag=sessionTag;
    const restoreOnly=options.restoreOnly===true;
    ALL=await runEngine(raw,sessionTag,{
      advanceSnapshot:!restoreOnly,
      snapshotTimestamp:scannerFile.lastModified||Date.now()
    })||[];
    enrichRowsWithNSEData(ALL);
    ALL.sort((a,b)=>b.rocketScore-a.rocketScore);
    const rcToday=getSessionDate(), rc=FS.get(modeKey(REC_COUNT_STORE,mode))||{};
    if(!rc[rcToday])rc[rcToday]={};
    const countSeen=!restoreOnly&&!isDuplicateSession&&isMarketHours();
    ALL.forEach(s=>{
      if(countSeen) rc[rcToday][s.symbol]=(rc[rcToday][s.symbol]||0)+1;
      s.seen=rc[rcToday][s.symbol]||0;
    });
    if(countSeen) FS.set(modeKey(REC_COUNT_STORE,mode),rc);
    const fileTag=scannerFile.name+' · '+raw.length+' stocks';
    try{const ft=document.getElementById('fileTag');if(ft)ft.textContent=fileTag;}catch(e){}
    FS.set(modeKey(ALL_STORE,mode),{data:compactRankingRows(ALL),fileTag,ts:new Date().toISOString()});
    if(window._snapshotRuntimeDirty&&SNAPSHOT_RUNTIME){
      FS.set(modeKey(SNAPSHOT_STATE_STORE,mode),await encodeSnapshotState(SNAPSHOT_RUNTIME));
    }
    if(mode==='stock'){
      const threshold=getEffectiveTgtPct()||TRADEBOOK_STATS?.adaptiveTGT||4;
      const eligibleCandidates=getDisplayedEntryCandidates(ALL).filter(s=>s.price>0);
      const outcomeFeatureOrder=getOutcomeFeatureOrderFromEngine();
      const recommendations=eligibleCandidates
        .map((s,i)=>({symbol:s.symbol,entryPrice:s.price,score:s.rocketScore,rank:i+1,features:compactOutcomeFeatures(s._features,outcomeFeatureOrder)}));
      window._lastStockOutcomeScan={
        date:getSessionDate(),sourceDate:inputFileSessionDate(scannerFile),threshold,
        rows:window._lastObservedDailyMoves||[],
        recommendations
      };
      recordRecommendationOutcomeScan(window._lastStockOutcomeScan);
      recordDisplayedEntryCohort({date:getSessionDate(),candidates:eligibleCandidates});
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

async function processFiles(files){
  if(!(await ensureDriveReadyForLoad())){
    setLoading(false);
    return;
  }
  setLoading(true,'Processing selected files...');
  // Upload canonical input files to Drive in the background. Rankings are built from
  // the selected local files immediately, because the market does not wait for Drive.
  saveInputsInBackground(files);
  NSE_BHAV={};NSE_52W={};NSE_SURV={};NSE_BULK={};NSE_BLOCK={};NSE_PRICE_BAND={};
  let tvFile=null,nseZip=null,holdFile=null,posFile=null,ordFile=null,tbFile=null,holidayFile=false;
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
        if(detectNSE(f.name,text)==='holidays') holidayFile=true;
      }catch(e){console.warn('Could not parse NSE Holidays.csv:',f.name,e);}
      continue;
    }
  }
  if(!tvFile&&!nseZip&&!holdFile&&!posFile&&!ordFile&&!tbFile&&!holidayFile){
    setLoading(false);
    showToast('No files recognised. Upload the NSE scanner and/or Zerodha input files.',4000,true);
    return;
  }

  if(nseZip){
    setMsg('Unzipping NSE data...');
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
            setMsg('Parsing '+fn+'...');
            const text=await entry.async('string');
            detectNSE(fn,text);
          }
        }
      }
      await processZipEntries(outerZip);
    }catch(e){console.error('ZIP error:',e);}
  }

  const scannerJobs=[];
  if(tvFile)scannerJobs.push({mode:'stock',file:tvFile});
  for(const job of scannerJobs) await processScannerUpload(job.file,job.mode);
  const stockScannerProcessed=scannerJobs.some(j=>j.mode==='stock');

  if(!scannerJobs.length&&!holdFile&&!posFile&&!ordFile&&!tbFile&&!holidayFile){
    setLoading(false);
    if(!nseZip) showToast('TradingView CSV not found in the selected Scanner Uploads folder.',4000,true);
  }

  // Holdings / Positions / Orders / Tradebook — processed regardless of TV CSV
  // All files are loaded before rendering so Latest Session always has fresh data
  if(holdFile){
    setMsg('Processing holdings...');
    const holdText=await holdFile.text();
    HOLDINGS=parseHoldings(holdText);
    try{FS.set(HOLD_STORE,{holdings:HOLDINGS,costMap:HOLD_COST_MAP});}catch(e){}
  }
  if(posFile){
    setMsg('Processing positions...');
    const posText=await posFile.text();
    const posHash=(function(t){let h=0;for(let i=0;i<t.length;i++){h=((h<<5)-h)+t.charCodeAt(i);h|=0;}return h;})(posText);
    const today=getSessionDate();
    POSITIONS=isCurrentSessionFile(posFile)?parsePositions(posText):[];
    try{FS.set(POS_STORE,{positions:POSITIONS,hash:posHash,sessionDate:today,sourceDate:inputFileSessionDate(posFile),stale:!isCurrentSessionFile(posFile)});}catch(e){}
  }
  if(ordFile){
    setMsg('Processing orders...');
    const ordText=await ordFile.text();
    ORDERS_TODAY=parseOrders(ordText);
    if(ORDERS_TODAY) ORDERS_TODAY._loadedThisSession=true;
    try{FS.set(ORDERS_STORE,{orders:ORDERS_TODAY,sourcePath:ordFile.name,lastModified:ordFile.lastModified});}catch(e){}
  }
  if(tbFile){
    setMsg('Analyzing tradebook...');
    const tbText=await tbFile.text();
    const parsedTradebook=parseTradebook(tbText);
    if(parsedTradebook){
      const selected=keepFullerTradebookHistory(parsedTradebook,tbFile.name,tbFile.lastModified);
      TRADEBOOK_STATS=selected.stats;
      reconcileSameDayExitOpportunities();
      if(selected.persist) try{FS.set(TRADEBOOK_STORE,selected.persist);}catch(e){}
      if(selected.meta) try{FS.set(TRADEBOOK_META_STORE,selected.meta);}catch(e){}
    }
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
  setMsg('Rendering rankings...');
  renderTradingDashboardNow();
  setLoading(false);
  showToast('<strong>Rankings ready.</strong> Drive and brain saves continue in the background.',3500);
  saveBrainInBackground('Brain saved after file processing');
}

document.getElementById('fInDir').addEventListener('change',e=>{
  if(!e.target.files.length) return;
  processFiles(Array.from(e.target.files)).catch(error=>{
    console.error('File input load failed',error);
    setLoading(false);
    showToast('Could not load the selected files: '+(error?.message||error),6000,true);
  });
});
document.getElementById('fMaxAlloc')?.addEventListener('input',e=>{delete e.target.dataset.autoDefault;});


// ══════════════════════════════════════════════════
// SCANNER FILTER PERSISTENCE
// ══════════════════════════════════════════════════

let ACC_CORR=null; // accumulated feature relevance across completed snapshot horizons
let SNAPSHOT_RUNTIME=null; // decoded latest full-universe snapshot baseline

// ── Async app init: load brain file → hydrate all state → render ──
async function initApp(){
  updateModeUI();
  setLoading(true,'Loading latest cloud data...');
  // Step 0: Restore an active Drive token for this browser session and load cloud brain data.
  const brain=await FS.init();
  if(!brain&&!FS.hasFolder()){
    console.log('INIT: Google Drive is not authorized; skipping cloud hydration until user reconnects.');
    try{loadFilterState();}catch(e){}
    try{setAutoVolume();}catch(e){}
    _initInProgress=false;
    showDriveAuthRequiredState();
    updateFolderUI();
    setLoading(false);
    return;
  }
  if(brain){
    FS.load(brain);
    const savedCorr=brain[modeKey(CORR_STORE)];
    const correlationCompatible=savedCorr?.corrSchema===CORR_SCHEMA;
    // Load NSE holidays first (needed for staleness check below)
    try{const hols=brain[NSE_HOLIDAYS_STORE];if(Array.isArray(hols)&&hols.length) NSE_HOLIDAYS=new Set(hols);}catch(e){}

    // Step 1: Load correlations
    try{
      if(correlationCompatible){
        ACC_CORR=savedCorr;
      }else{
        ACC_CORR={
          corr:{},counts:{},sessions:0,learnSessions:0,weightedSessions:0,corrSchema:CORR_SCHEMA,
          elapsedCount:savedCorr?.elapsedCount||0,
          elapsedTotalMinutes:savedCorr?.elapsedTotalMinutes||0,
        };
        console.log('INIT: reset incompatible correlation target schema; retained compact timing totals.');
      }
    }catch(e){}
    try{
      SNAPSHOT_RUNTIME=await decodeSnapshotState(brain[modeKey(SNAPSHOT_STATE_STORE)]);
      if(!correlationCompatible&&SNAPSHOT_RUNTIME) SNAPSHOT_RUNTIME={...SNAPSHOT_RUNTIME,completed:0,lastOutcome:null};
    }catch(e){SNAPSHOT_RUNTIME=emptySnapshotRuntime();}

    // Step 2: Load scan data
    try{
      const saved=brain[modeKey(ALL_STORE)];
      if(saved&&saved.data&&saved.data.length){
        ALL=saved.data.map(s=>({flags:[],...s,symbol:normSym(s.symbol),rocketScore:correlationCompatible?(s.rocketScore||0):0})).filter(s=>s.symbol);
        FILT=[...ALL];
        SELECTED=new Set(ALL.map(s=>s.symbol));
        if(saved.fileTag){const ft=document.getElementById('fileTag');if(ft)ft.textContent=saved.fileTag;}
        if(saved.ts){const _ist=new Date(saved.ts+5.5*3600000);
          // Track the saved scan date so the stale banner can check if it's from today
          _scanSavedDate=_ist.toISOString().slice(0,10);
        }
        console.log('INIT: restored',ALL.length,'stocks from file');
        // Restore Seen counts for today
        try{const _rcS=brain[modeKey(REC_COUNT_STORE)];if(_rcS&&typeof _rcS==='object'){
          const _rcD=_rcS[getSessionDate()]||{};
          ALL.forEach(s=>{s.seen=_rcD[s.symbol]||0;});
        }}catch(e){}
      }
    }catch(e){console.error('INIT step2 data failed:',e);}

    // Step 2b: Restore methodology
    try{
      const meth=brain[modeKey(METH_STORE)];
      if(correlationCompatible&&meth&&meth.features&&meth.features.length){
        ENGINE_DATA={...meth};
        COLS=getCols();
        // Restore REMOVED counts so filter pills show correctly on page load.
        // Older brain snapshots counted null/blank values as removals; those counts
        // are intentionally not restored under the current hard-filter schema.
        if(meth.removed&&typeof meth.removed==='object'){
          const restored=meth.hardFilterSchema===HARD_FILTER_SCHEMA?meth.removed:{};
          REMOVED={uc:0,surv:0,nonEq:0,survRules:{},liq:0,fscore:0,atr:0,...restored};
          delete REMOVED.rockets;
          if(typeof REMOVED.survRules!=='object'||Array.isArray(REMOVED.survRules)) REMOVED.survRules={};
          ENGINE_DATA.removed=REMOVED;
        }
        console.log('INIT: restored methodology data,',meth.features.length,'features');
      }
    }catch(e){console.error('INIT step2b meth restore failed:',e);}

    // Step 2c: Restore compact learned/runtime state only. Holdings, positions,
    // orders, and tradebook are source-derived and hydrate from canonical Drive inputs.
    // Restore NSE holidays because this compact calendar is intentionally persisted.
    try{const hols=brain[NSE_HOLIDAYS_STORE];if(Array.isArray(hols)&&hols.length) NSE_HOLIDAYS=new Set(hols);}catch(e){}

    // Step 2d: Restore surveillance P&L correlation accumulator
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
  // before REG1 ZIP hydration so hard filtering is active on the first new scan.
  try{loadSurvRules();}catch(e){SURV_CUSTOM_RULES=SURV_SEED_RULES.map(r=>({key:survRuleKey(r.column),column:r.column,label:r.label}));}

  // Prefer current cloud inputs over the saved brain snapshot. This keeps
  // Latest Session/Booked Today from showing stale rs_orders after Orders.csv changes.
  try{await hydrateSessionCSVsFromWorkspace();}catch(e){console.warn('INIT: cloud input hydration failed',e);}
  try{enrichRowsWithNSEData(ALL);}catch(e){console.warn('INIT: NSE row enrichment failed',e);}

  // Rankings render first; performance analytics are scheduled below as an idle task.
  try{const pe=document.getElementById('perfContent');if(pe&&!PERF_RENDERED)pe.innerHTML=`<div style="text-align:center;padding:60px 40px;color:var(--t2)"><div style="font-size:34px;margin-bottom:14px">📈</div><div style="font-size:15px;font-weight:700;color:var(--t1);margin-bottom:8px">Calculating performance</div><div>Rankings load first; trade analytics continue automatically.</div></div>`;}catch(e){}

  // Step 3: Render stats without blocking on Performance analytics.
  try{if(ALL.length) renderStats();}catch(e){console.error('INIT step3 renderStats failed:',e);}

  // Step 4: Render methodology
  try{if(ALL.length&&ENGINE_DATA&&ENGINE_DATA.features) renderMethodology();}catch(e){console.error('INIT step4 renderMethodology failed:',e);}

  // Step 5: Load filter state (still from localStorage)
  try{loadFilterState();}catch(e){console.error('INIT step5 loadFilterState failed:',e);}

  // Step 5b: Set auto volume (must be after loadFilterState so fVolMult is restored first)
  try{setAutoVolume();}catch(e){}

  // Step 6: Show header + dash before applyFilters so renderTable works into a visible element
  try{
    document.getElementById('hdrR').style.display='flex';
    document.getElementById('dash').style.display='block';
    document.getElementById('noDataBanner').style.display=ALL.length?'none':'flex';
  }catch(e){console.error('INIT step6 visibility failed:',e);}

  // Step 7: Apply filters and render table — runs once, cleanly, with all filters restored
  _initInProgress=false;
  try{applyFilters();}catch(e){console.error('INIT step7 applyFilters failed:',e);}
  setLoading(false);
  schedulePerformanceRender();
}
initApp();

function saveFilterState(){
  const state={
    minScore:document.getElementById('fMinScore')?.value||'70',
    priceMin:document.getElementById('fPriceMin')?.value||'',
    priceMax:document.getElementById('fPriceMax')?.value||'',
    fvol:VOL_AUTO?'':document.getElementById('fVol')?.value||'',
    volMult:document.getElementById('fVolMult')?.value||String(LIQ_MIN_VOL_DEFAULT),
    minTurnover:document.getElementById('fMinTurnover')?.value??'',
    minMarketCap:document.getElementById('fMinMarketCap')?.value??'',
    fMin1D:document.getElementById('fMin1D')?.value||'',
    fMax1D:document.getElementById('fMax1D')?.value||'',
    reDrop:document.getElementById('fReDrop')?.value||'1',
    topupAlloc:document.getElementById('fTopupAlloc')?.value||'50',
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
    if(state.minScore){const el=document.getElementById('fMinScore');if(el)el.value=state.minScore;}
    if(state.priceMin){const el=document.getElementById('fPriceMin');if(el)el.value=state.priceMin;}
    if(state.priceMax!=null){const el=document.getElementById('fPriceMax');if(el)el.value=state.priceMax;}
    if(state.fMin1D){const el=document.getElementById('fMin1D');if(el)el.value=state.fMin1D;}
    if(state.fMax1D!=null){const el=document.getElementById('fMax1D');if(el)el.value=state.fMax1D;}
    const sharedCapital=shared.capital!=null?shared.capital:state.capital;
    const sharedMaxAlloc=shared.maxAlloc!=null?shared.maxAlloc:state.maxAlloc;
    if(sharedCapital){const el=document.getElementById('fCapital');if(el)el.value=sharedCapital;}
    if(sharedMaxAlloc){const el=document.getElementById('fMaxAlloc');if(el)el.value=sharedMaxAlloc;}
    if(state.reDrop!=null){const el=document.getElementById('fReDrop');if(el)el.value=state.reDrop;}
    if(state.topupAlloc!=null){const el=document.getElementById('fTopupAlloc');if(el)el.value=state.topupAlloc;}
    if(state.volMult){const el=document.getElementById('fVolMult');if(el)el.value=state.volMult;}
    if(state.minTurnover!=null){const el=document.getElementById('fMinTurnover');if(el)el.value=state.minTurnover;}
    if(state.minMarketCap!=null){const el=document.getElementById('fMinMarketCap');if(el)el.value=state.minMarketCap;}
    if(state.fvol){
      const el=document.getElementById('fVol');if(el)el.value=state.fvol;
      VOL_AUTO=false;
    } else {
      VOL_AUTO=true; setAutoVolume();
    }
    applyLearnedMaxAllocDefault();
    if(state.sortCol)SCOL=state.sortCol;
    if(state.sortDir)SDIR=state.sortDir;
  }catch(e){console.warn('Could not load filter state',e);}
  
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
  const nseFiles=[
    'block.csv',
    'bulk.csv',
    'CM_52_wk_High_low_'+nd.ddmmyyyy+'.csv',
    'REG1_IND'+nd.ddmmyy+'.csv',
    'sec_bhavdata_full_'+nd.ddmmyyyy+'.csv',
    'sec_list_'+nd.ddmmyyyy+'.csv',
  ];
  const tvFiles=[
    '📈 ALL NSE.csv',
    '🏛 Reports-Daily-Multiple.zip',
    '🛡 Holdings.csv',
    '📊 Positions.csv',
    '🧾 Orders.csv',
    '📒 TRADEBOOK.csv',
    '📅 NSE Holidays.csv',
  ];
  const allFiles=tvFiles.concat(nseFiles);
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

