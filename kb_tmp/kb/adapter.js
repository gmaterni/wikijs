/**
 * adapter.js - Unico confine verso i modelli linguistici.
 *
 * Ogni capacità LLM passa da qui con `complete({ purpose, ... })`.
 * Provider, chiavi e scelta modello restano fuori ambito: l'adapter è
 * iniettato dall'applicazione ospite e mai reimplementato.
 *
 * @module kb/adapter
 * @version 0.1.0
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

import { VALID_PURPOSES } from "./params.js";

// Adapter iniettato dall'ospite (null fino all'iniezione).
let _adapter = null;

/**
 * Inietta l'adapter LLM dell'applicazione ospite.
 *
 * @param {object} adapter - Oggetto con `complete(req)`.
 * @returns {boolean} Vero se l'adapter è accettato.
 */
const setAdapter = function (adapter) {
    if (!adapter || typeof adapter.complete !== "function") {
        console.error("setAdapter: adapter senza complete()");
        return false;
    }
    _adapter = adapter;
    return true;
};

/**
 * Restituisce l'adapter iniettato.
 *
 * @returns {object|null} Adapter, o null se assente.
 */
const getAdapter = function () {
    return _adapter;
};

/**
 * Indica se un adapter è disponibile.
 *
 * @returns {boolean} Vero quando le chiamate LLM sono possibili.
 */
const hasAdapter = function () {
    const present = _adapter !== null;
    return present;
};

/**
 * Invoca il modello per un `purpose` con i parametri di routing.
 *
 * @param {object} req - Richiesta `{ purpose, messages, jsonSchema?, temperature?, maxTokens?, model?, signal? }`.
 * @returns {Promise<object|null>} `{ text, usage }`, o null in caso di errore.
 */
const complete = async function (req) {
    if (!req || typeof req !== "object") {
        console.error("complete: richiesta non valida");
        return null;
    }
    if (!VALID_PURPOSES.includes(req.purpose)) {
        console.error("complete: purpose non valido");
        return null;
    }
    if (!Array.isArray(req.messages) || req.messages.length === 0) {
        console.error("complete: messages non validi");
        return null;
    }
    if (!_adapter) {
        console.error("complete: adapter non iniettato");
        return null;
    }
    let outcome = null;
    try {
        outcome = await _adapter.complete(req);
    } catch (error) {
        console.error("complete:", error);
        return null;
    }
    if (!outcome || typeof outcome.text !== "string") {
        console.error("complete: risposta adapter non valida");
        return null;
    }
    const result = { text: outcome.text, usage: outcome.usage || {} };
    return result;
};

export { setAdapter, getAdapter, hasAdapter, complete };
