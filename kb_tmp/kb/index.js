/**
 * index.js - Punto di ingresso del pacchetto `kb`.
 *
 * Unico import consentito per i consumatori del motore: re-esporta
 * l'API pubblica (creazione, compilazione, interrogazione, manutenzione),
 * il confine LLM iniettabile e le utility sulle sorgenti. Nessun modulo
 * interno va importato direttamente.
 *
 * @module  kb
 * @version 1.0.0
 * @date    2026-09-25
 * @author  WikiJS
 */

"use strict";

export { kbInit } from "./lifecycle.js";
export { addSource, kbBuild } from "./build.js";
export { kbQuery } from "./query.js";
export { kbStatus, kbExport, kbImport, kbLint } from "./maintenance.js";
export { listSources, readSource, isPending, deleteSource } from "./sources.js";
export { setAdapter, getAdapter, hasAdapter, complete } from "./adapter.js";
export { createMockAdapter } from "./mock.js";
export { SCHEMA_VERSION, DB_NAME_PREFIX, STORE_NAMES, DEFAULT_PARAMS, VALID_PURPOSES } from "./params.js";
