/**
 * config.js - Configurazione globale del sistema RagIndex.
 * 
 * Centralizza le impostazioni di sviluppo e produzione.
 * 
 * @module services/config
 */
"use strict";

/** 
 * Se true, impedisce l'invio degli eventi al worker di analytics in ambiente locale.
 */
export const DISABLE_SENDER_ON_LOCAL = true;

/**
 * Se true, disabilita il login Google in ambiente locale e assegna l'utente LOCAL_USER_ID.
 */
export const DISABLE_LOGIN_ON_LOCAL = true;

/**
 * ID Utente assegnato automaticamente in ambiente locale se DISABLE_LOGIN_ON_LOCAL è true.
 * Modificare questo valore per testare l'isolamento dei database tra utenti diversi.
 */
export const LOCAL_USER_ID = "user_local";

/**
 * Verifica se l'applicazione è in esecuzione in un ambiente locale.
 * 
 * @returns {boolean}
 */
export const isLocalEnvironment = function() {
    const host = window.location.hostname;
    const protocol = window.location.protocol;
    return (host === "localhost" || host === "127.0.0.1" || protocol === "file:");
};
