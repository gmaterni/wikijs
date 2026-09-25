/**
 * docs_mgr.js - Gestore documenti della Knowledge Base attiva.
 *
 * Stessa API di ragindex (init/add/read/names/name/doc/delete/exists),
 * ma i documenti sono le sorgenti del motore WikiJS: `add` registra una
 * sorgente, `delete` rimuove la sorgente e (se elaborata) le pagine che
 * dipendono solo da lei, in un'unica transazione.
 *
 * @module docs_mgr
 * @version 1.0.0
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

import { addSource } from "./kb/build.js";
import { listSources, readSource, deleteSource } from "./kb/sources.js";
import { getKbId } from "./kb_ui_state.js";

// Cache dei nomi, allineata a ogni operazione.
let _names = [];

/**
 * Elenca le sorgenti della KB attiva e aggiorna la cache.
 *
 * @returns {Promise<Array<string>>} Nomi ordinati.
 */
const _refreshNames = async function () {
    const kbId = await getKbId();
    const sources = await listSources(kbId);
    _names = sources.map(function (row) {
        return row.name;
    });
    return _names;
};

export const DocsMgr = {

    /**
     * Inizializza il gestore.
     *
     * @returns {Promise<Array<string>>} Nomi caricati.
     */
    init: async function () {
        const names = await _refreshNames();
        return names;
    },

    /**
     * Registra un documento come sorgente.
     *
     * @param {string} name - Nome del file.
     * @param {string} doc - Testo (già pulito dall'uploader).
     * @returns {Promise<boolean>} Vero a registrazione avvenuta.
     */
    add: async function (name, doc) {
        if (typeof name !== "string" || typeof doc !== "string") {
            console.error("DocsMgr.add: parametri non validi");
            return false;
        }
        const kbId = await getKbId();
        const saved = await addSource({ kbId: kbId, name: name, mime: "text/plain", text: doc });
        if (!saved) {
            return false;
        }
        await _refreshNames();
        return true;
    },

    /**
     * Legge il testo di un documento per nome.
     *
     * @param {string} name - Nome del documento.
     * @returns {Promise<string|null>} Testo, o null.
     */
    read: async function (name) {
        if (typeof name !== "string" || name.length === 0) {
            return null;
        }
        const kbId = await getKbId();
        const sources = await listSources(kbId);
        const found = sources.find(function (row) {
            return row.name === name;
        });
        if (!found) {
            return null;
        }
        const text = await readSource(kbId, found.sourceId);
        return text;
    },

    /**
     * Elenca i nomi dei documenti caricati.
     *
     * @returns {Promise<Array<string>>} Nomi ordinati.
     */
    names: async function () {
        const names = await _refreshNames();
        return names;
    },

    /**
     * Restituisce il nome del documento in posizione `i`.
     *
     * @param {number} i - Indice.
     * @returns {Promise<string|null>} Nome, o null.
     */
    name: async function (i) {
        await _refreshNames();
        const result = (i >= 0 && i < _names.length) ? _names[i] : null;
        return result;
    },

    /**
     * Legge il documento in posizione `i`.
     *
     * @param {number} i - Indice.
     * @returns {Promise<string|null>} Testo, o null.
     */
    doc: async function (i) {
        const name = await DocsMgr.name(i);
        const result = name ? await DocsMgr.read(name) : null;
        return result;
    },

    /**
     * Cancella un documento (sorgente) e le pagine dipendenti.
     *
     * @param {string} name - Nome del documento.
     * @returns {Promise<boolean>} Vero a cancellazione avvenuta.
     */
    delete: async function (name) {
        const kbId = await getKbId();
        const sources = await listSources(kbId);
        const found = sources.find(function (row) {
            return row.name === name;
        });
        if (!found) {
            const missing = false;
            return missing;
        }
        const report = await deleteSource(kbId, found.sourceId);
        await _refreshNames();
        const done = report !== null;
        return done;
    },

    /**
     * Verifica se un documento esiste.
     *
     * @param {string} name - Nome del documento.
     * @returns {Promise<boolean>} Vero se presente.
     */
    exists: async function (name) {
        await _refreshNames();
        const present = _names.includes(name);
        return present;
    }
};

export { listSources, deleteSource };
