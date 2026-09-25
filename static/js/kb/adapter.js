/**
 * adapter.js - Unico confine verso i modelli linguistici.
 *
 * Ogni capacità LLM passa da qui con `complete({ purpose, ... })`.
 * Provider, chiavi e scelta modello restano fuori ambito: l'adapter è
 * iniettato dall'applicazione ospite e mai reimplementato.
 * L'esito è strutturato `{ ok, text, usage, error }`: i chiamanti
 * distinguono così guasti di trasporto e risposte fuori schema.
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
 * Costruisce un esito di errore strutturato.
 *
 * @param {string} type - Tipo di errore.
 * @param {number|null} code - Codice HTTP o applicativo, se noto.
 * @param {string} message - Messaggio leggibile.
 * @returns {object} `{ ok, text, usage, error }` con `ok` falso.
 */
const _failure = function (type, code, message) {
    const error = { type: type, code: code, message: message };
    const failure = { ok: false, text: null, usage: {}, error: error };
    return failure;
};

/**
 * Normalizza l'errore grezzo restituito da un adapter.
 *
 * @param {object} raw - Errore `{ type, code, message, retryAfterMs? }`.
 * @returns {object} Errore con campi tipizzati.
 */
const _normalizeError = function (raw) {
    const type = typeof raw.type === "string" ? raw.type : "ProviderError";
    const code = typeof raw.code === "number" ? raw.code : null;
    const message = typeof raw.message === "string" ? raw.message : "errore provider";
    const retryAfterMs = typeof raw.retryAfterMs === "number" ? raw.retryAfterMs : null;
    const error = { type: type, code: code, message: message, retryAfterMs: retryAfterMs };
    return error;
};

/**
 * Descrive un errore dell'adapter in testo leggibile.
 *
 * @param {object|null} error - Errore `{ type, code, message }`, o null.
 * @returns {string} Descrizione compatta per note e messaggi.
 */
const describeError = function (error) {
    if (!error) {
        return "errore LLM";
    }
    const parts = [];
    if (error.type) {
        parts.push(error.type);
    }
    if (typeof error.code === "number") {
        parts.push(String(error.code));
    }
    if (error.message) {
        parts.push(error.message);
    }
    const text = parts.length > 0 ? parts.join(" - ") : "errore LLM";
    return text;
};

/**
 * Invoca il modello per un `purpose` con i parametri di routing.
 *
 * @param {object} req - Richiesta `{ purpose, messages, jsonSchema?, temperature?, maxTokens?, model?, signal? }`.
 * @param {object} [override] - Adapter alternativo a quello iniettato (prove o chiamate isolate).
 * @returns {Promise<object>} `{ ok, text, usage, error }`; a `ok` falso `error` è valorizzato.
 */
const complete = async function (req, override) {
    if (!req || typeof req !== "object") {
        console.error("complete: richiesta non valida");
        const invalidRequest = _failure("InvalidRequest", null, "richiesta non valida");
        return invalidRequest;
    }
    if (!VALID_PURPOSES.includes(req.purpose)) {
        console.error("complete: purpose non valido");
        const invalidPurpose = _failure("InvalidRequest", null, "purpose non valido");
        return invalidPurpose;
    }
    if (!Array.isArray(req.messages) || req.messages.length === 0) {
        console.error("complete: messages non validi");
        const invalidMessages = _failure("InvalidRequest", null, "messages non validi");
        return invalidMessages;
    }
    const target = override || _adapter;
    if (!target || typeof target.complete !== "function") {
        console.error("complete: adapter non iniettato");
        const noAdapter = _failure("NoAdapter", null, "adapter non iniettato");
        return noAdapter;
    }
    let outcome = null;
    try {
        outcome = await target.complete(req);
    } catch (error) {
        console.error("complete:", error);
        const message = error && error.message ? error.message : "eccezione adapter";
        const thrown = _failure("AdapterError", null, message);
        return thrown;
    }
    if (outcome && outcome.error && typeof outcome.error === "object") {
        const providerError = _normalizeError(outcome.error);
        const failed = { ok: false, text: null, usage: {}, error: providerError };
        return failed;
    }
    if (!outcome || typeof outcome.text !== "string") {
        console.error("complete: risposta adapter non valida");
        const invalidResponse = _failure("InvalidResponse", null, "risposta adapter non valida");
        return invalidResponse;
    }
    const result = { ok: true, text: outcome.text, usage: outcome.usage || {}, error: null };
    return result;
};

export { setAdapter, getAdapter, hasAdapter, complete, describeError };
