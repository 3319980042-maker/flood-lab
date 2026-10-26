/* Source: frontend/classroom/api.js */
/*
 * 课堂前端 / 请求层
 * 输入：路径、操作数据、会话令牌。
 * 输出：服务返回的数据和不含令牌的请求记录。
 * 这里不读写网页、不保存课堂状态，也不计算实验结果。
 */
window.FloodClassroomAPI = (() => {
  'use strict';

  function createClient({ baseUrl = '/api/learning', timeoutMs = 8000 } = {}) {
    async function request({ path, method = 'GET', body, token } = {}) {
      const started = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let status = 0;
      let data;

      try {
        const headers = {};
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (token) headers.Authorization = 'Bearer ' + token;

        const response = await fetch(baseUrl + path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal
        });
        status = response.status;
        const text = await response.text();

        try {
          data = JSON.parse(text);
        } catch {
          throw new Error('当前地址没有启动课堂后端，请使用下方的本地服务入口。');
        }
        if (!response.ok) {
          const error = new Error(data.message || '请求失败');
          error.code = data.error;
          throw error;
        }
        return { data, trace: trace() };
      } catch (original) {
        let error = original;
        if (original.name === 'AbortError') {
          error = new Error('服务响应超时，请重试；未确认的操作不会在前端自行执行。');
        } else if (!status) {
          error = new Error('未能连接课堂服务，请检查服务窗口是否仍在运行。');
        }
        error.serviceUnavailable = !status || status === 404;
        error.trace = trace();
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      // 只记字段名，不记录姓名、表单值或会话令牌。
      function trace() {
        return {
          method,
          path: baseUrl + path,
          fields: body === undefined ? [] : Object.keys(body),
          status: status || '连接失败',
          ms: Date.now() - started,
          version: data?.version,
          phase: data?.phase
        };
      }
    }

    return Object.freeze({ request });
  }

  return Object.freeze({ createClient });
})();

;
/* Source: frontend/classroom/views.js */
/*
 * 课堂前端 / 显示层
 * view(model)、renderReport(model) 只接收页面模型并返回 HTML。
 * 不访问 DOM、网络、存储，不产生实验结果。地图容器由 controller 提供。
 */
window.FloodClassroomViews = (() => {
  'use strict';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const roles = { teacher: '教学组织者', student: '学生', observer: '观察者' };
  const types = { road: '道路清障', pump: '排涝', bridge: '桥梁加固' };
  const roadStates = { blocked: '阻断', repair: '作业中', limited: '限行', open: '通行' };
  const tools = [
    ['observe', '观察地图', '先了解路况', 'map'],
    ['route', '两点寻路', '起点与终点', 'route'],
    ['identify', '孤岛识别', '判断断连聚落', 'target'],
    ['predict', '决策预测', '先判断后验证', 'chart'],
    ['dispatch', '通道抢通', '选择道路与队伍', 'route'],
    ['events', '过程记录', '查看小组操作', 'list']
  ];

  // 图标使用内联 SVG，避免新增资源依赖。
  function icon(name) {
    const paths = {
      map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z"/><path d="M9 3v16M15 5v16"/>',
      target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
      chart: '<path d="M4 3v17h17M7 15l4-5 4 3 5-7"/><path d="M16 6h4v4"/>',
      route: '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 5h9a4 4 0 0 1 0 8H8a4 4 0 0 0 0 8h9"/>',
      list: '<path d="M8 6h12M8 12h12M8 18h12M3 6h1M3 12h1M3 18h1"/>',
      arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
      users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M19 20v-2a6 6 0 0 0-3-5"/>',
      check: '<path d="m5 12 4 4L19 6"/>'
    };
    return `<svg class="lc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.map}</svg>`;
  }

  function header(model) {
    const { snapshot: s, online, explain } = model;
    const stageTitle = !s ? '开始一轮课堂实验' : ({ draft: '准备本轮任务', running: s.title, finished: '实验报告与学习复盘' })[s.phase];
    if (s?.phase === 'running') return `<header class="lc-top lc-map-top"><div class="lc-heading"><h2>${esc(s.title)}</h2><span class="lc-map-session">实验进行中 · ${esc(s.code)} · ${esc(roles[s.role] || s.role)}</span></div><div class="lc-header-actions"><span class="lc-service ${online ? 'is-online' : ''}"><i></i>${online ? '已连接' : '等待连接'}</span><button data-learning="explain" aria-expanded="${Boolean(explain)}">课堂指南</button><button data-learning="refresh">刷新</button><button data-learning="disconnect">返回入口</button></div></header>`;
    return `<header class="lc-top">
      <div class="lc-heading"><span class="lc-kicker">交通孤岛 · 教学工作区</span><h2>${esc(stageTitle)}</h2></div>
      <div class="lc-header-actions"><span class="lc-service ${online ? 'is-online' : ''}"><i></i>${online ? '课堂已连接' : '等待课堂连接'}</span>
        <button data-learning="explain" aria-expanded="${Boolean(explain)}">${explain ? '收起指南' : '课堂指南'}</button><button data-nav="home">课程目录</button>
      </div>
    </header>${s ? `<div class="lc-stage"><ol class="lc-steps">${[['draft', '01', '设置'], ['running', '02', '实验'], ['finished', '03', '报告']].map(([phase, number, title]) => `<li class="${s.phase === phase ? 'current' : ''}" ${s.phase === phase ? 'aria-current="step"' : ''}><small>${number}</small>${title}</li>`).join('')}</ol>
      <div class="lc-session-info"><span>实验码 <b>${esc(s.code)}</b></span><span class="lc-role">${esc(roles[s.role] || s.role)}</span></div>
      <div class="lc-session-actions"><button data-learning="refresh">刷新</button><button data-learning="disconnect">返回入口</button></div>
    </div>` : ''}`;
  }

  function loadingView() {
    return `<section class="lc-empty"><span class="lc-kicker">课堂工作区</span><h2>连接教学服务</h2><p>正在读取本轮课堂条件与实验记录。</p></section>`;
  }

  function offlineView() {
    return `<section class="lc-empty"><span class="lc-kicker">本地启动</span><h2>先启动本地课堂服务</h2><p>课堂服务负责保存实验、检查预算与同步小组操作。</p>
      <ol><li>打开维护源码目录 <code>work/flood-lab</code>。</li><li>双击 <b>启动课堂框架.cmd</b>，提示就绪后可关闭启动窗口。</li><li>访问 <a href="http://127.0.0.1:8770/#classroom">http://127.0.0.1:8770/#classroom</a>。</li></ol>
      <p class="hint">GitHub Pages 和本地HTML可继续使用原有离线实验；课堂工作区需要Node.js服务。</p><div class="actions"><button class="primary" data-learning="retry">重新连接</button><button data-nav="home">返回离线课程</button></div></section>`;
  }

  function introduction(model) {
    const { catalog, busy, entry, createDraft: c = {}, joinDraft: j = {} } = model;
    const options = (catalog?.scenarios || []).map(s => `<option value="${esc(s.id)}" ${s.id === c.scenario ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    const create = `<form id="learning-create" class="lc-card lc-entry-form"><div class="lc-section-title"><div><span class="lc-kicker">教学组织者 / 出题小组</span><h3>创建一轮课堂</h3><p>先选择情景，具体条件在准备区确认。</p></div><button type="button" data-learning-entry="">返回</button></div><label class="field">你的姓名 / 小组<input name="name" maxlength="40" value="${esc(c.name)}" required></label><label class="field">实验名称<input name="title" maxlength="40" value="${esc(c.title)}" required></label><label class="field">实验情景<select name="scenario">${options}</select></label><input type="hidden" name="budget" value="${esc(c.budget)}"><input type="hidden" name="rain" value="${esc(c.rain)}"><button type="submit" class="primary lc-wide" ${busy ? 'disabled' : ''}>创建，进入准备区 ${icon('arrow')}</button></form>`;
    const join = `<form id="learning-join" class="lc-card lc-entry-form"><div class="lc-section-title"><div><span class="lc-kicker">学生 / 观察者</span><h3>按实验码加入</h3><p>使用组织者分享的六位实验码。</p></div><button type="button" data-learning-entry="">返回</button></div><label class="field">实验码<input name="code" value="${esc(j.code)}" required pattern="[0-9]{6}" maxlength="6" inputmode="numeric" placeholder="六位实验码"></label><label class="field">姓名 / 小组<input name="name" value="${esc(j.name)}" required maxlength="40" placeholder="例如：第一小组"></label><label class="field">课堂职责<select name="role"><option value="student" ${j.role === 'student' ? 'selected' : ''}>学生：分析与派遣</option><option value="observer" ${j.role === 'observer' ? 'selected' : ''}>观察者：只读查看</option></select></label><button type="submit" class="primary lc-wide" ${busy ? 'disabled' : ''}>加入课堂 ${icon('arrow')}</button></form>`;
    return `<section class="lc-access"><div class="lc-access-context"><span class="lc-kicker">准备 → 地图实验 → 学习报告</span><h2>进入你的课堂</h2><p>每次只处理当前阶段的任务。条件在准备区设置，识别、预测和派遣在地图中完成。</p><figure class="lc-entry-photo"><img src="xuzhou-3d-preview.jpg?v=53" alt="徐州云龙湖城市湖岸实拍"><figcaption>摄影：<a href="https://commons.wikimedia.org/wiki/File:20260722_Yunlong_Lake_Xuzhou_05.jpg" target="_blank" rel="noopener">祝鱼贵</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a> · 裁切展示</figcaption></figure><details class="lc-access-note"><summary>本轮教学模型说明</summary><p>真实道路课堂：12个教学地点、17处局部作业任务；道路来自公开地图，人口、灾情与费用为教学设定。</p><button data-nav="real-lab">进入独立真实路网实验 →</button></details></div><div class="lc-access-main">${entry === 'create' ? create : entry === 'join' ? join : `<div class="lc-access-choice"><span class="lc-kicker">课堂接入</span><h3>这次怎样开始？</h3><button class="primary" data-learning-entry="join">${icon('users')}<span><b>加入课堂</b><small>我有组织者提供的实验码</small></span>${icon('arrow')}</button><button data-learning-entry="create">${icon('map')}<span><b>创建课堂</b><small>我要组织实验，或独立练习</small></span>${icon('arrow')}</button></div>`}${model.recentSessions?.length && !entry ? `<details class="lc-recent-sessions" open><summary>继续最近的课堂 <small>${model.recentSessions.length}</small></summary><div class="lc-recent-list">${model.recentSessions.map(item => `<button data-learning-resume="${esc(item.code)}" ${busy ? 'disabled' : ''}><span>${esc(item.title || '课堂实验')}</span><small>${esc(item.code)} · ${esc(roles[item.role] || '课堂成员')} · ${{draft:'待开始',running:'进行中',finished:'已结束'}[item.phase] || '已保存'}</small><b>${item.phase === 'finished' ? '报告' : '继续'} →</b></button>`).join('')}</div><p>本浏览器保留原课堂身份。</p></details>` : ''}</div></section>`;
  }


  function membersView(members) {
    return `<ul class="lc-member-list">${members.map(member => `<li><span class="lc-member-avatar">${esc(member.name?.slice(0, 1) || '组')}</span><div><b>${esc(member.name)}</b><small>${esc(roles[member.role] || member.role)}</small></div><span class="lc-member-online">已加入</span></li>`).join('')}</ul>`;
  }

  function preparation(model) {
    const { snapshot: s, catalog, busy, preparation: tab = 'task' } = model;
    const locked = s.role !== 'teacher';
    const config = model.configDraft || s.config;
    const scenario = catalog.scenarios.find(v => v.id === s.config.scenario);
    const task = `<section class="lc-task-sheet lc-card"><span class="lc-kicker">本轮任务书</span><h2>有限预算下，怎样恢复更多连通？</h2><p>先找出与基地失去联系的聚落，记录预测；进入地图后选择受阻道路与队伍，观察行动造成的变化。</p><div class="lc-task-baseline"><div><small>初始可达人口</small><strong>${s.stats.available}<em>人</em></strong></div><div><small>初始断连人口</small><strong>${s.stats.isolated}<em>人</em></strong></div><div><small>仿真时限</small><strong>${s.config.horizon || 180}<em>分钟</em></strong></div></div><details class="lc-task-detail"><summary>查看学习目标与模型范围</summary><ol class="lc-task-sequence"><li><span>1</span><div><b>观察与判断</b><p>根据路网连通关系判断初始孤岛。</p></div></li><li><span>2</span><div><b>预测与行动</b><p>权衡预算、工期与可达人口，选择抢通顺序。</p></div></li><li><span>3</span><div><b>对照与解释</b><p>比较预测与实际，用过程证据解释决策。</p></div></li></ol><div class="lc-model-brief"><b>${esc(s.model.name)}</b><p>${esc(s.model.scope)}</p></div></details></section>`;
    const settings = `<section class="lc-card"><div class="lc-section-title"><div><h3>本轮条件设置</h3><p>${locked ? '由教学组织者设置，你可以查看。' : '设置预算与雨强；开始后锁定。'}</p></div></div><form id="learning-config"><fieldset ${locked ? 'disabled' : ''}><div class="form-grid"><label class="field lc-full-field">实验情景<select name="scenario">${catalog.scenarios.map(v => `<option value="${esc(v.id)}" ${v.id === config.scenario ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label><label class="field">预算 / 万元<input name="budget" type="number" min="20" max="200" value="${esc(config.budget)}" required></label><label class="field">降雨 / mm/h<input name="rain" type="number" min="0" max="150" value="${esc(config.rain)}" required></label></div><button type="submit" ${busy ? 'disabled' : ''}>保存本轮条件</button></fieldset></form><p class="hint">切换准备页签会保留输入；开始时保存当前有效条件。</p></section>`;
    const members = `<section class="lc-card lc-member-card"><div class="lc-section-title">${icon('users')}<div><h3>邀请与分工 · ${s.members.length} 人</h3><p>将实验码 <b>${esc(s.code)}</b> 分享给同伴，选择“加入课堂”。</p></div></div>${membersView(s.members)}<p class="hint">组织者负责设置、推进时间和评阅；学生负责判断与派遣；观察者只读查看。</p></section>`;
    return `<section class="lc-preparation"><nav class="lc-section-tabs" aria-label="实验准备"><button data-learning-preparation="task" class="${tab === 'task' ? 'is-active' : ''}" aria-pressed="${tab === 'task'}">任务说明</button><button data-learning-preparation="settings" class="${tab === 'settings' ? 'is-active' : ''}" aria-pressed="${tab === 'settings'}">条件设置</button><button data-learning-preparation="members" class="${tab === 'members' ? 'is-active' : ''}" aria-pressed="${tab === 'members'}">成员与分工 <small>${s.members.length}</small></button></nav><div id="lc-preparation-content" tabindex="-1">${tab === 'settings' ? settings : tab === 'members' ? members : task}</div><div class="lc-start"><div><b>${locked ? '等待组织者开始' : '准备好后，进入地图实验'}</b><p>已保存：${esc(scenario?.name || s.config.scenario)} · 预算 ${s.config.budget} 万元 · 降雨 ${s.config.rain} mm/h</p></div><button class="primary" data-learning="start" ${locked || busy ? 'disabled' : ''}>开始实验 ${icon('arrow')}</button></div></section>`;
  }


  function roadPicker(s, selected) {
    return `<label class="field">定位作业任务<select id="learning-road"><option value="">选择任务编号</option>${s.roads.map(road => `<option value="${esc(road.id)}" ${road.id === selected ? 'selected' : ''}>${esc(road.id)} · ${esc(roadStates[road.status] || road.status)}</option>`).join('')}</select></label>`;
  }

  function toolHeading(eyebrow, title, text) {
    return `<div class="lc-tool-heading"><span class="lc-kicker">${eyebrow}</span><h3>${title}</h3><p>${text}</p></div>`;
  }

  function nextTask(s) {
    if (s.role === 'observer') return ['events', '跟随小组观察操作与结果', '查看过程记录'];
    if (!s.state.identification && s.state.time === 0 && s.state.spent === 0) return ['identify', '派遣前，先提交最初的孤岛判断', '进入孤岛识别'];
    if (!(s.predictions || []).length && s.state.time < 180) return ['predict', '写下未来时刻的可达人口与投入', '记录一次预测'];
    if (s.nextCompletionAt != null) return ['events', s.role === 'teacher' ? '可用下方快进，观察作业完成后的变化' : '等待组织者推进，观察地图与预测对照', '查看本组操作'];
    return ['dispatch', '比较受阻通道，安排下一次抢通', '选择道路与队伍'];
  }

  function observePanel(model) {
    const { snapshot: s, selected } = model;
    const node = s.nodes.find(n => n.id === selected);
    const activeCrews = s.crews.filter(crew => crew.job);
    const [nextTool, nextText, nextLabel] = nextTask(s);
    return `${toolHeading('观察 / 建立整体判断', '先读懂这张地图', '绿色表示基地可达，红色表示断连。点选道路后查看抢通条件。')}
      <div class="lc-observe-metrics"><div><small>基地可达</small><b>${s.stats.available}<em>人</em></b></div><div><small>仍然断连</small><b>${s.stats.isolated}<em>人</em></b></div></div>
      ${node ? `<div class="lc-selected-node"><span class="lc-status-dot ${node.reachable ? 'is-good' : 'is-danger'}"></span><div><b>${esc(node.name)}</b><p>${node.pop}名教学人口 · ${node.reachable ? '基地可达' : '与基地断连'}</p></div></div>` : ''}
      ${roadPicker(s, selected)}<div class="lc-next-task"><span>建议下一步</span><b>${nextText}</b><button data-learning-tool="${nextTool}">${nextLabel} ${icon('arrow')}</button></div>
      <div class="lc-panel-section"><h4>队伍状态 <span>${activeCrews.length} / ${s.crews.length} 作业中</span></h4><ul class="lc-crew-list">${s.crews.map(crew => `<li><span>${esc(crew.name)}</span><b class="${crew.job ? 'is-working' : ''}">${crew.job ? '正在作业' : '待命'}</b></li>`).join('')}</ul></div><p class="hint">人口圈表示教学点位人口；徐州地理为背景，彩色路段为局部教学灾情，蓝色线为已确认的实际进场路径。</p>`;
  }

  function routePanel(model){
    const {snapshot:s,routeDraft={from:'S',to:'C'},routeResult,busy}=model;
    const options=selected=>s.nodes.map(node=>`<option value="${esc(node.id)}" ${node.id===selected?'selected':''}>${esc(node.name)}</option>`).join('');
    const route=routeResult?.route;
    return `${toolHeading('真实道路 / 两点查询','从哪里出发，到哪里去？','选择两个地点，按当前封路与限行状态计算道路路径。也可点击地图地点设置终点。')}<form id="learning-route-query"><label class="field">起点<select name="from">${options(routeDraft.from)}</select></label><label class="field">终点<select name="to">${options(routeDraft.to)}</select></label><button class="primary lc-wide" type="submit" ${busy?'disabled':''}>沿真实道路寻路</button></form>${routeResult?route?`<div class="lc-road-preview"><span>服务器确认的可通行路线</span><strong>${route.distanceKm}<small> 公里</small></strong><p>进场教学估计 ${route.minutes} 分钟；地图蓝线沿已收录道路行驶。</p><p>场地至道路接入口：起点 ${route.accessMeters.from} 米、终点 ${route.accessMeters.to} 米，以棕色虚线单独显示。</p><button data-learning="clear-route">清除查询路线</button></div>`:'<div class="lc-inline-notice">当前路况下没有可通行道路路径。请先处理阻断或选择其他地点。</div>':'<p class="hint">道路25km/h、限行减半、场地接入5km/h为教学规则；路况变化后需重新规划。无路时不绘制直线代替。</p>'}`;
  }

  function nodeNames(s, ids) {
    return (ids || []).map(id => s.nodes.find(n => n.id === id)?.name || id).join('、') || '无';
  }

  function identificationFeedback(s, identification, compact = false) {
    if (identification === undefined) return `<div class="lc-empty-inline"><b>本轮未记录识别反馈</b><p>这份历史报告未保存该项数据。</p></div>`;
    if (!identification) return `<div class="lc-empty-inline"><b>本轮未提交识别判断</b><p>在派遣和推进前，可先判断初始孤岛。</p></div>`;
    return `<div class="lc-identify-feedback ${compact ? 'is-compact' : ''}"><div><span>初始孤岛识别反馈</span><strong>${identification.score}<small> / 25</small></strong></div><dl><dt>你的判断</dt><dd>${esc(nodeNames(s, identification.answer))}</dd><dt>模型判定</dt><dd>${esc(nodeNames(s, identification.truth))}</dd></dl><p class="hint">练习反馈单独展示，不计入自动评价85分。</p></div>`;
  }

  function identifyPanel(model) {
    const { snapshot: s, busy, identifySelection = [] } = model;
    const allowed = s.phase === 'running' && s.role !== 'observer' && s.state.time === 0 && s.state.spent === 0;
    const populations = s.nodes.filter(node => node.pop > 0);
    return `${toolHeading('判断 / 初始孤岛', '哪些聚落已经断连？', '点选地图中的人口节点，或勾选下方聚落。判断它们是否仍能从基地到达。')}
      <form id="learning-identify"><fieldset ${!allowed || busy ? 'disabled' : ''}><div class="lc-selection-label"><b>选择与基地断连的聚落</b><span>已选 ${identifySelection.length}</span></div><div class="lc-node-options">${populations.map(node => `<label class="lc-node-option ${identifySelection.includes(node.id) ? 'is-selected' : ''}"><input type="checkbox" name="node" value="${esc(node.id)}" data-learning-identify-node="${esc(node.id)}" ${identifySelection.includes(node.id) ? 'checked' : ''}><span><b>${esc(node.name)}</b><small>${node.pop} 人</small></span></label>`).join('')}</div><button type="submit" class="primary lc-wide" ${!allowed || busy ? 'disabled' : ''}>提交识别判断</button></fieldset></form>
      ${!allowed ? `<p class="lc-inline-notice">${s.role === 'observer' ? '观察者只读查看小组的识别结果。' : '识别需在派遣和推进前提交，本轮初始判断已锁定。'}</p>` : '<p class="hint">可不选任何聚落；提交后显示与模型判定的对照。</p>'}
      ${s.state.identification ? identificationFeedback(s, s.state.identification) : '<div class="lc-scoring-note">这是一项25分识别练习反馈，不计入本轮自动85分。</div>'}`;
  }

  function predictionStatus(prediction) {
    return ({ verified: '已对照', pending: '等待推演', unfinished: '未到达目标时刻' })[prediction.status] || '等待推演';
  }

  function predictionCards(predictions) {
    if (!predictions?.length) return '<div class="lc-empty-inline"><b>本组还没有预测记录</b><p>先写下判断，后续推进到目标时刻即可查看实际结果。</p></div>';
    return `<ol class="lc-prediction-list">${predictions.slice().reverse().map(p => `<li><div class="lc-prediction-title"><b>T+${p.target} 分钟</b><span class="lc-status-tag ${p.status === 'verified' ? 'is-good' : ''}">${predictionStatus(p)}</span></div><dl><dt>预测</dt><dd>可达 ${p.population} 人 · 投入 ${p.spent} 万元</dd><dt>实际</dt><dd>${p.actual ? `可达 ${p.actual.available} 人 · 投入 ${p.actual.spent} 万元` : p.status === 'unfinished' ? '实验已结束，未到达该时刻。' : '到达目标时刻后显示。'}</dd></dl><p class="lc-reason">${esc(p.reason)}</p></li>`).join('')}</ol>`;
  }

  function predictPanel(model) {
    const { snapshot: s, busy, predictionDraft = {} } = model;
    const allowed = s.role !== 'observer' && s.state.time < 180;
    const targetInvalid = Number(predictionDraft.target) <= s.state.time || (s.predictions || []).some(p => p.target === Number(predictionDraft.target));
    return `${toolHeading('预测 / 决策依据', '先写判断，再看结果', '选择一个未来时刻，预测届时的可达人口与累计投入，并说明依据。')}
      <form id="learning-predict"><fieldset ${!allowed || busy ? 'disabled' : ''}><div class="form-grid"><label class="field">目标时刻 / T+分钟<input name="target" type="number" min="${s.state.time + 1}" max="180" step="1" value="${esc(predictionDraft.target ?? '35')}" required></label><label class="field">预计可达人口 / 人<input name="population" type="number" min="0" max="1520" step="1" value="${esc(predictionDraft.population ?? '')}" placeholder="0–1520" required></label><label class="field lc-full-field">预计累计投入 / 万元<input name="spent" type="number" min="${s.state.spent}" max="${s.config.budget}" step="0.01" value="${esc(predictionDraft.spent ?? '')}" placeholder="${s.state.spent}–${s.config.budget}" required></label><label class="field lc-full-field">判断依据<textarea name="reason" minlength="10" maxlength="1000" rows="3" placeholder="例如：先恢复哪条通道，会连接哪些聚落？" required>${esc(predictionDraft.reason ?? '')}</textarea></label></div><button type="submit" class="primary lc-wide" ${!allowed || busy ? 'disabled' : ''}>保存本次预测</button></fieldset></form>
      ${allowed && targetInvalid ? '<div class="lc-inline-notice">这个时刻已经过去或已提交预测。<button class="lc-text-button" data-learning="fresh-prediction">准备下一次预测 →</button></div>' : ''}<p class="hint">${s.role === 'observer' ? '观察者可查看小组预测，不可提交。' : `当前T+${s.state.time}分钟，目标时刻须晚于现在。预测用于学习对照，不直接计分。`}</p><div class="lc-panel-section"><h4>本组预测 <span>${s.predictions?.length || 0} 条</span></h4>${predictionCards(s.predictions)}</div>`;
  }

  function dispatchPanel(model) {
    const { snapshot: s, selected, busy } = model;
    const road = s.roads.find(item => item.id === selected);
    if (!road) return `${toolHeading('行动 / 通道抢通', '选择需要恢复的道路', '点击地图中的道路编号，查看工种、费用、工期与进场条件。')}${roadPicker(s, selected)}<div class="lc-empty-tool">${icon('route')}<b>先选道路，再派遣队伍</b><p>优先考虑能连接更多聚落、且队伍能够到达的通道。</p></div><p class="hint">派遣后产生投入；组织者推进时间，作业完成后再查看连通变化。</p>`;
    const options = road.dispatchOptions || [];
    const activeCrew = s.crews.find(crew => crew.job?.edge === road.id);
    const working = Boolean(activeCrew) || road.status === 'repair';
    const passable = road.status === 'open' || road.status === 'limited';
    const hasOptions = options.some(option => option.allowed);
    const allowed = s.role !== 'observer' && hasOptions;
    const chosen = options.find(option => option.allowed && option.crewId === model.crewSelection?.[road.id]) || options.find(option => option.allowed);
    let action;
    if (working) {
      action = `<section class="lc-job-progress"><span class="lc-status-tag is-good">已派遣 · 正在作业</span><h4>${activeCrew ? esc(activeCrew.name) + ' / ' + esc(activeCrew.id) : '队伍已在本通道执行作业'}</h4>${activeCrew ? `<p>预计 T+<b>${activeCrew.job.end}</b> 分钟完成${activeCrew.job.end > 180 ? '（本轮推演截止T+180）' : ''}。</p>` : ''}<p>无需重复派遣。${s.role === 'teacher' ? '可使用下方快进查看作业结果。' : '由教学组织者推进时间。'}</p></section>`;
    } else if (passable) {
      action = `<section class="lc-job-progress"><span class="lc-status-tag is-good">${road.status === 'limited' ? '限行，仍可通行' : '道路已通行'}</span><h4>无需再次派遣队伍</h4><p>可以选择下一条受阻道路，继续比较抢通优先级。</p></section>`;
    } else {
      action = `<form id="learning-dispatch"><label class="field">派出哪支队伍？<select name="crewId" ${s.role === 'observer' || busy ? 'disabled' : ''}>${!hasOptions ? '<option value="" selected disabled>暂无可派遣队伍</option>' : ''}${options.map(option => `<option value="${esc(option.crewId)}" ${chosen?.crewId === option.crewId ? 'selected' : ''} ${option.allowed ? '' : 'disabled'}>${esc(s.crews.find(crew => crew.id === option.crewId)?.name || option.crewId)}${option.allowed ? '' : ' · ' + esc(option.reason)}</option>`).join('')}</select></label>${chosen?.completionAt != null ? `<div class="lc-road-preview"><span>当前路况下的作业估计</span>${chosen.travelDistanceKm!=null?`<p>沿真实道路进场 ${chosen.travelDistanceKm} 公里；终点位于作业区外围。</p>`:""}<strong>T+${chosen.completionAt}<small> 分钟完成</small></strong><p>进场 ${chosen.travelMinutes} 分钟 + 作业 ${Number(chosen.workMinutes).toFixed(1).replace(/\.0$/, '')} 分钟，总计约 ${chosen.duration} 分钟。</p><p>派遣后剩余预算 ${Number((s.config.budget - s.state.spent - road.cost).toFixed(2))} 万元${chosen.completionAt > 180 ? '；预计超出本轮180分钟时限' : ''}。</p></div>` : ''}<input type="hidden" name="edgeId" value="${esc(road.id)}"><button type="submit" class="primary lc-wide" ${busy || !allowed ? 'disabled' : ''}>确认派遣 · ${road.cost}万元</button></form>${s.role === 'observer' ? '<p class="lc-inline-notice">观察者只能查看，不能派遣。</p>' : !hasOptions ? '<p class="lc-inline-notice">当前没有可派遣队伍，请检查工种、进场道路与剩余预算。</p>' : '<p class="hint">实际派遣以最新路况、队伍与预算校验为准；由组织者推进仿真。</p>'}`;
    }
    return `${toolHeading('行动 / 通道抢通', `道路 ${esc(road.id)}`, `${esc(s.nodes.find(n => n.id === road.a)?.name)} → ${esc(s.nodes.find(n => n.id === road.b)?.name)}`)}${roadPicker(s, selected)}
      <div class="lc-road-status"><span class="lc-status-dot ${road.status === 'open' ? 'is-good' : road.status === 'repair' ? 'is-working' : 'is-danger'}"></span><b>${esc(roadStates[road.status] || road.status)}</b><small>当前路况</small></div><div class="lc-road-stats"><span>抢通费用<b>${road.cost}<em>万元</em></b></span><span>基准工作量<b>${road.work}<em>分钟</em></b></span><span>需要工种<b>${esc(types[road.requiredType] || road.requiredType)}</b></span><span>当前积水<b>${Number(road.depth).toFixed(2)}<em>米</em></b></span></div>
      ${action}<button class="lc-text-button" data-learning="unselect">关闭对象信息</button>`;
  }

  function eventsList(events) {
    if (!events?.length) return '<div class="lc-empty-inline"><b>等待第一条课堂操作</b><p>开始、识别、预测、派遣和推进都会留下记录。</p></div>';
    return `<ol class="lc-event-list">${events.slice().reverse().map(event => `<li><span class="lc-event-time">T+${event.time ?? event.at ?? 0}<small>分钟</small></span><div><b>${esc(event.actorName || '课堂系统')}</b><p>${esc(event.text || event.action || event.type || '操作已保存')}</p></div></li>`).join('')}</ol>`;
  }

  function eventsPanel(model) {
    return `${toolHeading('记录 / 小组过程', '回看每一步决策', '这里记录同一实验中各成员的操作，帮助你在复盘时解释顺序与取舍。')}${eventsList(model.snapshot.events)}`;
  }

  function topology(model) {
    const { snapshot: s, identifySelection = [], tool = 'observe' } = model;
    const masking = tool === 'identify' && !s.state.identification;
    const roads = s.roads.map(road => {
      const a = s.nodes.find(node => node.id === road.a), b = s.nodes.find(node => node.id === road.b);
      const color = ({ blocked: '#df7c83', repair: '#82afe6', limited: '#d1b074', open: '#70bca6' })[road.status];
      return `<g role="button" tabindex="0" data-learning-road="${esc(road.id)}" aria-label="选择道路${esc(road.id)}"><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="8"/><text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 8}">${esc(road.id)}</text></g>`;
    }).join('');
    const nodes = s.nodes.map(node => `<g class="${identifySelection.includes(node.id) ? 'lc-node-selected' : ''}" ${node.pop > 0 ? `role="button" tabindex="0" data-learning-node="${esc(node.id)}" aria-label="${tool === 'identify' ? '选择聚落' : '查看'}${esc(node.name)}"` : ''}><circle cx="${node.x}" cy="${node.y}" r="${node.pop > 0 ? 15 : 12}" fill="${masking ? '#8ba8bb' : node.reachable ? '#70bca6' : '#df7c83'}"/><text x="${node.x}" y="${node.y - 23}">${esc(node.name)}</text></g>`).join('');
    return `<details class="lc-topology"><summary>地图无法加载？查看可操作的教学拓扑</summary><svg viewBox="0 0 900 500" role="img" aria-label="本轮教学路网">${roads}${nodes}</svg></details>`;
  }

  function experiment(model) {
    const { snapshot: s, layers, busy, sceneHTML, tool = 'observe', panelOpen, layersOpen } = model;
    const toolPanels = { route: routePanel, observe: observePanel, identify: identifyPanel, predict: predictPanel, dispatch: dispatchPanel, events: eventsPanel };
    const renderTool = toolPanels[tool] || observePanel;
    const canControlTime = s.role === 'teacher' && !busy;
    const identifying = panelOpen && tool === 'identify' && !s.state.identification;
    return `<section class="lc-experiment"><div class="lc-running-head"><p><b>本轮任务</b> 先判断、再决策，用结果解释你的选择。</p><div class="lc-live-stats"><span>仿真 <b>T+${s.state.time}</b> 分钟</span><span>可达 <b>${s.stats.available}</b> 人</span><span>剩余 <b>${s.config.budget - s.state.spent}</b> 万元</span></div></div>
      <div class="lc-map-work ${panelOpen ? 'has-tool-panel' : 'is-map-only'} ${tool === 'predict' || tool === 'events' ? 'lc-panel-first-mobile' : ''}"><nav class="lc-tool-rail" aria-label="实验工具">${tools.map(([id, title, subtitle, symbol]) => `<button data-learning-tool="${id}" class="${panelOpen && tool === id ? 'is-active' : ''}" aria-pressed="${Boolean(panelOpen && tool === id)}" title="${subtitle}">${icon(symbol)}<span>${title}</span><small>${subtitle}</small></button>`).join('')}<div class="lc-rail-note">条件已锁定<br>围绕地图做决策</div></nav>
      <section class="lc-map-column" aria-label="课堂实验地图"><div class="lc-layer-bar"><button data-learning="layers" aria-expanded="${Boolean(layersOpen)}">${icon('map')} 图层</button><span class="lc-map-instruction">云龙湖及周边城区 · 虚线为教学任务范围</span>${identifying ? '<span class="lc-map-key is-neutral"><i></i>沿道路判断连通</span>' : '<span class="lc-map-key"><i></i>可达 <i></i>断连</span>'}${layersOpen ? `<div class="lc-layer-popover"><div><b>空间信息图层</b><button data-learning="layers" aria-label="关闭图层">×</button></div>${[['people', '人口'], ['roads', '教学道路'], ['floods', '教学积水'], ['buildings', '建筑']].map(([id, label]) => `<label><input type="checkbox" data-learning-layer="${id}" ${layers[id] ? 'checked' : ''}>${label}</label>`).join('')}<p>人口、积水与彩色通道为教学设定。</p></div>` : ''}</div>${sceneHTML}${topology(model)}</section>
      ${panelOpen ? `<aside class="lc-tool-panel" aria-label="${esc(tools.find(item => item[0] === tool)?.[1] || '观察地图')}" data-learning-current-tool="${esc(tool)}"><div class="lc-panel-toolbar"><span>当前操作</span><button data-learning="close-panel" aria-label="收起操作面板">收起 ×</button></div>${renderTool(model)}</aside>` : ''}</div>
      <div class="lc-time-controls"><div class="lc-time-summary"><span class="lc-clock-label">仿真时钟</span><b>T+${s.state.time}<small> / ${s.config.horizon || 180} 分钟</small></b><span>${s.nextCompletionAt != null ? `作业预计 T+${s.nextCompletionAt} 完成${s.nextCompletionAt > 180 ? '（本轮截止180）' : ''}` : '暂无正在执行的作业'}</span></div><div class="lc-time-actions"><button data-learning="advance" ${canControlTime ? '' : 'disabled'}>推进5分钟</button><button data-learning="advance-next" ${canControlTime && s.nextCompletionAt != null ? '' : 'disabled'}>快进到作业完成</button><button class="lc-finish-button" data-learning="finish" ${canControlTime ? '' : 'disabled'}>结束并生成报告</button></div></div>
      <p class="lc-model-note">${esc(s.model.name)} · 人口、灾情与作业参数为教学设定。${s.role !== 'teacher' ? '由教学组织者推进时间。' : ''}</p></section>`;
  }

  function predictionTable(predictions) {
    if (!predictions?.length) return '<div class="lc-empty-inline"><b>本轮没有提交预测</b><p>下一轮可在派遣前记录判断，再用仿真结果验证。</p></div>';
    return `<div class="lc-table-scroll"><table class="lc-prediction-table"><thead><tr><th>目标时刻</th><th>预测可达 / 实际</th><th>预测投入 / 实际</th><th>对照状态</th></tr></thead><tbody>${predictions.map(p => `<tr><td><b>T+${p.target}</b><details><summary>查看预测依据</summary><small>${esc(p.reason)}</small></details></td><td>${p.population} 人 <span>/ ${p.actual ? p.actual.available + ' 人' : '—'}</span></td><td>${p.spent} 万元 <span>/ ${p.actual ? p.actual.spent + ' 万元' : '—'}</span></td><td><span class="lc-status-tag ${p.status === 'verified' ? 'is-good' : ''}">${predictionStatus(p)}</span></td></tr>`).join('')}</tbody></table></div>`;
  }

  function recoveryChart(r) {
    const timeline = (r.timeline || []).filter(point => Number.isFinite(point.time) && Number.isFinite(point.available) && Number.isFinite(point.spent));
    if (!timeline.length) return '';
    const points = r.baseline ? [{ time: 0, ...r.baseline }, ...timeline] : timeline;
    if ((r.time ?? points.at(-1).time) === 0) return '<section class="lc-card lc-recovery"><h3>连通恢复过程</h3><p class="hint">本轮在T+0结束，尚无时间推进记录；不绘制恢复曲线。</p></section>';
    const xmax = Math.max(1, r.time ?? points.at(-1).time);
    const ymax = Math.max(1, r.stats.pop || 1520);
    const x = point => +(52 + point.time / xmax * 810).toFixed(2);
    const y = point => +(174 - point.available / ymax * 136).toFixed(2);
    const line = points.map((point, i) => i ? `H${x(point)}V${y(point)}` : `M${x(point)},${y(point)}`).join('');
    const changes = points.filter((point, i) => !i || point.available !== points[i - 1].available || point.spent !== points[i - 1].spent || i === points.length - 1);
    return `<section class="lc-card lc-recovery"><div class="lc-section-title">${icon('route')}<div><h3>连通恢复过程</h3><p>把每次行动放回时间线上，观察可达人口何时发生变化。</p></div><span class="lc-chart-legend"><i></i>实际可达人口</span></div><svg class="lc-recovery-chart" viewBox="0 0 900 216" role="img" aria-label="本轮实际可达人口随仿真时间变化，开始${points[0].available}人，结束${points.at(-1).available}人"><line x1="52" y1="38" x2="862" y2="38" class="lc-chart-grid"/><line x1="52" y1="106" x2="862" y2="106" class="lc-chart-grid"/><line x1="52" y1="174" x2="862" y2="174" class="lc-chart-grid"/><text x="42" y="42" text-anchor="end">${ymax}</text><text x="42" y="110" text-anchor="end">${Math.round(ymax / 2)}</text><text x="42" y="178" text-anchor="end">0</text><path d="${line}" fill="none" class="lc-chart-line"/><circle cx="${x(points.at(-1))}" cy="${y(points.at(-1))}" r="4" class="lc-chart-end"/><text x="52" y="202">T+0</text><text x="862" y="202" text-anchor="end">T+${xmax} 分钟</text></svg><details class="lc-change-details"><summary>查看关键时刻的人口与投入</summary><div class="lc-table-scroll"><table class="lc-prediction-table"><thead><tr><th>仿真时刻</th><th>实际可达人口</th><th>累计投入</th></tr></thead><tbody>${changes.map(point => `<tr><td>T+${point.time} 分钟</td><td>${point.available} 人</td><td>${point.spent} 万元</td></tr>`).join('')}</tbody></table></div></details><p class="hint">曲线来自已保存的逐分钟实验记录；虚拟人口连通变化不等同于实际人员救援数量。</p></section>`;
  }

  function reviewView(model) {
    const { report: r, snapshot: s, busy, reviewDraft = {}, exporting } = model;
    if (r.score.scoringVersion !== 2 || !Number.isFinite(r.score.autoScore)) return '<section class="lc-card lc-teacher-review"><h3>历史评阅记录</h3><p class="hint">本轮采用旧评分格式，保留原成绩，不追加新版15分评阅。</p></section>';
    const review = r.review;
    const completed = r.score.manualPending === false && r.score.manualScore != null;
    const rubric = [['evidence', '数据依据', '结合路况、人口与预测解释判断。'], ['analysis', '权衡分析', '说明预算、工期与抢通顺序的取舍。'], ['improvement', '反思改进', '根据结果提出具体的改进方案。']];
    return `<section class="lc-card lc-teacher-review"><div class="lc-section-title">${icon('users')}<div><h3>决策解释与教师评阅</h3><p>自动指标评价决策成效，教师结合本组解释与过程进行点评。</p></div></div><div class="lc-report-total"><div><b>${completed ? '本轮总评已完成' : '等待教学组织者评阅'}</b><p>自动评价 ${Number(r.score.autoScore ?? 0).toFixed(1)} / 85 · 人工评阅 ${completed ? Number(r.score.manualScore).toFixed(1) : '待评'} / 15</p></div><strong>${completed ? Number(r.score.total).toFixed(1) + '<small> / 100</small>' : '<small>人工部分待评</small>'}</strong></div>${review ? `<div class="lc-review-state"><b>${esc(review.reviewer)} 的评语</b><p>${esc(review.comment)}</p><small>${rubric.map(([key, label]) => `${label} ${review.ratings[key]} / 5`).join(' · ')} · 第${review.revision}次评阅</small></div>` : `<p class="hint">${completed ? '这份历史记录未保存评语详情。' : '尚未提交人工评分；当前自动85分单独呈现。'}</p>`}${s.role === 'teacher' && !exporting ? `<form id="learning-review" class="lc-review-form"><h4>${review ? '修订本轮评阅' : '为本组提交评阅'}</h4><p>每项0–5分，合计15分；评语说明判断依据与改进建议。</p><div class="lc-review-rubric">${rubric.map(([key, label, description]) => `<label class="field"><span>${label}<small>${description}</small></span><select name="${key}" required ${busy ? 'disabled' : ''}><option value="">选择分数</option>${[0, 1, 2, 3, 4, 5].map(value => `<option value="${value}" ${String(reviewDraft[key]) === String(value) ? 'selected' : ''}>${value} / 5</option>`).join('')}</select></label>`).join('')}</div><label class="field">评语与改进建议<textarea name="comment" minlength="10" maxlength="2000" rows="3" placeholder="请结合预测、派遣顺序和实际结果，给出具体反馈。" required ${busy ? 'disabled' : ''}>${esc(reviewDraft.comment || '')}</textarea></label><div class="lc-form-footer"><span class="hint">保存后组内成员会看到最新评阅；不会重算已保存的自动成绩。</span><button type="submit" class="primary" ${busy ? 'disabled' : ''}>${review ? '保存修订' : '提交教师评阅'}</button></div></form>` : ''}</section>`;
  }

  function reportView(model) {
    const { report: r, snapshot: s, exporting } = model;
    if (!r) return `<section class="lc-empty"><h2>本轮实验已结束</h2><p>正在读取已保存的本轮报告。</p><button data-learning="report">读取报告</button></section>`;
    const rows = (r.score.rows || []).filter(row => (row.key || row.id) !== 'reasoning');
    const tab = model.reportTab || 'summary';
    const show = id => exporting || tab === id;
    const tabs = [['summary', '结果总览'], ['comparison', '判断对照'], ['process', '过程记录'], ['review', s.role === 'teacher' ? '教师评阅' : '评阅反馈']];
    return `<section class="lc-report"><div class="lc-report-title"><div><span class="lc-kicker">本轮结果 / ${esc(s.code)}</span><h2>实验报告</h2><p>${esc(s.title)} · 仿真至T+${s.state.time}分钟</p></div><button class="primary" data-learning="export">导出完整报告</button></div>
      ${!exporting ? `<nav class="lc-section-tabs" aria-label="报告内容">${tabs.map(([id, label]) => `<button data-learning-report-tab="${id}" class="${tab === id ? 'is-active' : ''}" aria-pressed="${tab === id}">${label}${id === 'review' && r.score.manualPending !== false ? '<small>待评</small>' : ''}</button>`).join('')}</nav>` : ''}<div id="lc-report-content" tabindex="-1">
      ${show('summary') ? `<div class="lc-report-metrics"><div><small>最终可达人口</small><strong>${r.stats.available}<em>人</em></strong>${r.baseline ? `<span>初始 ${r.baseline.available} 人</span>` : '<span>初始数据：本轮未记录</span>'}</div><div><small>仍然断连</small><strong>${r.stats.isolated}<em>人</em></strong>${r.baseline ? `<span>初始 ${r.baseline.isolated} 人</span>` : '<span>初始数据：本轮未记录</span>'}</div><div><small>实际投入</small><strong>${r.spent ?? s.state.spent}<em>万元</em></strong><span>预算 ${s.config.budget} 万元</span></div><div><small>${Number.isFinite(r.score.autoScore) ? '自动评价' : '历史记录成绩'}</small><strong>${Number.isFinite(r.score.autoScore) ? Number(r.score.autoScore).toFixed(1) + '<em> / 85</em>' : esc(r.score.total ?? '未记录')}</strong><span>${!Number.isFinite(r.score.autoScore) ? '旧格式保留' : r.score.manualPending === false ? '人工评阅已完成，可查看评阅反馈' : '人工评阅15分，尚未提交'}</span></div></div>${recoveryChart(r)}<section class="lc-card"><div class="lc-section-title"><div><h3>自动评价依据</h3><p>评价来自本轮保存的状态与过程。</p></div></div>${rows.map(row => `<div class="lc-score-row"><b>${esc(row.name || row.label || row.title || '评价分项')}</b><span>${row.score == null ? '待点评' : row.score} / ${row.max ?? row.full ?? '—'}</span><details><summary>查看评价依据</summary><p>${esc(row.reason || '本项暂无说明。')}</p></details></div>`).join('')}<p class="hint">自动部分满分85分；识别练习反馈单独展示。</p></section>` : ''}
      ${show('comparison') ? `<section class="lc-card lc-learning-review"><div class="lc-section-title">${icon('chart')}<div><h3>学习判断对照</h3><p>识别反馈和预测对照独立展示，帮助解释决策，不重复计入自动评分。</p></div></div><div class="lc-learning-comparison"><section><h4>最初，你如何判断孤岛？</h4>${identificationFeedback(s, r.identification, true)}</section><section><h4>推演前的预测，与实际一致吗？</h4>${predictionTable(r.predictions)}</section></div></section>` : ''}
      ${show('process') ? `<section class="lc-card"><div class="lc-section-title">${icon('list')}<div><h3>本轮过程记录</h3><p>查看成员分工、操作顺序与结果变化。</p></div></div>${eventsList(r.events)}<p class="hint">提前结束会保留未完成作业，不因快速结束获得完成奖励。</p></section>` : ''}
      ${show('review') ? reviewView(model) : ''}</div><div class="lc-report-footer"><span>报告与实验操作分开；导出始终包含所有报告内容。</span><button data-learning="disconnect">返回课堂入口 ${icon('arrow')}</button></div></section>`;
  }


  function explanation(model) {
    const role = model.snapshot?.role;
    const guidance = role === 'observer' ? '你是观察者，可以查看地图、过程与报告；实验操作由小组其他成员完成。' : role === 'student' ? '你是学生，可以识别、预测和派遣；由教学组织者推进时间与结束实验。' : '教学组织者负责设置条件、邀请成员、推进时间与结束后的人工评阅；也可以独立完成一轮练习。';
    const layers = [
      ['前端界面', 'controller管理状态和按钮；views只按状态显示；api只发送请求。', 'frontend/classroom/controller.js · views.js · api.js'],
      ['通信接口', '识别教学会话、接收操作，并转交业务层。', 'backend/http/learning-routes.cjs'],
      ['业务处理', '检查权限、预算与进场，调用共享教学规则。', 'backend/application/learning-service.cjs + shared/engine.js'],
      ['数据保存', '写入成功才返回最新状态，报告读取这份记录。', 'backend/persistence/learning-store.cjs']
    ];
    return `<section class="lc-explain lc-card"><div class="lc-section-title"><div><h3>一轮实验，怎样完成？</h3><p>${guidance}</p></div><button data-learning="explain">收起指南</button></div><div class="lc-guide-card"><b>观察地图 → 提交判断 → 行动验证 → 对照复盘</b><p>左侧选择工具或直接点选地图对象，按需打开操作面板；收起后继续观察地图。点击道路编号可查看费用与作业条件；滚轮拉近、右键拖动可观察建筑。</p><p>“两点寻路”先选起点与终点，蓝线为当前可行道路，棕色虚线是场地接入。初始孤岛判断须在派遣和推进前提交。预测须选未来时刻；作业完成后可用实际结果检验。返回入口仍会保留本浏览器中的恢复身份。</p></div><ol class="lc-task-sequence"><li><span>1</span><div><b>设置：先明确本轮条件</b><p>创建实验，设置预算与雨强；同伴输入六位实验码加入，组织者开始实验。</p></div></li><li><span>2</span><div><b>实验：用地图完成判断与行动</b><p>提交孤岛识别，写下预测；点选受阻道路，比较工种、费用与预计完成时刻，再派遣队伍。组织者推进或快进仿真。</p></div></li><li><span>3</span><div><b>报告：把判断和结果放在一起</b><p>结束后查看人口变化、预测对照和自动85分；组织者结合决策解释进行15分人工评阅，组内同步查看并可导出报告。</p></div></li></ol><details class="lc-architecture-details"><summary>想了解实现原理？跟着一次派遣看懂分层架构</summary><div class="lc-flow">${layers.map(([title, text, file], index) => `<div><span>0${index + 1}</span><b>${title}</b><p>${text}</p><code>${file}</code></div>`).join('')}</div>
      <p>后端由 <code>backend/server.cjs</code> 组装接口、业务与存储。前端把明确的页面模型传给views，把令牌传给api；业务层不依赖网页。各层可在一个Node.js进程中运行。</p><h4>自己验证一次</h4><p>开始实验 → 提交初始孤岛判断 → 选择未来时刻并预测 → R3 / P1派遣 → 按后端估计快进至作业完成 → 查看原预测与实际对照 → 结束查看报告。</p><p class="hint">本工作区已接入真实道路两点查询、设置、识别、预测、派遣、推进和报告；独立实景实验等旧模块仍保留。实名账号、正式数据库和远程托管尚未建设。</p><details><summary>查看最近请求（不显示会话令牌）</summary><ol class="lc-traces">${(model.traces || []).map(trace => `<li><b>${esc(trace.method)}</b> <code>${esc(trace.path)}</code> · ${esc(trace.status)} · ${trace.ms}ms${trace.version !== undefined ? ' · 版本' + trace.version : ''}<small>提交字段：${esc(trace.fields.join('、') || '无')}；状态：${esc(trace.phase || '—')}</small></li>`).join('')}</ol></details></details></section>`;
  }

  function view(model) {
    const { catalog, online, snapshot, busy, error, notice, explain } = model;
    let content;
    if (!catalog) content = online === false ? offlineView() : loadingView();
    else if (!snapshot) content = introduction(model);
    else if (snapshot.phase === 'draft') content = preparation(model);
    else if (snapshot.phase === 'running') content = experiment(model);
    else content = reportView(model);
    return `<div class="learning-shell ${snapshot?.phase === 'running' ? 'is-experiment' : ''} ${model.panelOpen && model.tool === 'identify' && !snapshot?.state?.identification ? 'lc-identifying' : ''}" data-version="${snapshot?.version || 0}" aria-busy="${Boolean(busy)}">${header(model)}${snapshot?.phase==="running"&&!snapshot.state.routingModel?`<div class="lc-legacy-model"><span>本轮为旧拓扑教学模型，保留原进度与成绩。新建课堂可使用真实道路计算。</span><button data-learning="new-road-classroom">新建真实道路课堂</button></div>`:""}${error ? `<div class="lc-error" role="alert">${esc(error)}</div>` : ''}${notice ? `<div class="lc-notice" role="status">${icon('check')}${esc(notice)}</div>` : ''}${explain ? explanation(model) : ''}${content}</div>`;
  }

  return Object.freeze({ view, renderReport: reportView });
})();

;
/* Source: frontend/classroom/controller.js */
/*
 * 课堂前端 / 交互控制层
 * 这里是课堂页面状态的唯一拥有者：响应按钮 → 调用 API → 接收后端快照 → 刷新显示。
 * API 负责通信，views 负责 HTML；规则和成绩由后端确定。
 */
window.FloodLearningUI = (() => {
  'use strict';

  const storageKey = 'flood-classroom-session-v1';
  const historyKey = 'flood-classroom-history-v1';
  const api = window.FloodClassroomAPI.createClient();
  const views = window.FloodClassroomViews;
  const model = {
    snapshot: null,
    catalog: null,
    report: null,
    online: null,
    busy: false,
    error: '',
    notice: '',
    selected: null,
    tool: 'observe',
    panelOpen: false,
    layersOpen: false,
    mapScope: 'region',
    routeDraft: {from:'S',to:'C'},
    routeResult: null,
    entry: '',
    preparation: 'task',
    reportTab: 'summary',
    createDraft: { name: '课堂演示', title: '通道恢复基础实验', scenario: 'basic', budget: '80', rain: '45' },
    joinDraft: { code: '', name: '', role: 'student' },
    configDraft: {},
    identifySelection: [],
    predictionDraft: { target: '35', population: '', spent: '', reason: '' },
    reviewDraft: { evidence: '', analysis: '', improvement: '', comment: '' },
    crewSelection: {},
    recentSessions: [],
    explain: false,
    traces: [],
    layers: { people: true, roads: true, floods: true, buildings: true }
  };
  let credential = null;
  let loading = false;
  let poll = null;
  let mapTimer = null;
  let selectionMap = null;
  let waitingMap = null;
  let mapFrame = '';
  let resizeTimer = null;
  let identifyDirty = false;
  let disconnected = false;
  let reportFailure = false;
  let reviewDirty = false;
  let savedSessions = [];
  let configDirty = false;
  let noticeTimer = null;
  let lastNotice = '';

  // 凭据只保存在本机，不传给显示层，也不写入请求记录。
  try {
    credential = JSON.parse(localStorage.getItem(storageKey) || 'null');
  } catch {
    credential = null;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(historyKey) || '[]');
    savedSessions = Array.isArray(saved) ? saved.filter(item => /^\d{6}$/.test(item?.code) && /^[A-Za-z0-9_-]{43}$/.test(item?.token)).slice(0, 8) : [];
  } catch { savedSessions = []; }
  updateRecentSessions();

  // 视图只接收名称、阶段和实验码；恢复凭据仍留在控制层。
  function updateRecentSessions() {
    model.recentSessions = savedSessions.map(({ code, title, role, phase }) => ({ code, title, role, phase }));
  }

  function retainSession(snapshot) {
    if (!credential || credential.code !== snapshot?.code) return;
    const item = { ...credential, title: snapshot.title, role: snapshot.role, phase: snapshot.phase };
    savedSessions = [item, ...savedSessions.filter(previous => previous.code !== item.code)].slice(0, 8);
    updateRecentSessions();
    try { localStorage.setItem(historyKey, JSON.stringify(savedSessions)); } catch {
      model.error = '浏览器无法保存恢复入口；请暂时保留当前页面。';
    }
  }

  function active() {
    return document.body.dataset.page === 'classroom';
  }

  function redraw() {
    if (active()) window.render();
    if (model.notice !== lastNotice) {
      clearTimeout(noticeTimer);
      lastNotice = model.notice;
      if (lastNotice) noticeTimer = setTimeout(() => {
        model.notice = '';
        lastNotice = '';
        // 移除短提示即可，不重绘地图和正在输入的表单。
        document.querySelector('.learning-shell>.lc-notice')?.remove();
      }, 5000);
    }
  }

  function rememberCredential() {
    try {
      if (credential) localStorage.setItem(storageKey, JSON.stringify(credential));
      else localStorage.removeItem(storageKey);
    } catch {
      model.error = '浏览器无法保存连接信息，请记下实验码。';
    }
  }

  function recordTrace(trace) {
    model.traces.unshift(trace);
    model.traces.length = Math.min(model.traces.length, 6);
  }

  // controller 显式传令牌给 API，只把服务结果放入页面模型。
  async function request(path, method = 'GET', body, quiet = false) {
    try {
      const result = await api.request({ path, method, body, token: credential?.token });
      model.online = true;
      if (!quiet) recordTrace(result.trace);
      return result.data;
    } catch (error) {
      if (error.serviceUnavailable) model.online = false;
      if (!quiet && error.trace) recordTrace(error.trace);
      throw error;
    }
  }

  // 多人同步中可能较晚收到旧响应，不能用它覆盖更新的版本。
  function adopt(snapshot) {
    const current = model.snapshot;
    if (current && snapshot.code === current.code && snapshot.version < current.version) return;
    // 创建 / 加入响应包含 token，页面模型只接收去掉 token 的实验投影。
    const { token, ...projection } = snapshot;
    if(current&&current.version!==projection.version)model.routeResult=null;
    model.snapshot = projection;
    if (!current || current.code !== projection.code) {
      resetWorkspace(projection);
    } else if (!identifyDirty && projection.state.identification) {
      model.identifySelection = [...projection.state.identification.answer];
    }
    if (projection.phase === 'draft' && !configDirty) model.configDraft = { ...projection.config };
    if (current && current.phase !== projection.phase) {
      model.panelOpen = false;
      model.layersOpen = false;
      model.reportTab = 'summary';
    }
    if (projection.phase === 'finished' && projection.report) {
      // 报告随会话版本同步，避免同学一直看到老师评阅前的缓存。
      model.report = projection.report;
      if (!reviewDirty) {
        const review = projection.review || projection.report.review;
        model.reviewDraft = { evidence: review?.ratings.evidence ?? '', analysis: review?.ratings.analysis ?? '', improvement: review?.ratings.improvement ?? '', comment: review?.comment || '' };
      }
    }
    if (!current || current.version !== projection.version || current.code !== projection.code) retainSession(projection);
  }

  // 这些是页面草稿，不会直接修改后端实验或参与评分。
  function resetWorkspace(snapshot) {
    model.tool = 'observe';
    model.panelOpen = false;
    model.layersOpen = false;
    model.mapScope = 'region';
    model.routeDraft = {from:'S',to:'C'};
    model.routeResult = null;
    model.entry = '';
    model.preparation = 'task';
    model.reportTab = 'summary';
    configDirty = false;
    model.configDraft = { ...(snapshot?.config || {}) };
    model.notice = '';
    identifyDirty = false;
    disconnected = false;
    reportFailure = false;
    reviewDirty = false;
    model.crewSelection = {};
    model.identifySelection = [...(snapshot?.state.identification?.answer || [])];
    model.predictionDraft = {
      target: String(Math.min(180, (snapshot?.state.time || 0) + 35)),
      population: '', spent: String(snapshot?.state.spent || 0), reason: ''
    };
    model.reviewDraft = { evidence: '', analysis: '', improvement: '', comment: '' };
  }

  function freshPrediction() {
    const snapshot = model.snapshot;
    const used = new Set((snapshot.predictions || []).map(value => value.target));
    let target = Math.min(snapshot.config.horizon || 180, snapshot.state.time + 35);
    while (used.has(target) && target < 180) target++;
    if (used.has(target)) target = Array.from({ length: Math.max(0, 180 - snapshot.state.time) }, (_, i) => snapshot.state.time + i + 1).find(at => !used.has(at)) ?? '';
    model.predictionDraft = { target: String(target), population: '', spent: String(snapshot.state.spent), reason: '' };
  }

  async function resumeSession(code) {
    const saved = savedSessions.find(item => item.code === code);
    if (!saved || model.busy) return;
    credential = { code: saved.code, token: saved.token };
    model.busy = true;
    model.error = '';
    redraw();
    try {
      const snapshot = await request('/sessions/' + saved.code);
      model.report = null;
      adopt(snapshot);
      rememberCredential();
      model.notice = '已恢复原课堂身份，可以继续实验或查看报告。';
    } catch (error) {
      credential = null;
      rememberCredential();
      model.error = error.message;
      if (['unauthorized', 'not_found'].includes(error.code)) {
        savedSessions = savedSessions.filter(item => item.code !== code);
        updateRecentSessions();
        try { localStorage.setItem(historyKey, JSON.stringify(savedSessions)); } catch {}
      }
    } finally { model.busy = false; redraw(); }
  }

  function canIdentify() {
    const snapshot = model.snapshot;
    return snapshot?.phase === 'running' && snapshot.role !== 'observer' &&
      snapshot.state.time === 0 && snapshot.state.spent === 0 && !model.busy;
  }

  function chooseNode(id) {
    const node = model.snapshot?.nodes.find(node => node.id === id);
    if (!node) return;
    model.selected = id;
    if (!model.panelOpen) model.tool = 'observe';
    model.panelOpen = true;
    if(model.tool==='route'){model.routeDraft.to=id;model.routeResult=null;}
    else if (model.tool !== 'identify') model.tool = 'observe';
    if (model.tool === 'identify' && node.pop > 0 && canIdentify()) {
      const selected = new Set(model.identifySelection);
      selected.has(id) ? selected.delete(id) : selected.add(id);
      model.identifySelection = [...selected];
      identifyDirty = true;
    }
    redraw();
  }

  function chooseRoad(id) {
    model.selected = id;
    model.tool = 'dispatch';
    model.panelOpen = true;
    redraw();
  }

  async function refresh(silent = false) {
    if (!credential) return;
    const previousOnline = model.online;
    try {
      const snapshot = await request('/sessions/' + credential.code, 'GET', undefined, silent);
      const changed = !model.snapshot || snapshot.version !== model.snapshot.version;
      adopt(snapshot);
      if (disconnected) {
        model.error = '';
        model.notice = '课堂连接已恢复，数据已重新同步。';
        disconnected = false;
      }
      if (changed || previousOnline !== model.online || !silent) redraw();
    } catch (error) {
      if (!silent || previousOnline !== model.online) {
        model.error = error.message;
        if (error.serviceUnavailable) disconnected = true;
        redraw();
      }
    }
  }

  async function connect(form, join = false) {
    if (model.busy) return;
    const values = Object.fromEntries(new FormData(form));
    if (!join) {
      values.rain = Number(values.rain);
      values.budget = Number(values.budget);
    }
    model.busy = true;
    model.error = '';
    model.notice = '';
    redraw();
    try {
      const snapshot = await request(join ? '/join' : '/sessions', 'POST', values);
      credential = { code: snapshot.code, token: snapshot.token };
      rememberCredential();
      adopt(snapshot);
      model.report = null;
      model.selected = null;
    } catch (error) {
      model.error = error.message;
    } finally {
      model.busy = false;
      redraw();
    }
  }

  async function command(type, values = {}) {
    if (model.busy || !model.snapshot) return false;
    let succeeded = false;
    model.busy = true;
    model.error = '';
    model.notice = '';
    redraw();
    try {
      const { code, version } = model.snapshot;
      const snapshot = await request('/sessions/' + code + '/actions', 'POST', { version, type, ...values });
      if (type === 'identify') identifyDirty = false;
      if (type === 'review') reviewDirty = false;
      if (type === 'configure') configDirty = false;
      adopt(snapshot);
      if (type === 'predict') freshPrediction();
      const messages = {
        configure: '本轮条件已保存，可以邀请成员加入。',
        start: '实验已开始。先观察路网，再选择左侧工具。',
        identify: '本组识别判断已保存，下面可核对遗漏与误选。',
        predict: '预测已保存。推进到目标时刻后，将与实际记录对照。',
        dispatch: '队伍已派出。由教学组织者推进时间，观察道路与可达性变化。',
        advance: '时间已推进，地图和学习记录已更新。',
        advance_next: '已推进至下一作业时刻或实验时限，请查看最新结果。',
        review: '教师评阅已保存，组内成员的报告将同步更新。'
      };
      model.notice = messages[type] || '';
      model.report = null;
      if (model.snapshot.phase === 'finished') {
        model.report = await readReport();
      }
      succeeded = true;
    } catch (error) {
      model.error = error.message;
      // 版本冲突只刷新。不能自动重发派遣，否则可能重复扣预算。
      if (error.code === 'version_conflict') await refresh(true);
    } finally {
      model.busy = false;
      redraw();
    }
    return succeeded;
  }

  async function planRoute(){
    if(model.busy||!model.snapshot)return;
    const {from,to}=model.routeDraft;
    model.busy=true;model.error='';model.routeResult=null;redraw();
    try{
      const result=await request('/sessions/'+model.snapshot.code+'/route?'+new URLSearchParams({from,to}));
      if(result.version!==model.snapshot.version){await refresh(true);model.notice='路况已有变化，请按最新状态重新寻路。';}
      else if(from===model.routeDraft.from&&to===model.routeDraft.to)model.routeResult=result;
    }catch(error){model.error=error.message;}
    finally{model.busy=false;redraw();}
  }

  async function startExperiment() {
    if (model.busy || model.snapshot?.role !== 'teacher') return;
    const form = document.querySelector('#learning-config');
    if (form && !form.reportValidity()) return;
    const values = model.configDraft;
    if (values.scenario) {
      const config = { scenario: values.scenario, rain: Number(values.rain), budget: Number(values.budget) };
      if (Object.keys(config).some(key => config[key] !== model.snapshot.config[key])) {
        // 开始时先保存界面上的有效条件，避免用户填写了新值却仍用旧预算开局。
        if (!await command('configure', config)) return;
      }
    }
    await command('start');
  }

  async function initialize() {
    if (loading) return;
    loading = true;
    try {
      model.catalog = await request('/catalog');
      if (credential) {
        try {
          adopt(await request('/sessions/' + credential.code));
          if (model.snapshot.phase === 'finished') {
            model.report = await readReport();
          }
        } catch (error) {
          model.error = error.message;
          if (['unauthorized', 'not_found'].includes(error.code)) {
            credential = null;
            model.snapshot = null;
            rememberCredential();
          }
        }
      }
    } catch (error) {
      model.online = false;
      model.error = error.message;
    } finally {
      loading = false;
      redraw();
    }
  }

  // views 不调用地图模块；容器 HTML 和地图挂载由 controller 协调。
  async function readReport() {
    try {
      const report = await request('/sessions/' + model.snapshot.code + '/report');
      reportFailure = false;
      return report;
    } catch (error) {
      // 显示一次失败并保留手动重试入口，不在每次重绘时无限请求。
      reportFailure = true;
      throw error;
    }
  }

  function view() {
    const sceneHTML = model.snapshot?.phase === 'running' ? window.FloodGeoScene.template(false).replace(
      '<button data-camera-preset="overview">↗ 区域总览</button>',
      `<button data-learning-view="region" aria-pressed="${model.mapScope === 'region'}">城市总览</button><button data-learning-view="task" aria-pressed="${model.mapScope === 'task'}">教学任务区</button>`
    ) : '';
    return views.view({ ...model, sceneHTML });
  }

  function mount() {
    document.body.classList.toggle('classroom-map-open', active() && model.snapshot?.phase === 'running');
    if (!model.catalog && model.online !== false) initialize();
    if (!poll) {
      poll = setInterval(() => {
        if (active() && credential && !model.busy) refresh(true);
      }, 3000);
    }
    if (model.snapshot?.phase === 'running') {
      // 选择描边属于显示草稿，不改写后端返回的实验状态。
      const displayState = { ...model.snapshot.state, selection: model.panelOpen && model.tool === 'identify' ? [...model.identifySelection] : [] };
      const road=model.snapshot.roads.find(road=>road.id===model.selected);
      const chosen=road?.dispatchOptions.find(option=>option.allowed&&option.crewId===model.crewSelection[road.id])||road?.dispatchOptions.find(option=>option.allowed);
      const routePreview=model.tool==='route'?model.routeResult?.route:model.panelOpen&&model.tool==='dispatch'?chosen?.route:null;
      window.FloodGeoScene.mount({ state: displayState, page: 'classroom', classroomSpatial:model.snapshot.spatial, selectedRoad:model.selected, reachableNodes:model.snapshot.nodes.filter(node=>node.reachable).map(node=>node.id), routePreview });
      window.FloodGeoScene.getMap()?.resize();
      clearTimeout(mapTimer);
      mapTimer = setTimeout(applyLayers, 200);
    }
    if (model.snapshot?.phase === 'finished' && !model.report && !model.busy && !reportFailure) {
      model.busy = true;
      readReport()
        .then(report => { model.report = report; })
        .catch(error => { model.error = error.message; })
        .finally(() => { model.busy = false; redraw(); });
    }
  }

  // 人口圈仅显示后端快照中的教学人口与可达性，不是实际人口密度调查。
  function applyLayers() {
    const map = window.FloodGeoScene.getMap();
    const snapshot = model.snapshot;
    if (!active() || snapshot?.phase !== 'running' || !map) return;
    if (!map.isStyleLoaded()) {
      // 地理数据可能晚于页面挂载完成；等待真正可绘制，再创建教学图层和构图。
      if (waitingMap !== map) {
        waitingMap = map;
        map.once('idle', () => { waitingMap = null; applyLayers(); });
      }
      return;
    }

    const points = window.FloodGeoScene.getPoints();
    const masked = model.panelOpen && model.tool === 'identify' && !snapshot.state.identification;
    const selected = new Set(model.tool === 'identify' ? model.identifySelection : [model.selected]);
    const container = map.getContainer();
    // Only an explicit view choice or another room resets the camera. Polling,
    // opening tools and resizing retain the user's view; coverage is guarded by
    // the geographical renderer for the actual available data bounds.
    const frame = [snapshot.code, model.mapScope].join(':');
    const coordinates = snapshot.nodes.map(node => points[node.id]).filter(Boolean);
    const lng = coordinates.map(point => point[0]), lat = coordinates.map(point => point[1]);
    const taskBounds = [[Math.min(...lng), Math.min(...lat)], [Math.max(...lng), Math.max(...lat)]];
    if (mapFrame !== frame) {
      if (coordinates.length > 1) {
        mapFrame = frame;
        if (model.mapScope === 'region') window.FloodGeoScene.coverRegion();
        else window.FloodGeoScene.fitCoveredBounds(taskBounds, {
          padding: { top: container.clientWidth < 761 ? 160 : 90, bottom: 90, left: Math.min(110, container.clientWidth * .14), right: Math.min(100, container.clientWidth * .12) },
          maxZoom: 15, duration: 0, pitch: 0
        });
      }
    }
    if (!map.getSource('learning-task-boundary')) {
      const [[west, south], [east, north]] = taskBounds;
      map.addSource('learning-task-boundary', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[west - .002, south - .002], [east + .002, south - .002], [east + .002, north + .002], [west - .002, north + .002], [west - .002, south - .002]]] } } });
      map.addLayer({ id: 'learning-task-boundary', type: 'line', source: 'learning-task-boundary', paint: { 'line-color': '#a96d35', 'line-width': 1.5, 'line-dasharray': [5, 4], 'line-opacity': .8 } });
    }
    map.setLayoutProperty('learning-task-boundary', 'visibility', 'visible');
    const data = {
      type: 'FeatureCollection',
      features: snapshot.nodes.filter(node => node.pop && points[node.id]).map(node => ({
        type: 'Feature',
        properties: { id: node.id, pop: node.pop, reachable: node.reachable ? 1 : 0, selected: selected.has(node.id) ? 1 : 0 },
        geometry: { type: 'Point', coordinates: points[node.id] }
      }))
    };
    if (map.getSource('learning-population')) {
      map.getSource('learning-population').setData(data);
    } else {
      map.addSource('learning-population', { type: 'geojson', data });
      map.addLayer({
        id: 'learning-population',
        type: 'circle',
        source: 'learning-population',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'pop'], 0, 10, 320, 38],
          'circle-color': ['case', ['==', ['get', 'reachable'], 1], '#208e74', '#c94c59'],
          'circle-opacity': .22,
          'circle-stroke-width': 2,
          'circle-stroke-color': ['case', ['==', ['get', 'reachable'], 1], '#26977d', '#c94c59']
        }
      });
    }
    const reachColor = ['case', ['==', ['get', 'reachable'], 1], '#208e74', '#c94c59'];
    map.setPaintProperty('learning-population', 'circle-color', masked ? '#7897ab' : reachColor);
    map.setPaintProperty('learning-population', 'circle-stroke-width', ['case', ['==', ['get', 'selected'], 1], 4, 1.5]);
    map.setPaintProperty('learning-population', 'circle-stroke-color', ['case', ['==', ['get', 'selected'], 1], '#e5b45f', masked ? '#9bb4c3' : reachColor]);
    if (selectionMap !== map) {
      map.on('click', 'learning-population', event => {
        if (active() && model.tool === 'identify' && event.features?.[0]) {
          chooseNode(event.features[0].properties.id);
        }
      });
      map.on('mouseenter', 'learning-population', () => {
        if (active() && model.tool === 'identify') map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'learning-population', () => { map.getCanvas().style.cursor = ''; });
      selectionMap = map;
    }
    for (const marker of document.querySelectorAll('.geo-marker[data-node]')) {
      const chosen = model.tool === 'identify' ? selected.has(marker.dataset.node) : marker.dataset.node === model.selected;
      marker.classList.toggle('is-learning-selected', chosen);
      marker.setAttribute('aria-pressed', String(chosen));
    }
    for (const marker of document.querySelectorAll('.geo-road-marker[data-road]')) {
      marker.classList.toggle('is-learning-selected', marker.dataset.road === model.selected);
    }
    const groups = [
      ['people', ['learning-population']],
      ['roads', ['teaching-roads', 'teaching-roads-halo']],
      ['floods', ['flood-areas', 'flood-depth']],
      ['buildings', ['building-footprints', 'buildings-3d', 'scene-roofs', 'scene-windows']]
    ];
    for (const [name, ids] of groups) {
      for (const id of ids) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', model.layers[name] ? 'visible' : 'none');
      }
    }
    document.querySelector('.learning-shell')?.classList.toggle('lc-hide-roads', !model.layers.roads);
  }

  function disconnect() {
    if (model.busy) return;
    if (model.snapshot) retainSession(model.snapshot);
    credential = null;
    model.snapshot = null;
    model.report = null;
    model.selected = null;
    model.error = '';
    resetWorkspace(null);
    rememberCredential();
    redraw();
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function exportReport() {
    if (!model.report) return;
    const { snapshot } = model;
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>本轮实验报告</title>
      <style>
        *{box-sizing:border-box}body{font:15px/1.8 "Microsoft YaHei",sans-serif;color:#263944;background:#fff;max-width:1100px;margin:30px auto;padding:24px}
        button{display:none!important}h2{font-size:24px}h3{font-size:19px}h4{font-size:16px}p{overflow-wrap:anywhere}.lc-icon{width:20px;height:20px;vertical-align:middle}
        .lc-report-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:25px 0}.lc-report-metrics>div,.lc-card{border:1px solid #d7e0e5;border-radius:6px;padding:20px}
        .lc-report-metrics strong{display:block;font-size:25px}.lc-report-metrics em{font-size:14px;font-style:normal}.lc-report-metrics span{display:block;color:#5d707b;font-size:13px}
        .lc-card{margin:20px 0}.lc-section-title{display:flex;gap:12px;align-items:start}.lc-section-number{font-size:20px;color:#5a777f}.lc-section-title h3{margin:0}.lc-section-title p{margin-top:5px}
        .lc-score-row{padding:16px 0;border-bottom:1px solid #e0e7eb}.lc-score-row>span{float:right}.lc-score-row p{margin:8px 0}.hint{color:#5d707b;font-size:13px}
        table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:12px;text-align:left;border:1px solid #d7e0e5;vertical-align:top}th{background:#f3f6f7}.lc-table-scroll{overflow-x:auto}
        .lc-event-list{padding-left:22px}.lc-event-list li{padding:8px 0}.lc-event-time{color:#476c69}.lc-event-time small{margin-left:4px}.lc-event-list p{margin:4px 0}
        .lc-identify-feedback dl{display:grid;grid-template-columns:90px 1fr;gap:8px}.lc-identify-feedback dd{margin:0}.lc-report-footer{border-top:1px solid #d7e0e5;margin-top:25px;padding-top:16px}
        .lc-recovery-chart{display:block;width:100%;height:auto;max-height:270px;font:13px "Microsoft YaHei",sans-serif;fill:#526b74}.lc-chart-grid{stroke:#d8e3e5;stroke-width:1}.lc-chart-line{stroke:#297a69;stroke-width:2.5;vector-effect:non-scaling-stroke}.lc-chart-end{fill:#297a69}.lc-chart-legend{display:block;font-size:13px;color:#526b74}
        .lc-report-total{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:16px 0;border-bottom:1px solid #d7e0e5;margin-bottom:18px}.lc-report-total strong{font-size:28px}.lc-report-total strong small{font-size:14px}.lc-review-state p{white-space:pre-wrap}.lc-review-state small{color:#526b74}
        @media(max-width:650px){body{padding:16px;margin:0}.lc-report-metrics{grid-template-columns:1fr 1fr}.lc-card{padding:16px}th,td{padding:8px}}
        @media print{body{max-width:none;padding:0;margin:0}.lc-card,.lc-report-metrics>div{break-inside:avoid}summary{display:none}}
      </style></head><body>
      ${views.renderReport({ ...model, exporting: true }).replace(/<details\b(?![^>]*\bopen\b)([^>]*)>/g, '<details$1 open>')}
      <p>教学模型：${escapeHTML(snapshot.model.name)}。数据来自后端保存的实验${snapshot.code}。</p></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = '课堂实验报告-' + snapshot.code + '.html';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // 事件只在课堂工作区生效，保留旧平台的其他入口。
  document.addEventListener('click', event => {
    if (!active()) return;
    const mapView = event.target.closest('[data-learning-view]');
    if (mapView) {
      event.preventDefault();
      event.stopImmediatePropagation();
      model.mapScope = mapView.dataset.learningView;
      mapFrame = '';
      applyLayers();
      document.querySelectorAll('[data-learning-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.learningView === model.mapScope)));
      return;
    }
    const tool = event.target.closest('[data-learning-tool]');
    if (tool && !tool.disabled) {
      event.preventDefault();
      event.stopImmediatePropagation();
      model.tool = tool.dataset.learningTool;
      model.panelOpen = true;
      model.layersOpen = false;
      model.error = '';
      model.notice = '';
      redraw();
      return;
    }
    if (event.target.closest('[data-geo-action="topology"],[data-action="geo-topology"]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const topology = document.querySelector('.lc-topology');
      if (topology) {
        topology.open = true;
        topology.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    const road = event.target.closest('[data-road],[data-node],[data-learning-road],[data-learning-node]');
    if (road) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const nodeId = road.dataset.node || road.dataset.learningNode;
      if (nodeId) chooseNode(nodeId);
      else chooseRoad(road.dataset.road || road.dataset.learningRoad);
      return;
    }
    const button = event.target.closest('[data-learning]');
    const entry = event.target.closest('[data-learning-entry]');
    const preparation = event.target.closest('[data-learning-preparation]');
    const reportTab = event.target.closest('[data-learning-report-tab]');
    if (entry || preparation || reportTab) {
      event.preventDefault();
      if (model.busy) return;
      if (entry) model.entry = entry.dataset.learningEntry;
      if (preparation) model.preparation = preparation.dataset.learningPreparation;
      if (reportTab) model.reportTab = reportTab.dataset.learningReportTab;
      model.error = '';
      redraw();
      const focusTarget = entry ? '.lc-entry-form input' : preparation ? '#lc-preparation-content' : '#lc-report-content';
      document.querySelector(focusTarget)?.focus({ preventScroll: true });
      return;
    }
    const resume = event.target.closest('[data-learning-resume]');
    if (resume && !resume.disabled) { event.preventDefault(); resumeSession(resume.dataset.learningResume); return; }
    if (!button || button.disabled) return;
    event.preventDefault();

    switch (button.dataset.learning) {
      case 'close-panel': model.panelOpen = false; redraw(); document.querySelector('[data-learning-tool="' + model.tool + '"]')?.focus({ preventScroll: true }); break;
      case 'clear-route': model.routeResult=null;redraw();break;
      case 'new-road-classroom': disconnect();model.entry='create';redraw();break;
      case 'layers': model.layersOpen = !model.layersOpen; redraw(); break;
      case 'explain':
        model.explain = !model.explain;
        redraw();
        break;
      case 'retry':
        model.online = null;
        model.error = '';
        initialize();
        redraw();
        break;
      case 'refresh': refresh(); break;
      case 'disconnect': disconnect(); break;
      case 'start': startExperiment(); break;
      case 'advance': command('advance', { minutes: 5 }); break;
      case 'advance-next': command('advance_next'); break;
      case 'clear-identify':
        if (canIdentify()) {
          model.identifySelection = [];
          identifyDirty = true;
          redraw();
        }
        break;
      case 'fresh-prediction': freshPrediction(); redraw(); break;
      case 'finish':
        window.modal('<h2>结束本轮实验？</h2><p>当前时刻、投入及未完成的作业都会写入报告。</p><button class="primary" data-learning="confirm-finish">确认结束并生成报告</button>');
        break;
      case 'confirm-finish':
        document.querySelector('#dialog').close();
        command('finish');
        break;
      case 'unselect':
        model.selected = null;
        redraw();
        break;
      case 'report':
        model.report = null;
        reportFailure = false;
        redraw();
        break;
      case 'export': exportReport(); break;
    }
  }, true);

  document.addEventListener('submit', event => {
    if (!active()) return;
    const form = event.target;
    if (!['learning-create', 'learning-join', 'learning-config', 'learning-dispatch', 'learning-identify', 'learning-predict', 'learning-review','learning-route-query'].includes(form.id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(form.id==='learning-route-query'){planRoute();return;}
    if (form.id === 'learning-create' || form.id === 'learning-join') {
      connect(form, form.id === 'learning-join');
      return;
    }
    const values = Object.fromEntries(new FormData(form));
    if (form.id === 'learning-config') {
      command('configure', { scenario: values.scenario, rain: Number(values.rain), budget: Number(values.budget) });
    }
    if (form.id === 'learning-dispatch') {
      command('dispatch', { edgeId: values.edgeId, crewId: values.crewId });
    }
    if (form.id === 'learning-identify') {
      command('identify', { selected: [...model.identifySelection] });
    }
    if (form.id === 'learning-predict') {
      command('predict', {
        target: Number(values.target), population: Number(values.population),
        spent: Number(values.spent), reason: values.reason
      });
    }
    if (form.id === 'learning-review') {
      command('review', { ratings: { evidence: Number(values.evidence), analysis: Number(values.analysis), improvement: Number(values.improvement) }, comment: values.comment });
    }
  }, true);

  // 保存输入中的预测草稿，其他成员更新实验时重新显示也不会丢失。
  document.addEventListener('input', event => {
    if (!active()) return;
    const draft = event.target.closest('#learning-create') ? model.createDraft : event.target.closest('#learning-join') ? model.joinDraft : event.target.closest('#learning-config') ? model.configDraft : null;
    if (draft && event.target.name) {
      draft[event.target.name] = event.target.value;
      if (draft === model.configDraft) configDirty = true;
    }
    if (event.target.closest('#learning-predict') && Object.hasOwn(model.predictionDraft, event.target.name)) {
      model.predictionDraft[event.target.name] = event.target.value;
    }
    if (event.target.closest('#learning-review') && Object.hasOwn(model.reviewDraft, event.target.name)) {
      model.reviewDraft[event.target.name] = event.target.value;
      reviewDirty = true;
    }
  });

  document.addEventListener('change', event => {
    if (!active()) return;
    const input = event.target;
    if(input.closest('#learning-route-query')&&['from','to'].includes(input.name)){
      model.routeDraft[input.name]=input.value;model.routeResult=null;redraw();return;
    }
    if (input.id === 'learning-road') {
      chooseRoad(input.value);
    }
    if (input.name === 'crewId' && input.closest('#learning-dispatch')) {
      model.crewSelection[model.selected] = input.value;
      redraw();
    }
    if (input.hasAttribute('data-learning-identify-node') && canIdentify()) {
      const selected = new Set(model.identifySelection);
      input.checked ? selected.add(input.value) : selected.delete(input.value);
      model.identifySelection = [...selected];
      identifyDirty = true;
      redraw();
    }
    if (input.dataset.learningLayer) {
      model.layers[input.dataset.learningLayer] = input.checked;
      applyLayers();
    }
    if (input.name === 'scenario' && input.closest('#learning-create,#learning-config')) {
      const scenario = model.catalog.scenarios.find(value => value.id === input.value);
      if (scenario) {
        input.form.elements.rain.value = scenario.rain;
        input.form.elements.budget.value = scenario.budget;
        const draft = input.form.id === 'learning-create' ? model.createDraft : model.configDraft;
        Object.assign(draft, { scenario: scenario.id, rain: String(scenario.rain), budget: String(scenario.budget) });
        if (input.form.id === 'learning-config') configDirty = true;
      }
    }
  });

  document.addEventListener('keydown', event => {
    if (active() && event.key === 'Escape' && !document.querySelector('#dialog')?.open) {
      if (model.layersOpen) { model.layersOpen = false; redraw(); document.querySelector('[data-learning=layers]')?.focus(); }
      else if (model.panelOpen) { model.panelOpen = false; redraw(); document.querySelector('[data-learning-tool="' + model.tool + '"]')?.focus(); }
      return;
    }
    if (active() && ['Enter', ' '].includes(event.key) && event.target.matches('[data-learning-road],[data-learning-node]')) {
      event.preventDefault();
      if (event.target.dataset.learningNode) chooseNode(event.target.dataset.learningNode);
      else chooseRoad(event.target.dataset.learningRoad);
    }
  });

  window.addEventListener('flood-map-ready', applyLayers);
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    if (active()) resizeTimer = setTimeout(applyLayers, 180);
  });
  window.addEventListener('flood-view-updated', () => {
    if (!active()) {
      document.body.classList.remove('classroom-map-open');
      const map = window.FloodGeoScene.getMap();
      if (map?.getLayer('learning-population')) map.setLayoutProperty('learning-population', 'visibility', 'none');
      if (map?.getLayer('learning-task-boundary')) map.setLayoutProperty('learning-task-boundary', 'visibility', 'none');
      map?.getSource('classroom-access')?.setData({type:'FeatureCollection',features:[]});
      mapFrame = '';
    }
  });

  // 旧平台只需要这两个入口，无需知道课堂内部如何分层。
  return Object.freeze({ view, mount });
})();

;
/* Source: frontend/app.js */
'use strict';
const E=FloodLab,$=s=>document.querySelector(s),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY='flood-lab-current-v1',HISTORY='flood-lab-history-v1';
let state=E.create(),page='home',timer=null,playbackSpeed=1,dispatchFastForward=false,zoom=1,showLabels=true,routeView=null,roadFilter='all',toastTimer;
let storageError=false;
try{const saved=localStorage.getItem(KEY);if(saved)state=E.validate(JSON.parse(saved));}catch{storageError=true;}
const pages=[['classroom','课堂工作区'],...FloodCommandUI.pages,['home','学习导览'],['real-lab','实景路网仿真'],['compare','方案比较'],['branch-lab','分支复盘'],['challenge-lab','学生出题'],['scene','徐州三维场景'],['overview','灾情感知'],['identify','孤岛识别'],['plan','预算与通道规划'],['resources','抢修队伍派遣'],['simulate','动态推演'],['assessment','决策考核'],['results','学习评价'],['settings','情景配置'],['records','实验记录']];
// Preserve old links and stored experiments while giving each task its own page.
const pageAliases={overview:'identify'};
const canonicalPage=id=>pageAliases[id]||id;
const navigationGroups=[
 {id:'teaching',title:'基础实验',tabs:[['home','学习导览'],['real-lab','实景路网仿真'],['identify','孤岛识别'],['plan','预算与通道规划'],['resources','抢修队伍派遣'],['simulate','动态推演'],['results','学习评价']]},
 {id:'inquiry',title:'探究练习',tabs:[['compare','方案比较'],['branch-lab','分支复盘'],['challenge-lab','学生出题']]},
 {id:'exercise',title:'协作实践',tabs:[['command-duel','双向脚本对战'],['command-scripts','情景脚本'],['command','情景任务'],['command-dispatch','力量派遣'],['command-orders','下达指令'],['command-reports','问题作答'],['command-discussion','小组讨论']]},
 {id:'advanced',title:'参数、考核与资料',tabs:[['settings','实验参数'],['assessment','决策考核'],['command-library','资源与题库'],['scene','区域地图'],['command-room','协作房间'],['command-review','协作评估'],['command-replay','协作回放'],['records','实验记录'],['command-admin','数据备份']]}
];
let teachingRoadsOpen=false,mobileNavOpen=false,lessonHelpOpen=false;
function navigationGroup(id){return navigationGroups.find(g=>g.tabs.some(t=>t[0]===canonicalPage(id)))||navigationGroups[0];}
function navIcon(id){const paths={home:'M3 10l9-7 9 7M5 9v11h5v-6h4v6h5V9','real-lab':'M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2V5M9 3v16M15 5v16',identify:'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14M15 15l6 6M7 10h6M10 7v6',plan:'M8 4h12v16H4V8M4 4h4v4H4zM8 12h8M8 16h5',resources:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4a4 4 0 0 1 0 7M22 21v-2a4 4 0 0 0-3-3.87',simulate:'M8 5l11 7-11 7V5',results:'M4 3v18h17M8 16v-4M13 16V8M18 16V5',compare:'M8 3v18M16 3v18M3 7h10M11 17h10', 'branch-lab':'M6 3v12a4 4 0 0 0 4 4h8M6 9h8a4 4 0 0 0 4-4V3M15 16l3 3-3 3','challenge-lab':'M12 3v18M3 12h18M5 5l14 14M19 5L5 19','command-duel':'M4 3l17 17M14 20h7v-7M20 3L3 20M3 13v7h7', 'command-scripts':'M8 3h8l4 4v14H4V3h4M15 3v5h5M8 12h8M8 16h5',command:'M4 4h16v12H9l-5 4V4M8 8h8M8 12h5','command-dispatch':'M3 16V7h12v9H3M15 10h3l3 4v2h-6M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4M18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4','command-orders':'M4 10l16-6v16L4 14v-4M7 15v5h4l-1-5','command-reports':'M8 8a4 4 0 0 1 8 0c0 3-4 3-4 6M12 18h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20','command-discussion':'M21 11a8 8 0 0 1-8 8H7l-4 3v-7a8 8 0 0 1 8-12h2a8 8 0 0 1 8 8M8 10h8M8 14h5',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2'};return '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[id]||'M4 4h16v16H4V4M8 8h8M8 12h8M8 16h5')+'"/></svg>';}
function sidebar(){
 const active=navigationGroup(page).id;
 return `<button class="nav-mobile-toggle" data-action="menu-toggle" aria-controls="course-navigation" aria-expanded="${mobileNavOpen}"><span>课程目录</span><b>${esc(pages.find(p=>p[0]===page)?.[1]||'学习导览')}</b>${navIcon('plan')}</button><div id="course-navigation" class="nav-links"><div class="nav-course"><span>实验课程</span><b>学习与实践</b><button data-action="nav-focus" aria-label="收起课程目录" title="收起课程目录">${navIcon('compare')}</button></div>${navigationGroups.map(g=>`<details class="nav-group" ${g.id===active?'open':''}><summary title="${g.title}">${navIcon({teaching:'real-lab',inquiry:'branch-lab',exercise:'resources',advanced:'settings'}[g.id])}<span class="nav-label">${g.title}</span><i>⌄</i></summary><div class="nav-group-links">${g.tabs.map(([id,title])=>`<button data-nav="${id}" title="${title}" aria-label="${title}" class="${page===id?'active':''}" ${page===id?'aria-current="page"':''}><span class="num">${navIcon(id)}</span><span class="nav-label">${title}</span></button>`).join('')}</div></details>`).join('')}<div class="nav-bottom">进度自动保存在当前浏览器<br><span>学生实践平台 v5.5</span></div></div>`;
}
const statusNames={open:'正常通行',limited:'限制通行',blocked:'道路阻断',repair:'正在抢修'},colors={open:'#43c9af',limited:'#ffd078',blocked:'#fc727e',repair:'#6faaff'};
const names=id=>E.nodes.find(n=>n.id===id)?.name||id;
const badge=z=>`<span class="badge ${z}">${statusNames[z]}</span>`;
function toast(text){$('#toast').textContent=text;$('#toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').style.display='none',4200);}
function persist(notify=false){try{localStorage.setItem(KEY,JSON.stringify(state));LearningStudio.capture();if(notify)toast('实验已保存到当前浏览器');}catch{toast('浏览器存储不可用，请导出实验备份');}}
function experimentHistory(){try{const v=JSON.parse(localStorage.getItem(HISTORY)||'[]');return Array.isArray(v)?v:[];}catch{return [];}}
function archive(){try{const records=experimentHistory();records.unshift({id:Date.now(),date:new Date().toLocaleString('zh-CN'),state:E.clone(state)});localStorage.setItem(HISTORY,JSON.stringify(records.slice(0,20)));return true;}catch{toast('记录保存失败，请导出 JSON 备份');return false;}}
function stop(){clearInterval(timer);timer=null;dispatchFastForward=false;}
function startPlayback(){clearInterval(timer);timer=setInterval(tick,1000/playbackSpeed);}
function navigate(id){mobileNavOpen=false;id=canonicalPage(id);if(id!=='simulate')stop();if(!FloodCommandUI.isPage(id))FloodCommandUI.stop();if(['command-replay','command-duel'].includes(id))FloodCommandUI.stop();if(!pages.some(p=>p[0]===id))id='home';page=id;location.hash=id;render();window.scrollTo({top:0,behavior:'instant'});}
function modal(html){$('#dialog-content').innerHTML=html;if(!$('#dialog').open)$('#dialog').showModal();window.dispatchEvent(new Event('flood-dialog-open'));}
function confirmAction(title,body,action){modal(`<h2>${title}</h2><p>${body}</p><div class="actions"><button class="primary" data-action="${action}">确定</button><button data-action="close-dialog">取消</button></div>`);}
function nodeOptions(selected){return E.nodes.map(n=>`<option value="${n.id}" ${n.id===selected?'selected':''}>${n.id} · ${n.name}</option>`).join('');}
function topologyMap(){const st=E.stats(state);const highlighted=routeView?.edges||[];const selected=state.selection;return `<div class="map-panel"><div class="map-header"><strong>清河流域 · 实验区域</strong><small>路网拓扑示意 / 非真实地理坐标</small></div><div class="map-actions"><button data-action="zoom-out" aria-label="缩小地图">−</button><button data-action="zoom-in" aria-label="放大地图">＋</button><button data-action="labels">标签</button><button data-action="map-reset">复位</button></div><svg class="map" viewBox="${450-450/zoom} ${250-250/zoom} ${900/zoom} ${500/zoom}" role="img" aria-label="灾情路网图，点击道路查看抢修信息，点击聚落选择孤岛"><defs><pattern id="grid" width="35" height="35" patternUnits="userSpaceOnUse"><path d="M35 0H0V35" fill="none" stroke="#1b3243" stroke-width=".7"/></pattern></defs><rect width="900" height="500" fill="url(#grid)"/><path d="M-30 255 Q180 225 325 265 T590 250 T930 285" stroke="#163a50" stroke-width="57" fill="none"/><path d="M-30 255 Q180 225 325 265 T590 250 T930 285" stroke="#245d75" stroke-width="1" stroke-dasharray="7 10" fill="none"/><text x="335" y="275" fill="#5f90a6" font-size="13" letter-spacing="8">清 河</text>${state.edges.map(e=>{const a=E.nodes.find(n=>n.id===e.a),b=E.nodes.find(n=>n.id===e.b),z=E.status(state,e),h=highlighted.includes(e.id);return `<g class="edge" tabindex="0" role="button" aria-label="${e.id} ${names(e.a)}至${names(e.b)} ${statusNames[z]}" data-road="${e.id}"><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="transparent" stroke-width="22"/><line class="road" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${h?'#ffffff':colors[z]}" stroke-width="${h?6:3}" stroke-dasharray="${z==='blocked'?'7 6':z==='repair'?'3 5':'none'}"/>${showLabels?`<rect x="${(a.x+b.x)/2-17}" y="${(a.y+b.y)/2-12}" width="34" height="21" rx="4" fill="#102535"/><text x="${(a.x+b.x)/2}" y="${(a.y+b.y)/2+3}" fill="${colors[z]}" text-anchor="middle" font-size="12">${e.id}</text>`:''}</g>`}).join('')}${E.nodes.map(n=>{const is=st.groups.some(g=>g.nodes.includes(n.id)),sel=selected.includes(n.id);return `<g class="node" role="button" tabindex="0" data-node="${n.id}" aria-label="${n.name} ${n.pop}人"><circle cx="${n.x}" cy="${n.y}" r="${n.pop?17:8}" fill="${sel?'#347d69':is?'#4b2936':'#143643'}" stroke="${sel?'#78ffd4':is?'#ff7881':'#6fc7c4'}" stroke-width="2"/>${n.pop||n.id==='S'?`<text x="${n.x}" y="${n.y+5}" text-anchor="middle" fill="#eaf6fa" font-size="13">${sel?'✓':n.id}</text>`:''}${showLabels?`<text x="${n.x}" y="${n.y+(n.id==='S'?32:-26)}" fill="#dbe9f0" text-anchor="middle" font-size="14">${n.name}${n.pop?' · '+n.pop+'人':''}</text>`:''}</g>`}).join('')}</svg><div class="map-caption">${page==='identify'?'点击聚落选择识别结果':'点击路段查看状态与抢修条件'} · N ↑</div></div><div class="legend"><span><i></i>正常通行</span><span><i class="limited"></i>限制通行</span><span><i class="blocked"></i>道路阻断</span><span><i class="repair"></i>正在抢修</span></div>`;}
function map(){return window.FloodGeoScene?FloodGeoScene.template(false):topologyMap();}
function scene(){const st=E.stats(state);return `<div class="scene-layout">${FloodGeoScene.template(true)}</div><div class="scene-actions"><div><span class="tag">徐州实景地理</span><span class="hint">在地图上认识灾情，在实验中验证决策。</span></div><div class="actions"><button data-nav="identify" class="primary">开始孤岛识别 →</button><button data-nav="simulate">进入抢通推演</button><button data-nav="assessment">决策考核</button></div></div><section class="scene-summary"><article><span>01 / REGION</span><h3>从区域到街区</h3><p>滚轮拉近，建筑随镜头逐渐立起；选择湖滨街区，可直接进入三维视角。</p></article><article><span>02 / RESPONSE</span><h3>让处置过程可见</h3><p>点击彩色教学通道查看积水与抢修条件；派遣队伍后，作业状态随实验同步。</p></article><article><span>03 / LEARNING</span><h3>真实空间，教学推演</h3><p>徐州地理与建筑轮廓构成空间背景，灾情、人口、设施和任务通道为教学设定。</p></article></section>`;}
function metrics(){const s=E.stats(state);$('#metrics').innerHTML=[['受影响区域人口',s.pop,'人','实验区域内的全部人口',''],['基地不可达人口',s.isolated,'人',s.groups.length+' 个交通孤岛',s.isolated?'red':'green'],['阻断 / 作业路段',s.blocked,'处','共 '+state.edges.length+' 条道路与桥梁','amber'],['实验已用时间',state.time,'分钟','时限 '+state.horizon+' 分钟 · 预算剩余 '+(state.budget-state.spent)+' 万元','green']].map(([label,v,unit,sub,cl])=>`<div class="metric"><div class="label">${label}</div><strong class="${cl}">${v}<small>${unit}</small></strong><div class="sub">${sub}</div></div>`).join('');}
function overview(){const scenario=E.scenarios.find(v=>v.id===state.scenario),st=E.stats(state);return `<section class="home-intro"><div class="home-copy"><span class="home-kicker">智慧教育 / 应急决策训练</span><h2>读懂灾情，作出判断<br><em>让生命通道重新连通</em></h2><p>洪涝灾害交通孤岛识别与生命通道抢通<br>虚拟仿真实验教学平台</p><div class="actions"><button class="primary" data-nav="identify">进入孤岛识别 →</button><button data-nav="assessment">进入决策考核</button><button data-action="help">实验指南</button></div><small>当前实验会保留；开始新考核前可确认并存档。</small></div><aside class="home-question"><span>本次任务 · 你的判断会改变结果</span><h3>有限的时间与资源，<br>先抢通哪一条路？</h3><p>识别被困聚落，安排专业队伍。面对桥梁中断与设备故障，重新评估方案，并从最终成绩中复盘每一次选择。</p><div class="home-facts"><div><b>3</b>教学情景</div><div><b>4</b>专业队伍</div><div><b>4</b>评价维度</div></div></aside></section><section class="home-flow" aria-label="实验学习流程"><div><b>01</b><span>观察与识别<small>判断路网连通性</small></span></div><div><b>02</b><span>规划与调度<small>权衡工期、预算与重点设施</small></span></div><div><b>03</b><span>推演与决策<small>应对动态灾情与突发事件</small></span></div><div><b>04</b><span>评分与复盘<small>查看操作后果和改进依据</small></span></div></section><div class="workspace"><section class="panel"><div class="panel-head"><h2>区域灾情态势</h2><small>情景时刻 T+${String(state.time).padStart(3,'0')} min</small></div>${map()}</section><aside class="stack"><section class="panel"><div class="panel-head"><h2>灾情简报</h2><span class="tag">${scenario.level}</span></div><div class="panel-body"><p class="hint">${scenario.desc}</p><div class="stat-row"><span>模拟降雨强度</span><b>${state.rain} mm/h</b></div><div class="stat-row"><span>重点设施可达</span><b>${st.urgent} / 2</b></div><div class="stat-row"><span>基地可达人口</span><b>${st.available} 人</b></div><div class="stat-row"><span>抢修队伍</span><b>${state.crews.filter(c=>!c.job).length} / 4 待命</b></div><div class="notice spaced">优先保障医院 H 与养老院 B；教学目标为 90 分钟内恢复通道。</div></div></section><section class="panel"><div class="panel-head"><h2>本次实验任务</h2></div><div class="panel-body">${[['识别交通孤岛','提交与救援基地断连的聚落',state.identification],['制定抢通方案','安排道路顺序和匹配工种',state.plan.length||state.spent],['推演并复盘','观察动态灾情，完成评价',state.ended]].map(([t,d,done],i)=>`<div class="task-check"><b>${done?'✓':i+1}</b><div>${t}<small>${d}</small></div></div>`).join('')}<div class="actions"><button class="primary" data-nav="identify">开始孤岛识别</button></div></div></section></aside></div><section class="panel spaced"><div class="panel-head"><h2>道路监测清单</h2><select id="road-filter" aria-label="道路状态筛选"><option value="all">全部道路</option>${Object.entries(statusNames).map(([k,v])=>`<option value="${k}" ${roadFilter===k?'selected':''}>${v}</option>`).join('')}</select></div>${roadTable()}</section>`;}
function roadTable(){const list=state.edges.filter(e=>roadFilter==='all'||E.status(state,e)===roadFilter);return `<div class="table-wrap"><table><thead><tr><th>道路编号</th><th>连接区域</th><th>长度</th><th>积水深度</th><th>状态</th><th>操作</th></tr></thead><tbody>${list.map(e=>`<tr><td>${e.id}${e.type==='bridge'?' · 桥梁':''}</td><td>${names(e.a)} / ${names(e.b)}</td><td>${e.length} km</td><td>${e.depth.toFixed(2)} m</td><td>${badge(E.status(state,e))}</td><td><button class="small" data-road="${e.id}">查看</button></td></tr>`).join('')||'<tr><td colspan="6">当前筛选没有道路</td></tr>'}</tbody></table></div>`;}
function identify(){return `<div class="workspace identify-workspace"><section class="panel identify-map">${map()}</section><aside class="panel identify-answer"><div class="panel-head"><div><span class="eyebrow">提交你的判断</span><h2>哪些聚落无法到达？</h2></div><span class="tag">已选 ${state.selection.length} 处</span></div><div class="panel-body"><p class="answer-intro">选择全部断连聚落，再提交验证。</p><div class="identify-options">${E.nodes.filter(n=>n.pop).map(n=>`<label class="select-card"><input type="checkbox" data-select-node="${n.id}" ${state.selection.includes(n.id)?'checked':''} ${state.time||state.spent?'disabled':''}><span class="answer-place"><b>${n.name}</b><small>${n.id}${['B','H'].includes(n.id)?' · 重点保障':''}</small></span><span class="answer-pop">${n.pop}<small> 人</small></span></label>`).join('')}</div><div class="answer-actions"><button class="primary" data-action="identify" ${state.time||state.spent?'disabled':''}>提交识别结果</button><p>橙色限行道路仍可通行。</p></div>${state.identification?`<div class="notice spaced">识别反馈：F1 ${Math.round(state.identification.score/25*100)}%。${state.identification.score===25?'已正确识别全部受困聚落。':'仍有漏选或误选。请检查到基地的连通路径。'}</div><div class="actions"><button data-nav="plan">进入通道规划 →</button></div>`:''}</div></aside></div>`;}
function plan(){const st=E.stats(state);return `<div class="planning-layout"><section class="panel planning-map">${map()}</section><aside class="planning-side"><section class="panel"><div class="panel-head"><h2>生命通道查询</h2><span class="tag">最短通行时间</span></div><div class="panel-body"><div class="form-grid"><label class="field">出发点<select id="route-from">${nodeOptions(routeView?.from||'S')}</select></label><label class="field">目的地<select id="route-to">${nodeOptions(routeView?.to||'H')}</select></label></div><div class="actions"><button class="primary" data-action="route">计算可通行路线</button><button data-action="clear-route">清除路线</button></div>${routeView?routeView.error?`<div class="notice spaced">当前无可通行路线。先抢通连接目标区域的阻断路段，再重新查询。</div>`:`<div class="route-result"><b>${routeView.nodes.map(names).join(' → ')}</b><p>${routeView.edges.join(' / ')||'原地'} · ${routeView.distance} km · 预计 ${routeView.minutes} 分钟</p><small>正常道路按 30 km/h、限行道路按 15 km/h 计算。</small></div>`:'<p class="hint spaced">路线依据当前道路状态计算，推演中会随道路变化更新。</p>'}</div></section><section class="panel"><div class="panel-head"><h2>抢通顺序</h2><small>${state.plan.length} 项待执行</small></div><div class="panel-body"><p class="hint">在地图中选择阻断道路加入计划，可上下调整顺序。推演时优先派遣可进场且工种匹配的空闲队伍。</p><ol class="order-list">${state.plan.map((id,i)=>{const e=state.edges.find(e=>e.id===id);return `<li><span class="order">${String(i+1).padStart(2,'0')}</span><div class="grow">${id} · ${names(e.a)} / ${names(e.b)}<small>${e.work} 分钟作业 · ${e.cost} 万元</small></div><button class="small" data-move="${id}" data-dir="-1" aria-label="上移 ${id}" ${i===0?'disabled':''}>↑</button><button class="small" data-move="${id}" data-dir="1" aria-label="下移 ${id}" ${i===state.plan.length-1?'disabled':''}>↓</button><button class="small" data-remove="${id}" aria-label="移除 ${id}">×</button></li>`}).join('')||'<li class="hint">尚未添加道路，请点击地图中的红色路段。</li>'}</ol><div class="actions"><button data-action="recommend">生成参考顺序</button><button class="primary" data-nav="resources">前往抢修队伍派遣 →</button></div><details class="planning-explainer"><summary>参考顺序的依据</summary><p class="hint">参考方案按“新增可达人口＋重点设施权重 / 工期与投入”逐步选择，供比较学习，不保证全局最优。</p></details></div></section></aside></div>`;}
function crewCards(){return state.crews.map(c=>`<div class="crew"><div class="crew-top"><b>${c.name}</b><span class="${c.job?'blue':'green'}">${c.job?'执行中':'待命'}</span></div>${c.job?`<small>${c.job.edge} · 预计 T+${c.job.end} 完成</small><progress value="${state.time-c.job.start}" max="${c.job.duration}"></progress>`:`<small>工种：${({road:'清障与道路修复',pump:'排涝抽排',bridge:'桥梁加固'})[c.type]}</small>`}</div>`).join('');}
function resources(){const blocked=state.edges.filter(e=>!E.passable(state,e));return `<div class="workspace"><section class="panel"><div class="panel-head"><h2>抢修派遣台</h2><span class="tag">预算 ${state.budget-state.spent} 万元可用</span></div><div class="panel-body"><p class="hint">选择工种匹配的空闲队伍。至少一个作业端点须与基地连通；进场时间计入总工期。每次派遣即扣除该路段投入。</p></div><div class="table-wrap"><table><thead><tr><th>路段</th><th>状态</th><th>所需工种</th><th>作业时间 / 投入</th><th>派遣</th></tr></thead><tbody>${blocked.map(e=>{const type=E.requiredType(e);return `<tr><td><button class="small" data-road="${e.id}">${e.id}</button></td><td>${badge(E.status(state,e))}</td><td>${({road:'道路',pump:'排涝',bridge:'桥梁'})[type]}</td><td>${e.work} min / ${e.cost} 万元</td><td><select aria-label="${e.id} 派遣队伍" id="crew-${e.id}">${state.crews.filter(c=>c.type===type).map(c=>`<option value="${c.id}" ${state.crews.find(v=>v.type===type&&!E.canDispatch(state,e.id,v.id))?.id===c.id?'selected':''}>${c.name}${c.job?'（忙碌）':''}</option>`).join('')}</select> <button class="small" data-dispatch="${e.id}" ${state.ended||E.status(state,e)==='repair'?'disabled':''}>派遣</button></td></tr>`}).join('')||'<tr><td colspan="5">所有道路均可通行</td></tr>'}</tbody></table></div><div class="panel-body"><label class="inline-label"><input id="auto-plan" type="checkbox" ${state.auto?'checked':''} ${state.ended?'disabled':''}>按计划自动派遣（${state.plan.length} 条待执行）</label><div class="actions"><button class="primary" data-action="dispatch-fast" ${state.ended||!state.crews.some(c=>c.job)?'disabled':''}>完成派遣 · 4倍推演</button><button data-nav="simulate">进入仿真推演</button><button data-scroll="teaching-plan">调整抢通顺序 ↑</button></div></div></section><aside class="panel"><div class="panel-head"><h2>抢修力量</h2><small>4 支专业队伍</small></div><div class="panel-body">${crewCards()}<p class="hint">队伍完成任务后回到待命状态；下一任务进场统一从基地计算，属于教学简化。</p></div></aside></div>`;}
function chart(){const ts=state.timeline,max=E.stats(state).pop;const pts=ts.map(t=>`${40+t.time/180*720},${135-t.available/max*110}`).join(' ');return `<svg class="chart" viewBox="0 0 800 165" role="img" aria-label="基地可达人口随实验时间变化"><line x1="40" y1="135" x2="760" y2="135" stroke="#405568"/><line x1="40" y1="25" x2="760" y2="25" stroke="#263e50" stroke-dasharray="5 5"/><text x="5" y="29" fill="#9aafbf" font-size="12">${max}</text><text x="18" y="138" fill="#9aafbf" font-size="12">0</text><polyline points="${pts}" fill="none" stroke="#43dfbf" stroke-width="3"/>${[0,30,60,90,120,150,180].map(t=>`<text x="${40+t/180*720}" y="157" fill="#9aafbf" font-size="12" text-anchor="middle">${t} min</text>`).join('')}</svg>`;}
function logs(){return `<div class="log">${[...state.logs].reverse().map(l=>`<div class="log-item"><time>T+${l.time} min</time>${esc(l.text)}</div>`).join('')}</div>`;}
function simulate(){return `<div class="workspace"><section class="panel"><div class="simulation-toolbar"><div class="clock">T + ${String(state.time).padStart(3,'0')}<small>${state.ended?'实验已结束':timer?'推演运行中':'推演已暂停'}</small></div><button class="primary" data-action="play" ${state.ended?'disabled':''}>${timer?'暂停推演':'开始推演'}</button><button data-action="step" ${state.ended||timer?'disabled':''}>推进 5 分钟</button><label class="inline-label">播放速度 <select id="playback-speed" aria-label="推演播放速度">${[1,2,4].map(n=>`<option value="${n}" ${playbackSpeed===n?'selected':''}>${n}倍</option>`).join('')}</select></label><button data-action="finish" ${state.ended?'disabled':''}>结束并评价</button></div>${map()}<div class="panel-body"><div class="stat-row"><span>基地可达人口变化</span><b class="green">${E.stats(state).available} 人</b></div>${chart()}<p class="hint">当前 ${playbackSpeed} 倍播放，每秒推进 ${5*playbackSpeed} 分钟；可随时暂停。加速派遣模式会在当前作业全部完成后暂停。新增可达代表通道恢复，不等同于人员已完成转移。</p></div></section><aside class="stack"><section class="panel"><div class="panel-head"><h2>队伍作业进度</h2></div><div class="panel-body">${crewCards()}<label class="inline-label"><input id="auto-plan" type="checkbox" ${state.auto?'checked':''} ${state.ended?'disabled':''}>按计划自动派遣</label><div class="actions"><button data-nav="resources">手动调整派遣</button></div></div></section><section class="panel"><div class="panel-head"><h2>推演事件</h2></div><div class="panel-body">${logs()}</div></section></aside></div>`;}
const quiz=[{q:'1. 哪些聚落构成交通孤岛？',options:['所有存在积水的聚落','无法通过可通行路网连接救援基地的聚落','距离救援基地最远的聚落']},{q:'2. 当一条道路的两个端点均不可达时，应如何安排地面抢修？',options:['直接派遣任何空闲队伍','只增加该道路预算','优先抢通到作业端点的进场道路']},{q:'3. 医院周边道路抢通后，可以直接认定什么？',options:['医院恢复了基地可达性','所有患者已经完成转运','灾区已没有任何风险']}];
function results(){if(state.assessment)return FloodAssessmentUI.results();const r=E.score(state);return `<p class="section-intro">${state.ended?'本次实验已结束，可完善复盘并邀请教师或同伴点评。':'这是当前过程评价，继续推演后结果仍可能变化。'} 评价以实际决策成效为依据。</p>${DecisionReviewUI.results(r)}<div class="two-col spaced"><section class="panel"><div class="panel-head"><h2>知识检查 · 学习反馈</h2></div><div class="panel-body"><p class="hint">用于检查理解，不单独累加到新版总分。</p>${quiz.map((q,i)=>`<div class="spaced"><h3>${q.q}</h3>${q.options.map((o,j)=>`<label class="quiz-option"><input type="radio" name="quiz-${i}" data-quiz="${i}" value="${j}" ${state.quiz[i]===j?'checked':''}>${o}</label>`).join('')}</div>`).join('')}<button data-action="check-quiz" class="spaced">检查答案</button></div></section><section class="panel"><div class="panel-head"><h2>学生决策复盘</h2></div><div class="panel-body"><label class="field">姓名 / 小组<input id="student" maxlength="100" value="${esc(state.student)}" placeholder="用于报告署名"></label><label class="field spaced">依据、差异与下一次改进<textarea id="reflection" maxlength="10000" rows="8" placeholder="结合具体道路、预测差异、恢复时刻和投入说明选择理由，并提出可验证的改进。">${esc(state.reflection)}</textarea></label><p class="hint">先保存复盘，再请教师或同伴按量表点评；字数不自动换算成质量分。</p><button data-action="save-reflection">保存学生复盘</button></div></section></div>${DecisionReviewUI.reviewForm(r)}`;}

function settings(){const locked=!!(state.time||state.spent||state.learningBranch||state.challenge||state.learningConditionsLocked);return `<p class="section-intro">配置下一次教学实验。实验开始后参数锁定；切换情景会先保存当前实验到本机记录。</p><div class="three-col">${E.scenarios.map(s=>`<button class="panel scenario-card ${s.id===state.scenario?'selected':''}" data-scenario="${s.id}"><div class="level">${s.level}</div><h3>${s.name}</h3><p>${s.desc}</p><span class="hint">${s.rain} mm/h · ${s.budget} 万元 · ${s.horizon} min</span></button>`).join('')}</div><div class="two-col spaced"><section class="panel"><div class="panel-head"><h2>情景参数</h2><span class="tag">${locked?'实验中已锁定':'可编辑'}</span></div><div class="panel-body"><div class="form-grid"><label class="field">降雨强度（mm/h）<input id="rain" type="number" min="0" max="150" value="${state.rain}" ${locked?'disabled':''}></label><label class="field">抢修预算（万元）<input id="budget" type="number" min="20" max="200" value="${state.budget}" ${locked?'disabled':''}></label></div><div class="actions"><button class="primary" data-action="configure" ${locked?'disabled':''}>应用参数</button></div><p class="hint spaced">降雨范围 0–150 mm/h；预算 20–200 万元。实验时限固定为 180 分钟。</p></div></section><section class="panel"><div class="panel-head"><h2>教学模型说明</h2></div><div class="panel-body"><p class="hint">这是以徐州真实地理为背景的教学场景的路网决策实验，所有阈值与工期均为教学设定。</p><div class="stat-row"><span>正常通行</span><b>积水 &lt; 0.15 m</b></div><div class="stat-row"><span>限制通行</span><b>0.15–0.30 m</b></div><div class="stat-row"><span>道路阻断</span><b>≥ 0.30 m 或结构受损</b></div><p class="hint spaced">已有积水路段每分钟增加 max(降雨−35, 0) × 0.000025 m；修复后设为本次实验内持续通行。未设置水动力学、真实水位预测与实际车辆涉水能力。</p></div></section></div>`;}
function records(){const list=experimentHistory();return `<section class="panel"><div class="panel-head"><h2>本机实验记录</h2><div class="actions"><button data-action="export">导出当前备份</button><button data-action="import">导入实验</button><button class="primary" data-action="archive">保存一条记录</button></div></div><div class="panel-body"><p class="hint">最多保存最近 20 次实验，仅当前浏览器可见。导出的 JSON 可用于迁移和继续实验；HTML 报告可用浏览器打印为 PDF。</p></div><div class="table-wrap"><table><thead><tr><th>保存时间</th><th>情景 / 姓名</th><th>进度</th><th>得分</th><th>操作</th></tr></thead><tbody>${list.map(r=>{try{const s=E.validate(r.state);return `<tr><td>${esc(r.date)}</td><td>${E.scenarios.find(v=>v.id===s.scenario).name}<br><span class="muted">${esc(s.student||'未署名')}</span></td><td>${s.time} min · ${s.ended?'已结束':'进行中'}</td><td>${s.assessment?.phase==='active'?'未交卷':E.score(s).total}</td><td><button class="small" data-restore="${Number(r.id)}">载入</button> <button class="small danger" data-delete="${Number(r.id)}">删除</button></td></tr>`}catch{return ''}}).join('')||'<tr><td colspan="5" class="empty">暂无历史实验。完成一次练习后在此保存、比较与复盘。</td></tr>'}</tbody></table></div></section>`;}
function roadEditor(){const locked=state.time||state.spent||state.ended||state.learningBranch||state.challenge||state.learningConditionsLocked;return `<section class="panel spaced"><div class="panel-head"><h2>初始道路状态编辑</h2><small>更改后清空识别答案与待执行计划</small></div><div class="table-wrap"><table><thead><tr><th>路段</th><th>连接区域</th><th>积水深度（m）</th><th>结构损坏 / 清障阻断</th><th>操作</th></tr></thead><tbody>${state.edges.map(e=>`<tr><td>${e.id}</td><td>${names(e.a)} / ${names(e.b)}</td><td><input aria-label="${e.id} 初始积水" id="depth-${e.id}" type="number" min="0" max="2" step="0.01" value="${e.depth.toFixed(2)}" ${locked?'disabled':''}></td><td><input aria-label="${e.id} 结构阻断" type="checkbox" id="damage-${e.id}" ${e.damage?'checked':''} ${locked?'disabled':''}></td><td><button class="small" data-save-road="${e.id}" ${locked?'disabled':''}>应用</button></td></tr>`).join('')}</tbody></table></div></section>`;}
function identificationWorkspace(){
 const scenario=E.scenarios.find(v=>v.id===state.scenario),st=E.stats(state),locked=state.time||state.spent;
 return `<section class="lab-taskbar"><div><span class="lab-step">实验 01</span><p>从基地 S 出发，找出无法通过道路连通的聚落。</p></div><button data-action="lesson-help">${navIcon('command-reports')}操作帮助</button>${locked?'<span class="lab-locked">本轮已开始推演，初始识别已锁定</span>':''}</section>`+identify()+`<div class="lab-secondary"><details class="panel lab-context"><summary>实验条件与灾情简报<span>${esc(scenario.name)}</span></summary><div class="panel-body"><h3>${esc(scenario.name)}</h3><p>${esc(scenario.desc)}</p><div class="lab-context-stats"><span>区域人口 <b>${st.pop} 人</b></span><span>实验时刻 <b>T+${state.time} / ${state.horizon} 分钟</b></span><span>剩余预算 <b>${state.budget-state.spent} 万元</b></span></div></div></details><details class="teaching-road-details panel" id="teaching-roads" ${teachingRoadsOpen?'open':''}><summary>道路状态与监测清单</summary><div class="panel-head"><span class="hint">各路段积水、连接与通行状态</span><select id="road-filter" aria-label="道路状态筛选"><option value="all">全部道路</option>${Object.entries(statusNames).map(([k,v])=>`<option value="${k}" ${roadFilter===k?'selected':''}>${v}</option>`).join('')}</select></div>${roadTable()}</details></div>`;
}
function planningWorkspace(){const cost=state.plan.reduce((n,id)=>n+state.edges.find(e=>e.id===id).cost,0),remaining=state.budget-state.spent;return `<section class="decision-budget"><div><small>剩余预算</small><b>${remaining} <span>万元</span></b></div><div><small>待执行计划投入</small><b>${cost} <span>万元</span></b></div><p>${cost>remaining?'当前计划超出剩余预算 '+(cost-remaining)+' 万元，请调整道路顺序或取舍。':'每条路的工期与费用不同；先比较连通收益，再决定把有限预算用在哪里。'}</p><button data-nav="compare">比较方案 →</button></section><div id="teaching-plan">${plan()}</div><div class="actions"><button class="primary" data-nav="resources">下一步：抢修队伍派遣 →</button></div>`;}
function learningHome(){
 const scenario=E.scenarios.find(v=>v.id===state.scenario),next=StudentSupport.next();
 const steps=[['identify','孤岛识别','找出断连聚落',!!state.identification],['plan','预算规划','比较通道收益',!!state.plan.length||state.spent>0],['resources','队伍派遣','确认进场条件',state.spent>0],['simulate','动态推演','观察路网变化',state.time>0],['results','评价复盘','用证据解释决策',!!state.reflection.trim()]];
 const done=steps.filter(x=>x[3]).length;
 const lessons=[['classroom','01','课堂协作实验','共同观察，一起作出判断','组织者设置条件，同学识别、预测与派遣，在同一份报告中回看决策。','协作课堂','blue'],['real-lab','02','真实路网实验','把决策放回真实城市','进入徐州实际道路网络，观察积水、设施与通道的空间关系。','空间探索','teal'],['branch-lab','03','分支复盘','换一种选择，验证不同结果','保留关键决策时刻，以同样的初始条件比较两种抢通方案。','对照研究','orange'],['command-duel','04','同伴脚本对战','从解决问题，到设计问题','双方设置情景、交换任务，用彼此的方案检验脚本与处置思路。','同伴探究','purple']];
 return `<nav class="course-top-nav" aria-label="课程快捷导航"><span aria-current="page">课程首页</span><button data-nav="classroom">课堂实验</button><button data-nav="records">学习记录</button><a href="tutorial.html">学习指南 ↗</a></nav>
 <section class="course-hero"><img class="course-hero-photo" src="xuzhou-3d-preview.jpg?v=52" alt="徐州云龙湖实拍，湖岸建筑、音乐厅与城市天际线"><div class="course-hero-copy"><div class="course-eyebrow"><i></i>交通与防灾 · 虚拟仿真实验课程</div><h1>在真实城市中，<br>推演每一次决策。</h1><p>从一条受阻道路出发，理解城市连通、资源约束与抢通顺序。先作判断，再用实验检验。</p><div class="course-hero-actions"><button class="primary" data-nav="classroom">进入课堂实验 <span>→</span></button><button data-nav="real-lab">探索实景路网 ↗</button></div><div class="course-hero-topics"><span>孤岛识别</span><span>动态规划</span><span>同伴探究</span></div></div><span class="course-location">江苏 · 徐州云龙湖 <small>真实城市 / 教学情景</small></span></section>
 <div class="course-photo-credit">实拍摄影：<a href="https://commons.wikimedia.org/wiki/File:20260722_Yunlong_Lake_Xuzhou_05.jpg" target="_blank" rel="noopener">祝鱼贵 / Wikimedia Commons</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a> · 原图未修改，页面裁切展示</div>
 <section class="course-orientation" aria-label="学习方式"><div><span class="orientation-number">01</span><div><b>读懂空间</b><small>地图、路况与设施关系</small></div></div><div><span class="orientation-number">02</span><div><b>验证决策</b><small>预算、工期与可达性变化</small></div></div><div><span class="orientation-number">03</span><div><b>解释结果</b><small>预测对照与过程证据</small></div></div><a href="tutorial.html">第一次使用？<b>查看学习指南 →</b></a></section>
 <details class="course-catalog course-disclosure"><summary><span>选择其他学习方式<small>实景探索、分支复盘与同伴挑战</small></span><b>展开 ＋</b></summary><div class="course-card-grid">${lessons.filter(item=>item[0]!=='classroom').map(([id,num,title,subtitle,description,label,color])=>`<article class="course-card is-${color}"><div class="course-card-top"><span class="course-card-label">${label}</span><span class="course-card-number">${num}</span></div><h3>${title}</h3><b>${subtitle}</b><p>${description}</p><button data-nav="${id}">进入实验 <span>↗</span></button></article>`).join('')}</div></details>
 <details class="course-progress course-disclosure"><summary><span>个人基础练习<small>按环节进入，保留当前练习进度</small></span><b>展开 ＋</b></summary><div class="course-section-heading"><div><span>基础训练</span><h2>基础练习 · 循序渐进</h2></div><p>${esc(scenario.name)} · 已记录 ${done} / 5 个环节</p></div><div class="course-step-list">${steps.map(([id,title,description,recorded],i)=>`<button data-nav="${id}" class="${recorded?'is-complete':next[0]===id?'is-current':''}"><span>${recorded?'✓':String(i+1).padStart(2,'0')}</span><div><b>${title}</b><small>${description}</small></div><em>→</em></button>`).join('')}</div></details>
 <div class="course-support-links"><a href="tutorial.html">图文与视频教程 ↗</a><a href="intro.html">项目与模型说明 ↗</a><button data-nav="records">本机实验记录 ↗</button></div>
 <details class="portal-explore panel course-disclosure"><summary>完整课程目录<span>需要更多工具时展开</span></summary><div class="academy-all-tools">${navigationGroups.map(g=>`<section><h3>${g.title}</h3>${g.tabs.map(([id,title])=>`<button data-nav="${id}">${title} <span>↗</span></button>`).join('')}</section>`).join('')}</div></details>`;
}

function labJourney(){
 const stages=[['identify','观察识别'],['plan','通道规划'],['resources','队伍派遣'],['simulate','动态推演'],['results','评价复盘']];
 if(!stages.some(([id])=>id===page))return '';
 return `<nav class="lab-journey" aria-label="基础实验步骤">${stages.map(([id,title],i)=>`<button data-nav="${id}" class="${id===page?'active':''}" ${id===page?'aria-current="step"':''}><span>0${i+1}</span>${title}<i>→</i></button>`).join('')}</nav>`;
}
let comparisonCache=null;
function compareWorkspace(){
 if(state.assessment?.phase==='active')return '<section class="panel panel-body"><h2>当前正在决策考核</h2><p>完成考核后再使用方案比较，考核中保留独立决策过程。</p><button data-nav="assessment">返回考核</button></section>';
 if(state.ended)return '<section class="panel panel-body"><h2>本次实验已结束</h2><p>请在学习评价中复盘结果；新建实验后可再次比较方案。</p><button data-nav="results">查看学习评价</button></section>';
 const key=JSON.stringify(state);if(comparisonCache?.key!==key)comparisonCache={key,rows:['manual','cost','benefit'].map(p=>E.previewPlan(state,p))};
 const rows=comparisonCache.rows,labels={manual:'我的当前计划',cost:'低费用优先',benefit:'连通收益优先'},options=E.repairOptions(state);
 return `<section class="decision-intro"><h2>在执行前，先做一次有依据的取舍</h2><p>三个方案从当前同一状态出发，沿用相同预算、队伍、进场时间、降雨和定时事件，均推演至 T+${state.horizon} 分钟。我的计划按所设顺序优先尝试，满足条件即模拟派遣；规则参考随模拟路况重新选路。比较只读，不扣预算、不派遣、不推进当前实验。</p><span class="tag">剩余预算 ${state.budget-state.spent} 万元 · 当前 T+${state.time}</span></section><div class="three-col comparison-cards">${rows.map(r=>`<section class="panel panel-body" data-plan-preview="${r.policy}"><span class="eyebrow">${r.policy==='manual'?'YOUR DECISION':'RULE REFERENCE'}</span><h3>${labels[r.policy]}</h3><strong>${r.available}<small> / ${E.stats(state).pop} 人最终可达</small></strong><dl><div><dt>从现在新增投入</dt><dd>${r.additionalCost} 万元</dd></div><div><dt>预算结余</dt><dd>${r.remaining} 万元</dd></div><div><dt>医院 / 养老院最终可达</dt><dd>${r.urgent} / 2</dd></div><div><dt>90分钟保障达标</dt><dd>${r.timelyUrgent} / 2</dd></div><div><dt>仍不可达人口</dt><dd>${r.isolated} 人</dd></div></dl><p class="hint">实际派遣顺序：${r.sequence.join(' → ')||'没有新派遣'}${r.unexecuted.length?'<br>受预算、队伍或进场限制未执行：'+r.unexecuted.join('、'):''}</p></section>`).join('')}</div><p class="hint spaced">低费用规则优先当前可实施的低价路段；收益规则逐步权衡新增可达人口、重点设施、工期和投入。两者都随模拟状态重新判断，属于启发式参考，不是最优解或真实灾害预测。空的自定计划表示不新增派遣。</p><section class="panel spaced"><div class="panel-head"><h2>恢复过程对照</h2><small>同一时刻，比较可达人口</small></div><div class="panel-body"><div class="comparison-legend">${rows.map((r,i)=>`<span style="--curve:${['#168778','#b27a2c','#4775b5'][i]}">${labels[r.policy]}</span>`).join('')}</div><svg class="comparison-chart" viewBox="0 0 800 190" role="img" aria-label="三个方案在180分钟内基地可达人口的变化曲线"><line x1="45" y1="150" x2="760" y2="150" stroke="#456073"/><line x1="402.5" y1="20" x2="402.5" y2="150" stroke="#456073" stroke-dasharray="5 5"/><text x="6" y="26" fill="#a8bdcb" font-size="12">1520人</text>${[0,90,180].map(t=>`<text x="${45+t/180*715}" y="177" text-anchor="middle" fill="#a8bdcb" font-size="12">${t}分钟</text>`).join('')}${rows.map((r,i)=>`<polyline points="${r.timeline.map(t=>`${45+t.time/180*715},${150-t.available/1520*125}`).join(' ')}" fill="none" stroke="${['#168778','#b27a2c','#4775b5'][i]}" stroke-width="2.5" ${i===1?'stroke-dasharray="7 4"':i===2?'stroke-dasharray="3 3"':''}/>`).join('')}</svg><p class="hint">竖虚线为90分钟保障目标；即使最终可达人口相同，恢复时刻和投入也可能不同。</p></div></section><section class="panel spaced"><div class="panel-head"><h2>每条路，为什么值得修？</h2><button data-nav="plan">返回调整计划</button></div><div class="table-wrap"><table><thead><tr><th>路段</th><th>费用 / 作业工期</th><th>单路抢通新增可达</th><th>新增重点设施</th><th>当前实施条件</th></tr></thead><tbody>${options.map(o=>`<tr><td>${o.id}</td><td>${o.cost} 万元 / ${o.work} 分钟</td><td>${o.gain} 人</td><td>${o.urgent} 处</td><td>${o.feasible?'队伍、进场与预算允许':esc(o.reason||'暂不可实施')}</td></tr>`).join('')||'<tr><td colspan="5">当前没有待抢通的空闲路段。</td></tr>'}</tbody></table></div><div class="panel-body"><p class="hint">单路收益是假设只修好该路后的连通性变化，不包含作业耗时；零收益可能是后续通道所需的前置路段。实际结果以上方完整时间预演为准。</p></div></section>`;
}
// Student-authored challenges and persistent counterfactual experiment branches.
const LearningStudio=(()=>{
 const STORE='flood-learning-studio-v1',DRAFT='flood-challenge-draft-v1';
 const uid=p=>p+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
 const copy=E.clone,now=()=>new Date().toISOString();
 const conditions=s=>JSON.stringify([s.scenario,s.rain,s.budget,s.initial,s.challenge||null]);
 const sameConditions=(a,b)=>conditions(a)===conditions(b);
 const locked=()=>state.assessment?.phase==='active';
 const btn=(text,action,attrs='',cls='')=>`<button type="button" class="${cls}" data-studio="${action}" ${attrs}>${text}</button>`;
 let store={version:1,groups:[]},draft,checked=null,pending=null;
 function validateGroup(raw){
  if(!raw||typeof raw.id!=='string'||!/^[-\w]{1,80}$/.test(raw.id)||!Array.isArray(raw.points)||raw.points.length>24||!Array.isArray(raw.branches)||raw.branches.length>4)throw new Error('复盘记录格式错误');
  const original=E.validate(raw.original);if(original.learningId!==raw.id||original.learningBranch||original.assessment?.phase==='active')throw new Error('原实验记录不正确');
  const text=(v,max)=>typeof v==='string'&&v.length<=max;
  const points=raw.points.map(p=>{if(!p||typeof p.id!=='string'||!/^[-\w]{1,80}$/.test(p.id)||!text(p.label,80)||!text(p.at,40)||(p.pinned!==undefined&&typeof p.pinned!=='boolean'))throw new Error('决策点格式错误');const s=E.validate(p.state);if(s.learningId!==raw.id||s.assessment?.phase==='active')throw new Error('决策点不属于此实验');return {id:p.id,label:p.label,at:p.at,state:s,pinned:!!p.pinned};});
  const branches=raw.branches.map(b=>{if(!b||typeof b.id!=='string'||!/^[-\w]{1,80}$/.test(b.id)||!text(b.name,60)||!b.name.trim()||!text(b.reason,1000)||b.reason.trim().length<10)throw new Error('分支说明不正确');const baseline=E.validate(b.baseline),s=E.validate(b.state);if(s.learningId!==raw.id||baseline.learningId!==raw.id||s.learningBranch!==b.id||s.assessment?.phase==='active'||baseline.assessment?.phase==='active'||!sameConditions(s,baseline)||!sameConditions(s,original))throw new Error('分支与原实验的条件不一致');return {id:b.id,name:b.name,reason:b.reason,baseline,state:s};});
  if(new Set(points.map(p=>p.id)).size!==points.length||new Set(branches.map(b=>b.id)).size!==branches.length)throw new Error('复盘编号重复');
  if(raw.reflection!==undefined&&!text(raw.reflection,3000))throw new Error('复盘结论过长');
  return {id:raw.id,original,points,branches,reflection:raw.reflection||''};
 }
 try{const raw=JSON.parse(localStorage.getItem(STORE)||'null');if(raw){if(raw.version!==1||!Array.isArray(raw.groups)||raw.groups.length>3)throw new Error();store={version:1,groups:raw.groups.map(validateGroup)};}}catch{store={version:1,groups:[]};}
 if(!state.learningId)state.learningId=uid('lab');
 if(state.learningBranch&&!store.groups.some(g=>g.id===state.learningId&&g.branches.some(b=>b.id===state.learningBranch))){state.learningId=uid('lab');delete state.learningBranch;delete state.learningConditionsLocked;}
 function group(data=store,s=state){let g=data.groups.find(g=>g.id===s.learningId);if(!g){const original=copy(s);delete original.learningBranch;g={id:s.learningId,original,points:[],branches:[],reflection:''};data.groups.push(g);if(data.groups.length>3)data.groups.shift();}return g;}
 function save(next,saveExperiment=false){let oldStore=null,oldState=null,read=false;try{oldStore=localStorage.getItem(STORE);oldState=localStorage.getItem(KEY);read=true;localStorage.setItem(STORE,JSON.stringify(next));if(saveExperiment)localStorage.setItem(KEY,JSON.stringify(state));store=next;return true;}catch{if(read)try{if(oldStore===null)localStorage.removeItem(STORE);else localStorage.setItem(STORE,oldStore);if(saveExperiment){if(oldState===null)localStorage.removeItem(KEY);else localStorage.setItem(KEY,oldState);}}catch{}toast('复盘存储不可用或空间不足；本次未能保存复盘。可用时请先导出记录。');return false;}}
 function signature(s){return JSON.stringify([s.time,s.spent,s.plan,s.crews,s.edges,s.identification,s.ended,s.rain,s.budget,s.predictions||[]]);}
 function capture(label='',force=false){
  if(locked())return true;
  state=prepareState(state);
  const next=copy(store),g=group(next),branch=g.branches.find(b=>b.id===state.learningBranch);
  if(branch)branch.state=copy(state);else if(!state.learningBranch)g.original=copy(state);
  const previous=[...g.points].reverse().find(p=>(p.state.learningBranch||'')===(state.learningBranch||''));
  if(force||!previous||signature(previous.state)!==signature(state)){
   if(g.points.length>=24){const removable=g.points.findIndex((p,i)=>i>0&&!p.pinned);if(removable>=0)g.points.splice(removable,1);else if(force){toast('手动保留的决策点已满，请先导出并删除一个旧点。');return false;}}
   if(g.points.length<24)g.points.push({id:uid('point'),label:label||`T+${state.time} · 投入${state.spent}万元`,at:now(),state:copy(state),pinned:force});
  }
  return save(next,true);
 }
 function activate(s,next){
  const validated=E.validate(s),g=group(next,validated);
  if(!g.points.length)g.points.push({id:uid('point'),label:'实验起点',at:now(),state:copy(validated)});
  const oldStore=localStorage.getItem(STORE),oldState=localStorage.getItem(KEY);
  try{localStorage.setItem(STORE,JSON.stringify(next));localStorage.setItem(KEY,JSON.stringify(validated));}
  catch{try{if(oldStore===null)localStorage.removeItem(STORE);else localStorage.setItem(STORE,oldStore);if(oldState===null)localStorage.removeItem(KEY);else localStorage.setItem(KEY,oldState);}catch{}toast('切换失败：存储空间不足，当前实验没有被替换。');return false;}
  stop();store=next;state=validated;routeView=null;comparisonCache=null;return true;
 }
 function branchPage(){
  if(locked())return '<section class="panel panel-body"><h2>考核期间不开放分支复盘</h2><p>先完成当前考核，再进行对照学习。</p></section>';
  const g=group(),live=state.learningBranch?g.branches.find(b=>b.id===state.learningBranch):null;
  const routes=[{name:'原实验',state:state.learningBranch?g.original:state},...g.branches.map(b=>({name:b.name,state:b.id===state.learningBranch?state:b.state}))];
  const results=routes.map(r=>{const s=copy(r.state);s.ended=false;delete s.assessment;return {...r,preview:E.previewPlan(s,'manual')};});
  return `<section class="learning-hero"><span class="eyebrow">COUNTERFACTUAL LAB / 分支复盘</span><h2>回到关键时刻，换一种选择试试</h2><p>从保存的决策点复制分支，继承该时刻的路况、队伍、已投入费用和进度。可以改变后续计划与派遣，原实验独立保存；分支的预算、降雨和道路初始条件保持一致。</p><div class="actions">${btn('保存当前决策点','checkpoint','','primary')}${live?btn('返回原实验','return'):''}${btn('导出本组复盘','export-branches')}${btn('导入复盘记录','pick-branches')}</div><input type="file" data-studio-import="branches" accept="application/json,.json" hidden><p class="hint">当前：${live?'分支「'+esc(live.name)+'」':'原实验'} · 本机保留最近3组实验，每组最多24个决策点和4个分支；手动命名点优先保留，重要记录请导出。</p></section><div class="two-col studio-columns"><section class="panel"><div class="panel-head"><h2>已保存的决策点</h2><span class="tag">${g.points.length} 个</span></div><div class="panel-body studio-points">${[...g.points].reverse().map(p=>`<article><div><b>${esc(p.label)}</b><small>${p.pinned?'手动保留 · ':''}T+${p.state.time} · ${p.state.spent}万元已投入 · ${p.state.learningBranch?'分支记录':'原实验记录'}</small></div>${btn('从这里新建分支','fork',`data-id="${p.id}" ${p.state.ended||g.branches.length>=4||!sameConditions(p.state,g.original)?'disabled':''}`)}${p.id!==g.points[0]?.id?btn('删除点','delete-point',`data-id="${p.id}"`,'small subtle'):''}</article>`).join('')}<p class="hint">只有未结束且与当前原实验条件一致的点可以复制。自动记录规划、派遣和时间变化；可另存一个有名称的关键点。</p></div></section><section class="panel"><div class="panel-head"><h2>我的分支</h2></div><div class="panel-body">${g.branches.map(b=>`<article class="studio-branch"><div class="row"><h3>${esc(b.name)}</h3><span class="tag">起点 T+${b.baseline.time}</span></div><p>${esc(b.reason)}</p><p class="hint">实际进度 T+${b.state.time} · 已投入 ${b.state.spent} 万元 · 可达 ${E.stats(b.state).available} 人</p><div class="actions">${btn(b.id===state.learningBranch?'正在此分支':'进入分支','switch',`data-id="${b.id}" ${b.id===state.learningBranch?'disabled':''}`,'primary')}${btn('删除此分支','delete',`data-id="${b.id}"`,'danger')}</div></article>`).join('')||'<p class="hint">先保存决策点，再写下“准备改变什么、为什么”，复制出第一条分支。</p>'}</div></section></div><section class="panel spaced"><div class="panel-head"><h2>统一到180分钟的只读对照</h2></div><div class="panel-body"><p class="hint">不同实际时刻不能直接当作成绩比较。以下克隆各路线的当前进度，按其剩余计划模拟至180分钟；包含已走过的历史，不替你执行、不覆盖原实验，不是正式考试评分。</p></div><div class="table-wrap"><table><thead><tr><th>路线</th><th>实际进度</th><th>实际投入</th><th>预演最终可达</th><th>预演总投入</th><th>预演90分钟保障</th>${state.challenge?'<th>预演题目目标</th>':''}</tr></thead><tbody>${results.map(r=>`<tr><td>${esc(r.name)}</td><td>T+${r.state.time}</td><td>${r.state.spent} 万元</td><td>${r.preview.available} / 1520 人</td><td>${r.preview.spent} 万元</td><td>${r.preview.timelyUrgent} / 2</td>${r.state.challenge?`<td>${E.challengeResult({challenge:r.state.challenge,time:180,timeline:r.preview.timeline}).passed?'达到题目目标':'未达到题目目标'}</td>`:''}</tr>`).join('')}</tbody></table></div><div class="panel-body actions"><button data-nav="plan">调整当前路线的计划 →</button><button data-nav="simulate">继续当前路线的推演 →</button></div></section><section class="panel spaced"><div class="panel-head"><h2>我从两条路线的差异中学到了什么？</h2></div><div class="panel-body"><label class="field">比较恢复时刻、费用、目标达成和下一次改进<textarea id="studio-reflection" maxlength="3000" rows="5" placeholder="写清哪次选择改变了结果，证据是什么，下一次准备怎么做。">${esc(g.reflection||'')}</textarea></label><p class="hint">保留你的解释供教师或同伴讨论，不按字数自动评价论证质量。</p>${btn('保存对照结论','save-reflection','','primary')}</div></section>`;
 }
 function draftFrom(s){const base=s.initial?.edges||s.edges;return {kind:'flood-student-challenge',version:1,id:uid('challenge'),title:'我设计的交通孤岛挑战',author:state.student||'',objective:'解释有限预算下抢通顺序与人口可达、重点保障之间的取舍。',brief:'请先识别交通孤岛，设计抢通计划，在目标时刻检验结果，并说明你选择这些道路的理由。',scenario:s.scenario,rain:s.initial?.rain??s.rain,budget:s.initial?.budget??s.budget,goal:{population:1200,deadline:90,maxSpent:Math.min(30,s.initial?.budget??s.budget)},roads:base.map(e=>({id:e.id,depth:e.depth,damage:e.damage,cost:e.cost,work:e.work})),event:copy(s.challenge?s.challenge.event:E.scenarios.find(x=>x.id===s.scenario).event)};}
 try{const raw=JSON.parse(localStorage.getItem(DRAFT)||'null');if(raw&&Array.isArray(raw.roads)&&raw.roads.length===17)draft=raw;}catch{}
 if(!draft)draft=draftFrom(E.create());
 function saveDraft(value){draft=value;checked=null;const status=document.querySelector('#studio-trial-status');if(status)status.innerHTML=trialStatus();try{localStorage.setItem(DRAFT,JSON.stringify(draft));return true;}catch{toast('出题草稿尚未保存，请导出挑战题。');return false;}}
 const field=(label,html)=>`<label class="field">${label}${html}</label>`;
 const input=(name,value,attrs='')=>`<input name="${name}" value="${esc(value)}" ${attrs}>`;
 function trialStatus(){if(state.challenge?.id!==draft.id)return '';try{const same=JSON.stringify(E.validateChallenge(draft))===JSON.stringify(state.challenge),r=E.challengeResult(state);return `<div class="notice">${same?`本题当前试做：T+${state.time}，投入${state.spent}万元。${r.evaluated?(r.passed?'已达到题目目标。':'尚未达到题目目标。'):'还未到目标验证时刻。'} <button data-nav="simulate" type="button">继续试做 →</button>`:'草稿已修改，当前试做不对应新条件；请重新开始一轮试做验证。'}</div>`;}catch{return '<p class="hint">草稿条件尚不完整，请检查后重新试做。</p>';}}
 function challengePage(){
  if(locked())return '<section class="panel panel-body"><h2>请先完成当前考核</h2><p>考核结束后可设计和试做学生挑战题。</p></section>';
  const d=draft;
  return `<section class="decision-intro"><span class="eyebrow">STUDENT AS DESIGNER / 学生出题</span><h2>把你想考查的决策，设计成一道挑战题</h2><p>先写学习目标，再编辑当前教学路网的积水、阻断、道路费用和工期。设置预算、动态事件与可检验目标，试做后导出JSON，别人可在此导入并独立作答。</p><div class="actions">${btn('从当前初始条件复制','from-current')}${btn('导入别人出的题','pick-challenge')}<label class="inline-label">情景模板<select id="studio-template">${E.scenarios.map(s=>`<option value="${s.id}" ${s.id===d.scenario?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label>${btn('采用此模板','template')}</div><input type="file" data-studio-import="challenge" accept="application/json,.json" hidden></section><div id="studio-trial-status">${trialStatus()}</div><form id="studio-challenge-form"><section class="panel"><div class="panel-head"><h2>题目与学习目标</h2><span class="tag">草稿独立保存</span></div><div class="panel-body form-grid">${field('挑战题名称',input('title',d.title,'maxlength="80" required'))}${field('出题人 / 小组',input('author',d.author,'maxlength="60"'))}${field('希望同学学会什么',`<textarea name="objective" minlength="10" maxlength="1000" required>${esc(d.objective)}</textarea>`)}${field('给作答者的任务说明',`<textarea name="brief" minlength="10" maxlength="2000" required>${esc(d.brief)}</textarea>`)}</div></section><section class="panel spaced"><div class="panel-head"><h2>条件与达标目标</h2></div><div class="panel-body form-grid">${field('总预算（20—200万元）',input('budget',d.budget,'type="number" min="20" max="200" step="1" required'))}${field('降雨（0—150 mm/h）',input('rain',d.rain,'type="number" min="0" max="150" step="1" required'))}${field('目标时刻（5—180分钟）',input('deadline',d.goal?.deadline,'type="number" min="5" max="180" step="1" required'))}${field('该时刻至少可达人数（1—1520）',input('population',d.goal?.population,'type="number" min="1" max="1520" step="1" required'))}${field('该时刻累计投入上限（万元）',input('maxSpent',d.goal?.maxSpent,'type="number" min="0" max="200" step="1" required'))}<div class="field"><label class="inline-label"><input type="checkbox" name="eventEnabled" ${d.event?'checked':''}>设置一次动态阻断</label><div class="form-grid">${field('发生时刻',input('eventAt',d.event?.at??30,'type="number" min="1" max="179" step="1"'))}${field('阻断路段',`<select name="eventEdge">${E.edges.map(e=>`<option value="${e.id}" ${e.id===(d.event?.edge||'B1')?'selected':''}>${e.id}</option>`).join('')}</select>`)}</div></div></div></section><details class="teaching-road-details spaced"><summary>编辑17条教学道路：积水、阻断、费用和工期</summary><div class="table-wrap"><table><thead><tr><th>路段 / 连接</th><th>积水 m</th><th>结构阻断</th><th>费用 万元</th><th>作业工期 分钟</th></tr></thead><tbody>${E.edges.map(e=>{const r=d.roads.find(r=>r.id===e.id)||e;return `<tr data-studio-road="${e.id}"><td>${e.id} · ${names(e.a)} / ${names(e.b)}</td><td>${input('depth-'+e.id,r.depth,'type="number" min="0" max="2" step="0.01" required aria-label="'+e.id+' 积水"')}</td><td><input name="damage-${e.id}" type="checkbox" ${r.damage?'checked':''} aria-label="${e.id} 阻断"></td><td>${input('cost-'+e.id,r.cost,'type="number" min="1" max="50" step="1" required aria-label="'+e.id+' 费用"')}</td><td>${input('work-'+e.id,r.work,'type="number" min="5" max="120" step="1" required aria-label="'+e.id+' 工期"')}</td></tr>`;}).join('')}</tbody></table></div></details><p class="hint spaced">编辑的是固定12节点、17条边的教学模型，不修改徐州真实城市道路。作答开始后条件锁定；每次试做都从同一份题目条件独立开始。</p><div class="studio-author-actions">${btn('检查题目与参考可行性','challenge-check','','primary')}${btn('作者试做 / 开始挑战','challenge-start')}${btn('导出挑战题 JSON','challenge-export')}</div></form>${checked?`<section class="panel spaced" id="studio-check-result"><div class="panel-head"><h2>题目检查结果</h2></div><div class="panel-body"><p>${esc(checked.message)}</p><p class="hint">检查只验证数据范围，并尝试两条规则参考。参考失败不代表无解；作者应自行试做和解释设计意图。导出的题目不包含学生操作记录，也没有隐藏标准答案。</p></div></section>`:''}`;
 }
 function readForm(){const form=document.querySelector('#studio-challenge-form');if(!form)return draft;const f=new FormData(form),n=k=>Number(f.get(k)),t=k=>String(f.get(k)||'');return {...draft,title:t('title'),author:t('author'),objective:t('objective'),brief:t('brief'),rain:n('rain'),budget:n('budget'),goal:{population:n('population'),deadline:n('deadline'),maxSpent:n('maxSpent')},roads:E.edges.map(e=>({id:e.id,depth:n('depth-'+e.id),damage:f.has('damage-'+e.id)?1:0,cost:n('cost-'+e.id),work:n('work-'+e.id)})),event:f.has('eventEnabled')?{at:n('eventAt'),edge:t('eventEdge')}:null};}
 function validDraft(){const value=E.validateChallenge(readForm());saveDraft(value);return value;}
 function checkChallenge(){try{const ch=validDraft(),s=E.createChallengeState(ch),before=E.stats(s),results=['cost','benefit'].map(policy=>{const r=E.previewPlan(s,policy),at=[...r.timeline].reverse().find(t=>t.time<=ch.goal.deadline);return at.available>=ch.goal.population&&at.spent<=ch.goal.maxSpent;});checked={message:`数据合法。当前初始可达${before.available}人，${before.groups.length}个交通孤岛。两条规则参考中${results.filter(Boolean).length}条达到目标。${before.available>=ch.goal.population?'目标人口在起点已达到，请检查是否符合你的学习目标。':''}`};render();document.querySelector('#studio-check-result')?.scrollIntoView({block:'center'});}catch(e){toast(e.message);}}
 function banner(){if(FloodCommandUI.isPage(page))return '';const g=store.groups.find(g=>g.id===state.learningId),b=g?.branches.find(b=>b.id===state.learningBranch);let html=b?`<section class="studio-context"><div><b>正在操作分支：${esc(b.name)}</b><small>起点 T+${b.baseline.time} · 原实验独立保留，实验条件已锁定。</small></div>${btn('返回原实验','return')}</section>`:'';if(state.challenge){const ch=state.challenge,r=E.challengeResult(state);html+=`<section class="studio-context challenge-context"><div><b>学生挑战：${esc(ch.title)}</b><small>T+${ch.goal.deadline} 时可达不少于${ch.goal.population}人，累计投入不超过${ch.goal.maxSpent}万元。</small><p>${esc(ch.brief)}</p><span class="tag">${r.evaluated?(r.passed?'目标已达成':'目标未达成'):(state.ended?'提前结束，未到验证时刻':'尚未到验证时刻')} ${r.evaluated?`· 当时可达${r.available}人 / 投入${r.spent}万元`:''}</span></div>${btn('重新试做此题','challenge-restart',b?'disabled':'')}</section>`;}if(!b&&!state.challenge&&state.learningConditionsLocked)html+=`<section class="studio-context original-context"><div><b>当前为原实验</b><small>初始条件已锁定，便于同条件复盘；可继续调整计划与派遣。更换条件请另建实验。</small></div><button data-nav="branch-lab">查看分支对照</button></section>`;return html;}
 function startChallenge(ch){pending={kind:'challenge',value:ch};stop();modal(`<h2>开始独立挑战</h2><p>当前教学实验将先保存到实验记录。新挑战从T+0开始，按题目条件锁定预算、路况与费用。</p><p><b>${esc(ch.title)}</b><br>T+${ch.goal.deadline} · 至少${ch.goal.population}人可达 · 投入不超过${ch.goal.maxSpent}万元</p>${btn('保存当前实验并开始','confirm-start','','primary')}`);}
 async function action(el){
  const kind=el.dataset.studio,id=el.dataset.id;
  if(locked()){toast('请先完成当前考核，再使用出题和分支功能。');return;}
  try{
   if(kind==='checkpoint'){stop();modal(`<h2>保存当前决策点</h2><p>此刻为T+${state.time}，已投入${state.spent}万元；暂停自动推演后保存。</p><label class="field">名称<input id="studio-point-label" maxlength="80" value="T+${state.time} · 我准备作出新的选择"></label>${btn('保存决策点','confirm-point','','primary')}`);}
   if(kind==='confirm-point'){if(capture(document.querySelector('#studio-point-label').value.trim()||'关键决策点',true)){document.querySelector('#dialog').close();navigate('branch-lab');toast('决策点已保存。');}}
   if(kind==='save-reflection'){const value=document.querySelector('#studio-reflection').value.trim();if(value.length>3000){toast('复盘结论不超过3000字。');return;}const next=copy(store);group(next).reflection=value;if(save(next))toast('分支对照结论已保存，会随复盘JSON和实验报告导出。');}
   if(kind==='fork'){stop();const p=group().points.find(p=>p.id===id);if(!p||p.state.ended||!sameConditions(p.state,group().original)||group().branches.length>=4)return;modal(`<h2>从T+${p.state.time}创建分支</h2><p>路况、已投入费用、作业中队伍和进度全部继承，只改变之后的决策。</p><label class="field">分支名称<input id="studio-branch-name" maxlength="60" value="换一种抢通顺序"></label><label class="field spaced">我准备改变什么，为什么？<textarea id="studio-branch-reason" minlength="10" maxlength="1000" placeholder="例如：先抢通西侧进场道路，再比较人口恢复和重点设施保障。"></textarea></label>${btn('创建并进入分支','confirm-fork',`data-id="${id}"`,'primary')}`);}
   if(kind==='confirm-fork'){const name=document.querySelector('#studio-branch-name').value.trim(),reason=document.querySelector('#studio-branch-reason').value.trim();if(!name||name.length>60||reason.length<10||reason.length>1000){toast('请填写60字以内名称和10—1000字的改变理由。');return;}if(!capture())return;const next=copy(store),g=group(next),p=g.points.find(p=>p.id===id);if(!p||p.state.ended||g.branches.length>=4||!sameConditions(p.state,g.original))return;const bid=uid('branch'),s=copy(p.state);s.learningBranch=bid;g.original.learningConditionsLocked=true;g.branches.push({id:bid,name,reason,baseline:copy(p.state),state:copy(s)});if(activate(s,next)){document.querySelector('#dialog').close();navigate('plan');toast('已进入新分支；原实验没有被覆盖。');}}
   if(kind==='switch'||kind==='return'){if(!capture())return;const next=copy(store),g=group(next),s=kind==='return'?g.original:g.branches.find(b=>b.id===id)?.state;if(s&&activate(s,next)){navigate('branch-lab');toast(kind==='return'?'已返回原实验。':'已进入所选分支。');}}
   if(kind==='delete'){if(state.learningBranch===id){toast('先返回原实验，再删除这个分支。');return;}modal(`<h2>删除这个分支？</h2><p>原实验与其他分支保留。需要保留此分支时，请先导出本组复盘记录。</p>${btn('确认删除分支','confirm-delete',`data-id="${id}"`,'danger')}`);}
   if(kind==='confirm-delete'){const next=copy(store),g=group(next);g.branches=g.branches.filter(b=>b.id!==id);g.points=g.points.filter(p=>p.state.learningBranch!==id);if(save(next)){document.querySelector('#dialog').close();render();}}
   if(kind==='delete-point'){const g=group();if(g.points[0]?.id===id)return;modal(`<h2>删除这个决策点？</h2><p>只删除快照列表中的这个点，不影响当前实验，也不影响已经从它创建的分支。</p>${btn('确认删除决策点','confirm-delete-point',`data-id="${id}"`,'danger')}`);}
   if(kind==='confirm-delete-point'){const next=copy(store),g=group(next);if(g.points[0]?.id!==id)g.points=g.points.filter(p=>p.id!==id);if(save(next)){document.querySelector('#dialog').close();render();}}
   if(kind==='export-branches'){if(capture())download('交通孤岛分支复盘.json',JSON.stringify({kind:'flood-branch-workspace',version:1,group:group()},null,2),'application/json');}
   if(kind==='pick-branches')document.querySelector('[data-studio-import=branches]').click();
   if(kind==='pick-challenge')document.querySelector('[data-studio-import=challenge]').click();
   if(kind==='from-current'||kind==='template'){pending={kind:'draft',value:kind==='template'?draftFrom(E.create(document.querySelector('#studio-template').value)):draftFrom(state)};modal(`<h2>替换出题草稿？</h2><p>只改变草稿，当前正在进行的教学实验保持不变。原草稿需要保留时，请先导出。</p>${btn('采用这些初始条件','confirm-draft','','primary')}`);}
   if(kind==='confirm-draft'&&pending?.kind==='draft'){saveDraft(pending.value);pending=null;document.querySelector('#dialog').close();render();}
   if(kind==='challenge-check')checkChallenge();
   if(kind==='challenge-export'){const ch=validDraft();download(ch.title.replace(/[\\/:*?"<>|]/g,'_')+'.json',JSON.stringify(ch,null,2),'application/json');toast('已导出挑战题，未包含当前作答记录。');}
   if(kind==='challenge-start')startChallenge(validDraft());
   if(kind==='challenge-restart'&&state.challenge&&!state.learningBranch)startChallenge(E.validateChallenge(state.challenge));
   if(kind==='confirm-start'&&pending?.kind==='challenge'){if(!capture()||!archive())return;const s=E.createChallengeState(pending.value),next=copy(store);if(activate(s,next)){pending=null;document.querySelector('#dialog').close();navigate('identify');toast('已开始新一轮学生挑战。');}}
   if(kind==='confirm-reset-branch'&&pending?.kind==='reset-branch'){if(!capture())return;const next=copy(store),g=group(next),b=g.branches.find(b=>b.id===pending.id);if(b){const s=copy(b.baseline);s.learningBranch=b.id;b.state=copy(s);g.points=g.points.filter(p=>p.state.learningBranch!==b.id);if(activate(s,next)){pending=null;document.querySelector('#dialog').close();navigate('plan');toast('当前分支已回到它的决策起点。');}}}
   if(kind==='confirm-import'&&pending?.kind==='branches'){if(!capture()||!archive())return;const g=copy(pending.value),newId=uid('lab');g.id=newId;g.original.learningId=newId;for(const p of g.points)p.state.learningId=newId;for(const b of g.branches){b.state.learningId=newId;b.baseline.learningId=newId;}const next=copy(store);next.groups.push(g);if(next.groups.length>3)next.groups.shift();if(activate(g.original,next)){pending=null;document.querySelector('#dialog').close();navigate('branch-lab');toast('已作为独立实验导入，不覆盖原来的复盘组。');}}
  }catch(error){toast(error.message||'操作未完成，请检查输入。');}
 }
 document.addEventListener('click',event=>{const el=event.target.closest('[data-studio]');if(!el||el.disabled)return;event.preventDefault();event.stopImmediatePropagation();action(el);});
 document.addEventListener('submit',event=>{if(event.target.id==='studio-challenge-form'){event.preventDefault();checkChallenge();}});
 document.addEventListener('input',event=>{if(event.target.closest('#studio-challenge-form'))saveDraft(readForm());});
 document.addEventListener('change',async event=>{if(event.target.closest('#studio-challenge-form'))saveDraft(readForm());const type=event.target.dataset.studioImport;if(!type)return;const file=event.target.files?.[0];if(!file)return;try{if(file.size>2*1024*1024)throw new Error('文件不能超过2MB');const raw=JSON.parse(await file.text());if(locked())throw new Error('考核期间不能导入学习实验');if(type==='challenge'){saveDraft(E.validateChallenge(raw));navigate('challenge-lab');toast('已载入出题草稿；当前作答实验保持不变。');}else{if(raw.kind!=='flood-branch-workspace'||raw.version!==1)throw new Error('请选择分支复盘JSON文件');pending={kind:'branches',value:validateGroup(raw.group)};modal(`<h2>导入分支复盘实验</h2><p>当前教学实验将先保存，导入内容作为独立实验打开，不覆盖本机已有的复盘组。</p>${btn('保存当前实验并导入','confirm-import','','primary')}`);}}catch(error){toast(error instanceof SyntaxError?'文件不是有效JSON':error.message);}event.target.value='';});
 capture('实验起点');
 function requestReset(){const g=group(),b=g.branches.find(b=>b.id===state.learningBranch);if(b){stop();pending={kind:'reset-branch',id:b.id};modal(`<h2>重置当前分支？</h2><p>本分支将回到T+${b.baseline.time}的起点，覆盖本分支之后的操作。原实验和其他分支保留。需要保留进度时请先导出复盘。</p>${btn('确认重置此分支','confirm-reset-branch','','primary')}`);return true;}if(state.challenge){startChallenge(E.validateChallenge(state.challenge));return true;}return false;}
 function reportContext(){const g=store.groups.find(g=>g.id===state.learningId),b=g?.branches.find(b=>b.id===state.learningBranch);let html=b?`<h2>分支来源与假设</h2><p>分支：${esc(b.name)}；从T+${b.baseline.time}继承已投入${b.baseline.spent}万元和当时路况、队伍。</p><p>我准备改变什么，为什么：${esc(b.reason)}</p>`:'';if(state.challenge){const ch=state.challenge,r=E.challengeResult(state);html+=`<h2>学生挑战任务</h2><p>题目：${esc(ch.title)}；出题人：${esc(ch.author||'未署名')}</p><p>学习目标：${esc(ch.objective)}<br>任务说明：${esc(ch.brief)}</p><p>要求T+${ch.goal.deadline}时可达不少于${ch.goal.population}人、投入不超过${ch.goal.maxSpent}万元。${r.evaluated?`实际目标时刻可达${r.available}人、投入${r.spent}万元；${r.passed?'达到目标':'未达到目标'}。`:'尚未到目标时刻，不作达标结论。'}</p>`;}if(g?.reflection)html+=`<h2>分支对照结论</h2><p>${esc(g.reflection)}</p>`;return html;}
 function prepareState(s){const g=store.groups.find(g=>g.id===s.learningId),b=g?.branches.find(b=>b.id===s.learningBranch);if((s.learningBranch&&(!b||!sameConditions(s,b.baseline)))||(g?.branches.length&&!sameConditions(s,g.original))){const independent=copy(s);independent.learningId=uid('lab');delete independent.learningBranch;delete independent.learningConditionsLocked;toast('没有匹配的复盘条件，快照已作为独立实验载入；原复盘组保留。');return independent;}return s;}
 return {capture,branchPage,challengePage,banner,validateGroup,requestReset,reportContext,prepareState};
})();

const DecisionReviewUI=(()=>{
 const pct=n=>Number(n).toFixed(1).replace(/\.0$/,'');
 function rules(){return `<div class="notice">评价规则第2版：自动项85分＋教师或同伴点评15分。知识检查和初始识别保留为学习反馈，不单独累加到新版总分。相同情景、参数和目标下比较表现。</div><div class="table-wrap spaced"><table><thead><tr><th>维度</th><th>满分</th><th>规则</th></tr></thead><tbody><tr><td>通道恢复成效</td><td>35</td><td>相对基线与目标的新增恢复比例×25；目标验证通过另计10。</td></tr><tr><td>救援保障时效</td><td>30</td><td>目标完成时间20：20×(1−0.75×首次达标时刻/目标截止时刻)，未确认达标为0。医院与养老院各5：90分钟内且评价时点可达为5，90—180分钟线性递减至0。</td></tr><tr><td>资源配置效率</td><td>20</td><td>预算效率10＝10×恢复比例×(1−0.3×累计投入/总预算)，未投入为0。已完成作业投入率×恢复比例×5；有效派遣率×恢复比例×5。没有完整台账不推测后两项。</td></tr><tr><td>决策解释与改进</td><td>15</td><td>依据与证据、结果分析、方案改进各0—5分，由教师或同伴填写依据。未点评显示待完成，不按字数或预测准确度自动给分。</td></tr></tbody></table></div><p class="hint spaced">基础目标：180分钟内全部${E.stats(state).pop}人所在区域恢复基地可达，累计投入不超预算。学生题按题目规定的时刻、人口与投入目标评价，未到目标时刻不作达标结论。首次达标时刻来自逐分钟记录；目标之后再次失守时，普通实验需重新恢复当前目标才计完成时间项。倍速和现实等待不改变成绩。已完成作业投入率＝已完成派遣费用/全部成功派遣费用；有效派遣率＝成功派遣次数/全部尝试次数。新考核仍在T+180统一结算，避免跳过后续事件。</p>`;}
 function target(r){return `<section class="decision-goal"><div><small>本次目标 · 规则第2版</small><b>T+${r.goal.deadline} 内可达至少 ${r.goal.population} 人，累计投入 ≤ ${r.goal.maxSpent} 万元</b><p>评价取T+${r.goal.observedAt}记录；${state.challenge?'题目在指定时刻验证':'普通实验同时检查当前目标是否仍达成'}。</p></div><div><small>目标首次完成时间</small><strong>${r.goal.completionTime===null?'尚未确认':`T+${r.goal.completionTime} 分钟`}</strong><p>${r.goal.confirmed?'已确认达标；结束按钮的点击时间不作为完成时间。':'未确认达标时，完成时间项为0分。'}</p></div>${r.goal.initiallyMet?'<p class="student-warning">该题目标人口在起点已满足，请检查题目难度；不同目标的分数不直接横向排名。</p>':''}</section>`;}
 function reviewForm(r){const saved=state.decisionReview,ratings=saved?.ratings||{};return `<section class="panel spaced"><div class="panel-head"><h2>教师或同伴点评 · 15分</h2><span class="tag">${r.manualPending?'待点评':'已点评'}</span></div><div class="panel-body"><p class="hint">结合学生的预测理由、操作时间线、分支比较和复盘作出评价。每项：0分未提供；1—2分笼统；3—4分有具体依据；5分能结合证据说明取舍。这里只记录点评，不自动判断文字质量。</p>${!state.ended?'<div class="notice">当前是过程评价。请先结束实验或完成考核，再提交点评。</div>':''}${saved&&!r.manualPending?`<p class="hint">点评人：${esc(saved.reviewer)} · ${esc(saved.comment)}</p>`:''}<form id="decision-review-form"><fieldset ${state.ended?'':'disabled'}><div class="form-grid"><label class="field">点评人 / 小组<input name="reviewer" maxlength="60" required value="${esc(saved?.reviewer||'')}" placeholder="教师或同伴姓名 / 小组"></label>${[['evidence','依据与证据'],['analysis','结果分析'],['improvement','方案改进']].map(([key,label])=>`<label class="field">${label}（0—5）<input name="${key}" type="number" min="0" max="5" step="1" required value="${ratings[key]??''}"></label>`).join('')}</div><label class="field spaced">评分依据与建议<textarea name="comment" minlength="10" maxlength="2000" rows="4" required placeholder="结合具体道路、恢复时刻、投入或对照证据说明，至少10字。">${esc(saved?.comment||'')}</textarea></label><button class="primary spaced" type="submit">保存点评并更新总评</button></fieldset></form><p class="hint spaced">这是本机教学点评记录。修改实验或复盘内容后，原点评会标为待重新确认。</p></div></section>`;}
 function results(r,exam=false){return `${target(r)}<div class="workspace"><section class="panel"><div class="panel-head"><h2>决策成效评价</h2><button class="small" data-action="rubric">计算规则</button></div><div class="panel-body score-bars">${r.rows.map(v=>`<div><div class="row"><span>${v.name}</span><b>${v.score===null?'待点评':v.score} / ${v.max}</b></div><progress value="${v.score??0}" max="${v.max}"></progress><p class="hint">${esc(v.reason)}</p></div>`).join('')}</div></section><aside class="panel score-card"><span class="muted">${state.ended?'结果评价':'当前过程评价'} · ${r.manualPending?'总评待完成':'总评已形成'}</span><div class="score" ${exam?'id="assessment-total"':''}>${r.total}<small> / 100</small></div><p>自动项 ${r.autoScore} / 85 · 点评 ${r.manualPending?'待完成':r.manualScore+' / 15'}</p><div class="stat-row"><span>目标时点可达</span><b>${r.available} 人</b></div><div class="stat-row"><span>目标时点投入</span><b>${r.spent} 万元</b></div><div class="stat-row"><span>已完成作业投入率</span><b>${r.auditComplete?pct(r.utilization)+'%':'记录不完整'}</b></div><div class="stat-row"><span>有效派遣率</span><b>${r.auditComplete?pct(r.validity)+'%':'记录不完整'}</b></div><div class="actions"><button class="primary" data-action="report">${exam?'导出考核成绩单':'导出实验报告'}</button><button data-action="archive">保存实验记录</button>${!state.ended?'<button data-nav="simulate">继续推演</button>':''}</div></aside></div><section class="panel spaced"><div class="panel-head"><h2>下一步可以怎样改进？</h2></div><div class="panel-body">${r.suggestions.length?`<ul class="decision-suggestions">${r.suggestions.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:'<p class="hint">可从同一个决策点改变抢通顺序，比较能否用更少投入、更早完成相同目标，并说明证据。</p>'}</div></section>`;}
 function progress(){if(page!=='simulate')return '';if(state.assessment?.phase==='active')return '<div class="notice spaced">目标达成时间由系统逐分钟记录，考核在T+180统一结算；倍速不会改变模拟时间与得分。</div>';const r=E.score(state);return r.scoringVersion===2?target(r):'';}
 function reportHtml(r,exam=false){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${exam?'决策考核成绩单':'交通孤岛实验报告'}</title><style>body{font:15px/1.9 sans-serif;max-width:980px;margin:40px auto;padding:20px;color:#173440}h1{font-size:26px}h2{font-size:20px;border-bottom:1px solid #abc5c7;margin-top:28px}table{width:100%;border-collapse:collapse}td,th{padding:10px;border:1px solid #afc2c8;text-align:left;vertical-align:top}pre{white-space:pre-wrap;font:inherit}.hint,small{color:#526d76}@media print{button{display:none}}</style><h1>${exam?'决策考核成绩单':'交通孤岛实验报告'}</h1><p>学生 / 小组：${esc(state.student||'未填写')}；情景：${esc(E.scenarios.find(v=>v.id===state.scenario).name)}<br>评价规则第2版；状态：${state.ended?'实验已结束':'过程评价'}；实验时刻T+${state.time}；导出时间：${new Date().toLocaleString('zh-CN')}</p><h2>任务目标与完成时间</h2><p>T+${r.goal.deadline}，可达不少于${r.goal.population}人，累计投入不超${r.goal.maxSpent}万元。评价取T+${r.goal.observedAt}，实际可达${r.available}人，投入${r.spent}万元。目标${r.goal.confirmed?'已确认':'尚未确认'}，首次完成时间${r.goal.completionTime===null?'尚未确认':'T+'+r.goal.completionTime+'分钟'}。</p><h2>四维评价与计算依据</h2><p>自动项${r.autoScore}/85；点评${r.manualPending?'待完成':r.manualScore+'/15'}；${r.manualPending?'总评待完成，当前已计':'总分'}${r.total}/100。知识检查和识别反馈不另加分。</p><table><tr><th>维度</th><th>得分</th><th>依据</th></tr>${r.rows.map(v=>`<tr><td>${v.name}</td><td>${v.score===null?'待点评':v.score}/${v.max}</td><td>${esc(v.reason)}</td></tr>`).join('')}</table><h2>改进建议</h2><ul>${r.suggestions.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>${LearningStudio.reportContext()}${StudentPrediction.report()}<h2>逐分钟证据摘要</h2><table><tr><th>时刻</th><th>可达人口</th><th>累计投入</th><th>可达重点设施</th></tr>${state.timeline.map(t=>`<tr><td>T+${t.time}</td><td>${t.available}</td><td>${t.spent}</td><td>${t.urgentIds.map(names).join('、')||'无'}</td></tr>`).join('')}</table><h2>派遣台账</h2><p>${r.auditComplete?'台账从实验起点记录。':'台账不完整，未记录的部分不推测评分。'}</p><table><tr><th>时刻</th><th>队伍 / 路段</th><th>结果</th><th>费用</th><th>完成时刻</th></tr>${(state.dispatchAudit||[]).map(a=>`<tr><td>T+${a.at}</td><td>${esc(a.crew)} / ${esc(a.edge)}</td><td>${a.ok?'成功':esc(a.error)}</td><td>${a.cost}</td><td>${a.completedAt===null?'未完成':'T+'+a.completedAt}</td></tr>`).join('')}</table><h2>操作事件</h2>${state.logs.map(l=>`<p>T+${l.time}：${esc(l.text)}</p>`).join('')}<h2>学生复盘</h2><pre>${esc(state.reflection||'未填写')}</pre><h2>知识检查（学习反馈，不另加分）</h2>${quiz.map((q,i)=>`<p>${q.q}<br>${esc(q.options[state.quiz[i]]||'未作答')}</p>`).join('')}<h2>规则与模型说明</h2>${rules()}<p>真实地理背景、虚拟教学路网与灾情参数；可达不等于人员已转移。评价反映模拟情景中的决策表现；初版教学权重有待学生试用校准。报告记录可由本机修改。</p><button onclick="print()">打印 / 保存PDF</button></html>`;}
 document.addEventListener('submit',event=>{if(event.target.id!=='decision-review-form')return;event.preventDefault();saveFields();const f=new FormData(event.target),r=E.setDecisionReview(state,{reviewer:f.get('reviewer'),comment:f.get('comment'),ratings:Object.fromEntries(['evidence','analysis','improvement'].map(k=>[k,Number(f.get(k))]))});if(r.error){toast(r.error);return;}persist();render();toast('点评已保存，总评已更新');});
 return {rules,results,reviewForm,progress,reportHtml};
})();

const StudentPrediction=(()=>{
 function rows(){return E.predictionResults(state).map(p=>`<article class="prediction-record"><b>T+${p.at} 的预测 → T+${p.target} 验证</b><p>预计可达 ${p.population} 人 · 累计投入 ${p.spent} 万元</p><p class="hint">依据：${esc(p.reason)}<br>提交时的待执行计划：${p.plan.join(' → ')||'未设置；需手动派遣'}</p>${p.actual?`<p class="green">实际可达 ${p.actual.available} 人 · 投入 ${p.actual.spent} 万元</p><p>与预测相差：人口 ${signed(p.actual.available-p.population)} 人 · 投入 ${signed(+(p.actual.spent-p.spent).toFixed(2))} 万元</p>`:`<p class="hint">${p.status==='unfinished'?'提前结束，未到验证时刻，不判定预测结果。':'等待推演到目标时刻；提交预测不会自动执行计划。'}</p>`}</article>`).join('');}
 function signed(n){return n>0?'+'+n:String(n);}
 function panel(){
  if(state.assessment||!['plan','simulate','results'].includes(page))return '';
  const list=state.predictions||[];if(page!=='plan'&&!list.length)return '';
  const target=Math.min(180,state.challenge?.goal.deadline>state.time?state.challenge.goal.deadline:state.time+30);
  return `<section class="panel prediction-lab spaced"><details id="prediction-panel" ${list.length?'open':''}><summary>先预测，再验证 <span class="tag">${list.length} 条判断已保留</span></summary><div class="panel-body"><p class="hint">先写下你预计的结果与理由，再亲自派遣和推演。到目标时刻后自动对照；差异用于讨论，不计入成绩。提交后保留原判断，初始条件锁定；后续策略仍可调整。</p>${page==='plan'&&!state.ended&&state.time<180?`<form id="student-prediction-form"><div class="form-grid"><label class="field">验证时刻 T+（分钟）<input name="target" type="number" min="${state.time+1}" max="180" step="1" value="${target}" required></label><label class="field">预计可达人口<input name="population" type="number" min="0" max="1520" step="1" placeholder="0—1520人" required></label><label class="field">预计累计投入（万元）<input name="spent" type="number" min="${state.spent}" max="${state.budget}" step="0.1" placeholder="${state.spent}—${state.budget}" required></label><label class="field">为什么作出这个预测？<textarea name="reason" minlength="10" maxlength="1000" rows="3" placeholder="结合准备抢修的道路、进场时间、预算和动态事件说明，至少10字。" required></textarea></label></div><button class="primary" type="submit">提交我的预测</button></form>`:''}<div id="prediction-records">${rows()||'<p class="hint">还没有提交预测。你可以先完成自己的计划，再回来记录判断。</p>'}</div></div></details></section>`;
 }
 function report(){return state.predictions?.length?`<h2>学生预测与实际对照</h2><p>预测在推演前提交，实际值取指定时刻的实验记录；仅用于学习反馈，不计入成绩。</p>${rows()}`:'';}
 document.addEventListener('submit',event=>{if(event.target.id!=='student-prediction-form')return;event.preventDefault();const f=new FormData(event.target),result=E.addPrediction(state,Object.fromEntries(f));if(result.error){toast(result.error);return;}persist();render();toast('预测已保存；请按自己的方案派遣并推进到验证时刻。');});
 return {panel,report};
})();

const StudentSupport=(()=>{
 let wordsOpen=false;
 function next(){
  if(state.ended)return ['results','查看结果，完成复盘'];
  if(state.challenge)return ['resources',state.spent?'继续挑战与派遣':'按题目目标安排队伍'];
  if(state.crews.some(c=>c.job))return ['simulate','继续推演，观察作业结果'];
  if(!state.identification&&!state.time&&!state.spent)return ['identify','从孤岛识别开始'];
  if(state.time||state.spent)return ['resources','检查路况，调整下一轮派遣'];
  return state.plan.length?['resources','按计划安排抢修队伍']:['plan','制定自己的抢通计划'];
 }
 function card(){
  if(state.assessment)return '';
  const tasks={
   home:['你的学习进度','这里记录已完成的操作。可以从当前状态继续，不必重新开始。'],
   identify:['这一步：判断哪些地方到不了','从基地S沿可通行道路查找聚落。点击你认为断连的聚落，再提交识别；橙色限行道路仍可通行。'],
   plan:['这一步：给自己的计划一个理由','点击阻断道路查看费用与工期，加入计划并调整顺序。展开下方“先预测，再验证”，记录预计结果，再去派遣与推演。'],
   compare:['这一步：比较依据，再作选择','先看恢复可达的时间，再看投入。这里只预演，不扣当前预算；参考规则不是标准答案。'],
   resources:['这一步：先看条件，再派遣','表格会说明当前队伍能否接单。派遣会立即扣费；全部安排好后，再点击“完成派遣 · 4倍推演”。'],
   simulate:['这一步：观察变化，必要时调整','观察哪条道路完成、可达人口如何变化。可以暂停后重新规划；不要急着结束，先确认目标是否达成。'],
   results:['这一步：解释自己的选择','复盘可以按三句话写：我先修了什么，因为……；结果与预想相比……；如果重来，我会……。过程分仍会随实验变化。'],
   'branch-lab':['换一种选择，验证自己的假设','保存关键点 → 写下准备改变什么 → 创建分支并操作 → 对比结果。原实验独立保留；结论要结合时间和投入。'],
   'challenge-lab':['出一道同学能读懂、能验证的题','写清任务和学习目标 → 设置预算、路况与达标时刻 → 自己试做 → 导出题目JSON给同学。先从只改一条路开始。']
  };
  if(!tasks[page])return '';
  const [title,body]=tasks[page],n=next();
  const link=({identify:state.identification?['plan','下一步：制定计划']:null,plan:['compare','下一步：比较自己的计划'],compare:['resources','下一步：安排队伍'],resources:state.crews.some(c=>c.job)?null:['plan','返回调整计划'],simulate:['resources','暂停并调整派遣'],results:['branch-lab','换一个选择，再验证一次']})[page]||(page==='home'?n:null);
  const skipped=!state.identification&&(state.time>0||state.spent>0);
  const progress=[!!state.identification,state.spent>0,state.time>0,state.reflection.trim().length>0];
  return `<section class="student-support" aria-label="当前学习任务"><div class="student-task"><div><span class="eyebrow">学习提示</span><h2>${title}</h2><p>${body}</p></div>${link?`<button data-nav="${link[0]}" class="primary">${link[1]} →</button>`:''}</div>${page==='home'?`<ul class="student-progress" aria-label="已记录的学习操作">${['提交初始识别','安排抢修作业','推进实验时间','保存学生复盘'].map((text,i)=>`<li class="${progress[i]?'done':''}">${progress[i]?'✓ 已记录':'○ 未记录'} · ${text}</li>`).join('')}</ul><p class="hint">这些标记仅表示已经操作，不代表答案正确或目标达成。进度保存在当前浏览器，可在“实验记录”导出备份。</p>`:''}${skipped&&['home','identify'].includes(page)?'<p class="student-warning">本次已开始派遣或推演，初始识别已锁定。可继续练习；下次请在派遣前提交识别。</p>':''}<details id="student-words" ${wordsOpen?'open':''}><summary>看懂常用词与地图操作</summary><dl><div><dt>交通孤岛</dt><dd>当前无法通过可通行道路连接基地的区域，不是指地图上的水中岛屿。</dd></div><div><dt>基地可达</dt><dd>道路已经连通，表示可以到达，不表示人员已经转移。</dd></div><div><dt>进场 / 工期</dt><dd>队伍先到达道路端点，再完成作业；总等待时间包含这两部分。</dd></div><div><dt>T+30</dt><dd>实验开始后的第30分钟；倍速只改变现实等待时间。</dd></div><div><dt>操作地图</dt><dd>滚轮缩放；点击彩色教学道路看详情，点击聚落查看或选择。若三维地图不好判断，可打开教学路网拓扑查看连接。<button class="small" data-action="geo-topology">查看教学路网拓扑</button></dd></div></dl></details></section>`;
 }
 function advice(id,cid){
  const reason=E.canDispatch(state,id,cid);
  if(!reason)return '<span class="green">可以派遣：工种、进场与预算满足条件。</span>';
  const action=reason.includes('预算')?'可返回规划，减少计划投入或重新取舍道路。':reason.includes('正在作业')?'可换一支空闲队伍，或推进时间等待其完成。':reason.includes('端点')?'先检查连接基地的前置道路，抢通后再回来派遣。':reason.includes('已有队伍')?'无需重复派遣，进入动态推演查看进度。':reason.includes('工种')?'请选择表格中所需工种的队伍。':'';
  return `<span>${esc(reason)}。${action}</span>`;
 }
 function decorate(){
  const words=$('#student-words');if(words)words.addEventListener('toggle',()=>{wordsOpen=words.open;});
  document.querySelectorAll('select[id^="crew-"]').forEach(select=>{
   if(state.assessment)return;
   const id=select.id.slice(5);let hint=document.createElement('div');hint.className='dispatch-advice';hint.id='dispatch-advice-'+id;select.closest('td').append(hint);select.setAttribute('aria-describedby',hint.id);
   const update=()=>{hint.innerHTML=advice(id,select.value);};update();select.addEventListener('change',update);
  });
 }
 return {card,decorate,next};
})();

function render(){
 const roadsPanel=$('#teaching-roads');if(roadsPanel)teachingRoadsOpen=roadsPanel.open;const lessonPanel=$('#lesson-help');if(lessonPanel)lessonHelpOpen=lessonPanel.open;
 page=canonicalPage(page);FloodGeoScene.detach();document.body.dataset.page=page;
 const group=navigationGroup(page);document.body.dataset.workspace=group.id;
 if(routeView){const r=E.route(state,routeView.from,routeView.to);routeView={...(r||{error:true}),from:routeView.from,to:routeView.to};}
 $('#nav').innerHTML=sidebar();$('#nav').classList.toggle('is-open',mobileNavOpen);
 $('#page-title').textContent=group.tabs.find(t=>t[0]===page)?.[1]||pages.find(t=>t[0]===page)?.[1]||'课堂工作区';
 $('#breadcrumb').textContent='交通孤岛决策实验 / '+group.title;
 $('#scenario').innerHTML=E.scenarios.map(v=>`<option value="${v.id}" ${v.id===state.scenario?'selected':''}>${v.name}</option>`).join('');
 $('#scenario').disabled=!!(state.learningBranch||state.challenge||state.learningConditionsLocked);
 metrics();const commandPage=FloodCommandUI.isPage(page);$('.experiment-controls').hidden=commandPage||['home','scene','real-lab','records','branch-lab','challenge-lab'].includes(page);
 let tabs=$('#workspace-tabs');if(!tabs){tabs=document.createElement('div');tabs.id='workspace-tabs';$('.topline').after(tabs);}tabs.innerHTML='';tabs.hidden=true;
 $('#content').innerHTML=page==='classroom'?FloodLearningUI.view():page==='real-lab'?FloodRealLab.view():commandPage?FloodCommandUI.view(page):({home:learningHome,compare:compareWorkspace,'branch-lab':()=>LearningStudio.branchPage(),'challenge-lab':()=>LearningStudio.challengePage(),scene,identify:identificationWorkspace,plan:planningWorkspace,resources:()=>'<div id="teaching-dispatch">'+resources()+'</div>',simulate,assessment:()=>(state.learningBranch||state.challenge)?'<section class="panel panel-body"><h2>当前为分支或学生挑战练习</h2><p>请按挑战目标和复盘理由完成学习；预置决策考核需要单独的预置情景。</p><button data-nav="settings">查看实验参数</button></section>':FloodAssessmentUI.view(),results,settings,records}[page])()+(page==='settings'?roadEditor():'');
 if(!commandPage&&!['real-lab','classroom'].includes(page)){
  $('#content').insertAdjacentHTML('afterbegin',LearningStudio.banner()+DecisionReviewUI.progress()+(page==='plan'?'':StudentPrediction.panel()));
  if(page==='plan')$('#content').insertAdjacentHTML('beforeend',StudentPrediction.panel());
  if(page!=='home'){const help=StudentSupport.card();if(help)$('#content').insertAdjacentHTML('beforeend',`<details class="panel lesson-help" id="lesson-help" ${lessonHelpOpen?'open':''}><summary>操作帮助与常用词<span>需要时展开阅读</span></summary>${help}</details>`);}
 }
 if(!commandPage&&!['real-lab','classroom'].includes(page))$('#content').insertAdjacentHTML('afterbegin',labJourney());
 if(page==='classroom'){ $('#metrics').hidden=true;FloodLearningUI.mount();window.dispatchEvent(new Event('flood-view-updated'));return;}
 StudentSupport.decorate();
 if(commandPage)FloodCommandUI.decorate(page);else{FloodAssessmentUI.decorate();$('.header-actions [data-action="save"]').textContent='保存实验';}
 $('#metrics').hidden=!['command','resources','compare','simulate','assessment','command-review','command-replay','results'].includes(page);
 FloodGeoScene.mount({state,page,realLab:page==='real-lab',routeEdges:routeView?.edges||[],...(commandPage?{command:FloodCommandUI.commandState(page)}:{})});
 FloodRealLab.bind(()=>{if(page==='real-lab')render();});
 window.dispatchEvent(new Event('flood-view-updated'));
}

function detail(id){const e=state.edges.find(e=>e.id===id);if(!e)return;const needed=E.requiredType(e),crew=state.crews.find(c=>!E.canDispatch(state,id,c.id));modal(`<h2>${id} · ${names(e.a)} — ${names(e.b)}</h2>${badge(E.status(state,e))}<div class="two-col spaced"><div><div class="stat-row"><span>道路长度</span><b>${e.length} km</b></div><div class="stat-row"><span>当前积水</span><b>${e.depth.toFixed(2)} m</b></div><div class="stat-row"><span>结构 / 清障状态</span><b>${e.damage?'存在阻断':'无阻断'}</b></div></div><div><div class="stat-row"><span>所需工种</span><b>${({road:'道路抢修',pump:'排涝作业',bridge:'桥梁加固'})[needed]}</b></div><div class="stat-row"><span>教学作业工期</span><b>${e.work} min</b></div><div class="stat-row"><span>预计投入</span><b>${e.cost} 万元</b></div></div></div><div class="actions"><button class="primary" data-add="${id}" ${E.passable(state,e)||state.ended||E.status(state,e)==='repair'?'disabled':''}>加入抢通计划</button>${crew?`<button data-quick-dispatch="${id}" data-crew="${crew.id}">派遣${crew.name}</button>`:'<span class="hint">当前不可直接派遣：检查工种、进场道路、队伍和预算。</span>'}</div>`);}
function tick(){const result=E.step(state,5);if(dispatchFastForward&&!state.crews.some(c=>c.job)){stop();toast('当前派遣作业已完成，推演已暂停，可查看结果或继续派遣');}persist();if(state.assessment?.pending||result?.error){stop();navigate('assessment');if(result?.error)toast(result.error);return;}if(state.ended){stop();if(state.assessment){navigate('assessment');return;}}render();}
function resetTo(id){stop();archive();state=E.create(id);routeView=null;zoom=1;persist();$('#dialog').close();navigate('overview');toast('新实验已就绪，原实验已尝试存入记录');}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function saveFields(){if($('#student'))state.student=$('#student').value;if($('#reflection'))state.reflection=$('#reflection').value;persist();}
function report(){if(state.assessment){FloodAssessmentUI.report();return;}saveFields();const r=E.score(state);download('交通孤岛实验报告-'+state.scenario+'.html',DecisionReviewUI.reportHtml(r),'text/html;charset=utf-8');toast('报告已导出，包含四维评价、完成时间与计算证据');}
const help=`<h2>交通孤岛与通道决策实验</h2><ol><li>孤岛识别：先判断哪些聚落与基地断连。</li><li>预算与通道规划：考虑各路费用、工期与连通收益。</li><li>方案比较：在同一条件上预演自定计划与规则参考，当前实验不会被改写。</li><li>抢修队伍派遣：匹配工种、进场道路和预算。</li><li>动态推演：推进时间，观察路况变化，再调整计划。</li><li>学习评价：查看成绩、完成复盘并导出报告。</li></ol><p>情景脚本、力量派遣、下达指令、问题作答、小组讨论分别位于左侧。协作实践与路网实验分别记录。</p><p class="hint">所有灾情、工期和费用为教学设定；规则参考不保证全局最优。记录保存在当前浏览器，重要进度请导出备份。</p>`;
document.addEventListener('click',event=>{const b=event.target.closest('button,[data-road],[data-node]');if(!b)return;if(b.disabled)return;if(b.matches('[data-cmd],[data-command-task],[data-command-resource]'))return;if(!FloodCommandUI.isPage(page)&&FloodAssessmentUI.guard(b))return;const d=b.dataset;
 if(d.action==='lesson-help'){const help=$('#lesson-help');if(help){help.open=true;help.querySelector('summary')?.focus({preventScroll:true});help.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'start'});}return;}
 if(d.action==='nav-focus'){const compact=document.body.classList.toggle('nav-compact');document.querySelectorAll('[data-action=nav-focus]').forEach(x=>{x.setAttribute('aria-label',compact?'展开课程目录':'收起课程目录');x.title=compact?'展开课程目录':'收起课程目录';});requestAnimationFrame(()=>FloodGeoScene.getMap()?.resize());return;}
 if(d.action==='menu-toggle'){mobileNavOpen=!mobileNavOpen;$('#nav').classList.toggle('is-open',mobileNavOpen);b.setAttribute('aria-expanded',String(mobileNavOpen));return;}
 if(d.scroll){$('#'+d.scroll)?.scrollIntoView({block:'start',behavior:'smooth'});return;}
 if(d.nav){saveFields();if(page==='simulate'&&d.nav!=='simulate')stop();navigate(d.nav);return;}
 if(d.saveRoad){const result=E.configureEdge(state,d.saveRoad,Number($('#depth-'+d.saveRoad).value),$('#damage-'+d.saveRoad).checked?1:0);persist();render();toast(result.error||'初始路况已更新，识别和计划已重置');return;}
 if(d.road){detail(d.road);return;}
 if(d.node){const n=E.nodes.find(n=>n.id===d.node);if(page==='identify'&&n.pop){if(state.time||state.spent){toast('实验已开始，初始识别已锁定');return;}state.selection=state.selection.includes(n.id)?state.selection.filter(x=>x!==n.id):[...state.selection,n.id];persist();render();}else modal(`<h2>${n.name} · ${n.id}</h2><p>区域人口：${n.pop} 人</p><p>基地可达性：${E.reachable(state).has(n.id)?'当前可达':'当前不可达'}</p><p class="hint">连接路段：${state.edges.filter(e=>e.a===n.id||e.b===n.id).map(e=>e.id).join('、')}</p>`);return;}
 if(d.add){if(!state.plan.includes(d.add))state.plan.push(d.add);persist();$('#dialog').close();toast('已加入抢通计划');render();return;}
 if(d.move){const i=state.plan.indexOf(d.move),j=i+Number(d.dir);if(j>=0&&j<state.plan.length)[state.plan[i],state.plan[j]]=[state.plan[j],state.plan[i]];persist();render();return;}
 if(d.remove){state.plan=state.plan.filter(x=>x!==d.remove);persist();render();return;}
 if(d.dispatch||d.quickDispatch){const id=d.dispatch||d.quickDispatch,cid=d.crew||$('#crew-'+id).value;const result=E.dispatch(state,id,cid);if(result.error){persist();toast(result.error);}else{persist();$('#dialog').close();render();toast('队伍已派遣，安排完毕后可点击“完成派遣 · 4倍推演”');}return;}
 if(d.scenario&&state.learningBranch){toast('请先返回原实验，再切换情景。');return;}
 if(d.scenario){confirmAction('切换实验情景','当前实验将先保存到本机记录，然后创建新实验。','scenario:'+d.scenario);return;}
 if(d.restore){confirmAction('载入历史实验','当前实验将先保存，再载入所选记录。','restore:'+d.restore);return;}
 if(d.delete){confirmAction('删除这条实验记录','此操作仅删除所选历史记录，不影响当前实验。','delete:'+d.delete);return;}
 const action=d.action;if(!action)return;
 if(action.startsWith('scenario:')){resetTo(action.split(':')[1]);return;}
 if(action.startsWith('restore:')){const r=experimentHistory().find(v=>v.id===Number(action.split(':')[1]));try{const next=LearningStudio.prepareState(E.validate(r.state));archive();stop();state=next;routeView=null;persist();$('#dialog').close();navigate('overview');toast('历史实验已载入');}catch(e){toast(e.message)}return;}
 if(action.startsWith('delete:')){try{localStorage.setItem(HISTORY,JSON.stringify(experimentHistory().filter(v=>v.id!==Number(action.split(':')[1]))));$('#dialog').close();render();}catch{toast('删除失败，浏览器存储不可用')}return;}
 switch(action){
 case 'close-dialog':$('#dialog').close();break;
 case 'course-help':case 'help':if(window.FloodTutorial)FloodTutorial.open();else modal(help);break;
 case 'save':if(FloodCommandUI.isPage(page)){FloodCommandUI.save();break;}saveFields();persist(true);break;
 case 'reset':if(LearningStudio.requestReset())break;confirmAction('重新开始本情景','当前实验会先存入本机记录，再恢复初始灾情。','scenario:'+state.scenario);break;
 case 'identify':{const r=E.identify(state,state.selection);toast(r.error||'识别已提交，F1 '+Math.round(r.score/25*100)+'%（学习反馈）');persist();render();break;}
 case 'route':{const from=$('#route-from').value,to=$('#route-to').value;routeView={...(E.route(state,from,to)||{error:true}),from,to};render();break;}
 case 'clear-route':routeView=null;render();break;
 case 'recommend':if(state.ended){toast('实验已结束，请重新实验');break;}state.plan=E.recommend(state).map(v=>v.id);state.usedHint=true;E.log(state,'使用参考抢通顺序：'+(state.plan.join('、')||'无可用路段'));persist();render();toast(state.plan.length?'参考顺序已加入，可继续调整':'当前没有可执行的参考道路');break;
 case 'dispatch-fast':if(state.ended||!state.crews.some(c=>c.job)){toast('请先派遣抢修队伍');break;}stop();playbackSpeed=4;dispatchFastForward=true;navigate('simulate');startPlayback();render();toast('已开启4倍推演，作业全部完成后自动暂停');break;
 case 'play':if(timer){stop();render();}else if(!state.ended){startPlayback();render();}break;
 case 'step':tick();break;
 case 'finish':stop();confirmAction('结束本次实验','将保留当前通道状态和进行中的作业，生成最终评价。','finish-confirm');render();break;
 case 'finish-confirm':state.ended=true;E.record(state);E.log(state,'学生主动结束实验');persist();$('#dialog').close();navigate('results');break;
 case 'configure':{const r=E.configure(state,{rain:Number($('#rain').value),budget:Number($('#budget').value)});persist();render();toast(r.error||'情景参数已更新');break;}
 case 'save-reflection':saveFields();render();toast('学生复盘已保存；已有点评如需更新，请重新确认');break;
 case 'check-quiz':{const answer=[1,2,0];modal('<h2>知识检查反馈</h2>'+quiz.map((q,i)=>`<p>${q.q}<br><b class="${state.quiz[i]===answer[i]?'green':'amber'}">${state.quiz[i]===answer[i]?'回答正确':'需要再思考'}</b><br>${q.options[answer[i]]}</p>`).join(''));break;}
 case 'archive':saveFields();if(archive())toast('已存入本机实验记录');if(page==='records')render();break;
 case 'export':saveFields();download('洪涝实验备份-'+state.scenario+'.json',JSON.stringify(state,null,2),'application/json');break;
 case 'import':$('#import-file').click();break;
 case 'report':report();break;
 case 'geo-sources':if(page==='real-lab'){modal('<h2>真实路网实验 · 数据与模型</h2><p>采用徐州云龙湖片区公开机动车道几何构建道路拓扑。灾情范围与道路相交时，路段随水深限行或阻断；路径与设施可达性同步重算。</p><p>道路来源 OpenStreetMap / OpenFreeMap；建筑轮廓真实，高度为开放数据近似值。设施用途、人口、雨强、灾情位置和作业参数为教学设定。</p><p>尚未接入地形高程或二维水动力计算，影响范围不是实际洪水淹没边界。单行、转向限制、信号灯和现场道路状态未建模，不用于实际导航。</p><p><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap / ODbL 版权与许可 ↗</a></p>');break;}modal('<h2>徐州场景 · 数据与模型</h2><p>区域：徐州云龙湖湖滨及周边片区。底图道路、水体、地块与建筑轮廓来自 OpenStreetMap，经 OpenFreeMap/OpenMapTiles 整理。</p><p>建筑采用轮廓拉伸的三维体块；高度为开放数据中的近似值或默认示意值，不是实测楼高或倾斜摄影。</p><p>彩色任务通道为叠加的教学网络，医院、养老院、社区等标记为虚拟教学设施，不代表当地真实机构或灾害。</p><p>数据裁剪后随网站提供，无需地图密钥。地图底层道路未作为真实救援导航依据；长度、工期、人口、预算与通行阈值仍为教学设定。</p><p><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap / ODbL 版权与许可 ↗</a></p>');break;
 case 'geo-topology':modal('<h2>教学路网拓扑</h2><p class="hint">用于分析节点连通性，与地图上的任务编号一致。</p>'+topologyMap());break;
 case 'zoom-in':zoom=Math.min(1.8,zoom+.2);render();break;
 case 'zoom-out':zoom=Math.max(.8,zoom-.2);render();break;
 case 'map-reset':zoom=1;render();break;
 case 'labels':showLabels=!showLabels;render();break;
 case 'rubric':modal('<h2>决策成效评价规则</h2>'+DecisionReviewUI.rules());break;
 }
});
document.addEventListener('change',e=>{const d=e.target.dataset;if(d.selectNode&&state.assessment&&state.identification){render();return;}if(d.selectNode){state.selection=e.target.checked?[...new Set([...state.selection,d.selectNode])]:state.selection.filter(x=>x!==d.selectNode);persist();render();}if(d.quiz!==undefined){state.quiz[d.quiz]=Number(e.target.value);persist();metrics();}if(e.target.id==='scenario'&&state.assessment){e.target.value=state.scenario;return;}if(e.target.id==='scenario'){const next=e.target.value;e.target.value=state.scenario;confirmAction('切换实验情景','当前实验将先存入本机记录。','scenario:'+next);}if(e.target.id==='auto-plan'){state.auto=e.target.checked;persist();toast(state.auto?'下次推进时将按计划自动派遣':'已关闭自动派遣');}if(e.target.id==='road-filter'){roadFilter=e.target.value;render();}});
document.addEventListener('input',e=>{if(e.target.id==='student'){state.student=e.target.value;persist();}if(e.target.id==='reflection'){state.reflection=e.target.value;persist();}});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-road],[data-node]')&&e.target.tagName!=='BUTTON'){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
$('#import-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2*1024*1024)throw new Error('实验文件不得超过 2 MB');const parsed=JSON.parse(await file.text());if(parsed?.kind==='flood-student-challenge')throw new Error('这是挑战题，请到左侧“学生出题”导入');if(parsed?.kind==='flood-branch-workspace')throw new Error('这是复盘记录，请到左侧“分支复盘”导入');const next=LearningStudio.prepareState(E.validate(parsed));stop();archive();state=next;routeView=null;persist();navigate('overview');toast('实验备份导入成功');}catch(err){toast(err instanceof SyntaxError?'文件不是有效 JSON':err.message)}e.target.value='';});
window.addEventListener('hashchange',()=>{const requested=location.hash.slice(1),next=canonicalPage(requested);if(pages.some(p=>p[0]===next)&&next!==page){stop();page=next;if(next==='command-replay')FloodCommandUI.stop();render();}if(next!==requested&&pages.some(p=>p[0]===next))window.history.replaceState(null,'','#'+next);});
window.addEventListener('beforeunload',()=>persist());
let drag=null;
document.addEventListener('pointerdown',e=>{const svg=e.target.closest('svg.map');if(!svg||e.target.closest('[data-road],[data-node]'))return;const vb=svg.viewBox.baseVal;drag={svg,x:e.clientX,y:e.clientY,bx:vb.x,by:vb.y,w:vb.width,h:vb.height};svg.setPointerCapture(e.pointerId);});
document.addEventListener('pointermove',e=>{if(!drag)return;const r=drag.svg.getBoundingClientRect(),scale=Math.max(drag.w/r.width,drag.h/r.height);const x=Math.max(-100,Math.min(900-drag.w+100,drag.bx-(e.clientX-drag.x)*scale)),y=Math.max(-80,Math.min(500-drag.h+80,drag.by-(e.clientY-drag.y)*scale));drag.svg.setAttribute('viewBox',`${x} ${y} ${drag.w} ${drag.h}`);});
document.addEventListener('pointerup',()=>drag=null);document.addEventListener('pointercancel',()=>drag=null);
const initialHash=location.hash.slice(1),initialPage=canonicalPage(initialHash);if(pages.some(p=>p[0]===initialPage)){page=initialPage;if(initialHash!==initialPage)window.history.replaceState(null,'','#'+initialPage);}render();if(storageError)toast('未能恢复旧实验，已开启新实验；可导入备份');
if(document.modelContext?.registerTool){const lifecycle=new AbortController();const tools=[{name:'read_flood_experiment',description:'读取当前实验时刻、可达人口与抢通计划',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute(){const st=E.stats(state);return {time:state.time,available:st.available,isolated:st.isolated,plan:state.plan,ended:state.ended};}},{name:'advance_flood_experiment',description:'暂停自动播放并推进当前教学实验五分钟，执行已启用的自动派遣计划',inputSchema:{type:'object',properties:{minutes:{type:'integer',enum:[5]}},required:['minutes'],additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(!input||input.minutes!==5||Object.keys(input).length!==1)throw new Error('minutes 必须为 5');if(state.ended)throw new Error('实验已结束');stop();tick();return {time:state.time,available:E.stats(state).available};}}];for(const tool of tools){try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});}

document.addEventListener('change',event=>{if(event.target.id!=='playback-speed')return;const value=Number(event.target.value);if(![1,2,4].includes(value))return;playbackSpeed=value;if(timer)startPlayback();render();});
