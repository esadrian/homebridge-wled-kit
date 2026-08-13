function escapeHtml(str) {
      return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    let isDiscovering=false, currentConfig=null, discoveryStopRequested=false;
    let discoveryStartTime=0, discoveryProgressTimer=null, lastDiscoveredHostsKey='', lastDiscoveryFoundCount=0;
    const discoveredNameEdits={}, discoveredSuggestedNames={};
    const SAVE_APPLY_HINT='Press Save to apply.';

    function withSaveHint(message){
      const text=String(message||'').trim();
      if(!text) return SAVE_APPLY_HINT;
      if(/press save/i.test(text)) return text;
      return `${text.replace(/\.\s*$/,'')} — ${SAVE_APPLY_HINT}`;
    }
    function hbShowSpinner(){ window.homebridge?.showSpinner?.(); }
    function hbHideSpinner(){ window.homebridge?.hideSpinner?.(); }
    function hbEnableSave(){ window.homebridge?.enableSaveButton?.(); }
    function hbDisableSave(){ window.homebridge?.disableSaveButton?.(); }
    function hbHideSchemaForm(){ window.homebridge?.hideSchemaForm?.(); }

    const MENU_BUTTON_IDS={settings:'menuSettings',devices:'menuDevices',support:'menuSupport'};
    const PAGE_IDS={settings:'pageSettings',devices:'pageDevices',support:'pageSupport'};
    function markRestartNeeded(){ const b=document.getElementById('restartBanner'); if(b){ b.classList.remove('d-none'); b.style.display='flex'; } }
    function dismissRestartBanner(){ const b=document.getElementById('restartBanner'); if(b){ b.classList.add('d-none'); b.style.display='none'; } }
    async function notifySaved(){
      markRestartNeeded();
      await window.homebridge.toast.info(withSaveHint('Changes staged'), 'Updated');
    }
    async function notifyAction(message, title){
      markRestartNeeded();
      await window.homebridge.toast.success(withSaveHint(message), title||'Done');
    }
    function discoveredNameInputId(host){ return `discovered-name-${String(host).replace(/[^a-zA-Z0-9]/g,'')}`; }
    function setDiscoveredName(host, value){ discoveredNameEdits[host]=(value||'').trim(); }

    function showIntro(){
      document.getElementById('pageIntro')?.classList.remove('d-none');
      document.getElementById('menuWrapper')?.classList.add('d-none');
      Object.values(PAGE_IDS).forEach(id=>document.getElementById(id)?.classList.add('d-none'));
      hbHideSchemaForm();
      hbDisableSave();
    }
    function setMenuActive(tabName){
      Object.entries(MENU_BUTTON_IDS).forEach(([name,id])=>{
        const btn=document.getElementById(id);
        if(!btn) return;
        const active=name===tabName;
        btn.classList.toggle('btn-elegant', active);
        btn.classList.toggle('btn-primary', !active);
      });
    }
    function showMainUI(defaultTab='devices'){
      document.getElementById('pageIntro')?.classList.add('d-none');
      document.getElementById('menuWrapper')?.classList.remove('d-none');
      switchTab(defaultTab);
    }
    function continueFromIntro(){ showMainUI('devices'); }

    function switchTab(tabName){
      hbShowSpinner();
      try{
        Object.values(PAGE_IDS).forEach(id=>document.getElementById(id)?.classList.add('d-none'));
        document.getElementById(PAGE_IDS[tabName])?.classList.remove('d-none');
        setMenuActive(tabName);
        hbHideSchemaForm();
        if(tabName==='settings'){
          hbEnableSave();
          loadSettings();
        }else{
          hbDisableSave();
          if(tabName==='devices') loadConfiguredDevices();
        }
      }finally{
        hbHideSpinner();
      }
    }
    function toggleAddPanel(show){
      const panel=document.getElementById('addPanel');
      if(!panel) return;
      panel.classList.toggle('d-none', !show);
      if(show){ loadAutoStopCheckbox(); setAddMode('scan'); }
      else if(isDiscovering) stopDiscovery();
    }
    function setAddMode(mode){
      const isScan=mode==='scan';
      document.getElementById('addModeScan')?.classList.toggle('d-none', !isScan);
      document.getElementById('addModeIp')?.classList.toggle('d-none', isScan);
      document.getElementById('addModeScanBtn')?.classList.toggle('active', isScan);
      document.getElementById('addModeIpBtn')?.classList.toggle('active', !isScan);
    }
    async function loadAutoStopCheckbox(){
      try{
        const config=await window.homebridge.getPluginConfig();
        const el=document.getElementById('autoStopDiscovery');
        if(el&&config?.[0]) el.checked=config[0].autoStopDiscoveryWhenAllConfigured!==false;
      }catch(_){}
    }
    async function saveAutoStopDiscovery(){
      try{
        await mutateConfig(c=>{ c[0].autoStopDiscoveryWhenAllConfigured=document.getElementById('autoStopDiscovery').checked; },
          {toast:'Discovery preference updated.', title:'Settings'});
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    function maybeAutoLoadPresets(index){
      const c=document.getElementById(`inline-presets-${index}`);
      if(!c||c.dataset.loaded==='1'||c.dataset.enabled!=='1') return;
      const host=c.dataset.host, port=parseInt(c.dataset.port,10)||80, name=c.dataset.name||'';
      if(host) loadInlinePresets(index, host, port, name);
    }
    function setDiscoveryProgress(foundCount, done=false){
      const wrap=document.getElementById('discoveryProgress');
      const bar=document.getElementById('discoveryProgressBar');
      const status=document.getElementById('discoveryStatusText');
      const count=document.getElementById('discoveryCountText');
      if(!wrap) return;
      wrap.classList.remove('d-none');
      lastDiscoveryFoundCount=foundCount;
      const pct=done?100:Math.min(95, Math.round(((Date.now()-(discoveryStartTime||Date.now()))/70000)*100));
      if(bar){ bar.style.width=pct+'%'; bar.classList.toggle('progress-bar-animated',!done); bar.classList.toggle('progress-bar-striped',!done); }
      if(status) status.textContent=done?'Scan complete':'Scanning…';
      if(count) count.textContent=`${foundCount} found`;
    }
    function getDevicesArray(config){
      if(!config?.[0]) return null;
      if(config[0].manualDevicesSection?.devices) return config[0].manualDevicesSection.devices;
      if(config[0].devices) return config[0].devices;
      return null;
    }
    async function mutateDevice(index, mutator, opts={}){
      const config=await window.homebridge.getPluginConfig();
      const devices=getDevicesArray(config);
      if(!devices?.[index]) throw new Error('Device not found');
      if(!devices[index].deviceSettings) devices[index].deviceSettings={};
      const result=await mutator(devices[index], devices, config);
      await window.homebridge.updatePluginConfig(config);
      if(opts.actionToast) await notifyAction(opts.actionToast, opts.toastTitle||'Done');
      else markRestartNeeded();
      return {config, devices, device:devices[index], result};
    }
    async function mutateConfig(mutator, opts={}){
      const config=await window.homebridge.getPluginConfig();
      const result=await mutator(config);
      await window.homebridge.updatePluginConfig(config);
      markRestartNeeded();
      if(opts.toast) await window.homebridge.toast.success(withSaveHint(opts.toast), opts.title||'Updated');
      return {config, result};
    }
    const NIGHTLIGHT_TIMER_MAX=8;
    const NIGHTLIGHT_TIMER_PRESETS=[
      { label:'5 min', name:'5 min', seconds:300 },
      { label:'10 min', name:'10 min', seconds:600 },
      { label:'15 min', name:'15 min', seconds:900 },
      { label:'30 min', name:'30 min', seconds:1800 },
      { label:'1 hour', name:'1 hour', seconds:3600 },
    ];

    function normalizeTimerName(name){
      return String(name||'').trim().toLowerCase();
    }
    function timerSecondsInputValue(seconds){
      if(seconds==null||seconds==='') return '';
      const n=parseInt(String(seconds),10);
      return Number.isFinite(n)&&n>0?String(n):'';
    }
    function getTimerOverlapInfo(timers, candidate, excludeIndex=-1){
      const nameKey=normalizeTimerName(candidate.name);
      const sec=parseInt(String(candidate.seconds),10);
      const nameMatches=[];
      const secMatches=[];
      (timers||[]).forEach((t,i)=>{
        if(i===excludeIndex) return;
        if(normalizeTimerName(t.name)===nameKey) nameMatches.push(i+1);
        if(Number.isFinite(sec)&&sec>0&&parseInt(String(t.seconds),10)===sec) secMatches.push(i+1);
      });
      return { nameMatches, secMatches };
    }
    const timerOverlapAlerts={};
    function timerOverlapAlertId(context){
      return context==='global'?'globalNightlightTimerAlert':`nightlight-timer-alert-${context}`;
    }
    function dismissTimerOverlapAlert(context){
      delete timerOverlapAlerts[context];
      applyTimerOverlapAlert(context);
    }
    function buildTimerOverlapMessage(timers, candidate, excludeIndex=-1){
      const { nameMatches, secMatches }=getTimerOverlapInfo(timers, candidate, excludeIndex);
      if(!nameMatches.length&&!secMatches.length) return null;
      const parts=[];
      if(nameMatches.length){
        const label=(candidate.name||'').trim()||'(empty name)';
        parts.push(`Same name (“${label}”) as timer #${nameMatches.join(', #')}`);
      }
      if(secMatches.length) parts.push(`Same duration (${candidate.seconds} sec) as timer #${secMatches.join(', #')}`);
      return `${parts.join('. ')}. Duplicates are allowed, but HomeKit may show identical switches.`;
    }
    function applyTimerOverlapAlert(context){
      const el=document.getElementById(timerOverlapAlertId(context));
      if(!el) return;
      const text=timerOverlapAlerts[context];
      if(!text){
        el.innerHTML='';
        el.hidden=true;
        return;
      }
      const dismissArg=context==='global'?'\'global\'':String(context);
      el.hidden=false;
      el.innerHTML=`<div class="alert alert-warning alert-dismissible fade show timer-overlap-alert-inner py-2 mb-2" role="alert">
        <strong>Timer overlap.</strong> ${escapeHtml(text)}
        <button type="button" class="btn-close btn-close-sm" aria-label="Close" onclick="dismissTimerOverlapAlert(${dismissArg})"></button>
      </div>`;
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function showTimerOverlapAlert(context, message){
      if(message) timerOverlapAlerts[context]=message;
      else delete timerOverlapAlerts[context];
      applyTimerOverlapAlert(context);
    }
    function notifyTimerOverlaps(timers, candidate, excludeIndex=-1, context){
      const body=buildTimerOverlapMessage(timers, candidate, excludeIndex);
      if(context!=null) showTimerOverlapAlert(context, body);
      return body;
    }
    function refreshTimerOverlapAlert(timers, context){
      const list=timers||[];
      for(let i=0;i<list.length;i++){
        const body=buildTimerOverlapMessage(list, list[i], i);
        if(body){
          showTimerOverlapAlert(context, body);
          return;
        }
      }
      showTimerOverlapAlert(context, null);
    }
    async function checkTimerLimit(timers){
      if((timers?.length||0)>=NIGHTLIGHT_TIMER_MAX){
        await window.homebridge.toast.warning(
          `Maximum of ${NIGHTLIGHT_TIMER_MAX} nightlight timers allowed. Remove one before adding another.`,
          'Timer limit',
        );
        return false;
      }
      return true;
    }
    function renderTimerPresetBar(context, timerCount){
      const atLimit=timerCount>=NIGHTLIGHT_TIMER_MAX;
      const disabled=atLimit?' disabled':'';
      const presetBtns=NIGHTLIGHT_TIMER_PRESETS.map(p=>{
        const safeName=p.name.replace(/'/g,"\\'");
        const onclick=context==='global'
          ? `addGlobalNightlightTimerPreset(${p.seconds},'${safeName}')`
          : `addNightlightTimerPreset(${context},${p.seconds},'${safeName}')`;
        return `<button type="button" class="btn btn-outline-secondary btn-sm timer-preset-btn"${disabled} onclick="${onclick}">${p.label}</button>`;
      }).join('');
      const customOnclick=context==='global'?'addGlobalNightlightTimerCustom()':`addNightlightTimerCustom(${context})`;
      return `<div class="timer-preset-bar">
        <span class="grey-text small timer-preset-label">Quick add:</span>
        <div class="timer-preset-btns">${presetBtns}</div>
        <button type="button" class="btn btn-primary btn-sm"${disabled} onclick="${customOnclick}">Custom timer</button>
      </div>
      <div class="grey-text small mt-1">${timerCount}/${NIGHTLIGHT_TIMER_MAX} timers</div>`;
    }

    function renderTimersHtml(timers, opts={}){
      const {linked=false, emptyText=linked?'No global timers.':'No timers yet.', onName, onSeconds, onRemove}=opts;
      if(!timers?.length) return `<div class="small text-muted fst-italic">${emptyText}</div>`;
      return timers.map((t,tIndex)=>`
        <div class="row g-2 align-items-end mb-2">
          <div class="col"><label class="form-label small mb-1">Name</label>
            <input type="text" class="form-control form-control-sm" value="${(t.name||'').replace(/"/g,'&quot;')}" placeholder="e.g. 5 min" ${linked?'disabled':`onchange="${onName(tIndex)}"`}></div>
          <div class="col-3"><label class="form-label small mb-1">Sec</label>
            <input type="number" class="form-control form-control-sm" min="1" value="${timerSecondsInputValue(t.seconds)}" placeholder="300" ${linked?'disabled':`onchange="${onSeconds(tIndex)}"`}></div>
          ${linked||!onRemove?'':`<div class="col-auto"><button class="btn btn-outline-danger btn-sm" onclick="${onRemove(tIndex)}">Remove</button></div>`}
        </div>`).join('');
    }
    function deviceTimersHtml(timers, linked, idx){
      return renderTimersHtml(timers,{linked,
        onName:i=>`updateNightlightTimerName(${idx},${i},this.value)`,
        onSeconds:i=>`updateNightlightTimerSeconds(${idx},${i},this.value)`,
        onRemove:i=>`removeNightlightTimer(${idx},${i})`});
    }
    function setDevicesTabCount(count){
      const tabBtn=document.getElementById('menuDevices');
      if(tabBtn) tabBtn.textContent=count>0?`Devices (${count})`:'Devices';
    }
    function nightlightModeOf(device){
      if(!device.deviceSettings?.nightlight) return 'defaults';
      return device.deviceSettings.nightlight.enabled===true?'custom':'off';
    }
    function deviceInfoBits(device){
      const bits=[];
      if(device.firmwareVersion) bits.push(`v${device.firmwareVersion}`);
      if(device.ledCount) bits.push(`${device.ledCount} LEDs`);
      if(device.macAddress) bits.push(String(device.macAddress));
      return bits.join(' · ');
    }

    function hbSettingRow(title, help, controlHtml){
      return `<li class="list-group-item">
        <div class="d-flex justify-content-between align-items-center gap-3">
          <span>${title}${help?`<br><small class="grey-text pe-2">${help}</small>`:''}</span>
          <div class="flex-shrink-0 d-flex align-items-center">${controlHtml}</div>
        </div>
      </li>`;
    }
    function hbSettingsSection(title, rowsHtml, attrs=''){
      return `<div class="hb-settings-block" ${attrs}>
        <h5 class="primary-text hb-section-title">${title}</h5>
        <ul class="list-group list-group-box mt-2 mx-0">${rowsHtml}</ul>
      </div>`;
    }
    function hbSwitch(attrs){
      return `<div class="form-check form-switch m-0"><input class="form-check-input" role="switch" type="checkbox" ${attrs}></div>`;
    }

    function renderNightlightBlock(index, mode, timers, globalNightlight){
      const showTimers=mode==='custom';
      const linked=mode==='defaults';
      const defaultsOn=globalNightlight?.enabled===true;
      const defaultsSummary=linked
        ? (defaultsOn
          ? `Using plugin defaults (${(globalNightlight.timers||[]).length||0} timer${(globalNightlight.timers||[]).length===1?'':'s'}). Edit them under Settings → Nightlight defaults.`
          : 'Using plugin defaults (currently off). Enable them under Settings → Nightlight defaults.')
        : 'Off disables nightlight for this device. Custom lets you define timers only for this device.';
      return hbSettingsSection('Nightlight', `
        ${hbSettingRow(
          'Mode',
          defaultsSummary,
          `<select class="form-select form-select-sm hb-input-sm" style="max-width:10.5rem" onchange="setNightlightMode(${index}, this.value)">
            <option value="off" ${mode==='off'?'selected':''}>Off</option>
            <option value="defaults" ${mode==='defaults'?'selected':''}>Use defaults</option>
            <option value="custom" ${mode==='custom'?'selected':''}>Custom</option>
          </select>`
        )}
        <li class="list-group-item ${showTimers?'':'d-none'}" id="nightlight-details-${index}">
          <small class="grey-text pe-2">Timers turn the nightlight on/off at set times for this device (max ${NIGHTLIGHT_TIMER_MAX}).</small>
          <div class="hb-nested-fields mt-2">
            <div id="nightlight-timer-alert-${index}" class="timer-overlap-alert" hidden></div>
            <div id="nightlight-timers-${index}">${deviceTimersHtml(timers, false, index)}</div>
            <div id="nightlight-timer-controls-${index}">${renderTimerPresetBar(index, (timers||[]).length)}</div>
          </div>
        </li>
      `, `id="nightlight-section-${index}"`);
    }
    function renderHyperHDRBlock(index, device){
      const enabled=device.deviceSettings?.hyperHDR?.enabled===true;
      const cfg=device.deviceSettings?.hyperHDR||{};
      return hbSettingsSection('Integrations', `
        ${hbSettingRow(
          'HyperHDR sync',
          'Mirror this device\'s power on/off to a HyperHDR instance so Ambilight stays in sync with the strip.',
          hbSwitch(`${enabled?'checked':''} onchange="toggleHyperHDREnabled(${index}, this.checked)"`)
        )}
        ${enabled?`
        <li class="list-group-item">
          <small class="grey-text pe-2">Connection details for the HyperHDR JSON API. Leave the token blank if authentication is disabled.</small>
          <div class="hb-nested-fields mt-2">
            <div class="row g-2 align-items-end">
              <div class="col"><label class="form-label" for="hh-host-${index}">Host</label>
                <input id="hh-host-${index}" type="text" class="form-control form-control-sm" value="${(cfg.host||'').replace(/"/g,'&quot;')}" placeholder="192.168.1.x" onchange="updateHyperHDRField(${index},'host',this.value)"></div>
              <div class="col-3"><label class="form-label" for="hh-port-${index}">Port</label>
                <input id="hh-port-${index}" type="number" class="form-control form-control-sm" min="1" max="65535" value="${cfg.port||8090}" onchange="updateHyperHDRField(${index},'port',parseInt(this.value))"></div>
            </div>
            <div class="row g-2 align-items-end">
              <div class="col"><label class="form-label" for="hh-comp-${index}">Component</label>
                <select id="hh-comp-${index}" class="form-select form-select-sm" onchange="updateHyperHDRField(${index},'component',this.value)">
                  <option value="LEDDEVICE" ${(cfg.component||'LEDDEVICE')==='LEDDEVICE'?'selected':''}>LEDDEVICE</option>
                  <option value="ALL" ${cfg.component==='ALL'?'selected':''}>ALL</option></select></div>
              <div class="col"><label class="form-label" for="hh-token-${index}">Token</label>
                <input id="hh-token-${index}" type="password" class="form-control form-control-sm" value="${(cfg.token||'').replace(/"/g,'&quot;')}" placeholder="optional" onchange="updateHyperHDRField(${index},'token',this.value)"></div>
            </div>
            <div class="row g-2 align-items-end">
              <div class="col"><label class="form-label" for="hh-type-${index}">HomeKit type</label>
                <select id="hh-type-${index}" class="form-select form-select-sm" onchange="updateHyperHDRField(${index},'serviceType',this.value)">
                  <option value="Switch" ${(cfg.serviceType||'Switch')==='Switch'?'selected':''}>Switch</option>
                  <option value="Outlet" ${cfg.serviceType==='Outlet'?'selected':''}>Outlet</option></select></div>
              <div class="col"><label class="form-label" for="hh-name-${index}">Name</label>
                <input id="hh-name-${index}" type="text" class="form-control form-control-sm" value="${(cfg.switchName||'HyperHDR').replace(/"/g,'&quot;')}" onchange="updateHyperHDRField(${index},'switchName',this.value)"></div>
              <div class="col-3"><label class="form-label" for="hh-poll-${index}">Poll (sec)</label>
                <input id="hh-poll-${index}" type="number" class="form-control form-control-sm" min="0" max="300" value="${cfg.pollInterval||''}" placeholder="off" onchange="updateHyperHDRField(${index},'pollInterval',this.value?parseInt(this.value):undefined)"></div>
            </div>
            <div class="d-flex align-items-center gap-2">
              <button type="button" class="btn btn-primary btn-sm" onclick="testHyperHDR(${index})">Test connection</button>
              <span class="grey-text" id="hyperhdr-test-${index}"></span>
            </div>
          </div>
        </li>`:''}
      `, `id="hyperhdr-section-${index}"`);
    }

    async function loadConfiguredDevices(){
      const deviceList=document.getElementById('configuredDeviceList');
      deviceList.innerHTML=`<div class="skeleton-stack" aria-busy="true" aria-label="Loading devices">
        <div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>
      </div>`;
      try{
        const configPromise=window.homebridge.getPluginConfig();
        const cachedPromise=window.homebridge.request('/cached-accessories').catch(()=>({accessories:[]}));
        const timeoutPromise=new Promise(r=>setTimeout(()=>r([null,{accessories:[]}]),5000));
        const [configData, cachedData]=await Promise.race([Promise.all([configPromise,cachedPromise]), timeoutPromise])||[null,{accessories:[]}];
        currentConfig=configData;
        let configDevices=[];
        if(configData?.[0]){
          const pc=configData[0];
          if(pc.manualDevicesSection?.devices) configDevices=pc.manualDevicesSection.devices;
          else if(pc.devices) configDevices=pc.devices;
        }
        setDevicesTabCount(configDevices.length);
        const allDevices=[...configDevices];
        for(const cached of (cachedData.accessories||[])){
          if(!configDevices.some(d=>d.host===cached.host||d.name===cached.name)) allDevices.push({...cached,isCached:true});
        }
        if(!allDevices.length){
          deviceList.innerHTML=`<div class="empty-state">
            <p class="text-muted mb-3">No devices yet. Scan the network or add one by IP.</p>
            <button class="btn btn-primary btn-sm" type="button" onclick="toggleAddPanel(true)">Add device</button>
          </div>`;
          return;
        }
        const globalNightlight=configData?.[0]?.manualDevicesSection?.nightlight||{enabled:false,timers:[]};
        deviceList.innerHTML=allDevices.map((device,index)=>{
          if(!device||typeof device!=='object'){
            return `<div class="card mb-3 border-danger"><div class="card-body"><div class="fw-semibold">Invalid device</div>
              <button class="btn btn-outline-danger btn-sm mt-2" onclick="removeDevice(${index},'Invalid Device')">Remove</button></div></div>`;
          }
          const enabled=device.enabled!==false, isCached=device.isCached===true;
          const deviceName=device.name||'Unnamed Device', deviceHost=device.host||'Unknown', devicePort=device.port||80;
          const usePresetService=device.deviceSettings?.usePresetService!==false;
          const useWebSockets=device.deviceSettings?.useWebSockets!==false;
          const nlMode=nightlightModeOf(device);
          const nightlight=nlMode==='defaults'?globalNightlight:(device.deviceSettings?.nightlight||{});
          const nightlightTimers=Array.isArray(nightlight.timers)?nightlight.timers:[];
          const safeName=deviceName.replace(/'/g,"\\'");
          const infoBits=deviceInfoBits(device);
          const moreHtml=`${isCached?'':`
            ${hbSettingsSection('Connection', `
              ${hbSettingRow(
                'WebSockets',
                'Use WebSockets for real-time updates from the device. Requires WLED v0.13 or newer. When off, the plugin polls over HTTP instead.',
                hbSwitch(`${useWebSockets?'checked':''} onchange="toggleUseWebSockets(${index},this.checked)"`)
              )}
              <li class="list-group-item ${useWebSockets?'d-none':''}" id="poll-field-${index}">
                <div class="d-flex justify-content-between align-items-center gap-3">
                  <span>Poll interval (sec)<br><small class="grey-text pe-2">How often to refresh device state over HTTP when WebSockets are disabled. Values between 2 and 300 seconds.</small></span>
                  <input id="poll-input-${index}" type="number" class="form-control form-control-sm hb-input-sm flex-shrink-0" min="2" max="300"
                         value="${device.deviceSettings?.pollInterval||10}" onchange="updatePollInterval(${index},this.value)" aria-label="Poll interval">
                </div>
              </li>
            `)}
            ${hbSettingsSection('HomeKit accessories', `
              ${hbSettingRow(
                'Single accessory',
                'Combine the light and presets into one HomeKit Television accessory instead of separate accessories. Changing this may require a Homebridge restart.',
                hbSwitch(`${device.deviceSettings?.singleAccessoryWithTV===true?'checked':''} onchange="toggleSingleAccessoryWithTV(${index},this.checked)"`)
              )}
              ${hbSettingRow(
                'Expose segments',
                'Create a separate Light accessory for each WLED segment after the first (up to 8). Useful when segments are used as independent zones.',
                hbSwitch(`${device.deviceSettings?.exposeSegments===true?'checked':''} onchange="toggleDeviceFlag(${index},'exposeSegments',this.checked)"`)
              )}
              ${hbSettingRow(
                'Expose effects',
                'Expose WLED effects as Switch accessories in HomeKit so you can trigger them from scenes and automations (up to 20).',
                hbSwitch(`${device.deviceSettings?.exposeEffects===true?'checked':''} onchange="toggleDeviceFlag(${index},'exposeEffects',this.checked)"`)
              )}
            `)}`}
            ${renderNightlightBlock(index,nlMode,nightlightTimers,globalNightlight)}
            ${isCached?'':renderHyperHDRBlock(index,device)}`;
          return `<div class="card device-card ${enabled?'is-on':'is-off'}" id="device-card-${index}">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-start gap-2">
                <div class="d-flex align-items-start gap-2 min-w-0">
                  ${isCached?'<span class="badge text-bg-warning mt-1">Cached</span>':
                    `<div class="form-check form-switch m-0 mt-1"><input class="form-check-input device-enable-switch" role="switch" type="checkbox" ${enabled?'checked':''} onchange="toggleDevice(${index},this.checked)" title="${enabled?'Enabled':'Disabled'}" aria-label="Enable ${escapeHtml(deviceName)}"></div>`}
                  <div class="min-w-0 device-dim">
                    <div class="d-flex align-items-center gap-2">
                      <div class="device-name text-truncate" id="device-name-${index}">${escapeHtml(deviceName)}</div>
                      ${isCached?'':`<div class="device-status mb-0" id="device-status-${index}" title="Checking…"><i class="fas fa-lg fa-circle-notch fa-spin grey-text" aria-hidden="true"></i></div>`}
                    </div>
                    <div class="device-host text-truncate">${escapeHtml(deviceHost)}:${devicePort}</div>
                    ${infoBits?`<div class="device-meta text-truncate" title="${escapeHtml(infoBits)}">${escapeHtml(infoBits)}</div>`:''}
                    <div id="device-sync-warn-${index}" class="d-none mt-2"></div>
                  </div>
                </div>
                <div class="d-flex gap-0 align-items-center flex-shrink-0">
                  ${isCached?'':`<div class="dropdown">
                    <button class="btn btn-link btn-sm btn-tool" data-bs-toggle="dropdown" title="More" aria-label="More actions"><i class="fas fa-ellipsis-vertical"></i></button>
                    <ul class="dropdown-menu dropdown-menu-end">
                      <li><a class="dropdown-item" href="#" onclick="event.preventDefault();renameDevice(${index},'${safeName}')"><i class="fas fa-pen me-2"></i>Rename</a></li>
                      <li><a class="dropdown-item" href="#" onclick="event.preventDefault();resetDeviceSettings(${index},'${safeName}')"><i class="fas fa-undo me-2"></i>Reset to defaults</a></li>
                      <li><hr class="dropdown-divider"></li>
                      <li><a class="dropdown-item text-danger" href="#" onclick="event.preventDefault();removeDevice(${index},'${safeName}')"><i class="fas fa-trash me-2"></i>Remove</a></li>
                    </ul></div>`}
                  ${isCached?'':`<button id="device-expand-${index}" class="btn btn-link btn-sm btn-tool device-expand-btn" onclick="toggleDeviceDetails(${index})" type="button" title="Configure" aria-label="Configure" aria-expanded="false" aria-controls="device-details-${index}"><i class="fas fa-chevron-down"></i></button>`}
                </div>
              </div>
              ${isCached?`<div class="alert alert-warning mb-0 py-2 small mt-2">Cached by Homebridge but not in config. Re-add to manage here.</div>`:`
              <div id="device-details-${index}" class="collapse">
                <div class="device-config">
                  ${hbSettingsSection('Presets', `
                    ${hbSettingRow(
                      'Presets in HomeKit',
                      usePresetService
                        ? 'Expose WLED presets as Television inputs in HomeKit. Choose which presets appear below.'
                        : 'Turn this on to expose WLED presets as a HomeKit accessory (Television inputs) so you can pick scenes from the Home app.',
                      hbSwitch(`${usePresetService?'checked':''} onchange="toggleUsePresetService(${index},this.checked)" aria-label="Presets in HomeKit"`)
                    )}
                    <li class="list-group-item ${usePresetService?'':'d-none'}" id="inline-presets-wrap-${index}">
                      <small class="grey-text pe-2">Select the presets that should appear as inputs. Unchecked presets stay on the device but are hidden from HomeKit.</small>
                      <div class="mt-2" id="inline-presets-${index}" data-host="${escapeHtml(deviceHost)}" data-port="${devicePort}" data-name="${escapeHtml(deviceName)}" data-enabled="${usePresetService?'1':'0'}">
                        <p class="grey-text mb-0">Loading presets…</p>
                      </div>
                    </li>
                  `)}
                  <div id="more-options-${index}">${moreHtml}</div>
                </div>
              </div>`}
            </div></div>`;
        }).join('');
        allDevices.forEach((device,idx)=>{ if(!device.isCached&&device.host) checkDeviceReachability(idx,device.host,device.port||80); });
      }catch(error){
        console.error('[UI] Error loading devices:', error);
        deviceList.innerHTML=`<div class="alert alert-warning"><strong>Failed to load:</strong> ${escapeHtml(error.message)}</div>`;
      }
    }

    function setDeviceStatus(index, state, title){
      const indicator=document.getElementById(`device-status-${index}`);
      if(!indicator) return;
      const icons={
        checking:'fas fa-lg fa-circle-notch fa-spin grey-text',
        online:'fas fa-lg fa-check-circle green-text',
        offline:'fas fa-lg fa-times-circle red-text',
      };
      indicator.title=title||({checking:'Checking…',online:'Online',offline:'Offline'}[state]||'');
      indicator.innerHTML=`<i class="${icons[state]||icons.checking}" aria-hidden="true"></i>`;
    }
    function renderSyncWarning(index, host, port, sync){
      const el=document.getElementById(`device-sync-warn-${index}`);
      if(!el) return;
      const sendEnabled=sync?.sendEnabled===true;
      const recvEnabled=sync?.recvEnabled===true;
      if(!sendEnabled&&!recvEnabled){
        el.className='d-none mt-2';
        el.innerHTML='';
        return;
      }
      const parts=[];
      if(sendEnabled) parts.push('sending');
      if(recvEnabled) parts.push('receiving');
      const grp=typeof sync?.group==='number'?` (group ${sync.group})`:'';
      el.className='alert alert-warning mb-0 py-2 small mt-2';
      el.innerHTML=`<div class="d-flex justify-content-between align-items-start gap-2">
        <div><strong>WLED UDP Sync is ${parts.join(' &amp; ')}${grp}.</strong>
          Turning this light on/off can control other WLED devices in the same sync group.
          Disable sync here or in the WLED web UI if you want independent lights.</div>
        <button type="button" class="btn btn-outline-warning btn-sm flex-shrink-0" onclick="disableDeviceSync(${index},'${String(host).replace(/'/g,"\\'")}',${port||80})">Disable sync</button>
      </div>`;
    }
    async function disableDeviceSync(index, host, port){
      try{
        const response=await window.homebridge.request('/disable-sync',{host,port:port||80});
        if(response?.status==='ok'){
          await window.homebridge.toast.success(response.message||'Sync disabled','UDP Sync');
          renderSyncWarning(index, host, port, response.sync||{sendEnabled:false,recvEnabled:false});
        }else{
          await window.homebridge.toast.error(response?.message||'Failed to disable sync','UDP Sync');
        }
      }catch(e){
        await window.homebridge.toast.error(e.message||'Failed to disable sync','UDP Sync');
      }
    }
    async function checkDeviceReachability(index, host, port){
      const indicator=document.getElementById(`device-status-${index}`);
      if(!indicator) return;
      setDeviceStatus(index,'checking','Checking…');
      try{
        const response=await window.homebridge.request('/ping-device',{host,port:port||80});
        const online=response&&response.online===true;
        setDeviceStatus(index, online?'online':'offline', online?'Online':(response?.message||'Offline'));
        if(online) renderSyncWarning(index, host, port||80, response.sync);
        else renderSyncWarning(index, host, port||80, null);
      }catch{
        setDeviceStatus(index,'offline','Offline');
        renderSyncWarning(index, host, port||80, null);
      }
    }
    function setDeviceExpanded(index, open){
      const el=document.getElementById(`device-details-${index}`);
      const btn=document.getElementById(`device-expand-${index}`);
      if(!el) return;
      // Bootstrap Collapse CSS (.collapse / .show) is injected by Homebridge; no Bootstrap JS needed.
      el.classList.toggle('show', open);
      if(btn) btn.setAttribute('aria-expanded', open?'true':'false');
    }
    function toggleDeviceDetails(index){
      const card=document.getElementById(`device-card-${index}`);
      if(card?.classList.contains('is-off')) return;
      const el=document.getElementById(`device-details-${index}`);
      if(!el) return;
      const willOpen=!el.classList.contains('show');
      setDeviceExpanded(index, willOpen);
      if(willOpen) maybeAutoLoadPresets(index);
    }
    async function toggleDevice(index, enabled){
      try{
        await mutateDevice(index,d=>{d.enabled=enabled;});
        const card=document.getElementById(`device-card-${index}`)
          || document.getElementById(`device-name-${index}`)?.closest('.device-card');
        if(card){ card.classList.toggle('is-on',enabled); card.classList.toggle('is-off',!enabled); }
        const sw=card?.querySelector('.device-enable-switch');
        if(sw) sw.title=enabled?'Enabled':'Disabled';
        if(!enabled) setDeviceExpanded(index, false);
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function toggleSingleAccessoryWithTV(index, enabled){
      try{
        const {device}=await mutateDevice(index,d=>{d.deviceSettings.singleAccessoryWithTV=enabled;});
        if(device?.host) await window.homebridge.request('/remove-cached-accessory',{host:device.host}).catch(()=>{});
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function toggleUseWebSockets(index, enabled){
      try{
        await mutateDevice(index,d=>{d.deviceSettings.useWebSockets=enabled;});
        document.getElementById(`poll-field-${index}`)?.classList.toggle('d-none', enabled);
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function updatePollInterval(index, value){
      try{
        await mutateDevice(index,d=>{
          const poll=parseInt(value,10);
          d.deviceSettings.pollInterval=Number.isFinite(poll)?Math.min(300,Math.max(2,poll)):10;
        });
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function toggleUsePresetService(index, enabled){
      try{
        await mutateDevice(index,d=>{d.deviceSettings.usePresetService=enabled;});
        document.getElementById(`inline-presets-wrap-${index}`)?.classList.toggle('d-none', !enabled);
        const presetHelp=document.querySelector(`#device-details-${index} .hb-settings-block:first-child .list-group-item:first-child .grey-text`);
        if(presetHelp) presetHelp.textContent=enabled
          ? 'Expose WLED presets as Television inputs in HomeKit. Choose which presets appear below.'
          : 'Turn this on to expose WLED presets as a HomeKit accessory (Television inputs) so you can pick scenes from the Home app.';
        const c=document.getElementById(`inline-presets-${index}`);
        if(c){ c.dataset.enabled=enabled?'1':'0'; c.dataset.loaded='';
          if(enabled) maybeAutoLoadPresets(index);
          else c.innerHTML='<p class="grey-text mb-0">Loading presets…</p>';
        }
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function toggleDeviceFlag(index, flag, enabled){
      try{ await mutateDevice(index,d=>{d.deviceSettings[flag]=enabled;}); }
      catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function toggleHyperHDREnabled(index, enabled){
      try{
        const {device}=await mutateDevice(index,d=>{
          if(!d.deviceSettings.hyperHDR) d.deviceSettings.hyperHDR={enabled:false,host:'',port:8090,component:'LEDDEVICE'};
          d.deviceSettings.hyperHDR.enabled=enabled;
        });
        const section=document.getElementById(`hyperhdr-section-${index}`);
        if(section) section.outerHTML=renderHyperHDRBlock(index, device);
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function updateHyperHDRField(index, field, value){
      try{
        await mutateDevice(index,d=>{
          if(!d.deviceSettings.hyperHDR) d.deviceSettings.hyperHDR={enabled:true,host:'',port:8090,component:'LEDDEVICE'};
          d.deviceSettings.hyperHDR[field]=value;
        });
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function testHyperHDR(index){
      const status=document.getElementById(`hyperhdr-test-${index}`);
      try{
        const config=await window.homebridge.getPluginConfig();
        const cfg=getDevicesArray(config)?.[index]?.deviceSettings?.hyperHDR||{};
        if(status) status.textContent='Testing…';
        const response=await window.homebridge.request('/ping-hyperhdr',{host:cfg.host,port:cfg.port||8090,token:cfg.token,component:cfg.component||'LEDDEVICE'});
        if(response?.online){ if(status) status.textContent='Online'; await window.homebridge.toast.success('HyperHDR reachable','Test OK'); }
        else { if(status) status.textContent=response?.message||'Offline'; await window.homebridge.toast.error(response?.message||'Unreachable','Test failed'); }
      }catch(e){ if(status) status.textContent=e.message; await window.homebridge.toast.error(e.message,'Test failed'); }
    }
    async function setNightlightMode(index, mode){
      try{
        const {device, config}=await mutateDevice(index,(d,_devs,cfg)=>{
          const globalNl=cfg?.[0]?.manualDevicesSection?.nightlight||{enabled:false,timers:[]};
          if(mode==='defaults') delete d.deviceSettings.nightlight;
          else if(mode==='off') d.deviceSettings.nightlight={enabled:false,timers:d.deviceSettings.nightlight?.timers||[]};
          else {
            const timers=d.deviceSettings.nightlight?.timers?.length
              ? d.deviceSettings.nightlight.timers
              : JSON.parse(JSON.stringify(globalNl.timers||[]));
            d.deviceSettings.nightlight={enabled:true,timers};
          }
        });
        const globalNl=config?.[0]?.manualDevicesSection?.nightlight||{enabled:false,timers:[]};
        const section=document.getElementById(`nightlight-section-${index}`);
        if(section){
          const modeNow=nightlightModeOf(device);
          const nl=modeNow==='defaults'?globalNl:(device.deviceSettings?.nightlight||{});
          section.outerHTML=renderNightlightBlock(index, modeNow, nl.timers||[], globalNl);
        }
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    function renderNightlightTimers(index, timers){
      const list=document.getElementById(`nightlight-timers-${index}`);
      const controls=document.getElementById(`nightlight-timer-controls-${index}`);
      const t=timers||[];
      if(list) list.innerHTML=deviceTimersHtml(t,false,index);
      if(controls) controls.innerHTML=renderTimerPresetBar(index, t.length);
      refreshTimerOverlapAlert(t, index);
    }
    async function addNightlightTimerPreset(index, seconds, name){
      try{
        const {device}=await mutateDevice(index,async d=>{
          if(!d.deviceSettings.nightlight) d.deviceSettings.nightlight={enabled:true,timers:[]};
          d.deviceSettings.nightlight.enabled=true;
          const timers=d.deviceSettings.nightlight.timers||(d.deviceSettings.nightlight.timers=[]);
          if(!(await checkTimerLimit(timers))) throw new Error('__limit');
          const newTimer={ name, seconds };
          await notifyTimerOverlaps(timers, newTimer, -1, index);
          timers.push(newTimer);
        });
        if(device) renderNightlightTimers(index, device.deviceSettings.nightlight.timers);
      }catch(e){ if(e.message!=='__limit') await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function addNightlightTimerCustom(index){
      try{
        const {device}=await mutateDevice(index,async d=>{
          if(!d.deviceSettings.nightlight) d.deviceSettings.nightlight={enabled:true,timers:[]};
          d.deviceSettings.nightlight.enabled=true;
          const timers=d.deviceSettings.nightlight.timers||(d.deviceSettings.nightlight.timers=[]);
          if(!(await checkTimerLimit(timers))) throw new Error('__limit');
          const newTimer={ name:'', seconds:null };
          await notifyTimerOverlaps(timers, newTimer, -1, index);
          timers.push(newTimer);
        });
        if(device) renderNightlightTimers(index, device.deviceSettings.nightlight.timers);
      }catch(e){ if(e.message!=='__limit') await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function removeNightlightTimer(index, timerIndex){
      try{
        const {device}=await mutateDevice(index,d=>{
          const nl=d.deviceSettings?.nightlight; if(!nl?.timers?.[timerIndex]) return;
          nl.timers.splice(timerIndex,1);
        });
        renderNightlightTimers(index, device.deviceSettings?.nightlight?.timers||[]);
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function updateNightlightTimerName(index, timerIndex, name){
      try{
        const {device}=await mutateDevice(index,d=>{
          const nl=d.deviceSettings?.nightlight;
          if(!nl?.timers?.[timerIndex]) return;
          nl.timers[timerIndex].name=(name||'').trim();
        });
        const timers=device?.deviceSettings?.nightlight?.timers||[];
        refreshTimerOverlapAlert(timers, index);
      }catch(_){}
    }
    async function updateNightlightTimerSeconds(index, timerIndex, seconds){
      try{
        const raw=(seconds??'').toString().trim();
        if(!raw){
          const {device}=await mutateDevice(index,d=>{
            const nl=d.deviceSettings?.nightlight;
            if(!nl?.timers?.[timerIndex]) return;
            nl.timers[timerIndex].seconds=null;
          });
          refreshTimerOverlapAlert(device?.deviceSettings?.nightlight?.timers||[], index);
          return;
        }
        const value=parseInt(raw,10);
        if(!Number.isFinite(value)||value<=0){
          await window.homebridge.toast.warning('Timer duration must be a positive number of seconds.','Invalid duration');
          const config=await window.homebridge.getPluginConfig();
          const timers=getDevicesArray(config)?.[index]?.deviceSettings?.nightlight?.timers||[];
          renderNightlightTimers(index, timers);
          return;
        }
        const {device}=await mutateDevice(index,d=>{
          const nl=d.deviceSettings?.nightlight;
          if(!nl?.timers?.[timerIndex]) return;
          nl.timers[timerIndex].seconds=value;
        });
        const timers=device?.deviceSettings?.nightlight?.timers||[];
        refreshTimerOverlapAlert(timers, index);
      }catch(_){}
    }
    async function renameDevice(index, currentName){
      const nameEl=document.getElementById(`device-name-${index}`);
      if(!nameEl) return;
      nameEl.outerHTML=`<input id="device-rename-input-${index}" type="text" class="form-control form-control-sm" style="max-width:180px;" value="${currentName.replace(/"/g,'&quot;')}">
        <button class="btn btn-primary btn-sm" onclick="saveDeviceRename(${index})">Save</button>
        <button class="btn btn-outline-secondary btn-sm" onclick="loadConfiguredDevices()">Cancel</button>`;
      document.getElementById(`device-rename-input-${index}`)?.focus();
    }
    async function saveDeviceRename(index){
      const input=document.getElementById(`device-rename-input-${index}`);
      if(!input) return;
      const newName=input.value.trim(); if(!newName) return;
      try{ await mutateDevice(index,d=>{d.name=newName;}, {actionToast:`Renamed to ${newName}.`, toastTitle:'Device Renamed'}); loadConfiguredDevices(); }
      catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function resetDeviceSettings(index, name){
      try{
        const config=await window.homebridge.getPluginConfig();
        const devices=getDevicesArray(config);
        if(!devices?.[index]) throw new Error('Device not found');
        delete devices[index].deviceSettings; devices[index].enabled=true;
        await window.homebridge.updatePluginConfig(config);
        await notifyAction(`Reset ${name} to defaults.`,'Device Reset');
        loadConfiguredDevices();
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function removeDevice(index, name){
      if(!window.confirm(`Remove "${name}" from configuration?`)) return;
      try{
        const config=await window.homebridge.getPluginConfig();
        const devices=getDevicesArray(config);
        if(!devices) throw new Error('Devices array not found');
        const host=devices[index]?.host;
        devices.splice(index,1); setDevicesTabCount(devices.length);
        await window.homebridge.updatePluginConfig(config);
        if(host) await window.homebridge.request('/remove-cached-accessory',{host}).catch(()=>{});
        await notifyAction(`Removed ${name}.`,'Device Removed');
        loadConfiguredDevices();
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }

    async function loadSettings(){
      try{
        const config=await window.homebridge.getPluginConfig();
        if(!config?.[0]) return;
        const c=config[0], defaults=c.defaultSettingsSection||{}, globalNightlight=c.manualDevicesSection?.nightlight||{};
        document.getElementById('logLevel').value=c.logLevel||'info';
        document.getElementById('tvNameSuffix').value=c.tvNameSuffix||'Presets';
        document.getElementById('customInputLabel').value=c.customInputLabel||'Custom';
        document.getElementById('defaultUseWebSockets').checked=defaults.defaultUseWebSockets!==false;
        document.getElementById('defaultUsePresetService').checked=defaults.defaultUsePresetService!==false;
        document.getElementById('defaultPollInterval').value=defaults.defaultPollInterval||10;
        document.getElementById('globalNightlightEnabled').checked=globalNightlight.enabled===true;
        renderGlobalNightlightTimers(globalNightlight.timers||[]);
      }catch(e){ console.error('Error loading settings:', e); }
    }
    async function saveLogLevel(){
      try{
        await mutateConfig(c=>{c[0].logLevel=document.getElementById('logLevel').value;},
          {toast:'Log level updated.', title:'Settings'});
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function savePresentationSettings(){
      try{
        await mutateConfig(c=>{
          c[0].tvNameSuffix=(document.getElementById('tvNameSuffix').value||'').trim()||'Presets';
          c[0].customInputLabel=(document.getElementById('customInputLabel').value||'').trim()||'Custom';
        }, {toast:'Naming settings updated.', title:'Settings'});
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function saveDefaultSettings(){
      try{
        await mutateConfig(c=>{
          if(!c[0].defaultSettingsSection) c[0].defaultSettingsSection={};
          c[0].defaultSettingsSection.defaultUseWebSockets=document.getElementById('defaultUseWebSockets').checked;
          c[0].defaultSettingsSection.defaultUsePresetService=document.getElementById('defaultUsePresetService').checked;
          const poll=parseInt(document.getElementById('defaultPollInterval').value,10);
          c[0].defaultSettingsSection.defaultPollInterval=Number.isFinite(poll)?Math.min(300,Math.max(2,poll)):10;
          if(!c[0].manualDevicesSection) c[0].manualDevicesSection={devices:[]};
          if(!c[0].manualDevicesSection.nightlight) c[0].manualDevicesSection.nightlight={enabled:false,timers:[]};
          c[0].manualDevicesSection.nightlight.enabled=document.getElementById('globalNightlightEnabled').checked;
        }, {toast:'Default device settings updated.', title:'Settings'});
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    function renderGlobalNightlightTimers(timers){
      const container=document.getElementById('globalNightlightTimers');
      const controls=document.getElementById('globalNightlightTimerControls');
      const t=timers||[];
      if(container) container.innerHTML=renderTimersHtml(t,{
        emptyText:'No global timers.',
        onName:i=>`updateGlobalNightlightTimer(${i},'name',this.value)`,
        onSeconds:i=>`updateGlobalNightlightTimer(${i},'seconds',this.value)`,
        onRemove:i=>`removeGlobalNightlightTimer(${i})`,
      });
      if(controls) controls.innerHTML=renderTimerPresetBar('global', t.length);
      refreshTimerOverlapAlert(t, 'global');
    }
    async function addGlobalNightlightTimerPreset(seconds, name){
      try{
        const config=await window.homebridge.getPluginConfig();
        if(!config[0].manualDevicesSection) config[0].manualDevicesSection={devices:[]};
        if(!config[0].manualDevicesSection.nightlight) config[0].manualDevicesSection.nightlight={enabled:false,timers:[]};
        const timers=config[0].manualDevicesSection.nightlight.timers||[];
        if(!(await checkTimerLimit(timers))) return;
        const newTimer={ name, seconds };
        notifyTimerOverlaps(timers, newTimer, -1, 'global');
        timers.push(newTimer);
        config[0].manualDevicesSection.nightlight.timers=timers;
        await window.homebridge.updatePluginConfig(config);
        await notifyAction('Nightlight timer added.','Nightlight');
        renderGlobalNightlightTimers(timers);
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function addGlobalNightlightTimerCustom(){
      try{
        const config=await window.homebridge.getPluginConfig();
        if(!config[0].manualDevicesSection) config[0].manualDevicesSection={devices:[]};
        if(!config[0].manualDevicesSection.nightlight) config[0].manualDevicesSection.nightlight={enabled:false,timers:[]};
        const timers=config[0].manualDevicesSection.nightlight.timers||[];
        if(!(await checkTimerLimit(timers))) return;
        const newTimer={ name:'', seconds:null };
        notifyTimerOverlaps(timers, newTimer, -1, 'global');
        timers.push(newTimer);
        config[0].manualDevicesSection.nightlight.timers=timers;
        await window.homebridge.updatePluginConfig(config);
        await notifyAction('Nightlight timer added.','Nightlight');
        renderGlobalNightlightTimers(timers);
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function removeGlobalNightlightTimer(i){
      try{
        const config=await window.homebridge.getPluginConfig();
        const timers=config[0].manualDevicesSection?.nightlight?.timers||[];
        timers.splice(i,1);
        await window.homebridge.updatePluginConfig(config);
        await notifyAction('Nightlight timer removed.','Nightlight');
        renderGlobalNightlightTimers(timers);
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    async function updateGlobalNightlightTimer(i, field, value){
      try{
        const config=await window.homebridge.getPluginConfig();
        const timers=config[0].manualDevicesSection?.nightlight?.timers||[];
        if(!timers[i]) return;
        if(field==='seconds'){
          const raw=(value??'').toString().trim();
          if(!raw){
            timers[i].seconds=null;
          }else{
            const parsed=parseInt(raw,10);
            if(!Number.isFinite(parsed)||parsed<=0){
              await window.homebridge.toast.warning('Timer duration must be a positive number of seconds.','Invalid duration');
              renderGlobalNightlightTimers(timers);
              return;
            }
            timers[i].seconds=parsed;
          }
        }else{
          timers[i].name=String(value||'').trim();
        }
        await window.homebridge.updatePluginConfig(config);
        markRestartNeeded();
        refreshTimerOverlapAlert(timers, 'global');
        renderGlobalNightlightTimers(timers);
      }catch(_){}
    }

    async function startDiscovery(){
      const btn=document.getElementById('discoverBtn');
      const stopBtn=document.getElementById('stopDiscoverBtn');
      const spinner=document.getElementById('discoveringSpinner');
      const deviceList=document.getElementById('discoveredDeviceList');
      btn.disabled=true; spinner.style.display='inline-block'; isDiscovering=true; discoveryStopRequested=false;
      stopBtn.style.display='inline-block'; stopBtn.disabled=false;
      discoveryStartTime=Date.now(); lastDiscoveredHostsKey=''; lastDiscoveryFoundCount=0;
      for(const k of Object.keys(discoveredNameEdits)) delete discoveredNameEdits[k];
      for(const k of Object.keys(discoveredSuggestedNames)) delete discoveredSuggestedNames[k];
      setDiscoveryProgress(0,false);
      if(discoveryProgressTimer) clearInterval(discoveryProgressTimer);
      discoveryProgressTimer=setInterval(()=>{ if(isDiscovering) setDiscoveryProgress(lastDiscoveryFoundCount,false); },500);
      deviceList.innerHTML=`<div id="discoveredEmptyHint" class="text-center text-muted py-3"><p class="mb-1 small">Devices appear as they are found.</p></div><div id="discoveredCards"></div>`;
      try{
        await window.homebridge.request('/discover');
        const pollInterval=setInterval(async()=>{
          try{
            const devicesResponse=await window.homebridge.request('/devices');
            await displayDiscoveredDevices(devicesResponse.devices);
            if(!devicesResponse.isDiscovering){
              clearInterval(pollInterval);
              if(discoveryProgressTimer){ clearInterval(discoveryProgressTimer); discoveryProgressTimer=null; }
              btn.disabled=false; spinner.style.display='none'; isDiscovering=false; stopBtn.style.display='none';
              setDiscoveryProgress(lastDiscoveryFoundCount,true);
            }
          }catch(pollError){ console.error('[UI] Polling error:', pollError); }
        },1000);
        setTimeout(()=>{
          clearInterval(pollInterval);
          if(discoveryProgressTimer){ clearInterval(discoveryProgressTimer); discoveryProgressTimer=null; }
          btn.disabled=false; spinner.style.display='none'; isDiscovering=false; stopBtn.style.display='none';
          setDiscoveryProgress(lastDiscoveryFoundCount,true);
        },75000);
      }catch(error){
        console.error('Discovery error:', error);
        btn.disabled=false; spinner.style.display='none'; isDiscovering=false; stopBtn.style.display='none';
        if(discoveryProgressTimer){ clearInterval(discoveryProgressTimer); discoveryProgressTimer=null; }
        document.getElementById('discoveryProgress')?.classList.add('d-none');
        deviceList.innerHTML=`<div class="alert alert-warning">Failed to start discovery: ${escapeHtml(error.message)}</div>`;
      }
    }
    async function stopDiscovery(){
      const btn=document.getElementById('discoverBtn');
      const stopBtn=document.getElementById('stopDiscoverBtn');
      const spinner=document.getElementById('discoveringSpinner');
      if(!isDiscovering||discoveryStopRequested) return;
      discoveryStopRequested=true; stopBtn.disabled=true;
      try{ await window.homebridge.request('/stop-discovery'); }
      catch(e){ console.error('[UI] stopDiscovery error:', e); }
      finally{
        isDiscovering=false; btn.disabled=false; spinner.style.display='none'; stopBtn.style.display='none';
        if(discoveryProgressTimer){ clearInterval(discoveryProgressTimer); discoveryProgressTimer=null; }
        setDiscoveryProgress(lastDiscoveryFoundCount,true);
      }
    }

    async function displayDiscoveredDevices(devices){
      const deviceList=document.getElementById('discoveredDeviceList');
      if(!deviceList) return;
      const activeEl=document.activeElement;
      const activeId=activeEl&&activeEl.id?activeEl.id:null;
      const shouldRestoreFocus=!!(activeId&&activeId.startsWith('discovered-name-'));
      const cursorStart=shouldRestoreFocus?activeEl.selectionStart:null;
      const cursorEnd=shouldRestoreFocus?activeEl.selectionEnd:null;
      if(!devices||!devices.length){
        setDiscoveryProgress(0,!isDiscovering);
        if(!isDiscovering){
          deviceList.innerHTML=`<div class="empty-state py-4"><p class="text-muted mb-0 small">No WLED devices found on this network.</p></div>`;
          lastDiscoveredHostsKey='';
        }
        return;
      }
      const config=await window.homebridge.getPluginConfig();
      const configuredDevices=getDevicesArray(config)||[];
      const configuredNames=new Set((configuredDevices||[]).map(d=>(d?.name||'').trim()).filter(Boolean));
      // Mirrors src/shared/wledUtils.getDisplayNameFromHost (browser cannot import dist).
      function titleCaseFromHost(host){
        let base=(host||'').trim().replace(/\.$/,'').replace(/\.local$/i,'');
        if(!base) return '';
        if(/^\d+\.\d+\.\d+\.\d+$/.test(base)) return base;
        return base.split('-').filter(Boolean).map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
      }
      function uniqueName(baseName){
        const base=(baseName||'').trim()||'WLED';
        if(!configuredNames.has(base)){ configuredNames.add(base); return base; }
        for(let i=2;i<100;i++){ const c=`${base} ${i}`; if(!configuredNames.has(c)){ configuredNames.add(c); return c; } }
        const c=`${base} ${Date.now()}`; configuredNames.add(c); return c;
      }
      function suggestedNameForDevice(device){
        const rawName=(device?.name||'').trim();
        const hostDerived=titleCaseFromHost(device?.host);
        const mac=(device?.info?.macAddress||'').replace(/:/g,'').toUpperCase();
        if(rawName&&rawName.toUpperCase()!=='WLED'){
          const rn=rawName.trim();
          const rawLooksLikeHost=/\.local\.?\s*$/i.test(rn)||/^[a-z0-9-]+$/i.test(rn);
          return uniqueName(rawLooksLikeHost?titleCaseFromHost(rawName):rawName);
        }
        if(hostDerived&&hostDerived.toUpperCase()!=='WLED') return uniqueName(hostDerived);
        if(mac) return uniqueName(`WLED ${mac.slice(-4)}`);
        if(device?.host&&/^\d+\.\d+\.\d+\.\d+$/.test(device.host)) return uniqueName(`WLED ${device.host.split('.').pop()}`);
        return uniqueName('WLED');
      }
      const unconfiguredDevices=devices.filter(device=>!configuredDevices.some(d=>d.host===device.host));
      setDiscoveryProgress(unconfiguredDevices.length,!isDiscovering);
      if(!unconfiguredDevices.length){
        const cfg=await window.homebridge.getPluginConfig().catch(()=>null);
        const autoStop=!(cfg&&cfg[0]&&cfg[0].autoStopDiscoveryWhenAllConfigured===false);
        if(isDiscovering&&autoStop) await stopDiscovery();
        deviceList.innerHTML=`<div class="text-center text-muted py-4"><p class="mb-0">All discovered devices are already configured.</p></div>`;
        lastDiscoveredHostsKey='';
        return;
      }
      const hostsKey=unconfiguredDevices.map(d=>`${d.host}:${d.info?1:0}:${d.discoveryMethod||''}`).sort().join('|');
      if(hostsKey===lastDiscoveredHostsKey&&document.getElementById('discoveredCards')) return;
      lastDiscoveredHostsKey=hostsKey;
      const cardsHtml=unconfiguredDevices.map(device=>{
        const host=device.host;
        if(!discoveredSuggestedNames[host]) discoveredSuggestedNames[host]=suggestedNameForDevice(device);
        const suggestedName=discoveredSuggestedNames[host];
        const currentName=discoveredNameEdits[host]!==undefined?discoveredNameEdits[host]:suggestedName;
        const inputId=discoveredNameInputId(host);
        const method=(device.discoveryMethod||'').toLowerCase();
        const badgeCls=method==='mdns'?'text-bg-info':method==='ssdp'?'text-bg-success':'text-bg-warning';
        return `<div class="card discovered-card mb-2" data-host="${escapeHtml(host)}"><div class="card-body py-2">
          <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
            <div class="flex-grow-1 min-w-0">
              <label class="form-label small mb-1" for="${inputId}">Name</label>
              <input class="form-control form-control-sm" id="${inputId}" value="${currentName.replace(/"/g,'&quot;')}"
                     placeholder="e.g., Living Room" oninput="setDiscoveredName('${host}',this.value)">
            </div>
            <span class="badge ${badgeCls} mt-4">${(device.discoveryMethod||'').toUpperCase()||'FOUND'}</span>
          </div>
          <div class="device-host mb-2">${escapeHtml(device.host)}:${device.port}${device.info?` · v${escapeHtml(String(device.info.version||''))}`:''}</div>
          <button class="btn btn-success btn-sm" onclick="addDeviceToConfig('${device.host}',(document.getElementById('${inputId}')?.value||'${suggestedName.replace(/'/g,"\\'")}'),${device.port},'${device.info?.version||''}','${device.info?.macAddress||''}',${device.info?.ledCount||0})">Add</button>
        </div></div>`;
      }).join('');
      let cards=document.getElementById('discoveredCards');
      if(!cards){ deviceList.innerHTML='<div id="discoveredCards"></div>'; cards=document.getElementById('discoveredCards'); }
      document.getElementById('discoveredEmptyHint')?.remove();
      cards.innerHTML=cardsHtml;
      if(shouldRestoreFocus){
        const input=document.getElementById(activeId);
        if(input?.focus){ input.focus(); try{ if(cursorStart!=null) input.setSelectionRange(cursorStart,cursorEnd); }catch(_){ } }
      }
    }

    async function addDeviceByIp(){
      try{
        const host=(document.getElementById('manualHost')?.value||'').trim();
        const port=parseInt(document.getElementById('manualPort')?.value||'80',10)||80;
        if(!host){ await window.homebridge.toast.error('Enter a host or IP','Add by IP'); return; }
        const response=await window.homebridge.request('/add-by-ip',{host,port});
        if(response?.status!=='success'||!response.device) throw new Error(response?.message||'Device not found');
        const d=response.device;
        await addDeviceToConfig(d.host,d.name||host,d.port||port,d.info?.version||'',d.info?.macAddress||'',d.info?.ledCount||0);
        const hostInput=document.getElementById('manualHost'); if(hostInput) hostInput.value='';
      }catch(e){ await window.homebridge.toast.error(e.message||String(e),'Add by IP'); }
    }

    async function addDeviceToConfig(host, name, port, firmwareVersion, macAddress, ledCount){
      try{
        name=(name||'').trim();
        const config=await window.homebridge.getPluginConfig();
        if(!config||!config.length){ config.push({name:'WLED Kit',platform:'WLED Kit'}); await window.homebridge.updatePluginConfig(config); }
        if(!config[0].manualDevicesSection) config[0].manualDevicesSection={devices:[]};
        if(!config[0].manualDevicesSection.devices) config[0].manualDevicesSection.devices=[];
        const devices=config[0].manualDevicesSection.devices;
        if(devices.some(d=>d&&d.host===host)){ await window.homebridge.toast.warning(`Device ${name} is already configured`,'Device Exists'); return; }
        const defaults=config[0].defaultSettingsSection||{};
        const deviceEntry={
          name:name||host, host, port, enabled:true,
          ...(firmwareVersion?{firmwareVersion}:{}),
          ...(macAddress?{macAddress}:{}),
          ...(ledCount?{ledCount}:{}),
          deviceSettings:{
            usePresetService:defaults.defaultUsePresetService!==false,
            useWebSockets:defaults.defaultUseWebSockets!==false,
            ...(defaults.defaultPollInterval?{pollInterval:defaults.defaultPollInterval}:{}),
          }
        };
        devices.push(deviceEntry);
        setDevicesTabCount(devices.length);
        await window.homebridge.updatePluginConfig(config);
        await notifyAction(`Added ${name}.`,'Device Added');
        lastDiscoveredHostsKey='';
        const response=await window.homebridge.request('/devices');
        await displayDiscoveredDevices(response.devices||[]);
        loadConfiguredDevices();
      }catch(e){ console.error('Error adding device:', e); await window.homebridge.toast.error(e.message,'Error'); }
    }

    function renderPresetChecklist(presets, enabledPresets, opts={}){
      const {checkboxClass='preset-checkbox', idPrefix='preset', onChange='saveInlinePresets()', showSwatch=false, countLabel='enabled', countId, selectAllBtn=''}=opts;
      const entries=Object.entries(presets);
      return `<div class="d-flex flex-wrap gap-2 align-items-center mb-2">
          ${selectAllBtn}
          <span class="text-muted small ms-auto" ${countId?`id="${countId}"`:''}>${enabledPresets.length} of ${entries.length} ${countLabel}</span>
        </div>
        <div class="list-group">
          ${entries.map(([id,preset])=>{
            const swatch=showSwatch?(()=>{ const col=preset.data?.seg?.[0]?.col?.[0];
              return col&&(col[0]||col[1]||col[2])?`<span class="preset-swatch" style="background:rgb(${col[0]},${col[1]},${col[2]})"></span>`:''; })():'';
            return `<div class="list-group-item d-flex align-items-center gap-2 py-2">
              <input type="checkbox" class="form-check-input flex-shrink-0 ${checkboxClass}" id="${idPrefix}-${id}" data-preset-id="${id}"
                     ${enabledPresets.includes(id)?'checked':''} onchange="${onChange}">
              <label for="${idPrefix}-${id}" class="flex-grow-1 mb-0">
                <div class="fw-semibold small mb-0">${swatch}${escapeHtml(preset.name)}${preset.quickLabel?` <span class="badge text-bg-primary">${escapeHtml(preset.quickLabel)}</span>`:''}</div>
                <div class="small text-muted">ID ${id}</div>
              </label></div>`;
          }).join('')}
        </div>`;
    }

    async function loadInlinePresets(index, host, port, deviceName){
      const container=document.getElementById(`inline-presets-${index}`);
      if(!container) return;
      container.innerHTML=`<p class="text-muted small mb-0">Loading presets for ${escapeHtml(deviceName)}…</p>`;
      try{
        const response=await window.homebridge.request('/get-presets',{host,port});
        if(response.status==='error') throw new Error(response.message);
        const presets=Object.fromEntries(Object.entries(response.presets||{}).filter(([id])=>id!=='0'));
        const config=await window.homebridge.getPluginConfig();
        const device=getDevicesArray(config)?.find(d=>d.host===host);
        const enabledPresets=(device?.deviceSettings?.enabledPresets||[]).filter(id=>id!=='0');
        container.dataset.loaded='1';
        if(!Object.keys(presets).length){ container.innerHTML='<p class="text-muted small mb-0">No presets on this device.</p>'; return; }
        const safeHost=host.replace(/'/g,"\\'");
        container.innerHTML=renderPresetChecklist(presets, enabledPresets, {
          checkboxClass:`preset-checkbox inline-preset-cb-${index}`,
          idPrefix:`ipreset-${index}`,
          onChange:`saveInlinePresets(${index},'${safeHost}')`,
          showSwatch:true, countId:`inline-preset-count-${index}`,
          selectAllBtn:`<button class="btn btn-outline-secondary btn-sm" onclick="selectAllInlinePresets(${index},'${safeHost}')">All</button>
            <button class="btn btn-outline-secondary btn-sm" onclick="deselectAllInlinePresets(${index},'${safeHost}')">None</button>`,
        });
      }catch(e){
        container.dataset.loaded='1';
        container.innerHTML=`<div class="alert alert-warning mb-0 py-2 small">Failed to load presets: ${escapeHtml(e.message)}</div>`;
      }
    }
    async function saveInlinePresets(index, host){
      try{
        const devices=getDevicesArray(await window.homebridge.getPluginConfig());
        const deviceIndex=devices?.findIndex(d=>d.host===host);
        if(deviceIndex===-1||deviceIndex===undefined) return;
        await mutateDevice(deviceIndex,d=>{
          d.deviceSettings.enabledPresets=Array.from(document.querySelectorAll(`.inline-preset-cb-${index}:checked`))
            .map(cb=>cb.getAttribute('data-preset-id')).filter(id=>id!=='0');
          const total=document.querySelectorAll(`.inline-preset-cb-${index}`).length;
          const countEl=document.getElementById(`inline-preset-count-${index}`);
          if(countEl) countEl.textContent=`${d.deviceSettings.enabledPresets.length} of ${total} enabled`;
        });
      }catch(e){ await window.homebridge.toast.error(e.message,'Error'); }
    }
    function selectAllInlinePresets(index, host){
      document.querySelectorAll(`.inline-preset-cb-${index}`).forEach(cb=>cb.checked=true);
      saveInlinePresets(index, host);
    }
    function deselectAllInlinePresets(index, host){
      document.querySelectorAll(`.inline-preset-cb-${index}`).forEach(cb=>cb.checked=false);
      saveInlinePresets(index, host);
    }

    let initAttempts=0;
    const MAX_INIT_ATTEMPTS=50;
    async function bootstrapUI(){
      hbShowSpinner();
      try{
        let config=await window.homebridge.getPluginConfig();
        if(!config?.length){
          config=[{
            name:'WLED Kit',
            platform:'WLED Kit',
            manualDevicesSection:{devices:[]},
          }];
          await window.homebridge.updatePluginConfig(config);
          showIntro();
        }else{
          showMainUI('devices');
        }
        loadAutoStopCheckbox();
      }catch(err){
        await window.homebridge.toast.error(err.message,'Error');
        showMainUI('devices');
      }finally{
        hbHideSpinner();
      }
    }
    function initializeUI(){
      initAttempts++;
      if(!window.homebridge){
        if(initAttempts>=MAX_INIT_ATTEMPTS){
          document.body.innerHTML=`<div class="p-4"><div class="alert alert-danger">
            <h5 class="alert-heading">UI Not Loaded Properly</h5>
            <p>Open this plugin via Homebridge Config UI X → Plugins → Settings.</p></div></div>`;
          return;
        }
        setTimeout(initializeUI,100);
        return;
      }
      try{
        window.homebridge.addEventListener('discoveredDevices',(event)=>{
          const devices=event instanceof MessageEvent?event.data:event;
          if(!document.getElementById('addPanel')?.classList.contains('d-none')) displayDiscoveredDevices(devices);
        });
      }catch(e){ console.error('[UI] Event listener error:', e); }
      document.getElementById('introContinueBtn')?.addEventListener('click', continueFromIntro);
      document.getElementById('menuSettings')?.addEventListener('click', ()=>switchTab('settings'));
      document.getElementById('menuDevices')?.addEventListener('click', ()=>switchTab('devices'));
      document.getElementById('menuSupport')?.addEventListener('click', ()=>switchTab('support'));
      bootstrapUI();
    }
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', initializeUI);
    else initializeUI();
