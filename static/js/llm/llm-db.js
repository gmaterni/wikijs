/**
 * llm-db.js - Storage IndexedDB dei modelli LLM.
 *
 * Due object store isolati: discovered-models (modelli trovati e validati dal
 * test) e selected-models (modelli scelti dall'utente per l'albero LLM).
 * Il database è dedicato e isolato per utente: RagIndexLLM_<userId>, con lo
 * stesso userId usato da RagIndexDB_<userId> (services/db_instance.js).
 *
 * @module llm/llm-db
 * @version 1.0.0
 * @date    2026-09-21
 */

"use strict";

import Dexie from "../services/vendor/dexie.js";
import { WebId } from "../services/webuser_id.js";

// ============================================================================
// COSTANTI
// ============================================================================

/** Nome del database: isolato per utente come il DB applicativo. */
const DB_NAME = `RagIndexLLM_${WebId.get()}`;

/** Versione dello schema Dexie. */
const DB_VERSION = 1;

/** Object store dei modelli scoperti e validati dal test. */
const STORE_DISCOVERED = "discovered-models";

/** Object store dei modelli selezionati dall'utente. */
const STORE_SELECTED = "selected-models";

/** Schema condiviso dai due store: chiave primaria id, indici provider e model. */
const STORES_SCHEMA = {
    [STORE_DISCOVERED]: "id, provider, model",
    [STORE_SELECTED]: "id, provider, model"
};

// ============================================================================
// ISTANZA
// ============================================================================

/** Istanza Dexie del database modelli. */
const _db = new Dexie(DB_NAME);
_db.version(DB_VERSION).stores(STORES_SCHEMA);

// ============================================================================
// FUNZIONI PRIVATE
// ============================================================================

/**
 * Costruisce l'id univoco di un modello nel formato "provider:model".
 * @param {Object} model - Modello con provider e model.
 * @returns {string|null} Id, o null se i campi mancano.
 */
const _buildId = function(model) {
    if (!model || !model.provider || !model.model) {
        console.error("_buildId: provider o model mancante");
        const missing = null;
        return missing;
    }
    const id = `${model.provider}:${model.model}`;
    return id;
};

/**
 * Normalizza un modello aggiungendo l'id, se i campi sono validi.
 * @param {Object} model - Modello {provider, model, name?, windowSize?, ...}.
 * @returns {Object|null} Modello con id, o null se non valido.
 */
const _withId = function(model) {
    const id = _buildId(model);
    if (!id) {
        const invalid = null;
        return invalid;
    }
    const normalized = { ...model, id };
    return normalized;
};

// ============================================================================
// API PUBBLICA — CICLO DI VITA
// ============================================================================

/** Flag di inizializzazione: evita aperture duplicate. */
let _initialized = false;

/**
 * Apre il database (idempotente: Dexie riusa la stessa connessione).
 * @returns {Promise<void>}
 */
export const init = async function() {
    if (_initialized) {
        return;
    }
    await _db.open();
    _initialized = true;
};

/**
 * Chiude la connessione al database.
 * @returns {void}
 */
export const close = function() {
    _db.close();
};

// ============================================================================
// API PUBBLICA — DISCOVERED
// ============================================================================

/**
 * Salva i modelli scoperti, sostituendo integralmente i precedenti.
 * @param {Array<Object>} models - Modelli {provider, model, name?, windowSize?, ...}.
 * @returns {Promise<void>}
 */
export const saveDiscovered = async function(models) {
    const rows = [];
    for (const model of (models || [])) {
        const row = _withId(model);
        if (row) {
            rows.push(row);
        }
    }

    await _db.transaction("rw", _db[STORE_DISCOVERED], async function() {
        await _db[STORE_DISCOVERED].clear();
        if (rows.length > 0) {
            await _db[STORE_DISCOVERED].bulkPut(rows);
        }
    });
};

/**
 * Recupera tutti i modelli scoperti.
 * @returns {Promise<Array<Object>>}
 */
export const getDiscovered = async function() {
    const rows = await _db[STORE_DISCOVERED].toArray();
    return rows;
};

/**
 * Svuota i modelli scoperti.
 * @returns {Promise<void>}
 */
export const clearDiscovered = async function() {
    await _db[STORE_DISCOVERED].clear();
};

// ============================================================================
// API PUBBLICA — SELECTED
// ============================================================================

/**
 * Salva i modelli selezionati, sostituendo integralmente i precedenti.
 * @param {Array<Object>} models - Modelli {provider, model, name?, windowSize?, ...}.
 * @returns {Promise<void>}
 */
export const saveSelected = async function(models) {
    const rows = [];
    for (const model of (models || [])) {
        const row = _withId(model);
        if (row) {
            rows.push(row);
        }
    }

    await _db.transaction("rw", _db[STORE_SELECTED], async function() {
        await _db[STORE_SELECTED].clear();
        if (rows.length > 0) {
            await _db[STORE_SELECTED].bulkPut(rows);
        }
    });
};

/**
 * Aggiunge modelli alla selezione esistente, ignorando i duplicati.
 * @param {Array<Object>} models - Modelli {provider, model, name?, windowSize?, ...}.
 * @returns {Promise<void>}
 */
export const addSelected = async function(models) {
    const rows = [];
    for (const model of (models || [])) {
        const row = _withId(model);
        if (row) {
            rows.push(row);
        }
    }

    if (rows.length === 0) {
        return;
    }

    await _db.transaction("rw", _db[STORE_SELECTED], async function() {
        for (const row of rows) {
            const existing = await _db[STORE_SELECTED].get(row.id);
            if (!existing) {
                await _db[STORE_SELECTED].put(row);
            }
        }
    });
};

/**
 * Recupera tutti i modelli selezionati.
 * @returns {Promise<Array<Object>>}
 */
export const getSelected = async function() {
    const rows = await _db[STORE_SELECTED].toArray();
    return rows;
};

/**
 * Svuota la selezione corrente.
 * @returns {Promise<void>}
 */
export const clearSelected = async function() {
    await _db[STORE_SELECTED].clear();
};

// ============================================================================
// API PUBBLICA — SINGLETON
// ============================================================================

/**
 * Singleton del database modelli (stessa API dei moduli esportati).
 * Ogni init() consecutivo non apre connessioni duplicate.
 */
export const llmDb = {
    init,
    close,
    saveDiscovered,
    getDiscovered,
    clearDiscovered,
    saveSelected,
    getSelected,
    addSelected,
    clearSelected
};
