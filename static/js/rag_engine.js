/**
 * rag_engine.js - Ponte tra la UI dell'applicazione e il motore WikiJS.
 *
 * Mantiene la stessa API che `app_ui.js` e `app_mgr.js` si aspettano
 * (`init`, `stop`, `ask`), esegue la pipeline di query WikiJS (`kbQuery`,
 * index-first con citazioni verificate) e formatta la risposta markdown
 * per la chat. Ogni domanda è una query indipendente: nessuno stato o
 * esito delle domande precedenti è riusato.
 *
 * @module rag_engine
 * @version 2.1.0
 * @date 2026-09-26
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
 * @returns {Promise<object>} Risultato di `kbQuery`, arricchito con la domanda.
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
    return enriched;
};

export const ragEngine = {

    /**
     * Memorizza lo stato di esecuzione (compatibilità applicativa).
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
        const signal = _buildController.signal;
        return signal;
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
     * Esegue una query indipendente e restituisce la risposta markdown.
     *
     * Ogni domanda esegue una sola `kbQuery` completa (Q0-Q4): nessuna
     * distinzione tra prima domanda e successive, nessun riuso di esiti o
     * di cache tra domande diverse.
     *
     * @param {string} question - Domanda dell'utente.
     * @returns {Promise<string>} Markdown della risposta (fonti verificate
     * + riga di provenienza).
     */
    ask: async function (question) {
        const result = await _queryAsync(question);
        const answer = _formatAnswer(result);
        return answer;
    }
};
