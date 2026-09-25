/**
 * mistral_client.js - Client per l'integrazione con le API di Mistral AI.
 *
 * Questo modulo gestisce la comunicazione con i modelli Mistral, inclusa la
 * validazione dei payload, la gestione dei timeout e delle interruzioni.
 *
 * @module  MistralClient
 * @version 1.1.0
 * @date    2026-06-27
 * @author  Gemini CLI
 */

"use strict";

import { BaseClient } from "./base_client.js";

/**
 * Adatta il payload per le API Mistral, rimuovendo campi non supportati.
 *
 * @param {Object} payload - Il payload originale.
 * @returns {Object} Il payload adattato.
 */
const adaptMistralPayload = function(payload) {
  const adapted = { ...payload };

  delete adapted.safe_prompt;

  const result = adapted;
  return result;
};

class MistralClient extends BaseClient {
  /**
   * Inizializza il client con la chiave API.
   *
   * @param {string} apiKey - La chiave API per l'autenticazione.
   */
  constructor(apiKey) {
    super(apiKey, "https://api.mistral.ai/v1/chat/completions");
  }

  /**
   * Invia una richiesta di generazione contenuto al modello Mistral.
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

    const adaptedPayload = adaptMistralPayload(payload);

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
        console.error("MistralClient.sendRequest:", error);
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

export { MistralClient };
