(function(root){
'use strict';
const E=root.FloodLab;
const questions=[
 {id:'priority',at:0,title:'首轮抢通：有限队伍先去哪里？',brief:'医院 H 有急需转运患者，养老院 B 同样需要保障。两支道路队均空闲，医院与养老院的保障目标为 90 分钟。选择后会立即执行对应派遣。',options:[
  {id:'urgent',title:'两队分别抢通 R7 与 R10',detail:'同时保障养老院与医院；投入 20 万元。',points:5,reason:'同时建立两处重点设施的抢修任务，避免医院等待养老院通道后再排涝。',dispatch:[['R7','T1'],['R10','T2']]},
  {id:'population',title:'先抢通 R6 与 R7',detail:'兼顾西侧 580 人与养老院；投入 18 万元。',points:3,reason:'兼顾了较多人口，但医院尚无任务，需要及时补充医院方案。',dispatch:[['R6','T1'],['R7','T2']]},
  {id:'wait',title:'暂不派遣，继续观察',detail:'保留全部预算和队伍，后续自行安排。',points:0,reason:'已知重点设施断连且有可执行任务，等待会延误保障时机。'}]},
 {id:'bridge',at:30,title:'桥梁中断：恢复主通道还是补充西侧路线？',brief:'B1 桥梁刚发生结构损坏；现有绕行道路仍可使用，但持续降雨可能造成进一步阻断。选择将实际改变抢修任务与预算。',options:[
  {id:'bridge',title:'派桥梁队修复 B1',detail:'投入 15 万元，恢复跨河主通道。',points:5,reason:'利用专用桥梁队恢复主通道，减少对积水绕行道路的依赖。',dispatch:[['B1','B1T']]},
  {id:'west',title:'派排涝队处理 R3',detail:'投入 6 万元，为西侧聚落建立进入方向。',points:3,reason:'改善西侧进入条件，但跨河主通道风险仍未解决，需要另行处理。',dispatch:[['R3','P1']]},
  {id:'hold',title:'维持现有任务，不新增抢修',detail:'不追加投入，继续使用绕行路线。',points:0,reason:'未对新增关键通道故障采取行动，后续绕行道路淹没可能导致再次断连。'}]},
 {id:'equipment',at:75,title:'设备故障：怎样安排排涝队？',brief:'排涝设备故障。系统已给当前或后续排涝作业增加 15 分钟工期；可以投入预算排除故障，也可以接受效率下降。',options:[
  {id:'repair',title:'更换设备并恢复效率',detail:'投入 5 万元，消除新增工期。',points:5,reason:'恢复排涝能力，减少后续作业等待；收益取决于剩余排涝任务。',cost:5,penalty:0},
  {id:'remote',title:'远程排障，部分恢复',detail:'投入 2 万元，将新增工期降至 10 分钟。',points:3,reason:'节约投入但保留部分工期延误，是受预算约束时的折中。',cost:2,penalty:10},
  {id:'continue',title:'保持故障状态继续作业',detail:'不追加投入，每项排涝作业仍增加 15 分钟。',points:0,reason:'保留预算，但排涝任务持续变慢，需自行承担对通道恢复的影响。',cost:0,penalty:15}]}];
function start(){const s=E.create('rising');s.budget=55;s.initial.budget=55;s.assessment={version:1,scoringVersion:2,phase:'active',pending:'priority',answers:[],operations:[],pumpPenalty:0,final:null};E.log(s,'开始决策考核：固定 180 分钟、55 万元；首轮决策待处理');return s;}
function active(s){return s.assessment?.phase==='active';}
function addOperation(s,kind,text,extra={}){if(active(s))s.assessment.operations.push({time:s.time,kind,text,...extra});}
function canChoose(s,qid,oid){if(!active(s)||s.assessment.pending!==qid)return '当前没有这项待处理决策';const q=questions.find(v=>v.id===qid),o=q?.options.find(v=>v.id===oid);if(!o)return '决策选项不存在';if(!s.identification)return '请先提交初始孤岛识别';if(o.dispatch){const trial=E.clone(s);trial.assessment=null;for(const [id,cid]of o.dispatch){const result=E.dispatch(trial,id,cid);if(result.error)return result.error;}}if(s.spent+(o.cost||0)>s.budget)return '剩余预算不足';return null;}
function choose(s,qid,oid){const error=canChoose(s,qid,oid);if(error)return {error};const q=questions.find(v=>v.id===qid),o=q.options.find(v=>v.id===oid);s.assessment.pending=null;for(const [id,cid]of o.dispatch||[])E.dispatch(s,id,cid);if(qid==='equipment'){const reduction=s.assessment.pumpPenalty-o.penalty;s.assessment.pumpPenalty=o.penalty;s.spent+=o.cost;const c=s.crews.find(v=>v.id==='P1');if(c.job){const removable=Math.min(reduction,Math.max(0,c.job.end-s.time-1));c.job.end-=removable;c.job.duration-=removable;}}
 s.assessment.answers.push({id:qid,option:oid,time:s.time});addOperation(s,'decision',q.title+'：'+o.title);E.log(s,'决策提交：'+o.title);E.record(s);return {ok:true};}
function dispatchRecorded(s,id,cid,error){if(!active(s))return;addOperation(s,error?'invalid':'dispatch',error?`${id} / ${cid} 派遣被拒绝：${error}`:`派遣 ${cid} 抢修 ${id}`,{edge:id,crew:cid});if(!error&&cid==='P1'&&s.assessment.pumpPenalty){const c=s.crews.find(v=>v.id===cid);c.job.end+=s.assessment.pumpPenalty;c.job.duration+=s.assessment.pumpPenalty;E.log(s,'排涝设备故障使本项任务增加 '+s.assessment.pumpPenalty+' 分钟');}}
function checkpoint(s){if(!active(s))return false;const a=s.assessment;if(a.pending)return true;const q=questions.find(q=>q.at<=s.time&&!a.answers.some(v=>v.id===q.id));if(!q)return false;a.pending=q.id;if(q.id==='equipment'){a.pumpPenalty=15;const c=s.crews.find(v=>v.id==='P1');if(c.job){c.job.end+=15;c.job.duration+=15;}}
 E.log(s,'决策考核暂停：'+q.title);return true;}
function evaluateLegacy(s){const a=s.assessment,st=E.stats(s),baseline=s.timeline[0].available,initialLost=st.pop-baseline;const recovery=n=>initialLost?Math.min(1,Math.max(0,(n-baseline)/initialLost)):1;const restored=recovery(st.available);let area=0;for(let i=0;i<s.timeline.length;i++){const t=s.timeline[i],end=s.timeline[i+1]?.time??180;area+=recovery(t.available)*Math.max(0,end-t.time);}
 const f1=s.identification?(s.identification.truth.length+s.identification.answer.length?2*s.identification.answer.filter(v=>s.identification.truth.includes(v)).length/(s.identification.truth.length+s.identification.answer.length):1):0;
 const early=['B','H'].map(id=>({id,at:s.timeline.find(t=>t.urgentIds.includes(id))?.time??null,reachable:st.reachable.has(id)}));
 const urgent=early.reduce((sum,n)=>sum+(n.reachable?(n.at!==null&&n.at<=90?10:6):0),0);
 const decisions=a.answers.map(v=>{const q=questions.find(q=>q.id===v.id),o=q.options.find(o=>o.id===v.option);return {...v,title:q.title,label:o.title,points:o.points,reason:o.reason};});
 const invalid=a.operations.filter(v=>v.kind==='invalid').length,dispatches=a.operations.filter(v=>v.kind==='dispatch').length;
 const round=n=>Math.round(n*10)/10;
 const rows=[
  {key:'identify',name:'灾情判断',max:20,score:round(20*f1),reason:s.identification?`初始识别 F1 为 ${(f1*100).toFixed(1)}%，计 ${round(20*f1)} 分。`:'未提交初始识别，计 0 分。'},
  {key:'recovery',name:'通道恢复与时效',max:25,score:round(15*restored+10*area/180),reason:`初始不可达 ${initialLost} 人；最终可达 ${st.available} 人。恢复比例计 ${round(15*restored)} 分，180 分钟恢复过程积分计 ${round(10*area/180)} 分。`},
  {key:'urgent',name:'重点设施保障',max:20,score:urgent,reason:early.map(n=>`${n.id==='H'?'医院':'养老院'}：${n.at===null?'未恢复':`T+${n.at} 首次恢复`}，最终${n.reachable?'可达':'不可达'}，${n.reachable?(n.at!==null&&n.at<=90?10:6):0} 分`).join('；')},
  {key:'decisions',name:'关键决策',max:15,score:decisions.reduce((sum,v)=>sum+v.points,0),reason:`三个决策点各 5 分，已完成 ${decisions.length}/3；逐项理由见下方决策复盘。`},
  {key:'resources',name:'预算利用',max:10,score:round(10*restored*(s.spent<=40?1:Math.max(0,1-.4*(s.spent-40)/15))),reason:`投入 ${s.spent}/55 万元；仅对实际恢复比例计分。40 万元以内系数为 1，40–55 万元线性下降至 0.6，避免“不做任务只省钱”得高分。`},
  {key:'operations',name:'派遣规范',max:10,score:dispatches?Math.max(0,10-2*invalid):0,reason:`成功派遣 ${dispatches} 次，无效派遣 ${invalid} 次；每次无效派遣扣 2 分，最低 0 分，未成功派遣计 0 分。`}
 ];const total=round(rows.reduce((sum,v)=>sum+v.score,0));return {total,level:total>=85?'优秀':total>=70?'良好':total>=60?'合格':'需改进',rows,decisions,invalid,dispatches,time:s.time,spent:s.spent,available:st.available,early};}
function evaluate(s){if(s.assessment.scoringVersion!==2)return evaluateLegacy(s);const result=E.decisionEvaluation(s);const decisions=s.assessment.answers.map(v=>{const q=questions.find(q=>q.id===v.id),o=q.options.find(o=>o.id===v.option);return {...v,title:q.title,label:o.title,reason:o.reason};});return {...result,decisions};}
function finalize(s){if(!active(s)||s.time<180||s.assessment.pending)return false;const a=s.assessment;a.final=evaluate(s);a.phase='finished';s.ended=true;E.log(s,'决策考核完成：'+a.final.total+' / 100 分');return true;}
function validateAssessment(s){
 const a=s.assessment;if(a==null)return;
 const fail=()=>{throw new Error('决策考核记录不完整或格式无效')};
 if((a.scoringVersion!==undefined&&a.scoringVersion!==2)||a.version!==1||!['active','finished'].includes(a.phase)||![null,...questions.map(q=>q.id)].includes(a.pending)||![0,10,15].includes(a.pumpPenalty)||s.scenario!=='rising'||s.rain!==80||s.budget!==55)fail();
 if(!Array.isArray(a.answers)||a.answers.length>3)fail();
 a.answers.forEach((v,i)=>{const q=questions[i];if(!v||q.id!==v.id||!q.options.some(o=>o.id===v.option)||v.time!==q.at||v.time>s.time)fail()});
 const next=questions[a.answers.length];
 if(a.pending&&(a.pending!==next?.id||s.time!==next.at))fail();
 if(!a.pending&&next&&next.at<=s.time)fail();
 if(s.timeline.length!==s.time+1||s.timeline.some((t,i)=>t.time!==i))fail();
 if(!Array.isArray(a.operations)||a.operations.length>2000)fail();
 a.operations.forEach(v=>{if(!v||!['invalid','dispatch','decision','plan'].includes(v.kind)||!Number.isInteger(v.time)||v.time<0||v.time>s.time||typeof v.text!=='string'||v.text.length>1000)fail()});
 if(a.phase==='finished'&&(s.time!==180||!s.ended||a.pending||a.answers.length!==3))fail();
 if(a.phase==='active'&&(s.ended||s.time>=180))fail();
 if(a.phase==='finished')a.final=evaluate(s);else a.final=null;
}
const original={step:E.step,identify:E.identify,configure:E.configure,configureEdge:E.configureEdge,recommend:E.recommend,validate:E.validate,score:E.score};
E.step=function(s,minutes=5){if(active(s)&&(!s.identification||s.assessment.pending))return {error:'请先完成初始识别及待处理决策'};const result=original.step(s,minutes);finalize(s);return result;};
E.identify=function(s,selected){if(s.assessment&&s.identification)return {error:'考核识别仅允许提交一次'};return original.identify(s,selected);};
E.configure=function(s,v){return s.assessment?{error:'考核情景参数已锁定'}:original.configure(s,v)};
E.configureEdge=function(s,...v){return s.assessment?{error:'考核初始路况已锁定'}:original.configureEdge(s,...v)};
E.recommend=function(s){return s.assessment?[]:original.recommend(s)};
E.validate=function(raw){const s=original.validate(raw);validateAssessment(s);return s;};
E.score=function(s){return s.assessment?(s.assessment.scoringVersion===2?evaluate(s):(s.assessment.final||evaluate(s))):original.score(s);};
root.FloodAssessment={questions,start,active,canChoose,choose,dispatchRecorded,checkpoint,evaluate,finalize,addOperation};
if(typeof module!=='undefined')module.exports=root.FloodAssessment;
})(typeof globalThis!=='undefined'?globalThis:this);
