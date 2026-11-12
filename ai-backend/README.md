# 作文 AI 批改 · 后端

一个零依赖的 Node 服务，把前端提交的作文转给 DeepSeek，返回结构化批改结果（分数、分项、问题、改写、模板使用检查）。

## 文件

| 文件 | 作用 |
| --- | --- |
| `server.js` | 主逻辑：HTTP 入口 + 云函数入口 + 提示词 |
| `index.js` | 云函数入口（`index.main`） |
| `api/grade.js` | Vercel 用入口 |
| `package.json` | 依赖为空，仅声明 Node 版本 |

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 是 | 在 <https://platform.deepseek.com> 创建，形如 `sk-...` |
| `ACCESS_CODE` | 否 | 设了之后，请求必须带 `x-access-code` 头；建议设一个 |
| `ALLOW_ORIGIN` | 否 | 允许的前端来源，填 `https://pengpoiuyy.github.io` |
| `MODEL` | 否 | 默认 `deepseek-flash` |
| `MOCK` | 否 | 设 `1` 时不调用 API，返回演示数据 |

## 方式一：腾讯云开发 CloudBase（推荐，微信里访问稳）

1. 打开 <https://console.cloud.tencent.com/tcb>，创建一个环境（按量计费，有免费额度）。
2. 「云函数」→ 新建 → 运行环境选 **Node.js 16+** → 上传 `ai-backend.zip` → 入口填 `index.main`。
3. 在函数配置里加环境变量：`DEEPSEEK_API_KEY`、`ACCESS_CODE`、`ALLOW_ORIGIN`。
4. 「HTTP 访问服务」→ 新增路径 `/grade` → 绑定这个函数，得到一个地址：
   `https://<你的环境ID>.service.tcloudbase.com/grade`
5. 把这个地址填进网页的「AI 批改 → 设置 → 接口地址」。

## 方式二：腾讯云云函数 SCF + API 网关

1. 云函数控制台 → 新建 → Node.js 16 → 上传 ZIP → 执行方法 `index.main`。
2. 函数配置里加同样的环境变量。
3. 「触发器」→ 创建 API 网关触发器（选集成响应），得到 HTTPS 地址。
4. 同样填进网页设置里。

## 方式三：Vercel（最省事，但国内访问可能不稳）

```bash
cd ai-backend
npx vercel --prod
```

在 Vercel 项目设置里加环境变量，接口地址是 `https://<项目>.vercel.app/api/grade`。

## 本地测试

```bash
cd ai-backend
$env:MOCK="1"; node server.js        # 不花钱，返回演示数据
$env:DEEPSEEK_API_KEY="sk-..."; node server.js   # 真实调用
```

然后打开网页的「设置」，接口地址填 `http://127.0.0.1:8787`。

## 评分依据（英语一考纲）

- **A 节小作文**：10 分，100 词左右；重点是信息点覆盖、内容组织、语言准确、格式与语域。照抄题目提示语句子要扣分。
- **B 节大作文**：20 分，160–200 词；重点是内容完整、组织连贯、语法结构与词汇多样、语言准确。
- 先按内容与语言定档次，再在档内给分；B 节档内可上下调节 1–3 分；字数不符酌情扣分。

五档：第五档 A 9–10 / B 17–20；第四档 A 7–8 / B 13–16；第三档 A 5–6 / B 9–12；第二档 A 3–4 / B 5–8；第一档 A 1–2 / B 1–4；零档 0 分。

提示词里把五档描述原文写进了 `server.js` 的 `buildPrompt`，模型先判档、再给分，并单独输出定档理由与扣分项。


## 接口约定

```
POST /grade
Content-Type: application/json
x-access-code: <ACCESS_CODE>

{ "essay": "作文正文", "type": "big" | "small" }
```

返回：

```json
{
  "score": 15,
  "band": "第三档（13–15分）",
  "dimensions": { "content": 4, "structure": 4, "language": 3 },
  "summary": "……",
  "issues": [{ "type": "用词", "quote": "……", "advice": "……", "better": "……" }],
  "rewrites": [{ "original": "……", "improved": "……", "why": "……" }],
  "template": { "kept": [], "broken": [], "unfilled": [] }
}
```

## 成本

`deepseek-flash`：输入约 $0.15/百万 tokens、输出约 $0.6/百万（非高峰）。一篇作文约 2k tokens，单篇不到 1 分钱；每天 100 篇，一个月几块钱。
