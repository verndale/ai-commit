"use strict";

const { BaseProvider } = require("./base.js");

class OpenAIProvider extends BaseProvider {
  get name() {
    return "openai";
  }

  async complete({ systemPrompt, userPrompt, model, temperature }) {
    const OpenAI = require("openai");
    const client = new OpenAI({
      apiKey: this.apiKey,
      ...(this.baseUrl ? { baseURL: this.baseUrl } : {}),
    });
    const response = await client.chat.completions.create({
      model: model || this.model || "gpt-4o-mini",
      temperature: temperature ?? this.temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    return response.choices?.[0]?.message?.content?.trim() || "";
  }
}

module.exports = { OpenAIProvider };
