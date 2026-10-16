(()=>{
 'use strict';
 const welcome=document.createElement('section');
 welcome.className='welcome';
 welcome.setAttribute('aria-label','平台介绍与体验登录');
 welcome.innerHTML=`<div class="welcome-top"><strong>川 · 洪涝应急实验室</strong><span>VIRTUAL SIMULATION · 智慧教育</span></div>
 <div class="welcome-layout"><div><div class="welcome-eyebrow">灾害情景中的判断、行动与复盘</div><h1>识别交通孤岛<br><em>抢通生命通道</em></h1><p class="welcome-subtitle">洪涝灾害虚拟仿真实验教学平台</p><p class="welcome-description">当洪水阻断道路，医院、社区和养老院如何重新连接救援基地？在模拟灾情中识别受困区域、规划抢通顺序、调度专业队伍，观察不同决策的后果，并获得可解释的考核评分。</p>
 <svg class="welcome-map" viewBox="0 0 680 235" role="img" aria-label="教学场景示意：洪水分隔道路，救援基地通过待抢通路段连接社区和医院"><defs><pattern id="welcome-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="#51778a" stroke-opacity=".16"/></pattern></defs><rect width="680" height="235" rx="12" fill="url(#welcome-grid)"/><path d="M-20 110 Q160 200 320 105 T710 125" stroke="#2d7694" stroke-opacity=".35" stroke-width="48" fill="none"/><path d="M65 185L225 185L380 160L575 70M225 185L200 60L380 55L575 70" stroke="#62cfb8" stroke-width="3" fill="none"/><path d="M225 185L200 60M380 160L575 70" stroke="#ffad86" stroke-width="5" stroke-dasharray="9 7"/><g fill="#133d4b" stroke="#74deca" stroke-width="2"><circle cx="65" cy="185" r="10"/><circle cx="200" cy="60" r="10"/><circle cx="380" cy="55" r="10"/><circle cx="575" cy="70" r="10"/><circle cx="380" cy="160" r="7"/></g><g fill="#c3dce4" font-size="14"><text x="26" y="217">救援基地</text><text x="174" y="35">社区 A</text><text x="350" y="30">养老院</text><text x="550" y="45">医院 H</text><text x="230" y="116" fill="#ffba95">道路阻断</text><text x="492" y="163" fill="#ffba95">待抢通</text></g><text x="460" y="217" fill="#7c9eaf" font-size="12">教学路网示意 · 非真实灾情</text></svg></div>
 <form class="login-card" id="experience-login"><h2>欢迎进入实验室</h2><p>从一次应急决策开始，探索你的抢通方案。</p><label for="experience-name">姓名或小组名称</label><input id="experience-name" name="displayName" autocomplete="nickname" placeholder="例如：第一实验小组" maxlength="60" required><button class="primary" type="submit">体验登录 · 进入平台 →</button><button class="guest-entry" type="button" id="guest-entry">访客体验，无需填写</button><p class="login-note">体验登录用于实验署名，无需密码，不验证身份。实验记录保存在当前浏览器。</p><div class="login-divider"><b>你将体验什么？</b><p>3 种教学情景 · 4 支专业队伍 · 6 项考核维度<br>自由练习与决策考核，可导出实验报告。</p></div></form></div>
 <section class="welcome-steps" aria-label="学习流程"><article><b>01 / IDENTIFY</b><h3>识别交通孤岛</h3><p>阅读道路状态，判断哪些聚落无法到达救援基地。</p></article><article><b>02 / PLAN</b><h3>规划与调度</h3><p>匹配抢修工种，在有限预算下安排抢通顺序。</p></article><article><b>03 / DECIDE</b><h3>动态决策</h3><p>面对桥梁中断和设备故障，调整行动方案。</p></article><article><b>04 / REFLECT</b><h3>评分与复盘</h3><p>查看恢复时效、重点保障与操作评分，导出报告。</p></article></section><div class="welcome-bottom"><span>交互式二维路网教学仿真 · 虚构区域与教学参数</span><span>用于教学练习，不用于实际应急指挥</span></div>`;
 document.body.prepend(welcome);
 const map=welcome.querySelector('.welcome-map');
 const scene=document.createElement('div');scene.className='welcome-scene';
 map.before(scene);
 scene.innerHTML='<div class="scene-heading"><span><i></i>清河流域 · 教学场景</span><span>SCENARIO / 01</span></div>';
 scene.append(map);
 const legend=document.createElement('div');legend.className='scene-legend';legend.innerHTML='<span><i></i>可通行道路</span><span><i class="broken"></i>受阻通道</span><span>判断目标：恢复基地与聚落的连接</span>';scene.append(legend);
 const diagram=map.querySelector('rect');
 diagram.insertAdjacentHTML('afterend','<g fill="#295061" fill-opacity=".6" stroke="#497080" stroke-opacity=".45"><path d="M110 35h20v24h-20zM136 32h27v30h-27zM250 31h22v30h-22zM282 22h28v39h-28zM325 31h19v30h-19zM443 35h28v23h-28zM486 25h21v34h-21zM593 94h28v26h-28zM625 85h25v35h-25zM80 138h27v25H80zM118 147h23v17h-23zM280 180h25v25h-25zM322 180h22v33h-22zM414 181h22v25h-22z"/></g>');
 welcome.querySelector('.welcome-top strong').innerHTML='<span class="welcome-brandmark" aria-hidden="true">川</span><span class="welcome-brandtext">洪涝应急实验室<small>FLOOD RESPONSE LAB</small></span>';
 const form=welcome.querySelector('.login-card');
 form.insertAdjacentHTML('afterbegin','<div class="entry-label"><span>实验入口</span><span>LEARNING PORTAL</span></div>');
 form.querySelector('.login-divider').innerHTML='<b>两种学习方式</b><div class="learning-modes"><div><span>自由练习</span><p>探索情景，调整方案，观察变化。</p></div><div><span>决策考核</span><p>独立选择，记录操作，解释得分。</p></div></div><p class="entry-output">实验成果：操作记录 / 分项成绩 / 可导出报告</p>';
 welcome.querySelector('.welcome-steps').insertAdjacentHTML('beforebegin','<div class="journey-heading"><div><span>LEARNING JOURNEY</span><h2>从看懂灾情，到解释每一次决策</h2></div><p>识别 → 行动 → 反馈，形成完整学习过程</p></div>');
 function enter(guest){
   const name=document.getElementById('experience-name').value.trim();
   if(!guest&&!name){document.getElementById('experience-name').setCustomValidity('请输入姓名或小组名称');document.getElementById('experience-name').reportValidity();return;}
   // Preserve the author and score of an existing experiment; name a fresh practice only.
   if(!guest&&!state.student&&!state.time&&!state.assessment){state.student=name;persist();}
   document.body.classList.remove('welcome-open');
   document.querySelector('#page-title').setAttribute('tabindex','-1');
   document.querySelector('#page-title').focus();
   window.scrollTo(0,0);
 }
 document.getElementById('experience-name').addEventListener('input',e=>e.target.setCustomValidity(''));
 document.getElementById('experience-login').addEventListener('submit',e=>{e.preventDefault();enter(false);});
 document.getElementById('guest-entry').addEventListener('click',()=>enter(true));
 const back=document.createElement('button');back.textContent='返回登录首页';back.type='button';
 back.addEventListener('click',()=>{stop();persist();document.body.classList.add('welcome-open');document.getElementById('experience-name').value='';window.scrollTo(0,0);document.getElementById('experience-name').focus();});
 document.querySelector('.header-actions').append(back);
})();
