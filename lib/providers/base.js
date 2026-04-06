"use strict";

class BaseProvider {
  constructor({ apiKey, baseUrl, model, temperature = 0.1 } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
    this.temperature = temperature;
  }

  get name() {
    throw new Error("Provider must implement get name()");
  }

  /**
   * @param {object} opts
   * @param {string} opts.systemPrompt
   * @param {string} opts.userPrompt
   * @param {string} [opts.model]
   * @param {number} [opts.temperature]
   * @returns {Promise<string>} The generated text content.
   */
  async complete({ systemPrompt, userPrompt, model, temperature }) {
    void systemPrompt;
    void userPrompt;
    void model;
    void temperature;
    throw new Error("Provider must implement complete()");
  }
}

module.exports = { BaseProvider };
