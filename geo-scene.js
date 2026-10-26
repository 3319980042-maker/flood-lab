(function(root){
  'use strict';
  const api = {
    bounds: [[117.08,34.225],[117.26,34.295]],
    points: {
      S:[117.144,34.250],J:[117.157,34.253],C:[117.168535,34.259961],D:[117.186685,34.249213],
      E:[117.188,34.264],N:[117.171,34.266],A:[117.182583,34.252217],B:[117.176530,34.264465],
      H:[117.180783,34.270007],V:[117.164069,34.264279],K:[117.180931,34.257349],W:[117.164675,34.262200]
    }
  };
  root.FloodGeography=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);

;
/* Shared geographical renderer for real-street and historical topology experiments. */
window.FloodGeoScene = (() => {
  'use strict';
  const CENTER = [117.164, 34.253];
  const BOUNDS = [[117.08, 34.225], [117.26, 34.295]];
  const points = window.FloodGeography.points;
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
  let correctingCamera=false;
  const visible={network:true,buildings:true,detail:true,geography:true,weather:true,annotations:true,command:true};
  const networkModes={practice:true,command:false};
  const empty=()=>({type:'FeatureCollection',features:[]});

  function toolTemplate(real=false){
    const w=currentWeather();
    return `<details class="geo-tools" ${toolsOpen?'open':''}><summary>☷ 场景工具</summary><div class="geo-tool-body">
      <fieldset><legend>图层与底图</legend><div class="geo-tool-checks">${[['network',real?'真实路况':'教学通道'],['buildings','三维建筑'],['detail','街区细节'],['geography','地理名称'],['weather','天气特效'],['annotations','地图标绘'],['command','任务与力量']].map(([id,name])=>`<label><input type="checkbox" data-geo-layer="${id}" ${visible[id]?'checked':''}>${name}</label>`).join('')}</div><div class="geo-basemaps"><button data-geo-basemap="geographic" aria-pressed="${baseMode==='geographic'}">自然日景</button><button data-geo-basemap="dark" aria-pressed="${baseMode==='dark'}">深色地图</button></div><p class="geo-tool-note">本地地理数据，可离线使用；未配置卫星影像服务。</p></fieldset>
      <fieldset><legend>地图标绘</legend><div class="geo-draw-buttons">${[['point','• 点'],['line','⌁ 线'],['polygon','△ 面'],['circle','◯ 圆']].map(([id,title])=>`<button data-geo-draw="${id}">${title}</button>`).join('')}<label class="geo-color-label">颜色<input type="color" data-geo-color value="${drawingColor}" aria-label="标绘颜色"></label></div><div class="geo-tool-actions"><button data-geo-action="draw-finish">完成标绘</button><button data-geo-action="draw-cancel">取消</button><button data-geo-action="draw-clear">清空标绘</button></div><p class="geo-tool-note">点：点击定位；线/面：依次点击后完成；圆：圆心与边界两次点击。点击已存标绘可删除。</p></fieldset>
      <fieldset><legend>天气与光照</legend><div class="geo-weather-buttons">${[['clear','晴'],['cloud','云'],['rain','雨'],['fog','雾']].map(([id,title])=>`<button data-geo-weather="${id}" aria-pressed="${w.type===id}">${title}</button>`).join('')}</div><label class="geo-rain-label">雨强 <output data-geo-rain-value>${w.rain}</output> mm/h<input type="range" min="0" max="150" step="5" value="${w.rain}" data-geo-rain aria-label="教学降雨强度"></label><label class="geo-night-label"><input type="checkbox" data-geo-night ${w.night?'checked':''}>夜间光照</label><p class="geo-tool-note">${real?'实景雨强由实验条件控制；地图天气为视觉表达。':'天气为教学视觉特效，非水动力计算。'}</p></fieldset><button class="geo-screenshot" data-geo-action="screenshot">⇩ 保存当前场景截图</button>
      </div></details><div class="geo-draw-status" hidden role="status" aria-live="polite"></div><div class="geo-atmosphere" aria-hidden="true"><canvas class="geo-rain-canvas"></canvas><div class="geo-cloud-effect"></div><div class="geo-fog-effect"></div><div class="geo-night-effect"></div></div>`;
  }

  function template(hero=false){
    const real=hero==='real';
    return `<section class="geo-panel ${hero===true?'geo-hero':''}">
      <div class="geo-heading"><div class="geo-place"><small>XUZHOU · YUNLONG LAKE</small><h2>徐州 · 云龙湖及周边城区</h2><p>${real?'真实路网 · 动态灾情 · 决策验证':'区域地图与三维建筑 · 洪涝应急教学场景'}</p></div>
      <div class="geo-mode-tabs" role="group" aria-label="地图视角模式">${[['auto','自动切换'],['flat','二维地图'],['3d','三维建筑']].map(([id,title])=>`<button data-camera-mode="${id}" class="${mode===id?'active':''}" aria-pressed="${mode===id}">${title}</button>`).join('')}</div></div>
      <div class="geo-viewport"><div class="geo-map-slot" aria-label="徐州可缩放三维地理场景"></div>
      ${toolTemplate(real)}
      <div class="geo-loading" role="status">正在加载徐州地图与建筑…</div>
      <div class="geo-depth-key" aria-label="教学通行水深阈值"><b>积水参考</b><span>m</span><div><i class="key-blocked"></i><i class="key-limited"></i><i class="key-open"></i><em>0.30</em><em>0.15</em><em>0</em></div><small>教学阈值</small></div><div class="geo-corner-tag"><i></i><span data-geo-zoom-label>区域总览 · 2D</span></div>
      <div class="geo-camera-controls" aria-label="镜头位置"><button data-camera-preset="overview">↗ 区域总览</button><button data-camera-preset="district">▥ 湖滨街区</button><button data-camera-preset="facility">✚ 重点设施</button></div>
      ${hero===true?`<aside class="geo-poi-panel"><span class="eyebrow">实验点位</span><h3>在城市中理解灾情</h3><p>选择教学点位，拉近查看建筑与通道。</p><div class="geo-poi-list">${[['A','湖滨教学社区','人口 320 · 居住片区'],['H','教学医院 H','人口 120 · 重点保障'],['B','教学养老院 B','人口 80 · 重点保障'],['S','教学救援基地','专业队伍 · 资源出发点']].map(([id,t,d])=>`<button data-focus-node="${id}"><b>${id}</b><span>${t}<small>${d}</small></span><i>↗</i></button>`).join('')}</div><button class="geo-tour-button" data-geo-action="tour">▷ 场景漫游</button></aside>`:''}
      <div class="geo-bottom-bar"><span data-geo-altitude>滚轮拉近查看三维建筑</span><button data-geo-action="labels" aria-pressed="${labels}">点位标签</button><button data-geo-action="network" aria-pressed="${showNetwork}">${real?'真实路况':'教学路网'}</button><button data-geo-action="fullscreen">⛶ 全屏</button></div>
      <div class="geo-error" hidden role="alert"><strong>当前无法显示三维地图</strong><p>可重试加载，或继续使用教学路网完成实验。</p><button data-geo-action="retry">重试地图</button><button data-geo-action="topology">查看教学路网</button></div>
      </div><div class="geo-legend"><span><i style="background:#24b893"></i>正常</span><span><i style="background:#e6a83c"></i>限行</span><span><i style="background:#ef6170"></i>阻断</span><span><i style="background:#4e91ff"></i>抢修</span><small>${real?'彩色道路参与真实路网计算':'彩色连线为教学任务通道'}</small></div>
      <div class="geo-footer"><span>真实地理与建筑轮廓 · 示意楼高与外观 · ${real?'规则驱动灾情，非水动力淹没预测':'虚拟灾情、设施和教学通道'}</span><button data-geo-action="sources">数据来源与模型说明 ↗</button></div></section>`;
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
      const response=await fetch(`xuzhou-${name}.geojson`);if(!response.ok)throw new Error(`地理数据加载失败: ${name}`);return [name,await response.json()];
    })).then(entries=>Object.fromEntries(entries));
    return dataPromise;
  }
  function init(){
    failed=false;
    try{
      map=new maplibregl.Map({container:host,style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#0d202d'}}]},center:CENTER,zoom:13.25,minZoom:11,maxZoom:19,maxBounds:BOUNDS,pitch:0,maxPitch:58,bearing:0,attributionControl:false,localIdeographFontFamily:'Microsoft YaHei',canvasContextAttributes:{antialias:true,preserveDrawingBuffer:true}});
      // maxBounds constrains the center, but rotated/pitched screen corners can
      // still show beyond the offline data. Keep the entire ground view covered.
      map.on('move',constrainCoverage);
      map.on('resize',constrainCoverage);
      constrainCoverage();
      map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'bottom-right');
      map.addControl(new maplibregl.ScaleControl({maxWidth:100,unit:'metric'}),'bottom-left');
      map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>'}),'bottom-right');
      map.on('load',async()=>{
        try{fullData=await loadData();window.FloodLocalGeoData=fullData;addLayers(fullData);loaded=true;document.querySelector('.geo-loading')?.setAttribute('hidden','');sync();window.dispatchEvent(new Event('flood-map-ready'));}
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
      map.on('click','teaching-roads',event=>{if(isCapturing())return;const f=event.features?.[0];if(!f)return;if(ctx?.realLab){popup?.remove();popup=new maplibregl.Popup().setLngLat(event.lngLat).setHTML(`<div class="geo-tooltip"><b>真实道路段 ${escape(f.properties.segment)}</b><p>${escape(({open:'正常通行',limited:'积水限行，速度减半',blocked:'灾情阻断，禁止通行'})[f.properties.state]||'道路状态')}</p><small>道路段参与当前绕行和可达性计算</small></div>`).addTo(map);return;}act({road:f.properties.id});});
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
  function constrainCoverage(){
    if(!map||correctingCamera)return;
    const container=map.getContainer(),width=container.clientWidth,height=container.clientHeight;
    if(width<1||height<1)return;
    correctingCamera=true;
    try{
      const M=maplibregl.MercatorCoordinate;
      const nw=M.fromLngLat([BOUNDS[0][0],BOUNDS[1][1]]),se=M.fromLngLat([BOUNDS[1][0],BOUNDS[0][1]]);
      // A flat Mercator ground plane gives a convex screen footprint. Its four
      // corners bound everything visible, including the distant edge in 3D.
      for(let attempt=0;attempt<6;attempt++){
        const center=M.fromLngLat(map.getCenter());
        const corners=[[0,0],[width,0],[width,height],[0,height]].map(point=>M.fromLngLat(map.unproject(point)));
        if(corners.some(point=>!Number.isFinite(point.x)||!Number.isFinite(point.y)))break;
        const dx=corners.map(point=>point.x-center.x),dy=corners.map(point=>point.y-center.y);
        const left=Math.min(...dx),right=Math.max(...dx),top=Math.min(...dy),bottom=Math.max(...dy);
        const ratio=Math.max((right-left)/(se.x-nw.x),(bottom-top)/(se.y-nw.y));
        // The floor follows the viewport, bearing and pitch, rather than a
        // fixed zoom number. A tiny inset avoids floating point boundary slivers.
        const minimum=Math.min(19,Math.max(0,map.getZoom()+Math.log2(ratio)+.002));
        const zoom=Math.max(map.getZoom(),minimum),scale=Math.pow(2,zoom-map.getZoom());
        const x=Math.max(nw.x-left/scale,Math.min(se.x-right/scale,center.x));
        const y=Math.max(nw.y-top/scale,Math.min(se.y-bottom/scale,center.y));
        const changed=Math.abs(x-center.x)>1e-11||Math.abs(y-center.y)>1e-11||zoom-map.getZoom()>1e-7;
        if(Math.abs(map.getMinZoom()-minimum)>1e-6)map.setMinZoom(minimum);
        if(!changed)break;
        map.jumpTo({center:new M(x,y).toLngLat(),zoom});
      }
    }finally{correctingCamera=false;}
  }
  function coverRegion(){
    if(!map)return;
    stopTour();
    mode='auto';
    document.querySelectorAll('[data-camera-mode]').forEach(button=>{button.classList.toggle('active',button.dataset.cameraMode===mode);button.setAttribute('aria-pressed',String(button.dataset.cameraMode===mode));});
    // Fill the canvas with available data. A portrait viewport crops the west
    // and east sides; users can pan within the same real geographical extent.
    const M=maplibregl.MercatorCoordinate;
    const nw=M.fromLngLat([BOUNDS[0][0],BOUNDS[1][1]]),se=M.fromLngLat([BOUNDS[1][0],BOUNDS[0][1]]);
    const container=map.getContainer();
    const zoom=Math.min(19,Math.max(Math.log2(container.clientWidth/(512*(se.x-nw.x))),Math.log2(container.clientHeight/(512*(se.y-nw.y)))))+.002;
    // Release an orientation-dependent floor before returning to a flat view.
    correctingCamera=true;
    try{
      map.stop();map.setMinZoom(0);
      map.jumpTo({center:new M((nw.x+se.x)/2,(nw.y+se.y)/2).toLngLat(),zoom,pitch:0,bearing:0,padding:0});
    }finally{correctingCamera=false;}
    constrainCoverage();
  }
  function fitCoveredBounds(bounds,options={}){
    if(!map)return;
    stopTour();
    mode='auto';
    document.querySelectorAll('[data-camera-mode]').forEach(button=>{button.classList.toggle('active',button.dataset.cameraMode===mode);button.setAttribute('aria-pressed',String(button.dataset.cameraMode===mode));});
    correctingCamera=true;
    try{
      map.stop();map.setMinZoom(0);
      map.fitBounds(bounds,{...options,bearing:0,pitch:0,duration:0});
    }finally{correctingCamera=false;}
    constrainCoverage();
  }
  // Visual detail is derived from the footprint geometry; it never enters routing or flood calculations.
  function addSceneDetail(data){
    const collection=features=>({type:'FeatureCollection',features}),features=[],roofs=[],windows=[],trees=[],markings=[],shadows=[];
    let seed=47017;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
    const meterX=1/(111320*Math.cos(34.26*Math.PI/180)),meterY=1/111320;
    const move=(p,x,y)=>[p[0]+x*meterX,p[1]+y*meterY];
    const polygon=(ring,props)=>({type:'Feature',properties:props,geometry:{type:'Polygon',coordinates:[ring]}});
    const disk=(p,r,props)=>polygon(Array.from({length:9},(_,i)=>move(p,Math.cos(i*Math.PI/4)*r,Math.sin(i*Math.PI/4)*r)),props);
    const inside=(p,ring)=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
    const envelopes=[];
    for(const f of data.buildings.features){
      const parts=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];
      for(const coordinates of parts){
        const ring=coordinates[0],h=Number(f.properties.render_height)||9,base=Number(f.properties.render_min_height)||0;
        const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]),box=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
        envelopes.push({ring,box});
        const variant=Math.floor(random()*4),wall=['#c5b9a6','#c1c1b4','#b8b7ae','#d3c9b7'][variant],roof=['#827d73','#777f7b','#988879','#9b8171'][variant];
        features.push({type:'Feature',geometry:{type:'Polygon',coordinates},properties:{...f.properties,facade:wall,roof}});
        roofs.push({type:'Feature',geometry:{type:'Polygon',coordinates},properties:{base:h,height:h+.35,color:roof}});
        const shift=[-h*.32*meterX,h*.18*meterY];
        shadows.push(polygon(ring.map(p=>[p[0]+shift[0],p[1]+shift[1]]),{}));
        // The close-view detail covers the teaching precinct, with a fixed budget on geometry.
        if(box[2]<117.166||box[0]>117.191||box[3]<34.25||box[1]>34.277||h<4)continue;
        let area=0;for(let i=1;i<ring.length;i++)area+=ring[i-1][0]*ring[i][1]-ring[i][0]*ring[i-1][1];
        const floors=Math.min(14,Math.floor((h-base-.6)/3.2));
        for(let e=1;e<ring.length&&windows.length<18000;e++){
          const a=ring[e-1],b=ring[e],dx=(b[0]-a[0])/meterX,dy=(b[1]-a[1])/meterY,len=Math.hypot(dx,dy);if(len<5||len>240)continue;
          const ux=dx/len,uy=dy/len,nx=(area>0?uy:-uy),ny=(area>0?-ux:ux),columns=Math.min(24,Math.floor((len-1)/3.8));
          for(let floor=0;floor<floors&&windows.length<18000;floor++)for(let col=0;col<columns&&windows.length<18000;col++){
            const mid=(col+1)*len/(columns+1),w=1.35,point=move(a,ux*mid+nx*.12,uy*mid+ny*.12);
            const p1=move(point,-ux*w/2,-uy*w/2),p2=move(point,ux*w/2,uy*w/2),p3=move(p2,-nx*.18,-ny*.18),p4=move(p1,-nx*.18,-ny*.18);
            windows.push(polygon([p1,p2,p3,p4,p1],{base:base+floor*3.2+1.15,height:base+floor*3.2+2.6,color:random()>.18?'#4e6973':'#7e8b85'}));
          }
        }
      }
    }
    const waterRings=data.water.features.flatMap(f=>f.geometry.type==='Polygon'?[f.geometry.coordinates[0]]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates.map(p=>p[0]):[]);
    const occupied=p=>envelopes.some(e=>p[0]>=e.box[0]&&p[0]<=e.box[2]&&p[1]>=e.box[1]&&p[1]<=e.box[3]&&inside(p,e.ring))||waterRings.some(r=>inside(p,r));
    let treeCount=0;const treeCandidates=[];
    const addTree=p=>treeCandidates.push(p);
    const makeTree=p=>{
      if(treeCount>=580||p[0]<117.171||p[0]>117.186||p[1]<34.259||p[1]>34.274||occupied(p))return;const r=2.3+random()*1.2,h=5+random()*2;treeCount++;
      trees.push(disk(p,.28,{base:0,height:2.7,color:'#74614e',part:'trunk'}));
      trees.push(disk(p,r*.75,{base:2.4,height:3.6,color:'#657e50',part:'crown'}));
      trees.push(disk(p,r,{base:3.6,height:h-.8,color:random()>.5?'#738b57':'#6b8455',part:'crown'}));
      trees.push(disk(p,r*.66,{base:h-.8,height:h,color:'#849963',part:'crown'}));
    };
    for(const f of data.roads.features){
      if(!['primary','secondary','tertiary'].includes(f.properties.class))continue;
      const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.type==='MultiLineString'?f.geometry.coordinates:[];
      for(const line of lines){
        for(let i=1;i<line.length;i++){
          const a=line[i-1],b=line[i],dx=(b[0]-a[0])/meterX,dy=(b[1]-a[1])/meterY,len=Math.hypot(dx,dy);if(len<14)continue;
          if(Math.max(a[0],b[0])<117.167||Math.min(a[0],b[0])>117.19||Math.max(a[1],b[1])<34.252||Math.min(a[1],b[1])>34.276)continue;
          const ux=dx/len,uy=dy/len;
          // Street trees and markings are representative details, not surveyed objects.
          for(let t=12;t<len;t+=24){const p=move(a,ux*t,uy*t);addTree(move(p,-uy*10,ux*10));addTree(move(p,uy*10,-ux*10));}
          if(len>35&&markings.length<180){for(let stripe=0;stripe<6;stripe++){
            const p=move(a,ux*(9+stripe*1.15),uy*(9+stripe*1.15)),half=5;
            const q1=move(p,-uy*half,ux*half),q2=move(p,uy*half,-ux*half),q3=move(q2,ux*.55,uy*.55),q4=move(q1,ux*.55,uy*.55);
            markings.push(polygon([q1,q2,q3,q4,q1],{}));
          }}
        }
      }
    }
    treeCandidates.sort((a,b)=>Math.hypot((a[0]-117.1775)*.83,a[1]-34.2652)-Math.hypot((b[0]-117.1775)*.83,b[1]-34.2652));
    for(const point of treeCandidates){if(treeCount>=580)break;makeTree(point);}
    const pattern=(name,draw)=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const c=canvas.getContext('2d');draw(c);map.addImage(name,c.getImageData(0,0,128,128),{pixelRatio:2});};
    pattern('water-surface',c=>{c.fillStyle='#789fa6';c.fillRect(0,0,128,128);for(let i=0;i<150;i++){c.strokeStyle=i%2?'#aac0be28':'#557f8b20';c.lineWidth=.7;const x=random()*128,y=random()*128;c.beginPath();c.moveTo(x,y);c.lineTo(x+4+random()*15,y-.8);c.stroke();}});
    map.addSource('scene-roofs',{type:'geojson',data:collection(roofs)});
    map.addSource('scene-windows',{type:'geojson',data:collection(windows)});
    map.addSource('scene-trees',{type:'geojson',data:collection(trees)});
    map.addSource('scene-markings',{type:'geojson',data:collection(markings)});
    map.addSource('scene-shadows',{type:'geojson',data:collection(shadows)});
    map.getSource('buildings').setData(collection(features));
    map.addLayer({id:'scene-shadows',type:'fill',source:'scene-shadows',minzoom:15.5,paint:{'fill-color':'#303d3f','fill-opacity':.15}},'building-footprints');
    map.addLayer({id:'scene-road-center',type:'line',source:'roads',minzoom:16,filter:['in',['get','class'],['literal',['primary','secondary','tertiary']]],paint:{'line-color':'#e5dca8','line-width':['interpolate',['linear'],['zoom'],16,.65,19,2.2],'line-dasharray':[3,3],'line-opacity':.8}},'building-footprints');
    map.addLayer({id:'scene-crosswalks',type:'fill',source:'scene-markings',minzoom:16.5,paint:{'fill-color':'#e4e3d7','fill-opacity':.8}},'building-footprints');
    for(const [id,source] of [['scene-roofs','scene-roofs'],['scene-windows','scene-windows'],['scene-trees','scene-trees']])map.addLayer({id,type:'fill-extrusion',source,minzoom:id==='scene-windows'?16:15.5,paint:{'fill-extrusion-base':['get','base'],'fill-extrusion-height':['get','height'],'fill-extrusion-color':['get','color'],'fill-extrusion-opacity':1,'fill-extrusion-vertical-gradient':true}});
    map._teachingDetail={buildings:features.length,windows:windows.length,trees:treeCount,markings:markings.length};
  }

  function addLayers(data){
    for(const name of ['landuse','water','roads','buildings'])map.addSource(name,{type:'geojson',data:data[name],attribution:name==='buildings'?'OSM building footprints':''});
    map.addLayer({id:'green',type:'fill',source:'landuse',paint:{'fill-color':['match',['get','class'],'residential','#c8c8b9','commercial','#c7c6ba','industrial','#bcbeb4','forest','#8e9e7e','wood','#8e9e7e','park','#a3b08e','grass','#b1ba9d','#bbc0aa'],'fill-opacity':.8}});
    map.addLayer({id:'water',type:'fill',source:'water',paint:{'fill-color':'#b4d8ef','fill-opacity':1}});
    map.addLayer({id:'water-outline',type:'line',source:'water',paint:{'line-color':'#9ec9e5','line-width':1}});
    map.addLayer({id:'streets-casing',type:'line',source:'roads',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#d7dfe9','line-width':['interpolate',['linear'],['zoom'],12,1,16,['match',['get','class'],'motorway',15,'primary',13,'secondary',11,'tertiary',9,6],19,30]}});
    map.addLayer({id:'streets',type:'line',source:'roads',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':['match',['get','class'],'motorway','#797e7b','primary','#757b7b','secondary','#838986','#959a93'],'line-width':['interpolate',['linear'],['zoom'],12,.6,16,['match',['get','class'],'motorway',12,'primary',10,'secondary',8,'tertiary',6,4],19,25]}});
    map.addLayer({id:'building-footprints',type:'fill',source:'buildings',minzoom:13.8,paint:{'fill-color':'#c1cddd','fill-opacity':['interpolate',['linear'],['zoom'],13.8,0,15,.8]}});
    map.addLayer({id:'buildings-3d',type:'fill-extrusion',source:'buildings',minzoom:14.8,paint:{'fill-extrusion-color':['coalesce',['get','facade'],'#c2bdad'],'fill-extrusion-height':['interpolate',['linear'],['zoom'],14.8,0,15.8,['coalesce',['to-number',['get','render_height']],9]],'fill-extrusion-base':['coalesce',['to-number',['get','render_min_height']],0],'fill-extrusion-opacity':1,'fill-extrusion-vertical-gradient':true}});
    map.setLight({anchor:'viewport',color:'#ffffff',intensity:.45,position:[1.5,210,35]});
    map.addSource('teaching',{type:'geojson',data:empty()});
    map.addLayer({id:'teaching-roads-halo',type:'line',source:'teaching',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#f5fbf8','line-width':4,'line-opacity':.28}});
    map.addLayer({id:'teaching-roads',type:'line',source:'teaching',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':['case',['get','highlighted'],5,['==',['get','state'],'open'],1.4,3],'line-opacity':.95}});
    map.addSource('flood-areas',{type:'geojson',data:empty()});
    map.addLayer({id:'flood-areas',type:'fill',source:'flood-areas',paint:{'fill-color':'#519fc4','fill-opacity':.22}});
    map.addLayer({id:'flood-depth',type:'fill-extrusion',source:'flood-areas',paint:{'fill-extrusion-color':'#4a9fca','fill-extrusion-height':['coalesce',['get','height'],0],'fill-extrusion-opacity':.48}});
    addSceneDetail(data);
    addGeographyLabels(data.labels);
    addCommandLayers();
  }
  function addGeographyLabels(collection){
    // Local Chinese text, with priorities and screen-space collision checks.
    const names=new Set();
    const priority=f=>({place:100,water_name:90,mountain_peak:80})[f.properties._source_layer]||(['park','hospital','college','university'].includes(f.properties.class)?50:20);
    const candidates=collection.features.filter(f=>f.geometry.type==='Point'&&!['bus','parking'].includes(f.properties.class)).sort((a,b)=>priority(b)-priority(a));
    for(const f of candidates){
      const name=f.properties['name:zh']||f.properties.name;
      if(!name||name.length>18||names.has(name)||names.size>=150)continue;
      names.add(name);
      const el=document.createElement('span');el.className='geo-place-label';el.textContent=name;
      const marker=new maplibregl.Marker({element:el}).setLngLat(f.geometry.coordinates).addTo(map);
      marker._geoLabel=true;marker._geoMinZoom=priority(f)>=90?11:priority(f)>=80?12.2:priority(f)>=50?14:15;markers.push(marker);
    }
    map.on('moveend',updateReadout);
    map.on('resize',updateReadout);
  }
  function updateGeographyLabels(zoom){
    if(!map)return;
    const width=map.getContainer().clientWidth,height=map.getContainer().clientHeight;
    const occupied=markers.filter(m=>!m._geoLabel&&!m.getElement().hidden).map(m=>{
      const p=map.project(m.getLngLat());return {left:p.x-32,right:p.x+112,top:p.y-40,bottom:p.y+24};
    });
    for(const marker of markers.filter(m=>m._geoLabel)){
      const element=marker.getElement();
      if(!labels||!visible.geography||zoom<marker._geoMinZoom||zoom>17){element.hidden=true;continue;}
      const p=map.project(marker.getLngLat()),half=element.textContent.length*5.7+8;
      const box={left:p.x-half,right:p.x+half,top:p.y-11,bottom:p.y+11};
      const collides=box.left<15||box.right>width-15||box.top<20||box.bottom>height-20||occupied.some(other=>box.left<other.right+9&&box.right>other.left-9&&box.top<other.bottom+7&&box.bottom>other.top-7);
      element.hidden=collides;
      if(!collides)occupied.push(box);
    }
  }
  const corridorCache=new Map();
  function coordinatesForEdge(edge){
    const confirmed=ctx?.classroomSpatial?.corridors?.[edge.id];
    if(confirmed)return confirmed.roadCoordinates||[];
    const key=edge.a+'>'+edge.b;
    if(!corridorCache.has(key)&&window.FloodRoadRouting){corridorCache.set(key,window.FloodRoadRouting.find(points[edge.a],points[edge.b]));}
    return corridorCache.get(key)?.roadCoordinates||[];
  }
  function lineMidpoint(coordinates){
    if(!coordinates?.length)return null;
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
    for(const id of ['command-routes','command-routes-halo'])map.setLayoutProperty(id,'visibility',ctx?.classroomSpatial||visible.command?'visible':'none');
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
    const w=ctx?.realLab?{...localWeather,type:FloodRealLab.current().script.rain?'rain':'clear',rain:FloodRealLab.current().script.rain}:ctx?.command?.weather||localWeather;
    return {type:['clear','cloud','rain','fog'].includes(w.type)?w.type:'clear',rain:Math.max(0,Math.min(150,Number(w.rain)||0)),night:!!w.night};
  }
  function changeWeather(change){
    if(ctx?.realLab){if(change.night!==undefined)localWeather.night=change.night;applyWeather();return;}
    const next={...currentWeather(),...change};localWeather=next;
    window.dispatchEvent(new CustomEvent('command-weather',{detail:next}));
    // The command UI owns persistence. Its handler may update ctx synchronously.
    applyWeather();
  }
  function applyWeather(){
    const w=currentWeather(),overlay=document.querySelector('.geo-atmosphere');
    if(overlay){overlay.dataset.weather=visible.weather?w.type:'clear';overlay.classList.toggle('is-night',visible.weather&&w.night);overlay.style.setProperty('--rain-opacity',String(.2+w.rain/190));overlay.hidden=!visible.weather;}
    document.querySelectorAll('[data-geo-weather]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.geoWeather===w.type)));
    const range=document.querySelector('[data-geo-rain]');if(range){range.value=w.rain;range.disabled=!!ctx?.realLab;}
    const output=document.querySelector('[data-geo-rain-value]');if(output)output.textContent=w.rain;
    const night=document.querySelector('[data-geo-night]');if(night)night.checked=w.night;
    if(map&&loaded)map.setLight({anchor:'viewport',color:w.night?'#a8c5e6':'#ffffff',intensity:w.night?.15:.45,position:[1.5,w.night?45:210,w.night?75:35]});
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
    map.setPaintProperty('background','background-color',dark?'#19272e':'#c5c9bf');
    map.setPaintProperty('water','fill-color',dark?'#25434c':'#7b9fa5');
    map.setPaintProperty('water-outline','line-color',dark?'#496875':'#9aaead');
    map.setPaintProperty('green','fill-color',dark?['match',['get','class'],'forest','#133c3a','wood','#133c3a','park','#183d3b','grass','#1a3838','#162c37']:['match',['get','class'],'residential','#c8c8b9','commercial','#c7c6ba','industrial','#bcbeb4','forest','#8e9e7e','wood','#8e9e7e','park','#a3b08e','grass','#b1ba9d','#bbc0aa']);
    map.setPaintProperty('green','fill-opacity',dark?.85:.8);
    map.setPaintProperty('streets-casing','line-color',dark?'#35464b':'#bebbad');
    map.setPaintProperty('streets','line-color',dark?['match',['get','class'],'motorway','#71877d','primary','#637b7d','secondary','#4d737c','#315361']:['match',['get','class'],'motorway','#797e7b','primary','#757b7b','secondary','#838986','#959a93']);
    map.setPaintProperty('building-footprints','fill-color',dark?'#53636b':'#a6a798');
    map.setPaintProperty('buildings-3d','fill-extrusion-color',dark?['interpolate',['linear'],['coalesce',['to-number',['get','render_height']],9],0,'#355d70',20,'#4f8090',60,'#72adba',120,'#a4d1d0']:['coalesce',['get','facade'],'#c2bdad']);
    map.setPaintProperty('flood-areas','fill-color',dark?'#37c2d4':'#519fc4');
    map.setPaintProperty('flood-areas','fill-opacity',dark?.35:.22);
    map.setPaintProperty('water','fill-pattern',dark?null:'water-surface');
    document.querySelector('.geo-viewport')?.classList.toggle('geo-dark-map',dark);
    document.querySelector('.geo-viewport')?.classList.toggle('geo-day-map',!dark);
    document.querySelectorAll('[data-geo-basemap]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.geoBasemap===baseMode)));
  }
  function applyVisibility(){
    if(!loaded)return;
    showNetwork=visible.network;
    for(const id of ['teaching-roads','teaching-roads-halo','flood-areas','flood-depth'])map.setLayoutProperty(id,'visibility',visible.network?'visible':'none');
    for(const id of ['building-footprints','buildings-3d','scene-roofs','scene-windows'])map.setLayoutProperty(id,'visibility',visible.buildings&&(visible.detail||!id.startsWith('scene-'))?'visible':'none');
    for(const id of ['scene-trees','scene-road-center','scene-crosswalks','scene-shadows'])map.setLayoutProperty(id,'visibility',visible.detail?'visible':'none');
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
  function syncClassroom(){
    const s=ctx.state,spatial=ctx.classroomSpatial,E=window.FloodLab;
    const network=window.FloodRoadRouting.network(),byId=new Map(network.map(segment=>[segment.id,segment]));
    const affected=spatial.roadStates.map(road=>{const segment=byId.get(road.id);return segment?{type:'Feature',properties:{id:road.id,state:road.status,color:colors[road.status],taskIds:road.taskIds.join(',')},geometry:{type:'LineString',coordinates:[segment.a,segment.b]}}:null;}).filter(Boolean);
    map.getSource('teaching').setData({type:'FeatureCollection',features:affected});
    const pools=spatial.tasks.filter(task=>task.point&&!task.repaired&&(task.damage||task.depth>=.15||task.working)).map(task=>{
      const p=task.point,r=task.radius,ring=Array.from({length:49},(_,i)=>{const a=i*Math.PI/24;return [p[0]+Math.cos(a)*r/(111320*Math.cos(p[1]*Math.PI/180)),p[1]+Math.sin(a)*r/110574];});
      return {type:'Feature',properties:{id:task.id,height:Math.max(.05,task.depth)},geometry:{type:'Polygon',coordinates:[ring]}};
    });
    map.getSource('flood-areas').setData({type:'FeatureCollection',features:pools});
    markers.filter(marker=>!marker._geoLabel).forEach(marker=>marker.remove());markers=markers.filter(marker=>marker._geoLabel);
    const reachable=new Set(ctx.reachableNodes||[]);
    for(const node of E.nodes){
      const el=document.createElement('button');el.className='geo-marker kind-'+node.kind+(!reachable.has(node.id)?' isolated':'')+(s.selection.includes(node.id)?' selected':'');el.type='button';el.dataset.node=node.id;el.setAttribute('aria-label',node.name+'，教学地点');
      el.innerHTML='<i class="geo-pin-ground" aria-hidden="true"></i><span class="marker-icon">'+(s.selection.includes(node.id)?'✓':symbols[node.kind]||node.id)+'</span><span class="marker-label">'+escape(node.name)+'<small>'+node.pop+' 人 · 教学地点</small></span>';
      el.querySelector('.marker-label').hidden=!labels;markers.push(new maplibregl.Marker({element:el}).setLngLat(points[node.id]).addTo(map));
    }
    roads.forEach(marker=>marker.remove());roads=[];
    const visibleTasks=spatial.tasks.filter(task=>task.status!=='open'||task.working||ctx.selectedRoad===task.id);
    for(const task of visibleTasks){
      if(!task.point)continue;
      const edge=s.edges.find(edge=>edge.id===task.id),status=edge?E.status(s,edge):task.status,el=document.createElement('button');el.className='geo-road-marker';el.dataset.road=task.id;el.textContent=task.id;el.title=task.id+' · 局部作业区 · '+titles[status];el.style.setProperty('--road-color',colors[status]);el.hidden=!labels||!showNetwork;
      roads.push(new maplibregl.Marker({element:el,offset:[0,24+(visibleTasks.filter(other=>other.point&&distanceMeters(other.point,task.point)<10).findIndex(other=>other.id===task.id))*28]}).setLngLat(task.point).addTo(map));
    }
    commandMarkers.forEach(marker=>marker.remove());commandMarkers=[];crewMarkers.forEach(marker=>marker.remove());crewMarkers=[];
    const routes=[],access=[];
    function addRoute(route,color){
      if(!route)return;
      if(route.roadCoordinates?.length>=2)routes.push({type:'Feature',properties:{color},geometry:{type:'LineString',coordinates:route.roadCoordinates}});
      for(const leg of route.accessLegs||[])if(leg.distanceKm>.000001)access.push({type:'Feature',properties:{color},geometry:{type:'LineString',coordinates:leg.coordinates}});
    }
    addRoute(ctx.routePreview,'#176fbd');
    for(const crew of s.crews.filter(crew=>crew.job?.route)){
      const job=crew.job,route=job.route,traveling=s.time<job.start+job.travel;
      const coordinate=pointAlongRoute(route.coordinates,traveling?(s.time-job.start)/Math.max(1,job.travel):1);
      if(!coordinate)continue;
      addRoute(route,'#1f7eac');const el=document.createElement('span');el.className='geo-crew-marker';el.textContent=traveling?'🚚':'⚒';el.title=crew.name+' · '+(traveling?'沿确认的真实道路进场':'作业区外围现场作业')+' · T+'+job.end+'完成';
      crewMarkers.push(new maplibregl.Marker({element:el,offset:[0,-18]}).setLngLat(coordinate).addTo(map));
    }
    if(!map.getSource('classroom-access')){map.addSource('classroom-access',{type:'geojson',data:empty()});map.addLayer({id:'classroom-access',type:'line',source:'classroom-access',paint:{'line-color':'#805f46','line-width':2,'line-dasharray':[2,3]}});}
    map.getSource('classroom-access').setData({type:'FeatureCollection',features:access});
    map.getSource('command-routes').setData({type:'FeatureCollection',features:routes});
    applyBaseMode();applyVisibility();updateReadout();
  }
  function syncRealLab(){
    const lab=window.FloodRealLab,d=lab.sceneData();
    map.getSource('teaching').setData({type:'FeatureCollection',features:d.roadFeatures});
    map.getSource('flood-areas').setData({type:'FeatureCollection',features:d.floodFeatures});
    markers.filter(m=>!m._geoLabel).forEach(m=>m.remove());markers=markers.filter(m=>m._geoLabel);
    roads.forEach(m=>m.remove());roads=[];crewMarkers.forEach(m=>m.remove());crewMarkers=[];
    commandMarkers.forEach(m=>m.remove());commandMarkers=[];
    const routeFeatures=[];
    const chosen=lab.selected();if(chosen?.startsWith('node:')){const route=lab.routeTo(chosen.slice(5));if(route)routeFeatures.push({type:'Feature',properties:{color:'#1464d2'},geometry:{type:'LineString',coordinates:route.coordinates}});}
    for(const n of [{id:'S',name:'教学救援基地',status:'reachable',pop:0},...d.facilities]){
      const el=document.createElement('button');el.className='geo-marker real-facility-marker'+(n.status==='isolated'?' isolated':'');el.type='button';el.dataset.realFacility=n.id;el.title=n.name+' · '+({reachable:'基地可达',isolated:'因灾断连',unmapped:'基线未接入'})[n.status];
      el.innerHTML=`<span class="marker-icon">${n.id}</span><span class="marker-label">${escape(n.name)}<small>${n.status==='isolated'?'因灾断连':n.status==='unmapped'?'基线未接入':'基地可达'}</small></span>`;el.querySelector('.marker-label').hidden=!labels;
      markers.push(new maplibregl.Marker({element:el,anchor:'center'}).setLngLat(points[n.id]).addTo(map));
    }
    for(const h of d.hazards){const el=document.createElement('button');el.className='real-hazard-pin';el.dataset.realSelect=h.id;el.type='button';el.innerHTML=`<b>${h.done?'✓':h.id}</b><span>${h.done?'已处理':h.working?'进场 / 作业':!h.active?'T+'+h.start+'发生':h.damage?'结构阻断':h.depth.toFixed(2)+'m'}</span>`;el.title=h.title;
      crewMarkers.push(new maplibregl.Marker({element:el,offset:[0,30]}).setLngLat(h.center).addTo(map));}
    for(const j of d.jobs){const traveling=d.time<j.arrival,p=traveling?pointAlongRoute(j.route,(d.time-j.start)/Math.max(1,j.arrival-j.start)):j.route.at(-1);const el=document.createElement('span');el.className='real-crew-pin';el.textContent=traveling?'🚚':'⚒';el.title=j.hazard+' · '+(traveling?'沿真实道路进场':'灾情边界现场作业');crewMarkers.push(new maplibregl.Marker({element:el,offset:[0,-15]}).setLngLat(p).addTo(map));routeFeatures.push({type:'Feature',properties:{color:'#438dec'},geometry:{type:'LineString',coordinates:j.route}});}
    map.getSource('command-routes').setData({type:'FeatureCollection',features:routeFeatures});
    applyBaseMode();applyVisibility();
  }
  function sync(){
    if(!loaded||!ctx)return;
    if(ctx.realLab){syncRealLab();return;}
    if(ctx.classroomSpatial){syncClassroom();return;}
    map.getSource('classroom-access')?.setData(empty());
    const E=window.FloodLab,s=ctx.state;
    const masked=!!s.assessment&&s.assessment.phase==='active';
    const reachable=E.reachable(s);
    const features=s.edges.filter(e=>coordinatesForEdge(e).length>=2).map(e=>({type:'Feature',properties:{id:e.id,color:colors[E.status(s,e)],highlighted:(ctx.routeEdges||[]).includes(e.id)},geometry:{type:'LineString',coordinates:coordinatesForEdge(e)}}));
    map.getSource('teaching').setData({type:'FeatureCollection',features});
    const pools=s.edges.filter(e=>e.depth>=.15&&coordinatesForEdge(e).length>=2).map(e=>{
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
      const e=s.edges.find(e=>e.id===crew.job.edge);if(!coordinatesForEdge(e).length)continue;const el=document.createElement('span');el.className='geo-crew-marker';el.textContent='⚒';el.title=`${crew.name} · ${e.id} · T+${crew.job.end} 完工`;
      crewMarkers.push(new maplibregl.Marker({element:el,offset:[0,-23]}).setLngLat(lineMidpoint(coordinatesForEdge(e))).addTo(map));
    }
    syncCommand();applyBaseMode();applyVisibility();
  }
  function updateReadout(){
    if(!map)return;
    const z=map.getZoom(),p=map.getPitch();
    const label=document.querySelector('[data-geo-zoom-label]');if(label)label.textContent=z<15?'区域总览 · 2D':p>15?'街区建筑 · 3D':'街区地图 · 2D';
    const altitude=document.querySelector('[data-geo-altitude]');if(altitude)altitude.textContent=`缩放 ${z.toFixed(1)} · 倾角 ${Math.round(p)}° · ${z<15?'滚轮拉近进入建筑场景':'右键拖动旋转 / 调整倾角'}`;
    updateGeographyLabels(z);
  }
  function flyTo(preset){
    if(!map||!presets[preset])return;
    mode='auto';
    document.querySelectorAll('[data-camera-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.cameraMode==='auto');b.setAttribute('aria-pressed',String(b.dataset.cameraMode==='auto'));});
    if(preset==='overview'){coverRegion();return;}
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
      case 'topology':if(ctx?.realLab){window.navigate?.('identify');break;}act({action:'geo-topology'});break;
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
  return {template,detach,mount,focus,focusLocation,coverRegion,fitCoveredBounds,constrainCoverage,getMap:()=>map,getData:()=>fullData,getPoints:()=>points,getCoverageBounds:()=>BOUNDS.map(point=>[...point]),
    onAnnotation:callback=>{annotationCallback=typeof callback==='function'?callback:null;},setDrawing,
    getAnnotationDraft:()=>drawing?{...buildDrawing(),color:drawing.color,mode:drawing.mode,coordinates:drawing.coordinates.map(p=>[...p])}:null,
    setLocationPicker,exportSceneImage};
})();
