/**
 * params.js - Parametri operativi di default, routing LLM e costanti di schema.
 *
 * Raccoglie i valori di default di architettura §4.1 (parametri), §4.2
 * (routing per purpose) e §4.3 (budget), più versione schema e nomi store.
 *
 * @module params
 * @version 0.1.0
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
    VALID_QUERY_MODES
};
