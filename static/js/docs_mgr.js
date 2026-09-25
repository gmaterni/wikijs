/**
 * @fileoverview docs_mgr.js - Gestore documenti dell'applicazione
 * @description Fornisce funzioni per gestire documenti caricati dall'utente.
 *              Modulo specifico dell'applicazione RagIndex.
 * @module docs_mgr
 */
"use strict";

import { DataRepository } from "./services/data_repository.js";
import { DATA_KEYS } from "./services/data_keys.js";

// ============================================================================
// VARIABILI PRIVATE
// ============================================================================

let _names = [];

const _init = async function() {
    const data = await DataRepository.getSetting(DATA_KEYS.KEY_DOCS);
    _names = data ? JSON.parse(data) : [];
};

// ============================================================================
// API PUBBLICA
// ============================================================================

export const DocsMgr = {

    init: async function() {
        const done = await _init();
        return done;
    },

    add: async function(name, doc) {
        await _init();

        if (!_names.includes(name)) {
            _names.push(name);
            await DataRepository.saveSetting(DATA_KEYS.KEY_DOCS, JSON.stringify(_names));
        }

        await DataRepository.saveDoc(`${DATA_KEYS.KEY_DOC_PRE}${name}`, doc);
    },

    read: async function(name) {
        const doc = await DataRepository.getDoc(`${DATA_KEYS.KEY_DOC_PRE}${name}`);
        return doc;
    },

    names: async function() {
        await _init();
        return _names;
    },

    name: async function(i) {
        await _init();
        const result = (i >= 0 && i < _names.length) ? _names[i] : null;
        return result;
    },

    doc: async function(i) {
        const name = await DocsMgr.name(i);
        const result = name ? await DocsMgr.read(name) : null;
        return result;
    },

    delete: async function(name) {
        await _init();
        const index = _names.indexOf(name);
        if (index > -1) {
            _names.splice(index, 1);
            await DataRepository.saveSetting(DATA_KEYS.KEY_DOCS, JSON.stringify(_names));
            await DataRepository.deleteDoc(`${DATA_KEYS.KEY_DOC_PRE}${name}`);
            const deleted = true;
            return deleted;
        }
        const deleted = false;
        return deleted;
    },

    exists: async function(name) {
        await _init();
        return _names.includes(name);
    }
};
