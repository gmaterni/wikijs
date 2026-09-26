/**
 * params.js - Parametri operativi di default, routing LLM e costanti di schema.
 *
 * Raccoglie i valori di default di architettura §4.1 (parametri), §4.2
 * (routing per purpose) e §4.3 (budget), più versione schema e nomi store.
 * Include la derivazione adattiva del chunking dalla finestra del modello.
 *
 * @module params
 * @version 0.1.1
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

// Versione corrente dello schema IndexedDB (architettura §3).
const SCHEMA_VERSION = 1;

// Prefisso del nome database: `wikijs:<kbId>` (invariante I1).
const DB_NAME_PREFIX = "wikijs:";

// Store previsti dallo schema logico (architettura §3).
const STORE_NAMES = [
    "meta",
    "sources",
    "pages",
    "catalog",
    "logs",
    "outputs",
    "jobs",
    "staging"
];

// Default operativi (architettura §4.1).
const DEFAULT_PARAMS = {
    chunkChars: 12000,
    chunkOverlapChars: 1500,
    maxPagesPerChunk: 6,
    maxPagesPerDoc: 40,
    pageBodyMaxChars: 12000,
    quotesPerPage: 5,
    catalogTokenBudget: 8000,
    queryPageBudget: 7,
    queryContextChars: 20000,
    language: "it",
    contradictionPolicy: "append"
};

// Routing LLM per funzione (architettura §4.2). Solo nomi logici di
// modello: la risoluzione reale spetta all'adapter iniettato.
const DEFAULT_ROUTING = {
    extract: { model: "forte", temperature: 0.1, maxTokens: 4000 },
    merge: { model: "forte", temperature: 0.1, maxTokens: 4000 },
    select: { model: "rapido", temperature: 0, maxTokens: 800 },
    answer: { model: "forte", temperature: 0.2, maxTokens: 2000 },
    lint: { model: "medio", temperature: 0, maxTokens: 1500 }
};

// Budget di default per i job lunghi (architettura §4.3).
const DEFAULT_BUDGET = {
    maxCalls: 200,
    maxInputTokens: 500000,
    maxOutputTokens: 200000,
    maxDurationMs: 3600000
};

// Purpose ammessi per l'adapter (architettura §4.2).
const VALID_PURPOSES = ["extract", "merge", "select", "answer", "lint"];

// Derivazione adattiva del chunking dalla finestra del modello.
const WINDOW_CHUNK_SHARE = 0.15;          // quota della finestra per il testo del chunk
const CHARS_PER_TOKEN = 4;                // stima usata anche in query.js
const CHUNK_MIN_TOKENS = 2000;            // ~8000 caratteri
const CHUNK_MAX_TOKENS = 10000;           // ~40000 caratteri: tetto per qualità e latenza
const OVERLAP_RATIO = 0.125;              // coda d'ormeggio: 1/8 del chunk
const OVERLAP_MIN_CHARS = 1000;
const OVERLAP_MAX_CHARS = 4000;
const PAGES_PER_CHUNK_CHARS = 4000;       // una pagina proposta ogni ~4000 caratteri
const PAGES_MIN_PER_CHUNK = 4;
const PAGES_MAX_PER_CHUNK = 10;
const OUTPUT_TO_INPUT_RATIO = 1.2;        // token di output per token di chunk
const OUTPUT_MIN_TOKENS = 2000;
const OUTPUT_MAX_TOKENS = 16000;
const WINDOW_OUTPUT_MARGIN_TOKENS = 500;  // margine input+output entro la finestra

/**
 * Limita un valore entro un intervallo.
 *
 * @param {number} value - Valore da limitare.
 * @param {number} min - Minimo.
 * @param {number} max - Massimo.
 * @returns {number} Valore limitato.
 */
const clamp = function (value, min, max) {
    const clamped = Math.min(Math.max(value, min), max);
    return clamped;
};

/**
 * Deriva i parametri di chunking dalla finestra del modello.
 *
 * Il chunk resta entro una quota della finestra e entro un tetto assoluto
 * (qualità e latenza); l'output di estrazione cresce di conseguenza per
 * non troncare il JSON. I valori personalizzati per KB (diversi dai
 * default) non vengono sovrascritti.
 *
 * @param {number} windowTokens - Finestra del modello in token (0 se ignota).
 * @param {object} params - Parametri correnti della KB.
 * @param {object} routing - Routing corrente della KB.
 * @returns {object} `{ params, routing, chunkTokens }`.
 */
const deriveParamsFromWindow = function (windowTokens, params, routing) {
    const base = Object.assign({}, DEFAULT_PARAMS, params || {});
    const routes = Object.assign({}, DEFAULT_ROUTING, routing || {});
    if (typeof windowTokens !== "number" || !Number.isFinite(windowTokens) || windowTokens <= 0) {
        const unchanged = { params: base, routing: routes, chunkTokens: 0 };
        return unchanged;
    }
    const chunkTokens = clamp(Math.round(windowTokens * WINDOW_CHUNK_SHARE), CHUNK_MIN_TOKENS, CHUNK_MAX_TOKENS);
    const chunkChars = chunkTokens * CHARS_PER_TOKEN;
    const overlapChars = clamp(Math.round(chunkChars * OVERLAP_RATIO), OVERLAP_MIN_CHARS, OVERLAP_MAX_CHARS);
    const pagesPerChunk = clamp(Math.round(chunkChars / PAGES_PER_CHUNK_CHARS), PAGES_MIN_PER_CHUNK, PAGES_MAX_PER_CHUNK);
    const windowOutput = windowTokens - chunkTokens - WINDOW_OUTPUT_MARGIN_TOKENS;
    const outputTokens = clamp(Math.min(Math.round(chunkTokens * OUTPUT_TO_INPUT_RATIO), windowOutput), OUTPUT_MIN_TOKENS, OUTPUT_MAX_TOKENS);
    if (base.chunkChars === DEFAULT_PARAMS.chunkChars) {
        base.chunkChars = chunkChars;
    }
    if (base.chunkOverlapChars === DEFAULT_PARAMS.chunkOverlapChars) {
        base.chunkOverlapChars = overlapChars;
    }
    if (base.maxPagesPerChunk === DEFAULT_PARAMS.maxPagesPerChunk) {
        base.maxPagesPerChunk = pagesPerChunk;
    }
    if (routes.extract.maxTokens === DEFAULT_ROUTING.extract.maxTokens) {
        routes.extract = Object.assign({}, routes.extract, { maxTokens: outputTokens });
    }
    const derived = { params: base, routing: routes, chunkTokens: chunkTokens };
    return derived;
};

// Modi di build e di query ammessi.
const VALID_BUILD_MODES = ["auto", "full", "update"];
const VALID_QUERY_MODES = ["llm", "llm-min", "offline"];

export {
    SCHEMA_VERSION,
    DB_NAME_PREFIX,
    STORE_NAMES,
    DEFAULT_PARAMS,
    DEFAULT_ROUTING,
    DEFAULT_BUDGET,
    VALID_PURPOSES,
    VALID_BUILD_MODES,
    VALID_QUERY_MODES,
    deriveParamsFromWindow
};
