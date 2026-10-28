/* Help presents one learning path; it never resets or acts on an experiment. */
window.FloodTutorial=(()=>{
 'use strict';
 function close(){if(document.querySelector('#dialog')?.open)document.querySelector('#dialog').close();}
 function start(){close();window.navigate('classroom');}
 function open(){
  window.modal(`<div class="tutorial-menu"><span class="tutorial-eyebrow">学习指南 · 完成一轮实验</span><h2>先判断，再行动，最后解释结果。</h2><p>识别、预测和派遣都在课堂地图左侧，按需打开即可。</p><ol class="tutorial-quick-steps"><li><span>01</span><div><b>准备</b><p>创建实验，确认情景、预算与雨强后开始。</p></div></li><li><span>02</span><div><b>判断与行动</b><p>先提交孤岛识别与预测，再选择道路和队伍；派遣后推进或快进时间。</p></div></li><li><span>03</span><div><b>报告与复盘</b><p>对照预测和实际，解释决策依据，结束后导出报告。</p></div></li></ol><div class="actions"><button class="primary" data-tutorial="classroom">进入课堂实验 →</button><a href="tutorial.html" target="_blank" rel="noopener">阅读五步图文指南 ↗</a></div><p class="tutorial-note">单机记录保存在当前浏览器；此指南不会清空、派遣或推进已有实验。</p></div>`);
 }
 document.addEventListener('click',event=>{const button=event.target.closest('[data-tutorial]');if(!button||button.disabled)return;if(['classroom','start','real'].includes(button.dataset.tutorial))start();else if(button.dataset.tutorial==='menu')open();else if(['exit','dismiss'].includes(button.dataset.tutorial))close();});
 return Object.freeze({open,start,close});
})();
