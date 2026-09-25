/**
 * llm_provider.js - Gestione stato provider LLM e cache client.
 *
 * Modulo puro: nessuna UI, nessun riferimento al DOM.
 * Si occupa solo di:
 *   1. Caricare modelli da file (loadModels)
 *   2. Mantenere provider/modello attivo in memoria
 *   3. Mantenere una singola istanza client + API key in variabili dirette
 *   4. Persistenza su IndexedDB (salva/carica configurazione)
 *   5. Fornire getClient() come punto d'ingresso unico per le richieste LLM
 *      di conversazione e getClientFor() come ingresso isolato per i test
 *      (Aggiorna/Test) senza mutare l'attivo
 *
 * UI (tree view, toggle, showConfig) in app_ui.js.
 *
 * @module llm_provider
 * @version 1.0.0
 * @date    2026-09-21
 */

"use strict";

import { getApiKey, fetchApiKeys, IMPLEMENTED_CLIENTS } from "./services/key_retriever.js";
import { createClient, isSupported } from "./llmclient/registry.js";
import { DATA_KEYS } from "./services/data_keys.js";
import { UaDb } from "./services/uadb.js";
import { loadProviderModels } from "./llm/llm-catalog.js";

// ============================================================================
// COSTANTI
// ============================================================================

// I provider sono quelli registrati in llmclient/registry.js
// (IMPLEMENTED_CLIENTS in services/key_retriever.js deriva da lì).
// Ogni provider con file .txt valido in data/models/ compare nell'albero di
// selezione; un file mancante significa semplicemente 0 modelli, nessun errore.
//
// Per aggiungere un provider basta una voce nel registry più il file client:
// nessuna whitelist o switch separata da aggiornare a mano.

// ============================================================================
// STATO PRIVATO
// ============================================================================

/** @type {Object<string, {client: string, models: Object}>} */
let _providerModels = {};

/** @type {Object|null} Istanza client per il provider attivo. */
let _activeClient = null;

/** @type {string} Provider per cui _activeClient è stato creato. */
let _activeClientProvider = "";

/** @type {string} API key usata per creare _activeClient. */
let _activeApiKey = "";

/** @type {string} */
let _activeProvider = "";

/** @type {string} */
let _activeModel = "";

/** @type {number} */
let _windowSize = 0;

// ============================================================================
// FUNZIONI PRIVATE
// ============================================================================

/**
 * Crea una nuova istanza client per il provider specificato.
 * Imposta _activeClient, _activeClientProvider e _activeApiKey.
 * @param {string} clientName - Nome del provider (deve essere nel registry).
 * @param {string} apiKey - Chiave API del provider.
 * @returns {void}
 */
const _createClientInstance = function(clientName, apiKey) {
    if (!clientName) {
        console.error("_createClientInstance: clientName mancante");
        return;
    }

    if (!isSupported(clientName)) {
        _activeClient = null;
        console.warn(`_createClientInstance: client non supportato: ${clientName}`);
    } else {
        _activeClient = createClient(clientName, apiKey);
    }

    if (_activeClient) {
        _activeClientProvider = clientName;
        _activeApiKey = apiKey;
    }
};

/**
 * Controlla se una configurazione salvata è ancora valida.
 * @param {Object} config - Configurazione {provider, model, windowSize}.
 * @returns {boolean} True se provider e modello esistono nel catalogo corrente.
 */
const _isValidConfig = function(config) {
    if (!config || typeof config !== "object" || Object.keys(config).length === 0) {
        const invalid = false;
        return invalid;
    }

    const { provider, model } = config;
    if (!provider || !_providerModels[provider]) {
        const invalid = false;
        return invalid;
    }

    if (!model || !_providerModels[provider].models[model]) {
        const invalid = false;
        return invalid;
    }

    const valid = true;
    return valid;
};

/**
 * Imposta come attivo il primo provider/modello disponibile nel catalogo.
 * @returns {void}
 */
const _setDefaultConfig = function() {
    const providers = Object.keys(_providerModels);
    if (providers.length === 0) return;
    const defaultProvider = providers[0];
    const models = Object.keys(_providerModels[defaultProvider].models);
    if (models.length === 0) return;
    const ok = LlmProvider.setActive(defaultProvider, models[0]);
    if (!ok) {
        console.error("_setDefaultConfig: impossibile impostare default.");
    }
};

// ============================================================================
// API PUBBLICA — providerModels
// ============================================================================

/**
 * Restituisce la mappa provider → modelli caricata da file.
 * @returns {Object}
 */
export const getProviderConfig = function() {
    return _providerModels;
};

/**
 * Crea un client isolato per il provider indicato con la sua chiave,
 * senza toccare provider/modello attivo né la cache _active*.
 * Unico ingresso per Aggiorna/Test: la conversazione resta invariata.
 * @param {string} provider - Nome provider (deve essere nel registry).
 * @param {string} [model] - Nome modello sotto test (solo documentativo,
 *   il client è per-provider; non richiede presenza in catalogo).
 * @returns {Promise<Object|null>} Istanza client o null se provider non
 *   supportato o chiave mancante.
 */
export const getClientFor = async function(provider, model) {
    if (!provider || !isSupported(provider)) {
        if (provider) {
            console.warn(`getClientFor: provider non supportato: ${provider}`);
        } else {
            console.error("getClientFor: provider mancante");
        }
        return null;
    }
    const apiKey = await getApiKey(provider);
    if (!apiKey) {
        console.error(`getClientFor: chiave API mancante per ${provider}`);
        return null;
    }
    const client = createClient(provider, apiKey);
    return client;
};

// ============================================================================
// API PUBBLICA — LlmProvider
// ============================================================================

export const LlmProvider = {

    // ========================================================================
    // INIZIALIZZAZIONE
    // ========================================================================

    /**
     * Carica i modelli da file su disco. Ogni chiamata ricarica da zero.
     * I provider sono quelli con client implementato in llmclient:
     * chi non ha un file modelli semplicemente non compare (0 modelli,
     * nessun errore).
     * @returns {Promise<void>}
     */
    loadModels: async function() {
        _providerModels = {};

        for (const p of IMPLEMENTED_CLIENTS) {
            const models = await loadProviderModels(p);
            if (models.length === 0) {
                continue;
            }

            _providerModels[p] = {
                client: p,
                models: {}
            };

            models.forEach(function(m) {
                _providerModels[p].models[m.name] = {
                    windowSize: m.windowSize
                };
            });
        }
    },

    /**
     * Inizializzazione rapida: carica le API keys.
     * NON carica i modelli dai .txt all'avvio: il catalogo viene popolato
     * solo da "Reset LLM" (dai file) o "Aggiorna LLM" (da discovery API).
     * @returns {Promise<void>}
     */
    init: async function() {
        await fetchApiKeys();
    },

    /**
     * Inietta nel catalogo in memoria i modelli scoperti dinamicamente per un
     * provider (da llmlist). NON applica il filtro del repository: la procedura
     * di aggiornamento deve poter testare anche i modelli non ancora accettati.
     * I modelli già presenti mantengono la finestra esistente.
     * @param {string} provider - Nome del provider.
     * @param {Array<{id: string, contextWindow: number}>} models - Modelli scoperti.
     * @returns {void}
     */
    setModelsFromDiscovery: function(provider, models) {
        if (!provider || !Array.isArray(models)) {
            return;
        }
        if (!_providerModels[provider]) {
            _providerModels[provider] = { client: provider, models: {} };
        }
        const store = _providerModels[provider].models;
        for (const m of models) {
            if (!m || !m.id) {
                continue;
            }
            if (store[m.id]) {
                continue;
            }
            const tokens = m.contextWindow ? Math.round(m.contextWindow / 1024) : 0;
            store[m.id] = { windowSize: tokens };
        }
    },

    /**
     * Filtra il catalogo in memoria in base ai modelli selezionati dall'utente.
     * Rimuove i provider/modelli non presenti nella selezione.
     * @param {Array<{provider: string, model: string}>} selectedModels - Selezione utente.
     * @returns {void}
     */
    applySelectionFilter: function(selectedModels) {
        if (!Array.isArray(selectedModels) || selectedModels.length === 0) {
            return;
        }

        const selectedByProvider = {};
        for (const m of selectedModels) {
            if (!m.provider || !m.model) continue;
            if (!selectedByProvider[m.provider]) {
                selectedByProvider[m.provider] = new Set();
            }
            selectedByProvider[m.provider].add(m.model);
        }

        for (const provider of Object.keys(_providerModels)) {
            const allowed = selectedByProvider[provider];
            if (!allowed) {
                delete _providerModels[provider];
                continue;
            }
            for (const modelName of Object.keys(_providerModels[provider].models)) {
                if (!allowed.has(modelName)) {
                    delete _providerModels[provider].models[modelName];
                }
            }
            if (Object.keys(_providerModels[provider].models).length === 0) {
                delete _providerModels[provider];
            }
        }
    },

    /**
     * Svuota il catalogo in memoria. Usato per ripristinare lo stato
     * della selezione dopo operazioni che modificano _providerModels
     * (es. Aggiorna LLM) senza toccare la selezione salvata.
     * @returns {void}
     */
    clearProviderModels: function() {
        _providerModels = {};
    },

    /**
     * Assicura che i modelli selezionati dall'utente siano presenti in
     * _providerModels con i loro dati completi (windowSize, name, ecc.).
     * Viene chiamato PRIMA di applySelectionFilter per evitare che modelli
     * selezionati non presenti nei file .txt vengano persi.
     * @param {Array<{provider: string, model: string, name?: string, windowSize?: number}>} selectedModels - Selezione utente.
     * @returns {void}
     */
    ensureSelectedModels: function(selectedModels) {
        if (!Array.isArray(selectedModels) || selectedModels.length === 0) {
            return;
        }

        // Ordine deterministico: provider secondo il registry (IMPLEMENTED_CLIENTS),
        // poi nome modello. Senza ordinamento l'ordine di _providerModels segue
        // quello di lettura da IndexedDB e il modello di default diventa imprevedibile.
        const providerRank = function(name) {
            const index = IMPLEMENTED_CLIENTS.indexOf(name);
            const rank = index === -1 ? IMPLEMENTED_CLIENTS.length : index;
            return rank;
        };
        const ordered = selectedModels.slice().sort(function(a, b) {
            const byProvider = providerRank(a.provider) - providerRank(b.provider);
            if (byProvider !== 0) return byProvider;
            const nameA = a.model || "";
            const nameB = b.model || "";
            const byModel = nameA.localeCompare(nameB);
            return byModel;
        });

        for (const m of ordered) {
            if (!m.provider || !m.model) continue;
            if (!_providerModels[m.provider]) {
                _providerModels[m.provider] = { client: m.provider, models: {} };
            }
            const store = _providerModels[m.provider].models;
            if (!store[m.model]) {
                store[m.model] = {
                    windowSize: m.windowSize || 0,
                    name: m.name,
                    elapsedMs: m.elapsedMs,
                    vote: m.vote
                };
            } else {
                if (m.windowSize && !store[m.model].windowSize) store[m.model].windowSize = m.windowSize;
                if (m.name && !store[m.model].name) store[m.model].name = m.name;
                if (m.elapsedMs && !store[m.model].elapsedMs) store[m.model].elapsedMs = m.elapsedMs;
                if (m.vote !== undefined && m.vote !== null && !store[m.model].vote) store[m.model].vote = m.vote;
            }
        }
    },

    // ========================================================================
    // STATO ATTIVO
    // ========================================================================

    /**
     * Restituisce l'oggetto configurazione corrente (provider, model, windowSize).
     * @returns {Object}
     */
    getConfig: function() {
        const config = {
            provider: _activeProvider,
            model: _activeModel,
            windowSize: _windowSize
        };
        return config;
    },

    /**
     * Valida il modello attivo contro il catalogo corrente.
     * Se il provider o il modello non esistono più, imposta il primo disponibile.
     * @returns {boolean} true se il modello attivo era ancora valido.
     */
    validateActive: function() {
        if (_activeProvider && _activeModel &&
            _providerModels[_activeProvider] &&
            _providerModels[_activeProvider].models[_activeModel]) {
            return true;
        }
        _setDefaultConfig();
        return false;
    },

    /**
     * API key attualmente in uso.
     * @returns {string}
     */
    getApiKey: function() {
        return _activeApiKey;
    },

    /**
     * Imposta provider e modello attivi in memoria.
     * Invalida il client se il provider cambia.
     * NON salva su DB, NON tocca la UI.
     * @param {string} provider - Nome del provider.
     * @param {string} model - Nome del modello.
     * @returns {boolean} true se impostato correttamente.
     */
    setActive: function(provider, model) {
        if (!provider || !model) {
            console.error("LlmProvider.setActive: parametri mancanti");
            const missing = false;
            return missing;
        }

        const providerData = _providerModels[provider];
        if (!providerData) {
            console.error(`LlmProvider.setActive: provider sconosciuto: ${provider}`);
            const unknownProvider = false;
            return unknownProvider;
        }

        const modelData = providerData.models[model];
        if (!modelData) {
            console.error(`LlmProvider.setActive: modello sconosciuto: ${model}`);
            const unknownModel = false;
            return unknownModel;
        }

        const providerChanged = provider !== _activeProvider;

        _activeProvider = provider;
        _activeModel = model;
        _windowSize = modelData.windowSize;

        if (providerChanged) {
            _activeClient = null;
            _activeClientProvider = "";
            _activeApiKey = "";
        }

        const success = true;
        return success;
    },

    // ========================================================================
    // CLIENT
    // ========================================================================

    /**
     * Restituisce il client LLM per il provider attivo.
     * Crea una nuova istanza a ogni chiamata leggendo la chiave dal DB.
     * @returns {Promise<Object|null>}
     */
    getClient: async function() {
        if (!_activeProvider) {
            console.error("LlmProvider.getClient: nessun provider attivo");
            const missing = null;
            return missing;
        }

        const apiKey = await getApiKey(_activeProvider);
        if (!apiKey) {
            console.error(`LlmProvider.getClient: chiave API mancante per ${_activeProvider}`);
            _activeClient = null;
            _activeClientProvider = "";
            _activeApiKey = "";
            const missingKey = null;
            return missingKey;
        }

        _createClientInstance(_activeProvider, apiKey);
        return _activeClient;
    },

    /**
     * Restituisce un client isolato per il provider indicato senza mutare
     * provider/modello attivo né la cache _active*. Unico ingresso per
     * Aggiorna/Test LLM.
     * @param {string} provider - Nome provider.
     * @param {string} [model] - Modello sotto test (documentativo).
     * @returns {Promise<Object|null>}
     */
    getClientFor: async function(provider, model) {
        const client = await getClientFor(provider, model);
        return client;
    },

    /**
     * Invalida il client attivo se corrisponde al provider specificato.
     * Chiamato da key_retriever.js quando una chiave viene aggiunta o attivata.
     * @param {string} clientName - Nome del provider.
     * @returns {Promise<void>}
     */
    updateClient: async function(clientName) {
        if (_activeProvider === clientName) {
            _activeClient = null;
            _activeClientProvider = "";
            _activeApiKey = "";
        }
    },

    // ========================================================================
    // PERSISTENZA
    // ========================================================================

    /**
     * Carica la configurazione salvata da IndexedDB e la applica.
     * Se nessuna configurazione valida trovata, imposta il primo provider
     * disponibile come default (scenario primo avvio).
     * NON carica i modelli dai .txt: il catalogo deve essere già popolato
     * (da Reset LLM, Aggiorna LLM o loadSelectedModels).
     * @returns {Promise<void>}
     */
    loadConfig: async function() {
        const savedConfig = await UaDb.readJson(DATA_KEYS.KEY_PROVIDER);

        if (_isValidConfig(savedConfig)) {
            _activeProvider = savedConfig.provider;
            _activeModel = savedConfig.model;
            _windowSize = savedConfig.windowSize;
        } else {
            _setDefaultConfig();
        }
    },

    /**
     * Salva la configurazione corrente su IndexedDB.
     * @returns {Promise<void>}
     */
    saveConfig: async function() {
        const config = LlmProvider.getConfig();
        await UaDb.saveJson(DATA_KEYS.KEY_PROVIDER, config);
    }
};
