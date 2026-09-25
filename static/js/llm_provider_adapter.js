/**
 * llm_provider_adapter.js - Adapter LLM verso lo stack LLM dell'applicazione.
 *
 * Riusa integralmente lo stack LLM esistente (`LlmProvider`, chiavi,
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

import { setAdapter } from "./kb/index.js";
import { LlmProvider } from "./llm_provider.js";
import { createLlmPayload, toTextContent } from "./llmclient/index.js";
import { UaLog } from "./services/ualog3.js";

// Timeout delle chiamate ai provider, in secondi (come nello stack LLM).
const REQUEST_TIMEOUT = 60;

// Tentativi massimi (come `rag_engine._sendRequest`).
const MAX_RETRIES = 3;

// Codici retriabili (come nello stack LLM).
const RETRYABLE_CODES = [408, 500, 502, 503, 504];

// Attese tra i tentativi, in millisecondi.
const RETRY_DELAYS = [1000, 2000];

// Purpose omesso nel log: in build è sempre lo stesso e non aggiunge informazione.
const EXTRACT_PURPOSE = "extract";

// Backoff dedicato al rate limit: base, tetto e variazione casuale (±20%).
const RATE_LIMIT_BASE_DELAY_MS = 5000;
const RATE_LIMIT_MAX_DELAY_MS = 60000;
const RATE_LIMIT_JITTER = 0.2;

// Spaziatura adattiva fra richieste consecutive: cresce sui 429,
// si riduce a ogni successo e si azzera sotto la soglia minima.
const SPACING_MIN_MS = 4000;
const SPACING_MAX_MS = 60000;

// Client attivi, per lo STOP immediato.
const _activeClients = new Set();

// Stato della spaziatura adattiva, condiviso da tutte le chiamate.
let _spacingMs = 0;
let _nextSlotTs = 0;

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
 * Costruisce un esito di errore nel formato atteso dall'adapter KB.
 *
 * @param {string} type - Tipo di errore.
 * @param {number|null} code - Codice HTTP o applicativo.
 * @param {string} message - Messaggio leggibile.
 * @returns {object} `{ error: { type, code, message } }`.
 */
const _failure = function (type, code, message) {
    const error = { type: type, code: code, message: message };
    const failure = { error: error };
    return failure;
};

/**
 * Etichetta provider/modello per i log applicativi (mai la chiave API).
 *
 * @param {string} provider - Provider attivo.
 * @param {string} model - Modello attivo.
 * @returns {string} Etichetta `provider/modello`.
 */
const _providerLabel = function (provider, model) {
    const label = String(provider) + "/" + String(model);
    return label;
};

/**
 * Scrive una riga nel registro applicativo, senza interrompere la chiamata.
 *
 * @param {string} text - Messaggio da mostrare.
 * @returns {void}
 */
const _log = function (text) {
    try {
        UaLog.log(text);
    } catch (error) {
        console.error("_log:", error);
    }
};

/**
 * Calcola l'attesa del prossimo tentativo con backoff esponenziale e jitter.
 *
 * @param {number} attempt - Numero del tentativo appena fallito (1-based).
 * @returns {number} Millisecondi di attesa.
 */
const _backoffDelay = function (attempt) {
    const exponential = RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempt - 1);
    const capped = Math.min(exponential, RATE_LIMIT_MAX_DELAY_MS);
    const jitter = 1 + ((Math.random() * 2) - 1) * RATE_LIMIT_JITTER;
    const delay = Math.round(capped * jitter);
    return delay;
};

/**
 * Estrae l'attesa suggerita dal provider (`Retry-After`), se esposta.
 *
 * Lo stack LLM attuale restituisce il corpo JSON come `response` e non
 * gli header: il valore è quindi normalmente null e si usa il backoff.
 *
 * @param {object|null} outcome - Esito grezzo del client.
 * @returns {number|null} Millisecondi suggeriti, o null.
 */
const _retryAfterMs = function (outcome) {
    const response = outcome ? outcome.response : null;
    if (!response || !response.headers || typeof response.headers.get !== "function") {
        return null;
    }
    const header = response.headers.get("retry-after");
    if (!header) {
        return null;
    }
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
        const fromSeconds = Math.round(seconds * 1000);
        return fromSeconds;
    }
    const date = Date.parse(header);
    if (Number.isNaN(date)) {
        return null;
    }
    const fromDate = Math.max(0, date - Date.now());
    return fromDate;
};

/**
 * Attende il turno di invio rispettando la spaziatura adattiva.
 *
 * @param {*} signal - `AbortSignal`, o null.
 * @returns {Promise<boolean>} Vero se il turno è disponibile.
 */
const _waitForSlot = async function (signal) {
    const now = Date.now();
    const waitMs = _nextSlotTs > now ? _nextSlotTs - now : 0;
    _nextSlotTs = now + waitMs + _spacingMs;
    const waited = await _sleep(waitMs, signal);
    return waited;
};

/**
 * Aumenta la spaziatura dopo un rate limit.
 *
 * @returns {void}
 */
const _raiseSpacing = function () {
    const doubled = _spacingMs > 0 ? _spacingMs * 2 : SPACING_MIN_MS;
    _spacingMs = Math.min(Math.max(doubled, SPACING_MIN_MS), SPACING_MAX_MS);
};

/**
 * Dimezza la spaziatura dopo un successo, azzerandola sotto la soglia minima.
 *
 * @returns {void}
 */
const _decaySpacing = function () {
    const halved = Math.floor(_spacingMs / 2);
    _spacingMs = halved >= SPACING_MIN_MS ? halved : 0;
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
 * Sul rate limit (429) applica spaziatura adattiva e backoff crescente
 * fino a `MAX_RETRIES`; a esaurimento restituisce l'errore strutturato
 * al chiamante, che può fermare il job invece di moltiplicare le chiamate.
 * L'esito di ogni richiesta è riportato in `UaLog` (mai la chiave).
 *
 * @param {object} req - Richiesta `{ purpose, messages, temperature?, maxTokens?, signal? }`.
 * @returns {Promise<object>} `{ text, usage }` in caso di successo, `{ error }` in caso di guasto.
 */
const complete = async function (req) {
    if (!req || typeof req !== "object" || !Array.isArray(req.messages) || req.messages.length === 0) {
        console.error("complete: richiesta non valida");
        _log("LLM · richiesta non valida");
        const invalidRequest = _failure("InvalidRequest", null, "richiesta non valida");
        return invalidRequest;
    }
    if (req.signal && req.signal.aborted) {
        console.error("complete: richiesta abortita");
        _log("LLM · richiesta interrotta dall'utente");
        const abortedBeforeStart = _failure("CancellationError", 499, "richiesta interrotta dall'utente");
        return abortedBeforeStart;
    }
    const config = LlmProvider.getConfig();
    if (!config || !config.provider || !config.model) {
        console.error("complete: provider non configurato");
        _log("LLM · provider non configurato");
        const noConfig = _failure("ConfigurationError", null, "provider non configurato");
        return noConfig;
    }
    const client = await LlmProvider.getClientFor(config.provider, config.model);
    if (!client) {
        console.error("complete: client non disponibile");
        _log("LLM · client non disponibile");
        const noClient = _failure("ClientError", null, "client non disponibile");
        return noClient;
    }
    const label = _providerLabel(config.provider, config.model);
    const purpose = req.purpose ? String(req.purpose) : "?";
    const payload = createLlmPayload(config.model, req.messages, { temperature: req.temperature, max_tokens: req.maxTokens });
    let outcome = null;
    let usage = {};
    let attempt = 0;
    _activeClients.add(client);
    try {
        while (attempt < MAX_RETRIES) {
            attempt = attempt + 1;
            if (req.signal && req.signal.aborted) {
                console.error("complete: richiesta abortita");
                _log("LLM · richiesta interrotta dall'utente");
                const abortedInLoop = _failure("CancellationError", 499, "richiesta interrotta dall'utente");
                return abortedInLoop;
            }
            const slot = await _waitForSlot(req.signal || null);
            if (!slot) {
                console.error("complete: richiesta abortita");
                _log("LLM · richiesta interrotta dall'utente");
                const abortedInWait = _failure("CancellationError", 499, "richiesta interrotta dall'utente");
                return abortedInWait;
            }
            const started = Date.now();
            outcome = await client.sendRequest(payload, REQUEST_TIMEOUT);
            const elapsedMs = Date.now() - started;
            if (outcome && outcome.ok === true) {
                usage = _extractUsage(outcome.response);
                _decaySpacing();
                const tokens = String(usage.inputTokens || 0) + "/" + String(usage.outputTokens || 0);
                const purposePart = purpose === EXTRACT_PURPOSE ? "" : purpose + " · ";
                _log("LLM · ok · " + purposePart + label + " · " + String(elapsedMs) + " ms · token " + tokens);
                break;
            }
            const providerError = outcome ? outcome.error : null;
            const lastAttempt = attempt >= MAX_RETRIES;
            const rateLimited = Boolean(providerError && providerError.code === 429);
            if (rateLimited) {
                _raiseSpacing();
                const retryAfterMs = _retryAfterMs(outcome);
                const tooLong = retryAfterMs !== null && retryAfterMs > RATE_LIMIT_MAX_DELAY_MS;
                if (lastAttempt || tooLong) {
                    break;
                }
                const rateDelay = retryAfterMs !== null ? retryAfterMs : _backoffDelay(attempt);
                const waitedRate = await _sleep(rateDelay, req.signal || null);
                if (!waitedRate) {
                    console.error("complete: richiesta abortita");
                    _log("LLM · richiesta interrotta dall'utente");
                    const abortedInBackoff = _failure("CancellationError", 499, "richiesta interrotta dall'utente");
                    return abortedInBackoff;
                }
                continue;
            }
            const retryable = _isRetryable(providerError);
            if (!retryable || lastAttempt) {
                break;
            }
            const delay = RETRY_DELAYS[attempt - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
            const waited = await _sleep(delay, req.signal || null);
            if (!waited) {
                console.error("complete: richiesta abortita");
                _log("LLM · richiesta interrotta dall'utente");
                const abortedInRetry = _failure("CancellationError", 499, "richiesta interrotta dall'utente");
                return abortedInRetry;
            }
        }
    } catch (error) {
        console.error("complete:", error);
        const message = error && error.message ? error.message : "eccezione client";
        _log("LLM · eccezione · " + message);
        const thrown = _failure("AdapterError", null, message);
        return thrown;
    } finally {
        _activeClients.delete(client);
    }
    if (!outcome || outcome.ok !== true) {
        const providerError = outcome && outcome.error ? outcome.error : null;
        const type = providerError && providerError.type ? providerError.type : "ProviderError";
        const code = providerError && typeof providerError.code === "number" ? providerError.code : null;
        const message = providerError && providerError.message ? providerError.message : "errore provider";
        const retryAfterMs = _retryAfterMs(outcome);
        const codeLabel = code === null ? "" : String(code) + " ";
        console.error("complete: " + codeLabel + message);
        _log("LLM · errore · " + codeLabel + message);
        const failed = { error: { type: type, code: code, message: message, retryAfterMs: retryAfterMs } };
        return failed;
    }
    const text = toTextContent(outcome.data);
    if (typeof text !== "string" || text.length === 0) {
        console.error("complete: risposta vuota dal provider");
        _log("LLM · risposta vuota dal provider");
        const emptyResponse = _failure("EmptyResponse", null, "risposta vuota dal provider");
        return emptyResponse;
    }
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
