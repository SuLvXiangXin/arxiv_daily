/**
 * 补全脚本：将 filter_cache.json 中标记为 kept 但尚未出现在 papers.json 中的论文
 * 逐个抓取全文并生成摘要，追加到 papers.json。
 *
 * 用法：
 *   $env:LLM_PROVIDER="deepseek"
 *   $env:LLM_MODEL="deepseek-chat"
 *   $env:LLM_API_KEY="你的key"
 *   node scripts/backfill.js
 *
 * 可选环境变量：
 *   BATCH_SIZE  — 本次最多处理多少篇（默认不限，全部处理）
 */

const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const pdfParse = require("pdf-parse");
const { OUTPUT_PATH } = require("./config");
const { runConcurrent, generateSummary, generateDetailedSummary } = require("./llm");
const { normalizeArxivId } = require("./arxiv");

/* ── helpers (copied from fetch_papers.js) ────────────── */

const fetchArxivHtmlLink = async (absUrl) => {
  try {
    const r = await fetch(absUrl, { redirect: "follow" });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(
      /<a[^>]*href=["'](https:\/\/arxiv\.org\/html\/[^"']+)["'][^>]*id=["']latexml-download-link["']/i
    );
    if (m) return m[1];
    const m2 = html.match(/href=["'](https:\/\/arxiv\.org\/html\/[^"']+)["']/i);
    return m2 ? m2[1] : null;
  } catch {
    return null;
  }
};

const fetchArxivContent = async (htmlUrl) => {
  try {
    const r = await fetch(htmlUrl, { redirect: "follow" });
    if (!r.ok) return { fullText: "", imageUrls: [] };
    const html = await r.text();
    const baseUrl = htmlUrl.endsWith("/") ? htmlUrl : htmlUrl + "/";
    const imgMatches = [...html.matchAll(/<img[^>]*src=["']([^"']+)["'][^>]*/gi)];
    const imageUrls = imgMatches
      .map((m) => m[1])
      .filter((src) => !src.startsWith("data:"))
      .map((src) => (src.startsWith("http") ? src : new URL(src, baseUrl).href));
    const fullText = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    return { fullText, imageUrls };
  } catch (e) {
    console.warn(`Failed to fetch arXiv HTML: ${e.message}`);
    return { fullText: "", imageUrls: [] };
  }
};

const fetchArxivPdfText = async (absUrl) => {
  try {
    const pdfUrl = absUrl.replace("/abs/", "/pdf/");
    console.log(`    Fetching PDF: ${pdfUrl}`);
    const r = await fetch(pdfUrl, { redirect: "follow" });
    if (!r.ok) return "";
    const buffer = Buffer.from(await r.arrayBuffer());
    const data = await pdfParse(buffer);
    const text = (data.text || "").replace(/\s+/g, " ").trim();
    console.log(`    PDF text extracted: ${text.length} chars`);
    return text;
  } catch (e) {
    console.warn(`    Failed to extract PDF text: ${e.message}`);
    return "";
  }
};

const fetchAbsPageMeta = async (absUrl) => {
  try {
    const r = await fetch(absUrl, { redirect: "follow" });
    if (!r.ok) return null;
    const html = await r.text();

    // Title
    const titleM = html.match(/<meta\s+name=["']citation_title["']\s+content=["']([^"']+)["']/i);
    const title = titleM ? titleM[1] : "arXiv Paper";

    // Authors
    const authorMs = [...html.matchAll(/<meta\s+name=["']citation_author["']\s+content=["']([^"']+)["']/gi)];
    const authors = authorMs.map((m) => m[1]).join(", ");

    // Date
    const dateM = html.match(/<meta\s+name=["']citation_date["']\s+content=["']([^"']+)["']/i);
    const date = dateM ? dateM[1] : "";

    // Category from primary subject
    const catM = html.match(/primary-subject[^>]*>([^<]+)</i);
    const category = catM ? catM[1].trim() : "Robotics";

    return { title, authors, date, category };
  } catch {
    return null;
  }
};

/* ── build detail page (same as fetch_papers.js) ──────── */

const buildDetailPage = (paper) => {
  const bodyHtml = marked.parse(paper.detailedSummary || "", { breaks: true, gfm: true });
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${paper.title} - Robotics arXiv Daily</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet"/>
  <link rel="stylesheet" href="../assets/styles.css"/>
  <link rel="stylesheet" href="../assets/detail.css"/>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css"/>
</head>
<body>
  <div class="bg-orbit"></div>
  <header class="site-header">
    <div class="brand">
      <a href="../index.html" class="back-link">← 返回列表</a>
    </div>
  </header>
  <main class="detail-main">
    <article class="detail-card">
      <span class="detail-category">${paper.category || "Robotics"}</span>
      <h1>${paper.title}</h1>
      <div class="detail-meta">
        <span>arXiv: <a href="${paper.url}" target="_blank" rel="noreferrer">${paper.arxivId}</a></span>
        <span>作者: ${paper.authors || "--"}</span>
        <span>日期: ${paper.date || "--"}</span>
      </div>
      <section class="detail-body">
        <h2>📝 详细解读</h2>
        ${bodyHtml || "<p>摘要生成中...</p>"}
      </section>
      <section class="detail-tldr">
        <h2>💡 一句话总结</h2>
        <p>${paper.summary || "暂无"}</p>
      </section>
      <div class="detail-actions">
        <a href="${paper.url}" target="_blank" rel="noreferrer" class="btn">查看 arXiv 原文</a>
        <a href="../index.html" class="btn btn-outline">返回列表</a>
      </div>
    </article>
  </main>
  <footer class="site-footer">
    <span>数据来源：<a href="https://jiangranlv.github.io/robotics_arXiv_daily/" target="_blank">Robotics arXiv Daily</a></span>
    <span>由 GitHub Actions 自动更新 · AI 摘要仅供参考</span>
  </footer>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"
    onload="renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false})"></script>
</body>
</html>`;
};

/* ── main ─────────────────────────────────────────────── */

const CONCURRENCY = 16;

const main = async () => {
  const outputPath = path.resolve(__dirname, "..", OUTPUT_PATH);
  const pagesDir = path.resolve(__dirname, "..", "papers");
  const cachePath = path.resolve(__dirname, "..", "data", "filter_cache.json");

  // Load existing data
  let existing = { items: [] };
  try {
    existing = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
  } catch { /* empty */ }

  const filterCache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
  const keptUrls = filterCache.kept || [];

  // Find missing
  const savedUrls = new Set((existing.items || []).map((i) => i.url || i.id));
  const missing = keptUrls.filter((u) => !savedUrls.has(u));

  const batchSize = Number(process.env.BATCH_SIZE) || missing.length;
  const todo = missing.slice(0, batchSize);

  console.log(`papers.json 已有: ${existing.items.length}`);
  console.log(`filter_cache kept: ${keptUrls.length}`);
  console.log(`缺失: ${missing.length}`);
  console.log(`本次处理: ${todo.length}`);

  if (!todo.length) {
    console.log("没有需要补全的论文。");
    return;
  }

  const generatedAt = new Date().toISOString();
  const allItems = [...existing.items];

  // Save progress function
  const saveProgress = () => {
    const payload = { generatedAt, source: "backfill", items: [...allItems] };
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

    // Also update index
    const indexItems = allItems.map((p) => ({
      id: p.id, title: p.title, arxivId: p.arxivId, date: p.date,
      authors: p.authors, category: p.category, summary: p.summary,
      tags: p.tags, updatedAt: p.updatedAt,
    }));
    const indexPath = path.resolve(__dirname, "..", "data", "papers-index.json");
    fs.writeFileSync(indexPath, JSON.stringify({ generatedAt, source: "backfill", items: indexItems }));
  };

  fs.mkdirSync(pagesDir, { recursive: true });

  let doneCount = 0;
  const total = todo.length;

  const tasks = todo.map((url) => async () => {
    const arxivId = normalizeArxivId(url);
    const absUrl = url.replace("http://", "https://");

    // Fetch metadata from abs page
    const meta = await fetchAbsPageMeta(absUrl);
    if (!meta) {
      console.warn(`  [SKIP] Could not fetch metadata for ${url}`);
      doneCount++;
      return;
    }

    // Fetch full text
    const htmlLink = await fetchArxivHtmlLink(absUrl);
    let fullText = "";
    let imageUrls = [];
    if (htmlLink) {
      const content = await fetchArxivContent(htmlLink);
      fullText = content.fullText;
      imageUrls = content.imageUrls;
    }

    // Fallback: extract text from PDF if HTML unavailable
    if (!fullText) {
      fullText = await fetchArxivPdfText(absUrl);
    }

    // Generate summaries
    const summary = await generateSummary({ title: meta.title, fullText });
    const detailedSummary = await generateDetailedSummary({ title: meta.title, fullText, imageUrls });

    const paper = {
      id: url,
      title: meta.title,
      url,
      arxivId,
      date: meta.date,
      authors: meta.authors,
      category: meta.category,
      summary,
      detailedSummary,
      imageUrls,
      tags: meta.category ? [meta.category] : [],
      updatedAt: generatedAt,
    };

    allItems.push(paper);
    saveProgress();

    // Generate detail page
    const pageHtml = buildDetailPage(paper);
    const fileName = `${arxivId.replace(/[\/\\]/g, "_")}.html`;
    fs.writeFileSync(path.join(pagesDir, fileName), pageHtml);

    doneCount++;
    const pct = ((doneCount / total) * 100).toFixed(0);
    console.log(`  [Backfill ${doneCount}/${total} ${pct}%] ${meta.title.slice(0, 60)} ✓`);
  });

  console.log(`\n开始补全，并发数: ${CONCURRENCY}`);
  await runConcurrent(tasks, CONCURRENCY);

  // Final save
  saveProgress();

  console.log(`\n========== 完成 ==========`);
  console.log(`papers.json 现在共 ${allItems.length} 篇`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
