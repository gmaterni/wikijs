/**
 * app.js - Entry point dell'applicazione WikiJS.
 *
 * Inizializza e avvia l'applicazione coordinando i manager e la UI.
 * Implementa la gestione degli errori globale e l'inizializzazione del sender.
 *
 * @module  app
 * @version 0.1.0
 * @date    2026-05-10
 * @author  Gemini CLI
 */

"use strict";

import { UaLog } from "./services/ualog3.js";
import { bindEventListener, showHtmlThread, wnds, Commands, TextInput, TextOutput, getTheme, updateActiveKbDisplay, updateActiveModelDisplay } from "./app_ui.js";
import { AppMgr } from "./app_mgr.js";
import { WebId } from "./services/webuser_id.js";
import { UaSender } from "./services/sender.js";
import { ragEngine } from "./rag_engine.js";
import { kbInit, addSource as kbAddSource, kbBuild, kbUpdate, kbQuery, kbStatus, kbExport, kbImport, kbLint } from "./kb/index.js";
import { getKbId } from "./kb_ui_state.js";
import { activateProviderAdapter, stopActiveClients } from "./llm_provider_adapter.js";

import "./services/uadialog.js";

// ============================================================================
// COSTANTI DI MODULO
// ============================================================================

/** @type {string} Versione dell'applicazione. */
export const APP_VERSION = "0.1.0";

/** @type {string} URL del worker per l'invio eventi. */
const WORKER_URL = "https://wwwanalyzer-backend.workerua.workers.dev";

// Disabilitazione log non necessari
// Scommentare la riga qui sotto per silenziare console.debug
// console.debug = () => { };
// console.info = () => { };
// console.warn = () => { };


// ============================================================================
// GESTIONE ERRORI GLOBALE
// ============================================================================

/**
 * Gestore globale degli errori sincroni.
 */
window.onerror = function (message, source, lineno, colno, error) {
    const errorMsg = `ERRORE GLOBALE:\n${message}\nIn: ${source}:${lineno}`;
    alert(errorMsg);

    const stopPropagation = false;
    return stopPropagation;
};

/**
 * Gestore globale delle Promise rigettate non gestite.
 */
window.onunhandledrejection = function (event) {
    const error = event.reason;

    // Codice 499 indica un'interruzione manuale dell'utente, da ignorare
    if (error && error.code === 499) {
        return;
    }

    const msg = error.message || error;
    const codePrefix = error.code ? `[${error.code}] ` : "";
    const alertMsg = `ERRORE ASINCRONO (Promise):\n${codePrefix}${msg}`;

    alert(alertMsg);
};


// ============================================================================
// FUNZIONI DI INIZIALIZZAZIONE
// ============================================================================

/**
 * Apre e inizializza l'applicazione.
 *
 * Configura la UI, carica i dati persistenti e avvia i servizi di background.
 *
 * @returns {void}
 */
const openAppAsync = async function () {
    try {
        console.info("openAppAsync: avvio inizializzazione...");
        console.info(`openAppAsync: versione ${APP_VERSION}`);

        // 1. Inizializzazione UI e Log
        wnds.init();
        Commands.init();
        UaLog.setXY(40, 6).setZ(111).new();

        // 2. Inizializzazione Core Applicativo
        await AppMgr.initApp();

        // 2b. Motore WikiJS: adapter LLM, STOP condiviso e comandi console
        activateProviderAdapter();
        ragEngine.setStopHandler(stopActiveClients);
        window.kbInit = kbInit;
        window.kbAddSource = kbAddSource;
        window.kbBuild = kbBuild;
        window.kbUpdate = kbUpdate;
        window.kbQuery = kbQuery;
        window.kbStatus = kbStatus;
        window.kbExport = kbExport;
        window.kbImport = kbImport;
        window.kbLint = kbLint;
        window.kbGetId = getKbId;

        // 3. Configurazione Componenti Input/Output
        TextInput.init();
        TextInput._inputEl?.focus();
        TextOutput.init();

        // 4. Associazione Event Listener e gestione Menu
        bindEventListener();

        const menuBtn = document.querySelector(".menu-btn");
        if (menuBtn) {
            menuBtn.checked = false;
        }

        // 5. Caricamento Stato Precedente
        try {
            await showHtmlThread();
        } catch (e) {
            console.error("openAppAsync: errore caricamento cronologia", e);
            UaLog.log("ERRORE: Impossibile caricare la cronologia precedente.");
        }

        // 6. Caricamento Preferenze Utente
        await getTheme();
        await updateActiveKbDisplay();
        updateActiveModelDisplay(); // <--- AGGIUNTO: Aggiorna display modello attivo

        // 6b. Etichetta versione accanto a README (unica fonte: APP_VERSION).
        const versionEl = document.getElementById("app-version");
        if (versionEl) {
            const versionLabel = `v${APP_VERSION}`;
            versionEl.textContent = versionLabel;
        }

        // 7. Configurazione Sender Eventi
        const userId = WebId.get();
        UaSender.init({
            workerUrl: WORKER_URL,
            userId: userId
        });

        // 8. Notifica apertura app
        await UaSender.sendEventAsync("wikijs", "open");

        console.info("openAppAsync: inizializzazione completata con successo.");

    } catch (error) {
        console.error("openAppAsync: errore fatale durante l'avvio", error);
        UaLog.log("ERRORE FATALE: Controllare la console per i dettagli.");
    }
};


// ============================================================================
// AVVIO
// ============================================================================

// Attende il caricamento completo della pagina prima di avviare l'app
window.addEventListener("load", openAppAsync);
