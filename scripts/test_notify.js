/**
 * 本地测试企业微信推送
 *
 * 使用方法:
 *   1. 编辑 .env 文件，填入真实的 WECOM_APPS 配置
 *   2. 运行: node scripts/test_notify.js
 *      默认会模拟"前 3 篇论文是新增的"来测试发送
 *   3. 可选: node scripts/test_notify.js --all   发送所有论文（慎用）
 *   4. 可选: node scripts/test_notify.js --count 5   模拟 5 篇新增
 *
 * 脚本会读取 .env，构造 old/new 论文对比，然后调用 notify_wecom.js 发送。
 */

const fs = require("fs");
const path = require("path");

/* ── 读取 .env 文件并注入环境变量 ──────────────────── */

function loadEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    console.error("❌ 未找到 .env 文件，请先创建并填入配置。");
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
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnv();

/* ── 验证配置 ────────────────────────────────────────── */

let apps;
try {
  apps = JSON.parse(process.env.WECOM_APPS || "[]");
} catch (e) {
  console.error("❌ WECOM_APPS 不是合法的 JSON:", e.message);
  process.exit(1);
}

if (!Array.isArray(apps) || apps.length === 0) {
  console.error("❌ WECOM_APPS 为空，请在 .env 中配置至少一个企业微信应用。");
  console.error("   格式: WECOM_APPS=[{\"corpid\":\"...\",\"corpsecret\":\"...\",\"agentid\":123}]");
  process.exit(1);
}

console.log("========================================");
console.log("  企业微信推送本地测试");
console.log("========================================\n");

console.log(`📋 检测到 ${apps.length} 个应用配置:\n`);
for (let i = 0; i < apps.length; i++) {
  const a = apps[i];
  const name = a.name || "(未命名)";
  const corpidPreview = a.corpid ? a.corpid.slice(0, 10) + "..." : "❌ 缺失";
  const secretPreview = a.corpsecret ? a.corpsecret.slice(0, 6) + "****" : "❌ 缺失";
  const agentid = a.agentid || "❌ 缺失";
  const touser = a.touser || "(默认 @all)";
  console.log(`  [${i + 1}] ${name}`);
  console.log(`      corpid:     ${corpidPreview}`);
  console.log(`      corpsecret: ${secretPreview}`);
  console.log(`      agentid:    ${agentid}`);
  console.log(`      touser:     ${touser}`);
  if (a.toparty) console.log(`      toparty:    ${a.toparty}`);
  if (a.totag) console.log(`      totag:      ${a.totag}`);
  console.log();
}

// 检查论文数据
const papersPath = path.resolve(__dirname, "..", "data", "papers-index.json");
if (!fs.existsSync(papersPath)) {
  console.error(`❌ 论文数据文件不存在: ${papersPath}`);
  console.error("   请先运行 node scripts/fetch_papers.js 获取论文数据。");
  process.exit(1);
}

const papersData = JSON.parse(fs.readFileSync(papersPath, "utf-8"));
const allPapers = papersData.items || [];
console.log(`📄 论文数据: ${allPapers.length} 篇论文`);
console.log(`📅 生成时间: ${papersData.generatedAt || "未知"}\n`);

if (allPapers.length === 0) {
  console.error("❌ 没有论文数据，无法测试。");
  process.exit(1);
}

/* ── 解析参数，决定模拟多少篇新论文 ───────────────── */

const args = process.argv.slice(2);
let testCount = 3; // 默认模拟 3 篇新增

if (args.includes("--all")) {
  testCount = allPapers.length;
} else {
  const countIdx = args.indexOf("--count");
  if (countIdx !== -1 && args[countIdx + 1]) {
    testCount = Math.min(parseInt(args[countIdx + 1], 10) || 3, allPapers.length);
  }
}

const simulatedNew = allPapers.slice(0, testCount);
console.log(`🧪 测试模式: 模拟 ${simulatedNew.length} 篇新增论文:\n`);
for (const p of simulatedNew) {
  const cat = p.category ? `[${p.category}] ` : "";
  console.log(`   • ${cat}${p.title}`);
}
console.log();

const siteUrl = process.env.SITE_URL;
if (siteUrl) {
  console.log(`🔗 站点链接: ${siteUrl}\n`);
}

/* ── 构造 old index (排除模拟新增的论文) 并运行 ────── */

const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question(`⚠️  确认发送 ${simulatedNew.length} 条测试消息到以上企业微信应用？(y/N) `, async (answer) => {
  rl.close();

  if (answer.trim().toLowerCase() !== "y") {
    console.log("已取消。");
    return;
  }

  console.log("\n🚀 开始发送...\n");

  // 构造 old index：去掉 simulatedNew 的论文，让 notify 脚本以为它们是新增的
  const newIds = new Set(simulatedNew.map((p) => p.id || p.url));
  const oldItems = allPapers.filter((p) => !newIds.has(p.id || p.url));
  const oldIndex = { generatedAt: papersData.generatedAt, source: papersData.source, items: oldItems };

  const oldPath = path.resolve(__dirname, "..", "data", "papers-index-old.json");
  fs.writeFileSync(oldPath, JSON.stringify(oldIndex));

  // 设置环境变量，让 notify_wecom.js 能找到 old index
  process.env.OLD_PAPERS_JSON = oldPath;

  try {
    require("./notify_wecom.js");
  } catch (err) {
    console.error("❌ 执行出错:", err.message);
    process.exit(1);
  }
});

