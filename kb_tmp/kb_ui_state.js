/**
 * ui_state.js - Stato UI della Knowledge Base attiva.
 *
 * Fa da ponte tra l'interfaccia (che usa le chiavi di ragindex:
 * `active_kb`, `ph0_chunks`, `ph1_index`, `kb_doclist`) e il motore
 * WikiJS (`kb/`), che vive in un database per KB `wikijs:<kbId>`.
 * Scrive i marcatori necessari ai controlli di esistenza della UI e
 * risolve il `kbId` attivo.
 *
 * @module kb_ui_state
 * @version 1.0.0
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

import { idbMgr } from "./services/idb_mgr.js";
import { UaDb } from "./services/uadb.js";
import { DATA_KEYS } from "./services/data_keys.js";

// Identificatore KB di default.
const DEFAULT_KB_ID = "demo";

// Pattern di un kbId valido (stesso dell'architettura).
const KB_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Legge il `kbId` attivo.
 *
 * @returns {Promise<string>} Identificatore della KB (default `demo`).
 */
const getKbId = async function () {
    let stored = null;
    try {
        stored = await UaDb.read(DATA_KEYS.ACTIVE_KB_NAME);
    } catch (error) {
        console.error("getKbId:", error);
    }
    const kbId = stored && KB_ID_PATTERN.test(stored) ? stored : DEFAULT_KB_ID;
    return kbId;
};

/**
 * Imposta il `kbId` attivo.
 *
 * @param {string} kbId - Identificatore della KB.
 * @returns {Promise<boolean>} Vero se salvato.
 */
const setKbId = async function (kbId) {
    if (typeof kbId !== "string" || !KB_ID_PATTERN.test(kbId)) {
        console.error("setKbId: kbId non valido");
        return false;
    }
    await UaDb.save(DATA_KEYS.ACTIVE_KB_NAME, kbId);
    return true;
};

/**
 * Allinea i marcatori UI allo stato del motore dopo una build o un import.
 *
 * @param {string} kbId - Identificatore della KB.
 * @param {object} report - Report `{ counts, sources }` o `{ pages, sources }`.
 * @returns {Promise<void>} Al termine.
 */
const syncKbMarkers = async function (kbId, report) {
    const counts = (report && report.counts) ? report.counts : {};
    const pages = typeof counts.pages === "number" ? counts.pages : 0;
    const sources = typeof counts.sources === "number" ? counts.sources : 0;
    const marker = {
        builder: "wikijs",
        kbId: kbId,
        pages: pages,
        sources: sources,
        builtAt: new Date().toISOString()
    };
    const doclist = [];
    if (report && Array.isArray(report.doclist)) {
        for (const name of report.doclist) {
            doclist.push(name);
        }
    }
    await idbMgr.create(DATA_KEYS.PHASE0_CHUNKS, marker);
    await idbMgr.create(DATA_KEYS.PHASE1_INDEX, "wikijs:" + kbId);
    await idbMgr.create(DATA_KEYS.KB_DOCLIST, doclist);
    await idbMgr.create(DATA_KEYS.KB_CHILDCHUNKS, {});
    await setKbId(kbId);
};

/**
 * Cancella i marcatori UI della KB attiva.
 *
 * @returns {Promise<void>} Al termine.
 */
const clearKbMarkers = async function () {
    await idbMgr.delete(DATA_KEYS.PHASE0_CHUNKS);
    await idbMgr.delete(DATA_KEYS.PHASE1_INDEX);
    await idbMgr.delete(DATA_KEYS.KB_DOCLIST);
    await idbMgr.delete(DATA_KEYS.KB_CHILDCHUNKS);
    await UaDb.delete(DATA_KEYS.ACTIVE_KB_NAME);
};

/**
 * Elimina completamente il database della KB attiva.
 *
 * @param {string} kbId - Identificatore della KB.
 * @returns {Promise<boolean>} Vero a cancellazione richiesta.
 */
const deleteKbDatabase = function (kbId) {
    const result = new Promise(function (resolve) {
        if (typeof kbId !== "string" || kbId.length === 0) {
            console.error("deleteKbDatabase: kbId non valido");
            resolve(false);
            return;
        }
        const dbName = "wikijs:" + kbId;
        const request = window.indexedDB.deleteDatabase(dbName);
        request.onsuccess = function () {
            resolve(true);
        };
        request.onerror = function () {
            console.error("deleteKbDatabase:", request.error);
            resolve(false);
        };
        request.onblocked = function () {
            console.error("deleteKbDatabase: database bloccato da un'altra connessione");
            resolve(false);
        };
    });
    return result;
};

export { DEFAULT_KB_ID, KB_ID_PATTERN, getKbId, setKbId, syncKbMarkers, clearKbMarkers, deleteKbDatabase };
