"use strict";

const { BaseProvider } = require("./base.js");

class AnthropicProvider extends BaseProvider {
  get name() {
    return "anthropic";
  }

  async complete({ systemPrompt, userPrompt, model, temperature }) {
    let Anthropic;
    try {
      Anthropic = require("@anthropic-ai/sdk");
    } catch {
      throw new Error(
        "Anthropic provider requires @anthropic-ai/sdk. Install it with: npm install @anthropic-ai/sdk",
      );
    }
    const client = new Anthropic({
      apiKey: this.apiKey,
      ...(this.baseUrl ? { baseURL: this.baseUrl } : {}),
    });
    const response = await client.messages.create({
      model: model || this.model || "claude-sonnet-4-20250514",
      max_tokens: 1024,
      temperature: temperature ?? this.temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = response.content?.[0];
    return block?.type === "text" ? block.text.trim() : "";
  }
}

module.exports = { AnthropicProvider };
