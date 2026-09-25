/**
 * key_retriever.js - Shim di compatibilità.
 *
 * Re-esporta lo store (key_store.js) e la UI (key_ui.js).
 * I consumer esistenti continuano a importare da qui senza modifiche.
 * Nuovo codice: importare direttamente da key_store.js o key_ui.js.
 *
 * @module  key_retriever
 * @version 1.0.0
 * @date    2026-09-21
 */

"use strict";

export {
    STORAGE_KEY,
    INITIAL_DB,
    IMPLEMENTED_CLIENTS,
    getApiKey,
    fetchApiKeys,
    restoreDefaultApiKeys
} from "./key_store.js";

export { addApiKey } from "./key_ui.js";
