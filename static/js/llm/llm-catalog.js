/**
 * llm-catalog.js - Lettura del catalogo modelli locale.
 *
 * Unico punto di accesso ai file static/data/models/<provider>.txt.
 * L'elenco dei provider è quello dei client implementati in llmclient
 * (getProviderNames() in llmclient/registry.js): nessun manifest.json.
 * Un file .txt mancante NON genera errori: il provider semplicemente avrà 0 modelli.
 *
 * @module llm/llm-catalog
 * @version 1.0.0
 * @date    2026-09-21
 */

"use strict";

const MODELS_DIR = "./data/models/";

/** Numero di token contenuti in un kilotoken (conversione delle finestre di contesto). */
const TOKENS_PER_K = 1024;

/**
 * Marchi di modelli non-chat da escludere dal test (embedding, TTS, ecc.).
 * Centralizzato qui come single source — nessun altro modulo deve duplicarlo.
 * @type {string[]}
 */
const NON_CHAT_KEYWORDS = [
    "fim", "embedding", "reranker", "image", "video", "audio",
    "speech", "tts", "starcoder", "codestral"
];

/**
 * Verifica se un modello è adatto al test di chat.
 * Case-insensitive: keywords in NON_CHAT_KEYWORDS escludono il modello.
 * @param {string} modelId - Identificativo del modello.
 * @returns {boolean} true se adatto alla chat, false altrimenti.
 */
export const isChatModel = function(modelId) {
    const lower = String(modelId).toLowerCase();
    for (const kw of NON_CHAT_KEYWORDS) {
        if (lower.includes(kw)) {
            return false;
        }
    }
    return true;
};

/**
 * Carica i modelli di un provider dal file <provider>.txt.
 * Se il file non esiste o non è valido, restituisce lista vuota (nessun errore).
 * @param {string} provider - Nome del provider (es. 'gemini').
 * @returns {Promise<Array<{name: string, windowSize: number}>>}
 */
export const loadProviderModels = async function(provider) {
    if (!provider) {
        console.error("loadProviderModels: provider mancante");
        const missing = [];
        return missing;
    }

    try {
        const response = await fetch(MODELS_DIR + provider + ".txt");
        if (!response.ok) {
            const emptyModels = [];
            return emptyModels;
        }
        const text = await response.text();
        const lines = text.split("\n").filter(line => line.trim() !== "");

        const models = [];
        lines.forEach(function(line) {
            const parts = line.split("|");
            const name = parts[0];
            const windowSizeTokens = parts[1];
            if (name && windowSizeTokens) {
                const tokens = Math.round(parseInt(windowSizeTokens, 10) / TOKENS_PER_K);
                models.push({ name: name.trim(), windowSize: tokens });
            }
        });
        return models;
    } catch (e) {
        console.warn("llm-catalog: modelli non leggibili per " + provider, e);
        const emptyModels = [];
        return emptyModels;
    }
};

/**
 * Aggrega loadProviderModels per una lista di provider.
 * @param {string[]} providers - Lista provider (es. IMPLEMENTED_CLIENTS).
 * @returns {Promise<Object<string, Array<{name: string, windowSize: number}>>>}
 */
export const loadRawCatalogForProviders = async function(providers) {
    const catalog = {};
    if (!Array.isArray(providers)) {
        console.error("loadRawCatalogForProviders: lista provider mancante");
        return catalog;
    }

    for (const p of providers) {
        const models = await loadProviderModels(p);
        if (models.length > 0) {
            catalog[p] = models;
        }
    }
    return catalog;
};
