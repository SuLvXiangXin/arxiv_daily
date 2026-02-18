# Robotics arXiv Daily (Web)

This repo hosts a static site that displays the latest robotics papers from Robotics arXiv Daily. A GitHub Actions workflow periodically fetches the source page, generates short Chinese summaries, and writes data to `data/papers.json` for the site to render.

## How it works

- Static site: `index.html` + `assets/`
- Data source: `https://jiangranlv.github.io/robotics_arXiv_daily/`
- Scheduler: `.github/workflows/update.yml`
- Fetcher: `scripts/fetch_papers.js`
- User submit flow: homepage input -> GitHub Issue -> `.github/workflows/issue_add.yml`

## Configuration

Set these GitHub repository secrets if you want to connect an LLM:

- `LLM_PROVIDER` (string)
- `LLM_API_KEY` (string)
- `LLM_ENABLE` (`true` or `false`)
- `MAX_ITEMS` (optional, number)

If no LLM config is provided, the fetcher falls back to a generic Chinese summary based on the title.

## Local preview

Open `index.html` with any static server (or double-click for a quick check). The site reads `data/papers.json` directly.

## GitHub Pages

Enable GitHub Pages for the repository (root folder). The workflow will keep `data/papers.json` updated.

## Add a paper from web UI

- On homepage, use “手动补充论文” and paste arXiv `abs/pdf/html` link (or new ID like `2503.01078`).
- The page checks whether the paper already exists by normalized arXiv ID.
- If missing, click “提交入库” to open a prefilled GitHub Issue.
- `Add Paper From Issue` workflow will force-fetch and add the paper, then commit generated artifacts.
- The site updates asynchronously; refresh after workflow completion.

## Manual single-paper add (maintainer)

- Open Actions -> `Update Papers` -> `Run workflow`.
- Fill `arxiv_input` and set `force_add=true` to force ingest one paper.
