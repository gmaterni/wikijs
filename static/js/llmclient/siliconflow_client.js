/**
 * siliconflow_client.js - Client per l'integrazione con le API di SiliconFlow.
 *
 * SiliconFlow è un provider API-compatibile OpenAI che offre accesso a modelli
 * come DeepSeek, Gemma, GLM e altri. Include la validazione dei payload,
 * la gestione dei timeout e delle interruzioni.
 *
 * @module  SiliconFlowClient
 * @version 1.0.0
 * @date    2026-06-27
 * @author  Gemini CLI
 */

"use strict";

import { BaseClient } from "./base_client.js";

/**
 * Adatta il payload per le API SiliconFlow (formato OpenAI-compatibile).
 *
 * @param {Object} payload - Il payload originale.
 * @returns {Object} Il payload adattato.
 * @throws {Error} Se il parametro 'model' è mancante.
 */
const adaptSiliconFlowPayload = function(payload) {
  if (!payload || !payload.model) {
    console.error("adaptSiliconFlowPayload: parametro 'model' mancante");
    throw new Error("Il parametro 'model' è obbligatorio nel payload per SiliconFlow.");
  }

  const adapted = {
    model: payload.model,
    messages: payload.messages,
    temperature: payload.temperature,
    max_tokens: payload.max_tokens,
    top_p: payload.top_p,
    top_k: payload.top_k,
    stop: payload.stop,
    tools: payload.tools,
    tool_choice: payload.tool_choice,
  };

  if (payload.frequency_penalty !== undefined) {
    adapted.frequency_penalty = payload.frequency_penalty;
  }

  if (payload.presence_penalty !== undefined) {
    adapted.presence_penalty = payload.presence_penalty;
  }

  if (payload.response_format !== undefined) {
    adapted.response_format = payload.response_format;
  }

  for (const key in adapted) {
    if (adapted[key] === undefined) {
      delete adapted[key];
    }
  }

  const result = adapted;
  return result;
};

class SiliconFlowClient extends BaseClient {
  /**
   * Inizializza il client con la chiave API.
   *
   * @param {string} apiKey - La chiave API per l'autenticazione.
   */
  constructor(apiKey) {
    super(apiKey, "https://api.siliconflow.com/v1/chat/completions");
  }

  /**
   * Invia una richiesta di generazione contenuto al modello SiliconFlow.
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

    let adaptedPayload;

    try {
      adaptedPayload = adaptSiliconFlowPayload(payload);
    } catch (error) {
      console.error("SiliconFlowClient.sendRequest:", error);
      const valError = this._createError(error.message, "ValidationError");
      const res = this._createResult(false, null, null, valError);
      return res;
    }

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
        console.error("SiliconFlowClient.sendRequest:", error);
        const parseErr = this._createError(
          "Invalid response structure",
          "ParsingError",
          null,
          error
        );
        finalResult = this._createResult(false, null, null, parseErr);
      }
    } else {
      finalResult = result;
    }

    return finalResult;
  }
}

export { SiliconFlowClient };
