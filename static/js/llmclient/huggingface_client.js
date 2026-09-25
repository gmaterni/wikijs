/**
 * huggingface_client.js - Client per l'integrazione con le API di Hugging Face.
 *
 * Questo modulo gestisce la comunicazione con i modelli ospitati su Hugging Face,
 * inclusa la validazione dei payload, la gestione dei timeout e delle interruzioni.
 *
 * @module  HuggingFaceClient
 * @version 1.1.0
 * @date    2026-09-21
 * @author  Gemini CLI
 */

"use strict";

import { BaseClient } from "./base_client.js";

/**
 * Adatta il payload per le API Hugging Face.
 *
 * @param {Object} payload - Il payload originale.
 * @returns {Object} Il payload adattato.
 * @throws {Error} Se il parametro 'model' è mancante.
 */
const adaptHuggingFacePayload = function(payload) {
  if (!payload || !payload.model) {
    console.error("adaptHuggingFacePayload: parametro 'model' mancante");
    throw new Error("Il parametro 'model' è obbligatorio nel payload per HuggingFace.");
  }

  const adapted = {
    model: payload.model,
    messages: payload.messages,
    temperature: payload.temperature,
    max_tokens: payload.max_tokens,
    top_p: payload.top_p,
    top_k: payload.top_k,
    stop: payload.stop,
  };

  for (const key in adapted) {
    if (adapted[key] === undefined) {
      delete adapted[key];
    }
  }

  const result = adapted;
  return result;
};

class HuggingFaceClient extends BaseClient {
  /**
   * Inizializza il client con la chiave API.
   *
   * @param {string} apiKey - La chiave API per l'autenticazione.
   */
  constructor(apiKey) {
    super(apiKey, "https://router.huggingface.co/v1/chat/completions");
  }

  /**
   * Invia una richiesta di generazione contenuto al modello Hugging Face.
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
      adaptedPayload = adaptHuggingFacePayload(payload);
    } catch (error) {
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

export { HuggingFaceClient };
