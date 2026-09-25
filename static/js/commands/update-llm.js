/**
 * update-llm.js - Comando "Aggiorna LLM".
 * Scopre modelli dai provider, salva in IndexedDB, apre log automaticamente.
 * STOP-buttare: su cancel nessun saveDiscovered, vecchio discovered
 * conservato, solo log. Salvataggio solo validi vote >= MIN_VOTE.
 * Test isolato via getClientFor senza mutare l'attivo.
 *
 * @module commands/update-llm
 * @version 2.1.0
 */

"use strict";

import { llmDb } from "../llm/llm-db.js";
import { createLlmLogger } from "../llm/llm-logging.js";
import { LlmProvider } from "../llm_provider.js";
import { getApiKey, IMPLEMENTED_CLIENTS } from "../services/key_retriever.js";
import { discoverModels, hasFetcher } from "../llmlist/index.js";
import { UaLog } from "../services/ualog3.js";
import { isChatModel, loadRawCatalogForProviders } from "../llm/llm-catalog.js";
import { LlmUpdater, resetCancel, isCancelRequested } from "../llm_updater.js";

/** Numero di token contenuti in un kilotoken (conversione delle finestre di contesto). */
const TOKENS_PER_K = 1024;

/**
 * Voto minimo per persistere un modello in discovered-models.
 * Owner: dominio discovered (filtro di salvataggio, non di display).
 * @type {number}
 */
export const MIN_VOTE = 6;

const _createUaLogAdapter = function() {
    const adapter = {
        appendLine: function(text) {
            UaLog.log(text);
        },
        isVisible: function() {
            const result = UaLog.active;
            return result;
        },
        show: function() {
            if (!UaLog.active) UaLog.toggle();
        }
    };
    return adapter;
};

export const runUpdate = async function() {
    resetCancel();

    await llmDb.init();

    const logAdapter = _createUaLogAdapter();
    const logger = createLlmLogger(logAdapter);

    if (!UaLog.active) {
        UaLog.toggle();
    }

    const fileCatalog = await loadRawCatalogForProviders(IMPLEMENTED_CLIENTS);
    const catalog = {};
    const allDiscovered = [];
    let testedCount = 0;

    for (const provider of IMPLEMENTED_CLIENTS) {
        if (isCancelRequested()) break;

        const apiKey = await getApiKey(provider);
        if (!apiKey) {
            const msg = provider + " saltato (nessuna chiave).";
            UaLog.log(msg);
            continue;
        }

        let modelList = [];
        if (hasFetcher(provider)) {
            try {
                const discovered = await discoverModels(provider, apiKey);
                const chatModels = discovered.filter(m => isChatModel(m.id));
                LlmProvider.setModelsFromDiscovery(provider, chatModels);
                modelList = chatModels.map(m => ({ name: m.id, windowSize: Math.round((m.contextWindow || 0) / TOKENS_PER_K) }));
                const msg1 = provider + ": elenco " + modelList.length + " modelli.";
                UaLog.log(msg1);
            } catch (e) {
                const errType = e.type || "Error";
                const errMsg = e.userMessage || e.message;
                const msg2 = provider + ": discovery fallita (" + errType + "). " + errMsg;
                UaLog.log(msg2);
                modelList = (fileCatalog[provider] || []).filter(m => isChatModel(m.name));
            }
        } else if (fileCatalog[provider]) {
            modelList = fileCatalog[provider].filter(m => isChatModel(m.name));
        }

        for (const m of modelList) {
            const modelObj = { provider, model: m.name, windowSize: m.windowSize };
            allDiscovered.push(modelObj);
            catalog[provider] = catalog[provider] || [];
            catalog[provider].push(m.name);
        }
    }

    UaLog.log("");

    const testResults = new Map();
    const results = [];

    for (const provider of Object.keys(catalog)) {
        if (isCancelRequested()) break;

        logger.providerStart(provider);

        let okCount = 0;
        let errCount = 0;

        for (const model of catalog[provider]) {
            if (isCancelRequested()) break;

            const outcome = await LlmUpdater.testModel(provider, model);
            testedCount++;

            if (outcome.ok) {
                const vote = LlmUpdater.computeVote(outcome.response, outcome.elapsedMs);
                outcome.vote = vote;
                if (vote >= MIN_VOTE) {
                    logger.modelResult(model, true);
                    UaLog.log(provider + "/" + model + ": voto " + vote + " salvabile.");
                } else {
                    logger.modelResult(model, false);
                    UaLog.log(provider + "/" + model + " escluso: voto insufficiente (" + vote + " < " + MIN_VOTE + ").");
                }
                okCount++;
                testResults.set(provider + ":" + model, { elapsedMs: outcome.elapsedMs, vote });
            } else {
                if (outcome.httpCode) {
                    logger.modelError(model, outcome.httpCode);
                } else {
                    logger.modelResult(model, false);
                }
                UaLog.log(provider + "/" + model + " escluso: " + (outcome.reason || "motivo sconosciuto"));
                errCount++;
                testResults.set(provider + ":" + model, { elapsedMs: outcome.elapsedMs, vote: null, error: outcome.reason });
            }

            results.push(outcome);

            if (outcome.cancelled) break;
        }

        logger.providerSummary(provider, okCount, errCount);

        if (results.some(r => r.cancelled)) break;
    }

    for (const obj of allDiscovered) {
        const key = obj.provider + ":" + obj.model;
        const testResult = testResults.get(key);
        if (testResult) {
            obj.elapsedMs = testResult.elapsedMs;
            obj.vote = testResult.vote;
            obj.testError = testResult.error;
        }
    }

    results.sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));

    if (isCancelRequested()) {
        const msg3 = "interrotto — " + testedCount + " modelli testati, scartati.";
        UaLog.log(msg3);
        return results;
    }

    const validDiscovered = allDiscovered.filter(function(obj) {
        return obj.vote !== null && obj.vote !== undefined && obj.vote >= MIN_VOTE;
    });

    await llmDb.saveDiscovered(validDiscovered);

    if (results.length === 0) {
        UaLog.log("nessun provider testabile: discovered invariato, nessuna finestra elenco.");
    } else if (validDiscovered.length === 0) {
        UaLog.log("completato — " + testedCount + " modelli testati, 0 validi (successo-con-zero): discovered svuotato.");
    } else {
        const msg4 = "completato — " + testedCount + " modelli testati, " + validDiscovered.length + " salvati.";
        UaLog.log(msg4);
    }

    return results;
};


