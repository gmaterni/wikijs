/**
 * key_store.js - Persistenza chiavi API su IndexedDB e seed iniziale.
 *
 * Contiene solo logica di storage: lettura chiave attiva, seed da
 * api_x.json, decodifica offuscamento. Nessuna UI, nessun DOM.
 *
 * @module  key_store
 * @version 1.0.0
 * @date    2026-09-21
 */

"use strict";

import { UaDb } from "./uadb.js";
import { DATA_KEYS } from "./data_keys.js";
import { getProviderNames } from "../llmclient/registry.js";

export const STORAGE_KEY = DATA_KEYS.KEY_API_KEYS;

/**
 * Provider con client LLM implementato. Derivano dal registry llmclient:
 * stesso import path di prima, nessun consumatore cambia.
 * @type {Array<string>}
 */
export const IMPLEMENTED_CLIENTS = getProviderNames();

/**
 * Recupera la chiave attiva per un determinato provider.
 * @param {string} providerName - Il nome del provider (es. 'gemini', 'mistral').
 * @returns {Promise<string|null>} La chiave API attiva o null.
 */
export async function getApiKey(providerName) {
    let result = null;

    try {
        const db = await UaDb.readJson(STORAGE_KEY);

        if (!db || !db.providers || !db.providers[providerName]) {
            const notFound = null;
            return notFound;
        }

        const providerData = db.providers[providerName];
        const activeKeyName = providerData.exported_key;

        if (!activeKeyName) {
            const notFound = null;
            return notFound;
        }

        const keyObj = providerData.keys.find(k => k.name === activeKeyName);
        result = keyObj ? keyObj.key : null;
    } catch (error) {
        console.error(`getApiKey: Errore nel recupero della chiave per ${providerName}:`, error);
        result = null;
    }

    return result;
}

/**
 * Struttura dati base se il DB è vuoto.
 */
export const INITIAL_DB = {
    last_updated: new Date().toISOString(),
    providers: {}
};

/**
 * Decodifica le chiavi API offuscate con substitution cipher.
 *
 * NOTA: Questo è un semplice offuscamento (substitution cipher), non vera
 * crittografia. Serve solo a evitare la memorizzazione in chiaro delle chiavi
 * nel file JSON statico. Per sicurezza reale servirebbe cifratura asimmetrica
 * o Web Crypto API con chiave derivata da autenticazione utente.
 *
 * @param {Object} data - Dati con chiavi offuscate.
 * @returns {Object} Dati con chiavi decodificate.
 */
const decodeApiKeysJson = function(data) {
    if (!data || !data.providers) return data;

    const ALPHABET_FROM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const ALPHABET_TO = "mKpX3vQwL8ZnR4yTbJxF1YHcU9AgNsI2oODh7eMzW5jV6ifqGrPECuS0Btaldk-_";

    const decodeKey = function(encodedKey) {
        const chars = [...encodedKey];
        const decoded = chars.map(function(char) {
            const index = ALPHABET_TO.indexOf(char);
            const result = index !== -1 ? ALPHABET_FROM[index] : char;
            return result;
        });
        const decodedKey = decoded.join("");
        return decodedKey;
    };

    const decodedData = JSON.parse(JSON.stringify(data));

    Object.values(decodedData.providers).forEach(function(provider) {
        if (provider.keys) {
            provider.keys.forEach(function(keyObj) {
                if (keyObj.key) keyObj.key = decodeKey(keyObj.key);
            });
        }
    });

    return decodedData;
};

/**
 * Carica le chiavi di default se il database è vuoto.
 * @returns {Promise<void>}
 */
export async function fetchApiKeys() {
    const URL = "./data/api_x.json";
    try {
        const existingDb = await UaDb.readJson(STORAGE_KEY);
        if (existingDb && existingDb.providers && Object.keys(existingDb.providers).length > 0) {
            console.debug("*** API_KEYS db found.");
            return;
        }
        await _loadDefaultKeys(URL);
    } catch (error) {
        console.error("Errore in fetchApiKeys:", error);
    }
}

/**
 * Carica forzatamente le chiavi di default dal file JSON.
 * @returns {Promise<void>}
 */
export async function restoreDefaultApiKeys() {
    const URL = "./data/api_x.json";
    if (!await confirm("Vuoi caricare le API Keys di default? Le chiavi attuali verranno sovrascritte.")) return;

    try {
        await _loadDefaultKeys(URL);
        await alert("API Keys di default caricate con successo.");
    } catch (error) {
        console.error("Errore in restoreDefaultApiKeys:", error);
        await alert("Errore durante il caricamento delle API Keys di default.");
    }
}

/**
 * Logica comune di caricamento chiavi dal server/file.
 * @private
 * @param {string} url - Percorso del file JSON delle chiavi offuscate.
 * @returns {Promise<void>}
 */
async function _loadDefaultKeys(url) {
    console.info(`*** Loading API_KEYS from: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`File chiavi non trovato: ${url}`);
    }
    const rsp = await response.json();
    const data = decodeApiKeysJson(rsp);
    if (data && data.providers) {
        // Filtra solo i provider con client implementato
        Object.keys(data.providers).forEach(function(providerName) {
            if (!IMPLEMENTED_CLIENTS.includes(providerName)) {
                delete data.providers[providerName];
            }
        });
        Object.values(data.providers).forEach(function(provider) {
            if (provider.keys && provider.keys.length > 0) {
                provider.exported_key = provider.keys[0].name;
            }
        });
        data.last_updated = new Date().toISOString();
        await UaDb.saveJson(STORAGE_KEY, data);
        console.debug("API Keys caricate e salvate nel DB.");
    }
}
