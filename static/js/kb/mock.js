/**
 * mock.js - Adapter deterministico per test e verifiche (AC1-AC8).
 *
 * Risponde senza rete con output validi rispetto agli schemi di
 * `validate.js`. Uso esclusivo per prove in browser/console.
 *
 * @module kb/mock
 * @version 0.1.0
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

import { slugify, normalizeForCompare } from "./ids.js";

// Stopword italiane minime per la selezione locale del mock.
const STOPWORDS = new Set([
    "il", "lo", "la", "i", "gli", "le", "di", "a", "da", "in",
    "con", "su", "per", "tra", "fra", "che", "chi", "cosa",
    "come", "sono", "sei", "della", "dello", "nella", "nello", "questo"
]);

/**
 * Estrae i termini significativi di una domanda.
 *
 * @param {string} question - Domanda in linguaggio naturale.
 * @returns {string[]} Termini in forma canonica.
 */
const questionTerms = function (question) {
    const normalized = normalizeForCompare(question || "");
    const raw = normalized.split(" ");
    const terms = [];
    for (const token of raw) {
        const clean = token.replace(/[^a-z0-9à-ÿ]/g, "");
        if (clean.length > 2 && !STOPWORDS.has(clean) && !terms.includes(clean)) {
            terms.push(clean);
        }
    }
    return terms;
};

/**
 * Costruisce una pagina mock valida da un chunk di testo.
 *
 * @param {string} chunkText - Testo del chunk.
 * @param {number} chunkIndex - Indice del chunk nel sorgente.
 * @param {number} bodyMax - Tetto del corpo pagina.
 * @returns {object} Pagina conforme allo schema di estrazione.
 */
const mockPageFromChunk = function (chunkText, chunkIndex, bodyMax) {
    const words = chunkText.split(/\s+/).filter(function (word) {
        return word.length > 0;
    });
    const head = words.slice(0, 6).join(" ");
    const title = "Pagina " + String(chunkIndex + 1) + " " + head.slice(0, 40);
    const slug = slugify(title || ("chunk " + String(chunkIndex)));
    const body = chunkText.slice(0, bodyMax);
    const firstSentence = chunkText.split(/(?<=[.!?…])\s/)[0] || "";
    const quote = firstSentence.slice(0, 500);
    const page = {
        slug: slug,
        title: title.slice(0, 120),
        category: "mock",
        summary: head.slice(0, 300),
        body: body,
        links: [],
        quotes: quote.length > 0 ? [{ text: quote }] : [],
        contradictions: []
    };
    return page;
};

/**
 * Ricava il testo utente dall'ultimo messaggio della richiesta.
 *
 * @param {Array} messages - Messaggi della richiesta.
 * @returns {string} Contenuto dell'ultimo messaggio utente.
 */
const lastUserText = function (messages) {
    let found = "";
    for (const message of messages) {
        if (message && message.role === "user" && typeof message.content === "string") {
            found = message.content;
        }
    }
    return found;
};

/**
 * Crea un adapter mock con catalog opzionale per `select`/`answer`.
 *
 * @param {object} options - Opzioni `{ catalog, bodyMax, failOn }`.
 * @returns {object} Adapter con `complete(req)` e contatore `calls`.
 */
const createMockAdapter = function (options) {
    const opts = options || {};
    const catalog = Array.isArray(opts.catalog) ? opts.catalog : [];
    const bodyMax = opts.bodyMax || 12000;
    const failOn = opts.failOn || 0;
    const state = { calls: 0 };

    const complete = async function (req) {
        state.calls = state.calls + 1;
        if (failOn > 0 && state.calls >= failOn) {
            throw new Error("mock: errore simulato");
        }
        if (!req || typeof req.purpose !== "string") {
            throw new Error("mock: richiesta non valida");
        }
        const userText = lastUserText(req.messages);
        if (req.purpose === "extract") {
            const marker = "<<<TESTO DA COMPILARE>>>";
            const start = userText.indexOf(marker);
            const end = userText.indexOf("<<<FINE TESTO>>>");
            const chunk = start >= 0 && end > start ? userText.slice(start + marker.length, end).trim() : userText;
            const page = mockPageFromChunk(chunk, 0, bodyMax);
            const text = JSON.stringify({ pages: [page], notes: "mock" });
            const result = { text: text, usage: { inputTokens: 10, outputTokens: 10 } };
            return result;
        }
        if (req.purpose === "select") {
            const terms = questionTerms(userText);
            const scored = [];
            for (const row of catalog) {
                const haystack = normalizeForCompare(row.slug + " " + row.title + " " + row.summary);
                let score = 0;
                for (const term of terms) {
                    if (normalizeForCompare(row.title).includes(term)) {
                        score = score + 2;
                    } else if (haystack.includes(term)) {
                        score = score + 1;
                    }
                }
                if (score > 0) {
                    const item = { slug: row.slug, score: score };
                    scored.push(item);
                }
            }
            scored.sort(function (left, right) {
                return right.score - left.score;
            });
            const top = scored.slice(0, 7).map(function (item) {
                return item.slug;
            });
            const reasons = {};
            for (const slug of top) {
                reasons[slug] = "match mock";
            }
            const payload = { slugs: top, reasons: reasons, missing: top.length === 0 };
            const result = { text: JSON.stringify(payload), usage: { inputTokens: 5, outputTokens: 5 } };
            return result;
        }
        if (req.purpose === "answer") {
            const used = catalog.length > 0 ? [catalog[0].slug] : [];
            const cited = used.length > 0 ? "[[" + used[0] + "]]" : "";
            const answer = used.length > 0 ? "Risposta mock con " + cited + "." : "Informazione non presente nella wiki.";
            const payload = {
                answer: answer,
                citations: [],
                usedPages: used,
                missing: used.length === 0
            };
            const result = { text: JSON.stringify(payload), usage: { inputTokens: 5, outputTokens: 5 } };
            return result;
        }
        const fallback = { text: JSON.stringify({}), usage: {} };
        return fallback;
    };

    const adapter = {
        complete: complete,
        calls: function () {
            return state.calls;
        }
    };
    return adapter;
};

export { createMockAdapter };
