/**
 * jobs.js - Writer singolo, job riprendibili e contabilità staging.
 *
 * Lock per KB via `navigator.locks` o flag `meta.writer`, record di job
 * con budget e cursore, risultati parziali in `staging`.
 *
 * @module jobs
 * @version 0.1.0
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

import { runTx, storeGet, storePut, storeGetAll, requestValue } from "./db.js";
import { makeJobId, makeStagingId } from "./ids.js";

// Timeout del flag writer quando `navigator.locks` non è disponibile.
const WRITER_TIMEOUT_MS = 30000;

/**
 * Legge una voce `meta` per chiave.
 *
 * @param {object} db - Database aperto.
 * @param {string} key - Chiave della voce.
 * @returns {Promise<*|undefined>} Valore, o undefined se assente.
 */
const getMeta = async function (db, key) {
    if (!db || typeof key !== "string") {
        console.error("getMeta: argomenti non validi");
        return undefined;
    }
    const outcome = await runTx(db, ["meta"], "readonly", async function (stores) {
        const record = await storeGet(stores.meta, key);
        const value = record ? record.value : undefined;
        return value;
    });
    return outcome;
};

/**
 * Scrive una voce `meta` (dentro o fuori transazione del chiamante).
 *
 * @param {object} metaStore - Store `meta` di una transazione attiva.
 * @param {string} key - Chiave della voce.
 * @param {*} value - Valore da memorizzare.
 * @returns {Promise<void>} A scrittura avvenuta.
 */
const putMetaRecord = async function (metaStore, key, value) {
    if (!metaStore || typeof key !== "string") {
        console.error("putMetaRecord: argomenti non validi");
        return;
    }
    const record = { key: key, value: value };
    await storePut(metaStore, record);
};

/**
 * Esegue una funzione con il lock scrittore della KB.
 *
 * @param {object} db - Database aperto.
 * @param {string} kbId - Identificatore della knowledge base.
 * @param {Function} worker - Funzione `async () => risultato`.
 * @returns {Promise<*>} Risultato del worker, o null se occupato.
 */
const withKbLock = async function (db, kbId, worker) {
    if (!db || typeof kbId !== "string" || typeof worker !== "function") {
        console.error("withKbLock: argomenti non validi");
        return null;
    }
    const locks = globalThis.navigator && globalThis.navigator.locks;
    if (locks && typeof locks.request === "function") {
        const name = "wikijs:" + kbId;
        let outcome = null;
        try {
            outcome = await locks.request(name, worker);
        } catch (error) {
            console.error("withKbLock:", error);
            return null;
        }
        return outcome;
    }
    const now = Date.now();
    const holder = await getMeta(db, "writer");
    const busy = holder && (now - holder.ts) < WRITER_TIMEOUT_MS;
    if (busy) {
        console.error("withKbLock: KB occupata da un altro writer");
        return null;
    }
    const claim = { owner: "local", ts: now };
    await runTx(db, ["meta"], "readwrite", async function (stores) {
        await putMetaRecord(stores.meta, "writer", claim);
    });
    let outcome = null;
    try {
        outcome = await worker();
    } finally {
        await runTx(db, ["meta"], "readwrite", async function (stores) {
            await putMetaRecord(stores.meta, "writer", null);
        });
    }
    return outcome;
};

/**
 * Crea un record di job in stato `running`.
 *
 * @param {object} db - Database aperto.
 * @param {string} type - Tipo di job (`build` o `query`).
 * @param {object} budget - Budget effettivo del job.
 * @param {object} cursor - Cursore iniziale di ripresa.
 * @returns {Promise<object|null>} Job creato, o null in caso di errore.
 */
const createJob = async function (db, type, budget, cursor) {
    if (!db || (type !== "build" && type !== "query")) {
        console.error("createJob: argomenti non validi");
        return null;
    }
    const now = Date.now();
    const seq = Math.floor(Math.random() * 1000000);
    const jobId = makeJobId(now, seq);
    const job = {
        jobId: jobId,
        type: type,
        status: "running",
        startedAt: now,
        updatedAt: now,
        progress: { phase: "init", done: 0, total: 0 },
        budget: budget,
        cursor: cursor || {},
        error: null
    };
    const saved = await runTx(db, ["jobs"], "readwrite", async function (stores) {
        await storePut(stores.jobs, job);
        return job;
    });
    return saved;
};

/**
 * Aggiorna un job esistente (dentro la transazione del chiamante o nuova).
 *
 * @param {object} jobsStore - Store `jobs` di una transazione attiva.
 * @param {object} job - Job aggiornato.
 * @returns {Promise<void>} Ad aggiornamento avvenuto.
 */
const putJobRecord = async function (jobsStore, job) {
    if (!jobsStore || !job || typeof job.jobId !== "string") {
        console.error("putJobRecord: argomenti non validi");
        return;
    }
    const stamped = Object.assign({}, job, { updatedAt: Date.now() });
    await storePut(jobsStore, stamped);
};

/**
 * Legge un risultato parziale dallo staging.
 *
 * @param {object} db - Database aperto.
 * @param {string} stagingId - Chiave di staging.
 * @returns {Promise<object|undefined>} Voce di staging, o undefined.
 */
const getStaging = async function (db, stagingId) {
    if (!db || typeof stagingId !== "string") {
        console.error("getStaging: argomenti non validi");
        return undefined;
    }
    const entry = await runTx(db, ["staging"], "readonly", async function (stores) {
        const found = await storeGet(stores.staging, stagingId);
        return found;
    });
    return entry;
};

/**
 * Scrive un risultato parziale in staging (build di un identificatore).
 *
 * @param {string} jobId - Job di appartenenza.
 * @param {string} sourceId - Sorgente del chunk.
 * @param {number} chunkIndex - Indice del chunk.
 * @param {string} kind - Tipo (`extract` o `merge`).
 * @param {object} payload - Output validato del chunk.
 * @returns {object} Voce di staging pronta alla scrittura.
 */
const buildStagingEntry = function (jobId, sourceId, chunkIndex, kind, payload) {
    const stagingId = makeStagingId(jobId, sourceId, chunkIndex, kind);
    const entry = { stagingId: stagingId, jobId: jobId, payload: payload, ts: Date.now() };
    return entry;
};

/**
 * Conta le voci di staging di un job.
 *
 * @param {object} db - Database aperto.
 * @param {string} jobId - Job da ispezionare.
 * @returns {Promise<number>} Numero di voci residue.
 */
const countJobStaging = async function (db, jobId) {
    if (!db || typeof jobId !== "string") {
        console.error("countJobStaging: argomenti non validi");
        return -1;
    }
    const count = await runTx(db, ["staging"], "readonly", async function (stores) {
        const all = await storeGetAll(stores.staging);
        const owned = all.filter(function (entry) {
            return entry.jobId === jobId;
        });
        return owned.length;
    });
    return count;
};

/**
 * Elimina tutte le voci di staging di un job.
 *
 * @param {object} stagingStore - Store `staging` di una transazione attiva.
 * @param {string} jobId - Job completato.
 * @returns {Promise<number>} Voci eliminate.
 */
const clearJobStaging = async function (stagingStore, jobId) {
    if (!stagingStore || typeof jobId !== "string") {
        console.error("clearJobStaging: argomenti non validi");
        return 0;
    }
    const all = await requestValue(stagingStore.getAll());
    let removed = 0;
    for (const entry of all) {
        if (entry.jobId === jobId) {
            await requestValue(stagingStore.delete(entry.stagingId));
            removed = removed + 1;
        }
    }
    return removed;
};

/**
 * Controlla il budget prima di una chiamata LLM.
 *
 * @param {object} job - Job in corso.
 * @param {number} callsMade - Chiamate già effettuate.
 * @returns {object} `{ ok, reason }`.
 */
const checkBudget = function (job, callsMade) {
    const exhausted = { ok: false, reason: "budget_exhausted" };
    if (!job || !job.budget) {
        return exhausted;
    }
    const maxCalls = job.budget.maxCalls;
    if (typeof maxCalls === "number" && callsMade + 1 > maxCalls) {
        return exhausted;
    }
    const maxDuration = job.budget.maxDurationMs;
    if (typeof maxDuration === "number") {
        const elapsed = Date.now() - job.startedAt;
        if (elapsed > maxDuration) {
            return exhausted;
        }
    }
    const ok = { ok: true, reason: null };
    return ok;
};

export {
    WRITER_TIMEOUT_MS,
    getMeta,
    putMetaRecord,
    withKbLock,
    createJob,
    putJobRecord,
    getStaging,
    buildStagingEntry,
    countJobStaging,
    clearJobStaging,
    checkBudget
};
