/**
 * fetcher_openrouter.js - Fetcher modelli OpenRouter (porting di models_openrouter.py).
 *
 * Recupera i modelli OpenRouter dall'API applicando la medesima logica dello
 * script Python di riferimento: filtro (solo modelli testuali con piano
 * gratuito), deduplica per nome base mantenendo la versione più recente e
 * ordinamento per ID.
 *
 * Ogni fallimento viene classificato in un errore tipizzato con proprietà
 * `type`, `code`, `isTimeout` e `userMessage` (tassonomia e factory
 * condivise in `llmlist/errors.js`), così il chiamante può
 * distinguere chiave mancante, chiave rifiutata, timeout, errore di rete,
 * risposta HTTP anomala o payload non valido.
 *
 * @module  fetcher_openrouter
 * @version 2.0.1
 * @date    2026-09-21
 */

"use strict";

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

const API_URL = "https://openrouter.ai/api/v1/models";

/**
 * Filtro di selezione fedele allo script Python:
 * 1. solo modelli che supportano la generazione di testo;
 * 2. solo modelli con piano di prezzo gratuito.
 *
 * @param {Object} m - Modello grezzo dall'API.
 * @returns {boolean}
 */
const _isTextFreeModel = function(m) {
    const architecture = m.architecture || {};
    const modality = architecture.modality || "";
    const isText = modality.includes("text") && modality.endsWith("text");

    const pricing = m.pricing || {};
    const isPromptFree = Number(pricing.prompt) === 0;
    const isCompletionFree = Number(pricing.completion) === 0;
    const isFree = isPromptFree && isCompletionFree;

    const result = isText && isFree;
    return result;
};

/**
 * Estrae nome base e versione dall'id OpenRouter come lo script Python:
 * "provider/modello:versione" diventa { baseName: "provider/modello", version: "versione" }.
 * In assenza di versione esplicita viene usato "000".
 *
 * @param {string} modelId
 * @returns {{baseName: string, version: string}}
 */
const _parseModelId = function(modelId) {
    const nameParts = String(modelId).split("/");
    const provider = nameParts[0] || "";
    const modelName = nameParts.length > 1 ? nameParts[1] : String(modelId);

    const segments = modelName.split(":");
    const baseSegment = segments[0] || "";
    const version = segments.length > 1 ? segments[1] : "000";

    const baseName = `${provider}/${baseSegment}`;
    const parsed = { baseName: baseName, version: version };
    return parsed;
};

/**
 * Mantiene, per ogni nome base, solo il modello con versione più recente.
 * Il confronto tra versioni è lessicografico, come nello script Python.
 *
 * @param {Array<Object>} models - Modelli già filtrati.
 * @returns {Array<Object>} Modelli deduplicati.
 */
const _keepLatestVersions = function(models) {
    const latestModels = {};

    for (const m of models) {
        const parsed = _parseModelId(m.id);
        const current = latestModels[parsed.baseName];

        if (!current || parsed.version > current.version) {
            latestModels[parsed.baseName] = { version: parsed.version, model: m };
        }
    }

    const latest = Object.values(latestModels).map(entry => entry.model);
    return latest;
};

// ============================================================================
// API PUBBLICA
// ============================================================================

/**
 * Recupera i modelli OpenRouter (testuali e gratuiti) classificando gli errori.
 *
 * L'errore restituito ha le proprietà:
 * - type: MissingKeyError | InvalidKeyError | PaymentRequiredError |
 *         RateLimitError | ServerError | HttpError | TimeoutError |
 *         NetworkError | ParseError
 * - code: codice HTTP quando disponibile, altrimenti 0
 * - isTimeout: true se la richiesta è stata interrotta per timeout
 * - userMessage: descrizione sintetica adatta alla UI
 *
 * @param {string} apiKey - Chiave API OpenRouter.
 * @returns {Promise<Array<{id: string, contextWindow: number}>>} Modelli filtrati e ordinati.
 * @throws {Error} Errore tipizzato secondo la classificazione sopra.
 */
export const fetchOpenRouterModels = async function(apiKey) {
    // 1. Fail Fast: chiave mancante
    if (!apiKey || apiKey.trim() === "") {
        const missingErr = createModelError(
            ERR_MISSING_KEY,
            "OpenRouter: chiave API mancante",
            NO_HTTP_CODE,
            "Chiave OpenRouter non impostata: configurala da Gestisci API Key."
        );
        throw missingErr;
    }

    // 2. Richiesta con timeout via AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response = null;
    try {
        response = await fetch(API_URL, {
            headers: { "Authorization": `Bearer ${apiKey}` },
            signal: controller.signal
        });
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === "AbortError") {
            const timeoutMsg = `OpenRouter: richiesta interrotta dopo ${REQUEST_TIMEOUT_MS} ms`;
            const timeoutErr = createModelError(
                ERR_TIMEOUT,
                timeoutMsg,
                408,
                "OpenRouter non risponde (timeout): riprova più tardi."
            );
            throw timeoutErr;
        }
        const netMsg = `OpenRouter: errore di rete (${error.message})`;
        const networkErr = createModelError(
            ERR_NETWORK,
            netMsg,
            NO_HTTP_CODE,
            "Impossibile raggiungere OpenRouter: controlla la connessione."
        );
        throw networkErr;
    }
    clearTimeout(timeoutId);

    // 3. Analisi dello stato HTTP
    if (!response.ok) {
        const status = response.status;
        let httpErr = null;

        if (status === 401 || status === 403) {
            const msg401 = `OpenRouter: chiave API rifiutata [${status}]`;
            httpErr = createModelError(
                ERR_INVALID_KEY,
                msg401,
                status,
                "Chiave OpenRouter non valida o scaduta: controllala in Gestisci API Key."
            );
        } else if (status === 402) {
            const msg402 = `OpenRouter: credito esaurito [${status}]`;
            httpErr = createModelError(
                ERR_PAYMENT,
                msg402,
                status,
                "Credito OpenRouter esaurito o limite di spesa raggiunto."
            );
        } else if (status === 429) {
            const msg429 = `OpenRouter: troppe richieste [${status}]`;
            httpErr = createModelError(
                ERR_RATE_LIMIT,
                msg429,
                status,
                "Troppe richieste verso OpenRouter: attendi prima di riprovare."
            );
        } else if (status >= 500) {
            const msg5xx = `OpenRouter: errore lato server [${status}]`;
            httpErr = createModelError(
                ERR_SERVER,
                msg5xx,
                status,
                "Errore temporaneo dei server OpenRouter: riprova più tardi."
            );
        } else {
            const msgHttp = `OpenRouter: risposta HTTP inattesa [${status}]`;
            httpErr = createModelError(
                ERR_HTTP,
                msgHttp,
                status,
                `Richiesta a OpenRouter fallita [${status}].`
            );
        }

        throw httpErr;
    }

    // 4. Parse del payload JSON e validazione della struttura attesa
    let data = null;
    try {
        data = await response.json();
    } catch (error) {
        const jsonMsg = `OpenRouter: risposta non è JSON valido (${error.message})`;
        const jsonErr = createModelError(
            ERR_PARSE,
            jsonMsg,
            NO_HTTP_CODE,
            "Risposta di OpenRouter non interpretabile: riprova."
        );
        throw jsonErr;
    }

    const rawModels = data && Array.isArray(data.data) ? data.data : null;
    if (!rawModels) {
        const payloadErr = createModelError(
            ERR_PARSE,
            "OpenRouter: payload senza elenco 'data'",
            NO_HTTP_CODE,
            "Risposta di OpenRouter inattesa: riprova più tardi."
        );
        throw payloadErr;
    }

    // 5. Filtro, deduplica e ordinamento come nello script Python
    const filtered = rawModels.filter(_isTextFreeModel);
    const latest = _keepLatestVersions(filtered);
    latest.sort((a, b) => String(a.id).localeCompare(String(b.id)));

    const models = latest.map(function(m) {
        const item = { id: m.id, contextWindow: m.context_length || 0 };
        return item;
    });

    const result = models;
    return result;
};
