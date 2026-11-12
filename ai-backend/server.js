/**
 * 英语一作文 AI 批改 · 单文件后端
 * 运行环境：Node 16+（本地 / 腾讯云云函数 SCF / CloudBase / Vercel 均可）
 *
 * 环境变量：
 *   DEEPSEEK_API_KEY  必填，DeepSeek 平台申请的 key
 *   ACCESS_CODE       选填，设置后请求必须带 x-access-code 头
 *   ALLOW_ORIGIN      选填，允许的前端来源，默认 *
 *   MODEL             选填，默认 deepseek-flash
 *   MOCK              设 1 时不调用 API，返回示例结果（用于联调）
 */
'use strict';

const https = require('https');

const MODEL = process.env.MODEL || 'deepseek-flash';
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const MOCK = process.env.MOCK === '1' || !API_KEY;

/* ---------------- 限流：每个 IP 每天 40 次 ---------------- */
const hits = new Map();
const DAY = 24 * 3600 * 1000;
function allow(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.t > DAY) {
    hits.set(ip, { t: now, n: 1 });
    return true;
  }
  if (rec.n >= 40) return false;
  rec.n += 1;
  return true;
}

/* ---------------- 提示词 ---------------- */
function buildPrompt(essay, type) {
  const isBig = type !== 'small';
  const total = isBig ? 20 : 10;
  const words = isBig ? '160–200 词' : '100 词左右';

  const bands = isBig
    ? `第五档（17–20 分）：很好地完成任务；包含所有内容要点；语法结构和词汇丰富；语言自然流畅，基本没有语法错误；有效使用多种衔接手法，文字连贯、层次清晰；格式与语域恰当。
第四档（13–16 分）：较好地完成任务；包含所有内容要点，允许漏掉一两个次重点；语法结构和词汇较丰富；语言基本准确，只有在使用较复杂结构或较高级词汇时才有个别错误；格式与语域较恰当。
第三档（9–12 分）：基本完成任务；虽漏掉一些内容，但包含多数要点；语法结构和词汇能满足任务需求；存在一些语法及词汇错误，但不影响整体理解；采用简单的衔接手法，内容基本连贯、层次基本清晰；格式与语域基本合理。
第二档（5–8 分）：未能按要求完成任务；漏掉或未有效阐述一些要点，写了一些无关内容；语法结构单调、词汇有限；较多语法或词汇错误，影响理解；未采用恰当的衔接手法，内容缺少连贯性；格式与语域不恰当。
第一档（1–4 分）：未完成任务；明显遗漏主要内容，有许多不相关内容；语法结构和词汇单调、重复；语言错误多，有碍理解；未使用衔接手法，内容不连贯、缺少组织分段；无格式与语域概念。
零档（0 分）：信息或语言太少无法评价，或内容与要求无关、无法辨认。`
    : `第五档（9–10 分）：很好地完成任务；包含所有信息点；语法结构和词汇丰富；语言自然流畅，基本没有语法错误；有效使用多种衔接手法，文字连贯、层次清晰；格式与语域恰当贴切。
第四档（7–8 分）：较好地完成任务；包含所有信息点，允许漏掉一两个次重点；语法结构和词汇较丰富；语言基本准确，只有在使用较复杂结构或较高级词汇时才有个别错误；格式与语域较恰当。
第三档（5–6 分）：基本完成任务；虽漏掉一些信息，但包含多数信息点；语法结构和词汇能满足任务需求；存在一些语法及词汇错误，但不影响整体理解；采用简单的衔接手法，内容基本连贯；格式与语域基本合理。
第二档（3–4 分）：未能按要求完成任务；漏掉或未有效阐述一些信息点，写了一些无关内容；语法结构单调、词汇有限；较多错误影响理解；未采用恰当的衔接手法，内容缺少连贯性；格式与语域不恰当。
第一档（1–2 分）：未完成任务；明显遗漏主要信息，有许多不相关内容；语法结构和词汇单调、重复；语言错误多，有碍理解；未使用衔接手法，内容不连贯；无格式与语域概念。
零档（0 分）：信息或语言太少无法评价，或内容与要求无关、无法辨认。`;

  return `你正在按《全国硕士研究生招生考试英语（一）考试大纲》的写作评分标准阅卷。
这是你唯一的评分依据：不要套用雅思、托福、四六级或任何机构自拟的标准；也不要用"感觉"给分。

【本题】
${isBig
    ? 'B 节大作文：满分 20 分，160–200 词（标点不计入词数）。评分重点：内容的完整性、文章组织的连贯性、语法结构和词汇的多样性、语言的准确性。'
    : 'A 节小作文：满分 10 分，100 词左右（标点不计入词数）。评分重点：信息点的覆盖、内容的组织、语言的准确性、格式与语域的恰当。'}
字数明显不符要求的，酌情扣分。小作文若整句照抄题目提示语，要扣分；个别关键词可以使用。
拼写与标点按其对理解的影响程度计入"语言准确性"；英、美拼写均可接受。

【阅卷顺序（必须按这四步来）】
第一步 通读定档：先看是否切题——跑题或内容与题目无关，直接进第二档及以下；再依据"内容 + 语言"判断所属档次。
第二步 档内给分：在所属档次区间内给分；${isBig ? 'B 节允许在档内上下调节 1–3 分。' : 'A 节在档内给分。'}
第三步 列扣分项：字数不符、照抄提示语、格式/语域问题，逐条写清扣几分、为什么。
第四步 写定档理由：引用原文证据，说明为什么是这一档、而不是上一档。
（只能依据文本判断：书写、涂改、卷面无法判断，不要据此降档。）

【会直接降档的情形】
- 跑题，或写了大量与题目无关的内容；
- 语法错误密集，已经影响理解；
- 结构混乱、无衔接、无分段。
"用了模板"本身不降档；但模板句与题目无关、填空位没替换、生硬堆砌，会在内容切题与语言自然度上体现。

【官方五档】
${bands}

【附加检查：模板使用】（只作提示，不单独加分或扣分）
1) 是否保留了模板的核心句式（开头句、For one thing / For another / Besides、To conclude 等）
2) 模板里的填空位（主题词、数字、年份、人物、单位）是否都替换成了本题内容，有没有漏填
3) 是否存在把模板句改坏、或整段照抄与题目无关内容的情况

只输出 JSON，不要任何解释文字：
{
  "score": 数字（按题型满分 ${total}）,
  "band": "如：第四档（B节 13–16 分）",
  "band_reason": "定档理由：引用原文证据，说明为什么在这一档而不是上一档",
  "criteria": {
    "content": { "rating": 1-5, "comment": "必须引用原文片段，说明要点是否齐全、是否切题" },
    "organization": { "rating": 1-5, "comment": "必须引用原文，说明分段、衔接、层次" },
    "language": { "rating": 1-5, "comment": "必须引用原文，说明语法、词汇、准确性" }
  },
  "format": { "ok": true 或 false, "comment": "小作文写格式与语域（通知的标题/日期/署名，书信的称呼/落款）；大作文写分段与语域" },
  "word_count": 数字（按标点不计入的规则数）,
  "deductions": [ { "item": "字数不足|字数超出|格式|照抄提示语|其他", "points": 数字, "reason": "一句话" } ],
  "summary": "两三句话总评，指出最该改的一点",
  "issues": [ { "type": "语法|用词|结构|模板", "quote": "原文片段", "advice": "怎么改", "better": "改写后的句子" } ],
  "rewrites": [ { "original": "原句", "improved": "升级后的句子", "why": "一句话说明" } ],
  "template": { "kept": ["用对的模板句"], "broken": ["被改坏或误用的模板句"], "unfilled": ["没填的变量"] }
}
issues 最多 6 条，rewrites 最多 3 条；quote 必须逐字摘自原文；deductions 没有就返回空数组。
字数要求 ${words}；请自己在 word_count 里给出你数出的词数。

题目类型：${isBig ? '大作文' : '小作文'}
学生作文：
"""
${essay}
"""`;
}

/* ---------------- 调用 DeepSeek ---------------- */
function callDeepSeek(essay, type) {
  const body = JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: buildPrompt(essay, type) }],
    temperature: 0.3,
    max_tokens: 1200,
    response_format: { type: 'json_object' }
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.deepseek.com',
        path: '/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + API_KEY,
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 90000
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error('DeepSeek ' + res.statusCode + ': ' + data.slice(0, 300)));
          try {
            const j = JSON.parse(data);
            let txt = j.choices[0].message.content.trim();
            txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
            resolve(JSON.parse(txt));
          } catch (e) {
            reject(new Error('解析模型输出失败：' + e.message));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* ---------------- 模拟结果（联调用） ---------------- */
function mockResult(essay, type) {
  const big = type !== 'small';
  const wc = essay.trim().split(/\s+/).filter(Boolean).length;
  return {
    score: big ? 14 : 6,
    band: big ? '第四档（B节 13–16 分）' : '第三档（A节 5–6 分）',
    band_reason: '内容要点齐全、结构清楚，但语言有几处明显错误且句式偏单一，够不上第五档。',
    criteria: {
      content: { rating: big ? 4 : 3, comment: '三个要点都写到，寓意点到了，但第三段建议略空泛。' },
      organization: { rating: 4, comment: '分段合理，For one thing / For another 衔接自然。' },
      language: { rating: big ? 3 : 2, comment: '存在搭配与时态错误，复杂句偏少。' }
    },
    format: { ok: true, comment: big ? '分段清楚，语域基本正式。' : '通知格式完整，标题、日期、署名齐全。' },
    word_count: wc,
    deductions: wc < (big ? 150 : 80) ? [{ item: '字数不足', points: 1, reason: '比要求的 ' + (big ? '160' : '100') + ' 词少，酌情扣 1 分。' }] : [],
    summary: '结构完整、模板用得上，但语言偏平，个别搭配和时态需要修。',
    issues: [
      { type: '模板', quote: 'the great value of', advice: '主题词要具体，不能只写 value', better: 'the great value of perseverance' },
      { type: '用词', quote: 'pay attention to', advice: '这里用 attach importance to 更正式', better: 'attach greater importance to' }
    ],
    rewrites: [
      { original: 'It is very important for us.', improved: 'It matters a great deal to us.', why: '避免 very + 基础形容词' }
    ],
    template: { kept: ['As is vividly depicted in the cartoon', 'For one thing / For another'], broken: [], unfilled: [] },
    mock: true
  };
}

/* ---------------- HTTP 处理 ---------------- */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-access-code');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function parseBody(raw) {
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw || {};
  } catch (e) {
    return {};
  }
}

async function handle({ method, headers, body, ip }) {
  if (method === 'OPTIONS') return { status: 204, json: null };
  if (method !== 'POST') return { status: 405, json: { error: '只支持 POST' } };

  if (ACCESS_CODE && (headers['x-access-code'] || '') !== ACCESS_CODE) {
    return { status: 401, json: { error: '访问码不对' } };
  }
  if (!allow(ip)) return { status: 429, json: { error: '今天批改次数用完了，明天再来' } };

  const { essay = '', type = 'big' } = parseBody(body);
  const text = String(essay).trim();
  if (text.length < 60) return { status: 400, json: { error: '作文太短了，至少贴一段完整的内容' } };
  if (text.length > 4000) return { status: 400, json: { error: '太长了，控制在 4000 字符以内' } };

  if (MOCK) return { status: 200, json: mockResult(text, type) };

  try {
    const result = await callDeepSeek(text, type);
    return { status: 200, json: result };
  } catch (e) {
    return { status: 502, json: { error: e.message } };
  }
}

/* ---------------- 本地 / Vercel：http 入口 ---------------- */
function httpHandler(req, res) {
  cors(res);
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', async () => {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'local';
    const out = await handle({ method: req.method, headers: req.headers, body: raw, ip });
    if (out.status === 204) return res.writeHead(204).end();
    res.statusCode = out.status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(out.json));
  });
}

/* ---------------- 云函数入口（SCF / FC / CloudBase） ---------------- */
async function cloudHandler(event, context) {
  const e = event || {};
  const headers = {};
  const rawHeaders = e.headers || {};
  Object.keys(rawHeaders).forEach(k => (headers[k.toLowerCase()] = rawHeaders[k]));
  const method = (e.httpMethod || e.method || 'POST').toUpperCase();
  const body = e.body ? (e.isBase64Encoded ? Buffer.from(e.body, 'base64').toString() : e.body) : '{}';
  const ip = (e.requestContext && e.requestContext.sourceIp) || headers['x-forwarded-for'] || 'cloud';
  const out = await handle({ method, headers, body, ip });
  return {
    statusCode: out.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': ALLOW_ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type, x-access-code',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(out.json || {})
  };
}

/* ---------------- 导出 ---------------- */
const server = { handle, httpHandler, cloudHandler, mockResult, buildPrompt };

if (require.main === module) {
  const http = require('http');
  const port = process.env.PORT || 8787;
  http.createServer(httpHandler).listen(port, () => {
    console.log('AI 批改服务已启动: http://127.0.0.1:' + port + (MOCK ? '（MOCK 模式，不调用 API）' : ''));
  });
}

module.exports = server;
module.exports.main = cloudHandler;
