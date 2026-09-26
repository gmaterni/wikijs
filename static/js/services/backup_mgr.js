/**
 * backup_mgr.js - Gestore backup e ripristino dati.
 *
 * Fornisce funzionalità per esportare e importare Knowledge Base e 
 * Conversazioni tramite file JSON locali.
 *
 * @module  services/backup_mgr
 * @version 1.0.0
 * @date    2026-05-10
 * @author  Gemini CLI
 */

"use strict";

import { idbMgr } from "./idb_mgr.js";
import { DATA_KEYS, REGEX_NAME_CLEANER } from "./data_keys.js";

// ============================================================================
// FUNZIONI PRIVATE - Helper
// ============================================================================

/**
 * Avvia il download di un file nel browser.
 * 
 * @param {string} content  - Contenuto del file (stringa JSON).
 * @param {string} fileName - Nome del file da salvare.
 * @private
 */
const _downloadFile = function(content, fileName) {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

/**
 * Apre un selettore file e legge il contenuto JSON.
 * 
 * @returns {Promise<Object|null>} Oggetto JSON caricato o null.
 * @private
 */
const _pickAndReadFileAsync = async function() {
    let result = null;

    try {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";

        const filePromise = new Promise(function(resolve) {
            input.onchange = function(e) {
                const file = e.target.files[0];
                resolve(file);
            };
        });

        input.click();
        const file = await filePromise;

        if (file) {
            const text = await file.text();
            result = JSON.parse(text);
        }
    } catch (error) {
        console.error("_pickAndReadFileAsync: errore durante la lettura", error);
        result = null;
    }

    // Return Strict
    return result;
};

/**
 * Valida il contenuto di un file KB e individua il bundle del motore.
 * Formati accettati: record d'archivio (`kbBundle` o `bundle`) e bundle diretto.
 *
 * @param {object} data - JSON letto dal file.
 * @returns {Promise<object|null>} `{ bundle, isRawBundle }`, o null.
 */
const _validateKbFileAsync = async function(data) {
    const bundle = data.kbBundle || data.bundle || null;
    const isRawBundle = !bundle && Array.isArray(data.sources) && Array.isArray(data.pages) && Array.isArray(data.catalog);
    if (bundle || isRawBundle) {
        const result = { bundle: bundle, isRawBundle: isRawBundle };
        return result;
    }
    if (data.chunks || data.serializedIndex) {
        await alert("Errore: archivio in formato precedente non supportato. Ricreare la KB con «Crea» e archiviarla di nuovo.");
    } else {
        await alert("Errore: Il file selezionato non è una Knowledge Base valida.");
    }
    const invalid = null;
    return invalid;
};

/**
 * Chiede il nome della KB importata e lo normalizza per la chiave.
 *
 * @returns {Promise<string|null>} Nome normalizzato, o null se annullato.
 */
const _askKbImportNameAsync = async function() {
    const rawName = await prompt("Inserisci un nome per la Knowledge Base importata:");
    if (rawName === null) {
        const cancelled = null;
        return cancelled;
    }
    const name = String(rawName).trim();
    if (name.length === 0) {
        await alert("Errore: Nome non valido.");
        const invalid = null;
        return invalid;
    }
    const sanitizedName = name.replace(REGEX_NAME_CLEANER, "_").replace(/_+/g, "_");
    return sanitizedName;
};

/**
 * Controlla se la chiave esiste già e chiede conferma alla sovrascrittura.
 *
 * @param {string} key - Chiave `rag_kb_*` di destinazione.
 * @param {string} name - Nome normalizzato della KB.
 * @returns {Promise<boolean>} Vero se si può procedere.
 */
const _confirmKbOverwriteAsync = async function(key, name) {
    const exists = await idbMgr.exists(key);
    if (!exists) {
        const free = true;
        return free;
    }
    const question = `Esiste già una KB chiamata "${name}". Vuoi sovrascriverla?`;
    const confirmed = await confirm(question);
    return confirmed;
};

/**
 * Costruisce il record d'archivio da salvare nella chiave `rag_kb_*`.
 *
 * @param {object} data - Record o bundle letto dal file.
 * @param {object} bundle - Bundle del motore (`kbBundle`/`bundle`), o null.
 * @returns {object} Record completo con `kbBundle`.
 */
const _buildKbArchiveRecord = function(data, bundle) {
    if (data.kbBundle) {
        return data;
    }
    const bundleValue = bundle || data;
    const sources = Array.isArray(bundleValue.sources) ? bundleValue.sources : [];
    const pages = Array.isArray(bundleValue.pages) ? bundleValue.pages : [];
    const docNames = sources.map(function(row) { return row.name; });
    const record = {
        chunks: { sources: sources.length, pages: pages.length },
        serializedIndex: "",
        doclist: docNames,
        childchunks: {},
        kbBundle: bundleValue,
        kbId: ""
    };
    return record;
};

/**
 * Legge e valida il file KB, chiede nome e conferma, prepara la scrittura.
 *
 * @returns {Promise<object|null>} `{ key, record, name }`, o null se annullato.
 */
const _prepareKbImportAsync = async function() {
    const data = await _pickAndReadFileAsync();
    if (!data) {
        const empty = null;
        return empty;
    }
    const validated = await _validateKbFileAsync(data);
    if (!validated) {
        const empty = null;
        return empty;
    }
    const sanitizedName = await _askKbImportNameAsync();
    if (!sanitizedName) {
        const empty = null;
        return empty;
    }
    const key = `${DATA_KEYS.KEY_KB_PRE}${sanitizedName}`;
    const proceed = await _confirmKbOverwriteAsync(key, sanitizedName);
    if (!proceed) {
        const empty = null;
        return empty;
    }
    const record = _buildKbArchiveRecord(data, validated.bundle);
    const prepared = { key: key, record: record, name: sanitizedName };
    return prepared;
};

// ============================================================================
// API PUBBLICA
// ============================================================================

export const BackupMgr = {

    /**
     * Esporta un elemento da IndexedDB in un file JSON.
     * 
     * @param {string} key      - Chiave dell'elemento in IndexedDB.
     * @param {string} typeLabel - Etichetta per il nome del file (es. 'KB', 'Convo').
     * @returns {Promise<boolean>} True se l'esportazione ha avuto successo.
     */
    exportItemAsync: async function(key, typeLabel) {
        // Fail Fast
        if (!key) {
            console.error("BackupMgr.exportItemAsync: chiave mancante");
            const invalid = false;
            return invalid;
        }

        let success = false;

        try {
            const data = await idbMgr.read(key);
            
            if (!data) {
                console.error(`BackupMgr.exportItemAsync: nessun dato trovato per la chiave ${key}`);
                const missing = false;
                return missing;
            }

            const json = JSON.stringify(data, null, 2);
            
            // Estrazione nome pulita (preserva underscore interni al nome)
            let itemName = "data";
            if (key.startsWith(DATA_KEYS.KEY_KB_PRE)) {
                itemName = key.slice(DATA_KEYS.KEY_KB_PRE.length);
            } else if (key.startsWith(DATA_KEYS.KEY_CONVO_PRE)) {
                itemName = key.slice(DATA_KEYS.KEY_CONVO_PRE.length);
            }

            const dateStr = new Date().toISOString().split("T")[0];
            const fileName = `wikijs_${typeLabel}_${itemName}_${dateStr}.json`;

            _downloadFile(json, fileName);
            success = true;

        } catch (error) {
            console.error("BackupMgr.exportItemAsync: errore durante l'esportazione", error);
            success = false;
        }

        // Return Strict
        return success;
    },

    /**
     * Importa una Knowledge Base da un file JSON.
     * 
     * @returns {Promise<string|null>} Il nome della KB importata o null in caso di errore.
     */
    importKbAsync: async function() {
        let importedName = null;

        try {
            const prepared = await _prepareKbImportAsync();
            if (prepared) {
                await idbMgr.create(prepared.key, prepared.record);
                importedName = prepared.name;
            }
        } catch (error) {
            console.error("BackupMgr.importKbAsync: errore durante l'importazione", error);
            importedName = null;
        }

        // Return Strict
        return importedName;
    },

    /**
     * Importa una Conversazione da un file JSON.
     * 
     * @returns {Promise<string|null>} Il nome della conversazione importata o null.
     */
    importConvoAsync: async function() {
        let importedName = null;

        try {
            const data = await _pickAndReadFileAsync();

            if (!data) {
                const empty = null;
                return empty;
            }

            // Fail Fast: Validazione struttura Conversazione
            // Supportiamo sia il thread annidato sia il thread semplice
            const thread = data.thread || data;
            if (!Array.isArray(thread)) {
                await alert("Errore: Il file selezionato non è una conversazione valida.");
                const empty = null;
                return empty;
            }

            const rawName = await prompt("Inserisci un nome per la Conversazione importata:");
            
            // Gestione annullamento prompt o stringa vuota
            if (rawName === null) {
                const empty = null;
                return empty;
            }

            const name = String(rawName).trim();
            if (name.length === 0) {
                await alert("Errore: Nome non valido.");
                const empty = null;
                return empty;
            }

            const sanitizedName = name.replace(REGEX_NAME_CLEANER, "_").replace(/_+/g, "_");
            const key = `${DATA_KEYS.KEY_CONVO_PRE}${sanitizedName}`;

            // Controllo sovrascrittura
            const exists = await idbMgr.exists(key);
            if (exists) {
                const confirmOverwrite = await confirm(`Esiste già una conversazione chiamata "${sanitizedName}". Vuoi sovrascriverla?`);
                if (!confirmOverwrite) {
                    const empty = null;
                return empty;
                }
            }

            await idbMgr.create(key, data);
            importedName = sanitizedName;

        } catch (error) {
            console.error("BackupMgr.importConvoAsync: errore durante l'importazione", error);
            importedName = null;
        }

        // Return Strict
        return importedName;
    }
};
