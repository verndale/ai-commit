"use strict";

const { BaseProvider } = require("./base.js");

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

class OllamaProvider extends BaseProvider {
  get name() {
    return "ollama";
  }

  async complete({ systemPrompt, userPrompt, model, temperature }) {
    const baseUrl = (this.baseUrl || DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, "");
    const url = `${baseUrl}/api/chat`;
    const body = {
      model: model || this.model || "llama3.2",
      stream: false,
      options: { temperature: temperature ?? this.temperature },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Ollama API error ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    return (data.message?.content || "").trim();
  }
}

module.exports = { OllamaProvider };
