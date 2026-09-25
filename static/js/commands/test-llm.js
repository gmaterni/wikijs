/**
 * test-llm.js - Comando "Test LLM".
 * Esegue una prova con lo stesso prompt su ogni modello selezionato del
 * provider scelto: metriche su UaLog durante l'esecuzione (con spinner e
 * STOP), una sola finestra riepilogativa alla fine.
 *
 * @module commands/test-llm
 * @version 1.1.0
 */

"use strict";

import { LlmProvider } from "../llm_provider.js";
import { llmDb } from "../llm/llm-db.js";
import { createLlmPayload, createMessage, toTextContent } from "../llmclient/index.js";
import { UaLog } from "../services/ualog3.js";
import { UaJtfh } from "../services/uajtfh.js";
import { UaWindowAdm } from "../services/uawindow.js";
import { escapeHtml } from "../services/history_utils.js";

// ============================================================================
// COSTANTI
// ============================================================================

/** Id delle finestre di scelta provider e riepilogo. */
const WINDOW_PICK_ID = "wnd-test-llm-pick";
const WINDOW_SUMMARY_ID = "wnd-test-llm-summary";

/** Z-index delle finestre di test (come le altre finestre applicative). */
/** Livello z-index delle finestre di Test LLM: sopra log (111) e pannelli,
 * sotto dialog (20010+) e spinner (50000+), così la lista non resta in background. */
const WINDOW_Z = 10100;

/** Posizione delle finestre in vw/vh. */
const WINDOW_X_VW = 24;
const WINDOW_Y_VW = 6;

/** Dimensioni orizzontali della finestra riepilogativa finale. */
const SUMMARY_WINDOW_WIDTH_VW = 84;
const SUMMARY_WINDOW_MAX_VW = 94;
const SUMMARY_WINDOW_X_VW = 6;

/** Timeout di una singola prova in secondi. */
const TEST_TIMEOUT_SEC = 60;

/** Token massimi della risposta di prova. */
const TEST_MAX_TOKENS = 512;

/** Temperatura della prova. */
const TEST_TEMPERATURE = 0.7;

/** Messaggio di conferma dello STOP del test. */
const STOP_MESSAGE = "Confermi lo STOP del Test LLM?";

/** Classe CSS del contenitore della finestra di scelta. */
const PICK_CONTAINER_CLASS = "test-llm-pick";

// ============================================================================
// STATO PRIVATO
// ============================================================================

/** @type {boolean} True se l'utente ha chiesto di interrompere il test. */
let _cancelRequested = false;

/** @type {Object|null} Client della prova in corso (per lo STOP immediato). */
let _activeClient = null;

// ============================================================================
// FUNZIONI PRIVATE — lettura stato
// ============================================================================

/**
 * Legge il prompt digitato nella casella di input.
 * @returns {string} Prompt rifilato (stringa vuota se assente).
 */
const _readPrompt = function() {
    const inputEl = document.querySelector(".text-input");
    if (!inputEl || !inputEl.value) {
        const empty = "";
        return empty;
    }
    const prompt = inputEl.value.trim();
    return prompt;
};

/**
 * Raggruppa i modelli selezionati per provider, in ordine di apparizione.
 * @param {Array<Object>} selected - Modelli {provider, model}.
 * @returns {Object<string, Array<string>>} Mappa provider → nomi modello.
 */
const _groupByProvider = function(selected) {
    const grouped = {};
    for (const item of selected) {
        if (!item || !item.provider || !item.model) {
            continue;
        }
        if (!grouped[item.provider]) {
            grouped[item.provider] = [];
        }
        if (!grouped[item.provider].includes(item.model)) {
            grouped[item.provider].push(item.model);
        }
    }
    return grouped;
};

// ============================================================================
// FUNZIONI PRIVATE — finestre
// ============================================================================

/**
 * Mostra una finestra di test con contenuto HTML.
 * @param {string} windowId - Id della finestra.
 * @param {string} html - Contenuto da mostrare.
 */
const _showWindow = function(windowId, html) {
    const win = UaWindowAdm.create(windowId);
    win.drag().setZ(WINDOW_Z);
    win.setHtml(html);
    win.vw_vh().setXY(WINDOW_X_VW, WINDOW_Y_VW, -1);
    win.show();
};

/**
 * Chiude una finestra di test se esiste.
 * @param {string} windowId - Id della finestra.
 */
const _closeWindow = function(windowId) {
    const win = UaWindowAdm.get(windowId);
    if (win) {
        win.close();
    }
};

/**
 * Righe HTML della tabella riepilogativa da un elenco di esiti.
 * @param {Array<Object>} outcomes - Esiti {model, ok, responseChars?, elapsedSec?, code?, reason?}.
 * @returns {string} HTML delle righe.
 */
const _summaryRowsHtml = function(outcomes) {
    const jfh = UaJtfh();
    for (const outcome of outcomes) {
        const name = escapeHtml(outcome.model);
        if (outcome.ok) {
            const respCell = outcome.responseChars + " char";
            const timeCell = outcome.elapsedSec + " s";
            const line = "<tr><td>" + name + "</td><td>" + respCell + "</td><td>" + timeCell + "</td></tr>";
            jfh.append(line);
        } else {
            const errCell = "ERRORE codice: " + outcome.code;
            const reasonCell = escapeHtml(outcome.reason || "");
            const errLine = "<tr><td>" + name + "</td><td>" + errCell + "</td><td>" + reasonCell + "</td></tr>";
            jfh.append(errLine);
        }
    }
    const rowsHtml = jfh.html();
    return rowsHtml;
};

/**
 * Finestra con la lista dei provider con conteggio modelli.
 * Il click su un provider ne avvia il test e chiude la finestra.
 * @param {Object<string, Array<string>>} grouped - Mappa provider → modelli.
 * @param {string} prompt - Prompt da usare per le prove.
 */
const _showProviderWindow = function(grouped, prompt) {
    const providers = Object.keys(grouped);
    const promptText = escapeHtml(prompt);

    const jfh = UaJtfh();
    jfh.append('<div class="' + PICK_CONTAINER_CLASS + ' window-info">');
    jfh.append('<div class="btn-wrapper">');
    jfh.append("<h4>Test LLM</h4>");
    jfh.append('<button class="btn-close" data-help="Chiudi" data-action="test-close">X</button>');
    jfh.append("</div>");
    jfh.append('<p class="test-llm-pick-hint">Seleziona provider per il test</p>');
    jfh.append('<div class="test-llm-prompt-box">' + promptText + "</div>");
    jfh.append('<ul class="test-llm-providers">');
    for (const provider of providers) {
        const name = escapeHtml(provider);
        const count = grouped[provider].length;
        const label = count === 1 ? "1 modello" : count + " modelli";
        const row = '<li><button data-action="test-provider" data-provider="' + name + '"><span class="test-llm-provider-name">' + name + '</span><span class="test-llm-provider-count">' + label + "</span></button></li>";
        jfh.append(row);
    }
    jfh.append("</ul>");
    jfh.append("</div>");

    _showWindow(WINDOW_PICK_ID, jfh.html());

    const win = UaWindowAdm.get(WINDOW_PICK_ID);
    const winEl = win ? win.getElement() : null;
    if (!winEl) {
        return;
    }
    winEl.style.width = "62vw";
    winEl.style.maxWidth = "89vw";
    winEl.addEventListener("click", function(event) {
        const target = event.target.closest("[data-action]");
        if (!target) {
            return;
        }
        const action = target.dataset.action;
        if (action === "test-close") {
            _closeWindow(WINDOW_PICK_ID);
            return;
        }
        if (action === "test-provider") {
            const chosen = target.dataset.provider;
            _closeWindow(WINDOW_PICK_ID);
            runProviderTest(chosen, prompt);
        }
    });
};

/**
 * Finestra riepilogativa finale degli esiti.
 * @param {string} provider - Provider testato.
 * @param {Array<Object>} outcomes - Esiti delle prove.
 */
const _showSummaryWindow = function(provider, outcomes) {
    const title = escapeHtml(provider);
    const jfh = UaJtfh();
    jfh.append('<div class="window-info test-llm-summary">');
    jfh.append('<div class="btn-wrapper">');
    jfh.append("<h4>Riepilogo " + title + "</h4>");
    jfh.append('<button class="btn-close" data-help="Chiudi" data-action="summary-close">X</button>');
    jfh.append("</div>");
    jfh.append('<table class="table-data">');
    jfh.append("<thead><tr><th>Modello</th><th>Response</th><th>Tempo / Errore</th></tr></thead>");
    jfh.append("<tbody>");
    jfh.append(_summaryRowsHtml(outcomes));
    jfh.append("</tbody>");
    jfh.append("</table>");
    jfh.append("</div>");

    _showWindow(WINDOW_SUMMARY_ID, jfh.html());

    const win = UaWindowAdm.get(WINDOW_SUMMARY_ID);
    const winEl = win ? win.getElement() : null;
    if (!winEl) {
        return;
    }
    const summaryWidth = SUMMARY_WINDOW_WIDTH_VW + "vw";
    const summaryMaxWidth = SUMMARY_WINDOW_MAX_VW + "vw";
    const summaryLeft = SUMMARY_WINDOW_X_VW + "vw";
    winEl.style.width = summaryWidth;
    winEl.style.maxWidth = summaryMaxWidth;
    winEl.style.left = summaryLeft;
    winEl.style.right = "auto";
    const inner = winEl.querySelector(".window-info");
    if (inner) {
        inner.style.width = "100%";
        inner.style.maxWidth = "100%";
    }
    winEl.addEventListener("click", function(event) {
        const target = event.target.closest("[data-action]");
        if (!target) {
            return;
        }
        if (target.dataset.action === "summary-close") {
            _closeWindow(WINDOW_SUMMARY_ID);
        }
    });
};

// ============================================================================
// FUNZIONI PRIVATE — esecuzione prove
// ============================================================================

/**
 * Registra su UaLog la riga sintetica di una prova.
 * @param {string} provider - Provider testato.
 * @param {string} model - Modello testato.
 * @param {Object} outcome - Esito {ok, responseChars?, elapsedSec, code?, reason?}.
 * @param {number} requestChars - Dimensione in caratteri della request.
 */
const _logTrial = function(provider, model, outcome, requestChars) {
    const target = provider + "/" + model;
    if (outcome.ok) {
        const line = ">>> " + target + " | req: " + requestChars + " char | resp: " + outcome.responseChars + " char | tempo: " + outcome.elapsedSec + " s <<<";
        UaLog.log(line);
        return;
    }
    const errLine = ">>> ERRORE " + target + " | codice: " + outcome.code + " | " + outcome.reason + " | req: " + requestChars + " char | tempo: " + outcome.elapsedSec + " s <<<";
    UaLog.log(errLine);
};

/**
 * Esegue una singola prova su un modello con il prompt dato.
 * @param {string} provider - Provider del modello.
 * @param {string} model - Nome del modello.
 * @param {string} prompt - Prompt di richiesta.
 * @returns {Promise<Object>} Esito {model, ok, responseChars?, elapsedSec, code?, reason?}.
 */
const _testOneModel = async function(provider, model, prompt) {
    const client = await LlmProvider.getClientFor(provider, model);
    if (!client) {
        const missingKey = { model, ok: false, elapsedSec: "0.0", code: "NO_KEY", reason: "chiave API non disponibile" };
        return missingKey;
    }

    const payload = createLlmPayload(model, [createMessage("user", prompt)], {
        temperature: TEST_TEMPERATURE,
        max_tokens: TEST_MAX_TOKENS
    });
    const requestChars = JSON.stringify(payload).length;

    _activeClient = client;
    const started = Date.now();
    let rr = null;
    try {
        rr = await client.sendRequest(payload, TEST_TIMEOUT_SEC);
    } catch (error) {
        console.error("_testOneModel (" + provider + "/" + model + "):", error);
        const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
        const unexpected = { model, ok: false, elapsedSec, code: "SEND", reason: "errore imprevisto durante l'invio" };
        _logTrial(provider, model, unexpected, requestChars);
        _activeClient = null;
        return unexpected;
    }
    const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
    _activeClient = null;

    if (_cancelRequested) {
        const cancelled = { model, ok: false, elapsedSec, code: 499, reason: "interrotto dall'utente" };
        _logTrial(provider, model, cancelled, requestChars);
        return cancelled;
    }

    if (!rr) {
        const noResult = { model, ok: false, elapsedSec, code: "SEND", reason: "nessuna risposta dal client" };
        _logTrial(provider, model, noResult, requestChars);
        return noResult;
    }

    if (!rr.ok) {
        const err = rr.error || {};
        const code = err.code === undefined || err.code === null ? 0 : err.code;
        const errType = err.type ? err.type + ": " : "";
        const failed = { model, ok: false, elapsedSec, code, reason: errType + (err.message || "errore sconosciuto") };
        _logTrial(provider, model, failed, requestChars);
        return failed;
    }

    const replyText = toTextContent(rr.data);
    if (replyText.trim() === "") {
        const emptyReply = { model, ok: false, elapsedSec, code: "-", reason: "contenuto risposto vuoto" };
        _logTrial(provider, model, emptyReply, requestChars);
        return emptyReply;
    }

    const success = { model, ok: true, elapsedSec, responseChars: replyText.length };
    _logTrial(provider, model, success, requestChars);
    return success;
};

/**
 * Interrompe il test: segnala lo stop e annulla la prova in corso.
 */
const _requestStop = function() {
    _cancelRequested = true;
    if (_activeClient) {
        _activeClient.cancelRequest();
        _activeClient = null;
    }
};

// ============================================================================
// API PUBBLICA
// ============================================================================

/**
 * Esegue il test di tutti i modelli selezionati di un provider.
 * Mostra lo spinner con STOP, logga ogni prova su UaLog e apre la sola
 * finestra riepilogativa alla fine. L'attivo di conversazione resta
 * invariato (prove con client isolato getClientFor).
 * @param {string} provider - Provider da testare.
 * @param {string} prompt - Prompt di richiesta.
 * @returns {Promise<Array<Object>>} Esiti delle prove.
 */
export const runProviderTest = async function(provider, prompt) {
    const outcomes = [];
    if (!provider || !prompt) {
        console.error("runProviderTest: parametri mancanti");
        return outcomes;
    }

    await llmDb.init();
    const selected = await llmDb.getSelected();
    const grouped = _groupByProvider(selected || []);
    const models = grouped[provider] || [];
    if (models.length === 0) {
        await alert("Test LLM: nessun modello selezionato per " + provider + ".");
        return outcomes;
    }

    const uiModule = await import("../app_ui.js");
    const spinner = uiModule.createStopSpinner(_requestStop, STOP_MESSAGE);

    if (!UaLog.active) {
        UaLog.toggle();
    }

    _cancelRequested = false;
    spinner.show();

    try {
        for (const model of models) {
            if (_cancelRequested) {
                break;
            }
            const outcome = await _testOneModel(provider, model, prompt);
            outcomes.push(outcome);
        }
    } finally {
        spinner.hide();
        _activeClient = null;
    }

    if (_cancelRequested) {
        UaLog.log(">>> " + provider + " interrotto dall'utente (" + outcomes.length + " prove) <<<");
    } else {
        UaLog.log(">>> " + provider + " completato (" + outcomes.length + " prove) <<<");
    }

    try {
        uiModule.updateActiveModelDisplay();
    } catch (error) {
        console.error("runProviderTest: display non aggiornato", error);
    }

    _showSummaryWindow(provider, outcomes);

    return outcomes;
};

/**
 * Punto di ingresso del comando "Test LLM": verifica il prompt digitato
 * e apre la finestra con la lista dei provider selezionati.
 * @returns {Promise<void>}
 */
export const runTestLlm = async function() {
    const prompt = _readPrompt();
    if (!prompt) {
        await alert("Test LLM: digita prima un prompt di richiesta nella casella di input.");
        return;
    }

    await llmDb.init();
    const selected = await llmDb.getSelected();
    const grouped = _groupByProvider(selected || []);
    const providers = Object.keys(grouped);
    if (providers.length === 0) {
        await alert("Test LLM: nessun modello selezionato. Esegui Reset LLM o Seleziona LLM.");
        return;
    }

    _showProviderWindow(grouped, prompt);
};


