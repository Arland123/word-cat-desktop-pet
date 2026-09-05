(function () {
  const chineseDigits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

  function parseChineseNumber(value) {
    if (/^\d+$/.test(value)) return Number(value);
    if (value === '十') return 10;
    let total = 0;
    let section = 0;
    let number = 0;
    for (const char of value) {
      if (char === '十' || char === '百') {
        const unit = char === '十' ? 10 : 100;
        section += (number || 1) * unit;
        number = 0;
      } else if (chineseDigits[char] !== undefined) number = chineseDigits[char];
      else return NaN;
    }
    return section + number;
  }

  function extractCount(text, labels) {
    const token = '(\\d+|[零〇一二两三四五六七八九十百]+)';
    const label = `(?:${labels.join('|')})`;
    let match = text.match(new RegExp(`${token}\\s*(?:个|次|条)?\\s*${label}`));
    if (!match) match = text.match(new RegExp(`${label}[^\\d零〇一二两三四五六七八九十百]{0,8}${token}`));
    if (!match) return null;
    const raw = match[1] ?? match[2];
    const value = parseChineseNumber(raw);
    return Number.isInteger(value) ? value : null;
  }

  function targetDate(text) {
    const now = new Date();
    let label = '今天';
    if (/前天/.test(text)) { now.setDate(now.getDate() - 2); label = '前天'; }
    else if (/昨天|昨日/.test(text)) { now.setDate(now.getDate() - 1); label = '昨天'; }
    else {
      const full = text.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日?/);
      const short = text.match(/(?<!\d)(\d{1,2})月(\d{1,2})日?/);
      if (full) { now.setFullYear(Number(full[1]), Number(full[2]) - 1, Number(full[3])); label = `${full[1]}年${full[2]}月${full[3]}日`; }
      else if (short) { now.setMonth(Number(short[1]) - 1, Number(short[2])); label = `${short[1]}月${short[2]}日`; }
    }
    return { key: now.toLocaleDateString('sv-SE'), label };
  }

  function modelProtocol() {
    return [
      '请先判断用户这句话是否要求操作桌宠。你必须只输出一个 JSON 对象，不要输出 Markdown 或额外文字。',
      'JSON 格式：{"action":"record|set_record|undo|open_panel|open_chat|none","newWords":整数或null,"reviewWords":整数或null,"date":"YYYY-MM-DD","reply":"给用户的简短中文回复"}。',
      '只有用户明确表达了记录/修改/打卡/背了/复习了/撤销或打开面板的意图时，action 才能不是 none；普通陈述、提问和闲聊必须使用 none。',
      'record 表示在 date 对应日期增加数量；set_record 表示把用户明确指定的字段改成该数量，未指定的字段填 null 并保留原值。没有提到日期时使用今天。请把“今天、昨天、前天、X月X日、X年X月X日”等日期换算成 YYYY-MM-DD。',
      '无法确定数量或日期时使用 none，不要猜测。record 的 newWords 和 reviewWords 没有对应数量时填 0。'
    ].join('\n');
  }

  function parseModelJson(raw) {
    const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const value = JSON.parse(text.slice(start, end + 1));
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  function modelDate(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    if (typeof value === 'string') {
      const full = value.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日?/);
      const short = value.match(/(\d{1,2})月(\d{1,2})日?/);
      const date = new Date();
      if (full) date.setFullYear(Number(full[1]), Number(full[2]) - 1, Number(full[3]));
      else if (short) date.setMonth(Number(short[1]) - 1, Number(short[2]));
      else if (/前天/.test(value)) date.setDate(date.getDate() - 2);
      else if (/昨天|昨日/.test(value)) date.setDate(date.getDate() - 1);
      else return null;
      return date.toLocaleDateString('sv-SE');
    }
    return new Date().toLocaleDateString('sv-SE');
  }

  async function handleModelResponse(raw, api) {
    const action = parseModelJson(raw);
    if (!action || !['record', 'set_record', 'undo', 'open_panel', 'open_chat', 'none'].includes(action.action)) return { reply: raw };
    const modelReply = typeof action.reply === 'string' && action.reply.trim() ? action.reply.trim() : '';
    if (action.action === 'none') return { reply: modelReply || String(raw) };
    if (action.action === 'open_panel') { await api.showPanel(); return { reply: modelReply || '已打开打卡面板，喵。' }; }
    if (action.action === 'open_chat') { await api.showChat(); return { reply: modelReply || '已打开聊天面板，喵。' }; }
    const date = modelDate(action.date);
    if (!date) return { reply: '我没能确定你说的是哪一天，请使用“今天、昨天、前天”或具体年月日。' };
    if (action.action === 'undo') {
      const state = await api.undoStudy(date);
      return { state, reply: modelReply || `已撤销 ${date} 最近的一次打卡记录。` };
    }
    const isSet = action.action === 'set_record';
    const newWords = isSet && (action.newWords === null || action.newWords === undefined) ? null : (Number(action.newWords) || 0);
    const reviewWords = isSet && (action.reviewWords === null || action.reviewWords === undefined) ? null : (Number(action.reviewWords) || 0);
    const values = [newWords, reviewWords].filter((value) => value !== null);
    if (!values.every((value) => Number.isInteger(value) && value >= 0 && value <= 500) || (!values.length || (!isSet && !newWords && !reviewWords))) {
      return { reply: '我没能确定要记录的数量，请说清楚新词和复习词各有多少。' };
    }
    try {
      const state = isSet ? await api.setStudy({ newWords, reviewWords, date }) : await api.recordStudy({ newWords, reviewWords, date });
      return { state, reply: modelReply || `${isSet ? '已修改' : '已记录'} ${date} 的学习数据，喵。` };
    } catch (error) {
      return { reply: `这次没有记下：${error.message}` };
    }
  }

  async function execute(content, api) {
    const text = String(content || '').trim();
    if (!text) return null;
    if (/(打开|显示|进入|查看).*(聊天面板|聊天窗口)/.test(text)) {
      await api.showChat();
      return { reply: '已打开聊天面板，喵。' };
    }
    if (/(打开|显示|进入|查看).*(打卡面板|打卡窗口)|打开面板/.test(text)) {
      await api.showPanel();
      return { reply: '已打开打卡面板，喵。' };
    }
    if (/(撤销|取消).*(打卡|记录)|撤销一次/.test(text)) {
      const date = targetDate(text);
      const state = await api.undoStudy(date.key);
      return { state, reply: `已撤销${date.label}最近的一次打卡记录。` };
    }
    if (/(设置|修改).*(目标|每日)/.test(text)) return null;
    if (!/(记录|记下|记|打卡|增加|加上|背了|背完|学习了|完成了|帮我|复习)/.test(text)) return null;
    const newWords = extractCount(text, ['新词', '生词', '新单词']);
    const reviewWords = extractCount(text, ['复习', '复习词', '旧词']);
    if (newWords === null && reviewWords === null) return null;
    if ((newWords ?? 0) < 0 || (reviewWords ?? 0) < 0 || (newWords ?? 0) > 500 || (reviewWords ?? 0) > 500) {
      return { reply: '每次最多记录 500 个，请换一个数量再试。' };
    }
    try {
      const date = targetDate(text);
      const state = await api.recordStudy({ newWords: newWords || 0, reviewWords: reviewWords || 0, date: date.key });
      const parts = [];
      if (newWords) parts.push(`新词 ${newWords} 个`);
      if (reviewWords) parts.push(`复习 ${reviewWords} 个`);
      return { state, reply: `已帮你记录${date.label}的${parts.join('、')}，喵。` };
    } catch (error) {
      return { reply: `这次没有记下：${error.message}` };
    }
  }

  window.chatActions = { execute, modelProtocol, handleModelResponse };
}());
