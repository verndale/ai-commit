"use strict";

const isTTY = process.stderr.isTTY;

const codes = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function style(text, ...styles) {
  if (!isTTY) return text;
  const prefix = styles.map((s) => codes[s] || "").join("");
  return `${prefix}${text}${codes.reset}`;
}

const bold = (t) => style(t, "bold");
const dim = (t) => style(t, "dim");
const red = (t) => style(t, "red");
const green = (t) => style(t, "green");
const yellow = (t) => style(t, "yellow");
const cyan = (t) => style(t, "cyan");
const magenta = (t) => style(t, "magenta");

function formatCommitMessage(msg) {
  const lines = msg.split("\n");
  const header = lines[0] || "";
  const headerMatch = header.match(/^(\w+)(\([^)]+\))?(!)?(:\s)(.+)$/);
  let formatted;
  if (headerMatch) {
    const [, type, scope, bang, sep, subject] = headerMatch;
    formatted = [
      green(type),
      scope ? cyan(scope) : "",
      bang ? red("!") : "",
      dim(sep),
      bold(subject),
    ].join("");
  } else {
    formatted = bold(header);
  }
  const rest = lines.slice(1).join("\n");
  return rest ? `${formatted}\n${dim(rest)}` : formatted;
}

function ok(msg) {
  process.stderr.write(`${green("✓")} ${msg}\n`);
}

function warn(msg) {
  process.stderr.write(`${yellow("⚠")} ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`${red("✗")} ${msg}\n`);
}

function info(msg) {
  process.stderr.write(`${cyan("ℹ")} ${msg}\n`);
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function createSpinner(text) {
  if (!isTTY) {
    process.stderr.write(`  ${text}\n`);
    return { stop() {} };
  }
  let i = 0;
  const id = setInterval(() => {
    const frame = SPINNER_FRAMES[i % SPINNER_FRAMES.length];
    process.stderr.write(`\r${cyan(frame)} ${text}`);
    i++;
  }, 80);
  return {
    stop(finalText) {
      clearInterval(id);
      process.stderr.write(`\r\x1b[K`);
      if (finalText) process.stderr.write(`${finalText}\n`);
    },
  };
}

module.exports = {
  style,
  bold,
  dim,
  red,
  green,
  yellow,
  cyan,
  magenta,
  ok,
  warn,
  fail,
  info,
  formatCommitMessage,
  createSpinner,
};
