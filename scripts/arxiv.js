const NEW_ID_RE = /^(\d{4}\.\d{4,5})(?:v\d+)?$/i;
const ARXIV_URL_RE = /arxiv\.org\/(abs|pdf|html)\/([^?#]+)/i;

const stripVersion = (id) => {
  if (!id) return "";
  return String(id).trim().replace(/v\d+$/i, "");
};

const normalizeArxivId = (input) => {
  if (!input) return "";
  const value = String(input).trim();

  const direct = value.match(NEW_ID_RE);
  if (direct) return direct[1];

  const urlMatch = value.match(ARXIV_URL_RE);
  if (!urlMatch) return "";

  let raw = urlMatch[2].replace(/\.pdf$/i, "").replace(/\/$/, "");
  raw = decodeURIComponent(raw);

  const fromUrl = raw.match(NEW_ID_RE);
  if (!fromUrl) return "";
  return fromUrl[1];
};

const toAbsUrl = (input) => {
  const arxivId = normalizeArxivId(input);
  if (!arxivId) return "";
  return `https://arxiv.org/abs/${arxivId}`;
};

const normalizeArxivInput = (input) => {
  const arxivId = normalizeArxivId(input);
  if (!arxivId) return null;
  return {
    arxivId,
    absUrl: toAbsUrl(arxivId),
  };
};

module.exports = {
  stripVersion,
  normalizeArxivId,
  toAbsUrl,
  normalizeArxivInput,
};
