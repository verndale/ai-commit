#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

require("../lib/load-project-env.js").loadProjectEnv();

const { generateAndValidate } = require("../lib/core/generate.js");
const {
  assertInGitRepo,
  hasStagedChanges,
  commitFromFile,
} = require("../lib/core/git.js");

const PREPARE_COMMIT_MSG_HOOK = `#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

pnpm exec ai-commit prepare-commit-msg "$1" "$2"
`;

const COMMIT_MSG_HOOK = `#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

pnpm exec ai-commit lint --edit "$1"
`;

function presetPath() {
  return path.join(__dirname, "..", "lib", "commitlint-preset.cjs");
}

function commitlintCliPath() {
  return require.resolve("@commitlint/cli/cli.js");
}

function printHelp() {
  process.stdout.write(`ai-commit — conventional commits + bundled commitlint (mandatory deterministic scope; see README).

Usage:
  ai-commit run
  ai-commit init [--force] [--husky]
  ai-commit prepare-commit-msg <file> [source]
  ai-commit lint --edit <file>

Commands:
  run                  Generate a message from the staged diff and run git commit.
  init                 Copy bundled \`.env.example\` to \`.env\`; optional \`--husky\` to add Husky hooks.
  prepare-commit-msg   Git hook: fill an empty commit message file (merge/squash skipped).
  lint                 Run commitlint with the package default config (for commit-msg hook).

Environment:
  OPENAI_API_KEY       Required for AI generation on \`run\` (and for prepare-commit-msg when you want AI).
  COMMIT_AI_MODEL      Optional OpenAI model (default: gpt-4o-mini).

Loads \`.env\` then \`.env.local\` from the current working directory (\`.env.local\` overrides).
`);
}

function parseLintArgv(argv) {
  const i = argv.indexOf("--edit");
  if (i === -1 || !argv[i + 1]) {
    throw new Error("Missing --edit <file> (example: ai-commit lint --edit \"$1\")");
  }
  return { file: argv[i + 1] };
}

function parseInitArgv(argv) {
  let force = false;
  let husky = false;
  for (const a of argv) {
    if (a === "--force") {
      force = true;
    } else if (a === "--husky") {
      husky = true;
    }
  }
  return { force, husky };
}

function cmdInit(argv) {
  const { force, husky } = parseInitArgv(argv);
  const cwd = process.cwd();
  const examplePath = path.join(__dirname, "..", ".env.example");

  if (!fs.existsSync(examplePath)) {
    throw new Error("Missing bundled .env.example (corrupt install?).");
  }

  const envDest = path.join(cwd, ".env");
  if (fs.existsSync(envDest) && !force) {
    process.stderr.write("Skipped .env (already exists). Use --force to overwrite.\n");
  } else {
    fs.copyFileSync(examplePath, envDest);
    process.stdout.write(`Wrote ${path.relative(cwd, envDest) || ".env"} from package template.\n`);
  }

  if (!husky) {
    return;
  }

  assertInGitRepo(cwd);
  const huskyHelper = path.join(cwd, ".husky", "_", "husky.sh");
  if (!fs.existsSync(huskyHelper)) {
    process.stderr.write(
      "Husky is not initialized. Run `pnpm exec husky init` (or `npx husky init`) in this repo, then run `ai-commit init --husky` again.\n",
    );
    process.exit(1);
  }

  const huskyDir = path.join(cwd, ".husky");
  if (!fs.existsSync(huskyDir)) {
    fs.mkdirSync(huskyDir, { recursive: true });
  }

  const preparePath = path.join(huskyDir, "prepare-commit-msg");
  const commitMsgPath = path.join(huskyDir, "commit-msg");

  for (const [hookPath, body] of [
    [preparePath, PREPARE_COMMIT_MSG_HOOK],
    [commitMsgPath, COMMIT_MSG_HOOK],
  ]) {
    if (fs.existsSync(hookPath) && !force) {
      process.stderr.write(`Skipped ${path.relative(cwd, hookPath)} (already exists). Use --force to overwrite.\n`);
    } else {
      fs.writeFileSync(hookPath, body, { encoding: "utf8" });
      try {
        fs.chmodSync(hookPath, 0o755);
      } catch {
        // ignore on platforms that do not support chmod
      }
      process.stdout.write(`Wrote ${path.relative(cwd, hookPath)}.\n`);
    }
  }
}

function stripGitComments(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

async function cmdRun() {
  assertInGitRepo();
  if (!hasStagedChanges()) {
    process.stderr.write("No staged changes. Stage files before running ai-commit (e.g. pnpm commit).\n");
    process.exit(1);
  }
  const { message, warnings } = await generateAndValidate(process.cwd(), {
    requireOpenAI: true,
  });
  for (const w of warnings) {
    process.stderr.write(`warning: ${w}\n`);
  }
  commitFromFile(message);
}

async function cmdPrepareCommitMsg(file, source) {
  if (source === "merge" || source === "squash") {
    process.exit(0);
  }
  assertInGitRepo();
  const raw = fs.readFileSync(file, "utf8");
  const cleaned = stripGitComments(raw).trim();
  if (cleaned.length > 0) {
    process.exit(0);
  }
  if (!hasStagedChanges()) {
    process.exit(0);
  }
  const { message, warnings } = await generateAndValidate(process.cwd(), {
    requireOpenAI: false,
  });
  for (const w of warnings) {
    process.stderr.write(`warning: ${w}\n`);
  }
  fs.writeFileSync(file, message, "utf8");
}

function cmdLint(editFile) {
  const abs = path.isAbsolute(editFile)
    ? editFile
    : path.join(process.cwd(), editFile);
  const r = spawnSync(
    process.execPath,
    [
      commitlintCliPath(),
      "--edit",
      abs,
      "--config",
      presetPath(),
    ],
    { stdio: "inherit", cwd: process.cwd() },
  );
  process.exit(r.status ?? 1);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "-h" || cmd === "--help") {
    printHelp();
    process.exit(cmd ? 0 : 1);
  }
  if (cmd === "run") {
    await cmdRun();
    return;
  }
  if (cmd === "init") {
    cmdInit(argv.slice(1));
    return;
  }
  if (cmd === "prepare-commit-msg") {
    const file = argv[1];
    const source = argv[2];
    if (!file) {
      throw new Error("Usage: ai-commit prepare-commit-msg <file> [source]");
    }
    await cmdPrepareCommitMsg(file, source);
    return;
  }
  if (cmd === "lint") {
    const { file } = parseLintArgv(argv);
    cmdLint(file);
    return;
  }
  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((e) => {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
});
