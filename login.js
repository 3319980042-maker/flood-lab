(()=>{
 'use strict';
 const welcome=document.createElement('section');
 welcome.className='welcome';
 welcome.setAttribute('aria-label','实验署名与学习入口');
 welcome.innerHTML=`
 <div class="welcome-top">
  <a class="welcome-brand" href="#home" data-entry-home aria-label="返回课程首页"><span class="welcome-brandmark" aria-hidden="true">川</span><span class="welcome-brandtext project-name">洪涝灾害交通孤岛识别与生命通道抢通<span>虚拟仿真实验教学平台</span></span></a>
  <a class="welcome-intro-link" href="intro.html">项目简介 <span aria-hidden="true">↗</span></a>
 </div>
 <div class="welcome-layout">
  <section class="welcome-course" aria-label="徐州云龙湖实景与实验介绍">
   <div class="welcome-scene"><img src="xuzhou-3d-preview.jpg?v=56" alt="徐州云龙湖实拍，湖岸建筑与城市天际线"></div>
   <div class="welcome-course-copy"><span class="welcome-course-label">城市韧性 · 实验教学</span><h2>观察一座城市，<br>理解一条生命通道。</h2><p>从徐州真实路网出发，在方案比较、动态推演与复盘中，理解决策带来的变化。</p></div>
   <div class="welcome-scene-caption"><span class="welcome-location-pin" aria-hidden="true">◎</span><span><b>徐州 · 云龙湖</b><small>真实地理场景 / 城市实拍</small></span></div>
  </section>
  <form class="login-card" id="experience-login">
   <div class="entry-label"><span>LEARNING SPACE</span><span>实验署名</span></div>
   <h1>从这里，开始探索</h1>
   <p class="login-description">可直接进入学习空间，也可以为本次实验填写署名。</p>
   <label for="experience-name">姓名或小组名称 <span>选填</span></label>
   <input id="experience-name" name="displayName" type="text" autocomplete="nickname" placeholder="例如：第一实验小组" maxlength="60">
   <button class="primary" type="submit">进入学习空间 <span aria-hidden="true">→</span></button>
   <button class="guest-entry" type="button" id="guest-entry">不署名，直接体验 <span aria-hidden="true">→</span></button>
   <p class="login-note">署名仅用于本机实验记录，无需账号或密码。课堂中的角色与身份在加入课堂时单独设置。</p>
   <a class="login-about" href="tutorial.html"><span class="entry-tutorial-icon" aria-hidden="true">▶</span><span><b>第一次使用？</b><small>查看操作步骤与视频演示</small></span><span aria-hidden="true">↗</span></a>
  </form>
 </div>
 <div class="welcome-bottom"><span>观察连接 · 权衡取舍 · 验证结果</span><span>实拍摄影：<a href="https://commons.wikimedia.org/wiki/File:20260722_Yunlong_Lake_Xuzhou_05.jpg" target="_blank" rel="noopener">祝鱼贵 / Wikimedia Commons</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a> · 页面裁切展示</span></div>`;
 document.body.prepend(welcome);
 // Signing a local practice is optional; a direct URL opens the requested page.
 document.body.classList.remove('welcome-open');
 function enter(guest){
  const name=document.getElementById('experience-name').value.trim();
  // Preserve the author and score of an existing experiment; name a fresh practice only.
  if(!guest&&name&&!state.student&&!state.time&&!state.assessment){state.student=name;persist();}
  document.body.classList.remove('welcome-open');
  requestAnimationFrame(()=>window.FloodGeoScene?.getMap()?.resize());
  document.querySelector('#page-title').setAttribute('tabindex','-1');
  document.querySelector('#page-title').focus();
  window.scrollTo(0,0);
  window.dispatchEvent(new Event('flood-enter'));
 }
 document.getElementById('experience-name').addEventListener('input',event=>event.target.setCustomValidity(''));
 document.getElementById('experience-login').addEventListener('submit',event=>{event.preventDefault();enter(false);});
 document.getElementById('guest-entry').addEventListener('click',()=>enter(true));
 welcome.querySelector('[data-entry-home]').addEventListener('click',()=>enter(true));
 const introduction=document.createElement('a');
 introduction.className='project-intro-link';introduction.textContent='项目简介';
 introduction.href='intro.html';introduction.target='_blank';introduction.rel='noopener';
 introduction.setAttribute('aria-label','项目简介（在新标签页打开）');
 const back=document.createElement('button');back.textContent='实验署名';back.type='button';
 back.addEventListener('click',()=>{stop();window.FloodCommandUI?.stop();persist();document.body.classList.add('welcome-open');document.getElementById('experience-name').value=state.student||'';window.scrollTo(0,0);document.getElementById('experience-name').focus();});
 const more=document.createElement('details');more.className='header-more';more.innerHTML='<summary>更多</summary><div></div>';more.querySelector('div').append(introduction,back);document.querySelector('.header-actions').append(more);document.addEventListener('click',event=>{if(more.open&&!more.contains(event.target))more.open=false;});
})();
