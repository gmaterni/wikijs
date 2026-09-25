/**
 * fetcher_groq.js - Fetcher modelli Groq (porting di models_groq.py).
 *
 * Recupera i modelli Groq dall'endpoint OpenAI-compatibile e applica la
 * medesima logica di normalizzazione dello script Python.
 *
 * Ogni fallimento viene classificato in un errore tipizzato con proprietà
 * `type`, `code`, `isTimeout` e `userMessage` (tassonomia e factory
 * condivise in `llmlist/errors.js`).
 *
 * @module fetcher_groq
 * @version 1.1.0
 * @date    2026-09-21
 */

"use strict";

import { ModelFetcher } from "./fetcher.js";
import {
    REQUEST_TIMEOUT_MS,
    NO_HTTP_CODE,
    ERR_MISSING_KEY,
    ERR_INVALID_KEY,
    ERR_PAYMENT,
    ERR_RATE_LIMIT,
    ERR_SERVER,
    ERR_HTTP,
    ERR_TIMEOUT,
    ERR_NETWORK,
    ERR_PARSE,
    createModelError
} from "./errors.js";

const API_URL = "https://api.groq.com/openai/v1/models";

/**
 * Classifica una risposta HTTP non valida in un errore tipizzato.
 * @param {number} status - Codice di stato HTTP.
 * @returns {Error} Errore tipizzato per il provider Groq.
 */
const _classifyHttpError = function(status) {
    const statusText = String(status);
    let classified = null;

    if (status === 401 || status === 403) {
        const techMsg = "Groq: chiave API rifiutata [" + statusText + "]";
        classified = createModelError(
            ERR_INVALID_KEY,
            techMsg,
            status,
            "Chiave Groq non valida o scaduta: controllala in Gestisci API Key."
        );
    } else if (status === 402) {
        const techMsg = "Groq: credito esaurito [" + statusText + "]";
        classified = createModelError(
            ERR_PAYMENT,
            techMsg,
            status,
            "Credito Groq esaurito o limite di spesa raggiunto."
        );
    } else if (status === 429) {
        const techMsg = "Groq: troppe richieste [" + statusText + "]";
        classified = createModelError(
            ERR_RATE_LIMIT,
            techMsg,
            status,
            "Troppe richieste verso Groq: attendi prima di riprovare."
        );
    } else if (status >= 500) {
        const techMsg = "Groq: errore lato server [" + statusText + "]";
        classified = createModelError(
            ERR_SERVER,
            techMsg,
            status,
            "Errore temporaneo dei server Groq: riprova più tardi."
        );
    } else {
        const techMsg = "Groq: risposta HTTP inattesa [" + statusText + "]";
        const userMsg = "Richiesta a Groq fallita [" + statusText + "].";
        classified = createModelError(ERR_HTTP, techMsg, status, userMsg);
    }

    const result = classified;
    return result;
};

/**
 * Recupera e filtra i modelli Groq, classificando gli errori. In Groq
 * tutti i modelli supportano la generazione di testo, quindi vengono
 * inclusi tutti.
 *
 * L'errore restituito ha le proprietà:
 * - type: MissingKeyError | InvalidKeyError | PaymentRequiredError |
 *         RateLimitError | ServerError | HttpError | TimeoutError |
 *         NetworkError | ParseError
 * - code: codice HTTP quando disponibile, altrimenti 0
 * - isTimeout: true se la richiesta è stata interrotta per timeout
 * - userMessage: descrizione sintetica adatta alla UI
 *
 * @param {string} apiKey
 * @returns {Promise<Array<{id: string, contextWindow: number}>>}
 * @throws {Error} Errore tipizzato secondo la classificazione sopra.
 */
export const fetchGroqModels = async function(apiKey) {
    if (!apiKey || apiKey.trim() === "") {
        const missingErr = createModelError(
            ERR_MISSING_KEY,
            "Groq: chiave API mancante",
            NO_HTTP_CODE,
            "Chiave Groq non impostata: configurala da Gestisci API Key."
        );
        throw missingErr;
    }

    const authHeader = "Bearer " + apiKey;

    const controller = new AbortController();
    const timeoutId = setTimeout(function() {
        controller.abort();
    }, REQUEST_TIMEOUT_MS);

    let response = null;
    try {
        response = await fetch(API_URL, {
            headers: { "Authorization": authHeader },
            signal: controller.signal
        });
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === "AbortError") {
            const timeoutMs = String(REQUEST_TIMEOUT_MS);
            const timeoutMsg = "Groq: richiesta interrotta dopo " + timeoutMs + " ms";
            const timeoutErr = createModelError(
                ERR_TIMEOUT,
                timeoutMsg,
                408,
                "Groq non risponde (timeout): riprova più tardi."
            );
            throw timeoutErr;
        }
        const netMsg = "Groq: errore di rete (" + error.message + ")";
        const networkErr = createModelError(
            ERR_NETWORK,
            netMsg,
            NO_HTTP_CODE,
            "Impossibile raggiungere Groq: controlla la connessione."
        );
        throw networkErr;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
        const httpErr = _classifyHttpError(response.status);
        throw httpErr;
    }

    let data = null;
    try {
        data = await response.json();
    } catch (error) {
        const jsonMsg = "Groq: risposta non è JSON valido (" + error.message + ")";
        const jsonErr = createModelError(
            ERR_PARSE,
            jsonMsg,
            NO_HTTP_CODE,
            "Risposta di Groq non interpretabile: riprova."
        );
        throw jsonErr;
    }

    if (!data || !Array.isArray(data.data)) {
        const payloadErr = createModelError(
            ERR_PARSE,
            "Groq: payload senza elenco 'data'",
            NO_HTTP_CODE,
            "Risposta di Groq inattesa: riprova più tardi."
        );
        throw payloadErr;
    }

    const models = data.data.map(function(m) {
        const item = {
            id: m.id,
            contextLength: m.context_length || 8192,
            raw: m
        };
        return item;
    });

    const fetcher = new ModelFetcher("groq");
    const filtered = fetcher.filterAndSortModels(models);

    const mapped = filtered.map(function(m) {
        const entry = {
            id: m.id,
            contextWindow: m.contextLength
        };
        return entry;
    });
    return mapped;
};
