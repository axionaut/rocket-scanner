// Reuse the original StratGen UI inside RS; the main helper owns research.
(function () {
  'use strict';
  const API='http://127.0.0.1:8787/api/stratgen';
  let mounted=false,checking=false,lastState='';
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
      <iframe id="sgOriginalUI" scrolling="no" title="StratGen Rankings, Discovery and Indicator Suite" src="${API}/ui" sandbox="allow-scripts allow-same-origin allow-modals allow-downloads" allow="clipboard-write" referrerpolicy="no-referrer"></iframe>`;
      $('sgRestart').onclick=async()=>{
        if(!confirm('Restart StratGen? Any running research job will be stopped.'))return;
        try{await request('/restart',{method:'POST'});$('sgOriginalUI').src=API+'/ui';await health();}catch(e){failure(e.message);}
      };
      $('sgCancel').onclick=async()=>{try{$('sgOriginalUI').contentWindow.postMessage({type:'sg-cancel'},'http://127.0.0.1:8787');await request('/api/cancel',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});await health();}catch(e){failure(e.message);}};
      $('sgClear').onclick=async()=>{try{await request('/undeploy',{method:'POST'});applyActive(null);}catch(e){failure(e.message);}};
      $('sgLogs').onclick=async()=>{
        try{const data=await request('/log');$('sgLogText').textContent=(data.logs||[]).map(r=>new Date(r.at).toLocaleTimeString('en-IN')+' '+r.text).join('\n')+'\n'+(data.research||'No research log yet.');$('sgLogBox').hidden=false;$('sgLogBox').open=true;}catch(e){failure(e.message);}
      };
    }
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
  window.addEventListener('message',event=>{
    if(event.origin!=='http://127.0.0.1:8787'||event.source!==$('sgOriginalUI')?.contentWindow)return;
    if(event.data?.type==='sg-size'&&Number.isFinite(event.data.height)&&event.data.height>0&&event.data.height<200000){$('sgOriginalUI').style.height=Math.ceil(event.data.height)+2+'px';}
    if(event.data?.type==='sg-deployed')applyActive(event.data.deployed);
  });
  async function health(){
    if(checking)return;checking=true;
    try{
      const s=await request('/status');
      const state=s.state==='READY'&&s.job?.state==='RUNNING'?'BUSY':s.state;
      const badge=$('tabCount4');
      if(badge){badge.textContent=state;badge.style.color=s.ok&&state!=='STALLED'?'#00e5a3':'#ff7043';badge.title=s.lastError||s.deploymentBlock||'';}
      if($('sgHealthState')){
        $('sgHealthState').textContent='StratGen '+state;
        const job=s.job;
        $('sgHealthDetail').textContent=[s.pid?'PID '+s.pid:'',s.heartbeatAgeMs!==null?Math.round(s.heartbeatAgeMs/1000)+'s since heartbeat':'No heartbeat',job?job.action+' · '+job.state+(job.total?' · '+job.progress+'/'+job.total:''):'No job',s.restarts?'Restarts '+s.restarts:'',s.live?'Live '+s.live.state+(s.live.error?' | '+s.live.error:''):'',s.upstreamChanges?.length?'Original StratGen changed: '+s.upstreamChanges.join(', ')+' (review pending)':''].filter(Boolean).join(' · ');
        $('sgCancel').disabled=job?.state!=='RUNNING';
        $('sgFailure').hidden=!s.lastError&&s.job?.state!=='FAILED'&&s.ok&&state!=='STALLED';
        if(!$('sgFailure').hidden)$('sgFailure').textContent=s.lastError||s.job?.error||(state==='STALLED'?'Research has made no progress for five minutes. Inspect logs or cancel the job.':'Research service unavailable. Trading protection runs independently.');
      }
      if(s.state==='READY'&&lastState!==s.state&&$('sgOriginalUI'))$('sgOriginalUI').src=API+'/ui';
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
