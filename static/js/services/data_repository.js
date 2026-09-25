/**
 * @fileoverview data_repository.js - Layer di astrazione per il database.
 * Fornisce un'interfaccia singola per interagire con i dati dell'applicazione,
 * isolando la logica di persistenza (IndexedDB/Dexie) dalla logica di business.
 * @module services/data_repository
 */

import { idbMgr } from "./idb_mgr.js";
import { UaDb } from "./uadb.js";

export const DataRepository = {
    // --- Documenti e Knowledge Base ---
    async saveDoc(id, content) {
        const result = await idbMgr.create(id, content);
        return result;
    },

    async getDoc(id) {
        const result = await idbMgr.read(id);
        return result;
    },

    async deleteDoc(id) {
        const result = await idbMgr.delete(id);
        return result;
    },

    // --- Configurazioni e Impostazioni ---
    async getSetting(key) {
        const result = await UaDb.read(key);
        return result;
    },

    async saveSetting(key, val) {
        await UaDb.save(key, val);
    },
};
