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
let roadRouting=null;
function attachRoadRouting(adapter){
 if(!adapter||typeof adapter.modelId!=='string'||!['reachable','route','canDispatch','dispatchEstimate','scene'].every(key=>typeof adapter[key]==='function'))throw new Error('真实路网适配器无效');
 roadRouting=adapter;
}
function spatial(s){
 if(!s.routingModel)return null;
 if(!roadRouting||s.routingModel!==roadRouting.modelId||s.routingDataVersion!==roadRouting.dataVersion)throw new Error('本轮道路数据版本与当前服务不一致，请保留记录并检查地图版本');
 return roadRouting;
}
function create(id='basic'){
 const scenario=scenarios.find(s=>s.id===id)||scenarios[0];
 const s={version:1,scenario:scenario.id,time:0,rain:scenario.rain,budget:scenario.budget,spent:0,horizon:scenario.horizon,edges:clone(edges),crews:[{id:'T1',name:'道路抢修一队',type:'road',speed:1,job:null},{id:'T2',name:'道路抢修二队',type:'road',speed:1,job:null},{id:'P1',name:'排涝作业队',type:'pump',speed:1,job:null},{id:'B1T',name:'桥梁抢修队',type:'bridge',speed:1,job:null}],selection:[],identification:null,plan:[],auto:false,ended:false,eventFired:false,logs:[],timeline:[],quiz:{},reflection:'',student:'',usedHint:false,initial:null};
 if(id==='compound'){s.edges.find(e=>e.id==='B1').damage=1;s.edges.find(e=>e.id==='R13').depth=.4;}
 s.initial=clone({edges:s.edges,rain:s.rain,budget:s.budget});
 s.dispatchAudit=[];s.auditStartedAt=0;s.auditPriorSpent=0;
 s.learningId='lab-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
 log(s,'实验载入：'+scenario.name);record(s);return s;
}
function log(s,text){s.logs.push({time:s.time,text});}
function status(s,e){if(s.crews.some(c=>c.job?.edge===e.id))return 'repair';if(e.damage||e.depth>=.3)return 'blocked';return e.depth>=.15?'limited':'open';}
function passable(s,e){const z=status(s,e);return z==='open'||z==='limited';}
function reachable(s,start='S'){const real=spatial(s);if(real)return real.reachable(s,start);const found=new Set([start]),q=[start];while(q.length){const n=q.shift();s.edges.filter(e=>passable(s,e)&&(e.a===n||e.b===n)).forEach(e=>{const v=e.a===n?e.b:e.a;if(!found.has(v)){found.add(v);q.push(v)}})}return found;}
function islands(s){const reached=reachable(s),seen=new Set(reached),groups=[];for(const n of nodes){if(seen.has(n.id))continue;const group=[...reachable(s,n.id)];group.forEach(id=>seen.add(id));const pop=nodes.filter(v=>group.includes(v.id)).reduce((a,v)=>a+v.pop,0);if(pop)groups.push({nodes:group,pop});}return groups;}
function stats(s){const r=reachable(s),pop=nodes.reduce((a,n)=>a+n.pop,0),available=nodes.filter(n=>r.has(n.id)).reduce((a,n)=>a+n.pop,0);return {pop,available,isolated:pop-available,groups:islands(s),blocked:s.edges.filter(e=>!passable(s,e)).length,reachable:r,urgent:['B','H'].filter(id=>r.has(id)).length};}
function route(s,start,end){const real=spatial(s);if(real)return real.route(s,start,end);if(!nodes.some(n=>n.id===start)||!nodes.some(n=>n.id===end))return null;const dist=Object.fromEntries(nodes.map(n=>[n.id,Infinity])),prev={},pending=new Set(nodes.map(n=>n.id));dist[start]=0;while(pending.size){let u=[...pending].sort((a,b)=>dist[a]-dist[b])[0];if(dist[u]===Infinity)break;pending.delete(u);if(u===end)break;for(const e of s.edges.filter(e=>passable(s,e)&&(e.a===u||e.b===u))){const v=e.a===u?e.b:e.a;const cost=e.length/(status(s,e)==='limited'?15:30)*60;if(dist[u]+cost<dist[v]){dist[v]=dist[u]+cost;prev[v]={node:u,edge:e.id};}}}if(!Number.isFinite(dist[end]))return null;const path=[],nodePath=[end];let cur=end;while(cur!==start){path.unshift(prev[cur].edge);cur=prev[cur].node;nodePath.unshift(cur)}return {edges:path,nodes:nodePath,minutes:+dist[end].toFixed(1),distance:+path.reduce((a,id)=>a+s.edges.find(e=>e.id===id).length,0).toFixed(1)};}
function requiredType(e){return e.damage?(e.type==='bridge'?'bridge':'road'):'pump';}
function canDispatch(s,id,crewId){const e=s.edges.find(e=>e.id===id),c=s.crews.find(c=>c.id===crewId);if(s.ended)return '实验已结束，请重新实验';if(s.assessment?.phase==='active'&&(!s.identification||s.assessment.pending))return '请先完成初始识别和待处理决策';if(!e||!c)return '道路或队伍不存在';if(c.job)return '该队伍正在作业';if(s.crews.some(v=>v.job?.edge===id))return '该道路已有队伍作业';if(passable(s,e))return '该道路可以通行，无需抢修';if(c.type!==requiredType(e))return '队伍工种不匹配';if(s.spent+e.cost>s.budget)return '剩余预算不足';const real=spatial(s);if(real)return real.canDispatch(s,e,c);const r=reachable(s);if(!r.has(e.a)&&!r.has(e.b))return '无法从基地到达任一作业端点，需先抢通进场道路';return null;}
function dispatchEstimate(s,id,crewId){const error=canDispatch(s,id,crewId);if(error)return {error};const real=spatial(s);if(real)return real.dispatchEstimate(s,s.edges.find(e=>e.id===id),s.crews.find(c=>c.id===crewId));const e=s.edges.find(e=>e.id===id),c=s.crews.find(c=>c.id===crewId),access=[route(s,'S',e.a),route(s,'S',e.b)].filter(Boolean).sort((a,b)=>a.minutes-b.minutes)[0];const workMinutes=e.work/c.speed,duration=Math.ceil(workMinutes+access.minutes);return {travelMinutes:access.minutes,workMinutes,duration,completionAt:s.time+duration};}
function auditDispatch(s,id,crewId,error,cost=0){if(s.ended)return;if(!s.dispatchAudit){s.dispatchAudit=[];s.auditStartedAt=s.time;s.auditPriorSpent=s.spent;}if(s.dispatchAudit.length>=2000){s.auditTruncated=true;return;}s.dispatchAudit.push({at:s.time,edge:String(id).slice(0,80),crew:String(crewId).slice(0,80),ok:!error,error:error||'',cost,completedAt:null});}
function dispatch(s,id,crewId){const estimate=dispatchEstimate(s,id,crewId);if(estimate.error){auditDispatch(s,id,crewId,estimate.error);root.FloodAssessment?.dispatchRecorded(s,id,crewId,estimate.error);return {error:estimate.error};}const e=s.edges.find(e=>e.id===id),c=s.crews.find(c=>c.id===crewId);auditDispatch(s,id,crewId,null,e.cost);c.job={edge:id,start:s.time,end:estimate.completionAt,duration:estimate.duration,travel:estimate.travelMinutes,...(estimate.route?{route:clone(estimate.route),workPoint:clone(estimate.workPoint),travelDistanceKm:estimate.travelDistanceKm}: {})};s.spent+=e.cost;s.plan=s.plan.filter(v=>v!==id);root.FloodAssessment?.dispatchRecorded(s,id,crewId,null);log(s,`${c.name} 出发抢修 ${id}，进场 ${estimate.travelMinutes} 分钟，预计 T+${c.job.end} 完成，投入 ${e.cost} 万元`);record(s);return {ok:true,duration:c.job.duration};}
function recommend(s){const copy=clone(s),result=[];let guard=0;while(guard++<edges.length){const before=stats(copy);const candidates=copy.edges.filter(e=>!passable(copy,e)&&!copy.crews.some(c=>c.job?.edge===e.id)).map(e=>{const r=reachable(copy);if((!r.has(e.a)&&!r.has(e.b))||copy.spent+e.cost>copy.budget)return null;const trial=clone(copy),ee=trial.edges.find(v=>v.id===e.id);ee.damage=0;ee.depth=0;const after=stats(trial);const gain=after.available-before.available,urgent=after.urgent-before.urgent;return {id:e.id,score:(gain+urgent*250+10)/(e.work+e.cost),gain,urgent};}).filter(Boolean).sort((a,b)=>b.score-a.score);if(!candidates.length)break;const chosen=candidates[0],e=copy.edges.find(e=>e.id===chosen.id);result.push(chosen);e.damage=0;e.depth=0;e.repaired=true;copy.spent+=e.cost;if(stats(copy).isolated===0)break;}return result;}
// Marginal connectivity is a teaching explanation, not a forecast of evacuation.
function repairOptions(s){const before=stats(s);return s.edges.filter(e=>!passable(s,e)&&!s.crews.some(c=>c.job?.edge===e.id)).map(e=>{
 const trial=clone(s),road=trial.edges.find(v=>v.id===e.id);road.damage=0;road.depth=0;road.repaired=true;
 const after=stats(trial),gain=after.available-before.available,urgent=after.urgent-before.urgent;
 const crew=s.crews.find(c=>!canDispatch(s,e.id,c.id));
 return {id:e.id,cost:e.cost,work:e.work,type:requiredType(e),gain,urgent,perCost:+(gain/e.cost).toFixed(1),feasible:!!crew,reason:crew?'':canDispatch(s,e.id,s.crews.find(c=>c.type===requiredType(e))?.id)};
});}
// Compare cloned futures under identical rain, budget, crew and event rules.
// Reference policies are reactive heuristics; neither claims global optimality.
function previewPlan(s,policy='manual'){
 if(!['manual','cost','benefit'].includes(policy))throw new Error('未知方案规则');
 if(s.assessment?.phase==='active')throw new Error('考核中不提供参考方案预演');
 const copy=clone(s),before=stats(s),pending=[...new Set(s.plan)],sequence=[];delete copy.assessment;copy.auto=false;
 let lastFinished=s.time;
 while(copy.time<copy.horizon&&!copy.ended){
  if(policy==='manual'){
   for(const id of [...pending]){const road=copy.edges.find(e=>e.id===id);if(!road||passable(copy,road)){pending.splice(pending.indexOf(id),1);continue;}const crew=copy.crews.find(c=>!canDispatch(copy,id,c.id));if(crew){dispatch(copy,id,crew.id);sequence.push(id);pending.splice(pending.indexOf(id),1);}}
  }else{
   for(let slot=0;slot<copy.crews.length;slot++){
    if(stats(copy).isolated===0)break;
    const candidates=repairOptions(copy).filter(x=>x.feasible).sort(policy==='cost'?(a,b)=>a.cost-b.cost||a.work-b.work:(a,b)=>(b.gain+b.urgent*250+10)/(b.cost+b.work)-(a.gain+a.urgent*250+10)/(a.cost+a.work));
    const choice=candidates[0];if(!choice)break;const crew=copy.crews.find(c=>!canDispatch(copy,choice.id,c.id));dispatch(copy,choice.id,crew.id);sequence.push(choice.id);
   }
  }
  const jobs=copy.crews.filter(c=>c.job).map(c=>c.job.end);step(copy,1);if(jobs.some(end=>end===copy.time))lastFinished=copy.time;
 }
 const after=stats(copy),unexecuted=pending.filter(id=>{const road=copy.edges.find(e=>e.id===id);return road&&!passable(copy,road);});
 const timelyUrgent=['B','H'].filter(id=>after.reachable.has(id)&&copy.timeline.some(t=>t.time<=90&&t.urgentIds?.includes(id))).length;
 return {policy,sequence,spent:copy.spent,additionalCost:copy.spent-s.spent,remaining:copy.budget-copy.spent,available:after.available,isolated:after.isolated,urgent:after.urgent,timelyUrgent,gain:after.available-before.available,lastFinished,unexecuted,timeline:copy.timeline,events:copy.logs.filter(l=>l.time>=s.time),horizon:copy.horizon};
}
function schedule(s){for(const id of [...s.plan]){const crew=s.crews.find(c=>!canDispatch(s,id,c.id));if(crew)dispatch(s,id,crew.id);}}
function record(s){const st=stats(s);const entry={time:s.time,available:st.available,isolated:st.isolated,urgent:st.urgent,urgentIds:['B','H'].filter(id=>st.reachable.has(id)),spent:s.spent};if(s.timeline.at(-1)?.time===s.time)s.timeline[s.timeline.length-1]=entry;else s.timeline.push(entry);}
function step(s,minutes=5){
 if(s.ended)return;
 if(!Number.isInteger(minutes)||minutes<1||minutes>180)throw new Error('推进时间需为 1–180 分钟的整数');
 const target=Math.min(s.horizon,s.time+minutes);if(s.auto)schedule(s);
 while(s.time<target){
  s.time++;
  for(const e of s.edges){if(!e.repaired){const old=status(s,e);const base=s.initial.edges.find(v=>v.id===e.id).depth;if(base>0)e.depth=+(base+Math.max(0,s.rain-35)*.000025*s.time).toFixed(4);if(old!=='blocked'&&status(s,e)==='blocked')log(s,`${e.id} 积水升至 ${e.depth.toFixed(2)} m，达到教学阻断阈值`);}}
  const ev=s.challenge?s.challenge.event:scenarios.find(v=>v.id===s.scenario).event;
  if(ev&&!s.eventFired&&s.time>=ev.at){s.eventFired=true;const e=s.edges.find(e=>e.id===ev.edge);e.damage=1;e.repaired=false;log(s,'突发事件：'+ev.text);}
  for(const c of s.crews){if(c.job&&s.time>=c.job.end){const e=s.edges.find(e=>e.id===c.job.edge);e.damage=0;e.depth=0;e.repaired=true;const entry=[...(s.dispatchAudit||[])].reverse().find(a=>a.ok&&a.crew===c.id&&a.edge===c.job.edge&&a.at===c.job.start&&a.completedAt===null);if(entry)entry.completedAt=s.time;log(s,`${e.id} 抢通完成；${c.name} 返回待命`);c.job=null;}}
  const paused=root.FloodAssessment?.checkpoint(s);if(!paused&&s.auto)schedule(s);record(s);if(paused)break;
 }
 if(s.time>=s.horizon){s.ended=true;log(s,'实验时限已到，已生成评价结果');}
}
function identify(s,selected){if(s.time>0||s.spent>0)return {error:'识别提交需在派遣队伍及推演之前完成'};const truth=nodes.filter(n=>n.pop>0&&!reachable(s).has(n.id)).map(n=>n.id),answer=[...new Set(selected)].filter(id=>nodes.some(n=>n.id===id&&n.pop>0));let tp=answer.filter(id=>truth.includes(id)).length;const f1=truth.length+answer.length?2*tp/(truth.length+answer.length):1;s.selection=answer;s.identification={truth,answer,score:Math.round(f1*25)};log(s,'提交孤岛识别：'+answer.join('、'));return s.identification;}
function reviewSignature(s){const text=JSON.stringify([s.learningId,s.learningBranch||'',s.time,s.spent,s.ended,s.edges,s.plan,s.reflection,s.predictions||[],s.dispatchAudit||[],s.assessment?.answers||[]]);let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);return (hash>>>0).toString(16)+':'+text.length;}
function setDecisionReview(s,raw){
 if(!s.ended||s.assessment?.phase==='active')return {error:'请先结束实验或完成考核，再填写点评'};
 if(s.assessment&&!s.assessment.scoringVersion)return {error:'旧版已结算考核保留原评分，不追加新版点评'};
 const ratings=raw.ratings;if(!ratings||['evidence','analysis','improvement'].some(k=>!Number.isInteger(ratings[k])||ratings[k]<0||ratings[k]>5))return {error:'三项点评分别填写0—5的整数'};
 const comment=String(raw.comment||'').trim(),reviewer=String(raw.reviewer||'').trim();if(comment.length<10||comment.length>2000||reviewer.length<1||reviewer.length>60)return {error:'请填写点评人，以及10—2000字的评分依据'};
 s.decisionReview={version:1,at:s.time,ratings:{evidence:ratings.evidence,analysis:ratings.analysis,improvement:ratings.improvement},reviewer,comment,signature:reviewSignature(s)};if(s.assessment?.phase==='finished'&&s.assessment.scoringVersion===2&&root.FloodAssessment)s.assessment.final=root.FloodAssessment.evaluate(s);return {ok:true};
}
function decisionEvaluation(s){
 const round=n=>Math.round(n*10)/10,clamp=n=>Math.min(1,Math.max(0,n));
 const st=stats(s),goal=s.challenge?{population:s.challenge.goal.population,maxSpent:s.challenge.goal.maxSpent,deadline:s.challenge.goal.deadline}:{population:st.pop,maxSpent:s.budget,deadline:s.horizon};
 const observedAt=Math.min(s.time,goal.deadline),history=s.timeline.filter(t=>t.time<=observedAt),entry=history.find(t=>t.time===observedAt),current=observedAt===s.time?{available:st.available,spent:s.spent,urgentIds:['B','H'].filter(id=>st.reachable.has(id))}:entry;
 const available=current?.available??0,spent=current?.spent??0,initial=s.timeline.find(t=>t.time===0)?.available??stats({...s,edges:s.initial.edges,crews:[]}).available;
 const recovery=goal.population>initial?clamp((available-initial)/(goal.population-initial)):(available>=goal.population?1:0);
 const checkpointComplete=!!current&&available>=goal.population&&spent<=goal.maxSpent;
 const confirmed=s.challenge?s.time>=goal.deadline&&!!entry&&checkpointComplete:checkpointComplete;
 const first=history.find(t=>t.available>=goal.population&&t.spent<=goal.maxSpent)?.time??null;
 const completionTime=confirmed?first:null;
 const goalScore=confirmed?10:0,completionScore=completionTime===null?0:20*(1-.75*clamp(completionTime/goal.deadline));
 const early=['B','H'].map(id=>({id,at:history.find(t=>t.urgentIds?.includes(id))?.time??null,reachable:!!current?.urgentIds?.includes(id)}));
 const urgentScore=early.reduce((n,u)=>n+(u.reachable&&u.at!==null?5*(u.at<=90?1:clamp((180-u.at)/90)):0),0);
 const audit=(s.dispatchAudit||[]).filter(a=>a.at<=observedAt),successful=audit.filter(a=>a.ok),completed=successful.filter(a=>a.completedAt!==null&&a.completedAt<=observedAt),invalid=audit.length-successful.length;
 const auditComplete=!!s.dispatchAudit&&s.auditStartedAt===0&&s.auditPriorSpent===0&&!s.auditTruncated;
 const dispatchCost=successful.reduce((n,a)=>n+a.cost,0),finishedCost=completed.reduce((n,a)=>n+a.cost,0),utilization=dispatchCost?finishedCost/dispatchCost:0,validity=audit.length?successful.length/audit.length:0;
 const costScore=spent>0?10*recovery*(1-.3*clamp(spent/s.budget)):0;
 const resourceScore=costScore+(auditComplete?5*recovery*utilization+5*recovery*validity:0);
 const review=s.decisionReview,reviewCurrent=!!review&&review.signature===reviewSignature(s),manual=reviewCurrent?Object.values(review.ratings).reduce((a,b)=>a+b,0):null;
 const rows=[
  {key:'outcome',name:'通道恢复成效',max:35,score:round(25*recovery+goalScore),reason:`基线可达${initial}人，目标${goal.population}人，评价时点可达${available}人；相对目标的新增恢复比例${round(recovery*100)}%，计${round(25*recovery)}分；目标${confirmed?'已验证，计10分':'尚未验证或未达成，计0分'}。`},
  {key:'timeliness',name:'救援保障时效',max:30,score:round(completionScore+urgentScore),reason:`目标首次完成${completionTime===null?'尚未确认':`于T+${completionTime}`}，完成时间项${round(completionScore)}/20分；公式为20×(1−0.75×完成时刻/${goal.deadline})，仅在目标确认后计分。${early.map(u=>`${u.id==='H'?'医院':'养老院'}${u.at===null?'尚无可达记录':`首次T+${u.at}可达`}，评价时点${u.reachable?'可达':'不可达'}`).join('；')}，保障时效${round(urgentScore)}/10分。`},
  {key:'resources',name:'资源配置效率',max:20,score:round(resourceScore),reason:`累计投入${spent}/${s.budget}万元。预算效率${round(costScore)}/10分＝10×恢复比例×(1−0.3×投入/总预算)，未投入不计该项。${auditComplete?`已完成作业投入率${round(utilization*100)}%（完成作业费用${finishedCost}/派遣费用${dispatchCost}），有效派遣率${round(validity*100)}%（成功${successful.length}/尝试${audit.length}）；各乘恢复比例后计5分。`:'旧记录缺少完整派遣台账或台账已截断，作业投入率及派遣规范两项不推测给分。'}不以队伍忙碌时长奖励过度派遣。`},
  {key:'reasoning',name:'决策解释与改进',max:15,score:manual,reason:reviewCurrent?`依据与证据${review.ratings.evidence}/5，结果分析${review.ratings.analysis}/5，方案改进${review.ratings.improvement}/5；点评人：${review.reviewer}。${review.comment}`:review?'实验或复盘内容已变化，旧点评供参考；需重新确认，暂不计入总分。':'等待教师或同伴按量表点评：依据与证据、结果分析、方案改进，各5分。不按字数或预测准确度自动给分。'}
 ];
 const autoScore=round(rows.slice(0,3).reduce((n,r)=>n+r.score,0)),total=round(autoScore+(manual||0));
 const suggestions=[];if(!confirmed)suggestions.push(s.challenge&&s.time<goal.deadline?`请继续到T+${goal.deadline}验证题目目标，提前结束不计完成时间分。`:'检查仍然断连的区域、进场通道及剩余预算，目标未达成时没有完成时间奖励。');if(early.some(u=>!u.reachable||u.at===null||u.at>90))suggestions.push('结合医院和养老院的恢复时刻，尝试调整重点设施的抢通顺序。');if(invalid)suggestions.push(`有${invalid}次派遣被拒绝，先检查工种、空闲队伍、预算和进场条件。`);if(!reviewCurrent)suggestions.push('结束实验后，结合预测差异、时间线及分支对照填写解释，再邀请教师或同伴点评。');
 return {scoringVersion:2,total,autoScore,manualScore:manual,manualPending:!reviewCurrent,level:!reviewCurrent?'待完成点评':total>=85?'优秀':total>=70?'良好':total>=60?'合格':'需改进',rows,goal:{...goal,confirmed,completionTime,observedAt,initiallyMet:initial>=goal.population},time:s.time,spent,available,early,invalid,dispatches:successful.length,completed:completed.length,auditComplete,utilization:round(utilization*100),validity:round(validity*100),suggestions};
}
function score(s){return decisionEvaluation(s);}
function configure(s,{rain,budget}){if(s.predictions?.length)return {error:"已有学生预测，初始条件已锁定；更换条件请另建实验"};if(s.challenge||s.learningBranch||s.learningConditionsLocked)return {error:'当前实验的对照条件已锁定，请在学生出题中修改草稿或新建实验'};if(s.time||s.spent)return {error:'实验开始后不能修改情景参数'};if(!Number.isFinite(rain)||rain<0||rain>150||!Number.isFinite(budget)||budget<20||budget>200)return {error:'降雨需为 0–150，预算需为 20–200'};s.rain=rain;s.budget=budget;s.initial.rain=rain;s.initial.budget=budget;log(s,'更新教学参数：降雨 '+rain+' mm/h，预算 '+budget+' 万元');return {ok:true};}
function configureEdge(s,id,depth,damage){if(s.predictions?.length)return {error:"已有学生预测，初始路况已锁定；更换条件请另建实验"};if(s.challenge||s.learningBranch||s.learningConditionsLocked)return {error:'当前实验的对照条件已锁定'};if(s.time||s.spent||s.ended)return {error:'实验开始后不能编辑初始道路'};const e=s.edges.find(e=>e.id===id);if(!e||!Number.isFinite(depth)||depth<0||depth>2||![0,1].includes(damage))return {error:'积水需在 0–2 m 范围内'};e.depth=depth;e.damage=damage;e.repaired=false;s.initial.edges=clone(s.edges);s.identification=null;s.selection=[];s.plan=[];record(s);log(s,'调整初始路况：'+id+'，积水 '+depth+' m，结构阻断 '+(damage?'是':'否'));return {ok:true};}
function validateChallenge(raw){
 const fail=message=>{throw new Error('挑战题无效：'+message)},num=(v,a,b)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
 if(!raw||Array.isArray(raw)||raw.kind!=='flood-student-challenge'||raw.version!==1)fail('请选择本平台导出的学生挑战题 JSON');
 const text=(key,min,max)=>{if(typeof raw[key]!=='string'||raw[key].trim().length<min||raw[key].length>max)fail(key+' 的长度不符合要求');return raw[key].trim();};
 if(typeof raw.id!=='string'||!/^[-\w]{1,80}$/.test(raw.id))fail('题目编号不正确');
 if(!scenarios.some(s=>s.id===raw.scenario))fail('情景模板不存在');
 if(!num(raw.rain,0,150)||!num(raw.budget,20,200))fail('降雨需为0—150，预算需为20—200万元');
 const goal=raw.goal;if(!goal||!num(goal.population,1,1520)||!Number.isInteger(goal.population)||!num(goal.deadline,5,180)||!Number.isInteger(goal.deadline)||!num(goal.maxSpent,0,raw.budget))fail('检查目标人口、时刻及投入上限');
 if(!Array.isArray(raw.roads)||raw.roads.length!==edges.length||new Set(raw.roads.map(e=>e?.id)).size!==edges.length)fail('应有17条不重复的教学道路');
 const roads=edges.map(base=>{const road=raw.roads.find(e=>e?.id===base.id);if(!road||!num(road.depth,0,2)||![0,1].includes(road.damage)||!num(road.cost,1,50)||!num(road.work,5,120)||!Number.isInteger(road.work))fail(base.id+' 的积水、阻断、费用或工期超出范围');return {id:base.id,depth:road.depth,damage:road.damage,cost:road.cost,work:road.work};});
 let event=null;if(raw.event!==null){if(!raw.event||!num(raw.event.at,1,179)||!Number.isInteger(raw.event.at)||!edges.some(e=>e.id===raw.event.edge))fail('动态事件需指定1—179分钟及已知道路');event={at:raw.event.at,edge:raw.event.edge,text:raw.event.edge+' 教学新增阻断'};}
 return {kind:'flood-student-challenge',version:1,id:raw.id,title:text('title',2,80),author:text('author',0,60),objective:text('objective',10,1000),brief:text('brief',10,2000),scenario:raw.scenario,rain:raw.rain,budget:raw.budget,goal:{population:goal.population,deadline:goal.deadline,maxSpent:goal.maxSpent},roads,event};
}
function createChallengeState(raw){const ch=validateChallenge(raw),s=create(ch.scenario);s.challenge=ch;s.rain=ch.rain;s.budget=ch.budget;s.edges=s.edges.map(e=>({...e,...ch.roads.find(r=>r.id===e.id),repaired:false}));s.initial=clone({edges:s.edges,rain:s.rain,budget:s.budget});s.logs=[];s.timeline=[];log(s,'学生挑战题：'+ch.title);record(s);return s;}
function challengeResult(s){if(!s.challenge)return null;const goal=s.challenge.goal,entry=[...s.timeline].reverse().find(t=>t.time<=goal.deadline)||{available:0,spent:0},evaluated=s.time>=goal.deadline;return {evaluated,passed:evaluated&&entry.available>=goal.population&&entry.spent<=goal.maxSpent,available:entry.available,spent:entry.spent,goal:clone(goal)};}
function addPrediction(s,raw){
 if(s.assessment||s.ended)return {error:'请在未结束的练习中提交预测，考核不提供此辅助'};
 const target=Number(raw.target),population=Number(raw.population),spent=Number(raw.spent),reason=String(raw.reason||'').trim();
 if(!Number.isInteger(target)||target<=s.time||target>180)return {error:'请选择当前时刻之后、180分钟以内的整数时刻'};
 if(!Number.isInteger(population)||population<0||population>1520)return {error:'预计可达人口须为0—1520的整数'};
 if(!Number.isFinite(spent)||spent<s.spent||spent>s.budget)return {error:'预计累计投入须在当前已投入与总预算之间'};
 if(reason.length<10||reason.length>1000)return {error:'请用10—1000字说明你的预测依据'};
 const list=s.predictions||[];if(list.length>=12)return {error:'本次实验最多保存12条预测，请完成对照后另开实验'};
 if(list.some(p=>p.target===target))return {error:'该目标时刻已有预测，请选择另一个时刻；已提交预测保留原判断'};
 s.predictions=[...list,{at:s.time,target,population,spent,reason,plan:[...s.plan],branch:s.learningBranch||'original'}];
 return {ok:true};
}
function predictionResults(s){return (s.predictions||[]).map(p=>{const actual=s.time>=p.target?s.timeline.find(t=>t.time===p.target):null;return {...p,status:actual?'verified':s.ended?'unfinished':'pending',actual:actual?{available:actual.available,spent:actual.spent}:null};});}
function validate(raw){
 const fail=()=>{throw new Error('实验文件格式或数据不正确，请使用本平台导出的 JSON 文件')};
 if(!raw||raw.version!==1||!scenarios.some(v=>v.id===raw.scenario))fail();
 const challenge=raw.challenge?validateChallenge(raw.challenge):null;
 if(raw.routingModel!==undefined&&(raw.routingModel!=='xuzhou-road-network-v1'||typeof raw.routingDataVersion!=='string'||!/^[a-f0-9]{20}$/.test(raw.routingDataVersion)))fail();
 if(raw.learningConditionsLocked!==undefined&&typeof raw.learningConditionsLocked!=='boolean')fail();
 if(raw.learningId!==undefined&&(typeof raw.learningId!=='string'||!/^[-\w]{1,80}$/.test(raw.learningId)))fail();
 if(raw.learningBranch!==undefined&&(typeof raw.learningBranch!=='string'||!/^[-\w]{1,80}$/.test(raw.learningBranch)))fail();
 const finite=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
 if(!finite(raw.time,0,180)||!Number.isInteger(raw.time)||raw.horizon!==180||!finite(raw.rain,0,150)||!finite(raw.budget,20,200)||!finite(raw.spent,0,raw.budget))fail();
 const checkEdges=arr=>{if(!Array.isArray(arr)||arr.length!==edges.length)fail();arr.forEach((e,i)=>{const base=challenge?{...edges[i],...challenge.roads[i]}:edges[i];if(!e||['id','a','b','length','type','work','cost'].some(k=>e[k]!==base[k])||!finite(e.depth,0,10)||![0,1].includes(e.damage)||typeof e.repaired!=='boolean')fail()})};checkEdges(raw.edges);if(!raw.initial)fail();checkEdges(raw.initial.edges);
 if(challenge&&(raw.scenario!==challenge.scenario||raw.rain!==challenge.rain||raw.budget!==challenge.budget||raw.initial.rain!==challenge.rain||raw.initial.budget!==challenge.budget||raw.initial.edges.some((e,i)=>e.depth!==challenge.roads[i].depth||e.damage!==challenge.roads[i].damage||e.repaired)))fail();
 if(!Array.isArray(raw.crews)||raw.crews.length!==4)fail();const fresh=create(raw.scenario);const jobs=[];raw.crews.forEach((c,i)=>{if(!c||c.id!==fresh.crews[i].id||c.type!==fresh.crews[i].type||c.name!==fresh.crews[i].name||c.speed!==1)fail();if(c.job){const j=c.job;if(!edges.some(e=>e.id===j.edge)||!finite(j.start,0,raw.time)||!finite(j.end,raw.time,500)||!finite(j.duration,1,300)||!finite(j.travel,0,200)||jobs.includes(j.edge))fail();jobs.push(j.edge);}});
 for(const key of ['selection','plan']){if(!Array.isArray(raw[key])||raw[key].length>20||raw[key].some(v=>typeof v!=='string'||!(key==='plan'?edges:nodes).some(n=>n.id===v)))fail()}
 for(const k of ['auto','ended','eventFired','usedHint'])if(typeof raw[k]!=='boolean')fail();
 if(typeof raw.student!=='string'||raw.student.length>100||typeof raw.reflection!=='string'||raw.reflection.length>10000)fail();
 if(!raw.quiz||typeof raw.quiz!=='object'||Object.entries(raw.quiz).some(([k,v])=>!['0','1','2'].includes(k)||![0,1,2].includes(v)))fail();
 if(!Array.isArray(raw.logs)||raw.logs.length>2000||raw.logs.some(v=>!finite(v.time,0,180)||typeof v.text!=='string'||v.text.length>1000))fail();
 if(!Array.isArray(raw.timeline)||raw.timeline.length>200||raw.timeline.some(v=>!finite(v.time,0,180)||!finite(v.available,0,1520)||!finite(v.isolated,0,1520)||!finite(v.urgent,0,2)||!Array.isArray(v.urgentIds)||v.urgentIds.some(id=>!['B','H'].includes(id))||!finite(v.spent,0,200)))fail();
 if(raw.identification){const v=raw.identification;if(!Array.isArray(v.truth)||!Array.isArray(v.answer)||[...v.truth,...v.answer].some(id=>!nodes.some(n=>n.id===id))||!finite(v.score,0,25))fail();}
 if(raw.predictions!==undefined){if(!Array.isArray(raw.predictions)||raw.predictions.length>12)fail();const targets=new Set();for(const p of raw.predictions){if(!p||!Number.isInteger(p.at)||!finite(p.at,0,raw.time)||!Number.isInteger(p.target)||!finite(p.target,p.at+1,180)||targets.has(p.target)||!Number.isInteger(p.population)||!finite(p.population,0,1520)||!finite(p.spent,0,raw.budget)||typeof p.reason!=='string'||p.reason.trim().length<10||p.reason.length>1000||!Array.isArray(p.plan)||p.plan.length>17||p.plan.some(id=>!edges.some(e=>e.id===id))||typeof p.branch!=='string'||!/^[-\w]{1,80}$/.test(p.branch))fail();targets.add(p.target);}}
 if(raw.dispatchAudit!==undefined){if(!Array.isArray(raw.dispatchAudit)||raw.dispatchAudit.length>2000||!finite(raw.auditStartedAt,0,raw.time)||!Number.isInteger(raw.auditStartedAt)||!finite(raw.auditPriorSpent,0,raw.budget)||(raw.auditTruncated!==undefined&&typeof raw.auditTruncated!=='boolean'))fail();for(const a of raw.dispatchAudit){if(!a||!Number.isInteger(a.at)||!finite(a.at,raw.auditStartedAt,raw.time)||typeof a.edge!=='string'||a.edge.length>80||typeof a.crew!=='string'||a.crew.length>80||typeof a.ok!=='boolean'||typeof a.error!=='string'||a.error.length>200||!finite(a.cost,0,50)||(a.completedAt!==null&&(!Number.isInteger(a.completedAt)||!finite(a.completedAt,a.at,raw.time)))||(a.ok&&(!edges.some(e=>e.id===a.edge)||!fresh.crews.some(c=>c.id===a.crew)||a.cost<1||a.cost!==raw.edges.find(e=>e.id===a.edge)?.cost||a.error))||(!a.ok&&(a.cost!==0||a.completedAt!==null||!a.error)))fail();}}
 if(raw.decisionReview!==undefined){const r=raw.decisionReview;if(!r||r.version!==1||!Number.isInteger(r.at)||!finite(r.at,0,raw.time)||!r.ratings||Object.keys(r.ratings).length!==3||['evidence','analysis','improvement'].some(k=>!Number.isInteger(r.ratings[k])||!finite(r.ratings[k],0,5))||typeof r.reviewer!=='string'||r.reviewer.trim().length<1||r.reviewer.length>60||typeof r.comment!=='string'||r.comment.trim().length<10||r.comment.length>2000||typeof r.signature!=='string'||r.signature.length>40)fail();}
 const result=clone(raw);if(!result.learningId)result.learningId='lab-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);if(challenge)result.challenge=challenge;return result;
}
const api={nodes,edges,scenarios,attachRoadRouting,clone,create,status,passable,reachable,islands,stats,route,requiredType,canDispatch,dispatchEstimate,dispatch,recommend,repairOptions,previewPlan,validateChallenge,createChallengeState,challengeResult,addPrediction,predictionResults,decisionEvaluation,setDecisionReview,schedule,record,step,identify,score,configure,configureEdge,validate,log};root.FloodLab=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
