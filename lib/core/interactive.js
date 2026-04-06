"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const readline = require("readline");
const { formatCommitMessage, ok, warn, fail, info, cyan, dim, bold, green, yellow } = require("./format.js");
const { lintMessage } = require("./lint.js");

function askQuestion(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function openInEditor(message) {
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  const tmpFile = path.join(os.tmpdir(), `commit-ai-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, message, "utf8");

  const result = spawnSync(editor, [tmpFile], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    try { fs.unlinkSync(tmpFile); } catch {}
    return null;
  }

  const edited = fs.readFileSync(tmpFile, "utf8");
  try { fs.unlinkSync(tmpFile); } catch {}
  return edited.trim();
}

function printMessage(message) {
  process.stderr.write("\n");
  process.stderr.write(`${dim("─".repeat(60))}\n`);
  process.stderr.write(formatCommitMessage(message));
  process.stderr.write("\n");
  process.stderr.write(`${dim("─".repeat(60))}\n`);
  process.stderr.write("\n");
}

function printMenu() {
  process.stderr.write(
    `  ${green("[a]")}ccept  ${cyan("[e]")}dit  ${yellow("[r]")}egenerate  ${dim("[c]ancel")}\n\n`,
  );
}

/**
 * Interactive commit flow: display message, let user accept/edit/regenerate/cancel.
 *
 * @param {object} opts
 * @param {string} opts.message - Initial generated message.
 * @param {string[]} opts.warnings - Any warnings from generation.
 * @param {Function} opts.regenerate - Async function that returns { message, warnings }.
 * @param {Function} opts.commit - Function that accepts the final message and commits.
 * @param {string} opts.cwd - Working directory for linting.
 */
async function interactiveCommit({ message, warnings, regenerate, commit, cwd }) {
  let currentMessage = message;
  let regenerateCount = 0;
  const maxRegenerations = 3;

  for (const w of warnings) {
    warn(w);
  }

  while (true) {
    printMessage(currentMessage);
    printMenu();

    const answer = await askQuestion(`  ${bold("Choice:")} `);

    if (answer === "a" || answer === "accept") {
      commit(currentMessage);
      ok("Committed successfully.");
      return;
    }

    if (answer === "e" || answer === "edit") {
      const edited = openInEditor(currentMessage);
      if (!edited) {
        fail("Editor returned empty or non-zero exit. Message unchanged.");
        continue;
      }

      const result = await lintMessage(edited, cwd);
      if (!result.valid) {
        fail("Edited message failed commitlint:");
        for (const e of result.errors) {
          process.stderr.write(`  ${e.name}: ${e.message}\n`);
        }
        info("Try again or accept the original.");
        continue;
      }

      currentMessage = edited;
      commit(currentMessage);
      ok("Committed with edited message.");
      return;
    }

    if (answer === "r" || answer === "regenerate") {
      if (regenerateCount >= maxRegenerations) {
        fail(`Maximum regenerations (${maxRegenerations}) reached.`);
        continue;
      }

      regenerateCount++;
      info(`Regenerating... (${regenerateCount}/${maxRegenerations})`);

      try {
        const result = await regenerate();
        currentMessage = result.message;
        for (const w of result.warnings) {
          warn(w);
        }
        ok("New message generated.");
      } catch (e) {
        fail(`Regeneration failed: ${e.message}`);
      }
      continue;
    }

    if (answer === "c" || answer === "cancel" || answer === "q" || answer === "quit") {
      info("Cancelled. No commit created.");
      return;
    }

    warn("Unknown choice. Use: a(ccept), e(dit), r(egenerate), c(ancel)");
  }
}

module.exports = { interactiveCommit };
