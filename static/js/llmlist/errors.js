/**
 * errors.js - Tassonomia condivisa degli errori di scoperta modelli.
 *
 * Centralizza i tipi di errore, il codice per gli errori senza risposta
 * HTTP, il timeout delle richieste di discovery e la factory che crea
 * gli errori tipizzati letti da `commands/update-llm.js` (`type` e
 * `userMessage`). Usato dai fetcher in `llmlist/` (OpenRouter, Gemini,
 * Groq, Mistral) così la classificazione resta identica tra provider.
 *
 * @module  llmlist/errors
 * @version 1.0.0
 * @date    2026-09-21
 */

"use strict";

/** Timeout massimo di una richiesta di discovery, in millisecondi. */
export const REQUEST_TIMEOUT_MS = 15000;

/** Codice interno per gli errori non legati a una risposta HTTP. */
export const NO_HTTP_CODE = 0;

/** Chiave API mancante o vuota. */
export const ERR_MISSING_KEY = "MissingKeyError";

/** Chiave API rifiutata dal provider. */
export const ERR_INVALID_KEY = "InvalidKeyError";

/** Credito esaurito o limite di spesa raggiunto. */
export const ERR_PAYMENT = "PaymentRequiredError";

/** Troppe richieste al provider. */
export const ERR_RATE_LIMIT = "RateLimitError";

/** Errore lato server del provider (HTTP 5xx). */
export const ERR_SERVER = "ServerError";

/** Risposta HTTP inattesa non coperta dai tipi specifici. */
export const ERR_HTTP = "HttpError";

/** Richiesta interrotta per timeout. */
export const ERR_TIMEOUT = "TimeoutError";

/** Rete irraggiungibile o connessione fallita. */
export const ERR_NETWORK = "NetworkError";

/** Risposta non interpretabile o payload senza elenco modelli. */
export const ERR_PARSE = "ParseError";

/**
 * Crea un errore tipizzato per la discovery dei modelli.
 *
 * @param {string} type - Tipo di errore (una delle costanti ERR_*).
 * @param {string} message - Messaggio tecnico completo.
 * @param {number|null} code - Codice HTTP associato, se esiste.
 * @param {string|null} userMessage - Messaggio sintetico rivolto all'utente.
 * @returns {Error} Errore con proprietà type, code, isTimeout e userMessage.
 */
export const createModelError = function(type, message, code, userMessage) {
    if (!type) {
        console.error("createModelError: type mancante");
    }

    const error = new Error(message);
    error.name = type;
    error.type = type;
    error.code = code !== undefined && code !== null ? code : null;
    error.isTimeout = type === ERR_TIMEOUT;
    error.userMessage = userMessage || message;

    const result = error;
    return result;
};
