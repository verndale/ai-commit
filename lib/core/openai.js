"use strict";

const OpenAI = require("openai");
const { COMMIT_TYPES } = require("../rules.js");
const {
  parseMessage,
  extractTypeAndSubject,
  normalizeSubject,
  stripBreakingFooterLines,
  wrap72,
} = require("./message-policy.js");

const DEFAULT_MODEL = "gpt-4o-mini";
const DIFF_PROMPT_SLICE = 12000;

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const err = new Error(
      "OPENAI_API_KEY is not set. Add it to your environment or a .env / .env.local file in the project root.",
    );
    err.code = "ENOKEY";
    throw err;
  }
  return new OpenAI({ apiKey: key });
}

async function callOpenAI({ prompt, model = process.env.COMMIT_AI_MODEL || DEFAULT_MODEL }) {
  const openai = getClient();
  const response = await openai.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "You produce strict Conventional Commit messages. Body text follows classic Beams-style prose: full sentences, imperative clarity, 72-character wrap, and normal sentence capitalization (capitalize the first word of each sentence; proper nouns as in English).",
      },
      { role: "user", content: prompt },
    ],
  });
  return response.choices?.[0]?.message?.content?.trim() || "";
}

function coerceType(type) {
  return COMMIT_TYPES.includes(type) ? type : "chore";
}

function assembleFromRaw(raw, { scope, breakingAllowed, issueNumbers }) {
  if (!raw) return "";
  let parsed = parseMessage(raw);
  let { type, subject, aiBreaking } = extractTypeAndSubject(parsed.header);
  type = coerceType(type);

  const aiFooterBreaking = /^BREAKING CHANGE:/im.test(parsed.rest || "");
  const finalBreaking = !!(breakingAllowed && (aiBreaking || aiFooterBreaking));

  subject = normalizeSubject(subject);
  if (!subject) return "";

  parsed.header = `${type}(${scope})${finalBreaking ? "!" : ""}: ${subject}`;

  if (!finalBreaking) parsed.rest = stripBreakingFooterLines(parsed.rest || "");

  const wrappedRest = parsed.rest ? wrap72(parsed.rest.trim()) : "";
  let msg = parsed.header + (wrappedRest ? `\n\n${wrappedRest}` : "");

  if (issueNumbers.length) {
    const lower = msg.toLowerCase();
    const missingAll = issueNumbers.every((n) => !lower.includes(`#${n}`));
    if (missingAll) msg += `\n\n${issueNumbers.map((n) => `Refs #${n}`).join("\n")}`;
  }

  return msg.trim();
}

function formatLintErrors(result) {
  return [...result.errors, ...result.warnings]
    .map((x) => `${x.name}: ${x.message}`)
    .filter(Boolean)
    .join("\n");
}

function buildBasePrompt({
  diff,
  files,
  issueNumbers,
  breakingAllowed,
}) {
  const issueHint = issueNumbers.length
    ? `
ISSUE REFERENCES:
Detected issue numbers:
${issueNumbers.map((n) => `- #${n}`).join("\n")}

Footer:
- Use "Closes #<n>" only if the commit fully resolves the issue
- Otherwise use "Refs #<n>"
- One reference per line
- Do NOT invent issue numbers
`
    : `
ISSUE REFERENCES:
No issue numbers detected.
Do NOT invent issue references.
`;

  const breakingRules = breakingAllowed
    ? `
BREAKING CHANGE:
You MAY mark this as breaking if it truly breaks compatibility.
If breaking, include:
- "!" after the type (before the colon), e.g. feat!: Subject
- Footer line: BREAKING CHANGE: <short explanation>
If NOT breaking, do not include "!" or BREAKING CHANGE footer.
`
    : `
BREAKING CHANGE:
You are NOT allowed to mark this as breaking.
Do NOT add "!" before the colon.
Do NOT add any "BREAKING CHANGE:" footer lines.
`;

  const typesList = COMMIT_TYPES.join(", ");

  return `
Generate ONE git commit message.

You may choose the <type> from: ${typesList}.
Do NOT choose a scope; scope will be injected automatically.

Style: classic "How to Write a Git Commit Message" (Beams-style) prose—clear, imperative subject line; body is readable narrative, not bullet fragments or all-lowercase streams.

Format (first line MUST be without scope — use type only):
<type>: <Subject>
(blank line)
<Detailed Body>
(blank line)
<Footer>

Subject rules:
- Imperative mood
- First letter capitalized
- Max 50 characters — stay under the limit with a shorter phrase if needed; do not end mid-word
- No trailing period

Body rules:
- Robust body (2–4 short paragraphs) when the change warrants explanation
- Wrap at 72 characters max
- Explain WHAT changed, WHY, and IMPACT
- Write in complete sentences with normal sentence capitalization.

Footer rules:
- Issue references only if detected
- Breaking footer only if allowed

Formatting rules:
- Separate header/body/footer with ONE blank line each
- No markdown fences, no backticks
- Output ONLY the commit message text

${issueHint}
${breakingRules}

Changed files:
${files.join("\n")}

Staged diff (truncated):
${diff.slice(0, DIFF_PROMPT_SLICE)}
`.trim();
}

function buildRetryPrompt(basePrompt, lintFeedback) {
  return `
Your previous output failed commitlint:
${lintFeedback}

Regenerate the commit message. Remember:
- First line format: <type>: <Subject> only (no scope in the first line)
- Subject <= 50 chars, capitalized, no trailing period, no word cut off at the end
- Types allowed: ${COMMIT_TYPES.join(", ")}
- Provide a robust body in Beams-style prose when appropriate
Return ONLY the commit message text.

${basePrompt}
`.trim();
}

/**
 * Full pipeline: AI (no scope in header) → inject deterministic scope → wrap → issue footers → lint → one retry.
 */
async function generateCommitMessageFull(
  {
    diff,
    files,
    issueNumbers,
    scope,
    breakingAllowed,
  },
  { cwd, model } = {},
) {
  const basePrompt = buildBasePrompt({
    diff,
    files,
    issueNumbers,
    breakingAllowed,
  });

  const { lintMessage } = require("./lint.js");

  let raw = "";
  try {
    raw = await callOpenAI({ prompt: basePrompt, model });
  } catch {
    return "";
  }

  let msg = assembleFromRaw(raw, { scope, breakingAllowed, issueNumbers });
  if (!msg) return "";

  let result = await lintMessage(msg, cwd);
  if (result.valid) return msg;

  const feedback = formatLintErrors(result);
  let retryRaw = "";
  try {
    retryRaw = await callOpenAI({
      prompt: buildRetryPrompt(basePrompt, feedback),
      model,
    });
  } catch {
    return "";
  }

  msg = assembleFromRaw(retryRaw, { scope, breakingAllowed, issueNumbers });
  if (!msg) return "";

  result = await lintMessage(msg, cwd);
  return result.valid ? msg : "";
}

module.exports = {
  generateCommitMessageFull,
  callOpenAI,
  assembleFromRaw,
  buildBasePrompt,
  getClient,
  DEFAULT_MODEL,
};
