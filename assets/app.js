const listEl = document.getElementById("paper-list");
const lastUpdatedEl = document.getElementById("last-updated");
const paperCountEl = document.getElementById("paper-count");
const searchInput = document.getElementById("search-input");
const searchCountEl = document.getElementById("search-count");
const dateFromInput = document.getElementById("date-from");
const dateToInput = document.getElementById("date-to");
const dateClearBtn = document.getElementById("date-filter-clear");

let allPapers = [];
const PAGE_SIZE = 30;
let displayedCount = 0;
let currentList = []; // filtered or full list currently being viewed
let loading = false;

const formatDate = (value) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

/* ── skeleton placeholder ─────────────────────────────── */

const showSkeleton = () => {
  listEl.innerHTML = "";
  for (let i = 0; i < 6; i++) {
    const s = document.createElement("div");
    s.className = "paper-card skeleton-card";
    s.innerHTML = `
      <div class="sk-line sk-title"></div>
      <div class="sk-line sk-meta"></div>
      <div class="sk-line sk-body"></div>
      <div class="sk-line sk-body short"></div>
    `;
    listEl.appendChild(s);
  }
};

const renderEmpty = () => {
  listEl.innerHTML = "<div class=\"paper-card\">暂无数据，稍后将自动更新。</div>";
  paperCountEl.textContent = "0";
  lastUpdatedEl.textContent = "--";
};

/* ── build a single card (unchanged DOM structure) ───── */

const buildCard = (paper) => {
  const card = document.createElement("article");
  card.className = "paper-card";
  card.style.cursor = "pointer";

  const detailFile = `papers/${(paper.arxivId || "").replace(/[\/\\]/g, "_")}.html`;

  card.addEventListener("click", (e) => {
    if (e.target.tagName === "A") return;
    window.open(detailFile, "_blank", "noopener,noreferrer");
  });

  const title = document.createElement("h3");
  const link = document.createElement("a");
  link.href = detailFile;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
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
  // Render inline markdown (bold, italic, code)
  const summaryText = paper.summary || "摘要生成中...";
  summary.innerHTML = summaryText
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");

  const tags = document.createElement("div");
  tags.className = "paper-tags";
  (paper.tags || []).slice(0, 4).forEach((tag) => {
    const tagEl = document.createElement("span");
    tagEl.textContent = tag;
    tags.appendChild(tagEl);
  });

  card.append(title, meta, summary);
  if (tags.childElementCount) card.appendChild(tags);

  return card;
};

/* ── render next page ─────────────────────────────────── */

const renderNextPage = () => {
  if (displayedCount >= currentList.length) return;
  const fragment = document.createDocumentFragment();
  const end = Math.min(displayedCount + PAGE_SIZE, currentList.length);
  for (let i = displayedCount; i < end; i++) {
    fragment.appendChild(buildCard(currentList[i]));
  }
  listEl.appendChild(fragment);
  displayedCount = end;

  // update or remove sentinel
  updateSentinel();
};

/* ── infinite-scroll sentinel ─────────────────────────── */

let sentinel = null;
let observer = null;

const updateSentinel = () => {
  if (displayedCount >= currentList.length) {
    if (sentinel) { sentinel.remove(); sentinel = null; }
    return;
  }
  if (!sentinel) {
    sentinel = document.createElement("div");
    sentinel.className = "scroll-sentinel";
    sentinel.textContent = "加载更多...";
  }
  listEl.appendChild(sentinel);

  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading) {
        loading = true;
        requestAnimationFrame(() => {
          renderNextPage();
          loading = false;
        });
      }
    }, { rootMargin: "400px" });
  }
  observer.observe(sentinel);
};

/* ── render from scratch ──────────────────────────────── */

const renderPapers = (papers) => {
  listEl.innerHTML = "";
  displayedCount = 0;
  currentList = papers;
  if (sentinel) { sentinel.remove(); sentinel = null; }

  if (!papers.length) {
    listEl.innerHTML = "<div class=\"paper-card\">没有找到匹配的论文。</div>";
    return;
  }
  renderNextPage();
};

/* ── load data ────────────────────────────────────────── */

const loadPapers = async () => {
  showSkeleton();
  try {
    // Try lightweight index first, fall back to full file
    let response = await fetch("data/papers-index.json", { cache: "no-store" });
    if (!response.ok) {
      response = await fetch("data/papers.json", { cache: "no-store" });
    }
    if (!response.ok) throw new Error("Failed to fetch data");
    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];

    if (!items.length) {
      renderEmpty();
      return;
    }

    const sorted = items
      .slice()
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    allPapers = sorted;
    renderPapers(allPapers);
    paperCountEl.textContent = String(sorted.length);
    lastUpdatedEl.textContent = formatDate(data.generatedAt);

    // Dynamic hero panel stats
    updateHeroPanel(sorted);

    // Render LaTeX math after first page cards are in DOM
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

const filterPapers = () => {
  const query = searchInput.value.trim().toLowerCase();
  const dateFrom = dateFromInput.value; // "YYYY-MM-DD" or ""
  const dateTo = dateToInput.value;

  let filtered = allPapers;

  // Date range filter
  if (dateFrom || dateTo) {
    filtered = filtered.filter((p) => {
      const raw = (p.date || "").slice(0, 10);
      if (!raw) return false;
      // Normalize date separators: "2026/02/10" → "2026-02-10"
      const d = raw.replace(/\//g, "-");
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  }

  // Keyword filter
  if (query) {
    const keywords = query.split(/\s+/);
    filtered = filtered.filter((p) => {
      const title = (p.title || "").toLowerCase();
      return keywords.every((kw) => title.includes(kw));
    });
  }

  renderPapers(filtered);
  if (query || dateFrom || dateTo) {
    searchCountEl.textContent = `${filtered.length} / ${allPapers.length}`;
  } else {
    searchCountEl.textContent = "";
  }
};

searchInput.addEventListener("input", filterPapers);
dateFromInput.addEventListener("input", filterPapers);
dateFromInput.addEventListener("change", filterPapers);
dateToInput.addEventListener("input", filterPapers);
dateToInput.addEventListener("change", filterPapers);
dateClearBtn.addEventListener("click", () => {
  dateFromInput.value = "";
  dateToInput.value = "";
  document.querySelectorAll(".date-quick-btn").forEach((b) => b.classList.remove("active"));
  filterPapers();
});

/* ── quick date buttons ───────────────────────────────── */
document.querySelectorAll(".date-quick-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const days = Number(btn.dataset.days);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    dateFromInput.value = from.toISOString().slice(0, 10);
    dateToInput.value = to.toISOString().slice(0, 10);
    document.querySelectorAll(".date-quick-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    filterPapers();
  });
});

/* ── dynamic hero panel ────────────────────────────────── */

const updateHeroPanel = (papers) => {
  const todayCountEl = document.getElementById("today-count");
  const totalCountEl = document.getElementById("total-count");
  const hotTagsEl = document.getElementById("hot-tags");

  // Count today's papers (by date field, compare date string prefix)
  const today = new Date().toISOString().slice(0, 10);
  const todayPapers = papers.filter((p) => {
    const d = p.date || p.updatedAt || "";
    return d.startsWith(today);
  });

  // If no papers match today, count the most recent date
  let recentCount = todayPapers.length;
  if (recentCount === 0 && papers.length > 0) {
    const latestDate = (papers[0].date || "").slice(0, 10);
    recentCount = papers.filter((p) => (p.date || "").startsWith(latestDate)).length;
  }

  if (todayCountEl) todayCountEl.textContent = String(recentCount);
  if (totalCountEl) totalCountEl.textContent = String(papers.length);

  // Extract top category tags
  if (hotTagsEl) {
    const freq = {};
    papers.forEach((p) => {
      const cat = p.category || "";
      if (cat) freq[cat] = (freq[cat] || 0) + 1;
    });
    const topTags = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map((e) => e[0]);

    hotTagsEl.innerHTML = "";
    topTags.forEach((tag) => {
      const el = document.createElement("span");
      el.textContent = tag;
      hotTagsEl.appendChild(el);
    });
  }
};

loadPapers();
