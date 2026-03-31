"use strict";

const OpenAI = require("openai");

function isAiEnabled() {
  return (process.env.PR_AI || "").toLowerCase() === "true";
}

function requiredAiEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`PR_AI is enabled but missing ${name}`);
  return v;
}

function normalizeOpenAIBaseUrl(endpoint) {
  const u = new URL(endpoint);
  let path = u.pathname.replace(/\/$/, "");
  if (path.endsWith("/responses") || path.endsWith("/chat/completions")) {
    path = path.replace(/\/[^/]+$/, "");
    u.pathname = path || "/";
  }
  return u.toString().replace(/\/$/, "");
}

function getPrAiClient() {
  const apiKey = requiredAiEnv("PR_AI_API_KEY");
  const endpoint = requiredAiEnv("PR_AI_ENDPOINT");
  const baseURL = normalizeOpenAIBaseUrl(endpoint);
  return new OpenAI({ apiKey, baseURL });
}

function extractAllowedShortHashes(commits) {
  return commits.map(c => c.hash.slice(0, 7).toLowerCase());
}

function validateAiBullets(bullets, allowedHashes) {
  const minBullets = allowedHashes.length === 1 ? 1 : 2;
  const maxBullets = Math.min(12, Math.max(2, allowedHashes.length));

  if (!Array.isArray(bullets)) return false;
  if (bullets.length < minBullets || bullets.length > maxBullets) return false;

  const allowedSet = new Set(allowedHashes.map(h => h.toLowerCase()));

  for (const b of bullets) {
    if (typeof b !== "string") return false;

    const line = b.trim();

    if (!line.startsWith("- ")) return false;

    const hasAllowed = allowedHashes.some(h => line.toLowerCase().includes(h.toLowerCase()));
    if (!hasAllowed) return false;

    const looksLikeHash = line.match(/\b[a-f0-9]{7}\b/gi) || [];
    for (const h of looksLikeHash) {
      if (!allowedSet.has(h.toLowerCase())) return false;
    }
  }

  return true;
}

function replaceSummarySection(body, summaryBullets) {
  const replacement = ["## Summary (AI, bounded)", ...summaryBullets, ""].join("\n");
  return body.replace(/## Summary \(AI, bounded\)[\s\S]*?\n\n/, `${replacement}\n`);
}

async function generateAiSummary({ title, commits, fileChanges, allowedHashes }) {
  const openai = getPrAiClient();
  const model = process.env.PR_AI_MODEL || "gpt-4o-mini";
  const minBullets = Math.min(6, allowedHashes.length);
  const maxBullets = Math.min(12, allowedHashes.length);
  const targetBullets = Math.min(10, Math.ceil(allowedHashes.length * 0.8));

  const system = [
    "You write pull request summaries for an enterprise repo.",
    "You MUST NOT invent changes, files, or behaviors.",
    "You may ONLY summarize what is present in the provided commits and file list.",
    `Output MUST contain between ${minBullets} and ${maxBullets} bullet points.`,
    `Aim for ${targetBullets} bullet points.`,
    "Each bullet MUST reference a DIFFERENT commit when possible.",
    "EACH bullet MUST include at least one allowed short commit hash (7 chars).",
    "Do not add headings. Bullets only.",
    "Do not collapse multiple commits into a single generic bullet.",
  ].join(" ");

  const commitList = commits.map(c => `- ${c.hash.slice(0, 7)} ${c.subjectLine}`).join("\n");
  const fileList = fileChanges.files.map(f => `- ${f.status} ${f.path}`).join("\n") || "- (none)";
  const diffStat = fileChanges.stat || "(no diff)";

  const user = [
    `PR Title: ${title}`,
    "",
    `Allowed short hashes: ${allowedHashes.join(", ")}`,
    "",
    "Commits in this PR:",
    commitList,
    "",
    "Files changed:",
    fileList,
    "",
    "Diff stats:",
    diffStat,
    "",
    "Write the PR Summary bullets now.",
  ].join("\n");

  const response = await openai.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const text = response.choices?.[0]?.message?.content?.trim() || "";

  const bullets = String(text)
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => s.startsWith("- "));

  return bullets;
}

async function generateAiLabelsAndChecklist({ title, body, commits }) {
  const openai = getPrAiClient();
  const model = process.env.PR_AI_MODEL || "gpt-4o-mini";

  const system = [
    "You suggest GitHub PR labels and a short review checklist for the author/CI.",
    "Output ONLY valid markdown in this exact structure (no extra text):",
    "## Suggested labels / Review checklist",
    "",
    "**Suggested labels:** (comma-separated or bullet list; use common labels like docs, frontend, a11y, testing)",
    "",
    "**Review checklist:**",
    "- [ ] Item 1 (e.g. Verify EE, Check a11y, Test in X)",
    "- [ ] Item 2",
    "Keep checklist to 3–6 items. Base suggestions only on the PR title, summary, and commit list.",
  ].join("\n");

  const commitList = commits.map(c => `- ${c.hash.slice(0, 7)} ${c.subjectLine}`).join("\n");
  const user = [
    `PR Title: ${title}`,
    "",
    "PR body (excerpt):",
    body.slice(0, 4000),
    "",
    "Commits:",
    commitList,
    "",
    'Output the "Suggested labels / Review checklist" section only.',
  ].join("\n");

  const response = await openai.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const text = response.choices?.[0]?.message?.content?.trim() || "";
  const trimmed = String(text).trim();
  if (!trimmed) return "";
  return trimmed.startsWith("## ") ? trimmed : `## Suggested labels / Review checklist\n\n${trimmed}`;
}

module.exports = {
  isAiEnabled,
  extractAllowedShortHashes,
  validateAiBullets,
  replaceSummarySection,
  generateAiSummary,
  generateAiLabelsAndChecklist,
};
