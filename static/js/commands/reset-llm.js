/**
 * reset-llm.js - Comando "Reset LLM".
 * Cancella la selezione "active" (albero LLM) da IndexedDB e la ripristina
 * leggendo i modelli di default dai file static/data/models/*.txt
 *
 * @module commands/reset-llm
 * @version 1.0.0
 * @date    2026-09-21
 */

"use strict";

import { llmDb } from "../llm/llm-db.js";
import { LlmProvider } from "../llm_provider.js";
import { updateActiveModelDisplay, refreshProviderTree } from "../app_ui.js";
import { UaLog } from "../services/ualog3.js";
import { IMPLEMENTED_CLIENTS } from "../services/key_store.js";
import { loadProviderModels } from "../llm/llm-catalog.js";

/**
 * Legge i modelli di default dai file .txt in static/data/models/
 * Formato .txt: nome|windowSizeTokens per riga, per i soli provider in
 * IMPLEMENTED_CLIENTS, tramite loader unico loadProviderModels.
 * I provider sono quelli con client implementato in llmclient: chi non ha
 * file ha 0 modelli, nessun errore.
 * @returns {Promise<Array<Object>>} Array di {provider, model, name?, windowSize?}
 */
const _readDefaultModels = async function() {
    const allModels = [];

    for (const provider of IMPLEMENTED_CLIENTS) {
        const models = await loadProviderModels(provider);

        for (const m of models) {
            allModels.push({
                provider: provider,
                model: m.name,
                name: m.name,
                windowSize: m.windowSize
            });
        }
    }

    const result = allModels;
    return result;
};

/**
 * Esegue il reset dell'albero LLM ai modelli di default.
 * @returns {Promise<number>} Numero di modelli di default ripristinati.
 */
export const runReset = async function() {
    await llmDb.init();

    await llmDb.clearSelected();

    const defaultModels = await _readDefaultModels();

    if (defaultModels.length > 0) {
        await llmDb.saveSelected(defaultModels);
    }

    await LlmProvider.loadModels();

    // Ricostruisce sempre un attivo valido dal catalogo appena caricato,
    // lo persiste (altrimenti al reload tornerebbe il precedente) e
    // aggiorna display e albero: senza questi passi il reset sembra
    // non avere alcun effetto visibile.
    LlmProvider.validateActive();
    await LlmProvider.saveConfig();
    updateActiveModelDisplay();
    refreshProviderTree();

    const msg = ">>> Reset LLM: albero ricostruito con modelli di default. <<<";
    UaLog.log(msg);

    const restored = defaultModels.length;
    return restored;
};
