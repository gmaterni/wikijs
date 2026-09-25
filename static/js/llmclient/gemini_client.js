/**
 * gemini_client.js - Client per l'integrazione con le API di Google Gemini.
 *
 * Questo modulo gestisce la comunicazione con i modelli Gemini, inclusa la
 * trasformazione dei payload, la gestione dei timeout e delle interruzioni.
 *
 * @module  GeminiClient
 * @version 1.1.0
 * @date    2026-06-27
 * @author  Gemini CLI
 */

"use strict";

import { BaseClient } from "./base_client.js";

/**
 * Converte un payload generico nel formato richiesto dalle API Gemini.
 *
 * @param {Object} payload - Il payload originale con messaggi e configurazione.
 * @returns {Object} Il payload formattato per Gemini.
 */
const convertToGemPayload = function(payload) {
  const geminiPayload = {
    contents: [],
    system_instruction: null,
    generationConfig: {
      temperature: payload.temperature !== undefined ? payload.temperature : 1.0,
      maxOutputTokens: payload.max_tokens !== undefined ? payload.max_tokens : 8192,
      topP: payload.top_p !== undefined ? payload.top_p : 0.95,
      topK: 40,
      stopSequences: payload.stop !== undefined ? (Array.isArray(payload.stop) ? payload.stop : [payload.stop]) : [],
      candidateCount: 1,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
  };

  for (const msg of payload.messages) {
    if (msg.role === 'system') {
      geminiPayload.system_instruction = {
        parts: [{ text: msg.content }]
      };
    } else if (msg.role === 'user') {
      let parts = [];

      if (typeof msg.content === 'string') {
        parts = [{ text: msg.content }];
      } else if (Array.isArray(msg.content)) {
        for (const item of msg.content) {
          if (item.type === 'text') {
            parts.push({ text: item.text });
          } else if (item.type === 'image_url') {
            const imageUrl = item.image_url.url;
            const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);

            if (matches) {
              parts.push({
                inlineData: {
                  mimeType: matches[1],
                  data: matches[2]
                }
              });
            }
          }
        }
      } else {
        parts = [{ text: String(msg.content) }];
      }

      geminiPayload.contents.push({
        role: 'user',
        parts: parts
      });
    } else if (msg.role === 'assistant') {
      const parts = [];

      if (msg.content) {
        parts.push({ text: msg.content });
      }

      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          const fn = tc.function || tc;
          let argsData = fn.arguments;

          if (typeof argsData === 'string') {
            try {
              argsData = JSON.parse(argsData);
            } catch (e) {
              argsData = { raw_arguments: argsData };
            }
          }

          parts.push({
            functionCall: {
              name: fn.name,
              args: argsData
            }
          });
        }
      }

      geminiPayload.contents.push({
        role: 'model',
        parts: parts
      });
    } else if (msg.role === 'tool') {
      geminiPayload.contents.push({
        role: 'function',
        parts: [{
          functionResponse: {
            name: msg.name,
            response: { content: msg.content }
          }
        }]
      });
    }
  }

  return geminiPayload;
};

class GeminiClient extends BaseClient {
  /**
   * Inizializza il client Gemini.
   *
   * @param {string} apiKey - La chiave API per l'autenticazione.
   */
  constructor(apiKey) {
    super(apiKey, "https://generativelanguage.googleapis.com/v1beta/models/");
  }

  /**
   * Invia una richiesta di generazione contenuto al modello Gemini.
   *
   * @param {Object} payload - Dati della richiesta.
   * @param {number} [timeout=60] - Tempo massimo di attesa in secondi.
   * @returns {Promise<Object>} Oggetto risultato con {ok, response, data, error}.
   */
  async sendRequest(payload, timeout = 60) {
    const modelName = payload.model || "gemini-flash-latest";
    const apiKey = this.apiKey;
    const baseUrl = this.baseUrl;
    const url = `${baseUrl}${modelName}:generateContent?key=${apiKey}`;

    const preparedData = convertToGemPayload(payload);

    const result = await this._fetch(url, preparedData, {}, timeout);

    let finalResult = null;

    if (result.ok) {
      try {
        const candidate = result.response.candidates[0];
        const content = candidate.content || {};
        const parts = content.parts || [];

        const functionCalls = [];
        const textParts = [];

        for (const part of parts) {
          if (part.text !== undefined) {
            textParts.push(part.text);
          } else if (part.functionCall !== undefined) {
            functionCalls.push(part.functionCall);
          }
        }

        let responseData;

        if (functionCalls.length > 0) {
          const toolCalls = [];

          for (const fc of functionCalls) {
            const argsJson = JSON.stringify(fc.args || {}, null, 2);

            toolCalls.push({
              id: fc.name,
              type: "function",
              function: {
                name: fc.name,
                arguments: argsJson
              }
            });
          }

          responseData = {
            role: "assistant",
            content: textParts.join("") || null,
            tool_calls: toolCalls
          };
        } else {
          responseData = textParts.join("") || "";
        }

        finalResult = this._createResult(true, result.response, responseData);
      } catch (error) {
        console.error("GeminiClient.sendRequest:", error);
        const errorDetails = this._createError(
          "Struttura risposta non valida",
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

export { GeminiClient };
