/**
 * sources.js - Gestione delle sorgenti di una Knowledge Base.
 *
 * Elenca, legge e cancella le sorgenti (documenti caricati). La
 * cancellazione rimuove solo la sorgente (testo liberato, record
 * conservato come tombstone `deleted`): le pagine restano intatte e
 * interrogabili, gli invarianti I2 e I3 restano verificati e un
 * ricaricamento dello stesso nome riattiva la sorgente sullo stesso
 * identificatore. La build ignora le tombstone in ogni modo.
 *
 * @module kb/sources
 * @version 1.1.0
 * @date 2026-09-26
 * @author WikiJS
 */

"use strict";

import { openDb } from "./db.js";
import { runTx, storeGetAll, storePut } from "./db.js";

// Stati di una sorgente in attesa di elaborazione.
const STATUSES_TODO = ["new", "changed", "error"];

// Stato di una sorgente cancellata (tombstone: testo liberato, pagine intatte).
const STATUS_DELETED = "deleted";

/**
 * Elenca tutte le sorgenti di una KB.
 *
 * @param {string} kbId - Identificatore della KB.
 * @returns {Promise<Array>} Sorgenti ordinate per nome.
 */
const listSources = async function (kbId) {
    if (typeof kbId !== "string" || kbId.length === 0) {
        console.error("listSources: kbId non valido");
        const empty = [];
        return empty;
    }
    const db = await openDb(kbId);
    if (!db) {
        const empty = [];
        return empty;
    }
    let rows = [];
    try {
        rows = await runTx(db, ["sources"], "readonly", async function (stores) {
            const all = await storeGetAll(stores.sources);
            const sorted = all.slice().sort(function (left, right) {
                return left.name.localeCompare(right.name);
            });
            return sorted;
        });
    } catch (error) {
        console.error("listSources:", error);
        rows = [];
    } finally {
        db.close();
    }
    const result = rows || [];
    return result;
};

/**
 * Restituisce il testo di una sorgente.
 *
 * @param {string} kbId - Identificatore della KB.
 * @param {string} sourceId - Identificatore della sorgente.
 * @returns {Promise<string|null>} Testo, o null.
 */
const readSource = async function (kbId, sourceId) {
    if (typeof kbId !== "string" || typeof sourceId !== "string") {
        console.error("readSource: parametri non validi");
        return null;
    }
    const db = await openDb(kbId);
    if (!db) {
        return null;
    }
    let text = null;
    try {
        const record = await runTx(db, ["sources"], "readonly", async function (stores) {
            const found = await new Promise(function (resolve, reject) {
                const request = stores.sources.get(sourceId);
                request.onsuccess = function () {
                    resolve(request.result || null);
                };
                request.onerror = function () {
                    reject(request.error);
                };
            });
            return found;
        });
        text = record ? record.text : null;
    } catch (error) {
        console.error("readSource:", error);
        text = null;
    } finally {
        db.close();
    }
    return text;
};

/**
 * Indica se una sorgente è in attesa di elaborazione.
 *
 * @param {object} source - Record sorgente.
 * @returns {boolean} Vero se non ancora elaborata.
 */
const isPending = function (source) {
    const pending = STATUSES_TODO.includes(source.status);
    return pending;
};

/**
 * Cancella una sorgente senza toccare le pagine.
 *
 * Il testo è liberato e il record resta come tombstone (`deleted`):
 * le pagine derivate restano interrogabili, I2/I3 restano verificati
 * e ricaricare lo stesso nome riattiva la sorgente sullo stesso
 * identificatore. Idempotente su tombstone esistenti.
 *
 * @param {string} kbId - Identificatore della KB.
 * @param {string} sourceId - Identificatore della sorgente.
 * @returns {Promise<object|null>} `{ removedPages: 0, updatedPages: 0 }`, o null.
 */
const deleteSource = async function (kbId, sourceId) {
    if (typeof kbId !== "string" || typeof sourceId !== "string") {
        console.error("deleteSource: parametri non validi");
        return null;
    }
    const db = await openDb(kbId);
    if (!db) {
        return null;
    }
    let report = null;
    try {
        report = await runTx(db, ["sources", "logs"], "readwrite", async function (stores) {
            const sources = await storeGetAll(stores.sources);
            const source = sources.find(function (row) {
                return row.sourceId === sourceId;
            });
            if (!source) {
                return null;
            }
            const now = Date.now();
            if (source.status !== STATUS_DELETED) {
                const tombstone = Object.assign({}, source, {
                    text: null,
                    sizeBytes: 0,
                    status: STATUS_DELETED,
                    error: null,
                    ingestedAt: null,
                    deletedAt: now
                });
                await storePut(stores.sources, tombstone);
            }
            const summary = "sorgente cancellata (pagine conservate)";
            const details = { removedPages: 0, updatedPages: 0 };
            const entry = { ts: now, type: "source", refs: { sourceId: sourceId }, summary: summary, details: details };
            await storePut(stores.logs, entry);
            const result = { removedPages: 0, updatedPages: 0 };
            return result;
        });
    } catch (error) {
        console.error("deleteSource:", error);
        report = null;
    } finally {
        db.close();
    }
    return report;
};

export {
    listSources,
    readSource,
    isPending,
    deleteSource,
    STATUS_DELETED
};
