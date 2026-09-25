/**
 * validate.js - Validazione bloccante degli output LLM.
 *
 * Ogni risposta del modello è un contratto: JSON, forme e tetti sono
 * controllati prima di qualunque scrittura. Nessun accesso a IndexedDB.
 *
 * @module validate
 * @version 0.1.0
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

import { isSlug, slugify } from "./ids.js";
import { DEFAULT_PARAMS } from "./params.js";

const MAX_TITLE_CHARS = 120;
const MIN_TITLE_CHARS = 3;
const MAX_SUMMARY_CHARS = 300;
const MAX_QUOTE_CHARS = 500;
const MAX_QUOTES_STORED = 10;

// Pattern dei wiki-link citati nelle risposte.
const ANSWER_LINK_PATTERN = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

/**
 * Rimuove un eventuale involucro markdown (```json … ```) dal testo.
 *
 * @param {string} text - Testo restituito dal modello.
 * @returns {string} Testo senza code fence.
 */
const stripCodeFences = function (text) {
    const trimmed = text.trim();
    const match = trimmed.match(/^```[a-z]*\s*\n?([\s\S]*?)\n?```$/i);
    const result = match ? match[1].trim() : trimmed;
    return result;
};

/**
 * Interpreta una risposta come JSON.
 *
 * @param {string} text - Testo restituito dal modello.
 * @returns {object} `{ ok, value, error }`.
 */
const parseJson = function (text) {
    const failure = { ok: false, value: null, error: "risposta non JSON" };
    if (typeof text !== "string") {
        return failure;
    }
    let value = null;
    try {
        value = JSON.parse(text);
    } catch (firstError) {
        // Alcuni provider incapsulano il JSON in un blocco markdown: il
        // contratto resta JSON, quindi si ritenta sul contenuto del blocco.
        try {
            value = JSON.parse(stripCodeFences(text));
        } catch (error) {
            console.error("parseJson:", error);
            return failure;
        }
    }
    const result = { ok: true, value: value, error: null };
    return result;
};

/**
 * Pulisce e controlla una singola pagina estratta.
 *
 * @param {object} raw - Pagina proposta dal modello.
 * @param {object} limits - Tetti `{ maxPagesPerChunk, pageBodyMaxChars, quotesPerPage }`.
 * @returns {object} `{ page, errors }` con pagina sanificata o null.
 */
const sanitizeExtractedPage = function (raw, limits) {
    const errors = [];
    if (!raw || typeof raw !== "object") {
        errors.push("pagina non oggetto");
        const empty = { page: null, errors: errors };
        return empty;
    }
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (title.length < MIN_TITLE_CHARS || title.length > MAX_TITLE_CHARS) {
        errors.push("title fuori 3-120 caratteri");
    }
    const proposed = typeof raw.slug === "string" ? raw.slug.trim().toLowerCase() : "";
    const slug = isSlug(proposed) ? proposed : slugify(title);
    if (!isSlug(slug)) {
        errors.push("slug non valido");
    }
    const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
    if (summary.length > MAX_SUMMARY_CHARS) {
        errors.push("summary oltre 300 caratteri");
    }
    const body = typeof raw.body === "string" ? raw.body : "";
    if (body.length === 0 || body.length > limits.pageBodyMaxChars) {
        errors.push("body vuoto o oltre il tetto");
    }
    const links = [];
    if (Array.isArray(raw.links)) {
        for (const candidate of raw.links) {
            const shaped = typeof candidate === "string" ? candidate.trim().toLowerCase() : "";
            if (isSlug(shaped) && !links.includes(shaped)) {
                links.push(shaped);
            }
        }
    }
    const quotes = [];
    if (Array.isArray(raw.quotes)) {
        for (const candidate of raw.quotes) {
            const quoteText = candidate && typeof candidate.text === "string" ? candidate.text.trim() : "";
            if (quoteText.length === 0 || quoteText.length > MAX_QUOTE_CHARS) {
                continue;
            }
            if (quotes.length >= limits.quotesPerPage) {
                break;
            }
            const quote = { text: quoteText };
            quotes.push(quote);
        }
    }
    const contradictions = [];
    if (Array.isArray(raw.contradictions)) {
        for (const candidate of raw.contradictions) {
            if (typeof candidate === "string" && candidate.trim().length > 0) {
                contradictions.push(candidate.trim());
            }
        }
    }
    const category = typeof raw.category === "string" ? raw.category.trim().slice(0, 64) : "";
    const blocked = errors.length > 0;
    const page = blocked ? null : {
        slug: slug,
        title: title,
        category: category,
        summary: summary,
        body: body,
        links: links,
        quotes: quotes,
        contradictions: contradictions
    };
    const result = { page: page, errors: errors };
    return result;
};

/**
 * Valida il payload di estrazione di un chunk.
 *
 * @param {object} value - JSON già interpretato.
 * @param {object} params - Parametri operativi (tetti).
 * @returns {object} `{ ok, pages, errors }`.
 */
const validateExtract = function (value, params) {
    const errors = [];
    const pages = [];
    const active = params || DEFAULT_PARAMS;
    const limits = {
        maxPagesPerChunk: active.maxPagesPerChunk,
        pageBodyMaxChars: active.pageBodyMaxChars,
        quotesPerPage: active.quotesPerPage
    };
    if (!value || typeof value !== "object" || !Array.isArray(value.pages)) {
        errors.push("manca l'array pages");
        const failure = { ok: false, pages: pages, errors: errors };
        return failure;
    }
    if (value.pages.length === 0 || value.pages.length > limits.maxPagesPerChunk) {
        errors.push("pages fuori 1-maxPagesPerChunk");
        const failure = { ok: false, pages: pages, errors: errors };
        return failure;
    }
    for (const raw of value.pages) {
        const checked = sanitizeExtractedPage(raw, limits);
        for (const message of checked.errors) {
            errors.push(message);
        }
        if (checked.page) {
            pages.push(checked.page);
        }
    }
    const ok = errors.length === 0;
    const result = { ok: ok, pages: ok ? pages : [], errors: errors };
    return result;
};

/**
 * Valida la selezione di pagine di una query.
 *
 * @param {object} value - JSON già interpretato.
 * @param {Set} catalogSlugs - Slug presenti nel catalog.
 * @param {number} maxSlugs - Tetto di slug accettati.
 * @returns {object} `{ ok, slugs, reasons, missing, discarded, errors }`.
 */
const validateSelect = function (value, catalogSlugs, maxSlugs) {
    const errors = [];
    const slugs = [];
    const discarded = [];
    if (!value || typeof value !== "object" || !Array.isArray(value.slugs)) {
        errors.push("manca l'array slugs");
        const failure = { ok: false, slugs: slugs, reasons: {}, missing: false, discarded: discarded, errors: errors };
        return failure;
    }
    const reasons = value.reasons && typeof value.reasons === "object" ? value.reasons : {};
    for (const candidate of value.slugs) {
        if (typeof candidate !== "string") {
            continue;
        }
        const slug = candidate.trim().toLowerCase();
        if (!catalogSlugs.has(slug)) {
            discarded.push(slug);
            continue;
        }
        if (!slugs.includes(slug) && slugs.length < maxSlugs) {
            slugs.push(slug);
        }
    }
    const missing = value.missing === true;
    const ok = errors.length === 0;
    const result = { ok: ok, slugs: slugs, reasons: reasons, missing: missing, discarded: discarded, errors: errors };
    return result;
};

/**
 * Elenca gli slug citati con `[[slug]]` in una risposta.
 *
 * @param {string} answer - Testo della risposta.
 * @returns {string[]} Slug citati, deduplicati.
 */
const extractAnswerLinks = function (answer) {
    const found = [];
    if (typeof answer !== "string") {
        return found;
    }
    const pattern = new RegExp(ANSWER_LINK_PATTERN);
    let match = pattern.exec(answer);
    while (match !== null) {
        const slug = match[1].trim().toLowerCase();
        if (slug.length > 0 && !found.includes(slug)) {
            found.push(slug);
        }
        match = pattern.exec(answer);
    }
    return found;
};

/**
 * Valida la risposta composta dal modello.
 *
 * @param {object} value - JSON già interpretato.
 * @param {Set} loadedSlugs - Slug delle pagine caricate.
 * @returns {object} Esito con campi sanificati ed errori.
 */
const validateAnswer = function (value, loadedSlugs) {
    const errors = [];
    if (!value || typeof value !== "object" || typeof value.answer !== "string") {
        errors.push("manca answer");
        const failure = { ok: false, answer: "", citations: [], usedPages: [], missing: false, errors: errors };
        return failure;
    }
    const usedPages = [];
    if (Array.isArray(value.usedPages)) {
        for (const candidate of value.usedPages) {
            if (typeof candidate !== "string") {
                continue;
            }
            const slug = candidate.trim().toLowerCase();
            if (!loadedSlugs.has(slug)) {
                errors.push("usedPages fuori dalle pagine caricate");
                continue;
            }
            if (!usedPages.includes(slug)) {
                usedPages.push(slug);
            }
        }
    }
    const links = extractAnswerLinks(value.answer);
    for (const slug of links) {
        if (!loadedSlugs.has(slug)) {
            errors.push("link a pagina non caricata");
        }
    }
    const citations = [];
    if (Array.isArray(value.citations)) {
        for (const candidate of value.citations) {
            const slug = candidate && typeof candidate.slug === "string" ? candidate.slug.trim().toLowerCase() : "";
            if (!usedPages.includes(slug)) {
                continue;
            }
            const quote = candidate && typeof candidate.quote === "string" ? candidate.quote : "";
            const citation = { slug: slug, quote: quote };
            citations.push(citation);
        }
    }
    const missing = value.missing === true;
    if (missing && !/non presente|assenza|non (ho|sono|abbiamo)/i.test(value.answer)) {
        errors.push("missing:true senza dichiarazione di assenza");
    }
    const ok = errors.length === 0;
    const result = { ok: ok, answer: value.answer, citations: citations, usedPages: usedPages, missing: missing, errors: errors };
    return result;
};

export {
    MAX_QUOTES_STORED,
    parseJson,
    validateExtract,
    validateSelect,
    validateAnswer,
    extractAnswerLinks
};
