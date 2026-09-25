/**
 * quotes.js - Verifica delle citazioni verbatim per sottostringa.
 *
 * Nessuna ricerca fuzzy e nessun offset: la quota è usabile solo se il
 * testo normalizzato del sorgente la contiene per intero.
 *
 * @module quotes
 * @version 0.1.0
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

import { normalizeForCompare } from "./ids.js";

/**
 * Verifica una singola quota contro il testo del sorgente.
 *
 * @param {string} sourceText - Testo integrale del sorgente.
 * @param {string} quoteText - Citazione verbatim proposta.
 * @returns {boolean} Vero se la quota è contenuta nel sorgente.
 */
const verifyQuote = function (sourceText, quoteText) {
    if (typeof sourceText !== "string" || typeof quoteText !== "string") {
        return false;
    }
    const normalizedQuote = normalizeForCompare(quoteText);
    if (normalizedQuote.length === 0) {
        return false;
    }
    const normalizedSource = normalizeForCompare(sourceText);
    const found = normalizedSource.includes(normalizedQuote);
    return found;
};

/**
 * Verifica le quote di una pagina contro il testo del sorgente.
 *
 * @param {string} sourceText - Testo integrale del sorgente.
 * @param {Array} quotes - Quote `{ text }` da verificare.
 * @param {string} sourceId - Identificatore del sorgente.
 * @returns {Array} Quote `{ text, sourceId, verified }`.
 */
const verifyPageQuotes = function (sourceText, quotes, sourceId) {
    const checked = [];
    if (!Array.isArray(quotes)) {
        return checked;
    }
    for (const quote of quotes) {
        const text = quote && typeof quote.text === "string" ? quote.text : "";
        if (text.length === 0) {
            continue;
        }
        const verified = verifyQuote(sourceText, text);
        const item = { text: text, sourceId: sourceId, verified: verified };
        checked.push(item);
    }
    return checked;
};

export { verifyQuote, verifyPageQuotes };
