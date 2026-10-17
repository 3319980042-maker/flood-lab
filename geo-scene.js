/* MapLibre geographical view. The teaching graph remains the experiment's source of truth. */
window.FloodGeoScene = (() => {
  'use strict';
  const CENTER = [117.164, 34.253];
  const BOUNDS = [[117.13, 34.23], [117.205, 34.29]];
  const points = {
    S:[117.144,34.250], J:[117.157,34.253], C:[117.168535,34.259961], D:[117.186685,34.249213],
    E:[117.188,34.264], N:[117.171,34.266], A:[117.182583,34.252217], B:[117.176530,34.264465],
    H:[117.180783,34.270007], V:[117.164069,34.264279], K:[117.180931,34.257349], W:[117.164675,34.262200]
  };
  const symbols={base:'S',hospital:'✚',care:'B',shelter:'⌂',community:'●',junction:'·'};
  const presets={
    overview:{center:CENTER,zoom:13.25,bearing:0,pitch:0},
    district:{center:[117.176451,34.264271],zoom:16.9,bearing:-24,pitch:58},
    facility:{center:[117.179502,34.270345],zoom:16.6,bearing:-25,pitch:58}
  };
  const colors={open:'#24b893',limited:'#e6a83c',blocked:'#ef6170',repair:'#4e91ff'};
  const titles={open:'正常通行',limited:'限制通行',blocked:'道路阻断',repair:'正在抢修'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let map,host,parking,ctx,loaded=false,failed=false,mode='auto',labels=true,showNetwork=true,autoPitch=false,tourTimer;
  let markers=[],roads=[],crewMarkers=[],dataPromise,popup;
  let fullData;
  let commandMarkers=[],annotationCallback=null,locationCallback=null,drawing=null,localAnnotations=[],annotationSerial=0;
  let drawingColor='#f5ae52',baseMode='geographic',rainFrame=null,rainLast=0,rainDrops=[],weatherCanvas;
  let localWeather={type:'rain',rain:45,night:false},toolsOpen=false;
  const visible={network:true,buildings:true,geography:true,weather:true,annotations:true,command:true};
  const networkModes={practice:true,command:false};
  const empty=()=>({type:'FeatureCollection',features:[]});

  function toolTemplate(){
    const w=currentWeather();
    return `<details class="geo-tools" ${toolsOpen?'open':''}><summary>☷ 场景工具</summary><div class="geo-tool-body">
      <fieldset><legend>图层与底图</legend><div class="geo-tool-checks">${[['network','教学通道'],['buildings','三维建筑'],['geography','地理名称'],['weather','天气特效'],['annotations','地图标绘'],['command','任务与力量']].map(([id,name])=>`<label><input type="checkbox" data-geo-layer="${id}" ${visible[id]?'checked':''}>${name}</label>`).join('')}</div><div class="geo-basemaps"><button data-geo-basemap="geographic" aria-pressed="${baseMode==='geographic'}">地理底图</button><button data-geo-basemap="dark" aria-pressed="${baseMode==='dark'}">深色底图</button></div><p class="geo-tool-note">本地地理数据，可离线使用；未配置卫星影像服务。</p></fieldset>
      <fieldset><legend>地图标绘</legend><div class="geo-draw-buttons">${[['point','• 点'],['line','⌁ 线'],['polygon','△ 面'],['circle','◯ 圆']].map(([id,title])=>`<button data-geo-draw="${id}">${title}</button>`).join('')}<label class="geo-color-label">颜色<input type="color" data-geo-color value="${drawingColor}" aria-label="标绘颜色"></label></div><div class="geo-tool-actions"><button data-geo-action="draw-finish">完成标绘</button><button data-geo-action="draw-cancel">取消</button><button data-geo-action="draw-clear">清空标绘</button></div><p class="geo-tool-note">点：点击定位；线/面：依次点击后完成；圆：圆心与边界两次点击。点击已存标绘可删除。</p></fieldset>
      <fieldset><legend>天气与光照</legend><div class="geo-weather-buttons">${[['clear','晴'],['cloud','云'],['rain','雨'],['fog','雾']].map(([id,title])=>`<button data-geo-weather="${id}" aria-pressed="${w.type===id}">${title}</button>`).join('')}</div><label class="geo-rain-label">雨强 <output data-geo-rain-value>${w.rain}</output> mm/h<input type="range" min="0" max="150" step="5" value="${w.rain}" data-geo-rain aria-label="教学降雨强度"></label><label class="geo-night-label"><input type="checkbox" data-geo-night ${w.night?'checked':''}>夜间光照</label><p class="geo-tool-note">天气为教学视觉特效，非水动力计算。</p></fieldset><button class="geo-screenshot" data-geo-action="screenshot">⇩ 保存当前场景截图</button>
      </div></details><div class="geo-draw-status" hidden role="status" aria-live="polite"></div><div class="geo-atmosphere" aria-hidden="true"><canvas class="geo-rain-canvas"></canvas><div class="geo-cloud-effect"></div><div class="geo-fog-effect"></div><div class="geo-night-effect"></div></div>`;
  }

  function template(hero=false){
    return `<section class="geo-panel ${hero?'geo-hero':''}">
      <div class="geo-heading"><div class="geo-place"><small>XUZHOU · YUNLONG LAKE</small><h2>徐州 · 云龙湖湖滨片区</h2><p>区域地图与三维建筑 · 洪涝应急教学场景</p></div>
      <div class="geo-mode-tabs" role="group" aria-label="地图视角模式">${[['auto','自动切换'],['flat','二维地图'],['3d','三维建筑']].map(([id,title])=>`<button data-camera-mode="${id}" class="${mode===id?'active':''}" aria-pressed="${mode===id}">${title}</button>`).join('')}</div></div>
      <div class="geo-viewport"><div class="geo-map-slot" aria-label="徐州可缩放三维地理场景"></div>
      ${toolTemplate()}
      <div class="geo-loading" role="status">正在加载徐州地图与建筑…</div>
      <div class="geo-corner-tag"><i></i><span data-geo-zoom-label>区域总览 · 2D</span></div>
      <div class="geo-camera-controls" aria-label="镜头位置"><button data-camera-preset="overview">↗ 区域总览</button><button data-camera-preset="district">▥ 湖滨街区</button><button data-camera-preset="facility">✚ 重点设施</button></div>
      ${hero?`<aside class="geo-poi-panel"><span class="eyebrow">SCENARIO LOCATIONS</span><h3>在城市中理解灾情</h3><p>选择教学点位，拉近查看建筑与通道。</p><div class="geo-poi-list">${[['A','湖滨教学社区','人口 320 · 居住片区'],['H','教学医院 H','人口 120 · 重点保障'],['B','教学养老院 B','人口 80 · 重点保障'],['S','教学救援基地','专业队伍 · 资源出发点']].map(([id,t,d])=>`<button data-focus-node="${id}"><b>${id}</b><span>${t}<small>${d}</small></span><i>↗</i></button>`).join('')}</div><button class="geo-tour-button" data-geo-action="tour">▷ 场景漫游</button></aside>`:''}
      <div class="geo-bottom-bar"><span data-geo-altitude>滚轮拉近查看三维建筑</span><button data-geo-action="labels" aria-pressed="${labels}">点位标签</button><button data-geo-action="network" aria-pressed="${showNetwork}">教学路网</button><button data-geo-action="fullscreen">⛶ 全屏</button></div>
      <div class="geo-error" hidden role="alert"><strong>当前无法显示三维地图</strong><p>可重试加载，或继续使用教学路网完成实验。</p><button data-geo-action="retry">重试地图</button><button data-geo-action="topology">查看教学路网</button></div>
      </div><div class="geo-legend"><span><i style="background:#24b893"></i>正常</span><span><i style="background:#e6a83c"></i>限行</span><span><i style="background:#ef6170"></i>阻断</span><span><i style="background:#4e91ff"></i>抢修</span><small>彩色连线为教学任务通道</small></div>
      <div class="geo-footer"><span>真实地理与建筑轮廓 · 示意楼高 · 虚拟灾情、设施和教学通道</span><button data-geo-action="sources">数据来源与模型说明 ↗</button></div></section>`;
  }
  function act(dataset){
    const button=document.createElement('button');
    Object.assign(button.dataset,dataset); button.hidden=true; document.body.append(button);button.click();button.remove();
  }
  function detach(){
    const tool=document.querySelector('.geo-tools');if(tool)toolsOpen=tool.open;
    if(!host)return;
    if(!parking){parking=document.createElement('div');parking.hidden=true;document.body.append(parking);}
    parking.append(host);
  }
  function mount(context){
    if(ctx)networkModes[ctx.command?'command':'practice']=visible.network;
    ctx=context;
    visible.network=networkModes[ctx?.command?'command':'practice'];showNetwork=visible.network;
    const slot=document.querySelector('.geo-map-slot');
    if(!slot){stopTour();return;}
    if(!host){host=document.createElement('div');host.className='geo-canvas';}
    slot.append(host);
    if(!window.maplibregl){failure();return;}
    if(!map&&!failed)init();
    if(map){requestAnimationFrame(()=>{map.resize(); if(loaded)sync();});}
    document.querySelector('.geo-loading')?.toggleAttribute('hidden',loaded||failed);
    document.querySelector('.geo-error')?.toggleAttribute('hidden',!failed);
    const tool=document.querySelector('.geo-tools');if(tool){tool.open=toolsOpen;tool.addEventListener('toggle',()=>{if(tool.isConnected)toolsOpen=tool.open;});}
    syncToolControls();
    weatherCanvas=document.querySelector('.geo-rain-canvas');
    applyWeather();updateDrawingReadout();
    updateReadout();
  }
  function failure(){failed=true;document.querySelector('.geo-loading')?.setAttribute('hidden','');document.querySelector('.geo-error')?.removeAttribute('hidden');}
  async function loadData(){
    if(window.FloodLocalGeoData)return window.FloodLocalGeoData;
    if(!dataPromise)dataPromise=Promise.all(['buildings','roads','water','landuse','labels'].map(async name=>{
      const response=await fetch(`data/xuzhou-${name}.geojson`);if(!response.ok)throw new Error(`地理数据加载失败: ${name}`);return [name,await response.json()];
    })).then(entries=>Object.fromEntries(entries));
    return dataPromise;
  }
  function init(){
    failed=false;
    try{
      map=new maplibregl.Map({container:host,style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e7e9df'}}]},center:CENTER,zoom:13.25,minZoom:13,maxZoom:19,maxBounds:BOUNDS,pitch:0,maxPitch:70,bearing:0,attributionControl:false,localIdeographFontFamily:'Microsoft YaHei',canvasContextAttributes:{antialias:true,preserveDrawingBuffer:true}});
      map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'bottom-right');
      map.addControl(new maplibregl.ScaleControl({maxWidth:100,unit:'metric'}),'bottom-left');
      map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>'}),'bottom-right');
      map.on('load',async()=>{
        try{fullData=await loadData();addLayers(fullData);loaded=true;document.querySelector('.geo-loading')?.setAttribute('hidden','');sync();window.dispatchEvent(new Event('flood-map-ready'));}
        catch(error){console.error(error);failure();}
      });
      map.on('zoom',updateReadout);
      map.on('zoomend',()=>{
        if(mode==='auto'&&!autoPitch){
          autoPitch=true;
          const pitch=Math.max(0,Math.min(58,(map.getZoom()-14.5)*30));
          if(Math.abs(map.getPitch()-pitch)>.4)map.easeTo({pitch,duration:650});
          autoPitch=false;
        }
        updateReadout();
      });
      map.on('pitch',updateReadout);
      map.on('error',event=>{console.warn('地图渲染提示',event.error?.message||'');});
      map.on('webglcontextlost',failure);
      map.on('click','teaching-roads',event=>{if(isCapturing())return;const f=event.features?.[0];if(f)act({road:f.properties.id});});
      map.on('mouseenter','teaching-roads',()=>map.getCanvas().style.cursor=isCapturing()?'crosshair':'pointer');
      map.on('mouseleave','teaching-roads',()=>map.getCanvas().style.cursor=isCapturing()?'crosshair':'');
      map.on('click','buildings-3d',event=>{
        if(isCapturing()||event.originalEvent?.defaultPrevented)return;
        const f=event.features?.[0];if(!f)return;
        popup?.remove();popup=new maplibregl.Popup({maxWidth:'260px',closeButton:true}).setLngLat(event.lngLat).setHTML(`<div class="geo-tooltip"><b>${escape(f.properties.name||'徐州建筑')}</b><p>开放地图建筑轮廓<br>示意高度 ${Math.round(Number(f.properties.render_height)||9)} m</p><small>用于街区空间认知，非测绘模型</small></div>`).addTo(map);
      });
      map.on('click',captureMapClick);
      map.on('mousemove',event=>{if(drawing){drawing.pointer=[event.lngLat.lng,event.lngLat.lat];updateDrawingData();}});
    }catch(error){console.error(error);failure();}
  }
  function addLayers(data){
    for(const name of ['landuse','water','roads','buildings'])map.addSource(name,{type:'geojson',data:data[name],attribution:name==='buildings'?'OSM building footprints':''});
    map.addLayer({id:'green',type:'fill',source:'landuse',paint:{'fill-color':['match',['get','class'],'residential','#e0e1d7','commercial','#e3dcda','industrial','#d9d7d2','forest','#b3c5a2','wood','#b3c5a2','park','#c3d3b0','grass','#c9d7b8','#d1d8bf'],'fill-opacity':.8}});
    map.addLayer({id:'water',type:'fill',source:'water',paint:{'fill-color':'#9ccbd4','fill-opacity':1}});
    map.addLayer({id:'water-outline',type:'line',source:'water',paint:{'line-color':'#86b9c5','line-width':1}});
    map.addLayer({id:'streets-casing',type:'line',source:'roads',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#c5c6bd','line-width':['interpolate',['linear'],['zoom'],12,1,16,['match',['get','class'],'motorway',15,'primary',13,'secondary',11,'tertiary',9,6],19,30]}});
    map.addLayer({id:'streets',type:'line',source:'roads',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':['match',['get','class'],'motorway','#f1d09a','primary','#f6dfa4','secondary','#f8e5b7','#f8f7ef'],'line-width':['interpolate',['linear'],['zoom'],12,.6,16,['match',['get','class'],'motorway',12,'primary',10,'secondary',8,'tertiary',6,4],19,25]}});
    map.addLayer({id:'building-footprints',type:'fill',source:'buildings',minzoom:13.8,paint:{'fill-color':'#b7beb7','fill-opacity':['interpolate',['linear'],['zoom'],13.8,0,15,.8]}});
    map.addLayer({id:'buildings-3d',type:'fill-extrusion',source:'buildings',minzoom:14.8,paint:{'fill-extrusion-color':['interpolate',['linear'],['coalesce',['to-number',['get','render_height']],9],0,'#e3e5df',20,'#c9d3d0',60,'#9fbab8',120,'#79a7a7'],'fill-extrusion-height':['interpolate',['linear'],['zoom'],14.8,0,15.8,['coalesce',['to-number',['get','render_height']],9]],'fill-extrusion-base':['coalesce',['to-number',['get','render_min_height']],0],'fill-extrusion-opacity':.96,'fill-extrusion-vertical-gradient':true}});
    map.setLight({anchor:'viewport',color:'#fff8e9',intensity:.45,position:[1.5,210,35]});
    map.addSource('teaching',{type:'geojson',data:empty()});
    map.addLayer({id:'teaching-roads-halo',type:'line',source:'teaching',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#f5fbf8','line-width':7,'line-opacity':.9}});
    map.addLayer({id:'teaching-roads',type:'line',source:'teaching',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':['case',['get','highlighted'],6,3.5],'line-opacity':.95}});
    map.addSource('flood-areas',{type:'geojson',data:empty()});
    map.addLayer({id:'flood-areas',type:'fill',source:'flood-areas',paint:{'fill-color':'#519fc4','fill-opacity':.22}});
    addGeographyLabels(data.labels);
    addCommandLayers();
  }
  function addGeographyLabels(collection){
    // Geographic labels use DOM text so all Chinese text works without remote font files.
    const names=new Set();
    for(const f of collection.features){
      const name=f.properties['name:zh']||f.properties.name;
      if(!name||names.has(name)||f.geometry.type!=='Point'||names.size>40)continue;
      names.add(name);
      const el=document.createElement('span');el.className='geo-place-label';el.textContent=name;
      const marker=new maplibregl.Marker({element:el}).setLngLat(f.geometry.coordinates).addTo(map);
      marker._geoLabel=true;markers.push(marker);
    }
  }
  function coordinatesForEdge(edge){
    const a=points[edge.a],b=points[edge.b];
    // Teaching channels are deliberately distinguished from the geographical street graph.
    return [a,[b[0],a[1]],b];
  }
  function lineMidpoint(coordinates){
    const segments=coordinates.slice(1).map((p,i)=>Math.hypot((p[0]-coordinates[i][0])*Math.cos(p[1]*Math.PI/180),p[1]-coordinates[i][1]));
    let remaining=segments.reduce((a,b)=>a+b,0)/2;
    for(let i=0;i<segments.length;i++){
      if(remaining<=segments[i]){const t=segments[i]?remaining/segments[i]:0;return coordinates[i].map((v,j)=>v+(coordinates[i+1][j]-v)*t);}
      remaining-=segments[i];
    }
    return coordinates[0];
  }
  function addCommandLayers(){
    for(const id of ['command-routes','command-annotations','command-draft'])map.addSource(id,{type:'geojson',data:empty()});
    map.addLayer({id:'command-routes-halo',type:'line',source:'command-routes',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#092c3b','line-width':9,'line-opacity':.75}});
    map.addLayer({id:'command-routes',type:'line',source:'command-routes',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':['get','color'],'line-width':4,'line-dasharray':[2,1],'line-opacity':.95}});
    for(const prefix of ['command-annotations','command-draft']){
      map.addLayer({id:prefix+'-fill',type:'fill',source:prefix,filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['get','color'],'fill-opacity':prefix==='command-draft'?.16:.25}});
      map.addLayer({id:prefix+'-line',type:'line',source:prefix,filter:['!=',['geometry-type'],'Point'],layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':['get','color'],'line-width':3,'line-opacity':.95}});
      map.addLayer({id:prefix+'-point',type:'circle',source:prefix,filter:['==',['geometry-type'],'Point'],paint:{'circle-color':['get','color'],'circle-radius':prefix==='command-draft'?5:8,'circle-stroke-color':'#fff','circle-stroke-width':2}});
    }
    for(const suffix of ['fill','line','point'])map.on('click','command-annotations-'+suffix,event=>{
      if(isCapturing())return;
      const f=event.features?.[0];if(!f)return;
      popup?.remove();popup=new maplibregl.Popup({maxWidth:'230px'}).setLngLat(event.lngLat).setHTML(`<div class="geo-tooltip"><b>${escape(f.properties.title||'地图标绘')}</b><p>演练图上标记${f.properties.radiusMeters?' · 半径约 '+Math.round(f.properties.radiusMeters)+' m':''}</p><button data-geo-delete-annotation="${escape(f.properties.id)}">删除此标绘</button></div>`).addTo(map);
    });
  }
  function validCoordinate(value){return Array.isArray(value)&&value.length>=2&&Number.isFinite(value[0])&&Number.isFinite(value[1])&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90;}
  function itemCoordinate(item){return validCoordinate(item?.lngLat)?item.lngLat:points[item?.nodeId]||null;}
  function routeCoordinates(deployment,resource,task){
    if(Array.isArray(deployment.route)&&deployment.route.length>1&&deployment.route.every(validCoordinate))return deployment.route;
    const routeNodes=Array.isArray(deployment.route?.nodes)?deployment.route.nodes:Array.isArray(deployment.nodePath)?deployment.nodePath:null;
    if(routeNodes?.length>1&&routeNodes.every(id=>points[id]))return routeNodes.flatMap((id,i)=>i?coordinatesForEdge({a:routeNodes[i-1],b:id}).slice(1):[points[id]]);
    if(ctx?.command)return [];
    if(!ctx?.state||!resource?.nodeId||!task?.nodeId)return [];
    const route=window.FloodLab?.route(ctx.state,resource.nodeId,task.nodeId);
    return route?.nodes?.flatMap((id,i)=>i?coordinatesForEdge({a:route.nodes[i-1],b:id}).slice(1):[points[id]])||[];
  }
  function pointAlongRoute(coordinates,progress){
    if(!coordinates.length)return null;if(coordinates.length===1)return coordinates[0];
    const lengths=coordinates.slice(1).map((p,i)=>distanceMeters(coordinates[i],p));
    let remaining=lengths.reduce((a,b)=>a+b,0)*Math.max(0,Math.min(1,Number(progress)||0));
    for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]){const t=lengths[i]?remaining/lengths[i]:0;return coordinates[i].map((v,j)=>v+(coordinates[i+1][j]-v)*t);}remaining-=lengths[i];}
    return coordinates.at(-1);
  }
  function syncCommand(){
    if(!loaded)return;
    commandMarkers.forEach(m=>m.remove());commandMarkers=[];
    const command=ctx?.command||{},tasks=command.tasks||[],resources=command.resources||[],deployments=command.deployments||[];
    const features=[];
    for(const d of deployments){
      if(['cancelled','canceled','recalled','returned'].includes(d.status))continue;
      const resource=resources.find(r=>r.id===d.resourceId),task=tasks.find(t=>t.id===d.taskId),coords=routeCoordinates(d,resource,task);
      if(coords.length>1)features.push({type:'Feature',properties:{id:d.id,color:d.status==='completed'?'#64dfb5':'#ffb75b'},geometry:{type:'LineString',coordinates:coords}});
    }
    map.getSource('command-routes')?.setData({type:'FeatureCollection',features});
    for(const task of tasks){
      const coordinate=itemCoordinate(task);if(!coordinate)continue;
      const el=document.createElement('button');el.className='geo-command-marker geo-command-task '+(task.status==='completed'?'completed':task.status==='active'?'active':'');el.type='button';el.dataset.commandTask=task.id;el.dataset.geoLng=coordinate[0];el.dataset.geoLat=coordinate[1];
      el.setAttribute('aria-label','演练任务：'+task.title);el.title=task.title+' · '+({pending:'待处理',active:'执行中',completed:'已完成'}[task.status]||task.status);
      el.innerHTML=`<i class="geo-pin-ground" aria-hidden="true"></i><b>${task.status==='completed'?'✓':'!'}</b><span>${escape(task.title)}</span>`;
      commandMarkers.push(new maplibregl.Marker({element:el,anchor:'center',offset:[0,0],pitchAlignment:'viewport',rotationAlignment:'viewport'}).setLngLat(coordinate).addTo(map));
    }
    for(const resource of resources){
      let coordinate=itemCoordinate(resource);const d=[...deployments].reverse().find(d=>d.resourceId===resource.id&&!['completed','cancelled','canceled','recalled','returned'].includes(d.status));
      if(d){const task=tasks.find(t=>t.id===d.taskId),coords=routeCoordinates(d,resource,task);coordinate=pointAlongRoute(coords,['arrived','onsite'].includes(d.status)?1:d.progress)||coordinate;}
      if(!coordinate)continue;
      const moving=d&&!['arrived','onsite'].includes(d.status);
      const el=document.createElement('button');el.className='geo-command-marker geo-command-resource'+(moving?' moving':'');el.type='button';el.dataset.commandResource=resource.id;el.dataset.geoLng=coordinate[0];el.dataset.geoLat=coordinate[1];el.setAttribute('aria-label','应急力量：'+resource.name);el.title=resource.name+(moving?' · 正沿派遣路线出动':d?' · 已到达现场':' · 待命');
      el.innerHTML=`<i class="geo-pin-ground" aria-hidden="true"></i><b>◆</b><span>${escape(resource.name)}</span>`;
      commandMarkers.push(new maplibregl.Marker({element:el,anchor:'center',offset:[0,0],pitchAlignment:'viewport',rotationAlignment:'viewport'}).setLngLat(coordinate).addTo(map));
    }
    commandMarkers.forEach(m=>{m.getElement().hidden=!visible.command;});
    for(const id of ['command-routes','command-routes-halo'])map.setLayoutProperty(id,'visibility',visible.command?'visible':'none');
    syncAnnotations();
  }
  function allAnnotations(){return ctx?.command?ctx.command.annotations||[]:localAnnotations;}
  function syncAnnotations(){
    if(!loaded)return;
    const features=allAnnotations().filter(a=>a?.geometry&&['Point','LineString','Polygon','MultiLineString','MultiPolygon'].includes(a.geometry.type)).map((a,i)=>({type:'Feature',properties:{id:String(a.id??'local-'+i),title:a.title||'地图标绘',color:safeColor(a.color),radiusMeters:Number(a.radiusMeters)||0},geometry:a.geometry}));
    map.getSource('command-annotations')?.setData({type:'FeatureCollection',features});
    for(const prefix of ['command-annotations','command-draft'])for(const type of ['fill','line','point'])map.setLayoutProperty(prefix+'-'+type,'visibility',visible.annotations?'visible':'none');
    updateDrawingData();
  }
  function safeColor(value){return /^#[0-9a-f]{6}$/i.test(value||'')?value:'#f5ae52';}
  function distanceMeters(a,b){const toRad=Math.PI/180,dLat=(b[1]-a[1])*toRad,dLng=(b[0]-a[0])*toRad;const h=Math.sin(dLat/2)**2+Math.cos(a[1]*toRad)*Math.cos(b[1]*toRad)*Math.sin(dLng/2)**2;return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));}
  function circleGeometry(center,edge){
    const radius=distanceMeters(center,edge),angular=radius/6371000,lat=center[1]*Math.PI/180,lng=center[0]*Math.PI/180,ring=[];
    for(let i=0;i<=72;i++){const bearing=i/72*Math.PI*2,lat2=Math.asin(Math.sin(lat)*Math.cos(angular)+Math.cos(lat)*Math.sin(angular)*Math.cos(bearing)),lng2=lng+Math.atan2(Math.sin(bearing)*Math.sin(angular)*Math.cos(lat),Math.cos(angular)-Math.sin(lat)*Math.sin(lat2));ring.push([lng2*180/Math.PI,lat2*180/Math.PI]);}
    return {geometry:{type:'Polygon',coordinates:[ring]},radiusMeters:radius,center:[...center]};
  }
  function buildDrawing(includePointer=false){
    if(!drawing)return null;
    const coords=drawing.coordinates.map(p=>[...p]);if(includePointer&&drawing.pointer&&coords.length)coords.push(drawing.pointer);
    if(drawing.mode==='point'&&coords.length)return {geometry:{type:'Point',coordinates:coords[0]}};
    if(drawing.mode==='line'&&coords.length>=2)return {geometry:{type:'LineString',coordinates:coords}};
    if(drawing.mode==='polygon'&&coords.length>=3)return {geometry:{type:'Polygon',coordinates:[[...coords,coords[0]]]}};
    if(drawing.mode==='circle'&&coords.length>=2)return circleGeometry(coords[0],coords.at(-1));
    return null;
  }
  function updateDrawingData(){
    if(!loaded)return;
    const features=[],draft=buildDrawing(true),color=drawing?.color||drawingColor;
    if(draft)features.push({type:'Feature',properties:{color},geometry:draft.geometry});
    if(drawing){for(const coordinate of drawing.coordinates)features.push({type:'Feature',properties:{color},geometry:{type:'Point',coordinates:coordinate}});if(!draft&&drawing.coordinates.length&&drawing.pointer)features.push({type:'Feature',properties:{color},geometry:{type:'LineString',coordinates:[drawing.coordinates[0],drawing.pointer]}});}
    map.getSource('command-draft')?.setData({type:'FeatureCollection',features});
  }
  function isCapturing(){return !!drawing||typeof locationCallback==='function';}
  function nearestNode(coordinate){return Object.entries(points).sort((a,b)=>distanceMeters(coordinate,a[1])-distanceMeters(coordinate,b[1]))[0]?.[0];}
  function captureMapClick(event){if(!isCapturing())return;event.originalEvent?.preventDefault();consumeCoordinate([event.lngLat.lng,event.lngLat.lat]);}
  function consumeCoordinate(coordinate){
    popup?.remove();
    if(locationCallback){const callback=locationCallback;locationCallback=null;updateDrawingReadout();callback({lngLat:[+coordinate[0].toFixed(7),+coordinate[1].toFixed(7)],nodeId:nearestNode(coordinate)});return;}
    if(!drawing)return;
    if(drawing.coordinates.length&&distanceMeters(drawing.coordinates.at(-1),coordinate)<.1)return;
    drawing.coordinates.push(coordinate);drawing.pointer=null;updateDrawingData();updateDrawingReadout();
    if(drawing.mode==='point'||drawing.mode==='circle'&&drawing.coordinates.length===2)finishDrawing();
  }
  function setDrawing(modeValue,color=drawingColor){
    locationCallback=null;popup?.remove();drawingColor=safeColor(color);
    drawing=['point','line','polygon','circle'].includes(modeValue)?{mode:modeValue,color:drawingColor,coordinates:[],pointer:null}:null;
    visible.annotations=true;const checkbox=document.querySelector('[data-geo-layer="annotations"]');if(checkbox)checkbox.checked=true;
    if(drawing)map?.doubleClickZoom.disable();else map?.doubleClickZoom.enable();
    updateDrawingReadout();syncAnnotations();return !!drawing;
  }
  function finishDrawing(){
    if(!drawing)return;
    const result=buildDrawing();if(!result){updateDrawingReadout('点至少 1 个，线至少 2 个，面至少 3 个，圆需圆心和边界。');return;}
    const payload={...result,color:drawing.color};
    if(annotationCallback)annotationCallback(payload);else {localAnnotations.push({...payload,id:'local-'+Date.now()+'-'+(++annotationSerial)});if(ctx?.command){ctx.command.annotations=ctx.command.annotations||[];ctx.command.annotations.push(localAnnotations.at(-1));}}
    drawing=null;map?.doubleClickZoom.enable();updateDrawingReadout();syncAnnotations();
  }
  function cancelDrawing(){drawing=null;locationCallback=null;map?.doubleClickZoom.enable();updateDrawingReadout();updateDrawingData();}
  function updateDrawingReadout(message){
    const status=document.querySelector('.geo-draw-status');if(status){status.hidden=!isCapturing()&&!message;const text=message||(locationCallback?'点击地图选择任务位置':drawing?({point:'点击地图放置标记',line:'依次点击折线节点',polygon:'依次点击区域边界',circle:drawing.coordinates.length?'点击圆的边界点':'点击地图确定圆心'}[drawing.mode])+` · ${drawing.coordinates.length} 个点`:'');status.innerHTML=`<span>${escape(text)}</span>${drawing?'<button data-geo-action="draw-finish">完成</button>':''}${isCapturing()?'<button data-geo-action="draw-cancel">取消</button>':''}`;}
    if(map)map.getCanvas().style.cursor=isCapturing()?'crosshair':'';
    document.querySelectorAll('[data-geo-draw]').forEach(button=>button.classList.toggle('active',button.dataset.geoDraw===drawing?.mode));
  }
  function removeAnnotation(id){
    if(ctx?.command)ctx.command.annotations=(ctx.command.annotations||[]).filter(a=>String(a.id)!==String(id));
    localAnnotations=localAnnotations.filter(a=>String(a.id)!==String(id));popup?.remove();syncAnnotations();
    window.dispatchEvent(new CustomEvent('command-annotations-remove',{detail:{ids:[String(id)]}}));
  }
  function currentWeather(){
    const w=ctx?.command?.weather||localWeather;
    return {type:['clear','cloud','rain','fog'].includes(w.type)?w.type:'clear',rain:Math.max(0,Math.min(150,Number(w.rain)||0)),night:!!w.night};
  }
  function changeWeather(change){
    const next={...currentWeather(),...change};localWeather=next;
    window.dispatchEvent(new CustomEvent('command-weather',{detail:next}));
    // The command UI owns persistence. Its handler may update ctx synchronously.
    applyWeather();
  }
  function applyWeather(){
    const w=currentWeather(),overlay=document.querySelector('.geo-atmosphere');
    if(overlay){overlay.dataset.weather=visible.weather?w.type:'clear';overlay.classList.toggle('is-night',visible.weather&&w.night);overlay.style.setProperty('--rain-opacity',String(.2+w.rain/190));overlay.hidden=!visible.weather;}
    document.querySelectorAll('[data-geo-weather]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.geoWeather===w.type)));
    const range=document.querySelector('[data-geo-rain]');if(range)range.value=w.rain;
    const output=document.querySelector('[data-geo-rain-value]');if(output)output.textContent=w.rain;
    const night=document.querySelector('[data-geo-night]');if(night)night.checked=w.night;
    if(map&&loaded)map.setLight({anchor:'viewport',color:w.night?'#a8c5e6':'#fff8e9',intensity:w.night?.15:.45,position:[1.5,w.night?45:210,w.night?75:35]});
    if(visible.weather&&w.type==='rain'&&w.rain>0&&!rainFrame)rainFrame=requestAnimationFrame(drawRain);
    if((!visible.weather||w.type!=='rain'||!w.rain)&&rainFrame){cancelAnimationFrame(rainFrame);rainFrame=null;rainDrops=[];if(weatherCanvas)weatherCanvas.getContext('2d')?.clearRect(0,0,weatherCanvas.width,weatherCanvas.height);}
  }
  function drawRain(time){
    rainFrame=null;const w=currentWeather();
    if(!weatherCanvas?.isConnected||!visible.weather||w.type!=='rain'||!w.rain)return;
    if(time-rainLast<32){rainFrame=requestAnimationFrame(drawRain);return;}rainLast=time;
    const rect=weatherCanvas.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,2),width=rect.width,height=rect.height;if(!width||!height)return;
    if(weatherCanvas.width!==Math.round(width*ratio)||weatherCanvas.height!==Math.round(height*ratio)){weatherCanvas.width=Math.round(width*ratio);weatherCanvas.height=Math.round(height*ratio);rainDrops=[];}
    const canvas=weatherCanvas.getContext('2d');canvas.setTransform(ratio,0,0,ratio,0,0);canvas.clearRect(0,0,width,height);
    const count=Math.round(20+w.rain*1.25);while(rainDrops.length<count)rainDrops.push({x:Math.random()*(width+100),y:Math.random()*height,s:10+Math.random()*12});rainDrops.length=count;
    canvas.strokeStyle=`rgba(172,213,239,${.2+w.rain/400})`;canvas.lineWidth=1;canvas.beginPath();
    for(const drop of rainDrops){drop.x-=4;drop.y+=drop.s*(.6+w.rain/100);if(drop.y>height+30){drop.y=-30;drop.x=Math.random()*(width+100);}if(drop.x< -30)drop.x=width+30;canvas.moveTo(drop.x,drop.y);canvas.lineTo(drop.x-5,drop.y+drop.s);}
    canvas.stroke();rainFrame=requestAnimationFrame(drawRain);
  }
  function applyBaseMode(){
    if(!loaded)return;const dark=baseMode==='dark';
    map.setPaintProperty('background','background-color',dark?'#132b35':'#e7e9df');map.setPaintProperty('water','fill-color',dark?'#184b60':'#9ccbd4');map.setPaintProperty('water-outline','line-color',dark?'#2b6070':'#86b9c5');map.setPaintProperty('green','fill-opacity',dark?.25:.8);map.setPaintProperty('streets-casing','line-color',dark?'#243f49':'#c5c6bd');map.setPaintProperty('streets','line-color',dark?'#48616a':['match',['get','class'],'motorway','#f1d09a','primary','#f6dfa4','secondary','#f8e5b7','#f8f7ef']);
    document.querySelector('.geo-viewport')?.classList.toggle('geo-dark-map',dark);
    document.querySelectorAll('[data-geo-basemap]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.geoBasemap===baseMode)));
  }
  function applyVisibility(){
    if(!loaded)return;
    showNetwork=visible.network;
    for(const id of ['teaching-roads','teaching-roads-halo','flood-areas'])map.setLayoutProperty(id,'visibility',visible.network?'visible':'none');
    for(const id of ['building-footprints','buildings-3d'])map.setLayoutProperty(id,'visibility',visible.buildings?'visible':'none');
    const trainingVisible=visible.network&&!ctx?.command;
    markers.filter(m=>!m._geoLabel).forEach(m=>{m.getElement().hidden=!trainingVisible;});roads.forEach(m=>{m.getElement().hidden=!trainingVisible||!labels;});crewMarkers.forEach(m=>{m.getElement().hidden=!trainingVisible;});
    for(const id of ['command-routes','command-routes-halo'])map.setLayoutProperty(id,'visibility',visible.command?'visible':'none');commandMarkers.forEach(m=>{m.getElement().hidden=!visible.command;});
    syncAnnotations();applyWeather();updateReadout();
  }
  function syncToolControls(){
    document.querySelectorAll('[data-geo-layer]').forEach(input=>{input.checked=!!visible[input.dataset.geoLayer];});
    document.querySelectorAll('[data-geo-basemap]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.geoBasemap===baseMode)));
    const networkButton=document.querySelector('[data-geo-action="network"]');if(networkButton)networkButton.setAttribute('aria-pressed',String(visible.network));
    const labelsButton=document.querySelector('[data-geo-action="labels"]');if(labelsButton)labelsButton.setAttribute('aria-pressed',String(labels));
    const color=document.querySelector('[data-geo-color]');if(color)color.value=drawingColor;
  }
  function setLocationPicker(callback){cancelDrawing();locationCallback=typeof callback==='function'?callback:null;popup?.remove();updateDrawingReadout();}
  function focusLocation(coordinate,title){if(!map||!validCoordinate(coordinate))return;stopTour();map.flyTo({center:coordinate,zoom:16.8,pitch:mode==='flat'?0:58,bearing:-18,duration:1100});if(title){popup?.remove();popup=new maplibregl.Popup().setLngLat(coordinate).setHTML(`<div class="geo-tooltip"><b>${escape(title)}</b></div>`).addTo(map);}}
  function exportSceneImage(){
    if(!map||!loaded)return null;
    const source=map.getCanvas(),canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;const out=canvas.getContext('2d');out.drawImage(source,0,0);const ratio=source.width/source.clientWidth;
    const w=currentWeather();if(visible.weather){if(w.type==='fog'||w.type==='cloud'){out.fillStyle=w.type==='fog'?'rgba(218,232,234,.32)':'rgba(95,116,134,.18)';out.fillRect(0,0,canvas.width,canvas.height);}if(w.night){out.fillStyle='rgba(5,19,42,.38)';out.fillRect(0,0,canvas.width,canvas.height);}if(weatherCanvas?.width&&w.type==='rain')out.drawImage(weatherCanvas,0,0,canvas.width,canvas.height);}
    out.scale(ratio,ratio);out.font='600 11px "Microsoft YaHei",sans-serif';
    function pin(coordinate,text,color,offset=0){const p=map.project(coordinate);if(p.x<0||p.y<0||p.x>source.clientWidth||p.y>source.clientHeight)return;out.beginPath();out.arc(p.x,p.y,4,0,Math.PI*2);out.fillStyle=color;out.fill();out.strokeStyle='#fff';out.lineWidth=1.5;out.stroke();if(offset){out.beginPath();out.moveTo(p.x,p.y);out.lineTo(p.x,p.y+offset);out.strokeStyle=color;out.lineWidth=1;out.stroke();}const width=out.measureText(text).width;out.fillStyle='rgba(8,32,44,.88)';out.fillRect(p.x+9,p.y-9+offset,width+10,20);out.fillStyle='#effcff';out.fillText(text,p.x+14,p.y+5+offset);}
    if(visible.network&&!ctx?.command)for(const n of window.FloodLab?.nodes||[])if(points[n.id])pin(points[n.id],n.name,'#55dcbf');
    if(visible.command){for(const task of ctx?.command?.tasks||[]){const coordinate=itemCoordinate(task);if(coordinate)pin(coordinate,task.title,task.status==='completed'?'#59d5a6':'#ffb75b',-27);}for(const marker of commandMarkers){const el=marker.getElement();if(el.dataset.commandResource)pin(marker.getLngLat().toArray(),el.textContent.replace('◆',''),'#83c8ff',27);}}
    out.fillStyle='rgba(7,25,35,.88)';out.fillRect(0,source.clientHeight-34,source.clientWidth,34);out.fillStyle='#e3f4f7';out.font='11px "Microsoft YaHei",sans-serif';out.fillText('徐州云龙湖 · 洪涝应急教学场景  |  虚拟灾情与教学通道，非实际应急导航',14,source.clientHeight-13);
    return canvas.toDataURL('image/png');
  }
  function sync(){
    if(!loaded||!ctx)return;
    const E=window.FloodLab,s=ctx.state;
    const masked=!!s.assessment&&s.assessment.phase==='active';
    const reachable=E.reachable(s);
    const features=s.edges.map(e=>({type:'Feature',properties:{id:e.id,color:colors[E.status(s,e)],highlighted:(ctx.routeEdges||[]).includes(e.id)},geometry:{type:'LineString',coordinates:coordinatesForEdge(e)}}));
    map.getSource('teaching').setData({type:'FeatureCollection',features});
    const pools=s.edges.filter(e=>e.depth>=.15).map(e=>{
      const coords=coordinatesForEdge(e),p=coords[Math.floor(coords.length/2)],dx=.0007,dy=.00045;
      return {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[p[0]-dx,p[1]-dy],[p[0]+dx,p[1]-dy],[p[0]+dx,p[1]+dy],[p[0]-dx,p[1]+dy],[p[0]-dx,p[1]-dy]]]}};
    });
    map.getSource('flood-areas').setData({type:'FeatureCollection',features:pools});
    markers.filter(m=>!m._geoLabel).forEach(m=>m.remove());markers=markers.filter(m=>m._geoLabel);
    for(const n of E.nodes){
      const el=document.createElement('button');el.className=`geo-marker kind-${n.kind}${!masked&&!reachable.has(n.id)?' isolated':''}${s.selection.includes(n.id)?' selected':''}`;
      el.dataset.node=n.id;el.type='button';el.setAttribute('aria-label',`${n.name}，教学点位`);
      el.innerHTML=`<i class="geo-pin-ground" aria-hidden="true"></i><span class="marker-icon">${s.selection.includes(n.id)?'✓':symbols[n.kind]||n.id}</span><span class="marker-label">${escape(n.name)}<small>${n.pop?n.pop+' 人 · 教学点位':'教学点位'}</small></span>`;
      el.querySelector('.marker-label').hidden=!labels;
      markers.push(new maplibregl.Marker({element:el,anchor:'center',offset:[0,0],pitchAlignment:'viewport',rotationAlignment:'viewport'}).setLngLat(points[n.id]).addTo(map));
    }
    roads.forEach(m=>m.remove());roads=[];
    for(const e of s.edges){
      const el=document.createElement('button');el.className='geo-road-marker';el.dataset.road=e.id;el.textContent=e.id;el.title=`${e.id} · ${titles[E.status(s,e)]}`;el.style.setProperty('--road-color',colors[E.status(s,e)]);el.hidden=!labels||!showNetwork;
      roads.push(new maplibregl.Marker({element:el}).setLngLat(lineMidpoint(coordinatesForEdge(e))).addTo(map));
    }
    crewMarkers.forEach(m=>m.remove());crewMarkers=[];
    for(const crew of s.crews.filter(c=>c.job)){
      const e=s.edges.find(e=>e.id===crew.job.edge);const el=document.createElement('span');el.className='geo-crew-marker';el.textContent='⚒';el.title=`${crew.name} · ${e.id} · T+${crew.job.end} 完工`;
      crewMarkers.push(new maplibregl.Marker({element:el,offset:[0,-23]}).setLngLat(lineMidpoint(coordinatesForEdge(e))).addTo(map));
    }
    syncCommand();applyBaseMode();applyVisibility();
  }
  function updateReadout(){
    if(!map)return;
    const z=map.getZoom(),p=map.getPitch();
    const label=document.querySelector('[data-geo-zoom-label]');if(label)label.textContent=z<15?'区域总览 · 2D':p>15?'街区建筑 · 3D':'街区地图 · 2D';
    const altitude=document.querySelector('[data-geo-altitude]');if(altitude)altitude.textContent=`缩放 ${z.toFixed(1)} · 倾角 ${Math.round(p)}° · ${z<15?'滚轮拉近进入建筑场景':'右键拖动旋转 / 调整倾角'}`;
    markers.filter(m=>m._geoLabel).forEach(m=>{m.getElement().hidden=!labels||!visible.geography||z>16.5;});
  }
  function flyTo(preset){
    if(!map||!presets[preset])return;
    mode='auto';
    document.querySelectorAll('[data-camera-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.cameraMode==='auto');b.setAttribute('aria-pressed',String(b.dataset.cameraMode==='auto'));});
    const options={...presets[preset]};
    map.flyTo({...options,duration:1700,essential:false});
  }
  function focus(id){
    if(!map||!points[id])return;
    stopTour();map.flyTo({center:points[id],zoom:17,pitch:mode==='flat'?0:58,bearing:-18,duration:1600});
  }
  function stopTour(){clearTimeout(tourTimer);tourTimer=null;const b=document.querySelector('[data-geo-action=tour]');if(b)b.textContent='▷ 场景漫游';}
  document.addEventListener('click',event=>{
    if(!isCapturing())return;
    const element=event.target.closest('.geo-marker,.geo-road-marker,.geo-command-marker');if(!element||!map)return;
    event.preventDefault();event.stopImmediatePropagation();
    const rect=map.getCanvas().getBoundingClientRect(),point=map.unproject([event.clientX-rect.left,event.clientY-rect.top]);
    const coordinate=points[element.dataset.node]||(element.dataset.geoLng?[Number(element.dataset.geoLng),Number(element.dataset.geoLat)]:[point.lng,point.lat]);consumeCoordinate(coordinate);
  },true);
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-camera-mode],[data-camera-preset],[data-geo-action],[data-focus-node],[data-geo-draw],[data-geo-basemap],[data-geo-weather],[data-geo-delete-annotation]');if(!button)return;
    const d=button.dataset;
    if(d.geoDraw){setDrawing(d.geoDraw,drawingColor);document.querySelector('.geo-tools')?.removeAttribute('open');return;}
    if(d.geoBasemap){baseMode=d.geoBasemap;applyBaseMode();return;}
    if(d.geoWeather){changeWeather({type:d.geoWeather});return;}
    if(d.geoDeleteAnnotation){removeAnnotation(d.geoDeleteAnnotation);return;}
    if(d.cameraMode){mode=d.cameraMode;stopTour();document.querySelectorAll('[data-camera-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.cameraMode===mode);b.setAttribute('aria-pressed',String(b.dataset.cameraMode===mode));});if(map)map.easeTo({zoom:mode==='3d'?Math.max(16,map.getZoom()):map.getZoom(),pitch:mode==='flat'?0:mode==='3d'?58:Math.max(0,Math.min(58,(map.getZoom()-14.5)*30)),duration:1200});return;}
    if(d.cameraPreset){stopTour();flyTo(d.cameraPreset);return;}
    if(d.focusNode){focus(d.focusNode);return;}
    switch(d.geoAction){
      case 'labels':labels=!labels;button.setAttribute('aria-pressed',String(labels));sync();break;
      case 'network':showNetwork=!showNetwork;visible.network=showNetwork;button.setAttribute('aria-pressed',String(showNetwork));{const checkbox=document.querySelector('[data-geo-layer="network"]');if(checkbox)checkbox.checked=showNetwork;}applyVisibility();break;
      case 'fullscreen':{const el=document.querySelector('.geo-viewport');if(document.fullscreenElement)document.exitFullscreen?.();else el?.requestFullscreen?.().catch(()=>{});break;}
      case 'retry':map?.remove();map=null;loaded=false;failed=false;dataPromise=null;markers=[];roads=[];crewMarkers=[];commandMarkers=[];document.querySelector('.geo-error')?.setAttribute('hidden','');document.querySelector('.geo-loading')?.removeAttribute('hidden');init();break;
      case 'draw-finish':finishDrawing();break;
      case 'draw-cancel':cancelDrawing();break;
      case 'draw-clear':localAnnotations=[];if(ctx?.command)ctx.command.annotations=[];popup?.remove();cancelDrawing();syncAnnotations();window.dispatchEvent(new CustomEvent('command-annotations-remove',{detail:{all:true}}));break;
      case 'screenshot':{const url=exportSceneImage();if(!url)break;const link=document.createElement('a');link.href=url;link.download='徐州洪涝应急场景-'+new Date().toISOString().slice(0,10)+'.png';link.click();break;}
      case 'topology':act({action:'geo-topology'});break;
      case 'sources':act({action:'geo-sources'});break;
      case 'tour':if(tourTimer){stopTour();break;}flyTo('overview');button.textContent='Ⅱ 停止漫游';tourTimer=setTimeout(()=>{flyTo('district');tourTimer=setTimeout(()=>{flyTo('facility');tourTimer=setTimeout(stopTour,3500);},4500);},3500);break;
    }
  });
  document.addEventListener('change',event=>{
    const input=event.target;
    if(input.matches('[data-geo-layer]')){visible[input.dataset.geoLayer]=input.checked;const networkButton=document.querySelector('[data-geo-action="network"]');if(networkButton)networkButton.setAttribute('aria-pressed',String(visible.network));applyVisibility();}
    if(input.matches('[data-geo-color]')){drawingColor=safeColor(input.value);if(drawing){drawing.color=drawingColor;updateDrawingData();}}
    if(input.matches('[data-geo-night]'))changeWeather({night:input.checked});
  });
  document.addEventListener('input',event=>{if(event.target.matches('[data-geo-rain]'))changeWeather({rain:Number(event.target.value)});});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&isCapturing()){event.preventDefault();cancelDrawing();}if(event.key==='Enter'&&drawing&&event.target===document.body){event.preventDefault();finishDrawing();}});
  window.addEventListener('resize',()=>map?.resize());
  document.addEventListener('fullscreenchange',()=>setTimeout(()=>map?.resize(),80));
  return {template,detach,mount,focus,focusLocation,getMap:()=>map,getData:()=>fullData,getPoints:()=>points,
    onAnnotation:callback=>{annotationCallback=typeof callback==='function'?callback:null;},setDrawing,
    getAnnotationDraft:()=>drawing?{...buildDrawing(),color:drawing.color,mode:drawing.mode,coordinates:drawing.coordinates.map(p=>[...p])}:null,
    setLocationPicker,exportSceneImage};
})();
