/**
 * sources.js - Gestione delle sorgenti di una Knowledge Base.
 *
 * Elenca, legge e cancella le sorgenti (documenti caricati). La
 * cancellazione di una sorgente già elaborata rimuove anche le pagine
 * che dipendono solo da lei e la relativa proiezione in `catalog`,
 * in un'unica transazione: gli invarianti I2 e I3 restano verificati.
 *
 * @module kb/sources
 * @version 1.0.0
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

import { openDb } from "./db.js";
import { runTx, requestValue, storeGetAll, storePut } from "./db.js";

// Stati di una sorgente in attesa di elaborazione.
const STATUSES_TODO = ["new", "changed", "error"];

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
    return rows || [];
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
 * Cancella una sorgente e, se elaborata, le pagine dipendenti.
 *
 * Le pagine con altre sorgenti restano e perdono solo il riferimento;
 * quelle che dipendono unicamente da questa sorgente vengono rimosse
 * insieme alla loro voce di catalogo. Tutto in una transazione.
 *
 * @param {string} kbId - Identificatore della KB.
 * @param {string} sourceId - Identificatore della sorgente.
 * @returns {Promise<object|null>} `{ removedPages, updatedPages }`, o null.
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
        report = await runTx(db, ["sources", "pages", "catalog", "logs"], "readwrite", async function (stores) {
            const sources = await storeGetAll(stores.sources);
            const source = sources.find(function (row) {
                return row.sourceId === sourceId;
            });
            if (!source) {
                return null;
            }
            const pages = await storeGetAll(stores.pages);
            const catalog = await storeGetAll(stores.catalog);
            let removedPages = 0;
            let updatedPages = 0;
            const now = Date.now();
            for (const page of pages) {
                const refs = page.sources || [];
                if (!refs.includes(sourceId)) {
                    continue;
                }
                if (refs.length > 1) {
                    const updated = Object.assign({}, page, {
                        sources: refs.filter(function (id) {
                            return id !== sourceId;
                        }),
                        updatedAt: now,
                        version: page.version + 1
                    });
                    await storePut(stores.pages, updated);
                    updatedPages = updatedPages + 1;
                    continue;
                }
                const projection = catalog.find(function (row) {
                    return row.slug === page.slug;
                });
                if (projection) {
                    await requestValue(stores.catalog.delete(page.slug));
                }
                await requestValue(stores.pages.delete(page.slug));
                removedPages = removedPages + 1;
            }
            await requestValue(stores.sources.delete(sourceId));
            const summary = "sorgente cancellata";
            const details = { removedPages: removedPages, updatedPages: updatedPages };
            const entry = { ts: now, type: "source", refs: { sourceId: sourceId }, summary: summary, details: details };
            await storePut(stores.logs, entry);
            const result = { removedPages: removedPages, updatedPages: updatedPages };
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
    deleteSource
};
