/* Beginner guidance changes only the view; learners perform exercise actions themselves. */
window.FloodTutorial=(()=>{
 'use strict';
 const KEY='flood-beginner-guide-v1';
 const $=s=>document.querySelector(s);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let active=null,index=0,courseTask=null,highlighted=null,frame=null,scrollPending=false;
 const panel=document.createElement('aside');panel.id='tutorial-panel';panel.hidden=true;panel.setAttribute('aria-label','新手操作引导');
 $('main').insertBefore(panel,$('#workspace-tabs'));
 function prefs(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch{return {};}}
 function remember(completed){try{const p=prefs();p.seen=true;if(completed)p[completed]=true;localStorage.setItem(KEY,JSON.stringify(p));}catch{}}
 const current=()=>FloodCommandUI.getState();
 function task(){const s=current();if(!s.tasks.some(t=>t.id===courseTask))courseTask=s.tasks[0]?.id;return s.tasks.find(t=>t.id===courseTask);}
 const taskButton=action=>{const t=task();return t?$(`[data-cmd="${action}"][data-id="${CSS.escape(t.id)}"]`):null;};
 const exercise=[
  {title:'选择脚本，开始一场演练',page:'command',target:()=>$('[data-cmd="new"]'),text:()=>['running','paused'].includes(current().run.status)?'当前已有一场演练，可以直接继续；无需重新创建。':'点击高亮的“选择脚本 / 新建演练”，选择“01 · 暴雨应急协同”，再确认开始。',ready:()=>['running','paused'].includes(current().run.status),hint:'开始后，地图下方会出现第一项任务。'},
  {title:'为第一项任务派遣力量',page:'command-dispatch',target:()=>taskButton('dispatch')||$('.practice-module'),text:()=>task()?'找到“'+task().title+'”，点击“派遣”。先保留表单中按需求填写的人员、车辆和物资数量，确认派遣。':'当前没有任务，请返回上一步，开始演练脚本。',ready:()=>!!task()&&current().deployments.some(d=>d.taskId===task().id),hint:'完成后可在地图上看到路线，派出的资源会从可用数量中扣除。'},
  {title:'推进时间，观察到场与作业',page:'command',target:()=>$('[data-cmd="resume"]')||$('[data-cmd="tick"]'),text:()=>current().run.status==='paused'?'当前演练已暂停，先点击“继续”，再使用“+5 分钟”推进。':'连续点击“+5 分钟”，直到第一项任务显示“已完成”。第一套脚本通常需要推进到约T+30分钟。',ready:()=>task()?.status==='completed',hint:'到达现场后还需要作业时间；任务满足资源需求并完成作业才算完成。'},
  {title:'提交执行反馈和题目答案',page:'command-reports',target:()=>taskButton('report-task'),text:()=>'点击第一项任务的“执行 / 答题”，写一段处置说明，按自己的判断作答，再提交。',ready:()=>!!task()&&current().reports.some(r=>r.taskId===task().id),hint:'示例说明：已核查受困人员并完成转移，已向安置点交接。题目答案请自行判断。'},
  {title:'查看结果，导出一份报告',page:'command-review',target:()=>$('.command-report-actions'),text:()=>'这里可以查看完成情况、评分依据和人工评估。点击“导出 Word 报告”，或导出HTML后打印为PDF。',hint:'入门只要求熟悉一项任务；其他任务未完成会如实记录在报告中。导出操作由你决定。'},
  {title:'拖动时间轴，回看你的操作',page:'command-replay',target:()=>$('#command-replay-slider'),text:()=>'拖动高亮的时间轴，查看不同阶段的任务、队伍、标绘和天气。回放不会改写当前演练。',hint:'你已熟悉完整流程，可以返回情景任务处理其余任务，或开始另一套脚本。'}
 ];
 const teaching=[
  {title:'先看懂通行状态',page:'identify',target:()=>$('.geo-legend'),text:()=>'从救援基地S出发判断通行关系。绿色可通、橙色限行仍可通、红色阻断不可通；蓝色表示正在抢修。',hint:'这里的孤岛指无法到达基地的人口区域；识别计算使用预设的教学路网。'},
  {title:'选择受困区域，再提交识别',page:'identify',target:()=>$('[data-action="identify"]'),text:()=>'在地图点位或右侧清单选择你认为受困的区域，再点击“提交识别结果”。应在派遣和推进前完成。',hint:'系统同时检查漏选和误选。已开始的实验或已提交的考核答案可能锁定，本导览不会清空答案。'},
  {title:'先看预算，再比较抢通顺序',page:'plan',target:()=>$('#teaching-plan'),text:()=>'先查询当前可通行路线，点击阻断道路加入抢通计划；在“方案比较”预演后，进入左侧“抢修队伍派遣”配置队伍。',hint:'道路、桥梁、排涝工种要匹配；预算、队伍空闲状态和进场通道也需满足条件。'},
  {title:'把自己的计划和规则参考放在一起比较',page:'compare',target:()=>$('.comparison-cards')||$('#content'),text:()=>'比较相同条件下的投入、最终可达人口和重点设施可达性，再回到规划页说明自己的取舍。',hint:'预演不会扣除预算或推进当前实验；参考规则不保证全局最优，考核中不提供该辅助。'},
  {title:'保存决策点，复制另一条学习路线',page:'branch-lab',target:()=>$('.studio-points')||$('#content'),text:()=>'分支复盘会保存关键时刻。选择一个未结束的决策点，写明准备改变什么，再复制分支；原实验会独立保留。',hint:'导览只介绍入口，不会创建分支。手动命名的点优先保留；不同实际时刻请用统一时点预演作对照。'},
  {title:'自己设计一道有目标的挑战题',page:'challenge-lab',target:()=>$('#studio-challenge-form')||$('#content'),text:()=>'先写学习目标，再设置预算、路况、道路费用和工期。检查题目并亲自试做后，可导出JSON让同学导入作答。',hint:'草稿独立保存，不会改变当前实验。参考未达标不能证明题目无解；挑战目标按指定时刻的真实推演记录检验。'},
  {title:'单独配置抢修队伍',page:'resources',target:()=>$('#teaching-dispatch'),text:()=>'这里专门处理教学道路抢修：检查工种、空闲队伍、预算与进场条件，再手动派遣或按计划自动派遣。',hint:'“协作实践 / 力量派遣”是另一份任务练习；道路抢修请使用当前页面。'},
  {title:'推进推演，观察道路变化',page:'simulate',target:()=>$('.simulation-toolbar'),text:()=>'用“推进 5 分钟”逐步观察，或开始自动推演。留意抢通完成时刻、受困人口和新增险情。',hint:'可暂停返回预算与通道规划调整方案。决策考核遇到关键问题会暂停，需先作答。'},
  {title:'到教学成绩查看复盘',page:'results',target:()=>$('[data-action="report"]')||$('#content'),text:()=>'在“学习与决策 / 学习评价”查看四维分项、目标首次完成时间和计算依据。自动项85分，教师或同伴点评15分，点评前总评显示待完成。',hint:'教学成绩与协同演练报告分别记录。历史实验在“参数、考核与资料 / 实验记录”中保存或载入。'}
 ];
 const steps=()=>active==='teaching'?teaching:exercise;
 function localPractice(){return FloodCommandUI.getMode()==='local'&&FloodCommandUI.getRole()==='director'&&state.assessment?.phase!=='active';}
 function open(){
  if(active)finish(false);
  const disabled=!localPractice();
  window.modal(`<div class="tutorial-menu"><span class="tutorial-eyebrow">QUICK START / 新手教程</span><h2>先学会做一次通道决策</h2><p>第一次使用，建议先走教学实验导览；需要练习分工表达，再进入协作实践。</p><div class="tutorial-paths"><button data-tutorial="start" data-course="exercise" ${disabled?'disabled':''}><b>3分钟 · 第一次协作实践</b><span>选脚本 → 派遣 → 推进 → 反馈 → 报告 → 回放</span></button><button data-tutorial="start" data-course="teaching"><b>3分钟 · 交通孤岛实验导览 <small>推荐</small></b><span>了解识别、规划、分支复盘、学生出题与学习评价。</span></button></div>${disabled?'<p class="tutorial-note">协同跟做引导用于本机导调练习。当前在联机、其他角色或考核中，可先阅读手册或查看导览。</p>':''}<a class="tutorial-manual-link" href="tutorial.html" target="_blank" rel="noopener">打开完整文字教程 ↗</a> <a class="tutorial-manual-link" href="tutorial.html#video" target="_blank" rel="noopener">观看视频演示 ↗</a><p class="tutorial-note">可以随时退出引导，当前实验会保留。</p></div>`);
 }
 function start(course){
  if(course==='exercise'&&!localPractice())return;
  active=course==='teaching'?'teaching':'exercise';index=0;courseTask=null;remember();$('#tutorial-offer')?.remove();
  if($('#dialog').open)$('#dialog').close();
  // Stop local automatic clocks; no model reset, dispatch, answer or tick is performed.
  stop();FloodCommandUI.stop();enterStep();
 }
 function enterStep(){
  clearHighlight();scrollPending=true;
  const step=steps()[index];window.navigate(step.page);
  if(step.page==='command')FloodCommandUI.showWorkTab('tasks');
  refresh();requestAnimationFrame(()=>panel.focus({preventScroll:true}));
 }
 function clearHighlight(){highlighted?.classList.remove('tutorial-target');highlighted=null;}
 function refresh(){
  if(!active)return;
  const list=steps(),step=list[index];panel.hidden=false;panel.tabIndex=-1;
  const ready=!step.ready||step.ready(),onPage=document.body.dataset.page===step.page;
  const focus=document.activeElement?.closest('[data-tutorial]')?.dataset.tutorial;
  panel.innerHTML=`<div class="tutorial-panel-head"><span class="tutorial-eyebrow">${active==='exercise'?'第一次协同演练':'教学实验导览'} · ${index+1} / ${list.length}</span><button data-tutorial="exit" aria-label="退出新手引导">×</button></div><div class="tutorial-progress" aria-hidden="true">${list.map((_,i)=>`<i class="${i<=index?'done':''}"></i>`).join('')}</div><h2>${step.title}</h2><p>${esc(step.text())}</p><p class="tutorial-panel-note">${esc(step.hint)}</p><div class="tutorial-panel-actions"><span class="tutorial-step-status" role="status">${!onPage?'已切换页面，可返回当前步骤':step.ready?(ready?'✓ 这一步已完成':'请先完成高亮处的操作'):'跟着高亮位置了解操作'}</span><div><a href="tutorial.html" target="_blank" rel="noopener">查看手册 ↗</a>${!onPage?'<button data-tutorial="return">返回此步骤</button>':''}<button data-tutorial="back" ${index===0?'disabled':''}>上一步</button><button class="primary" data-tutorial="next" ${!ready?'disabled':''}>${index===list.length-1?'完成入门':'下一步 →'}</button></div></div>`;
  document.documentElement.style.setProperty('--tutorial-offset',(panel.getBoundingClientRect().height+24)+'px');
  clearHighlight();if(onPage){highlighted=step.target();highlighted?.classList.add('tutorial-target');}
  if(focus)panel.querySelector(`[data-tutorial="${focus}"]`)?.focus({preventScroll:true});
  if(scrollPending){scrollPending=false;const target=highlighted||panel;requestAnimationFrame(()=>target.scrollIntoView({block:'start',behavior:'auto'}));}
  addDialogHint();
 }
 function schedule(){if(!active||frame)return;frame=requestAnimationFrame(()=>{frame=null;refresh();});}
 function addDialogHint(){
  if(!active||active!=='exercise'||!$('#dialog').open)return;
  const content=$('#dialog-content');if(content.querySelector('.tutorial-dialog-hint'))return;
  let text='';
  if(content.querySelector('#command-new-form'))text='新手提示：建议选择“01 · 暴雨应急协同”，然后确认开始。';
  if(content.querySelector('#command-dispatch-form'))text='新手提示：先保留按任务需求填写的数量，再确认派遣；到场后仍需要完成现场作业。';
  if(content.querySelector('#command-report-form'))text='新手提示：写清采取的措施和交接结果，按自己的判断回答题目，再提交。';
  if(text){const hint=document.createElement('p');hint.className='tutorial-dialog-hint';hint.textContent=text;content.prepend(hint);}
 }
 function finish(completed){
  const course=active;remember(completed?course:null);active=null;clearHighlight();panel.hidden=true;panel.innerHTML='';document.documentElement.style.removeProperty('--tutorial-offset');$('.tutorial-dialog-hint')?.remove();
  if(completed){window.navigate(course==='exercise'?'command':'identify');window.toast('新手教程已完成，可随时从顶栏重新打开。');}else if(course){panel.blur();$('#page-title')?.focus({preventScroll:true});}
 }
 function offer(){
  if(prefs().seen||active||document.body.classList.contains('welcome-open')||$('#tutorial-offer'))return;
  const box=document.createElement('section');box.id='tutorial-offer';box.className='tutorial-offer';box.setAttribute('aria-label','新手上手提示');
  box.innerHTML='<div><b>第一次使用？先学会做一次通道决策</b><span>先识别，再规划、比较、实施与复盘。</span></div><div><button class="primary" data-tutorial="menu">开始新手教程</button><button data-tutorial="dismiss" aria-label="暂时关闭新手提示">稍后再看</button></div>';
  $('main').insertBefore(box,$('#workspace-tabs'));
 }
 document.addEventListener('click',event=>{
  const el=event.target.closest('[data-tutorial]');if(!el||el.disabled)return;
  switch(el.dataset.tutorial){
   case 'menu':remember();$('#tutorial-offer')?.remove();open();break;
   case 'start':start(el.dataset.course);break;
   case 'dismiss':remember();$('#tutorial-offer')?.remove();break;
   case 'exit':finish(false);break;
   case 'return':enterStep();break;
   case 'back':if(active&&index>0){index--;enterStep();}break;
   case 'next':if(!active)break;{const step=steps()[index];if(step.ready&&!step.ready())break;if(index===steps().length-1)finish(true);else{index++;enterStep();}}break;
  }
 });
 window.addEventListener('flood-enter',offer);
 window.addEventListener('flood-view-updated',schedule);
 window.addEventListener('flood-dialog-open',addDialogHint);
 $('#dialog').addEventListener('close',schedule);
 window.addEventListener('resize',schedule);
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&active&&!$('#dialog').open){event.preventDefault();finish(false);}});
 return {open,start,close:()=>finish(false)};
})();
