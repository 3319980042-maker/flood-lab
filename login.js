(()=>{
 'use strict';
 const welcome=document.createElement('section');
 welcome.className='welcome';
 welcome.setAttribute('aria-label','平台登录');
 welcome.innerHTML=`
 <div class="welcome-top">
  <a class="welcome-brand" href="index.html" aria-label="交通孤岛实验室登录首页"><span class="welcome-brandmark" aria-hidden="true">川</span><span class="welcome-brandtext">交通孤岛实验室<small>CONNECTIVITY LAB</small></span></a>
  <a class="welcome-intro-link" href="intro.html">项目简介 <span aria-hidden="true">↗</span></a>
 </div>
 <div class="welcome-layout">
  <section class="welcome-course" aria-label="课程学习介绍"><span class="welcome-course-label">实践教学 · 探究学习</span><h2>让每一次选择，<br>都有实验作证。</h2><p>在可操作的洪涝交通情景中，学习观察、规划和验证。带着自己的判断进入，再用结果完善它。</p><div class="welcome-network"><svg viewBox="0 0 480 180" role="img" aria-label="教学路网连通关系示意"><path d="M35 130 L155 130 L260 65 L390 65 M155 130 L270 145 L415 145 M260 65 L150 30 L60 55" fill="none" stroke="#adcabc" stroke-width="3"/><path d="M155 130 L260 65" stroke="#ba9c64" stroke-width="3" stroke-dasharray="7 6"/>${[[35,130,'基地'],[155,130,'决策点'],[260,65,'重点设施'],[390,65,'社区'],[270,145,'通道'],[415,145,'安置点'],[150,30,'村落'],[60,55,'社区']].map(([x,y,label],i)=>`<g><circle cx="${x}" cy="${y}" r="${i===0?10:6}" fill="${i===0?'#087e72':'#f4faf6'}" stroke="#75a58b" stroke-width="2"/><text x="${x}" y="${y-17}" text-anchor="middle" fill="#6b8a79" font-size="11">${label}</text></g>`).join('')}</svg><small>观察连接 · 权衡取舍 · 验证结果</small></div></section>
  <form class="login-card" id="experience-login">
   <div class="entry-label"><span>实验入口</span><span>LEARNING PORTAL</span></div>
   <h1>开始你的实验</h1>
   <p class="login-description">填写姓名或小组名称，开始本次实验。</p>
   <label for="experience-name">姓名或小组名称</label>
   <input id="experience-name" name="displayName" type="text" autocomplete="nickname" placeholder="例如：第一实验小组" maxlength="60" required>
   <button class="primary" type="submit">进入学习空间 <span aria-hidden="true">→</span></button>
   <button class="guest-entry" type="button" id="guest-entry">访客体验，无需填写</button>
   <p class="login-note">用于实验署名，无需密码，不验证身份。实验记录保存在当前浏览器。</p>
   <div class="login-about">首次使用？<a href="tutorial.html">3分钟新手教程 <span aria-hidden="true">↗</span></a></div>
  </form>
 </div>
 <div class="welcome-bottom"><span>洪涝灾害虚拟仿真实验教学平台</span><span>徐州云龙湖 · 教学场景</span></div>`;
 document.body.prepend(welcome);
 function enter(guest){
  const name=document.getElementById('experience-name').value.trim();
  if(!guest&&!name){document.getElementById('experience-name').setCustomValidity('请输入姓名或小组名称');document.getElementById('experience-name').reportValidity();return;}
  // Preserve the author and score of an existing experiment; name a fresh practice only.
  if(!guest&&!state.student&&!state.time&&!state.assessment){state.student=name;persist();}
  document.body.classList.remove('welcome-open');
  requestAnimationFrame(()=>FloodGeoScene.getMap()?.resize());
  document.querySelector('#page-title').setAttribute('tabindex','-1');
  document.querySelector('#page-title').focus();
  window.scrollTo(0,0);
  window.dispatchEvent(new Event('flood-enter'));
 }
 document.getElementById('experience-name').addEventListener('input',event=>event.target.setCustomValidity(''));
 document.getElementById('experience-login').addEventListener('submit',event=>{event.preventDefault();enter(false);});
 document.getElementById('guest-entry').addEventListener('click',()=>enter(true));
 const introduction=document.createElement('a');
 introduction.className='project-intro-link';introduction.textContent='项目简介';
 introduction.href='intro.html';introduction.target='_blank';introduction.rel='noopener';
 introduction.setAttribute('aria-label','项目简介（在新标签页打开）');
 document.querySelector('.header-actions').append(introduction);
 const back=document.createElement('button');back.textContent='返回登录首页';back.type='button';
 back.addEventListener('click',()=>{stop();FloodCommandUI.stop();persist();document.body.classList.add('welcome-open');document.getElementById('experience-name').value='';window.scrollTo(0,0);document.getElementById('experience-name').focus();});
 document.querySelector('.header-actions').append(back);
})();