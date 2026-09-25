/**
 * llm_provider_adapter.js - Adapter LLM verso lo stack di RagIndex.
 *
 * Riusa integralmente lo stack LLM di ragindex (`LlmProvider`, chiavi,
 * catalogo e selezione verbatim); qui vive solo la traduzione nel formato
 * `complete({ purpose, ... })` richiesto dal motore KB, con retry sui
 * codici transitori, abort e `usage` reale.
 *
 * @module llm_provider_adapter
 * @version 1.0.0
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

import { setAdapter } from "./kb/adapter.js";
import { LlmProvider } from "./llm_provider.js";
import { createLlmPayload, toTextContent } from "./llmclient/index.js";

// Timeout delle chiamate ai provider, in secondi (come in ragindex).
const REQUEST_TIMEOUT = 60;

// Tentativi massimi (come `rag_engine._sendRequest`).
const MAX_RETRIES = 3;

// Codici retriabili (come ragindex).
const RETRYABLE_CODES = [408, 500, 502, 503, 504];

// Attese tra i tentativi, in millisecondi.
const RETRY_DELAYS = [1000, 2000];

// Client attivi, per lo STOP immediato.
const _activeClients = new Set();

/**
 * Indica se un errore merita un nuovo tentativo.
 *
 * @param {object|null} error - Errore standard `{ type, code }`.
 * @returns {boolean} Vero se retriabile.
 */
const _isRetryable = function (error) {
    if (!error) {
        return true;
    }
    if (error.type === "TokenLimitError") {
        return false;
    }
    if (error.code === 429) {
        return false;
    }
    const retryable = RETRYABLE_CODES.includes(error.code);
    return retryable;
};

/**
 * Estrae i conteggi token dalla risposta grezza del provider.
 *
 * @param {*} response - JSON grezzo (`usage` OpenAI o `usageMetadata` Gemini).
 * @returns {object} `{ inputTokens?, outputTokens? }`, o oggetto vuoto.
 */
const _extractUsage = function (response) {
    const usage = {};
    if (!response || typeof response !== "object") {
        return usage;
    }
    const openAi = response.usage;
    if (openAi && typeof openAi === "object") {
        if (typeof openAi.prompt_tokens === "number") {
            usage.inputTokens = openAi.prompt_tokens;
        }
        if (typeof openAi.completion_tokens === "number") {
            usage.outputTokens = openAi.completion_tokens;
        }
        return usage;
    }
    const gemini = response.usageMetadata;
    if (gemini && typeof gemini === "object") {
        if (typeof gemini.promptTokenCount === "number") {
            usage.inputTokens = gemini.promptTokenCount;
        }
        if (typeof gemini.candidatesTokenCount === "number") {
            usage.outputTokens = gemini.candidatesTokenCount;
        }
        return usage;
    }
    return usage;
};

/**
 * Attesa interrompibile via `signal`.
 *
 * @param {number} ms - Millisecondi.
 * @param {*} signal - `AbortSignal`, o null.
 * @returns {Promise<boolean>} Vero se l'attesa è completa.
 */
const _sleep = function (ms, signal) {
    const result = new Promise(function (resolve) {
        if (signal && signal.aborted) {
            resolve(false);
            return;
        }
        const timer = setTimeout(function () {
            cleanup();
            resolve(true);
        }, ms);
        const onAbort = function () {
            clearTimeout(timer);
            cleanup();
            resolve(false);
        };
        const cleanup = function () {
            if (signal) {
                signal.removeEventListener("abort", onAbort);
            }
        };
        if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
        }
    });
    return result;
};

/**
 * Annulla tutte le chiamate in corso (STOP della UI).
 *
 * @returns {void}
 */
const stopActiveClients = function () {
    for (const client of _activeClients) {
        if (client && typeof client.cancelRequest === "function") {
            client.cancelRequest();
        }
    }
    _activeClients.clear();
};

/**
 * Invoca il provider attivo nel formato dell'adapter WikiJS.
 *
 * @param {object} req - Richiesta `{ purpose, messages, temperature?, maxTokens?, signal? }`.
 * @returns {Promise<object|null>} `{ text, usage }`, o null in caso di errore.
 */
const complete = async function (req) {
    if (!req || typeof req !== "object" || !Array.isArray(req.messages) || req.messages.length === 0) {
        console.error("complete: richiesta non valida");
        return null;
    }
    if (req.signal && req.signal.aborted) {
        console.error("complete: richiesta abortita");
        return null;
    }
    const config = LlmProvider.getConfig();
    if (!config || !config.provider || !config.model) {
        console.error("complete: provider non configurato");
        return null;
    }
    const client = await LlmProvider.getClientFor(config.provider, config.model);
    if (!client) {
        console.error("complete: client non disponibile");
        return null;
    }
    const payload = createLlmPayload(config.model, req.messages, { temperature: req.temperature, max_tokens: req.maxTokens });
    let outcome = null;
    let attempt = 0;
    _activeClients.add(client);
    try {
        while (attempt < MAX_RETRIES) {
            attempt = attempt + 1;
            if (req.signal && req.signal.aborted) {
                console.error("complete: richiesta abortita");
                return null;
            }
            outcome = await client.sendRequest(payload, REQUEST_TIMEOUT);
            if (outcome && outcome.ok === true) {
                break;
            }
            const retryable = _isRetryable(outcome ? outcome.error : null);
            const lastAttempt = attempt >= MAX_RETRIES;
            if (!retryable || lastAttempt) {
                break;
            }
            const delay = RETRY_DELAYS[attempt - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
            const waited = await _sleep(delay, req.signal || null);
            if (!waited) {
                console.error("complete: richiesta abortita");
                return null;
            }
        }
    } catch (error) {
        console.error("complete:", error);
        return null;
    } finally {
        _activeClients.delete(client);
    }
    if (!outcome || outcome.ok !== true) {
        const details = outcome && outcome.error ? JSON.stringify(outcome.error) : "errore provider";
        console.error("complete: " + details);
        return null;
    }
    const text = toTextContent(outcome.data);
    if (typeof text !== "string" || text.length === 0) {
        console.error("complete: risposta vuota dal provider");
        return null;
    }
    const usage = _extractUsage(outcome.response);
    const result = { text: text, usage: usage };
    return result;
};

/**
 * Restituisce l'adapter registrabile con `setAdapter`.
 *
 * @returns {object} Adapter con `complete(req)`.
 */
const getProviderAdapter = function () {
    const adapter = { complete: complete };
    return adapter;
};

/**
 * Registra l'adapter: ospite prioritario, altrimenti provider configurato.
 *
 * @returns {boolean} Vero se un adapter è stato registrato.
 */
const activateProviderAdapter = function () {
    const host = window.WikiJsLlm || null;
    if (host && typeof host.complete === "function") {
        const ok = setAdapter(host);
        return ok;
    }
    const ok = setAdapter(getProviderAdapter());
    return ok;
};

export { getProviderAdapter, activateProviderAdapter, stopActiveClients };
