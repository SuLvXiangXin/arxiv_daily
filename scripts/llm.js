const { LLM_ENABLE, LLM_PROVIDER, LLM_MODEL, LLM_API_KEY } = require("./config");

/* ── helpers ─────────────────────────────────────────── */

const fallbackSummary = (title) =>
  `论文标题为 "${title}"，本文关注机器人相关问题，给出方法与实验结果概述。`;

const fallbackDetailed = (title) =>
  `## 概述\n\n本文题为 "${title}"，聚焦于机器人领域的关键挑战。\n\n` +
  `## 方法\n\n文章提出了一种新颖的技术方案。\n\n` +
  `## 实验与结论\n\n实验表明该方法在基准测试中取得了有竞争力的结果。`;

const callLLM = async (systemPrompt, userPrompt, maxTokens = 220, { enableThinking = false } = {}) => {
  const controller = new AbortController();
  // Thinking mode needs more time (up to 300s), normal mode 120s
  const timeout = enableThinking ? 300000 : 120000;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const model = LLM_MODEL || "deepseek-v3.2";

  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: enableThinking ? 0.6 : 0.4,
    max_tokens: maxTokens,
  };

  // Enable thinking for deepseek-v3.2 / v3.1
  if (enableThinking) {
    body.enable_thinking = true;
  }

  try {
    const response = await fetch(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LLM_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn(`LLM API error: ${response.status} ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await response.json();
    const msg = data?.choices?.[0]?.message;
    if (enableThinking && msg?.reasoning_content) {
      console.log(`  [Thinking] ${msg.reasoning_content.length} chars of reasoning`);
    }
    return msg?.content?.trim() || null;
  } catch (error) {
    console.warn("LLM call failed:", error.message);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

/* ── concurrency helper ──────────────────────────────── */

const runConcurrent = async (tasks, concurrency) => {
  const results = new Array(tasks.length);
  let nextIdx = 0;

  const worker = async () => {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      results[idx] = await tasks[idx]();
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
  );
  return results;
};

/* ── relevance filter (batch screen by title) ────────── */

const FILTER_SYSTEM_PROMPT = `你是一个机器人学论文筛选助手。你需要判断每篇论文是否与以下研究方向相关：
- VLA (Vision-Language-Action) 模型
- 机器人操控 (manipulation, grasping, dexterous hand)
- 全身控制 (whole-body control, locomotion + manipulation)
- 机器人策略学习 (imitation learning, reinforcement learning for robotics)
- 具身智能 (embodied AI, embodied agent)
- 机器人感知用于操控 (tactile sensing, pose estimation for manipulation)

不相关的方向包括：纯自动驾驶、纯SLAM/建图、纯NLP、纯计算机视觉（无机器人应用）、纯理论优化、医疗影像、无人机路径规划等。

对于每篇论文，只输出序号。只输出相关的论文序号，用逗号分隔，例如: 1,3,5,8
如果没有相关论文则输出: 无`;

const FILTER_CONCURRENCY = 5;  // parallel LLM filter calls

const filterByRelevance = async (items) => {
  if (!LLM_ENABLE || !LLM_PROVIDER || !LLM_API_KEY) {
    return items; // no LLM → keep all
  }

  const BATCH = 40;
  const totalBatches = Math.ceil(items.length / BATCH);
  let completedBatches = 0;

  // Build all batch tasks
  const batches = [];
  for (let i = 0; i < items.length; i += BATCH) {
    batches.push(items.slice(i, i + BATCH));
  }

  const tasks = batches.map((batch, batchIdx) => async () => {
    const titleList = batch
      .map((item, idx) => `${idx + 1}. ${item.title}`)
      .join("\n");

    const result = await callLLM(
      FILTER_SYSTEM_PROMPT,
      `以下是待筛选的论文标题列表：\n${titleList}`,
      200
    );

    completedBatches++;
    const pct = ((completedBatches / totalBatches) * 100).toFixed(0);

    if (!result) {
      console.log(`  [Filter ${completedBatches}/${totalBatches} ${pct}%] batch ${batchIdx + 1} ⚠ LLM failed, keeping all ${batch.length}`);
      return batch;
    }

    if (result.trim() === "无") {
      console.log(`  [Filter ${completedBatches}/${totalBatches} ${pct}%] batch ${batchIdx + 1} → 0 kept`);
      return [];
    }

    const indices = result
      .match(/\d+/g)
      ?.map((n) => parseInt(n, 10) - 1)
      .filter((n) => n >= 0 && n < batch.length) || [];

    const kept = indices.map((idx) => batch[idx]);
    console.log(`  [Filter ${completedBatches}/${totalBatches} ${pct}%] batch ${batchIdx + 1} → ${kept.length} kept`);
    return kept;
  });

  console.log(`  Starting ${totalBatches} filter batches with concurrency=${FILTER_CONCURRENCY}...`);
  const results = await runConcurrent(tasks, FILTER_CONCURRENCY);
  const kept = results.flat();
  return kept;
};

/* ── short summary (card view) ───────────────────────── */

const generateSummary = async ({ title, fullText }) => {
  if (!LLM_ENABLE || !LLM_PROVIDER || !LLM_API_KEY) {
    return fallbackSummary(title);
  }

  // Use first ~4000 chars of full text for short summary
  const context = fullText ? fullText.slice(0, 4000) : "";
  const userContent = context
    ? `论文标题: ${title}\n\n论文正文节选:\n${context}`
    : `论文标题: ${title}`;

  const result = await callLLM(
    "你是机器人/AI论文助手。根据提供的论文标题和正文内容，用中文写一段精准的简短总结，100-160字。\n" +
      "要求：\n" +
      "1. 准确描述论文要解决的核心问题\n" +
      "2. 提炼关键技术方法的名称和要点\n" +
      "3. 给出核心实验结论或性能提升数据\n" +
      "不要编造论文中没有的内容。语言简洁有力。",
    userContent,
    300,
    { enableThinking: true }
  );
  return result || fallbackSummary(title);
};

/* ── detailed summary (detail page) ──────────────────── */

const generateDetailedSummary = async ({ title, fullText, imageUrls }) => {
  if (!LLM_ENABLE || !LLM_PROVIDER || !LLM_API_KEY) {
    return fallbackDetailed(title);
  }

  // Feed up to ~32000 chars of full text for detailed summary
  const context = fullText ? fullText.slice(0, 32000) : "";
  const imgList = (imageUrls || [])
    .map((url, i) => `- 图${i + 1}: ${url}`)
    .join("\n");

  const userContent = context
    ? `论文标题: ${title}\n\n论文正文:\n${context}\n\n论文图片链接:\n${imgList}`
    : `论文标题: ${title}`;

  const result = await callLLM(
    `你是一位资深的机器人/AI领域论文解读专家。你的任务是根据提供的论文全文内容，用中文撰写一篇详尽、高质量的论文解读，目标读者是对该领域有一定基础但没读过这篇论文的研究者。

严格要求：
- 直接从正文内容开始，禁止任何开场白、自我介绍或过渡语（如"好的"、"我将为您"、"作为专家"等）
- 第一行必须是 ## 研究背景与动机
- 所有内容必须基于论文原文，绝对不得编造任何方法名、数据或结论
- 引用论文图片时使用格式: 先放图片 ![描述](图片URL)，然后另起一行用 > 引用块写图注说明，例如：
  ![方法框架](https://...)
  > **图1**：方法整体框架。左侧为...，右侧为...
- 图片与图注应作为独立段落，前后各空一行，与正文明确分隔
- 不要遗漏任何重要的技术细节

请严格按照以下结构组织，总字数 800-1500 字：

## 研究背景与动机
- 该领域目前主流方法是什么？存在哪些关键局限性？
- 本文针对哪个具体痛点，提出了什么新视角？
- 用 1-2 句话概括本文的核心思路

## 方法详解
这是最重要的部分，需要让读者真正理解方法的工作原理：
- 整体框架/pipeline 是什么？各阶段的输入输出是什么？
- 核心模块分别是什么？每个模块的具体作用和技术细节（网络结构、损失函数、优化策略等）
- 与现有方法相比，创新点具体体现在哪里？
- **必须插入 pipeline/框架总览图**（通常是论文中的第一张或第二张图）
- 如果有其他说明方法细节的图，也请插入

## 实验与结果
- 明确列出使用了哪些 benchmark/数据集/实验平台
- 对比了哪些 baseline 方法
- 用文字总结关键实验结果（包括具体数值，如成功率、准确率、提升百分比等）
- **必须插入所有实验结果相关的图表**（对比图、消融实验图、定性结果图等），每张图后附 1-2 句文字说明该图展示的要点
- 如果有消融实验，总结每个组件的贡献

## 总结与启发
- 概括本文 2-3 个核心贡献
- 指出论文自身提到的局限性（如果有）
- 对后续研究的启示`,
    userContent,
    8000,
    { enableThinking: true }
  );
  return result || fallbackDetailed(title);
};

module.exports = {
  runConcurrent,
  filterByRelevance,
  generateSummary,
  generateDetailedSummary,
};
