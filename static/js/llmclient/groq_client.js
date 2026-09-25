/**
 * groq_client.js - Client per l'integrazione con le API di Groq.
 *
 * Questo modulo gestisce la comunicazione con i modelli Groq tramite API
 * compatible OpenAI, inclusa la validazione dei payload, la gestione dei
 * timeout e delle interruzioni.
 *
 * @module  GroqClient
 * @version 1.0.0
 * @date    2026-06-27
 * @author  Gemini CLI
 */

"use strict";

import { BaseClient } from "./base_client.js";

/**
 * Adatta il payload per le API Groq (formato OpenAI-compatibile).
 *
 * @param {Object} payload - Il payload originale.
 * @returns {Object} Il payload adattato.
 */
const adaptGroqPayload = function(payload) {
  const adapted = {
    model: payload.model,
    messages: payload.messages,
    temperature: payload.temperature !== undefined ? payload.temperature : 0.7,
    max_tokens: payload.max_tokens !== undefined ? payload.max_tokens : 2000,
    top_p: payload.top_p !== undefined ? payload.top_p : 1.0,
    stream: payload.stream !== undefined ? payload.stream : false,
    tools: payload.tools,
    tool_choice: payload.tool_choice,
  };

  if (payload.frequency_penalty !== undefined) {
    adapted.frequency_penalty = payload.frequency_penalty;
  }

  if (payload.presence_penalty !== undefined) {
    adapted.presence_penalty = payload.presence_penalty;
  }

  if (payload.stop !== undefined) {
    adapted.stop = payload.stop;
  }

  if (payload.response_format !== undefined) {
    adapted.response_format = payload.response_format;
  }

  const result = adapted;
  return result;
};

class GroqClient extends BaseClient {
  /**
   * Inizializza il client con la chiave API.
   *
   * @param {string} apiKey - La chiave API per l'autenticazione.
   */
  constructor(apiKey) {
    super(apiKey, "https://api.groq.com/openai/v1/chat/completions");
  }

  /**
   * Invia una richiesta di generazione contenuto al modello Groq.
   *
   * @param {Object} payload - Dati della richiesta.
   * @param {number} [timeout=60] - Tempo massimo di attesa in secondi.
   * @returns {Promise<Object>} Oggetto risultato con {ok, response, data, error}.
   */
  async sendRequest(payload, timeout = 60) {
    const apiKey = this.apiKey;
    const authHeader = `Bearer ${apiKey}`;

    const headers = {
      "Content-Type": "application/json",
      Authorization: authHeader,
    };

    const adaptedPayload = adaptGroqPayload(payload);

    const baseUrl = this.baseUrl;
    const result = await this._fetch(baseUrl, adaptedPayload, headers, timeout);

    let finalResult = null;

    if (result.ok) {
      try {
        const message = result.response.choices[0].message;
        let responseData;

        if (message.tool_calls) {
          responseData = message;
        } else {
          responseData = message.content || "";
        }

        finalResult = this._createResult(true, result.response, responseData);
      } catch (error) {
        console.error("GroqClient.sendRequest:", error);
        const errorDetails = this._createError(
          "Invalid response structure",
          "ParsingError",
          null,
          error
        );
        finalResult = this._createResult(false, null, null, errorDetails);
      }
    } else {
      finalResult = result;
    }

    return finalResult;
  }
}

export { GroqClient };
