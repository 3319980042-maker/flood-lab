(()=>{
 'use strict';
 const welcome=document.createElement('section');
 welcome.className='welcome';
 welcome.setAttribute('aria-label','平台登录');
 welcome.innerHTML=`
 <div class="welcome-top">
  <a class="welcome-brand" href="index.html" aria-label="洪涝灾害交通孤岛识别与生命通道抢通虚拟仿真实验教学平台登录首页"><span class="welcome-brandmark" aria-hidden="true">川</span><span class="welcome-brandtext project-name">洪涝灾害交通孤岛识别与生命通道抢通<span>虚拟仿真实验教学平台</span></span></a>
  <a class="welcome-intro-link" href="intro.html">项目简介 <span aria-hidden="true">↗</span></a>
 </div>
 <div class="welcome-layout">
  <section class="welcome-course" aria-label="课程学习介绍"><span class="welcome-course-label">实践教学 · 探究学习</span><h2>观察一座城市，<br>理解一条生命通道。</h2><p>从徐州云龙湖的真实地理出发，观察城市路网，比较抢通方案，在预测与复盘中理解决策后果。</p><div class="welcome-network"><div class="welcome-scene"><img src="xuzhou-3d-preview.jpg?v=52" alt="徐州云龙湖实拍，湖岸建筑与城市天际线"><span>徐州云龙湖 · 实拍城市景观</span></div><small>观察连接 · 权衡取舍 · 验证结果</small></div></section>
  <form class="login-card" id="experience-login">
   <div class="entry-label"><span>实验入口</span><span>实验署名</span></div>
   <h1>开始你的实验</h1>
   <p class="login-description">填写姓名或小组名称，开始本次实验。</p>
   <label for="experience-name">姓名或小组名称</label>
   <input id="experience-name" name="displayName" type="text" autocomplete="nickname" placeholder="例如：第一实验小组" maxlength="60" required>
   <button class="primary" type="submit">进入学习空间 <span aria-hidden="true">→</span></button>
   <button class="guest-entry" type="button" id="guest-entry">访客体验，无需填写</button>
   <p class="login-note">仅用于实验署名，无需密码，不验证身份。</p>
   <div class="login-about">首次使用？<a href="tutorial.html">3分钟新手教程 <span aria-hidden="true">↗</span></a></div>
  </form>
 </div>
 <div class="welcome-bottom"><span>洪涝灾害虚拟仿真实验教学平台</span><span>实拍摄影：<a href="https://commons.wikimedia.org/wiki/File:20260722_Yunlong_Lake_Xuzhou_05.jpg" target="_blank" rel="noopener">祝鱼贵 / Wikimedia Commons</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a> · 页面裁切展示</span></div>`;
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
 const more=document.createElement('details');more.className='header-more';more.innerHTML='<summary>更多</summary><div></div>';more.querySelector('div').append(introduction,back);document.querySelector('.header-actions').append(more);document.addEventListener('click',event=>{if(more.open&&!more.contains(event.target))more.open=false;});
})();