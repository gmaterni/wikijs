/**
 * lifecycle.js - Creazione idempotente della knowledge base (`kbInit`).
 *
 * Apre il database, scrive configurazione e log di init. Nessuna
 * chiamata LLM, nessuna sorgente, nessuna ingestione.
 *
 * @module lifecycle
 * @version 0.1.0
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

import { openDb, runTx, storeGet, storePut } from "./db.js";
import { getMeta, putMetaRecord } from "./jobs.js";
import { validateKbId } from "./ids.js";
import { SCHEMA_VERSION, DEFAULT_PARAMS, DEFAULT_ROUTING } from "./params.js";

/**
 * Crea la struttura della KB in modo idempotente.
 *
 * @param {object} opts - Opzioni `{ kbId, name?, params?, llmRouting? }`.
 * @returns {Promise<object|null>} `{ kbId, created, schemaVersion }`.
 */
const kbInit = async function (opts) {
    if (!opts || typeof opts.kbId !== "string" || !validateKbId(opts.kbId)) {
        console.error("kbInit: kbId non valido");
        return null;
    }
    const kbId = opts.kbId;
    const db = await openDb(kbId);
    if (!db) {
        console.error("kbInit: apertura database fallita");
        return null;
    }
    const now = Date.now();
    let created = false;
    try {
        const existing = await getMeta(db, "kbId");
        if (existing === undefined) {
            const params = Object.assign({}, DEFAULT_PARAMS, opts.params || {});
            const routing = Object.assign({}, DEFAULT_ROUTING, opts.llmRouting || {});
            const written = await runTx(db, ["meta", "logs"], "readwrite", async function (stores) {
                await putMetaRecord(stores.meta, "kbId", kbId);
                await putMetaRecord(stores.meta, "name", opts.name || kbId);
                await putMetaRecord(stores.meta, "createdAt", now);
                await putMetaRecord(stores.meta, "updatedAt", now);
                await putMetaRecord(stores.meta, "schemaVersion", SCHEMA_VERSION);
                await putMetaRecord(stores.meta, "params", params);
                await putMetaRecord(stores.meta, "llmRouting", routing);
                await putMetaRecord(stores.meta, "counters", { buildSeq: 0, querySeq: 0, lintSeq: 0 });
                await putMetaRecord(stores.meta, "writer", null);
                const entry = { ts: now, type: "init", refs: { kbId: kbId }, summary: "KB creata", details: {} };
                await storePut(stores.logs, entry);
                return true;
            });
            if (!written) {
                console.error("kbInit: scrittura iniziale fallita");
                return null;
            }
            created = true;
        } else {
            const touched = await runTx(db, ["meta", "logs"], "readwrite", async function (stores) {
                await putMetaRecord(stores.meta, "updatedAt", now);
                const record = await storeGet(stores.meta, "schemaVersion");
                if (!record || record.value !== SCHEMA_VERSION) {
                    await putMetaRecord(stores.meta, "schemaVersion", SCHEMA_VERSION);
                }
                const entry = { ts: now, type: "init", refs: { kbId: kbId }, summary: "KB già esistente", details: {} };
                await storePut(stores.logs, entry);
                return true;
            });
            if (!touched) {
                console.error("kbInit: aggiornamento fallito");
                return null;
            }
            created = false;
        }
    } finally {
        db.close();
    }
    const result = { kbId: kbId, created: created, schemaVersion: SCHEMA_VERSION };
    return result;
};

export { kbInit };
