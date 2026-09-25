

/**
 * webuser_id.js - Identificativo utente web.
 *
 * Risolve l'utente corrente con bypass locale per sviluppo.
 *
 * @module  services/webuser_id
 * @version 1.0.0
 * @date    2026-09-15
 */
"use strict";

import { DATA_KEYS } from './data_keys.js';
import { DISABLE_LOGIN_ON_LOCAL, LOCAL_USER_ID, isLocalEnvironment } from './config.js';

/**
 * Costante per il valore di fallback (guest).
 */
const GUEST_USER_ID = "ragindex_guest";

export const WebId = (function() {
    const storageKey = DATA_KEYS.KEY_WEB_ID;

    const get = function() {
        // Se siamo in locale e il bypass è attivo, forziamo l'utente locale
        if (DISABLE_LOGIN_ON_LOCAL && isLocalEnvironment()) {
            return LOCAL_USER_ID;
        }

        let userId = localStorage.getItem(storageKey);
        if (!userId) {
            const guestBase = GUEST_USER_ID;
            const nowMs = Date.now();
            userId = `${guestBase}_${nowMs}`;
            // Non salviamo il guest temporaneo nel localStorage per non "sporcarlo"
            // se non esplicitamente richiesto, ma lo restituiamo.
        }
        return userId;
    };

    const clear = function() {
        localStorage.removeItem(storageKey);
    };

    const api = {
        get,
        clear
    };
    return api;
})();
