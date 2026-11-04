// Reuse the original StratGen UI inside RS; the main helper owns research.
(function () {
  'use strict';
  const API='http://127.0.0.1:8787/api/stratgen';
  let mounted=false,checking=false,lastState='',nativeApi=null,viewReady=false,viewLoading=false,lastJobId=null,lastJobState=null;
  const $=id=>document.getElementById(id);
  function render(){
    const container=$('stratgenContent');if(!container)return;
    if(!mounted){
      mounted=true;
      container.innerHTML=`<div class="sg-health" role="status" aria-live="polite">
        <strong id="sgHealthState">Connecting to StratGen…</strong><span id="sgHealthDetail"></span>
        <button class="btn" id="sgRestart">Restart research service</button>
        <button class="btn" id="sgCancel">Cancel research job</button><button class="btn" id="sgLogs">Logs</button>
        <button class="btn" id="sgClear">Clear active strategy</button>
        <details id="sgLogBox" hidden><summary>StratGen logs</summary><pre id="sgLogText"></pre></details>
      </div><div id="sgFailure" class="sg-failure" hidden></div>
      <div id="sgNativeApp" class="sg-native-host"></div>`;
      $('sgRestart').onclick=async()=>{
        if(!confirm('Restart StratGen? Any running research job will be stopped.'))return;
        try{nativeApi?.stopDiscoveryLoop?.();await request('/restart',{method:'POST'});viewReady=false;await loadNativeUI();await health();}catch(e){failure(e.message);}
      };
      $('sgCancel').onclick=async()=>{try{nativeApi?.stopDiscoveryLoop?.();await request('/api/cancel',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});await health();}catch(e){failure(e.message);}};
      $('sgClear').onclick=async()=>{try{await request('/undeploy',{method:'POST'});applyActive(null);}catch(e){failure(e.message);}};
      $('sgLogs').onclick=async()=>{
        try{const data=await request('/log');$('sgLogText').textContent=(data.logs||[]).map(r=>new Date(r.at).toLocaleTimeString('en-IN')+' '+r.text).join('\n')+'\n'+(data.research||'No research log yet.');$('sgLogBox').hidden=false;$('sgLogBox').open=true;}catch(e){failure(e.message);}
      };
    }
    if(!viewReady)loadNativeUI();
    health();
  }
  async function request(route,options){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
    try{const res=await fetch(API+route,{...options,signal:controller.signal,cache:'no-store'});const data=await res.json();if(!res.ok)throw Error(data.error||data.why||'StratGen request failed');return data;}
    finally{clearTimeout(timer);}
  }
  function failure(message){if($('sgFailure')){$('sgFailure').hidden=false;$('sgFailure').textContent=message;}}
  function applyActive(contract){
    window.__deployedStratGen=contract;window.RocketStrategy?.applyDeployedStrategy(contract);
    const option=$('optStratGen');if(option)option.textContent=contract?.name||'No Strategy Deployed (Awaiting StratGen)';
    const selector=$('fModel');if(selector){selector.value=contract?'STRATGEN':'CUM';if(typeof onModelChange==='function')onModelChange();}
    const brand=document.querySelector('.brand-tag');if(brand)brand.textContent=contract?.name||'Cumulative Change - VWAP Strengthening';
    if(typeof applyFilters==='function')applyFilters({preservePage:true});
    if(typeof renderStats==='function')renderStats();
  }
  function selectBaseline(){const el=$('fModel');if(el){el.value='CUM';if(typeof onModelChange==='function')onModelChange();}}
  async function loadNativeUI(){
    if(viewLoading||viewReady||!$('sgNativeApp'))return;
    viewLoading=true;
    try{
      const response=await fetch(API+'/ui',{cache:'no-store'});if(!response.ok)throw Error('Could not load StratGen UI');
      const parsed=new DOMParser().parseFromString(await response.text(),'text/html');
      const host=$('sgNativeApp'),root=host.shadowRoot||host.attachShadow({mode:'open'});
      const script=[...parsed.querySelectorAll('script')].map(n=>n.textContent).join('\n');
      const css=[...parsed.querySelectorAll('style')].map(n=>n.textContent).join('\n').replace(/:root/g,':host').replace(/\bbody\s*\{/g,':host {');
      parsed.querySelectorAll('script,style').forEach(n=>n.remove());
      root.innerHTML='<style>'+css+'\n:host{display:block;min-height:0;padding:8px 0}.modal-overlay{z-index:10000}.modal-content{max-height:90vh}</style><div class="sg-native-body">'+parsed.body.innerHTML+'</div>';
      const body=root.querySelector('.sg-native-body');
      const doc={body,documentElement:body,getElementById:id=>root.getElementById(id),querySelector:q=>root.querySelector(q),querySelectorAll:q=>root.querySelectorAll(q),createElement:tag=>document.createElement(tag),addEventListener:(...a)=>document.addEventListener(...a)};
      const baseFetch=(input,options)=>fetch(typeof input==='string'&&input.startsWith('/api/stratgen')?'http://127.0.0.1:8787'+input:input,options);
      const sandbox=new Proxy({fetch:baseFetch,postMessage:data=>{if(data?.type==='sg-deployed')applyActive(data.deployed);if(data?.type==='sg-select-baseline')selectBaseline();}}, {get:(target,key)=>{if(key in target)return target[key];const value=window[key];return typeof value==='function'?value.bind(window):value;},set:(target,key,value)=>(target[key]=value,true)});
      const names=[...new Set([...script.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+(\w+)\s*\(/g)].map(m=>m[1]))];
      const exports=names.map(name=>name+':(typeof '+name+"==='function'?"+name+':undefined)').join(',');
      const run=new Function('window','document','parent','location','fetch',script+'\nreturn {window,document,parent,'+exports+'};');
      nativeApi=run(sandbox,doc,sandbox,window.location,(...a)=>sandbox.fetch(...a));
      const bind=()=>{for(const el of root.querySelectorAll('*'))for(const attr of [...el.attributes]){
        if(!/^on(?:click|input|change|keydown|keyup|submit)$/.test(attr.name))continue;
        const type=attr.name.slice(2),handler=new Function('api','event','with(api){'+attr.value+'}');el.removeAttribute(attr.name);
        el.addEventListener(type,event=>{try{if(handler.call(el,nativeApi,event)===false)event.preventDefault();}catch(e){failure(e.message);console.error(e);}});
      }};
      bind();new MutationObserver(bind).observe(root,{childList:true,subtree:true});viewReady=true;
    }catch(e){failure('StratGen view: '+e.message);}finally{viewLoading=false;}
  }
  async function health(){
    if(checking)return;checking=true;
    try{
      const s=await request('/status');
      if(s.job?.state==='COMPLETE'&&(s.job.id!==lastJobId||lastJobState!=='COMPLETE'))nativeApi?.loadLeaderboard?.();
      lastJobId=s.job?.id||null;lastJobState=s.job?.state||null;
      const state=s.state==='READY'?(s.job?.state==='RUNNING'?'BUSY':s.job?.state==='FAILED'?'FAILED':'READY'):s.state;
      const badge=$('tabCount4');
      if(badge){badge.textContent=state;badge.style.color=s.ok&&state!=='STALLED'&&state!=='FAILED'?'#00e5a3':'#ff7043';badge.title=s.lastError||s.deploymentBlock||'';}
      if($('sgHealthState')){
        $('sgHealthState').textContent='StratGen '+state;
        const job=s.job;
        $('sgHealthDetail').textContent=[s.pid?'PID '+s.pid:'',s.heartbeatAgeMs!==null?Math.round(s.heartbeatAgeMs/1000)+'s since heartbeat':'No heartbeat',job?job.action+' | '+job.state+(job.phase?' | '+job.phase.replaceAll('_',' '):'')+(job.total?' | '+job.progress+'/'+job.total:''):'No job',s.restarts?'Restarts '+s.restarts:'',s.live?($('fModel')?.value==='CUM'?'Live: native CUM':'Live '+s.live.state+(s.live.error?' | '+s.live.error:'')):'',s.upstreamChanges?.length?'Original StratGen changed: '+s.upstreamChanges.join(', ')+' (review pending)':''].filter(Boolean).join(' · ');
        $('sgCancel').disabled=job?.state!=='RUNNING';
        $('sgFailure').hidden=!s.lastError&&s.job?.state!=='FAILED'&&s.ok&&state!=='STALLED'&&state!=='FAILED';
        if(!$('sgFailure').hidden)$('sgFailure').textContent=s.lastError||s.job?.error||(state==='STALLED'?'Research has made no progress for five minutes. Inspect logs or cancel the job.':'Research service unavailable. Trading protection runs independently.');
      }
      if(s.state==='READY'&&!viewReady&&mounted)await loadNativeUI();
      lastState=s.state;
    }catch(e){
      const badge=$('tabCount4');if(badge){badge.textContent='OFFLINE';badge.style.color='#ff7043';badge.title=e.message;}
      if($('sgHealthState'))$('sgHealthState').textContent='StratGen OFFLINE';
      failure('RS helper connection unavailable: '+e.message);lastState='OFFLINE';
    }finally{checking=false;}
  }
  window.RocketStratGen={render,retry:health};
  setInterval(health,5000);health();
})();
