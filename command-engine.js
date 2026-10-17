(function (root) {
  'use strict';

  // Independent classroom command exercise. Travel and costs are teaching estimates.
  // This module has no network, DOM or dependency on the existing road repair engine.
  const VERSION = 1;
  const roles = ['director', 'commander', 'rescue', 'medical', 'logistics', 'evaluator', 'observer'];
  const roleNames = { director: '导调员', commander: '指挥员', rescue: '抢险救援', medical: '医疗救护', logistics: '后勤保障', evaluator: '评估员', observer: '观摩员' };
  const defaultGroups = () => [{ id: 'main-conference', name: '综合会商', roles: ['director', 'commander', 'rescue', 'medical', 'logistics', 'evaluator'], createdBy: 'director' }];
  const nodes = ['S', 'J', 'C', 'D', 'E', 'N', 'A', 'B', 'H', 'V', 'K', 'W'];
  const quantities = ['people', 'vehicles', 'materials'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const round = value => Math.round(value * 100) / 100;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
  const maxLibrary = 100;

  function number(value, label, minimum = 0, maximum = 100000, integer = false) {
    assert(typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum && (!integer || Number.isInteger(value)), label + '数值无效');
    return value;
  }
  function text(value, label, max = 4000, optional = false) {
    assert(typeof value === 'string' && value.length <= max && (optional || value.trim().length > 0), label + '不能为空或超过长度限制');
    return value.trim();
  }
  function identifier(value) { assert(typeof value === 'string' && idPattern.test(value), '编号须为 1—80 位字母、数字、下划线或短横线'); return value; }
  function safeData(value, depth = 0) {
    assert(depth <= 40, '存档数据嵌套过深');
    if (!value || typeof value !== 'object') return;
    Object.keys(value).forEach(key => {
      assert(!['__proto__', 'constructor', 'prototype'].includes(key), '存档包含不支持的对象属性');
      safeData(value[key], depth + 1);
    });
  }
  function role(value, executable = false) {
    assert((executable ? ['rescue', 'medical', 'logistics'] : roles).includes(value), '角色无效'); return value;
  }
  function node(value) { assert(nodes.includes(value), '地点须为地图中的有效节点'); return value; }
  function countObject(raw, label, positive) {
    assert(raw && typeof raw === 'object' && !Array.isArray(raw), label + '未填写');
    const result = {};
    quantities.forEach(key => { result[key] = number(raw[key] ?? 0, label + key, 0, 10000, true); });
    if (positive) assert(quantities.some(key => result[key] > 0), label + '至少需要一项资源');
    return result;
  }
  function cleanGeometry(raw) {
    assert(raw && typeof raw === 'object', '标注几何数据无效');
    const kind = Array.isArray(raw) ? 'LineString' : raw.type;
    assert(['Point', 'LineString', 'Polygon'].includes(kind), '标注仅支持点、线和多边形');
    const coordinates = Array.isArray(raw) ? raw : raw.coordinates;
    let points = 0;
    function pair(value) {
      assert(Array.isArray(value) && value.length === 2, '标注坐标须为二维数值');
      number(value[0], '横坐标', -180, 180); number(value[1], '纵坐标', -90, 90); points += 1;
      return [value[0], value[1]];
    }
    let result;
    if (kind === 'Point') result = pair(coordinates);
    else if (kind === 'LineString') { assert(Array.isArray(coordinates) && coordinates.length >= 2, '线至少需要两个点'); result = coordinates.map(pair); }
    else {
      assert(Array.isArray(coordinates) && coordinates.length >= 1 && coordinates.length <= 20, '多边形环无效');
      result = coordinates.map(ring => { assert(Array.isArray(ring) && ring.length >= 4, '多边形至少需要三个点并闭合'); const values = ring.map(pair); assert(values[0][0] === values.at(-1)[0] && values[0][1] === values.at(-1)[1], '多边形须首尾闭合'); return values; });
    }
    assert(points <= 500, '每个标注最多 500 个点');
    return { type: kind, coordinates: result };
  }
  function cleanTask(raw, fromLibrary = false) {
    assert(raw && typeof raw === 'object', '情景任务无效');
    const task = {
      id: identifier(raw.id || 'custom-task'), title: text(raw.title || raw.name, '任务名称', 150),
      description: text(raw.description || '', '任务说明', 4000, true), node: node(raw.node), role: role(raw.role, true),
      requirements: countObject(raw.requirements, '需求', true),
      workMinutes: number(raw.workMinutes, '标准作业时间', 1, 240, true),
      deadline: number(raw.deadline ?? 60, '响应时限', 1, 1440, true), weight: number(raw.weight ?? 1, '任务权重', 1, 100),
      questionId: raw.questionId ? identifier(raw.questionId) : null,
      fileIds: Array.isArray(raw.fileIds)?raw.fileIds.slice(0,10).map(identifier):[]
    };
    if (fromLibrary) return task;
    return task;
  }
  function cleanItem(collection, raw) {
    assert(raw && typeof raw === 'object' && !Array.isArray(raw), '库条目无效');
    const base = { id: identifier(raw.id), name: text(raw.name || raw.title, '名称', 150) };
    switch (collection) {
      case 'resources': return Object.assign(base, { role: role(raw.role, true), node: node(raw.node || 'S'), ...countObject(raw, '资源容量', true), costPerMinute: number(raw.costPerMinute ?? .03, '每分钟成本', 0, 100), description: text(raw.description || '', '说明', 4000, true) });
      case 'scenarios': return Object.assign(base, { description: text(raw.description || '', '说明', 4000, true), task: cleanTask(raw.task, true) });
      case 'questions': {
        const kind = raw.kind || 'single';
        assert(['single', 'subjective'].includes(kind), '题型无效');
        const item = Object.assign(base, { kind, prompt: text(raw.prompt || raw.name, '题干', 4000), explanation: text(raw.explanation || '', '解析', 4000, true), points: number(raw.points ?? 10, '分值', 1, 100) });
        if (kind === 'single') {
          assert(Array.isArray(raw.options) && raw.options.length >= 2 && raw.options.length <= 8, '单选题需要 2—8 个选项');
          item.options = raw.options.map(value => text(value, '选项', 500));
          item.answer = number(raw.answer, '正确选项', 0, item.options.length - 1, true);
        } else { item.options = []; item.answer = null; }
        return item;
      }
      case 'scripts': {
        assert(Array.isArray(raw.steps) && raw.steps.length > 0 && raw.steps.length <= 50, '脚本需包含 1—50 个流程节点');
        const duration = number(raw.duration ?? 120, '演练时长', 1, 1440, true);
        const steps = raw.steps.map((step, index) => {
          assert(step && typeof step === 'object', '流程节点无效');
          const result = { id: identifier(step.id || 'step-' + (index + 1)), at: number(step.at, '触发分钟', 0, duration, true) };
          if (step.scenarioId) result.scenarioId = identifier(step.scenarioId);
          else if (step.task) result.task = cleanTask(step.task, true);
          else throw new Error('流程节点需要绑定情景或填写任务');
          if (step.questionId) result.questionId = identifier(step.questionId);
          return result;
        }).sort((a, b) => a.at - b.at);
        assert(new Set(steps.map(step => step.id)).size === steps.length, '流程编号不能重复');
        return Object.assign(base, { description: text(raw.description || '', '说明', 4000, true), duration, steps });
      }
      case 'organizations': return Object.assign(base, { role: role(raw.role || 'rescue'), contact: text(raw.contact || '', '联系人', 300, true), description: text(raw.description || '', '说明', 4000, true) });
      case 'files': {
        const url = raw.url ? text(raw.url, '资料链接', 2000) : '';
        if (url) assert(/^https?:\/\//i.test(url), '资料链接仅支持 HTTP 或 HTTPS 地址');
        const item = Object.assign(base, { category: text(raw.category || '演练资料', '类别', 100), type: text(raw.type || 'text/plain', '文件类型', 150), size: number(raw.size ?? (raw.content || '').length, '文件大小', 0, 2000000000, true), url, description: text(raw.description || '', '说明', 4000, true) });
        if (!raw.contentOmitted) item.content = text(raw.content || '', '资料内容', 262144, true);
        else item.contentOmitted = true;
        assert(!/^video\//i.test(item.type) || !item.content, '视频资料请使用引用链接');
        return item;
      }
      default: throw new Error('资料库类型无效');
    }
  }

  function seedLibrary() {
    const resources = [
      { id: 'rescue-1', name: '云龙应急抢险队', role: 'rescue', node: 'S', people: 24, vehicles: 4, materials: 16, costPerMinute: .08, description: '救援人员、冲锋舟／抢险车辆、排涝与破拆装备（教学综合单位）' },
      { id: 'medical-1', name: '市区医疗救护组', role: 'medical', node: 'H', people: 12, vehicles: 3, materials: 12, costPerMinute: .05, description: '急救人员、救护车、急救包（教学综合单位）' },
      { id: 'logistics-1', name: '安置后勤保障组', role: 'logistics', node: 'D', people: 18, vehicles: 4, materials: 30, costPerMinute: .04, description: '转运人员、保障车辆、生活物资包（教学综合单位）' }
    ];
    const questions = [
      { id: 'q-transfer', name: '积水区群众转移', kind: 'single', prompt: '积水区出现群众受困，首个指令应当优先明确什么？', options: ['立即让群众自行涉水离开', '核实人数与特殊需求，明确安全路线、转移点和责任队伍', '先恢复景观照明', '等待全部道路抢通后再行动'], answer: 1, explanation: '优先核实险情和人员，组织安全转移并明确接收安置点。', points: 10 },
      { id: 'q-medical', name: '养老院医疗转运', kind: 'single', prompt: '养老院有行动不便人员需要医疗转运，应如何配置？', options: ['只派普通货车', '安排医护、救护车辆和急救物资，并确认接收医院', '只发送天气预报', '将人员集中在积水最低处'], answer: 1, explanation: '医疗转运需要医护、适配车辆、急救物资与接收安排。', points: 10 },
      { id: 'q-route', name: '桥梁中断处置', kind: 'single', prompt: '原定路线桥梁中断后，指挥员应首先采取哪项行动？', options: ['继续按原路线驶入桥梁', '标记禁行、通知在途队伍并核查备用路线', '仅在事后报告记录', '撤销全部救援任务'], answer: 1, explanation: '先控制风险、通报交通变化，再调整路线和资源。', points: 10 },
      { id: 'q-review', name: '多点险情优先级说明', kind: 'subjective', prompt: '说明本次多点险情的处置优先级，至少包括人员生命风险、关键设施和备用通道三项依据。', options: [], answer: null, explanation: '由评估员结合任务记录、指令与方案依据评分。', points: 10 }
    ];
    const scenarios = [
      { id: 'community-transfer', name: '湖西社区群众转移', description: '短时强降雨导致西侧社区积水，需组织群众转移。', task: { id: 'transfer', title: '西侧社区受困群众转移', description: '查明受困情况，建立安全转移通道，向避难所交接并提交回报。', node: 'W', role: 'rescue', requirements: { people: 8, vehicles: 2, materials: 2 }, workMinutes: 18, deadline: 50, weight: 3, questionId: 'q-transfer' } },
      { id: 'elder-medical', name: '养老院医疗救护', description: '养老院 B 有需要协助转运的老人，启动医护响应。', task: { id: 'elder', title: '养老院 B 医疗转运', description: '完成分诊、医疗转运和接收医院联络。', node: 'B', role: 'medical', requirements: { people: 6, vehicles: 2, materials: 4 }, workMinutes: 15, deadline: 55, weight: 4, questionId: 'q-medical' } },
      { id: 'shelter-supply', name: '安置点物资保障', description: '学校安置点需要人员登记、饮水与生活物资保障。', task: { id: 'supply', title: '学校安置点生活保障', description: '为安置点建立登记台账，运送教学设定的物资并反馈接收。', node: 'K', role: 'logistics', requirements: { people: 6, vehicles: 1, materials: 8 }, workMinutes: 12, deadline: 65, weight: 2 } },
      { id: 'lake-pump', name: '南岸道路排涝', description: '南岸路口积水上升，需保障应急车辆通行。', task: { id: 'pump', title: '南岸路口排涝与警戒', description: '设置警戒，部署排涝装备并确认道路恢复条件。', node: 'J', role: 'rescue', requirements: { people: 6, vehicles: 1, materials: 4 }, workMinutes: 25, deadline: 70, weight: 2, questionId: 'q-route' } },
      { id: 'hospital-support', name: '医院应急物资保障', description: '医院 H 储备物资告急，紧急补充保障。', task: { id: 'hospital', title: '医院 H 应急物资补给', description: '核对接收清单和通行路线，运送应急物资。', node: 'H', role: 'logistics', requirements: { people: 5, vehicles: 2, materials: 10 }, workMinutes: 15, deadline: 45, weight: 3 } },
      { id: 'river-village', name: '河西村复合险情', description: '河西村通信和道路中断，需要搜救核查。', task: { id: 'village', title: '河西村搜救与通道核查', description: '开展逐户核查，清点受困人员并报告备用通道。', node: 'V', role: 'rescue', requirements: { people: 10, vehicles: 2, materials: 3 }, workMinutes: 25, deadline: 65, weight: 4, questionId: 'q-review' } }
    ];
    const scripts = [
      { id: 'starter', name: '01 · 暴雨应急协同', description: '从社区转移、养老院医疗到学校安置，练习导调、指挥、三类处置组协同。', duration: 120, steps: [{ id: 's1', at: 0, scenarioId: 'community-transfer' }, { id: 's2', at: 8, scenarioId: 'elder-medical' }, { id: 's3', at: 15, scenarioId: 'shelter-supply' }] },
      { id: 'rising', name: '02 · 持续强降雨与通道保障', description: '排涝和群众转移并行，随后加入医院物资告急情景。', duration: 150, steps: [{ id: 's1', at: 0, scenarioId: 'lake-pump' }, { id: 's2', at: 10, scenarioId: 'community-transfer' }, { id: 's3', at: 25, scenarioId: 'hospital-support' }] },
      { id: 'compound', name: '03 · 多点复合险情', description: '搜救、医疗、医院保障与安置同时展开，由评估员评价决策依据。', duration: 180, steps: [{ id: 's1', at: 0, scenarioId: 'river-village' }, { id: 's2', at: 0, scenarioId: 'elder-medical' }, { id: 's3', at: 12, scenarioId: 'hospital-support' }, { id: 's4', at: 25, scenarioId: 'shelter-supply' }] }
    ];
    return { resources, questions, scenarios, scripts, organizations: [
      { id: 'command-office', name: '市区联合指挥部', role: 'commander', contact: '教学席位 01', description: '统一指挥、下达任务、协调三类处置队伍。' },
      { id: 'rescue-office', name: '抢险救援组', role: 'rescue', contact: '教学席位 02', description: '人员搜救、转移与险情排除。' },
      { id: 'medical-office', name: '医疗救护组', role: 'medical', contact: '教学席位 03', description: '医疗分诊、急救与转运。' },
      { id: 'logistics-office', name: '后勤保障组', role: 'logistics', contact: '教学席位 04', description: '物资配送与安置保障。' }
    ], files: [{ id: 'teaching-guide', name: '演练操作与模型说明', category: '教学说明', description: '平台操作和教学假设。', content: '导调员选择脚本并启动；指挥员阅读任务、下达指令；处置组按人力、车辆和物资需求派遣资源；推进演练时间，资源到场并持续满足需求后累计作业进度；完成后提交执行回报与题目答案；评估员评分。资源数量和行程时间是教学设定，不代表真实应急力量和通行状况。本机模式可切换角色；运行附带联机服务后，参与者通过演练码加入同一房间实时协同。资料可导出演练存档和报告。' }] };
  }

  function snapshot(state) {
    const result = {};
    Object.keys(state).forEach(key => { if (key !== 'history') result[key] = state[key]; });
    return clone(result);
  }
  function nextId(state, prefix) { state.sequence += 1; return prefix + '-' + state.sequence; }
  function event(state, type, message, actorRole, detail) {
    state.events.push({ id: nextId(state, 'event'), time: state.time, type, text: message, role: actorRole || 'system', detail: detail || null });
    if (state.events.length > 600) state.events.splice(0, state.events.length - 600);
  }
  function history(state, label) {
    const id = nextId(state, 'frame');
    const frame = snapshot(state);
    // Full current-state exports keep attachments; playback needs only their metadata.
    frame.library.files.forEach(file => { if (file.content) { delete file.content; file.contentOmitted = true; } });
    state.history.push({ id, time: state.time, label, state: frame });
    if (state.history.length > 300) state.history.splice(0, state.history.length - 300);
  }
  function unitsFromLibrary(state) {
    return state.library.resources.map(resource => Object.assign(clone(resource), { available: countObject(resource, '资源') }));
  }
  function create() {
    const state = { version: VERSION, sequence: 0, library: seedLibrary(), run: { id: null, status: 'idle', scriptId: 'starter', elapsed: 0, duration: 120, firedSteps: [], startedAt: null, endedAt: null }, time: 0, weather: { type: 'rain', rain: 45, night: false, visibility: 5, wind: 3 }, units: [], tasks: [], orders: [], deployments: [], reports: [], evaluations: [], groups:defaultGroups(),messages:[],annotations: [], events: [], history: [], spent: 0 };
    state.units = unitsFromLibrary(state);
    event(state, 'ready', '教学导调平台已就绪，请选择脚本并开始演练。', 'system');
    history(state, '平台初始状态');
    return state;
  }

  function taskById(state, id) { const task = state.tasks.find(item => item.id === id); assert(task, '任务不存在'); return task; }
  function active(state) { assert(state.run.status === 'running', '请先开始或继续演练'); }
  function permitted(actorRole, type) {
    role(actorRole);
    if (actorRole === 'director') return;
    const policies = { commander: ['group-create','group-message','order', 'reply', 'dispatch', 'recall', 'task-report', 'annotate', 'annotation-remove'], rescue: ['group-message','reply', 'dispatch', 'recall', 'task-report', 'annotate', 'annotation-remove'], medical: ['group-message','reply', 'dispatch', 'recall', 'task-report', 'annotate', 'annotation-remove'], logistics: ['group-message','reply', 'dispatch', 'recall', 'task-report', 'annotate', 'annotation-remove'], evaluator: ['evaluate','group-message'], observer: [] };
    assert(policies[actorRole].includes(type), roleNames[actorRole] + '没有该操作权限');
  }
  function taskPermission(actorRole, task) { assert(['director', 'commander'].includes(actorRole) || actorRole === task.role, '只能操作本角色负责的任务'); }
  function injectTask(state, raw, source) {
    assert(state.tasks.length < 100, '单次演练最多 100 项任务');
    const task = cleanTask(raw);
    assert(task.fileIds.every(id=>state.library.files.some(f=>f.id===id)), '任务附件不存在');
    if (task.questionId) assert(state.library.questions.some(item => item.id === task.questionId), '任务关联题目不存在');
    const originalId = task.id;
    task.id = nextId(state, 'task');
    Object.assign(task, { templateId: originalId, source: source || 'manual', progress: 0, status: 'pending', createdAt: state.time, deadlineAt: state.time + task.deadline, completedAt: null, answer: null, answerCorrect: null });
    state.tasks.push(task);
    event(state, 'task-injected', '放入情景任务：' + task.title, 'system', { taskId: task.id, node: task.node });
    return task;
  }
  function checkReferences(library) {
    const questionExists = id => !id || library.questions.some(item => item.id === id);
    library.scenarios.forEach(item => {assert(questionExists(item.task.questionId), '情景引用了不存在的题目');assert((item.task.fileIds||[]).every(id=>library.files.some(f=>f.id===id)), '情景引用了不存在的资料');});
    library.scripts.forEach(script => script.steps.forEach(step => {
      if (step.scenarioId) assert(library.scenarios.some(item => item.id === step.scenarioId), '脚本引用了不存在的情景');
      assert(questionExists(step.questionId) && (!step.task || questionExists(step.task.questionId)), '脚本引用了不存在的题目');
      assert(!step.task||(step.task.fileIds||[]).every(id=>library.files.some(f=>f.id===id)), '脚本任务引用了不存在的资料');
    }));
  }
  function fireSteps(state, forceIndex) {
    const script = state.library.scripts.find(item => item.id === state.run.scriptId);
    assert(script, '当前演练脚本不存在');
    script.steps.forEach((step, index) => {
      if ((forceIndex !== undefined ? index !== forceIndex : step.at > state.time) || state.run.firedSteps.includes(step.id)) return;
      const scenario = step.scenarioId && state.library.scenarios.find(item => item.id === step.scenarioId);
      const task = clone(scenario ? scenario.task : step.task);
      if (step.questionId) task.questionId = step.questionId;
      injectTask(state, task, 'script:' + step.id);
      state.run.firedSteps.push(step.id);
    });
  }
  function release(state, deployment, status) {
    if (!['traveling', 'onsite'].includes(deployment.status)) return;
    const unit = state.units.find(item => item.id === deployment.resourceId);
    assert(unit, '派遣资源不存在');
    quantities.forEach(key => { unit.available[key] += deployment[key]; });
    deployment.status = status;
    deployment.returnedAt = state.time;
  }
  function end(state, reason) {
    state.deployments.forEach(deployment => release(state, deployment, 'returned'));
    state.tasks.forEach(task => { if (task.status === 'working') task.status = 'pending'; });
    state.run.status = 'ended';
    state.run.endedAt = state.time;
    event(state, 'run-ended', reason || '导调员结束演练，剩余资源已归还。', 'system');
  }
  function tickMinute(state) {
    state.time += 1;
    state.run.elapsed = state.time;
    fireSteps(state);
    state.deployments.forEach(deployment => {
      if (!['traveling', 'onsite'].includes(deployment.status)) return;
      const unit = state.units.find(item => item.id === deployment.resourceId);
      state.spent = round(state.spent + unit.costPerMinute * (deployment.people + deployment.vehicles * 2 + deployment.materials * .1));
      if (deployment.status === 'traveling' && deployment.arrivesAt <= state.time) {
        deployment.status = 'onsite';
        event(state, 'arrived', unit.name + '已到达：' + taskById(state, deployment.taskId).title, 'system', { deploymentId: deployment.id, taskId: deployment.taskId });
      }
    });
    state.tasks.forEach(task => {
      if (task.status === 'completed') return;
      const deployments = state.deployments.filter(item => item.taskId === task.id && item.status === 'onsite');
      const sufficient = quantities.every(key => deployments.reduce((sum, item) => sum + item[key], 0) >= task.requirements[key]);
      if (!sufficient) { task.status = 'pending'; return; }
      task.status = 'working';
      // A team that arrives at this minute has not yet worked a full minute.
      const workedFullMinute = quantities.every(key => deployments.filter(item => item.arrivesAt < state.time).reduce((sum, item) => sum + item[key], 0) >= task.requirements[key]);
      if (workedFullMinute) task.progress = Math.min(task.workMinutes, task.progress + 1);
      if (task.progress >= task.workMinutes) {
        task.status = 'completed';
        task.completedAt = state.time;
        state.deployments.filter(item => item.taskId === task.id).forEach(item => release(state, item, 'completed'));
        event(state, 'task-completed', '任务自动完成：' + task.title + '（到场资源满足需求，作业 ' + task.workMinutes + ' 分钟）', 'system', { taskId: task.id, node: task.node });
      }
    });
    if (state.time >= state.run.duration) end(state, '达到脚本设定时长，演练自动结束。');
  }

  function apply(state, action, actorRole = 'director') {
    try {
      assert(state && state.version === VERSION && Array.isArray(state.history), '演练状态无效');
      assert(action && typeof action.type === 'string', '操作无效');
      const type = action.type;
      permitted(actorRole, type);
      const draft = snapshot(state);
      draft.history = state.history.slice();
      let detail = null;
      let label = type;
      switch (type) {
        case 'library-upsert': case 'library-remove': {
          assert(['idle', 'ended'].includes(draft.run.status), '请在演练开始前或结束后编辑资料库');
          const collection = action.collection;
          assert(Object.prototype.hasOwnProperty.call(draft.library, collection), '资料库类型无效');
          const list = draft.library[collection];
          if (type === 'library-upsert') {
            const item = cleanItem(collection, action.item);
            const index = list.findIndex(value => value.id === item.id);
            assert(index >= 0 || list.length < maxLibrary, '资料库最多 100 条');
            if (collection === 'questions' && index >= 0 && draft.tasks.some(task => task.questionId === item.id)) {
              assert(JSON.stringify(cleanItem('questions', list[index])) === JSON.stringify(item), '本轮已使用的题目不能修改，请复制为新题目');
            }
            if (index < 0) list.push(item); else list[index] = item;
            label = '保存资料：' + item.name;
            detail = { collection, id: item.id };
          } else {
            const id = identifier(action.id);
            const index = list.findIndex(value => value.id === id);
            assert(index >= 0, '资料条目不存在');
            list.splice(index, 1);
            label = '删除资料：' + id;
            detail = { collection, id };
          }
          checkReferences(draft.library);
          if (collection === 'files') draft.tasks.forEach(task=>assert((task.fileIds||[]).every(id=>draft.library.files.some(file=>file.id===id)), '该资料仍被本轮任务引用，不能删除'));
          if (collection === 'questions') draft.tasks.forEach(task => assert(!task.questionId || draft.library.questions.some(item => item.id === task.questionId), '该题目仍被本轮任务使用，不能删除'));
          if (collection === 'scripts' && draft.run.status === 'idle') {
            assert(draft.library.scripts.length > 0, '至少保留一套演练脚本');
            if (!draft.library.scripts.some(item => item.id === draft.run.scriptId)) {
              draft.run.scriptId = draft.library.scripts[0].id;
              draft.run.duration = draft.library.scripts[0].duration;
            }
          }
          // An ended run retains its original resource ledger for review.
          if (collection === 'resources' && draft.run.status === 'idle') draft.units = unitsFromLibrary(draft);
          break;
        }
        case 'run-start': {
          assert(['idle', 'ended'].includes(draft.run.status), '本轮尚未结束');
          const script = draft.library.scripts.find(item => item.id === (action.scriptId || 'starter'));
          assert(script, '演练脚本不存在');
          checkReferences(draft.library);
          draft.time = 0; draft.spent = 0;
          draft.run = { id: nextId(draft, 'run'), status: 'running', scriptId: script.id, elapsed: 0, duration: script.duration, firedSteps: [], startedAt: 0, endedAt: null };
          draft.units = unitsFromLibrary(draft);
          if (!Array.isArray(draft.groups) || !draft.groups.length) draft.groups = defaultGroups();
          ['tasks', 'orders', 'deployments', 'reports', 'evaluations', 'messages', 'annotations', 'events', 'history'].forEach(key => { draft[key] = []; });
          label = '启动演练：' + script.name;
          fireSteps(draft);
          break;
        }
        case 'run-pause': active(draft); draft.run.status = 'paused'; label = '暂停演练'; break;
        case 'run-resume': assert(draft.run.status === 'paused', '演练没有暂停'); draft.run.status = 'running'; label = '继续演练'; break;
        case 'run-end': assert(['running', 'paused'].includes(draft.run.status), '当前没有正在进行的演练'); end(draft); label = '结束演练'; break;
        case 'tick': {
          active(draft);
          const minutes = number(action.minutes ?? 1, '推进分钟', 1, 30, true);
          for (let index = 0; index < minutes && draft.run.status === 'running'; index += 1) tickMinute(draft);
          label = '时间推进至 T+' + draft.time + ' 分钟';
          break;
        }
        case 'run-step': case 'trigger-step': {
          active(draft);
          const script = draft.library.scripts.find(item => item.id === draft.run.scriptId);
          const index = number(action.index, '流程序号', 0, script.steps.length - 1, true);
          assert(!draft.run.firedSteps.includes(script.steps[index].id), '该流程已投放，请勿重复投放');
          fireSteps(draft, index);
          label = '导调提前投放脚本流程 ' + (index + 1);
          detail = { index, stepId: script.steps[index].id };
          break;
        }
        case 'inject': {
          active(draft);
          const scenario = action.scenarioId && draft.library.scenarios.find(item => item.id === action.scenarioId);
          assert(!action.scenarioId || scenario, '情景不存在');
          const task = injectTask(draft, scenario ? scenario.task : action.task, 'director');
          label = '导调放入任务：' + task.title;
          detail = { taskId: task.id };
          break;
        }
        case 'group-create': {
          assert(['running','paused'].includes(draft.run.status), '请先开始演练');
          if(!draft.groups)draft.groups=[];if(!draft.messages)draft.messages=[];
          assert(draft.groups.length<30,'最多30个会商频道');
          const participants=[...new Set((action.roles||[]).map(r=>role(r)))];
          if(!participants.includes(actorRole))participants.push(actorRole);
          const group={id:nextId(draft,'group'),name:text(action.name,'频道名称',80),roles:participants,createdBy:actorRole};draft.groups.push(group);
          label='创建会商频道：'+group.name;detail={groupId:group.id};break;
        }
        case 'group-message': {
          assert(['running','paused','ended'].includes(draft.run.status), '请先开始演练');
          const group=(draft.groups||[]).find(g=>g.id===action.groupId);assert(group,'会商频道不存在');assert(actorRole==='director'||group.roles.includes(actorRole),'当前角色不在此频道');
          if(!draft.messages)draft.messages=[];assert(draft.messages.length<2000,'消息数量达到上限，请另建演练');
          const message={id:nextId(draft,'message'),groupId:group.id,role:actorRole,time:draft.time,text:text(action.text,'会商消息',2000)};draft.messages.push(message);
          label='发送会商消息：'+group.name;detail={groupId:group.id,messageId:message.id};break;
        }
        case 'order': {
          active(draft);
          assert(draft.orders.length < 2000, '本轮指令数量已达上限');
          const toRole = role(action.toRole);
          assert(!['director', 'observer', 'evaluator'].includes(toRole), '请选择执行或指挥角色');
          const task = action.taskId ? taskById(draft, action.taskId) : null;
          const order = { id: nextId(draft, 'order'), taskId: task ? task.id : null, fromRole: actorRole, toRole, text: text(action.text, '指令内容'), time: draft.time, replies: [], status: 'sent' };
          draft.orders.push(order);
          label = '向' + roleNames[toRole] + '下达指令'; detail = { orderId: order.id, taskId: order.taskId };
          break;
        }
        case 'reply': {
          active(draft);
          const order = draft.orders.find(item => item.id === action.orderId);
          assert(order, '指令不存在');
          assert(order.replies.length < 200, '本指令回复数量已达上限');
          assert(actorRole === 'director' || order.toRole === actorRole, '只能回复发给本角色的指令');
          order.replies.push({ id: nextId(draft, 'reply'), role: actorRole, time: draft.time, text: text(action.text, '回复内容') });
          order.status = 'acknowledged'; label = '回复指挥指令'; detail = { orderId: order.id };
          break;
        }
        case 'task-report': {
          assert(['running', 'paused', 'ended'].includes(draft.run.status), '请先开始演练');
          const task = taskById(draft, action.taskId);
          taskPermission(actorRole, task);
          assert(draft.reports.length < 2000, '本轮执行回报数量已达上限');
          const report = { id: nextId(draft, 'report'), taskId: task.id, role: actorRole, time: draft.time, text: text(action.text, '执行回报'), answer: null, correct: null };
          if (action.answer !== undefined && action.answer !== null && action.answer !== '') {
            assert(task.questionId, '此任务未关联题目');
            const question = draft.library.questions.find(item => item.id === task.questionId);
            assert(question, '关联题目不存在');
            if (question.kind === 'single') {
              report.answer = number(Number(action.answer), '答题选项', 0, question.options.length - 1, true);
              report.correct = report.answer === question.answer;report.points=question.points;report.earnedPoints=report.correct?question.points:0;
            } else report.answer = text(String(action.answer), '主观题作答');
            task.answer = report.answer; task.answerCorrect = report.correct;
          }
          draft.reports.push(report);
          label = '提交执行回报：' + task.title; detail = { taskId: task.id, reportId: report.id };
          break;
        }
        case 'dispatch': {
          active(draft);
          const task = taskById(draft, action.taskId);
          taskPermission(actorRole, task);
          assert(draft.deployments.length < 2000, '本轮派遣数量已达上限');
          assert(task.status !== 'completed', '任务已完成，无需继续派遣');
          const unit = draft.units.find(item => item.id === action.resourceId);
          assert(unit, '资源单位不存在');
          assert(unit.role === task.role, '资源单位工种与任务不匹配');
          assert(['director', 'commander'].includes(actorRole) || unit.role === actorRole, '只能派遣本角色资源');
          const amount = countObject(action, '派遣数量', true);
          quantities.forEach(key => assert(amount[key] <= unit.available[key], '可用' + ({ people: '人员', vehicles: '车辆', materials: '物资' }[key]) + '不足'));
          const transportMinutes = number(action.transportMinutes ?? (unit.node === task.node ? 1 : 8), '教学行程时间', 1, 120, true);
          const deployment = { id: nextId(draft, 'deployment'), taskId: task.id, resourceId: unit.id, role: unit.role, node: task.node, fromNode: unit.node, ...amount, status: 'traveling', dispatchedAt: draft.time, transportMinutes, arrivesAt: draft.time + transportMinutes, returnedAt: null };
          quantities.forEach(key => { unit.available[key] -= amount[key]; });
          draft.deployments.push(deployment);
          label = unit.name + '出发：' + task.title; detail = { deploymentId: deployment.id, taskId: task.id };
          break;
        }
        case 'recall': {
          assert(['running', 'paused'].includes(draft.run.status), '当前不能撤回派遣');
          const deployment = draft.deployments.find(item => item.id === action.deploymentId);
          assert(deployment, '派遣记录不存在');
          taskPermission(actorRole, taskById(draft, deployment.taskId));
          assert(['traveling', 'onsite'].includes(deployment.status), '派遣资源已归还');
          release(draft, deployment, 'recalled');
          const task = taskById(draft, deployment.taskId);
          if (task.status === 'working') task.status = 'pending';
          label = '撤回派遣资源'; detail = { deploymentId: deployment.id, taskId: task.id };
          break;
        }
        case 'evaluate': {
          assert(['running', 'paused', 'ended'].includes(draft.run.status), '请先开始演练');
          assert(draft.evaluations.length < 2000, '本轮评估数量已达上限');
          const task = taskById(draft, action.taskId);
          const evaluation = { id: nextId(draft, 'evaluation'), taskId: task.id, role: actorRole, time: draft.time, score: number(action.score, '人工评分', 0, 100), comment: text(action.comment || '', '评估意见', 4000, true) };
          draft.evaluations.push(evaluation);
          label = '评估任务：' + task.title; detail = { taskId: task.id, evaluationId: evaluation.id };
          break;
        }
        case 'annotate': {
          assert(['running', 'paused'].includes(draft.run.status), '请先开始演练');
          const raw = action.annotation || action;
          const annotation = { id: nextId(draft, 'annotation'), node: node(raw.node), text: text(raw.text, '标注内容', 500), kind: ['danger', 'route', 'shelter', 'note', 'point', 'line', 'polygon'].includes(raw.kind) ? raw.kind : 'note', role: actorRole, time: draft.time };
          if (raw.geometry) annotation.geometry = cleanGeometry(raw.geometry);
          if (raw.color) { assert(/^#[0-9a-fA-F]{6}$/.test(raw.color), '标注颜色无效'); annotation.color = raw.color; }
          assert(draft.annotations.length < 50, '最多保留 50 个地图标注');
          draft.annotations.push(annotation); label = '新增地图标注'; detail = { annotationId: annotation.id, node: annotation.node };
          break;
        }
        case 'annotation-remove': {
          const annotation = draft.annotations.find(item => item.id === action.id);
          assert(annotation, '标注不存在');
          assert(['director', 'commander'].includes(actorRole) || annotation.role === actorRole, '只能删除本人标注');
          draft.annotations = draft.annotations.filter(item => item.id !== action.id); label = '移除地图标注';
          break;
        }
        case 'weather': {
          assert(['running', 'paused'].includes(draft.run.status), '请先开始演练');
          const weather = action.weather;
          assert(weather && typeof weather === 'object', '天气设置无效');
          const nextWeather = Object.assign({}, draft.weather);
          if (weather.rain !== undefined) nextWeather.rain = number(weather.rain, '降雨强度', 0, 200);
          if (weather.visibility !== undefined) nextWeather.visibility = number(weather.visibility, '能见度', .1, 30);
          if (weather.wind !== undefined) nextWeather.wind = number(weather.wind, '风级', 0, 12, true);
          if (weather.type !== undefined) nextWeather.type = text(weather.type, '天气类型', 50);
          if (weather.night !== undefined) { assert(typeof weather.night === 'boolean', '昼夜设置无效'); nextWeather.night = weather.night; }
          draft.weather = nextWeather; label = '导调更新天气'; detail = clone(nextWeather);
          break;
        }
        default: throw new Error('不支持的操作');
      }
      event(draft, type, label, actorRole, detail);
      history(draft, label);
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, draft);
      return { ok: true, detail, time: state.time };
    } catch (error) { return { error: error.message || '操作失败' }; }
  }

  function taskScore(state, task) {
    const complete = task.status === 'completed';
    const execution = complete ? 70 : 0;
    const lateness = complete ? Math.max(0, task.completedAt - task.deadlineAt) : null;
    const timeliness = complete ? round(20 * clamp(1 - lateness / 60, 0, 1)) : 0;
    const question = task.questionId && state.library.questions.find(item => item.id === task.questionId);
    const evaluation = [...state.evaluations].reverse().find(item => item.taskId === task.id);
    let knowledge = 0;
    if (complete && !question) knowledge = 10;
    else if (question?.kind === 'single' && task.answerCorrect === true) knowledge = 10;
    else if (question?.kind === 'subjective' && task.answer !== null && evaluation) knowledge = round(evaluation.score / 10);
    const automatic = execution + timeliness + knowledge;
    // Manual evaluation refines demonstrated completion, never grants success for idle tasks.
    const score = complete && evaluation ? round(automatic * .8 + evaluation.score * .2) : automatic;
    return { taskId: task.id, title: task.title, weight: task.weight, completed: complete, execution, timeliness, knowledge, automatic, manual: evaluation ? evaluation.score : null, score, lateMinutes: lateness, explanation: complete ? '完成 70 分；时效 ' + timeliness + '/20；题目 ' + knowledge + '/10' + (evaluation ? '；最终分 = 自动分×80% + 评估分×20%' : '') : '尚未完成：不计完成、时效和资源投入奖励' };
  }
  function summary(state) {
    const taskScores = state.tasks.map(task => taskScore(state, task));
    const totalWeight = taskScores.reduce((sum, item) => sum + item.weight, 0);
    const score = totalWeight ? round(taskScores.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight) : 0;
    const completed = state.tasks.filter(task => task.status === 'completed').length;
    const working = state.tasks.filter(task => task.status === 'working').length;
    const availableUnits = state.units.map(unit => ({ id: unit.id, name: unit.name, role: unit.role, node: unit.node, total: { people: unit.people, vehicles: unit.vehicles, materials: unit.materials }, available: clone(unit.available) }));
    const liveDeployments = state.deployments.filter(item => ['traveling', 'onsite'].includes(item.status));
    const stats = { orders: state.orders.length, acknowledged: state.orders.filter(item => item.status === 'acknowledged').length, replies: state.orders.reduce((sum, item) => sum + item.replies.length, 0), reports: state.reports.length, deployments: state.deployments.length, activeDeployments: liveDeployments.length, recalled: state.deployments.filter(item => item.status === 'recalled').length, evaluations: state.evaluations.length, annotations: state.annotations.length, onTime: state.tasks.filter(task => task.status === 'completed' && task.completedAt <= task.deadlineAt).length, objectiveAnswered: state.tasks.filter(task => task.answerCorrect !== null).length, objectiveCorrect: state.tasks.filter(task => task.answerCorrect === true).length, assignedPeople: liveDeployments.reduce((sum, item) => sum + item.people, 0), assignedVehicles: liveDeployments.reduce((sum, item) => sum + item.vehicles, 0), assignedMaterials: liveDeployments.reduce((sum, item) => sum + item.materials, 0) };
    const reviewed = taskScores.filter(item => item.manual !== null);
    const reviewedWeight = reviewed.reduce((sum, item) => sum + item.weight, 0);
    const manualScore = reviewedWeight ? round(reviewed.reduce((sum, item) => sum + item.manual * item.weight, 0) / reviewedWeight) : null;
    return { score, manualScore, completed, total: state.tasks.length, working, pending: state.tasks.length - completed - working, spent: state.spent, completionRate: state.tasks.length ? round(completed / state.tasks.length * 100) : 0, time: state.time, status: state.run.status, scriptName: state.library.scripts.find(item => item.id === state.run.scriptId)?.name || '自定义演练', availableUnits, taskScores, stats, scoring: '各任务按权重平均：完成 70 分、按期完成 20 分（超时 60 分钟线性扣至 0）、题目 10 分。无题任务完成后取得该 10 分；主观题由评估员评分。已完成任务如有人工评估，最终采用自动分 80%＋人工分 20%。投入资源本身不加分。', model: '人力、车辆、物资为教学综合单位；行程为教学估算，可由地图层提供。达到全部需求后按标准作业时间完成；撤回、完成、结束时将资源归还，不模拟物资消耗和返程。' };
  }

  // Import is a data boundary: check accounting and references before accepting it.
  function validate(raw) {
    try {
      if (typeof raw === 'string') { assert(raw.length <= 50000000, '存档超过 50 MB'); raw = JSON.parse(raw); }
      assert(raw && typeof raw === 'object' && raw.version === VERSION, '不兼容的演练存档版本');
      const state = clone(raw);
      safeData(state);
      number(state.sequence, '序列号', 0, 10000000, true);
      number(state.time, '演练时间', 0, 1440, true);
      number(state.spent, '教学费用', 0, 1000000000000);
      assert(state.run && ['idle', 'running', 'paused', 'ended'].includes(state.run.status), '演练阶段无效');
      identifier(state.run.scriptId);
      number(state.run.elapsed, '累计时间', 0, 1440, true);
      assert(state.run.elapsed === state.time, '演练时间不一致');
      number(state.run.duration, '演练时长', 1, 1440, true);
      assert(state.time <= state.run.duration, '演练时间超出脚本时长');
      assert(Array.isArray(state.run.firedSteps) && state.run.firedSteps.length <= 50, '流程触发记录无效');
      state.run.firedSteps.forEach(identifier);
      assert(new Set(state.run.firedSteps).size === state.run.firedSteps.length, '流程触发记录重复');
      assert(state.weather && typeof state.weather === 'object', '天气数据无效');
      number(state.weather.rain, '降雨强度', 0, 200); number(state.weather.visibility, '能见度', .1, 30); number(state.weather.wind, '风级', 0, 12, true);
      if (state.weather.type !== undefined) text(state.weather.type, '天气类型', 50);
      if (state.weather.night !== undefined) assert(typeof state.weather.night === 'boolean', '昼夜设置无效');
      if(!state.groups)state.groups=defaultGroups();if(!state.messages)state.messages=[];
      const limits = { groups:30,messages:2000,units: 100, tasks: 100, orders: 2000, deployments: 2000, reports: 2000, evaluations: 2000, annotations: 50, events: 600 };
      Object.entries(limits).forEach(([key, limit]) => {
        assert(Array.isArray(state[key]) && state[key].length <= limit, key + '数据无效或过多');
        const ids = state[key].map(item => identifier(item.id));
        assert(new Set(ids).size === ids.length, key + '编号重复');
      });
      assert(state.library && typeof state.library === 'object', '资料库不存在');
      ['resources', 'scenarios', 'questions', 'scripts', 'organizations', 'files'].forEach(collection => {
        const list = state.library[collection];
        assert(Array.isArray(list) && list.length <= maxLibrary, '资料库格式无效');
        state.library[collection] = list.map(item => cleanItem(collection, item));
        assert(new Set(list.map(item => item.id)).size === list.length, '资料库编号重复');
      });
      checkReferences(state.library);
      if (state.run.status !== 'ended') assert(state.library.scripts.some(item => item.id === state.run.scriptId), '当前脚本不存在');
      state.units.forEach(unit => {
        cleanItem('resources', unit); countObject(unit.available, '可用资源');
        quantities.forEach(key => assert(unit.available[key] <= unit[key], '可用资源超出容量'));
      });
      state.tasks.forEach(task => {
        cleanTask(task);
        assert(['pending', 'working', 'completed'].includes(task.status), '任务状态无效');
        number(task.progress, '作业进度', 0, task.workMinutes, true);
        number(task.createdAt, '任务创建时间', 0, state.time, true);
        number(task.deadlineAt, '任务截止时间', task.createdAt + 1, 2880, true);
        if (task.status === 'completed') {
          number(task.completedAt, '任务完成时间', task.createdAt, state.time, true);
          assert(task.progress === task.workMinutes, '完成任务缺少作业进度');
        } else assert(task.completedAt === null, '未完成任务出现完成时间');
        assert((task.fileIds||[]).every(id=>state.library.files.some(f=>f.id===id)), '任务引用了不存在的资料');
        assert(!task.questionId || state.library.questions.some(item => item.id === task.questionId), '任务题目不存在');
        assert(task.answerCorrect === null || typeof task.answerCorrect === 'boolean', '答题判定无效');
        if (task.answer !== null) {
          const question = state.library.questions.find(item => item.id === task.questionId);
          assert(question, '作答缺少关联题目');
          if (question.kind === 'single') {
            number(task.answer, '答题选项', 0, question.options.length - 1, true);
            assert(task.answerCorrect === (task.answer === question.answer), '答题判定与题目不符');
          } else { text(task.answer, '主观题作答'); assert(task.answerCorrect === null, '主观题不能自动判定正误'); }
        } else assert(task.answerCorrect === null, '未作答任务不能判定正误');
      });
      state.deployments.forEach(deployment => {
        identifier(deployment.taskId); identifier(deployment.resourceId);
        const task = taskById(state, deployment.taskId);
        const unit = state.units.find(item => item.id === deployment.resourceId);
        assert(unit && task.role === unit.role && deployment.role === unit.role, '派遣工种或资源关联无效');
        countObject(deployment, '派遣资源', true); node(deployment.node); node(deployment.fromNode);
        assert(deployment.node === task.node, '派遣地点与任务不符');
        assert(['traveling', 'onsite', 'completed', 'recalled', 'returned'].includes(deployment.status), '派遣状态无效');
        number(deployment.dispatchedAt, '出发时间', 0, state.time, true);
        number(deployment.transportMinutes, '行程时间', 1, 120, true);
        assert(deployment.arrivesAt === deployment.dispatchedAt + deployment.transportMinutes, '到场时间无效');
        if (['traveling', 'onsite'].includes(deployment.status)) assert(task.status !== 'completed' && state.run.status !== 'ended', '已完成状态仍占用资源');
      });
      state.units.forEach(unit => quantities.forEach(key => {
        const used = state.deployments.filter(item => item.resourceId === unit.id && ['traveling', 'onsite'].includes(item.status)).reduce((sum, item) => sum + item[key], 0);
        assert(unit.available[key] + used === unit[key], '资源台账不平衡');
      }));
      state.orders.forEach(order => {
        role(order.fromRole); role(order.toRole); text(order.text, '指令');
        if (order.taskId) taskById(state, order.taskId);
        assert(Array.isArray(order.replies) && order.replies.length <= 200, '回复数据无效');
        order.replies.forEach(reply => { role(reply.role); text(reply.text, '回复'); number(reply.time, '回复时间', 0, state.time, true); });
      });
      state.groups.forEach(g=>{identifier(g.id);text(g.name,'频道名称',80);assert(Array.isArray(g.roles)&&g.roles.length<=7,'频道角色无效');g.roles.forEach(r=>role(r));});state.messages.forEach(m=>{assert(state.groups.some(g=>g.id===m.groupId),'会商频道缺失');role(m.role);text(m.text,'会商消息',2000);number(m.time,'消息时间',0,state.time,true);});
      state.reports.forEach(report => { taskById(state, report.taskId); role(report.role); text(report.text, '回报'); number(report.time, '回报时间', 0, state.time, true); });
      state.evaluations.forEach(evaluation => { taskById(state, evaluation.taskId); assert(['director', 'evaluator'].includes(evaluation.role), '评估角色无效'); number(evaluation.score, '评估分', 0, 100); text(evaluation.comment, '评估意见', 4000, true); });
      state.annotations.forEach(annotation => { node(annotation.node); role(annotation.role); text(annotation.text, '地图标注', 500); if (annotation.geometry) cleanGeometry(annotation.geometry); if (annotation.color) assert(/^#[0-9a-fA-F]{6}$/.test(annotation.color), '标注颜色无效'); });
      state.events.forEach(entry => { text(entry.text, '日志', 5000); number(entry.time, '日志时间', 0, state.time, true); });
      if (!state.history) state.history = [];
      assert(Array.isArray(state.history) && state.history.length <= 300, '回放记录无效');
      // Validate historical snapshots too, without accepting recursively nested histories.
      state.history.forEach(frame => {
        identifier(frame.id); text(frame.label, '回放说明', 500); number(frame.time, '回放时间', 0, state.time, true);
        assert(frame.state && !Object.prototype.hasOwnProperty.call(frame.state, 'history'), '回放不能嵌套回放');
        const result = validate(Object.assign({}, frame.state, { history: [] }));
        assert(result.ok, '回放状态无效：' + result.error);
      });
      return { ok: true, state };
    } catch (error) { return { error: error.message || '演练存档无效' }; }
  }

  const api = { version: VERSION, roles, roleNames, nodes, create, apply, snapshot, validate, summary };
  root.FloodCommandEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
