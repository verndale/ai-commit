"use strict";

const path = require("path");

/**
 * Lint full commit message text with the packaged commitlint preset (same rules as `ai-commit lint`).
 */
async function lintMessage(message, cwd = process.cwd()) {
  const presetPath = path.join(__dirname, "..", "commitlint-preset.cjs");
  const [{ default: load }, { default: lint }] = await Promise.all([
    import("@commitlint/load"),
    import("@commitlint/lint"),
  ]);
  const config = await load({}, { file: presetPath, cwd });
  const result = await lint(message, config.rules, {
    parserOpts: config.parserPreset?.parserOpts,
    defaultIgnores: config.defaultIgnores,
    ignores: config.ignores,
    plugins: config.plugins ?? {},
  });
  return result;
}

module.exports = { lintMessage };
