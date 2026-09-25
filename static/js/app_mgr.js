/**
 * app_mgr.js - Gestore configurazione applicazione.
 * Inizializza e gestisce la configurazione del provider LLM.
 *
 * @module app_mgr
 * @version 1.0.0
 * @date    2026-09-21
 * @author Team Sviluppo
 */
"use strict";

import { LlmProvider } from "./llm_provider.js";
import { llmDb } from "./llm/llm-db.js";
import { ragEngine } from "./rag_engine.js";

// ============================================================================
// COSTANTI DI MODULO
// ============================================================================

const BYTES_PER_TOKEN = 3;
const PROMPT_OVERHEAD_PERCENT = 0.1;

// ============================================================================
// VARIABILI PRIVATE
// ============================================================================

let _clientLLM = null;

/** @type {Object|null} Istanza singleton del database modelli LLM. */
let _llmDb = null;

// ============================================================================
// FUNZIONI PRIVATE
// ============================================================================

/**
 * Converte token in byte.
 * @param {number} nk - Token in migliaia.
 * @returns {number} Byte stimati.
 */
const _tokensToBytes = function(nk = 32) {
    const rawBytes = 1024 * nk * BYTES_PER_TOKEN;
    const overhead = rawBytes * PROMPT_OVERHEAD_PERCENT;
    const result = Math.trunc(rawBytes + overhead);
    return result;
};

// ============================================================================
// API PUBBLICA
// ============================================================================

/**
 * Restituisce l'istanza del database modelli LLM.
 * @returns {Object|null}
 */
export const getLlmDb = function() {
    return _llmDb;
};

export const AppMgr = {

    /**
     * Inizializza l'applicazione.
     */
    initApp: async function() {
        _llmDb = llmDb;
        await _llmDb.init();

        await LlmProvider.init();
        await AppMgr.loadSelectedModels();
        await AppMgr.initConfig();
    },

    /**
     * Carica i modelli selezionati dal database e applica il filtro al catalogo.
     * Se nessuna selezione è salvata (primo avvio o selezione azzerata),
     * popola dai file .txt con la stessa procedura del menu "Reset LLM",
     * senza chiedere conferma.
     * @returns {Promise<void>}
     */
    loadSelectedModels: async function() {
        if (!_llmDb) return;

        const selected = await _llmDb.getSelected();
        if (selected && selected.length > 0) {
            LlmProvider.ensureSelectedModels(selected);
            LlmProvider.applySelectionFilter(selected);
        } else {
            console.info("AppMgr.loadSelectedModels: selezione vuota, ripristino dai modelli di default (Reset LLM automatico).");
            const resetModule = await import("./commands/reset-llm.js");
            await resetModule.runReset();
            return;
        }

        // Riapplica la configurazione salvata ora che il catalogo è popolato:
        // all'avvio loadConfig() girava con catalogo vuoto, la validazione
        // falliva e la selezione utente veniva sostituita dal default
        // (primo modello del primo provider).
        // AVVISO: il doppio loadConfig() è voluto.
        // Non rimuovere questo secondo giro senza far attendere getSelected()
        // (ensureSelectedModels + applySelectionFilter) prima del primo:
        // senza catalogo popolato validateActive() ripiega sul default e
        // cancella la scelta salvata dell'utente al primo avvio.
        await LlmProvider.loadConfig();
        LlmProvider.validateActive();
    },

    /**
     * Inizializza la configurazione LLM.
     * Viene eseguita ogni volta senza cache: carica la configurazione corrente
     * da LlmProvider e aggiorna ragEngine col client e modello attivo.
     */
    initConfig: async function() {
        await LlmProvider.loadConfig();

        const config = LlmProvider.getConfig();
        if (!config || !config.windowSize) {
            console.error("AppMgr.initConfig: configurazione LLM mancante o non valida");
            return;
        }

        const promptSize = _tokensToBytes(config.windowSize);

        console.info("AppMgr.initConfig: configurazione caricata.");
        console.info(`Provider: ${config.provider} | Model: ${config.model}`);
        console.info(`Window: ${config.windowSize}k | Prompt: ${promptSize} bytes`);

        _clientLLM = await LlmProvider.getClient();
        ragEngine.init(_clientLLM, config.model, promptSize);
    },

    /**
     * Ottiene il client LLM attivo.
     * @returns {Object|null}
     */
    getClientLLM: function() {
        return _clientLLM;
    }
};
