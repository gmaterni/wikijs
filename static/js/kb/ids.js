/**
 * ids.js - Generazione deterministica e validazione degli identificatori.
 *
 * Slug, normalizzazione per i confronti, hash SHA-256 e costruttori di
 * `outputId`, `jobId`, `sourceId` e `stagingId`. Nessun LLM coinvolto.
 *
 * @module ids
 * @version 0.1.1
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

// Pattern degli identificatori (architettura §2.1).
const KB_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_CHARS = 64;
const MAX_QUESTION_SLUG_CHARS = 50;

// Espressione per i wiki-link `[[slug]]` e `[[slug|testo]]`.
const WIKI_LINK_PATTERN = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

/**
 * Controlla la validità di un `kbId`.
 *
 * @param {string} kbId - Identificatore da controllare.
 * @returns {boolean} Vero se conforme al pattern.
 */
const validateKbId = function (kbId) {
    if (typeof kbId !== "string") {
        return false;
    }
    const valid = KB_ID_PATTERN.test(kbId);
    return valid;
};

/**
 * Controlla la validità di uno slug di pagina.
 *
 * @param {string} slug - Slug da controllare.
 * @returns {boolean} Vero se conforme al pattern e al tetto di 64 caratteri.
 */
const isSlug = function (slug) {
    if (typeof slug !== "string") {
        return false;
    }
    const matches = SLUG_PATTERN.test(slug);
    const withinLimit = slug.length <= MAX_SLUG_CHARS;
    const valid = matches && withinLimit;
    return valid;
};

/**
 * Genera uno slug deterministico in kebab-case senza accenti.
 *
 * @param {string} text - Testo di partenza (titolo o domanda).
 * @param {number} maxChars - Lunghezza massima (default 64).
 * @param {string} fallback - Valore se il testo non produce slug (default "pagina").
 * @returns {string} Slug valido, mai vuoto.
 */
const slugify = function (text, maxChars, fallback) {
    const limit = maxChars || MAX_SLUG_CHARS;
    const backup = fallback || "pagina";
    if (typeof text !== "string" || text.length === 0) {
        return backup;
    }
    const withoutAccents = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const lowered = withoutAccents.toLowerCase();
    const dashed = lowered.replace(/[^a-z0-9]+/g, "-");
    const collapsed = dashed.replace(/-+/g, "-");
    const trimmed = collapsed.replace(/^-+|-+$/g, "");
    const cut = trimmed.slice(0, limit);
    const clean = cut.replace(/-+$/g, "");
    const slug = clean.length > 0 ? clean : backup;
    return slug;
};

/**
 * Normalizza un testo solo per i confronti (mai per la memorizzazione).
 *
 * @param {string} text - Testo da normalizzare.
 * @returns {string} Testo in forma canonica.
 */
const normalizeForCompare = function (text) {
    if (typeof text !== "string") {
        return "";
    }
    const nfc = text.normalize("NFC");
    const folded = nfc.toLowerCase();
    const quotes = folded.replace(/[“”«»]/g, '"');
    const apostrophes = quotes.replace(/[’‘‛]/g, "'");
    const dashes = apostrophes.replace(/[–—]/g, "-");
    const collapsed = dashes.replace(/\s+/g, " ");
    const trimmed = collapsed.trim();
    return trimmed;
};

/**
 * Calcola lo SHA-256 esadecimale di un testo (UTF-8).
 *
 * @param {string} text - Testo da firmare.
 * @returns {Promise<string|null>} Hash esadecimale, o null se indisponibile.
 */
const sha256Hex = async function (text) {
    if (typeof text !== "string") {
        console.error("sha256Hex: text non valido");
        return null;
    }
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle) {
        console.error("sha256Hex: crypto.subtle non disponibile");
        return null;
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    let buffer = null;
    try {
        buffer = await subtle.digest("SHA-256", data);
    } catch (error) {
        console.error("sha256Hex:", error);
        return null;
    }
    const bytes = new Uint8Array(buffer);
    let hex = "";
    for (const byte of bytes) {
        const part = byte.toString(16).padStart(2, "0");
        hex = hex + part;
    }
    return hex;
};

/**
 * Formatta un istante in `AAAAMMGGTHHMMSS` (UTC).
 *
 * @param {number} nowMs - Istante in millisecondi.
 * @returns {string} Timbro compattato.
 */
const buildOutputStamp = function (nowMs) {
    const date = new Date(nowMs);
    const year = String(date.getUTCFullYear());
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");
    const seconds = String(date.getUTCSeconds()).padStart(2, "0");
    const stamp = year + month + day + "T" + hours + minutes + seconds;
    return stamp;
};

/**
 * Costruisce un `outputId`, con suffisso `-vN` oltre la prima collisione.
 *
 * @param {string} question - Domanda originale.
 * @param {number} nowMs - Istante in millisecondi (UTC).
 * @param {number} attempt - Tentativo (1 = senza suffisso).
 * @returns {string} Identificatore della risposta.
 */
const makeOutputId = function (question, nowMs, attempt) {
    const questionSlug = slugify(question, MAX_QUESTION_SLUG_CHARS, "query");
    const stamp = buildOutputStamp(nowMs);
    const base = stamp + "-" + questionSlug;
    const tries = attempt || 1;
    const suffix = tries > 1 ? "-v" + String(tries) : "";
    const outputId = base + suffix;
    return outputId;
};

/**
 * Costruisce un `jobId` del tipo `job-<timestamp>-<progressivo>`.
 *
 * @param {number} nowMs - Istante in millisecondi.
 * @param {number} seq - Progressivo.
 * @returns {string} Identificatore del job.
 */
const makeJobId = function (nowMs, seq) {
    const stamp = String(nowMs);
    const progressive = String(seq);
    const jobId = "job-" + stamp + "-" + progressive;
    return jobId;
};

/**
 * Costruisce uno `stagingId` del tipo `<jobId>:<sourceId>:<chunkIndex>:<kind>`.
 *
 * @param {string} jobId - Job di appartenenza.
 * @param {string} sourceId - Sorgente del chunk.
 * @param {number} chunkIndex - Indice del chunk.
 * @param {string} kind - Tipo di risultato (`extract` o `merge`).
 * @returns {string} Chiave di staging.
 */
const makeStagingId = function (jobId, sourceId, chunkIndex, kind) {
    const index = String(chunkIndex);
    const stagingId = jobId + ":" + sourceId + ":" + index + ":" + kind;
    return stagingId;
};

/**
 * Estrae gli slug dai wiki-link `[[slug]]` e `[[slug|testo]]` di un corpo.
 *
 * @param {string} body - Corpo markdown della pagina.
 * @returns {string[]} Slug validi, deduplicati, in ordine di apparizione.
 */
const extractLinks = function (body) {
    const found = [];
    if (typeof body !== "string") {
        return found;
    }
    const pattern = new RegExp(WIKI_LINK_PATTERN);
    let match = pattern.exec(body);
    while (match !== null) {
        const raw = match[1].trim();
        const candidate = raw.toLowerCase();
        if (isSlug(candidate) && !found.includes(candidate)) {
            found.push(candidate);
        }
        match = pattern.exec(body);
    }
    return found;
};

export {
    KB_ID_PATTERN,
    SLUG_PATTERN,
    MAX_SLUG_CHARS,
    MAX_QUESTION_SLUG_CHARS,
    validateKbId,
    isSlug,
    slugify,
    normalizeForCompare,
    sha256Hex,
    buildOutputStamp,
    makeOutputId,
    makeJobId,
    makeStagingId,
    extractLinks
};
