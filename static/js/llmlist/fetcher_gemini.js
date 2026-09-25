/**
 * fetcher_gemini.js - Fetcher modelli Gemini (porting di models_gemini.py).
 *
 * Recupera i modelli Gemini dall'API e applica la medesima logica di
 * filtraggio (solo generateContent) e normalizzazione dello script Python.
 *
 * Ogni fallimento viene classificato in un errore tipizzato con proprietà
 * `type`, `code`, `isTimeout` e `userMessage` (tassonomia e factory
 * condivise in `llmlist/errors.js`). La chiave non valida restituisce
 * HTTP 400 su questo endpoint, quindi è mappata su `InvalidKeyError`
 * come il 401/403.
 *
 * @module fetcher_gemini
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

const API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Filtro per capacità: solo modelli che supportano la generazione di testo.
 * L'endpoint REST espone il campo "supportedGenerationMethods"; l'SDK Python
 * lo deriva in "supported_actions". Gestiamo entrambi, leggendo dal raw.
 * @param {Object} m
 * @returns {boolean}
 */
const isTextModel = function(m) {
    const raw = (m && m.raw) || m || {};
    const actions = raw.supportedActions || raw.supported_actions || raw.supportedGenerationMethods || [];
    const supportsText = actions.includes("generateContent");
    return supportsText;
};

/**
 * Classifica una risposta HTTP non valida in un errore tipizzato.
 * @param {number} status - Codice di stato HTTP.
 * @returns {Error} Errore tipizzato per il provider Gemini.
 */
const _classifyHttpError = function(status) {
    const statusText = String(status);
    let classified = null;

    if (status === 400 || status === 401 || status === 403) {
        const techMsg = "Gemini: chiave API rifiutata [" + statusText + "]";
        classified = createModelError(
            ERR_INVALID_KEY,
            techMsg,
            status,
            "Chiave Gemini non valida o scaduta: controllala in Gestisci API Key."
        );
    } else if (status === 402) {
        const techMsg = "Gemini: credito esaurito [" + statusText + "]";
        classified = createModelError(
            ERR_PAYMENT,
            techMsg,
            status,
            "Credito Gemini esaurito o limite di spesa raggiunto."
        );
    } else if (status === 429) {
        const techMsg = "Gemini: troppe richieste [" + statusText + "]";
        classified = createModelError(
            ERR_RATE_LIMIT,
            techMsg,
            status,
            "Troppe richieste verso Gemini: attendi prima di riprovare."
        );
    } else if (status >= 500) {
        const techMsg = "Gemini: errore lato server [" + statusText + "]";
        classified = createModelError(
            ERR_SERVER,
            techMsg,
            status,
            "Errore temporaneo dei server Gemini: riprova più tardi."
        );
    } else {
        const techMsg = "Gemini: risposta HTTP inattesa [" + statusText + "]";
        const userMsg = "Richiesta a Gemini fallita [" + statusText + "].";
        classified = createModelError(ERR_HTTP, techMsg, status, userMsg);
    }

    const result = classified;
    return result;
};

/**
 * Recupera e filtra i modelli Gemini, classificando gli errori.
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
export const fetchGeminiModels = async function(apiKey) {
    if (!apiKey || apiKey.trim() === "") {
        const missingErr = createModelError(
            ERR_MISSING_KEY,
            "Gemini: chiave API mancante",
            NO_HTTP_CODE,
            "Chiave Gemini non impostata: configurala da Gestisci API Key."
        );
        throw missingErr;
    }

    const encodedKey = encodeURIComponent(apiKey);
    const url = API_URL + "?key=" + encodedKey;

    const controller = new AbortController();
    const timeoutId = setTimeout(function() {
        controller.abort();
    }, REQUEST_TIMEOUT_MS);

    let response = null;
    try {
        response = await fetch(url, { signal: controller.signal });
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === "AbortError") {
            const timeoutMs = String(REQUEST_TIMEOUT_MS);
            const timeoutMsg = "Gemini: richiesta interrotta dopo " + timeoutMs + " ms";
            const timeoutErr = createModelError(
                ERR_TIMEOUT,
                timeoutMsg,
                408,
                "Gemini non risponde (timeout): riprova più tardi."
            );
            throw timeoutErr;
        }
        const netMsg = "Gemini: errore di rete (" + error.message + ")";
        const networkErr = createModelError(
            ERR_NETWORK,
            netMsg,
            NO_HTTP_CODE,
            "Impossibile raggiungere Gemini: controlla la connessione."
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
        const jsonMsg = "Gemini: risposta non è JSON valido (" + error.message + ")";
        const jsonErr = createModelError(
            ERR_PARSE,
            jsonMsg,
            NO_HTTP_CODE,
            "Risposta di Gemini non interpretabile: riprova."
        );
        throw jsonErr;
    }

    if (!data || !Array.isArray(data.models)) {
        const payloadErr = createModelError(
            ERR_PARSE,
            "Gemini: payload senza elenco 'models'",
            NO_HTTP_CODE,
            "Risposta di Gemini inattesa: riprova più tardi."
        );
        throw payloadErr;
    }

    const models = data.models.map(function(m) {
        const rawId = m.name || "";
        const cleanId = rawId.replace(/^models\//, "");
        const item = {
            id: cleanId,
            inputTokenLimit: m.inputTokenLimit || m.input_token_limit || 0,
            raw: m
        };
        return item;
    });

    const fetcher = new ModelFetcher("gemini");
    const filtered = fetcher.filterAndSortModels(models, isTextModel);

    const mapped = filtered.map(function(m) {
        const entry = {
            id: m.id,
            contextWindow: m.inputTokenLimit
        };
        return entry;
    });
    return mapped;
};
