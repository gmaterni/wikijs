/**
 * llm-logging.js - Logger formattato per aggiornamento LLM.
 *
 * Formato righe:
 * - Provider start: === Provider: <name> ===
 * - Successo: ✓ <model>: OK
 * - Errore: (riga vuota) errore <code> <model> (riga vuota)
 * - Summary: --- <provider>: <ok> ok, <err> error ---
 *
 * @module llm/llm-logging
 * @version 1.0.0
 * @date    2026-09-21
 */

"use strict";

/**
 * Crea un logger per la finestra di log.
 * @param {Object} logWindow - Oggetto con metodo appendLine(text)
 * @returns {Object} API logger
 */
export const createLlmLogger = function(logWindow) {
    const _append = function(text) {
        if (logWindow && typeof logWindow.appendLine === "function") {
            logWindow.appendLine(text);
        }
    };

    const api = {
        /**
         * Inizio sezione provider.
         * @param {string} name
         */
        providerStart: function(name) {
            const line = "=== Provider: " + name + " ===";
            _append(line);
        },

        /**
         * Risultato test modello.
         * @param {string} model
         * @param {boolean} ok
         */
        modelResult: function(model, ok) {
            const prefix = ok ? "\u2713" : "\u2717";
            const status = ok ? "OK" : "FAIL";
            const line = prefix + " " + model + ": " + status;
            _append(line);
        },

        /**
         * Errore HTTP per modello.
         * @param {string} model
         * @param {number} httpCode
         */
        modelError: function(model, httpCode) {
            _append("");
            const line = "errore " + httpCode + " " + model;
            _append(line);
            _append("");
        },

        /**
         * Riepilogo provider.
         * @param {string} name
         * @param {number} okCount
         * @param {number} errCount
         */
        providerSummary: function(name, okCount, errCount) {
            const line = "--- " + name + ": " + okCount + " ok, " + errCount + " error ---";
            _append(line);
        }
    };
    return api;
};

