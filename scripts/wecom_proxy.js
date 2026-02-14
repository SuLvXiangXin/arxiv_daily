/**
 * 企业微信消息中转代理 — 云函数版本
 *
 * 部署在有固定 IP 的云函数或服务器上，接收 GitHub Actions
 * 发来的请求，代为调用企业微信 API 发送消息。
 *
 * 请求格式:
 *   POST /relay
 *   Headers: { "Authorization": "Bearer <PROXY_TOKEN>" }
 *   Body: {
 *     "corpid": "...",
 *     "corpsecret": "...",
 *     "messages": [
 *       {
 *         "msgtype": "markdown",   // 或 "text"
 *         "agentid": 1000002,
 *         "touser": "@all",        // 可选
 *         "toparty": "",           // 可选
 *         "totag": "",             // 可选
 *         "content": "消息内容"
 *       },
 *       ...
 *     ]
 *   }
 *
 * 环境变量:
 *   PROXY_TOKEN  – 鉴权 token，防止接口被滥用（必填）
 *   PORT         – 监听端口，默认 9000
 *
 * 部署步骤（以阿里云函数计算为例）：
 *   1. 创建 HTTP 函数，运行时选 Node.js 20
 *   2. 上传此文件
 *   3. 设置环境变量 PROXY_TOKEN
 *   4. 为函数绑定固定出口 IP（弹性公网 IP）
 *   5. 将该 IP 加入企业微信应用的可信 IP
 *
 * 也可直接在服务器上运行: PORT=9000 PROXY_TOKEN=xxx node wecom_proxy.js
 */

const http = require("http");
const https = require("https");

const PORT = parseInt(process.env.PORT || "9000", 10);
const PROXY_TOKEN = process.env.PROXY_TOKEN || "";

/* ── HTTP 工具 ───────────────────────────────────────── */

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(data)); }
      });
    }).on("error", reject);
  });
}

function httpsPostJson(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(data)); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/* ── 企业微信 API ────────────────────────────────────── */

async function getAccessToken(corpid, corpsecret) {
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpid)}&corpsecret=${encodeURIComponent(corpsecret)}`;
  const res = await httpsGet(url);
  if (res.errcode !== 0) throw new Error(`获取token失败: ${res.errmsg}`);
  return res.access_token;
}

async function sendMessage(accessToken, msg) {
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;
  const body = { msgtype: msg.msgtype, agentid: msg.agentid };

  if (msg.touser) body.touser = msg.touser;
  if (msg.toparty) body.toparty = msg.toparty;
  if (msg.totag) body.totag = msg.totag;
  if (!body.touser && !body.toparty && !body.totag) body.touser = "@all";

  if (msg.msgtype === "markdown") {
    body.markdown = { content: msg.content };
  } else {
    body.text = { content: msg.content };
  }

  const res = await httpsPostJson(url, body);
  if (res.errcode !== 0) throw new Error(`发送失败: errcode=${res.errcode}, ${res.errmsg}`);
  return res;
}

/* ── HTTP 服务 ───────────────────────────────────────── */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function respond(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    return respond(res, 200, { status: "ok" });
  }

  // Only accept POST /relay
  if (req.method !== "POST" || !req.url.startsWith("/relay")) {
    return respond(res, 404, { error: "Not found" });
  }

  // Auth check
  if (PROXY_TOKEN) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${PROXY_TOKEN}`) {
      return respond(res, 401, { error: "Unauthorized" });
    }
  }

  try {
    const body = JSON.parse(await readBody(req));
    const { corpid, corpsecret, messages, agentid, touser, toparty, totag } = body;

    if (!corpid || !corpsecret || !Array.isArray(messages)) {
      return respond(res, 400, { error: "Missing corpid, corpsecret, or messages" });
    }

    // 获取 access_token
    const token = await getAccessToken(corpid, corpsecret);

    // 逐条发送（顶层 agentid/touser 作为 fallback）
    const results = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = Object.assign({}, messages[i]);
      if (!msg.agentid && agentid) msg.agentid = agentid;
      if (!msg.touser && !msg.toparty && !msg.totag) {
        msg.touser = touser || "@all";
      }
      try {
        await sendMessage(token, msg);
        results.push({ index: i, ok: true });
      } catch (err) {
        results.push({ index: i, ok: false, error: err.message });
      }
      // 限流
      if (i < messages.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    const successCount = results.filter((r) => r.ok).length;
    respond(res, 200, { success: successCount, fail: results.length - successCount, results });
  } catch (err) {
    respond(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`🚀 企业微信中转代理已启动 — http://0.0.0.0:${PORT}/relay`);
  if (!PROXY_TOKEN) {
    console.warn("⚠️  警告: 未设置 PROXY_TOKEN，接口无鉴权保护！");
  }
});
