/**
 * 重新生成脚本：找出 papers.json 中 imageUrls 为空的论文，
 * 通过 PDF 提取全文后重新生成摘要，替换原有内容。
 *
 * 用法：
 *   $env:LLM_PROVIDER="deepseek"
 *   $env:LLM_MODEL="deepseek-v3.2"
 *   $env:LLM_API_KEY="你的key"
 *   node scripts/regen_empty.js
 *
 * 可选：
 *   BATCH_SIZE  — 本次最多处理多少篇（默认全部）
 */

const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const pdfParse = require("pdf-parse");
const { OUTPUT_PATH } = require("./config");
const { runConcurrent, generateSummary, generateDetailedSummary } = require("./llm");
const { normalizeArxivId } = require("./arxiv");

const fetchArxivPdfText = async (absUrl) => {
  try {
    const pdfUrl = absUrl.replace("/abs/", "/pdf/");
    console.log(`    Fetching PDF: ${pdfUrl}`);
    const r = await fetch(pdfUrl, { redirect: "follow" });
    if (!r.ok) {
      console.warn(`    PDF fetch failed: ${r.status}`);
      return "";
    }
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

  const data = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
  const items = data.items || [];

  // Find papers with empty imageUrls (no HTML preview was available)
  const needRegen = [];
  const keepAsIs = [];
  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    if (!p.imageUrls || p.imageUrls.length === 0) {
      needRegen.push({ index: i, paper: p });
    } else {
      keepAsIs.push(i);
    }
  }

  const batchSize = Number(process.env.BATCH_SIZE) || needRegen.length;
  const todo = needRegen.slice(0, batchSize);

  console.log(`总论文数: ${items.length}`);
  console.log(`imageUrls 为空（需重新生成）: ${needRegen.length}`);
  console.log(`本次处理: ${todo.length}`);

  if (!todo.length) {
    console.log("没有需要重新生成的论文。");
    return;
  }

  const generatedAt = new Date().toISOString();
  fs.mkdirSync(pagesDir, { recursive: true });

  // Save progress: update items in-place
  const saveProgress = () => {
    const payload = { ...data, generatedAt, items };
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

    // Also update index
    const indexItems = items.map((p) => ({
      id: p.id, title: p.title, arxivId: p.arxivId, date: p.date,
      authors: p.authors, category: p.category, summary: p.summary,
      tags: p.tags, updatedAt: p.updatedAt,
    }));
    const indexPath = path.resolve(__dirname, "..", "data", "papers-index.json");
    fs.writeFileSync(indexPath, JSON.stringify({ generatedAt, source: data.source, items: indexItems }));
  };

  let doneCount = 0;
  const total = todo.length;

  const tasks = todo.map(({ index, paper }) => async () => {
    const absUrl = (paper.url || paper.id || "").replace("http://", "https://");
    const arxivId = normalizeArxivId(absUrl);

    // Fetch full text from PDF
    const fullText = await fetchArxivPdfText(absUrl);
    if (!fullText) {
      console.warn(`  [SKIP] No PDF text for ${absUrl}`);
      doneCount++;
      return;
    }

    // Regenerate summaries
    const summary = await generateSummary({ title: paper.title, fullText });
    const detailedSummary = await generateDetailedSummary({ title: paper.title, fullText, imageUrls: [] });

    // Update in-place
    items[index] = {
      ...paper,
      summary: summary || paper.summary,
      detailedSummary: detailedSummary || paper.detailedSummary,
      updatedAt: generatedAt,
    };

    saveProgress();

    // Regenerate detail page
    const pageHtml = buildDetailPage(items[index]);
    const fileName = `${arxivId.replace(/[\/\\]/g, "_")}.html`;
    fs.writeFileSync(path.join(pagesDir, fileName), pageHtml);

    doneCount++;
    const pct = ((doneCount / total) * 100).toFixed(0);
    console.log(`  [Regen ${doneCount}/${total} ${pct}%] ${paper.title.slice(0, 60)} ✓`);
  });

  console.log(`\n开始重新生成，并发数: ${CONCURRENCY}`);
  await runConcurrent(tasks, CONCURRENCY);

  saveProgress();
  console.log(`\n========== 完成 ==========`);
  console.log(`重新生成了 ${doneCount} 篇论文的摘要`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
