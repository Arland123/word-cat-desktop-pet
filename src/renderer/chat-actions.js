(function () {
  function modelProtocol() {
    return [
      `今天是 ${new Date().toLocaleDateString('sv-SE')}，所有日期换算以此为准。`,
      '请先判断用户这句话是否要求操作桌宠（记录/修改打卡、撤销打卡、打开面板或聊天窗口）。',
      '如果不是操作：直接输出给用户的中文回复纯文本，不要输出 JSON，不要使用星号、井号、横线列表等 Markdown 符号；回复默认简短自然，但用户明确要求完整输出长内容（如背诵、重复、清单）时必须完整输出并正常换行。',
      '如果明确是操作：只输出一个 JSON 对象，格式：{"action":"record|set_record|undo|open_panel|open_chat|none","newWords":整数或null,"reviewWords":整数或null,"date":"YYYY-MM-DD","reply":"给用户的简短中文纯文本回复"}；不要输出 Markdown 或额外文字，reply 里如需换行必须写成 \\n 转义。',
      'record 表示在 date 对应日期增加数量；set_record 表示把用户明确指定的字段改成该数量，未指定的字段填 null 并保留原值。“记录/背了/复习了 X 个”这类表述是增量，用 record；只有用户明确说“改成/设置为/调整为 X 个”时才用 set_record。没有提到日期时使用今天。请把“今天、昨天、前天、X月X日、X年X月X日”等日期换算成 YYYY-MM-DD。',
      '“背了/复习了”仅在指向学习数量记录时才算打卡操作；用户要求你表演或完成某件事（例如背诗、背乘法表、讲故事）时不是打卡，按纯文本要求完整完成。无法确定数量或日期时不要输出操作 JSON，改为直接输出纯文本向用户确认；record 的 newWords 和 reviewWords 没有对应数量时填 0。'
    ].join('\n');
  }

  function escapeRawControlChars(text) {
    let result = '';
    let inString = false;
    let escaped = false;
    for (const ch of text) {
      if (escaped) { result += ch; escaped = false; continue; }
      if (ch === '\\') { result += ch; escaped = true; continue; }
      if (ch === '"') { inString = !inString; result += ch; continue; }
      if (inString && (ch === '\n' || ch === '\r' || ch === '\t')) {
        result += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\t';
        continue;
      }
      result += ch;
    }
    return result;
  }

  function parseModelJson(raw) {
    const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const slice = text.slice(start, end + 1);
    const candidates = [slice, escapeRawControlChars(slice)];
    for (const candidate of candidates) {
      try {
        const value = JSON.parse(candidate);
        if (value && typeof value === 'object') return value;
      } catch { /* 尝试下一种修复 */ }
    }
    return null;
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

  function stripMarkdown(text) {
    return String(text || '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*\n]+)\*/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/^[ \t]*[-•][ \t]+/gm, '');
  }

  async function respond(raw, api) {
    const action = parseModelJson(raw);
    if (!action || !['record', 'set_record', 'undo', 'open_panel', 'open_chat', 'none'].includes(action.action)) return { reply: raw };
    const modelReply = typeof action.reply === 'string' && action.reply.trim() ? action.reply.trim() : '';
    if (action.action === 'none') return { reply: modelReply || String(raw) };
    if (action.action === 'open_panel') { await api.showPanel(); return { reply: modelReply || '已打开打卡面板，喵。' }; }
    if (action.action === 'open_chat') { await api.showChat(); return { reply: modelReply || '已打开聊天面板，喵。' }; }
    const date = modelDate(action.date);
    if (!date) return { reply: '我没能确定你说的是哪一天，请使用“今天、昨天、前天”或具体年月日。' };
    if (action.action === 'undo') {
      const state = await api.undoStudy({ date, viaChat: true });
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
      const state = isSet ? await api.setStudy({ newWords, reviewWords, date, viaChat: true }) : await api.recordStudy({ newWords, reviewWords, date, viaChat: true });
      return { state, reply: modelReply || `${isSet ? '已修改' : '已记录'} ${date} 的学习数据，喵。` };
    } catch (error) {
      return { reply: `这次没有记下：${error.message}` };
    }
  }

  async function handleModelResponse(raw, api) {
    const result = await respond(raw, api);
    return { ...result, reply: stripMarkdown(result.reply) };
  }

  window.chatActions = { modelProtocol, handleModelResponse, stripMarkdown };
}());
