const path = require("path");

const SOURCE_URL = "https://jiangranlv.github.io/robotics_arXiv_daily/";
const OUTPUT_PATH = path.join("data", "papers.json");
const MAX_ITEMS = Number(process.env.MAX_ITEMS || 60);
const LLM_ENABLE = String(process.env.LLM_ENABLE || "true") !== "false";

const LLM_PROVIDER = process.env.LLM_PROVIDER || "dashscope";
const LLM_MODEL = process.env.LLM_MODEL || "qwen-max";
const LLM_API_KEY = process.env.LLM_API_KEY || "";

module.exports = {
  SOURCE_URL,
  OUTPUT_PATH,
  MAX_ITEMS,
  LLM_ENABLE,
  LLM_PROVIDER,
  LLM_MODEL,
  LLM_API_KEY,
};
