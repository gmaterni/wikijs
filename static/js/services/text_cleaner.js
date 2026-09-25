/**
 * @fileoverview text_cleaner.js - Pulizia e normalizzazione testo
 * @description Fornisce funzioni per pulire e normalizzare testo da documenti.
 * @module services/text_cleaner
 */
"use strict";

// ============================================================================
// FUNZIONI PRIVATE
// ============================================================================

/**
 * Rimuove tag speciali dal testo.
 * @param {string} txt - Testo da pulire
 * @returns {string} Testo senza tag speciali
 * @private
 */
const _removeTag = function(txt) {
    const cleaned = txt.replace(/<<<|>>>|<<|>>|#/g, "");
    return cleaned;
};

/**
 * Rimuove link e URL dal testo.
 * @param {string} doc - Testo da pulire
 * @returns {string} Testo senza link
 * @private
 */
const _removeLinks = function(doc) {
    const pattern = /https?:\/\/\S+|file:\/\/\/[^\s]+|\[([^\]]+)\]\([^)]+\)|<a\s+(?:[^>]*?\s+)?href="[^"]*"[^>]*>([^<]+)<\/a>/g;
    const cleaned = doc.replace(pattern, "").trim();
    return cleaned;
};

/**
 * Esegue pulizia approfondita del testo.
 * @param {string} text - Testo da pulire
 * @returns {string} Testo pulito e normalizzato
 * @private
 */
const _cleanText = function(text) {
    let cleaned = text;

    // Rimuove backtick
    cleaned = cleaned.replace(/`/g, "");

    // Unisce parole divise da line break
    cleaned = cleaned.replace(/(\w+)-\s*\n(\w+)/g, "$1$2");

    // Rimuove caratteri non stampabili
    cleaned = cleaned.replace(/[\u00AD\u200B\u200C\u200D\u2060\uFEFF\u0008]/g, "");

    // Normalizza tab e newline strani
    cleaned = cleaned.replace(/[\t\r\f\v]/g, " ");

    // Rimpiazza spazi multipli e altri spazi bianchi con uno spazio singolo
    cleaned = cleaned.replace(/\s+/g, " ");

    // Gestisce escape sequences comuni
    cleaned = cleaned.replace(/\\([nrtfb])/g, " ");

    // Gestisce escape unicode
    cleaned = cleaned.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2})/g, " ");

    // Gestisce path Windows
    cleaned = cleaned.replace(/\\([a-zA-Z]:\\|\\\\[a-zA-Z0-9_]+\\)/g, " ");

    // Rimuove backslash residui
    cleaned = cleaned.replace(/\\/g, " ");

    // Rimuove ripetizioni di caratteri (4 o più)
    cleaned = cleaned.replace(/(.)\1{3,}/g, "");

    // Normalizza virgolette
    cleaned = cleaned.replace(/["""]/g, '"');

    // Normalizza apostrofi
    cleaned = cleaned.replace(/[/'']/g, "'");

    // Rimuove spazi prima di punteggiatura
    cleaned = cleaned.replace(/ +([.,;:!?])/g, "$1");

    // Normalizza spazi multipli
    cleaned = cleaned.replace(/\s+/g, " ");

    // Normalizzazione Unicode NFC
    cleaned = cleaned.normalize("NFC");

    // Trim finale
    cleaned = cleaned.trim();

    return cleaned;
};

/**
 * Divide il testo in linee basate sulla punteggiatura forte.
 * @param {string} text - Testo da dividere
 * @returns {string} Testo con linee separate da newline
 * @private
 */
const _splitIntoLines = function(text) {
    // Lista di abbreviazioni comuni che non terminano una frase
    const abbreviations = ["dott", "ing", "arch", "prof", "sig", "sig.ra", "avv", "pag", "cap", "art", "vol", "cfr", "ecc", "es"];
    
    // Pattern per dividere su punteggiatura forte (.!? ) seguita da spazio e maiuscola
    // Utilizziamo un approccio che evita la divisione dopo le abbreviazioni note
    const pattern = /([.!?])\s+(?=[A-Z])/g;
    
    const lines = [];
    let lastIndex = 0;
    let match;
    
    while ((match = pattern.exec(text)) !== null) {
        const punctuationIndex = match.index;
        const textBefore = text.slice(Math.max(0, punctuationIndex - 10), punctuationIndex).toLowerCase();
        
        // Controlliamo se la parola prima della punteggiatura è un'abbreviazione
        const isAbbreviation = abbreviations.some(abbr => textBefore.endsWith(abbr));
        
        if (!isAbbreviation) {
            lines.push(text.slice(lastIndex, punctuationIndex + 1).trim());
            lastIndex = match.index + match[0].length;
        }
    }
    
    // Aggiungiamo l'ultima parte
    const lastPart = text.slice(lastIndex).trim();
    if (lastPart) {
        lines.push(lastPart);
    }

    const result = lines.join("\n");
    return result;
};

// ============================================================================
// API PUBBLICA
// ============================================================================

/**
 * Pulisce e normalizza un documento testo.
 * @param {string} text - Testo grezzo del documento
 * @returns {string} Testo pulito e normalizzato
 * @public
 */
export const cleanDoc = function(text) {
    let cleaned = text;

    // Rimuove tag speciali
    cleaned = _removeTag(cleaned);

    // Rimuove link e URL
    cleaned = _removeLinks(cleaned);

    // Pulizia approfondita
    cleaned = _cleanText(cleaned);

    // Divide in linee
    const result = _splitIntoLines(cleaned);

    return result;
};

