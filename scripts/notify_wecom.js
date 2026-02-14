/**
 * 企业微信应用消息通知脚本
 *
 * 每次更新后，只通知新增的论文，每篇论文单独一条消息，
 * 包含标题和简要摘要。支持同时向多个企业微信应用发送。
 *
 * 环境变量：
 *   WECOM_APPS      – JSON 数组，每个元素包含：
 *     {
 *       "name":      "应用名称（可选，仅用于日志）",
 *       "corpid":    "企业 ID",
 *       "corpsecret":"应用 Secret",
 *       "agentid":    应用 AgentId (数字),
 *       "touser":    "接收人，默认 @all",
 *       "toparty":   "接收部门（可选）",
 *       "totag":     "接收标签（可选）"
 *     }
 *
 *   SITE_URL         – 站点地址，用于在消息中附带链接（可选）
 *   PAPERS_JSON      – papers-index.json 路径，默认 data/papers-index.json
 *   OLD_PAPERS_JSON  – 更新前的旧 papers-index.json 快照路径（用于对比新增）
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

/* ── 配置 ────────────────────────────────────────────── */

const WECOM_APPS_RAW = process.env.WECOM_APPS || "[]";
const SITE_URL = process.env.SITE_URL || "";
const PAPERS_JSON =
  process.env.PAPERS_JSON ||
  path.resolve(__dirname, "..", "data", "papers-index.json");
const OLD_PAPERS_JSON =
  process.env.OLD_PAPERS_JSON ||
  path.resolve(__dirname, "..", "data", "papers-index-old.json");

/* ── HTTP 工具 ───────────────────────────────────────── */

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON parse error: ${data}`));
          }
        });
      })
      .on("error", reject);
  });
}

function httpsPostJson(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${data}`));
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/* ── 企业微信 API ────────────────────────────────────── */

async function getAccessToken(corpid, corpsecret) {
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(
    corpid
  )}&corpsecret=${encodeURIComponent(corpsecret)}`;
  const res = await httpsGet(url);
  if (res.errcode !== 0) {
    throw new Error(
      `获取 access_token 失败: errcode=${res.errcode}, errmsg=${res.errmsg}`
    );
  }
  return res.access_token;
}

async function sendTextMessage(accessToken, { agentid, touser, toparty, totag, content }) {
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;
  const body = {
    msgtype: "text",
    agentid,
    text: { content },
  };
  if (touser) body.touser = touser;
  if (toparty) body.toparty = toparty;
  if (totag) body.totag = totag;
  if (!touser && !toparty && !totag) body.touser = "@all";

  const res = await httpsPostJson(url, body);
  if (res.errcode !== 0) {
    throw new Error(
      `发送消息失败: errcode=${res.errcode}, errmsg=${res.errmsg}`
    );
  }
  return res;
}

async function sendMarkdownMessage(accessToken, { agentid, touser, toparty, totag, content }) {
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;
  const body = {
    msgtype: "markdown",
    agentid,
    markdown: { content },
  };
  if (touser) body.touser = touser;
  if (toparty) body.toparty = toparty;
  if (totag) body.totag = totag;
  if (!touser && !toparty && !totag) body.touser = "@all";

  const res = await httpsPostJson(url, body);
  if (res.errcode !== 0) {
    throw new Error(
      `发送 Markdown 消息失败: errcode=${res.errcode}, errmsg=${res.errmsg}`
    );
  }
  return res;
}

/* ── 检测新增论文 ────────────────────────────────────── */

function findNewPapers() {
  // 读取新论文列表
  if (!fs.existsSync(PAPERS_JSON)) {
    console.error(`❌ 论文数据文件不存在: ${PAPERS_JSON}`);
    process.exit(1);
  }
  const newData = JSON.parse(fs.readFileSync(PAPERS_JSON, "utf-8"));
  const newItems = newData.items || [];

  // 读取旧论文列表
  let oldIds = new Set();
  if (fs.existsSync(OLD_PAPERS_JSON)) {
    try {
      const oldData = JSON.parse(fs.readFileSync(OLD_PAPERS_JSON, "utf-8"));
      const oldItems = oldData.items || [];
      oldIds = new Set(oldItems.map((p) => p.id || p.url));
    } catch {
      console.warn("⚠️  无法解析旧论文数据，将视所有论文为新增。");
    }
  } else {
    console.warn("⚠️  旧论文快照不存在，将视所有论文为新增。");
  }

  // 找出新增论文
  const newPapers = newItems.filter((p) => !oldIds.has(p.id || p.url));
  return newPapers;
}

/* ── 构建统计汇总消息 ────────────────────────────────── */

function buildSummaryMessage(count, siteUrl) {
  let md = `📚 **今日新增 ${count} 篇论文**\n以下将逐篇推送，请查收。`;
  if (siteUrl) md += `\n👉 [查看主页](${siteUrl})`;

  let text = `📚 今日新增 ${count} 篇论文\n以下将逐篇推送，请查收。`;
  if (siteUrl) text += `\n👉 查看主页: ${siteUrl}`;

  return { markdown: md, text };
}

/* ── 为单篇论文构建消息 ──────────────────────────────── */

function buildPaperMessage(paper, index, total, siteUrl) {
  const title = paper.title || "Untitled";
  const category = paper.category || "";
  const authors = paper.authors || "";
  const summary = paper.summary || "暂无摘要";
  const arxivId = paper.arxivId || "";
  const arxivUrl = paper.url || paper.id || (arxivId ? `http://arxiv.org/abs/${arxivId}` : "");
  const detailUrl = arxivId && siteUrl
    ? `${siteUrl.replace(/\/$/, "")}/papers/${arxivId}.html`
    : "";

  // Markdown 版本
  let md = `📄 **[${index}/${total}] ${title}**\n`;
  if (category) md += `分类: ${category}\n`;
  if (authors) md += `作者: ${authors}\n`;
  md += `${summary}\n`;
  const links = [];
  if (detailUrl) links.push(`[📖 详细解读](${detailUrl})`);
  if (arxivUrl) links.push(`[arXiv](${arxivUrl})`);
  if (links.length) md += `${links.join("  |  ")}`;

  // 纯文本版本
  let text = `📄 [${index}/${total}] ${title}\n`;
  if (category) text += `分类: ${category}\n`;
  if (authors) text += `作者: ${authors}\n`;
  text += `${summary}\n`;
  if (detailUrl) text += `📖 详细解读: ${detailUrl}\n`;
  if (arxivUrl) text += `arXiv: ${arxivUrl}`;

  return { markdown: md, text };
}

/* ── 向单个应用发送所有新论文 ─────────────────────────── */

async function sendToApp(app, newPapers, siteUrl) {
  const label = app.name || `corpid:${(app.corpid || "").slice(0, 8)}...`;
  console.log(`\n── 发送到: ${label} (${newPapers.length} 篇新论文)`);

  if (!app.corpid || !app.corpsecret || !app.agentid) {
    console.error(`   ❌ 缺少必要字段 (corpid / corpsecret / agentid)，跳过。`);
    return { success: 0, fail: newPapers.length };
  }

  let token;
  try {
    token = await getAccessToken(app.corpid, app.corpsecret);
  } catch (err) {
    console.error(`   ❌ 获取 token 失败: ${err.message}`);
    return { success: 0, fail: newPapers.length };
  }

  // 先发送一条统计汇总消息
  try {
    const summaryMd = buildSummaryMessage(newPapers.length, siteUrl);
    try {
      await sendMarkdownMessage(token, {
        agentid: app.agentid,
        touser: app.touser,
        toparty: app.toparty,
        totag: app.totag,
        content: summaryMd.markdown,
      });
    } catch {
      await sendTextMessage(token, {
        agentid: app.agentid,
        touser: app.touser,
        toparty: app.toparty,
        totag: app.totag,
        content: summaryMd.text,
      });
    }
    console.log(`   ✅ 统计汇总消息已发送`);
    await new Promise((r) => setTimeout(r, 200));
  } catch (err) {
    console.warn(`   ⚠️  统计汇总消息发送失败: ${err.message}`);
  }

  let success = 0;
  let fail = 0;

  for (let i = 0; i < newPapers.length; i++) {
    const paper = newPapers[i];
    const { markdown, text } = buildPaperMessage(paper, i + 1, newPapers.length, siteUrl);
    const shortTitle = (paper.title || "").slice(0, 30);

    try {
      // 优先 Markdown，失败降级纯文本
      try {
        await sendMarkdownMessage(token, {
          agentid: app.agentid,
          touser: app.touser,
          toparty: app.toparty,
          totag: app.totag,
          content: markdown,
        });
      } catch {
        await sendTextMessage(token, {
          agentid: app.agentid,
          touser: app.touser,
          toparty: app.toparty,
          totag: app.totag,
          content: text,
        });
      }
      console.log(`   ✅ [${i + 1}/${newPapers.length}] ${shortTitle}...`);
      success++;
    } catch (err) {
      console.error(`   ❌ [${i + 1}/${newPapers.length}] ${shortTitle}... 失败: ${err.message}`);
      fail++;
    }

    // 限流：每条消息间隔 200ms，避免触发企业微信频率限制
    if (i < newPapers.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return { success, fail };
}

/* ── 主流程 ──────────────────────────────────────────── */

async function main() {
  // 1. 解析应用列表
  let apps;
  try {
    apps = JSON.parse(WECOM_APPS_RAW);
  } catch (e) {
    console.error("❌ WECOM_APPS 不是合法的 JSON:", e.message);
    process.exit(1);
  }

  if (!Array.isArray(apps) || apps.length === 0) {
    console.log("⚠️  WECOM_APPS 为空或未配置，跳过企业微信通知。");
    return;
  }

  // 2. 检测新增论文
  const newPapers = findNewPapers();

  if (newPapers.length === 0) {
    console.log("📭 没有新增论文，跳过通知。");
    return;
  }

  console.log(`📬 检测到 ${newPapers.length} 篇新论文，准备向 ${apps.length} 个应用发送通知...\n`);

  for (const p of newPapers) {
    const cat = p.category ? `[${p.category}] ` : "";
    console.log(`   • ${cat}${p.title}`);
  }

  // 3. 逐个应用发送
  let totalSuccess = 0;
  let totalFail = 0;

  for (const app of apps) {
    const result = await sendToApp(app, newPapers, SITE_URL);
    totalSuccess += result.success;
    totalFail += result.fail;
  }

  console.log(`\n📊 发送完成: ${totalSuccess} 成功, ${totalFail} 失败`);

  if (totalFail > 0 && totalSuccess === 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ 通知脚本异常:", err);
  process.exit(1);
});
