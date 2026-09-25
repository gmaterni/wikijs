/**
 * data_keys.js - Chiavi di storage centralizzate
 * Definisce tutte le chiavi di storage usate nell'applicazione
 * per garantire consistenza e manutenibilità.
 *
 * @module  services/data_keys
 * @version 1.0.0
 * @date    2026-09-15
 */
"use strict";

// ============================================================================
// COSTANTI PUBBLICHE
// ============================================================================

/**
 * Oggetto contenente tutte le chiavi di storage.
 * Divise in LOCAL STORAGE (configurazioni) e INDEXEDDB (dati pesanti).
 */
export const DATA_KEYS = {
    // =========================================================================
    // LOCAL STORAGE KEYS
    // Usate per configurazioni e stato UI
    // =========================================================================

    /**
     * Identificativo utente (stringa semplice)
     */
    KEY_WEB_ID: "user_web_id",

    /**
     * Preferenza tema UI (light/dark)
     */
    KEY_THEME: "theme",

    /**
     * Configurazione provider LLM selezionato
     */
    KEY_PROVIDER: "llm_provider",

    /**
     * Chiavi API per vari provider
     */
    KEY_API_KEYS: "api_keys",

    /**
     * Elenco documenti caricati
     * Struttura: Array di oggetti documento
     */
    KEY_DOCS: "docs",

    /**
     * Prefisso per documenti individuali
     * Usato per memorizzare i dati dei singoli documenti
     */
    KEY_DOC_PRE: "idoc_",

    /**
     * Nome della knowledge base attualmente attiva
     */
    ACTIVE_KB_NAME: "active_kb",

    /**
     * Elenco nomi documenti usati nell'ultimo build della KB
     * Struttura: Array di stringhe (nomi documenti)
     */
    KB_DOCLIST: "kb_doclist",

    /**
     * Child chunk per documento, usati per rebuild indice incrementale
     * Struttura: { "docName": [{id, body, keywords, entities}] }
     */
    KB_CHILDCHUNKS: "kb_childchunks",

    // =========================================================================
    // INDEXEDDB KEYS
    // Usate per strutture dati pesanti e stato applicazione
    // =========================================================================

    /**
     * Chunk di documenti elaborati
     * Struttura: Array di oggetti chunk
     */
    PHASE0_CHUNKS: "ph0_chunks",

    /**
     * Indice di ricerca creato dai chunk
     * Struttura: Oggetto indice serializzato
     */
    PHASE1_INDEX: "ph1_index",

    /**
     * Contesto conversazione
     * Struttura: Stringa contenente testo contesto
     */
    PHASE2_CONTEXT: "ph2_context",

    /**
     * Thread conversazione attiva
     * Struttura: Array di oggetti messaggio
     */
    KEY_THREAD: "thread",

    // =========================================================================
    // PREFISSI PER SALVATAGGI NOMINATI
    // Usati per organizzare KB e conversazioni salvate
    // =========================================================================

    /**
     * Prefisso Knowledge Base
     * Struttura: { chunks, serializedIndex }
     */
    KEY_KB_PRE: "rag_kb_",

    /**
     * Prefisso Conversazioni
     * Struttura: { context, thread }
     */
    KEY_CONVO_PRE: "rag_convo_",

    // =========================================================================
    // CHIAVI STATO COSTRUZIONE
    // Usate per il processo di costruzione knowledge base
    // =========================================================================

    /**
     * Tracciamento stato costruzione
     */
    KEY_BUILD_STATE: "knbase_build_state",

    /**
     * Prefisso risultati chunk
     */
    KEY_CHUNK_RES_PRE: "knbase_chunks_",

    /**
     * Prefisso documento KB
     */
    KEY_DOC_KB_PRE: "knbase_doc_kb_"
};

/**
 * Regex standard per la sanitizzazione dei nomi (ID/Alias).
 * Sostituisce spazi e caratteri non alfanumerici con un singolo underscore.
 */
export const REGEX_NAME_CLEANER = /[^a-z0-9]/gi;

// ============================================================================
// VARIABILI PRIVATE
// ============================================================================

/**
 * Mappatura descrizioni per chiavi note.
 */
const KEY_DESCRIPTIONS = {
    [DATA_KEYS.PHASE0_CHUNKS]: "Knowledge Attiva (Chunks)",
    [DATA_KEYS.PHASE1_INDEX]: "Knowledge Attiva (Index)",
    [DATA_KEYS.PHASE2_CONTEXT]: "Contesto & Conversazione Attiva",
    [DATA_KEYS.KEY_THREAD]: "Conversazione Attiva",
    [DATA_KEYS.KEY_PROVIDER]: "Configurazione Provider LLM",
    [DATA_KEYS.KEY_THEME]: "Tema UI (dark/light)",
    [DATA_KEYS.KEY_DOCS]: "Elenco Documenti Caricati",
    [DATA_KEYS.KEY_API_KEYS]: "Chiavi API LLM",
    [DATA_KEYS.ACTIVE_KB_NAME]: "Nome KB Attiva",
    [DATA_KEYS.KB_DOCLIST]: "Elenco Documenti Processati KB",
    [DATA_KEYS.KB_CHILDCHUNKS]: "Child Chunk KB per Rebuild Incrementale",
    [DATA_KEYS.KEY_WEB_ID]: "ID Utente Web",
    [DATA_KEYS.KEY_BUILD_STATE]: "Stato Costruzione KB"
};

// ============================================================================
// FUNZIONI PRIVATE
// ============================================================================

/**
 * Controlla se una chiave inizia con un prefisso noto.
 */
const _startsWith = function(key, prefix) {
    const startsWithPrefix = key.startsWith(prefix);
    return startsWithPrefix;
};

/**
 * Estrae il nome da una chiave con prefisso.
 */
const _extractName = function(key, prefix) {
    const name = key.slice(prefix.length);
    return name;
};

// ============================================================================
// API PUBBLICA
// ============================================================================

/**
 * Restituisce una descrizione leggibile per una chiave di storage.
 */
export const getDescriptionForKey = function(key) {
    // Controllo descrizioni dirette
    const directDesc = KEY_DESCRIPTIONS[key];
    if (directDesc) {
        return directDesc;
    }

    // Controllo prefissi dinamici
    if (_startsWith(key, DATA_KEYS.KEY_KB_PRE)) {
        const name = _extractName(key, DATA_KEYS.KEY_KB_PRE);
        const desc = `Knowledge Archiviata: ${name}`;
        return desc;
    }

    if (_startsWith(key, DATA_KEYS.KEY_CONVO_PRE)) {
        const name = _extractName(key, DATA_KEYS.KEY_CONVO_PRE);
        const desc = `Conversazione Archiviata: ${name}`;
        return desc;
    }

    if (_startsWith(key, DATA_KEYS.KEY_DOC_PRE)) {
        const name = _extractName(key, DATA_KEYS.KEY_DOC_PRE);
        const desc = `Documento Caricato: ${name}`;
        return desc;
    }

    if (_startsWith(key, DATA_KEYS.KEY_CHUNK_RES_PRE)) {
        const name = _extractName(key, DATA_KEYS.KEY_CHUNK_RES_PRE);
        const desc = `Build Temp (Chunks): ${name}`;
        return desc;
    }

    if (_startsWith(key, DATA_KEYS.KEY_DOC_KB_PRE)) {
        const name = _extractName(key, DATA_KEYS.KEY_DOC_KB_PRE);
        const desc = `Build Temp (KB): ${name}`;
        return desc;
    }

    // Nessuna descrizione trovata
    const defaultDesc = "-";
    return defaultDesc;
};
