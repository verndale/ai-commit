#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

require("../lib/load-project-env.js").loadProjectEnv();

const { generateAndValidate } = require("../lib/core/generate.js");
const {
  assertInGitRepo,
  isInGitRepo,
  hasStagedChanges,
  commitFromFile,
} = require("../lib/core/git.js");
const { mergeAiCommitEnvFile } = require("../lib/init-env.js");
const {
  detectPackageExec,
  hookScript,
  runHuskyInit,
  mergePackageJsonForAiCommit,
  warnIfPrepareMissingHusky,
} = require("../lib/init-workspace.js");

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
  ai-commit init [--force] [--env-only] [--husky] [--workspace]
  ai-commit prepare-commit-msg <file> [source]
  ai-commit lint --edit <file>

Commands:
  run                  Generate a message from the staged diff and run git commit.
  init                 Merge env, then Husky + package.json + hooks (from a git repo). \`--env-only\` stops after env files. \`--husky\` skips package.json. \`--force\` replaces \`.env\` / hooks.
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
  let workspace = false;
  let envOnly = false;
  for (const a of argv) {
    if (a === "--force") {
      force = true;
    } else if (a === "--husky") {
      husky = true;
    } else if (a === "--workspace") {
      workspace = true;
    } else if (a === "--env-only") {
      envOnly = true;
    }
  }
  return { force, husky, workspace, envOnly };
}

function cmdInit(argv) {
  const { force, husky, workspace, envOnly } = parseInitArgv(argv);
  const cwd = process.cwd();
  /** Full package.json merge: default on, or `--workspace`; off for `--husky` alone (legacy). */
  const mergePackageJson = !husky || workspace;
  const examplePath = path.join(__dirname, "..", ".env.example");

  if (!fs.existsSync(examplePath)) {
    throw new Error("Missing bundled .env.example (corrupt install?).");
  }

  const envDest = path.join(cwd, ".env");
  const envResult = mergeAiCommitEnvFile(envDest, examplePath, { force });
  const envRel = path.relative(cwd, envDest) || ".env";
  switch (envResult.kind) {
    case "replaced":
      process.stdout.write(`Replaced ${envRel} with bundled template (--force).\n`);
      break;
    case "wrote":
      process.stdout.write(`Wrote ${envRel} from bundled template.\n`);
      break;
    case "merged":
      process.stdout.write(`Appended missing @verndale/ai-commit keys to ${envRel}.\n`);
      break;
    case "unchanged":
      process.stdout.write(
        `No missing @verndale/ai-commit keys in ${envRel}; left unchanged. Use --force to replace the file with the bundled template.\n`,
      );
      break;
    default:
      break;
  }

  const envExampleDest = path.join(cwd, ".env.example");
  if (fs.existsSync(envExampleDest)) {
    const exResult = mergeAiCommitEnvFile(envExampleDest, examplePath, { force: false });
    const exRel = path.relative(cwd, envExampleDest) || ".env.example";
    switch (exResult.kind) {
      case "wrote":
        process.stdout.write(`Wrote ${exRel} from bundled template.\n`);
        break;
      case "merged":
        process.stdout.write(`Appended missing @verndale/ai-commit keys to ${exRel}.\n`);
        break;
      case "unchanged":
        process.stdout.write(`No missing @verndale/ai-commit keys in ${exRel}; left unchanged.\n`);
        break;
      default:
        break;
    }
  }

  if (envOnly) {
    return;
  }

  if (!isInGitRepo(cwd)) {
    process.stdout.write(
      "Not a git repository (or git unavailable); skipped Husky and package.json. Re-run from a repo root for hooks and scripts.\n",
    );
    return;
  }

  const huskyHelper = path.join(cwd, ".husky", "_", "husky.sh");

  if (!fs.existsSync(huskyHelper)) {
    const r = runHuskyInit(cwd);
    if (!r.ok) {
      process.stderr.write(
        r.error
          ? `husky init failed: ${r.error}\n`
          : `husky init failed (exit ${r.status ?? "unknown"}). Run \`npx husky init\` in this repo, then run ai-commit init again.\n`,
      );
      process.exit(1);
    }
    process.stdout.write("Ran `npx husky@9 init`.\n");
  } else {
    process.stdout.write(
      "Husky already initialized (found .husky/_/husky.sh); skipped `npx husky@9 init`.\n",
    );
  }

  if (mergePackageJson) {
    const pkgPath = path.join(cwd, "package.json");
    if (fs.existsSync(pkgPath)) {
      const { changed } = mergePackageJsonForAiCommit(pkgPath);
      if (changed) {
        process.stdout.write(
          "Updated package.json (commit script, prepare, and/or devDependencies.husky). Run your package manager install if you added dependencies.\n",
        );
      }
      warnIfPrepareMissingHusky(pkgPath);
    } else {
      process.stdout.write("No package.json in this directory; skipped package.json merge (hooks still written).\n");
    }
  }

  const huskyDir = path.join(cwd, ".husky");
  if (!fs.existsSync(huskyDir)) {
    fs.mkdirSync(huskyDir, { recursive: true });
  }

  const execPrefix = detectPackageExec(cwd);
  const preparePath = path.join(huskyDir, "prepare-commit-msg");
  const commitMsgPath = path.join(huskyDir, "commit-msg");

  for (const [hookPath, hookKind] of [
    [preparePath, "prepare-commit-msg"],
    [commitMsgPath, "commit-msg"],
  ]) {
    const body = hookScript(execPrefix, hookKind);
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
