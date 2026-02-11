const listEl = document.getElementById("paper-list");
const lastUpdatedEl = document.getElementById("last-updated");
const paperCountEl = document.getElementById("paper-count");
const searchInput = document.getElementById("search-input");
const searchCountEl = document.getElementById("search-count");

let allPapers = [];

const formatDate = (value) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const renderEmpty = () => {
  listEl.innerHTML = "<div class=\"paper-card\">暂无数据，稍后将自动更新。</div>";
  paperCountEl.textContent = "0";
  lastUpdatedEl.textContent = "--";
};

const buildCard = (paper, index) => {
  const card = document.createElement("article");
  card.className = "paper-card";
  card.style.animationDelay = `${Math.min(index * 0.05, 0.3)}s`;
  card.style.cursor = "pointer";

  const detailFile = `papers/${(paper.arxivId || "").replace(/[\/\\]/g, "_")}.html`;

  card.addEventListener("click", (e) => {
    if (e.target.tagName === "A") return; // let explicit links work
    window.location.href = detailFile;
  });

  const title = document.createElement("h3");
  const link = document.createElement("a");
  link.href = detailFile;
  link.textContent = paper.title || "未命名论文";
  title.appendChild(link);

  const meta = document.createElement("div");
  meta.className = "paper-meta";
  meta.innerHTML = `
    <span>${paper.category || "Robotics"}</span>
    <span>arXiv: ${paper.arxivId || "--"}</span>
    <span>${paper.authors || ""}</span>
    <span>${paper.date || ""}</span>
  `;

  const summary = document.createElement("p");
  summary.className = "paper-summary";
  summary.textContent = paper.summary || "摘要生成中...";

  const tags = document.createElement("div");
  tags.className = "paper-tags";
  (paper.tags || []).slice(0, 4).forEach((tag) => {
    const tagEl = document.createElement("span");
    tagEl.textContent = tag;
    tags.appendChild(tagEl);
  });

  card.append(title, meta, summary);
  if (tags.childElementCount) {
    card.appendChild(tags);
  }

  return card;
};

const loadPapers = async () => {
  try {
    const response = await fetch("data/papers.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to fetch data");
    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];

    if (!items.length) {
      renderEmpty();
      return;
    }

    const sorted = items
      .slice()
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    allPapers = sorted;
    renderPapers(allPapers);
    paperCountEl.textContent = String(sorted.length);
    lastUpdatedEl.textContent = formatDate(data.generatedAt);

    // Render LaTeX math after cards are in DOM
    if (typeof renderMathInElement === "function") {
      renderMathInElement(document.body, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
        ],
        throwOnError: false,
      });
    }
  } catch (error) {
    console.error(error);
    renderEmpty();
  }
};

const renderPapers = (papers) => {
  listEl.innerHTML = "";
  if (!papers.length) {
    listEl.innerHTML = "<div class=\"paper-card\">没有找到匹配的论文。</div>";
  } else {
    papers.forEach((paper, index) => listEl.appendChild(buildCard(paper, index)));
  }
};

const filterPapers = () => {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) {
    renderPapers(allPapers);
    searchCountEl.textContent = "";
    return;
  }
  const keywords = query.split(/\s+/);
  const filtered = allPapers.filter((p) => {
    const title = (p.title || "").toLowerCase();
    return keywords.every((kw) => title.includes(kw));
  });
  renderPapers(filtered);
  searchCountEl.textContent = `${filtered.length} / ${allPapers.length}`;
};

searchInput.addEventListener("input", filterPapers);

loadPapers();
