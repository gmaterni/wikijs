/**
 * llm_updater.js - Test modelli LLM e voto qualità.
 *
 * Modulo puro: nessuna UI, nessun riferimento al DOM.
 * Si occupa di:
 *   1. Test di un singolo modello (testModel) e voto qualità (computeVote)
 *   2. Flag di cancellazione condiviso (cancelUpdate / isCancelRequested / resetCancel)
 *
 * UI (voce di menu, finestra risultati) in app_ui.js.
 * Il comando "Aggiorna LLM" completo è in commands/update-llm.js.
 * La discovery dei modelli è centralizzata in llm/llm-catalog.js e
 * commands/update-llm.js — questo modulo non esporta più la discovery senza test.
 *
 * @module llm_updater
 * @version 1.0.0
 * @date    2026-09-21
 */

"use strict";

import { LlmProvider } from "./llm_provider.js";
import { createLlmPayload, createMessage } from "./llmclient/index.js";
import { TEST_SYSTEM_PROMPT, TEST_USER_PROMPT } from "./llm/test-prompts.js";

// ============================================================================
// COSTANTI
// ============================================================================

/** Prompt di prova fisso, uguale per tutti i modelli per rendere confrontabili tempi e voti. */
const TEST_QUESTION = "Spiega in non più di 5 righe cos'è il teorema di Pitagora, includendo un esempio numerico con numeri interi.";

/** Soglia massima di risposta per considerare superato il test (millisecondi). */
const TEST_TIMEOUT_MS = 20000;

/** Oltre questa durata la risposta è considerata lenta ai fini del voto (millisecondi). */
const VOTE_SLOW_MS = 10000;

/** Intervallo di polling del flag di cancellazione durante il test (millisecondi). */
const CANCEL_POLL_MS = 50;

/**
 * Flag di cancellazione della procedura di aggiornamento. Quando true,
 * runUpdate interrompe il test tra un modello e l'altro (o annulla quello
 * corrente) e termina restituendo i risultati parziali.
 * Unico owner del flag — commands/update-llm.js lo riusa via import.
 * @type {boolean}
 */
let _cancelRequested = false;

/**
 * Richiede l'interruzione della procedura di aggiornamento in corso.
 * @returns {void}
 */
export const cancelUpdate = function() {
    _cancelRequested = true;
};

/**
 * Azzera il flag di cancellazione (chiamato prima di avviare la procedura).
 * @returns {void}
 */
export const resetCancel = function() {
    _cancelRequested = false;
};

/**
 * Verifica se è stata richiesta la cancellazione.
 * @returns {boolean}
 */
export const isCancelRequested = function() {
    return _cancelRequested;
};

// ============================================================================
// FUNZIONI PRIVATE
// ============================================================================

/**
 * Avvolge una promise con un timeout: risolve null se non risolta entro la soglia.
 * @param {Promise} promise - Promise da attendere.
 * @param {number} ms - Timeout in millisecondi.
 * @returns {Promise<Object|null>}
 */
const _withTimeout = async function(promise, ms) {
    let timer;
    const timeoutPromise = new Promise(function(resolve) {
        timer = setTimeout(function() {
            resolve(null);
        }, ms);
    });

    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timer);
    return result;
};

// ============================================================================
// API PUBBLICA — Voto di qualità
// ============================================================================

/**
 * Calcola il voto di qualità (7-10) di una risposta al prompt di prova.
 * Euristica locale: si parte da 10 e si applicano penalità per risposta
 * lenta o breve. I bocciati (errore, timeout, contenuto vuoto) non
 * arrivano mai a questa funzione, quindi il minimo effettivo è 6.
 * @param {string} responseText - Contenuto risposto dal modello.
 * @param {number} elapsedMs - Tempo di risposta in millisecondi.
 * @returns {number} Voto da 6 a 10.
 */
export const computeVote = function(responseText, elapsedMs) {
    let vote = 10;

    if (elapsedMs > VOTE_SLOW_MS) {
        vote -= 1;
    }

    const length = (responseText || "").trim().length;
    if (length < 80) {
        vote -= 1;
    }
    if (length < 20) {
        vote -= 1;
    }

    const clampedVote = Math.max(6, vote);
    return clampedVote;
};

// ============================================================================
// API PUBBLICA — Test di un singolo modello
// ============================================================================

/**
 * Testa un singolo modello inviando il prompt di prova.
 * Usa client isolato getClientFor(provider, model) con la chiave del suo
 * provider, senza mutare provider/modello attivo della conversazione.
 * Payload con createLlmPayload, invio con timeout hard di 20 s.
 * @param {string} provider - Nome del provider.
 * @param {string} model - Nome del modello.
 * @returns {Promise<Object>} { provider, model, ok, elapsedMs?, reason?, response?, vote? }
 */
export const testModel = async function(provider, model) {
    const client = await LlmProvider.getClientFor(provider, model);
    if (!client) {
        const missingApiKey = {
            provider, model,
            ok: false,
            reason: "chiave API non disponibile"
        };
        return missingApiKey;
    }

    const payload = createLlmPayload(model, [
        createMessage("system", TEST_SYSTEM_PROMPT),
        createMessage("user", TEST_USER_PROMPT.replace("{QUESTION}", TEST_QUESTION))
    ], {
        temperature: 0.3,
        max_tokens: 512
    });

    const started = performance.now();
    let rr = null;
    try {
        const sendPromise = client.sendRequest(payload);
        let _cancelResolve = null;
        const cancelPromise = new Promise(function(resolve) {
            _cancelResolve = resolve;
        });
        const timer = setInterval(function() {
            if (_cancelRequested) {
                clearInterval(timer);
                client.cancelRequest();
                _cancelResolve({ cancelled: true });
            }
        }, CANCEL_POLL_MS);
        rr = await _withTimeout(Promise.race([sendPromise, cancelPromise]), TEST_TIMEOUT_MS);
        clearInterval(timer);
    } catch (e) {
        console.error("testModel (" + provider + "/" + model + "):", e);
        const unexpectedError = {
            provider, model,
            ok: false,
            elapsedMs: performance.now() - started,
            reason: "errore imprevisto durante l'invio"
        };
        return unexpectedError;
    }
    const elapsedMs = performance.now() - started;

    if (rr === null) {
        client.cancelRequest();
        const timeoutResult = {
            provider, model,
            ok: false,
            elapsedMs,
            reason: "tempo superiore a 20 secondi"
        };
        return timeoutResult;
    }

    if (rr.cancelled || _cancelRequested) {
        client.cancelRequest();
        const userCancelled = {
            provider, model,
            ok: false,
            elapsedMs,
            cancelled: true,
            reason: "procedura interrotta dall'utente"
        };
        return userCancelled;
    }

    if (!rr.ok) {
        const err = rr.error || {};
        const code = err.status || err.code || 0;
        const typePart = err.type ? err.type + ": " : "";
        const providerError = {
            provider, model,
            ok: false,
            elapsedMs,
            httpCode: code || undefined,
            reason: "errore del provider (" + typePart + (err.message || "errore sconosciuto") + ")"
        };
        return providerError;
    }

    const response = (rr.data && String(rr.data).trim()) || "";
    if (!response) {
        const emptyResponse = {
            provider, model,
            ok: false,
            elapsedMs,
            reason: "contenuto risposto vuoto"
        };
        return emptyResponse;
    }

    const successResult = {
        provider, model,
        ok: true,
        elapsedMs,
        response
    };
    return successResult;
};

// ============================================================================
// API PUBBLICA — LlmUpdater (retrocompatibilità)
// ============================================================================

export const LlmUpdater = {
    computeVote,
    testModel,
    cancelUpdate,
    resetCancel,
    isCancelRequested
};
