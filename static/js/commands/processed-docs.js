/**
 * processed-docs.js - Finestra dedicata "Documenti Processati".
 *
 * Mostra i due gruppi (processati da `ingested`, disponibili da
 * `new`/`changed`/`error`) in una finestra ad hoc stile "Seleziona LLM"
 * (header fisso, corpo scrollabile, dimensionata al container) invece
 * della generica window-info, dove gli elenchi lunghi si vedono male.
 * Sola lettura: nessun marcatore viene modificato.
 *
 * Due usi: `show()` sola lettura (voce di menu) e `confirmAsync()`
 * con pulsanti Conferma/Annulla dentro la finestra (flusso «Crea»,
 * senza dialogo nativo sopra).
 *
 * @module commands/processed-docs
 * @version 1.2.0
 * @date 2026-09-26
 */

"use strict";

import { UaWindowAdm } from "../services/uawindow.js";
import { UaJtfh } from "../services/uajtfh.js";
import { escapeHtml } from "../services/history_utils.js";

// ============================================================================
// COSTANTI
// ============================================================================

/** Id della finestra dedicata. */
const WINDOW_ID = "processed-docs-window";

/** Livello z-index della finestra (come selezione LLM). */
const WINDOW_Z_INDEX = 12;

/** Classe del body quando il menu laterale è aperto. */
const CSS_MENU_OPEN = "menu-open";

/** Posizione orizzontale in vw a menu aperto. */
const WINDOW_X_MENU_OPEN = 22;

/** Posizione orizzontale in vw a menu chiuso. */
const WINDOW_X_DEFAULT = 2;

/** Posizione verticale della finestra in vw. */
const WINDOW_Y_VW = 6;

/** Altezza minima della finestra (px). */
const MIN_WINDOW_HEIGHT_PX = 120;

/** Colonna unica (solo nome documento: lo stato sta nel titolo). */
const HEADER_COLS = '<col style="width: 100%;">';

/**
 * Crea la finestra dei documenti processati/disponibili.
 *
 * @param {object} groups - Gruppi `{ processed, available }` (record sorgente).
 * @returns {object} API: { show(), close(), confirmAsync(promptText) }.
 */
export const createProcessedDocsWindow = function(groups) {
    const processed = (groups && Array.isArray(groups.processed)) ? groups.processed : [];
    const available = (groups && Array.isArray(groups.available)) ? groups.available : [];

    /**
     * Mostra la finestra in sola lettura (voce di menu).
     */
    const show = function() {
        _open(null);
    };

    /**
     * Mostra la finestra con richiesta di conferma dentro (flusso «Crea»).
     *
     * @returns {Promise<boolean>} Vero se l'utente conferma.
     */
    const confirmAsync = function() {
        const done = new Promise(function(resolve) {
            _open({ resolve: resolve });
        });
        return done;
    };

    /**
     * Chiude la finestra se aperta.
     */
    const close = function() {
        const win = UaWindowAdm.get(WINDOW_ID);
        if (win && typeof win.close === "function") {
            win.close();
        }
    };

    /**
     * Costruisce, posiziona e mostra la finestra.
     *
     * @param {object|null} confirm - Null per sola lettura, altrimenti
     *   `{ resolve }` per la conferma dentro la finestra.
     */
    const _open = function(confirm) {
        const jfh = UaJtfh();
        jfh.append('<div class="window-info">');
        _appendHeader(jfh, confirm);
        jfh.append('<div class="div-info docs-select-content">');
        _appendGroup(jfh, "Documenti Processati", processed);
        _appendGroup(jfh, "Documenti da processare", available);
        jfh.append("</div>"); // .div-info
        jfh.append("</div>"); // .window-info

        const win = UaWindowAdm.create(WINDOW_ID);
        win.drag().setZ(WINDOW_Z_INDEX);
        win.setHtml(jfh.html());
        const isMenuOpen = document.body.classList.contains(CSS_MENU_OPEN);
        const xPos = isMenuOpen ? WINDOW_X_MENU_OPEN : WINDOW_X_DEFAULT;
        win.vw_vh().setXY(xPos, WINDOW_Y_VW, -1);
        win.show();

        const winEl = win.getElement();
        if (winEl) {
            _sizeWindow(winEl);
            if (confirm) {
                _bindConfirm(winEl, confirm.resolve);
            } else {
                _bindClose(winEl);
            }
        } else if (confirm) {
            confirm.resolve(false);
        }
    };

    const api = { show: show, close: close, confirmAsync: confirmAsync };
    return api;
};

/**
 * Aggiunge la barra con i soli pulsanti (i conteggi stanno nei titoli).
 *
 * @param {object} jfh - Istanza UaJtfh della finestra.
 * @param {object|null} confirm - Null per sola lettura, altrimenti truthy
 *   per mostrare anche Conferma/Annulla.
 */
const _appendHeader = function(jfh, confirm) {
    jfh.append('<div class="btn-wrapper docs-btn-wrapper">');
    if (confirm) {
        jfh.append('<button class="btn-success" data-help="Conferma|Avvia l\'elaborazione dei documenti disponibili." data-action="docs-proceed">Conferma</button>');
        jfh.append('<button class="btn-danger" data-help="Annulla|Chiude senza elaborare." data-action="docs-abort">Annulla</button>');
    }
    jfh.append('<button class="btn-close" data-help="Chiudi|Chiude l\'elenco documenti." data-action="docs-close">X</button>');
    jfh.append('</div>');
};

/**
 * Aggiunge un gruppo con corpo scrollabile, senza intestazioni.
 *
 * @param {object} jfh - Istanza UaJtfh della finestra.
 * @param {string} title - Titolo del gruppo.
 * @param {Array} rows - Record sorgente del gruppo.
 */
const _appendGroup = function(jfh, title, rows) {
    jfh.append('<h5 class="docs-group-title">' + title + ' (' + rows.length + ')</h5>');
    if (rows.length === 0) {
        return;
    }
    jfh.append('<div class="docs-scroll-body">');
    jfh.append('<table class="table-data docs-select-table">');
    jfh.append(HEADER_COLS);
    jfh.append('<tbody>');
    for (const row of rows) {
        jfh.append('<tr><td>' + escapeHtml(row.name || "") + '</td></tr>');
    }
    jfh.append('</tbody></table>');
    jfh.append('</div>'); // .docs-scroll-body
};

/**
 * Adatta la finestra al contenuto, con limite al container.
 *
 * @param {HTMLElement} winEl - Elemento della finestra.
 */
const _sizeWindow = function(winEl) {
    winEl.style.width = "55vw";
    winEl.style.maxWidth = "89vw";
    winEl.style.overflow = "hidden";

    const container = document.querySelector(".container");
    const winRect = winEl.getBoundingClientRect();
    const containerRect = container ? container.getBoundingClientRect() : null;
    let maxH = 0;
    if (containerRect) {
        maxH = containerRect.bottom - winRect.top;
    } else {
        maxH = window.innerHeight - winRect.top;
    }
    const targetH = Math.max(MIN_WINDOW_HEIGHT_PX, maxH);

    winEl.style.height = targetH + "px";
    winEl.style.maxHeight = targetH + "px";

    const inner = winEl.querySelector(".window-info");
    if (inner) {
        inner.style.height = targetH + "px";
        inner.style.maxHeight = targetH + "px";
    }

    const bodies = winEl.querySelectorAll(".docs-scroll-body");
    let bodiesH = 0;
    bodies.forEach(function(bodyEl) {
        bodiesH = bodiesH + bodyEl.scrollHeight;
    });
    const btnsEl = winEl.querySelector(".docs-btn-wrapper");
    const titlesH = winEl.querySelectorAll(".docs-group-title").length * 24;
    const btnsH = btnsEl ? btnsEl.getBoundingClientRect().height : 0;
    const naturalH = btnsH + titlesH + bodiesH + 12;
    const finalH = Math.min(naturalH, targetH);
    winEl.style.height = finalH + "px";
    if (inner) {
        inner.style.height = finalH + "px";
        inner.style.maxHeight = targetH + "px";
    }
};

/**
 * Lega il pulsante di chiusura (senza globali window).
 *
 * @param {HTMLElement} winEl - Elemento della finestra.
 */
const _bindClose = function(winEl) {
    const btnClose = winEl.querySelector('[data-action="docs-close"]');
    if (btnClose) {
        btnClose.addEventListener("click", function() {
            UaWindowAdm.get(WINDOW_ID).close();
        });
    }
};

/**
 * Lega Procedi/Annulla/X alla promessa di conferma (senza globali window).
 *
 * @param {HTMLElement} winEl - Elemento della finestra.
 * @param {Function} resolve - Risoluzione della promessa di conferma.
 */
const _bindConfirm = function(winEl, resolve) {
    const done = function(value) {
        const win = UaWindowAdm.get(WINDOW_ID);
        if (win && typeof win.close === "function") {
            win.close();
        }
        resolve(value);
    };
    const btnProceed = winEl.querySelector('[data-action="docs-proceed"]');
    const btnAbort = winEl.querySelector('[data-action="docs-abort"]');
    const btnClose = winEl.querySelector('[data-action="docs-close"]');
    if (btnProceed) {
        btnProceed.addEventListener("click", function() { done(true); });
    }
    if (btnAbort) {
        btnAbort.addEventListener("click", function() { done(false); });
    }
    if (btnClose) {
        btnClose.addEventListener("click", function() { done(false); });
    }
};
