"use strict";

require("dotenv").config();

const { buildDeterministicReleaseNotes } = require("./lib/conventional-notes.js");

function normalizeOpenAIBaseUrl(endpoint) {
  const u = new URL(endpoint);
  let path = u.pathname.replace(/\/$/, "");
  if (path.endsWith("/responses") || path.endsWith("/chat/completions")) {
    path = path.replace(/\/[^/]+$/, "");
    u.pathname = path || "/";
  }
  return u.toString().replace(/\/$/, "");
}

async function maybeGenerateAiSummary({ baseNotes, commitRefs, env }) {
  const enabled = (env.RELEASE_NOTES_AI || "").toLowerCase() === "true";
  const endpoint = env.RELEASE_NOTES_AI_ENDPOINT;
  const apiKey = env.RELEASE_NOTES_AI_API_KEY;
  const model = env.RELEASE_NOTES_AI_MODEL || "gpt-4o-mini";

  if (!enabled || !endpoint || !apiKey) return null;

  const system = [
    "You write release note summaries for enterprise change logs.",
    "You MUST NOT invent changes.",
    "You may ONLY summarize what appears in the provided release notes.",
    "Output MUST be 2-6 bullet points, each starting with '-'.",
    "At least one bullet MUST include a commit hash from the allowed list (e.g. 5da7620).",
    "No headings, no prose paragraphs, bullets only.",
  ].join(" ");

  const user = [
    "Allowed commit hashes:",
    commitRefs.join(", "),
    "",
    "Release notes source:",
    baseNotes,
  ].join("\n");

  const baseURL = normalizeOpenAIBaseUrl(endpoint);
  const url = `${baseURL}/chat/completions`;

  const body = {
    model,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  const debug = (env.RELEASE_NOTES_AI_DEBUG || "").toLowerCase() === "true";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    if (debug) {
      const errBody = await res.text();
      console.warn("[release-notes-ai] API non-OK: %s %s", res.status, errBody.slice(0, 300));
    }
    return null;
  }
  const data = await res.json();

  const raw =
    data.output_text ||
    data.text ||
    (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
    (data.output &&
      data.output[0] &&
      data.output[0].content &&
      data.output[0].content[0] &&
      data.output[0].content[0].text) ||
    "";
  const text = typeof raw === "string" ? raw : "";

  if (debug) console.warn("[release-notes-ai] response text length: %d", text.length);

  const bullets = text
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => s.startsWith("-"));

  if (debug) console.warn("[release-notes-ai] bullet count: %d (need >= 2)", bullets.length);

  if (bullets.length < 2) return null;

  const allowed = new Set(commitRefs);
  const atLeastOneHasHash = bullets.some(b => [...allowed].some(h => b.includes(h)));
  if (!atLeastOneHasHash) {
    if (debug) console.warn("[release-notes-ai] validation failed: no bullet cites a commit hash");
    return null;
  }

  return bullets.join("\n");
}

module.exports = {
  generateNotes: async (pluginConfig, context) => {
    const version = context.nextRelease?.version;
    const dateISO = new Date().toISOString().slice(0, 10);
    const commits = context.commits || [];

    const { notes: deterministicNotes, commitRefs } = buildDeterministicReleaseNotes({
      version,
      dateISO,
      commits,
    });

    const aiSummary = await maybeGenerateAiSummary({
      baseNotes: deterministicNotes,
      commitRefs,
      env: process.env,
    });

    if (!aiSummary) return deterministicNotes;

    return deterministicNotes.replace(
      "## Highlights",
      `## Summary (AI, bounded)\n${aiSummary}\n\n## Highlights`,
    );
  },
};
