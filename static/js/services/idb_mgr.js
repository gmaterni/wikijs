/**
 * @fileoverview idb_mgr.js - Gestore IndexedDB basato su Dexie.js
 * @description Fornisce un'interfaccia semplificata per operazioni CRUD
 *              su IndexedDB utilizzando Dexie.js come motore sottostante.
 * @module services/idb_mgr
 */
"use strict";

import { dbInstance as _db } from "./db_instance.js";
import { WebId } from "./webuser_id.js";

// ============================================================================
// FUNZIONI DI SUPPORTO (Private)
// ============================================================================

/**
 * Log degli errori Dexie.
 * @param {string} op  - Operazione fallita.
 * @param {Error}  err - Oggetto errore.
 * @returns {boolean} Sempre false.
 */
const _logErr = function(op, err) { 
    console.error(`idbMgr.${op}:`, err); 
    const logged = false;
    return logged; 
};

// ============================================================================
// API PUBBLICA - idbMgr (Tabella kvStore)
// ============================================================================

export const idbMgr = {
    create: async function(key, val) { 
        if (!key) {
            console.error("idbMgr.create: key mancante");
            const invalid = false;
            return invalid;
        }

        let success = false;
        try { 
            await _db.kvStore.put({ id: key, value: val }); 
            success = true; 
        } catch (e) { 
            success = _logErr("create", e); 
        } 
        return success;
    },

    read: async function(key) { 
        if (!key) {
            console.error("idbMgr.read: key mancante");
            const missing = undefined;
            return missing;
        }

        let result = undefined;
        try { 
            const record = await _db.kvStore.get(key); 
            if (record) {
                result = record.value;
            }
        } catch (e) { 
            _logErr("read", e); 
            result = undefined;
        } 
        return result;
    },

    delete: async function(key) { 
        if (!key) {
            console.error("idbMgr.delete: key mancante");
            const invalid = false;
            return invalid;
        }

        let success = false;
        try { 
            await _db.kvStore.delete(key); 
            success = true;
        } catch (e) { 
            success = _logErr("delete", e); 
        } 
        return success;
    },

    exists: async function(key) { 
        if (!key) {
            console.error("idbMgr.exists: key mancante");
            const invalid = false;
            return invalid;
        }

        let exists = false;
        try { 
            const count = await _db.kvStore.where("id").equals(key).count();
            exists = count > 0;
        } catch (e) { 
            exists = _logErr("exists", e); 
        } 
        return exists;
    },

    selectKeys: async function(prefix) { 
        let keys = [];
        try { 
            keys = await _db.kvStore.where("id").startsWith(prefix).primaryKeys(); 
        } catch (e) { 
            _logErr("selectKeys", e); 
            keys = [];
        } 
        return keys;
    },

    getAllRecords: async function() { 
        let records = [];
        try { 
            const all = await _db.kvStore.toArray(); 
            records = all.map(r => ({ key: r.id, value: r.value })); 
        } catch (e) { 
            _logErr("getAllRecords", e);
            records = [];
        } 
        return records;
    },

    clearAll: async function() { 
        let success = false;
        try { 
            await Promise.all(_db.tables.map(t => t.clear())); 
            success = true;
        } catch (e) { 
            success = _logErr("clearAll", e); 
        } 
        return success;
    }
};
