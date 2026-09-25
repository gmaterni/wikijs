/**
 * rag_engine.js - Ponte tra la UI dell'applicazione e il motore WikiJS.
 *
 * Mantiene la stessa API che `app_ui.js` e `app_mgr.js` si aspettano
 * (`init`, `stop`, `getOptimizedContext`, `generateResponse`),
 * ma esegue la pipeline di query WikiJS (`kbQuery`, index-first con
 * citazioni verificate) e formatta le risposte in markdown per la chat.
 *
 * @module rag_engine
 * @version 2.0.0
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

import { kbQuery } from "./kb/index.js";
import { getKbId } from "./kb_ui_state.js";

// Codice di errore convenzionale per l'interruzione volontaria.
const CANCELLED_CODE = 499;

// Controller dell'operazione in corso (STOP).
let _controller = null;

// Controller della build in corso (STOP durante la compilazione).
let _buildController = null;

// Ultimo risultato di query, per non rieseguirla nella stessa domanda.
let _lastResult = null;

// Modello attivo (solo diagnostica).
let _activeModel = null;

// Gestore di stop iniettato dal chiamante (composition root).
let _stopHandler = null;

/**
 * Crea l'errore di interruzione volontaria.
 *
 * @returns {Error} Errore con `code` 499.
 */
const _cancelledError = function () {
    const error = new Error("Operazione interrotta dall'utente");
    error.code = CANCELLED_CODE;
    return error;
};

/**
 * Formatta il contesto leggibile dell'ultima query.
 *
 * @param {object} result - Risultato di `kbQuery`.
 * @returns {string} Testo del contesto.
 */
const _formatContext = function (result) {
    const lines = [];
    const question = result.question || "";
    lines.push("DOMANDA: " + question);
    const pages = (result.pagesUsed || []).join(", ");
    lines.push("PAGINE USATE: " + (pages || "nessuna"));
    lines.push("CITAZIONI VERIFICATE:");
    const citations = result.citations || [];
    if (citations.length === 0) {
        lines.push("- nessuna");
    } else {
        for (const citation of citations) {
            const quote = citation.quote ? " — «" + citation.quote + "»" : "";
            lines.push("- [[" + citation.slug + "]]" + quote);
        }
    }
    const meta = result.meta || {};
    const calls = typeof meta.calls === "number" ? meta.calls : 0;
    lines.push("MODALITÀ: " + (result.mode || "") + " · CHIAMATE: " + String(calls) + " · PAGINE CONSIDERATE: " + String(meta.pagesConsidered || 0));
    const text = lines.join("\n");
    return text;
};

/**
 * Formatta la risposta della wiki in markdown per la chat.
 *
 * @param {object} result - Risultato di `kbQuery`.
 * @returns {string} Markdown con fonti e provenienza.
 */
const _formatAnswer = function (result) {
    const parts = [];
    parts.push(result.answer || "Informazione non presente nella wiki.");
    const citations = result.citations || [];
    if (citations.length > 0) {
        const lines = citations.map(function (citation) {
            const quote = citation.quote ? " — «" + citation.quote + "»" : "";
            return "- [[" + citation.slug + "]]" + quote;
        });
        parts.push("**Fonti verificate**\n" + lines.join("\n"));
    }
    const pages = (result.pagesUsed || []).join(", ");
    const meta = result.meta || {};
    const calls = typeof meta.calls === "number" ? meta.calls : 0;
    parts.push("*Modalità: " + (result.mode || "") + " · Pagine usate: " + pages + " · Chiamate: " + String(calls) + "*");
    const text = parts.join("\n\n");
    return text;
};

/**
 * Esegue la query WikiJS sulla KB attiva.
 *
 * @param {string} question - Domanda dell'utente.
 * @returns {Promise<object>} Risultato di `kbQuery`.
 */
const _queryAsync = async function (question) {
    if (typeof question !== "string" || question.trim().length === 0) {
        const empty = new Error("Domanda vuota.");
        throw empty;
    }
    _controller = new AbortController();
    const kbId = await getKbId();
    const result = await kbQuery({ kbId: kbId, question: question.trim(), signal: _controller.signal });
    if (_controller.signal.aborted) {
        throw _cancelledError();
    }
    if (!result) {
        const failed = new Error("Query non riuscita: controlla provider LLM e console.");
        throw failed;
    }
    const enriched = Object.assign({}, result, { question: question.trim() });
    _lastResult = { question: question.trim(), result: enriched };
    return enriched;
};

/**
 * Ultimo messaggio dell'utente nello storico.
 *
 * @param {Array} thread - Messaggi `{ role, content }`.
 * @returns {string} Contenuto, o stringa vuota.
 */
const _lastUserMessage = function (thread) {
    const messages = Array.isArray(thread) ? thread : [];
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i] && messages[i].role === "user") {
            return String(messages[i].content || "");
        }
    }
    const empty = "";
    return empty;
};

export const ragEngine = {

    /**
     * Memorizza il contesto di esecuzione (compatibilità applicativa).
     *
     * @param {object} client - Client LLM attivo.
     * @param {string} model - Modello attivo.
     * @param {number} promptSize - Dimensione prompt stimata in byte.
     * @returns {void}
     */
    init: function (client, model, promptSize) {
        _activeModel = model || null;
        console.info("ragEngine.init: motore WikiJS attivo (" + String(_activeModel) + ", prompt " + String(promptSize) + " byte).");
    },

    /**
     * Registra il gestore di stop del chiamante (es. cancellazione dei
     * client LLM attivi), invocato da `stop()`.
     *
     * @param {Function} handler - Callback `() => void`.
     * @returns {void}
     */
    setStopHandler: function (handler) {
        _stopHandler = typeof handler === "function" ? handler : null;
    },

    /**
     * Apre la compilazione come operazione annullabile da `stop()`.
     *
     * @returns {AbortSignal} Segnale da passare a `kbBuild`.
     */
    beginBuild: function () {
        _buildController = new AbortController();
        return _buildController.signal;
    },

    /**
     * Chiude la compilazione in corso.
     *
     * @returns {void}
     */
    endBuild: function () {
        _buildController = null;
    },

    /**
     * Interrompe l'operazione in corso (STOP della UI).
     *
     * @returns {void}
     */
    stop: function () {
        if (_buildController) {
            _buildController.abort();
        }
        if (_controller) {
            _controller.abort();
        }
        if (_stopHandler) {
            _stopHandler();
        }
    },

    /**
     * Prepara il contesto per la domanda: esegue la query WikiJS.
     *
     * @param {string} query - Domanda dell'utente.
     * @param {object} kbData - Dati KB (compatibilità; non usati).
     * @param {Array} thread - Storico della conversazione.
     * @returns {Promise<string>} Contesto leggibile da mostrare e salvare.
     */
    getOptimizedContext: async function (query, kbData, thread) {
        const result = await _queryAsync(query);
        const context = _formatContext(result);
        return context;
    },

    /**
     * Produce la risposta dell'assistente.
     *
     * Usa il risultato già ottenuto per la stessa domanda; altrimenti
     * esegue la query (prosecuzione della conversazione).
     *
     * @param {string} context - Contesto salvato (compatibilità).
     * @param {Array} thread - Storico della conversazione.
     * @returns {Promise<string>} Markdown della risposta.
     */
    generateResponse: async function (context, thread) {
        const question = _lastUserMessage(thread);
        let result = null;
        if (_lastResult && _lastResult.question === question) {
            result = _lastResult.result;
        } else {
            result = await _queryAsync(question);
        }
        const answer = _formatAnswer(result);
        return answer;
    }
};
