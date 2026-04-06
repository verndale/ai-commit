"use strict";

const { OpenAIProvider } = require("./openai.js");
const { AnthropicProvider } = require("./anthropic.js");
const { OllamaProvider } = require("./ollama.js");
const { AzureOpenAIProvider } = require("./azure-openai.js");

const PROVIDERS = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  ollama: OllamaProvider,
  "azure-openai": AzureOpenAIProvider,
};

function resolveApiKey(providerName) {
  if (providerName === "anthropic") {
    return process.env.COMMIT_AI_API_KEY || process.env.ANTHROPIC_API_KEY;
  }
  if (providerName === "ollama") {
    return "not-required";
  }
  if (providerName === "azure-openai") {
    return process.env.COMMIT_AI_API_KEY || process.env.AZURE_OPENAI_API_KEY;
  }
  return process.env.COMMIT_AI_API_KEY || process.env.OPENAI_API_KEY;
}

function resolveModel(providerName) {
  const envModel = process.env.COMMIT_AI_MODEL;
  if (envModel) return envModel;
  const defaults = {
    openai: "gpt-4o-mini",
    anthropic: "claude-sonnet-4-20250514",
    ollama: "llama3.2",
    "azure-openai": undefined,
  };
  return defaults[providerName];
}

/**
 * Create a provider instance from environment variables.
 * @param {object} [overrides] - Override env-derived values.
 * @param {string} [overrides.provider]
 * @param {string} [overrides.apiKey]
 * @param {string} [overrides.baseUrl]
 * @param {string} [overrides.model]
 * @param {string} [overrides.deployment] - Azure deployment name.
 * @param {string} [overrides.apiVersion] - Azure API version.
 * @returns {import("./base.js").BaseProvider}
 */
function createProvider(overrides = {}) {
  const providerName = overrides.provider || process.env.COMMIT_AI_PROVIDER || "openai";
  const Cls = PROVIDERS[providerName];
  if (!Cls) {
    const valid = Object.keys(PROVIDERS).join(", ");
    throw new Error(`Unknown provider "${providerName}". Valid providers: ${valid}`);
  }

  const apiKey = overrides.apiKey || resolveApiKey(providerName);
  if (!apiKey) {
    const keyHints = {
      openai: "OPENAI_API_KEY or COMMIT_AI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY or COMMIT_AI_API_KEY",
      "azure-openai": "AZURE_OPENAI_API_KEY or COMMIT_AI_API_KEY",
    };
    const hint = keyHints[providerName] || "COMMIT_AI_API_KEY";
    const err = new Error(
      `API key not set for provider "${providerName}". Set ${hint} in your environment or .env file.`,
    );
    err.code = "ENOKEY";
    throw err;
  }

  const baseUrl = overrides.baseUrl || process.env.COMMIT_AI_BASE_URL || undefined;
  const model = overrides.model || resolveModel(providerName);

  const opts = { apiKey, baseUrl, model };

  if (providerName === "azure-openai") {
    opts.baseUrl = overrides.baseUrl || process.env.AZURE_OPENAI_ENDPOINT || baseUrl;
    opts.deployment = overrides.deployment || process.env.AZURE_OPENAI_DEPLOYMENT;
    opts.apiVersion = overrides.apiVersion || process.env.AZURE_OPENAI_API_VERSION;
  }

  return new Cls(opts);
}

function hasApiKey() {
  const providerName = process.env.COMMIT_AI_PROVIDER || "openai";
  try {
    return !!resolveApiKey(providerName);
  } catch {
    return false;
  }
}

function getProviderNames() {
  return Object.keys(PROVIDERS);
}

module.exports = { createProvider, hasApiKey, getProviderNames, PROVIDERS };
