"use strict";

require("../lib/load-project-env.js").loadProjectEnv();

const { buildDeterministicReleaseNotes } = require("./lib/conventional-notes.js");
const { createProvider } = require("../lib/providers/index.js");

async function maybeGenerateAiSummary({ baseNotes, commitRefs, env }) {
  const enabled = (env.RELEASE_NOTES_AI || "").toLowerCase() === "true";
  const endpoint = env.RELEASE_NOTES_AI_ENDPOINT;
  const apiKey = env.RELEASE_NOTES_AI_API_KEY;
  const model = env.RELEASE_NOTES_AI_MODEL || "gpt-4o-mini";
  const debug = (env.RELEASE_NOTES_AI_DEBUG || "").toLowerCase() === "true";

  if (!enabled || !endpoint || !apiKey) return null;

  const providerName = env.RELEASE_NOTES_AI_PROVIDER || "openai";

  const systemPrompt = [
    "You write release note summaries for enterprise change logs.",
    "You MUST NOT invent changes.",
    "You may ONLY summarize what appears in the provided release notes.",
    "Output MUST be 2-6 bullet points, each starting with '-'.",
    "At least one bullet MUST include a commit hash from the allowed list (e.g. 5da7620).",
    "No headings, no prose paragraphs, bullets only.",
  ].join(" ");

  const userPrompt = [
    "Allowed commit hashes:",
    commitRefs.join(", "),
    "",
    "Release notes source:",
    baseNotes,
  ].join("\n");

  let text;
  try {
    const provider = createProvider({
      provider: providerName,
      apiKey,
      baseUrl: endpoint,
      model,
    });
    text = await provider.complete({ systemPrompt, userPrompt, temperature: 0 });
  } catch (e) {
    if (debug) console.warn("[release-notes-ai] provider error:", e.message);
    return null;
  }

  if (debug) console.warn("[release-notes-ai] response text length: %d", (text || "").length);

  const bullets = (text || "")
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
