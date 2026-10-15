(function(root){
'use strict';
const nodes=[
 {id:'S',name:'救援基地',x:105,y:385,pop:0,kind:'base'},
 {id:'J',name:'南岸路口',x:270,y:365,pop:0,kind:'junction'},
 {id:'C',name:'中心社区',x:435,y:425,pop:240,kind:'community'},
 {id:'D',name:'避难所',x:690,y:405,pop:180,kind:'shelter'},
 {id:'E',name:'东岸路口',x:770,y:255,pop:0,kind:'junction'},
 {id:'N',name:'北岸路口',x:475,y:220,pop:0,kind:'junction'},
 {id:'A',name:'社区 A',x:275,y:155,pop:320,kind:'community'},
 {id:'B',name:'养老院 B',x:480,y:90,pop:80,kind:'care'},
 {id:'H',name:'医院 H',x:705,y:135,pop:120,kind:'hospital'},
 {id:'V',name:'河西村',x:105,y:170,pop:260,kind:'community'},
 {id:'K',name:'学校安置点',x:610,y:305,pop:160,kind:'shelter'},
 {id:'W',name:'西侧社区',x:130,y:285,pop:160,kind:'community'}
];
// length: km; work: team-minutes; cost: teaching budget units (万元).
const edges=[
 ['R1','S','J',2,0,0,'road',20,5],['R2','J','C',1.5,0,0,'road',20,5],
 ['R3','S','W',1.3,.42,0,'pump',30,6],['R4','W','V',1.5,0,1,'road',40,8],
 ['R5','V','A',2,0,0,'road',25,5],['R6','A','N',2.3,0,1,'road',45,10],
 ['B1','J','N',2.5,.18,0,'bridge',55,15],['R7','N','B',1.2,0,1,'road',30,8],
 ['R8','B','H',2.5,.48,0,'pump',40,8],['R9','N','E',3.4,.12,0,'road',35,8],
 ['R10','E','H',1.6,0,1,'road',50,12],['B2','C','K',2.2,.12,0,'bridge',60,18],
 ['R11','K','E',1.7,0,0,'road',30,6],['R12','C','D',3,0,0,'road',30,6],
 ['R13','D','E',2,.1,0,'road',35,7],['R14','K','D',1.8,0,0,'road',25,5],
 ['R15','W','J',1.8,.55,0,'pump',40,7]
].map(([id,a,b,length,depth,damage,type,work,cost])=>({id,a,b,length,depth,damage,type,work,cost,repaired:false}));
const scenarios=[
 {id:'basic',name:'01 · 暴雨断路',level:'基础实验',rain:45,budget:80,horizon:180,desc:'西侧聚落、养老院和医院对外道路受阻。识别受困区域并恢复基地可达性。',event:null},
 {id:'rising',name:'02 · 持续强降雨',level:'进阶实验',rain:80,budget:95,horizon:180,desc:'积水随时间上涨，30 分钟后 B1 桥梁受损。需要考虑备用进场路线。',event:{at:30,edge:'B1',text:'B1 桥梁结构受损，暂停通行'}},
 {id:'compound',name:'03 · 复合灾情',level:'挑战实验',rain:110,budget:105,horizon:180,desc:'B1 桥梁初始受损、东岸积水加剧，45 分钟后 R12 再次阻断。',event:{at:45,edge:'R12',text:'R12 边坡滑塌，道路阻断'}}
];
const clone=x=>JSON.parse(JSON.stringify(x));
function create(id='basic'){
 const scenario=scenarios.find(s=>s.id===id)||scenarios[0];
 const s={version:1,scenario:scenario.id,time:0,rain:scenario.rain,budget:scenario.budget,spent:0,horizon:scenario.horizon,edges:clone(edges),crews:[{id:'T1',name:'道路抢修一队',type:'road',speed:1,job:null},{id:'T2',name:'道路抢修二队',type:'road',speed:1,job:null},{id:'P1',name:'排涝作业队',type:'pump',speed:1,job:null},{id:'B1T',name:'桥梁抢修队',type:'bridge',speed:1,job:null}],selection:[],identification:null,plan:[],auto:false,ended:false,eventFired:false,logs:[],timeline:[],quiz:{},reflection:'',student:'',usedHint:false,initial:null};
 if(id==='compound'){s.edges.find(e=>e.id==='B1').damage=1;s.edges.find(e=>e.id==='R13').depth=.4;}
 s.initial=clone({edges:s.edges,rain:s.rain,budget:s.budget});
 log(s,'实验载入：'+scenario.name);record(s);return s;
}
function log(s,text){s.logs.push({time:s.time,text});}
function status(s,e){if(s.crews.some(c=>c.job?.edge===e.id))return 'repair';if(e.damage||e.depth>=.3)return 'blocked';return e.depth>=.15?'limited':'open';}
function passable(s,e){const z=status(s,e);return z==='open'||z==='limited';}
function reachable(s,start='S'){const found=new Set([start]),q=[start];while(q.length){const n=q.shift();s.edges.filter(e=>passable(s,e)&&(e.a===n||e.b===n)).forEach(e=>{const v=e.a===n?e.b:e.a;if(!found.has(v)){found.add(v);q.push(v)}})}return found;}
function islands(s){const reached=reachable(s),seen=new Set(reached),groups=[];for(const n of nodes){if(seen.has(n.id))continue;const group=[...reachable(s,n.id)];group.forEach(id=>seen.add(id));const pop=nodes.filter(v=>group.includes(v.id)).reduce((a,v)=>a+v.pop,0);if(pop)groups.push({nodes:group,pop});}return groups;}
function stats(s){const r=reachable(s),pop=nodes.reduce((a,n)=>a+n.pop,0),available=nodes.filter(n=>r.has(n.id)).reduce((a,n)=>a+n.pop,0);return {pop,available,isolated:pop-available,groups:islands(s),blocked:s.edges.filter(e=>!passable(s,e)).length,reachable:r,urgent:['B','H'].filter(id=>r.has(id)).length};}
function route(s,start,end){if(!nodes.some(n=>n.id===start)||!nodes.some(n=>n.id===end))return null;const dist=Object.fromEntries(nodes.map(n=>[n.id,Infinity])),prev={},pending=new Set(nodes.map(n=>n.id));dist[start]=0;while(pending.size){let u=[...pending].sort((a,b)=>dist[a]-dist[b])[0];if(dist[u]===Infinity)break;pending.delete(u);if(u===end)break;for(const e of s.edges.filter(e=>passable(s,e)&&(e.a===u||e.b===u))){const v=e.a===u?e.b:e.a;const cost=e.length/(status(s,e)==='limited'?15:30)*60;if(dist[u]+cost<dist[v]){dist[v]=dist[u]+cost;prev[v]={node:u,edge:e.id};}}}if(!Number.isFinite(dist[end]))return null;const path=[],nodePath=[end];let cur=end;while(cur!==start){path.unshift(prev[cur].edge);cur=prev[cur].node;nodePath.unshift(cur)}return {edges:path,nodes:nodePath,minutes:+dist[end].toFixed(1),distance:+path.reduce((a,id)=>a+s.edges.find(e=>e.id===id).length,0).toFixed(1)};}
function requiredType(e){return e.damage?(e.type==='bridge'?'bridge':'road'):'pump';}
function canDispatch(s,id,crewId){const e=s.edges.find(e=>e.id===id),c=s.crews.find(c=>c.id===crewId);if(s.ended)return '实验已结束，请重新实验';if(s.assessment?.phase==='active'&&(!s.identification||s.assessment.pending))return '请先完成初始识别和待处理决策';if(!e||!c)return '道路或队伍不存在';if(c.job)return '该队伍正在作业';if(s.crews.some(v=>v.job?.edge===id))return '该道路已有队伍作业';if(passable(s,e))return '该道路可以通行，无需抢修';if(c.type!==requiredType(e))return '队伍工种不匹配';if(s.spent+e.cost>s.budget)return '剩余预算不足';const r=reachable(s);if(!r.has(e.a)&&!r.has(e.b))return '无法从基地到达任一作业端点，需先抢通进场道路';return null;}
function dispatch(s,id,crewId){const error=canDispatch(s,id,crewId);if(error){root.FloodAssessment?.dispatchRecorded(s,id,crewId,error);return {error};}const e=s.edges.find(e=>e.id===id),c=s.crews.find(c=>c.id===crewId);const access=[route(s,'S',e.a),route(s,'S',e.b)].filter(Boolean).sort((a,b)=>a.minutes-b.minutes)[0];const duration=Math.ceil(e.work/c.speed+access.minutes);c.job={edge:id,start:s.time,end:s.time+duration,duration,travel:access.minutes};s.spent+=e.cost;s.plan=s.plan.filter(v=>v!==id);root.FloodAssessment?.dispatchRecorded(s,id,crewId,null);log(s,`${c.name} 出发抢修 ${id}，进场 ${access.minutes} 分钟，预计 T+${c.job.end} 完成，投入 ${e.cost} 万元`);return {ok:true,duration:c.job.duration};}
function recommend(s){const copy=clone(s),result=[];let guard=0;while(guard++<edges.length){const before=stats(copy);const candidates=copy.edges.filter(e=>!passable(copy,e)&&!copy.crews.some(c=>c.job?.edge===e.id)).map(e=>{const r=reachable(copy);if((!r.has(e.a)&&!r.has(e.b))||copy.spent+e.cost>copy.budget)return null;const trial=clone(copy),ee=trial.edges.find(v=>v.id===e.id);ee.damage=0;ee.depth=0;const after=stats(trial);const gain=after.available-before.available,urgent=after.urgent-before.urgent;return {id:e.id,score:(gain+urgent*250+10)/(e.work+e.cost),gain,urgent};}).filter(Boolean).sort((a,b)=>b.score-a.score);if(!candidates.length)break;const chosen=candidates[0],e=copy.edges.find(e=>e.id===chosen.id);result.push(chosen);e.damage=0;e.depth=0;e.repaired=true;copy.spent+=e.cost;if(stats(copy).isolated===0)break;}return result;}
function schedule(s){for(const id of [...s.plan]){const crew=s.crews.find(c=>!canDispatch(s,id,c.id));if(crew)dispatch(s,id,crew.id);}}
function record(s){const st=stats(s);const entry={time:s.time,available:st.available,isolated:st.isolated,urgent:st.urgent,urgentIds:['B','H'].filter(id=>st.reachable.has(id)),spent:s.spent};if(s.timeline.at(-1)?.time===s.time)s.timeline[s.timeline.length-1]=entry;else s.timeline.push(entry);}
function step(s,minutes=5){
 if(s.ended)return;
 if(!Number.isInteger(minutes)||minutes<1||minutes>180)throw new Error('推进时间需为 1–180 分钟的整数');
 const target=Math.min(s.horizon,s.time+minutes);if(s.auto)schedule(s);
 while(s.time<target){
  s.time++;
  for(const e of s.edges){if(!e.repaired){const old=status(s,e);const base=s.initial.edges.find(v=>v.id===e.id).depth;if(base>0)e.depth=+(base+Math.max(0,s.rain-35)*.000025*s.time).toFixed(4);if(old!=='blocked'&&status(s,e)==='blocked')log(s,`${e.id} 积水升至 ${e.depth.toFixed(2)} m，达到教学阻断阈值`);}}
  const ev=scenarios.find(v=>v.id===s.scenario).event;
  if(ev&&!s.eventFired&&s.time>=ev.at){s.eventFired=true;const e=s.edges.find(e=>e.id===ev.edge);e.damage=1;e.repaired=false;log(s,'突发事件：'+ev.text);}
  for(const c of s.crews){if(c.job&&s.time>=c.job.end){const e=s.edges.find(e=>e.id===c.job.edge);e.damage=0;e.depth=0;e.repaired=true;log(s,`${e.id} 抢通完成；${c.name} 返回待命`);c.job=null;}}
  const paused=root.FloodAssessment?.checkpoint(s);if(!paused&&s.auto)schedule(s);record(s);if(paused)break;
 }
 if(s.time>=s.horizon){s.ended=true;log(s,'实验时限已到，已生成评价结果');}
}
function identify(s,selected){if(s.time>0||s.spent>0)return {error:'识别提交需在派遣队伍及推演之前完成'};const truth=nodes.filter(n=>n.pop>0&&!reachable(s).has(n.id)).map(n=>n.id),answer=[...new Set(selected)].filter(id=>nodes.some(n=>n.id===id&&n.pop>0));let tp=answer.filter(id=>truth.includes(id)).length;const f1=truth.length+answer.length?2*tp/(truth.length+answer.length):1;s.selection=answer;s.identification={truth,answer,score:Math.round(f1*25)};log(s,'提交孤岛识别：'+answer.join('、'));return s.identification;}
function score(s){const st=stats(s);const identification=s.identification?.score||0,connectivity=Math.round(30*st.available/st.pop);const urgent=['B','H'].reduce((a,id)=>{if(!st.reachable.has(id))return a;return a+(s.timeline.some(t=>t.time<=90&&t.urgentIds?.includes(id))?10:7)},0);const efficiency=Math.round(15*(st.available/st.pop)*Math.max(0,1-s.time/(s.horizon*1.5))*(1-.3*s.spent/s.budget));const answers=[1,2,0];const knowledge=answers.reduce((a,v,i)=>a+(s.quiz[i]===v?1:0),0);const reflection=s.reflection.trim().length>=30?1:0;const learning=Math.round(10*(knowledge+reflection)/4);return {identification,connectivity,urgent,efficiency,learning,total:identification+connectivity+urgent+efficiency+learning};}
function configure(s,{rain,budget}){if(s.time||s.spent)return {error:'实验开始后不能修改情景参数'};if(!Number.isFinite(rain)||rain<0||rain>150||!Number.isFinite(budget)||budget<20||budget>200)return {error:'降雨需为 0–150，预算需为 20–200'};s.rain=rain;s.budget=budget;s.initial.rain=rain;s.initial.budget=budget;log(s,'更新教学参数：降雨 '+rain+' mm/h，预算 '+budget+' 万元');return {ok:true};}
function configureEdge(s,id,depth,damage){if(s.time||s.spent||s.ended)return {error:'实验开始后不能编辑初始道路'};const e=s.edges.find(e=>e.id===id);if(!e||!Number.isFinite(depth)||depth<0||depth>2||![0,1].includes(damage))return {error:'积水需在 0–2 m 范围内'};e.depth=depth;e.damage=damage;e.repaired=false;s.initial.edges=clone(s.edges);s.identification=null;s.selection=[];s.plan=[];record(s);log(s,'调整初始路况：'+id+'，积水 '+depth+' m，结构阻断 '+(damage?'是':'否'));return {ok:true};}
function validate(raw){
 const fail=()=>{throw new Error('实验文件格式或数据不正确，请使用本平台导出的 JSON 文件')};
 if(!raw||raw.version!==1||!scenarios.some(v=>v.id===raw.scenario))fail();
 const finite=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
 if(!finite(raw.time,0,180)||!Number.isInteger(raw.time)||raw.horizon!==180||!finite(raw.rain,0,150)||!finite(raw.budget,20,200)||!finite(raw.spent,0,raw.budget))fail();
 const checkEdges=arr=>{if(!Array.isArray(arr)||arr.length!==edges.length)fail();arr.forEach((e,i)=>{const base=edges[i];if(!e||['id','a','b','length','type','work','cost'].some(k=>e[k]!==base[k])||!finite(e.depth,0,10)||![0,1].includes(e.damage)||typeof e.repaired!=='boolean')fail()})};checkEdges(raw.edges);if(!raw.initial)fail();checkEdges(raw.initial.edges);
 if(!Array.isArray(raw.crews)||raw.crews.length!==4)fail();const fresh=create(raw.scenario);const jobs=[];raw.crews.forEach((c,i)=>{if(!c||c.id!==fresh.crews[i].id||c.type!==fresh.crews[i].type||c.name!==fresh.crews[i].name||c.speed!==1)fail();if(c.job){const j=c.job;if(!edges.some(e=>e.id===j.edge)||!finite(j.start,0,raw.time)||!finite(j.end,raw.time,500)||!finite(j.duration,1,300)||!finite(j.travel,0,200)||jobs.includes(j.edge))fail();jobs.push(j.edge);}});
 for(const key of ['selection','plan']){if(!Array.isArray(raw[key])||raw[key].length>20||raw[key].some(v=>typeof v!=='string'||!(key==='plan'?edges:nodes).some(n=>n.id===v)))fail()}
 for(const k of ['auto','ended','eventFired','usedHint'])if(typeof raw[k]!=='boolean')fail();
 if(typeof raw.student!=='string'||raw.student.length>100||typeof raw.reflection!=='string'||raw.reflection.length>10000)fail();
 if(!raw.quiz||typeof raw.quiz!=='object'||Object.entries(raw.quiz).some(([k,v])=>!['0','1','2'].includes(k)||![0,1,2].includes(v)))fail();
 if(!Array.isArray(raw.logs)||raw.logs.length>2000||raw.logs.some(v=>!finite(v.time,0,180)||typeof v.text!=='string'||v.text.length>1000))fail();
 if(!Array.isArray(raw.timeline)||raw.timeline.length>200||raw.timeline.some(v=>!finite(v.time,0,180)||!finite(v.available,0,1520)||!finite(v.isolated,0,1520)||!finite(v.urgent,0,2)||!Array.isArray(v.urgentIds)||v.urgentIds.some(id=>!['B','H'].includes(id))||!finite(v.spent,0,200)))fail();
 if(raw.identification){const v=raw.identification;if(!Array.isArray(v.truth)||!Array.isArray(v.answer)||[...v.truth,...v.answer].some(id=>!nodes.some(n=>n.id===id))||!finite(v.score,0,25))fail();}
 return clone(raw);
}
const api={nodes,edges,scenarios,clone,create,status,passable,reachable,islands,stats,route,requiredType,canDispatch,dispatch,recommend,schedule,record,step,identify,score,configure,configureEdge,validate,log};root.FloodLab=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
