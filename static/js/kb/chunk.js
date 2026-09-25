/**
 * chunk.js - Suddivisione deterministica dei sorgenti in chunk.
 *
 * Nessun LLM: paragrafi separati da riga vuota, poi confini di frase,
 * mai a metà parola. L'overlap viaggia come contesto separato.
 *
 * @module chunk
 * @version 0.1.0
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

import { DEFAULT_PARAMS } from "./params.js";

// Caratteri che chiudono una frase quando seguiti da spazio.
const SENTENCE_END = new Set([".", "!", "?", "…"]);

/**
 * Trova l'indice del primo confine di frase in una coda di overlap.
 *
 * @param {string} tail - Ultimi caratteri del chunk precedente.
 * @returns {number} Indice da cui parte il contesto, -1 se assente.
 */
const findContextStart = function (tail) {
    for (let i = 0; i < tail.length - 1; i++) {
        const char = tail[i];
        const next = tail[i + 1];
        const boundary = SENTENCE_END.has(char) && (next === " " || next === "\n");
        if (boundary) {
            const start = i + 2;
            return start;
        }
    }
    const notFound = -1;
    return notFound;
};

/**
 * Estrae la coda d'ormeggio del chunk precedente come contesto separato.
 *
 * @param {string} previous - Testo del chunk precedente.
 * @param {number} overlapChars - Lunghezza massima del contesto.
 * @returns {string} Contesto precedente, mai a metà parola.
 */
const buildOverlapContext = function (previous, overlapChars) {
    if (!previous || overlapChars <= 0) {
        return "";
    }
    const tail = previous.slice(-overlapChars);
    const sentenceStart = findContextStart(tail);
    if (sentenceStart >= 0 && sentenceStart < tail.length) {
        const context = tail.slice(sentenceStart);
        return context;
    }
    const firstSpace = tail.indexOf(" ");
    const fallback = firstSpace > 0 ? tail.slice(firstSpace + 1) : tail;
    return fallback;
};

/**
 * Divide un blocco troppo lungo ai confini di frase.
 *
 * @param {string} block - Blocco eccedente `chunkChars`.
 * @param {number} chunkChars - Dimensione massima del chunk.
 * @returns {string[]} Frammenti mai tagliati a metà parola.
 */
const splitLongBlock = function (block, chunkChars) {
    const parts = [];
    let rest = block;
    while (rest.length > chunkChars) {
        let cut = -1;
        const window = rest.slice(0, chunkChars);
        for (let i = window.length - 1; i >= 0; i--) {
            const char = window[i];
            if (SENTENCE_END.has(char)) {
                cut = i + 1;
                break;
            }
        }
        if (cut <= 0) {
            const space = window.lastIndexOf(" ");
            cut = space > 0 ? space : chunkChars;
        }
        const piece = rest.slice(0, cut).trim();
        if (piece.length > 0) {
            parts.push(piece);
        }
        rest = rest.slice(cut).trim();
    }
    if (rest.length > 0) {
        parts.push(rest);
    }
    return parts;
};

/**
 * Suddivide un testo in chunk deterministici.
 *
 * @param {string} text - Contenuto del sorgente.
 * @param {number} chunkChars - Dimensione massima (default 12000).
 * @param {number} overlapChars - Overlap come contesto (default 1500).
 * @returns {Array} Chunk `{ index, text, context, startChar, endChar }`.
 */
const chunkText = function (text, chunkChars, overlapChars) {
    const chunks = [];
    if (typeof text !== "string" || text.length === 0) {
        return chunks;
    }
    const size = chunkChars || DEFAULT_PARAMS.chunkChars;
    const overlap = overlapChars !== undefined ? overlapChars : DEFAULT_PARAMS.chunkOverlapChars;
    const flat = text.replace(/\r\n/g, "\n");
    const rawBlocks = flat.split(/\n\s*\n/);
    const blocks = [];
    for (const raw of rawBlocks) {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
            continue;
        }
        if (trimmed.length > size) {
            const pieces = splitLongBlock(trimmed, size);
            for (const piece of pieces) {
                blocks.push(piece);
            }
        } else {
            blocks.push(trimmed);
        }
    }
    let current = "";
    let currentStart = 0;
    let cursor = 0;
    let index = 0;
    const flush = function () {
        if (current.length === 0) {
            return;
        }
        const previous = chunks.length > 0 ? chunks[chunks.length - 1].text : "";
        const context = buildOverlapContext(previous, overlap);
        const endChar = currentStart + current.length;
        const item = { index: index, text: current, context: context, startChar: currentStart, endChar: endChar };
        chunks.push(item);
        index = index + 1;
        current = "";
    };
    for (const block of blocks) {
        const addition = current.length > 0 ? block.length + 2 : block.length;
        if (current.length > 0 && current.length + addition > size) {
            flush();
            currentStart = cursor;
        }
        if (current.length === 0) {
            currentStart = cursor;
            current = block;
        } else {
            current = current + "\n\n" + block;
        }
        cursor = cursor + block.length + 2;
    }
    flush();
    return chunks;
};

export { chunkText };
