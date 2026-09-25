/**
 * fetcher_mistral.js - Fetcher modelli Mistral (porting di models_mistral.py).
 *
 * Recupera i modelli Mistral dall'endpoint OpenAI-compatibile e applica la
 * medesima logica di filtraggio (solo chat) e normalizzazione dello script Python.
 *
 * Ogni fallimento viene classificato in un errore tipizzato con proprietà
 * `type`, `code`, `isTimeout` e `userMessage` (tassonomia e factory
 * condivise in `llmlist/errors.js`).
 *
 * @module fetcher_mistral
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

const API_URL = "https://api.mistral.ai/v1/models";

/**
 * Filtro per capacità: solo modelli che supportano la chat completion.
 * @param {Object} m
 * @returns {boolean}
 */
const isChatModel = function(m) {
    const rawCaps = (m && m.raw && m.raw.capabilities) || {};
    const caps = m.capabilities || rawCaps || {};
    const isChat = caps.completion_chat === true || caps.completionChat === true;
    return isChat;
};

/**
 * Classifica una risposta HTTP non valida in un errore tipizzato.
 * @param {number} status - Codice di stato HTTP.
 * @returns {Error} Errore tipizzato per il provider Mistral.
 */
const _classifyHttpError = function(status) {
    const statusText = String(status);
    let classified = null;

    if (status === 401 || status === 403) {
        const techMsg = "Mistral: chiave API rifiutata [" + statusText + "]";
        classified = createModelError(
            ERR_INVALID_KEY,
            techMsg,
            status,
            "Chiave Mistral non valida o scaduta: controllala in Gestisci API Key."
        );
    } else if (status === 402) {
        const techMsg = "Mistral: credito esaurito [" + statusText + "]";
        classified = createModelError(
            ERR_PAYMENT,
            techMsg,
            status,
            "Credito Mistral esaurito o limite di spesa raggiunto."
        );
    } else if (status === 429) {
        const techMsg = "Mistral: troppe richieste [" + statusText + "]";
        classified = createModelError(
            ERR_RATE_LIMIT,
            techMsg,
            status,
            "Troppe richieste verso Mistral: attendi prima di riprovare."
        );
    } else if (status >= 500) {
        const techMsg = "Mistral: errore lato server [" + statusText + "]";
        classified = createModelError(
            ERR_SERVER,
            techMsg,
            status,
            "Errore temporaneo dei server Mistral: riprova più tardi."
        );
    } else {
        const techMsg = "Mistral: risposta HTTP inattesa [" + statusText + "]";
        const userMsg = "Richiesta a Mistral fallita [" + statusText + "].";
        classified = createModelError(ERR_HTTP, techMsg, status, userMsg);
    }

    const result = classified;
    return result;
};

/**
 * Recupera e filtra i modelli Mistral, classificando gli errori.
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
export const fetchMistralModels = async function(apiKey) {
    if (!apiKey || apiKey.trim() === "") {
        const missingErr = createModelError(
            ERR_MISSING_KEY,
            "Mistral: chiave API mancante",
            NO_HTTP_CODE,
            "Chiave Mistral non impostata: configurala da Gestisci API Key."
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
            const timeoutMsg = "Mistral: richiesta interrotta dopo " + timeoutMs + " ms";
            const timeoutErr = createModelError(
                ERR_TIMEOUT,
                timeoutMsg,
                408,
                "Mistral non risponde (timeout): riprova più tardi."
            );
            throw timeoutErr;
        }
        const netMsg = "Mistral: errore di rete (" + error.message + ")";
        const networkErr = createModelError(
            ERR_NETWORK,
            netMsg,
            NO_HTTP_CODE,
            "Impossibile raggiungere Mistral: controlla la connessione."
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
        const jsonMsg = "Mistral: risposta non è JSON valido (" + error.message + ")";
        const jsonErr = createModelError(
            ERR_PARSE,
            jsonMsg,
            NO_HTTP_CODE,
            "Risposta di Mistral non interpretabile: riprova."
        );
        throw jsonErr;
    }

    if (!data || !Array.isArray(data.data)) {
        const payloadErr = createModelError(
            ERR_PARSE,
            "Mistral: payload senza elenco 'data'",
            NO_HTTP_CODE,
            "Risposta di Mistral inattesa: riprova più tardi."
        );
        throw payloadErr;
    }

    const models = data.data.map(function(m) {
        const id = m.id || "";
        let version = "000";
        if (id.includes("latest")) {
            version = "999";
        }
        const item = {
            id: id,
            version: version,
            contextLength: m.max_context_length || m.maxContextLength || 0,
            raw: m
        };
        return item;
    });

    const fetcher = new ModelFetcher("mistral");
    const filtered = fetcher.filterAndSortModels(models, isChatModel);

    const mapped = filtered.map(function(m) {
        const entry = {
            id: m.id,
            contextWindow: m.contextLength
        };
        return entry;
    });
    return mapped;
};
