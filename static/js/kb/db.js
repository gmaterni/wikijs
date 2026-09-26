/**
 * db.js - Accesso a IndexedDB per le knowledge base.
 *
 * Un database per KB (`wikijs:<kbId>`) con gli 8 store dello schema
 * logico. Wrapper sottile su IndexedDB nativo, con punto di iniezione
 * per la libreria già testata dal committente quando disponibile.
 *
 * @module db
 * @version 0.1.1
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

import { DB_NAME_PREFIX, STORE_NAMES } from "./params.js";
import { SCHEMA_VERSION } from "./params.js";

// Fabbrica iniettabile (di default `globalThis.indexedDB`).
let _factory = null;

/**
 * Imposta la fabbrica IndexedDB da usare (test o libreria esterna).
 *
 * @param {object|null} factory - Fabbrica con `open`, o null per il default.
 * @returns {void}
 */
const setDbFactory = function (factory) {
    _factory = factory;
};

/**
 * Risolve la fabbrica IndexedDB attiva.
 *
 * @returns {object|null} Fabbrica, o null se indisponibile.
 */
const resolveFactory = function () {
    if (_factory) {
        return _factory;
    }
    const native = globalThis.indexedDB || null;
    return native;
};

/**
 * Crea gli store mancanti (creazione additiva, mai distruttiva).
 *
 * @param {object} db - Database in aggiornamento di versione.
 * @returns {void}
 */
const ensureStores = function (db) {
    if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
    }
    if (!db.objectStoreNames.contains("sources")) {
        const sources = db.createObjectStore("sources", { keyPath: "sourceId" });
        sources.createIndex("by_sha256", "sha256", { unique: false });
        sources.createIndex("by_status", "status", { unique: false });
    }
    if (!db.objectStoreNames.contains("pages")) {
        const pages = db.createObjectStore("pages", { keyPath: "slug" });
        pages.createIndex("by_updatedAt", "updatedAt", { unique: false });
        pages.createIndex("by_status", "status", { unique: false });
        pages.createIndex("by_origin", "origin", { unique: false });
        pages.createIndex("by_sources", "sources", { unique: false, multiEntry: true });
        pages.createIndex("by_links", "links", { unique: false, multiEntry: true });
    }
    if (!db.objectStoreNames.contains("catalog")) {
        db.createObjectStore("catalog", { keyPath: "slug" });
    }
    if (!db.objectStoreNames.contains("logs")) {
        const logs = db.createObjectStore("logs", { keyPath: "logId", autoIncrement: true });
        logs.createIndex("by_ts", "ts", { unique: false });
        logs.createIndex("by_type", "type", { unique: false });
    }
    if (!db.objectStoreNames.contains("outputs")) {
        db.createObjectStore("outputs", { keyPath: "outputId" });
    }
    if (!db.objectStoreNames.contains("jobs")) {
        db.createObjectStore("jobs", { keyPath: "jobId" });
    }
    if (!db.objectStoreNames.contains("staging")) {
        db.createObjectStore("staging", { keyPath: "stagingId" });
    }
};

/**
 * Apre o crea il database di una KB alla versione corrente.
 *
 * @param {string} kbId - Identificatore della knowledge base.
 * @returns {Promise<object|null>} Database, o null in caso di errore.
 */
const openDb = async function (kbId) {
    if (typeof kbId !== "string" || kbId.length === 0) {
        console.error("openDb: kbId non valido");
        return null;
    }
    const factory = resolveFactory();
    if (!factory) {
        console.error("openDb: IndexedDB non disponibile");
        return null;
    }
    const name = DB_NAME_PREFIX + kbId;
    let db = null;
    try {
        const request = factory.open(name, SCHEMA_VERSION);
        request.onupgradeneeded = function () {
            ensureStores(request.result);
        };
        db = await new Promise(function (resolve, reject) {
            request.onsuccess = function () {
                resolve(request.result);
            };
            request.onerror = function () {
                reject(request.error);
            };
        });
    } catch (error) {
        console.error("openDb:", error);
        return null;
    }
    return db;
};

/**
 * Chiude un database aperto.
 *
 * @param {object} db - Database da chiudere.
 * @returns {void}
 */
const closeDb = function (db) {
    if (!db || typeof db.close !== "function") {
        console.error("closeDb: database non valido");
        return;
    }
    db.close();
};

/**
 * Esegue un worker dentro una transazione multi-store.
 *
 * @param {object} db - Database aperto.
 * @param {string[]} storeNames - Store coinvolti.
 * @param {string} mode - `readonly` o `readwrite`.
 * @param {Function} worker - Funzione `async (stores) => risultato`.
 * @returns {Promise<*>} Risultato del worker a transazione confermata.
 */
const runTx = async function (db, storeNames, mode, worker) {
    if (!db || !Array.isArray(storeNames) || typeof worker !== "function") {
        console.error("runTx: argomenti non validi");
        return null;
    }
    for (const name of storeNames) {
        if (!STORE_NAMES.includes(name)) {
            console.error("runTx: store sconosciuto");
            return null;
        }
    }
    const tx = db.transaction(storeNames, mode);
    const finished = new Promise(function (resolve, reject) {
        tx.oncomplete = function () {
            resolve(true);
        };
        tx.onerror = function () {
            reject(tx.error);
        };
        tx.onabort = function () {
            reject(tx.error || new Error("transazione interrotta"));
        };
    });
    const stores = {};
    for (const name of storeNames) {
        stores[name] = tx.objectStore(name);
    }
    let outcome = null;
    try {
        outcome = await worker(stores);
        await finished;
    } catch (error) {
        console.error("runTx:", error);
        try {
            tx.abort();
        } catch (abortError) {
            console.error("runTx:", abortError);
        }
        return null;
    }
    return outcome;
};

/**
 * Converte una richiesta IndexedDB in promessa.
 *
 * @param {object} request - Richiesta `IDBRequest`.
 * @returns {Promise<*>} Risultato della richiesta.
 */
const requestValue = function (request) {
    const done = new Promise(function (resolve, reject) {
        request.onsuccess = function () {
            resolve(request.result);
        };
        request.onerror = function () {
            reject(request.error);
        };
    });
    return done;
};

/**
 * Legge un record per chiave.
 *
 * @param {object} store - Object store della transazione.
 * @param {string} key - Chiave del record.
 * @returns {Promise<object|undefined>} Record, o undefined se assente.
 */
const storeGet = async function (store, key) {
    const value = await requestValue(store.get(key));
    return value;
};

/**
 * Scrive un record (insert o replace).
 *
 * @param {object} store - Object store della transazione.
 * @param {object} value - Record da scrivere.
 * @returns {Promise<string>} Chiave scritta.
 */
const storePut = async function (store, value) {
    const key = await requestValue(store.put(value));
    return key;
};

/**
 * Elenca tutti i record di uno store.
 *
 * @param {object} store - Object store della transazione.
 * @returns {Promise<Array>} Tutti i record.
 */
const storeGetAll = async function (store) {
    const values = await requestValue(store.getAll());
    const list = Array.isArray(values) ? values : [];
    return list;
};

export {
    setDbFactory,
    openDb,
    closeDb,
    runTx,
    requestValue,
    storeGet,
    storePut,
    storeGetAll
};
