"use strict";

const { BaseProvider } = require("./base.js");

class AzureOpenAIProvider extends BaseProvider {
  constructor(opts = {}) {
    super(opts);
    this.deployment = opts.deployment;
    this.apiVersion = opts.apiVersion || "2024-08-01-preview";
  }

  get name() {
    return "azure-openai";
  }

  async complete({ systemPrompt, userPrompt, model, temperature }) {
    const OpenAI = require("openai");
    const { AzureOpenAI } = OpenAI;
    const client = new AzureOpenAI({
      apiKey: this.apiKey,
      endpoint: this.baseUrl,
      deployment: model || this.deployment || this.model,
      apiVersion: this.apiVersion,
    });
    const response = await client.chat.completions.create({
      model: model || this.deployment || this.model,
      temperature: temperature ?? this.temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    return response.choices?.[0]?.message?.content?.trim() || "";
  }
}

module.exports = { AzureOpenAIProvider };
