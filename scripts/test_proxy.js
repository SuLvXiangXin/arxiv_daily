/**
 * 测试中转代理是否工作
 * 用法: node scripts/test_proxy.js
 *
 * 1. 先测健康检查
 * 2. 再通过代理发一条测试消息到企业微信
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

/* ── 读取 .env ── */
function loadEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    console.error("❌ 未找到 .env 文件");
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const PROXY_URL = process.env.WECOM_PROXY_URL || "http://139.196.242.83:9000/relay";
const PROXY_TOKEN = process.env.WECOM_PROXY_TOKEN || "4b9c3b50daec1ba4fa3d2d7049be9a4923b60a259f80bf3001bbf644728c8682";

let apps;
try {
  apps = JSON.parse(process.env.WECOM_APPS || "[]");
} catch (e) {
  console.error("❌ WECOM_APPS 解析失败:", e.message);
  process.exit(1);
}

if (!apps.length) {
  console.error("❌ WECOM_APPS 为空");
  process.exit(1);
}

/* ── HTTP 请求封装 ── */
function request(url, options, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname,
      method: options.method || "GET",
      headers: options.headers || {},
      timeout: 15000,
    };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("请求超时")); });
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  console.log("=========================================");
  console.log("  中转代理测试");
  console.log("=========================================\n");

  /* ── Step 1: 健康检查 ── */
  const healthUrl = PROXY_URL.replace("/relay", "/health");
  console.log(`1️⃣  健康检查: ${healthUrl}`);
  try {
    const res = await request(healthUrl, {});
    console.log(`   状态码: ${res.status}`);
    console.log(`   响应:   ${JSON.stringify(res.data)}`);
    if (res.status === 200) {
      console.log("   ✅ 代理服务正常\n");
    } else {
      console.log("   ❌ 代理返回非 200 状态\n");
      process.exit(1);
    }
  } catch (e) {
    console.error(`   ❌ 无法连接代理: ${e.message}`);
    console.error("   请检查: 服务是否运行、端口是否开放、网络是否可达\n");
    process.exit(1);
  }

  /* ── Step 2: 通过代理发送测试消息 ── */
  const app = apps[0];
  console.log(`2️⃣  通过代理发送测试消息`);
  console.log(`   应用: ${app.name || app.agentid}`);
  console.log(`   代理: ${PROXY_URL}\n`);

  const payload = {
    corpid: app.corpid,
    corpsecret: app.corpsecret,
    agentid: app.agentid,
    touser: app.touser || "@all",
    messages: [
      {
        msgtype: "text",
        agentid: app.agentid,
        touser: app.touser || "@all",
        content: "🔔 中转代理测试消息\n\n如果你收到这条消息，说明代理部署成功！\n\n" + new Date().toLocaleString("zh-CN"),
      },
    ],
  };

  try {
    const res = await request(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PROXY_TOKEN}`,
      },
    }, JSON.stringify(payload));

    console.log(`   状态码: ${res.status}`);
    console.log(`   响应:   ${JSON.stringify(res.data, null, 2)}`);

    if (res.status === 200 && res.data.success) {
      console.log("\n   ✅ 测试消息发送成功！请检查企业微信是否收到。");
    } else {
      console.log("\n   ❌ 发送失败，请查看上方响应和服务器日志。");
    }
  } catch (e) {
    console.error(`   ❌ 请求失败: ${e.message}`);
    process.exit(1);
  }

  console.log("\n=========================================");
}

main();
