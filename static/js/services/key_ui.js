/**
 * key_ui.js - Finestra gestione chiavi API.
 *
 * Solo rendering e interazione: form, tabella, handler add/attiva/elimina.
 * La persistenza resta in key_store.js.
 *
 * @module  key_ui
 * @version 1.0.0
 * @date    2026-09-21
 */

"use strict";

import { UaJtfh } from "./uajtfh.js";
import { UaDb } from "./uadb.js";
import { STORAGE_KEY, INITIAL_DB } from "./key_store.js";
import { escapeHtml } from "./history_utils.js";
import { getProviderNames } from "../llmclient/registry.js";

/**
 * Recupera la lista dei provider supportati dal catalogo in memoria.
 * Se il catalogo non è ancora caricato, ripiega sull'elenco del registry.
 * @returns {Promise<Array<string>>}
 * @private
 */
const _getSupportedProviders = async function() {
    const { getProviderConfig } = await import("../llm_provider.js");
    const config = getProviderConfig();

    if (Object.keys(config).length > 0) {
        const result = Object.keys(config);
        return result;
    }

    // Fallback se il catalogo non è ancora caricato
    const result = getProviderNames();
    return result;
};

/**
 * Gestore principale delle API Keys (UI).
 * @returns {Promise<void>}
 */
export async function addApiKey() {
    let db = await UaDb.readJson(STORAGE_KEY) || JSON.parse(JSON.stringify(INITIAL_DB));

    const render = async function() {
        const jfh = UaJtfh();

        // Uniamo i provider supportati con quelli già nel DB
        const supported = await _getSupportedProviders();
        const allProviders = new Set([
            ...supported,
            ...Object.keys(db.providers || {})
        ]);
        const sortedAllProviders = Array.from(allProviders).sort();

        jfh.append('<div class="ak-manager">');

        // 1. Form Aggiunta
        jfh.append('<div class="ak-form">');

        // Riga 1: etichette
        jfh.append('<div class="ak-form-row">');
        jfh.append('<div><label class="ak-label">Provider</label></div>');
        jfh.append('<div><label class="ak-label">Nome (es. work)</label></div>');
        jfh.append('<div class="ak-grow"><label class="ak-label">API Key</label></div>');
        jfh.append('<button class="ak-btn-add" data-action="add-key">Aggiungi</button>');
        jfh.append('</div>');

        // Riga 2: input
        jfh.append('<div class="ak-form-row-inputs">');
        jfh.append('<div><select id="key-sel-provider" class="ak-select">');
        sortedAllProviders.forEach(p => jfh.append(`<option value="${p}">${p}</option>`));
        jfh.append('</select></div>');
        jfh.append('<div><input type="text" id="key-inp-name" placeholder="work" class="ak-input-name"></div>');
        jfh.append('<div class="ak-grow-min"><input type="text" id="key-inp-key" placeholder="Inserisci API key" class="ak-input-key"></div>');
        jfh.append('</div>');

        jfh.append('</div>');

        // 2. Elenco
        jfh.append('<div class="ak-list-wrap">');
        jfh.append('<table class="ak-table">');
        jfh.append('<thead class="ak-thead"><tr>');
        jfh.append('<th class="ak-th-radio">Attiva</th>');
        jfh.append('<th class="ak-th-name">Nome</th>');
        jfh.append('<th class="ak-th-key">Chiave</th>');
        jfh.append('<th class="ak-th-del">Del</th>');
        jfh.append('</tr></thead><tbody>');

        const sortedProviders = Object.keys(db.providers || {}).sort();
        if (sortedProviders.length === 0) {
            jfh.append('<tr><td colspan="4" class="ak-empty">Nessuna chiave configurata.</td></tr>');
        } else {
            sortedProviders.forEach(pName => {
                const providerData = db.providers[pName];
                const keys = providerData.keys || [];
                const activeKey = providerData.exported_key;

                jfh.append(`<tr class="ak-provider-row"><td colspan="4" class="ak-provider-name">${pName}</td></tr>`);

                if (keys.length === 0) {
                    jfh.append('<tr><td colspan="4" class="ak-no-keys">Nessuna chiave.</td></tr>');
                } else {
                    keys.forEach(k => {
                        const isChecked = activeKey === k.name;
                        const rowClass = isChecked ? "ak-key-row ak-key-row-active" : "ak-key-row";
                        const nameClass = isChecked ? "ak-cell-name ak-cell-name-active" : "ak-cell-name";
                        const keyClass = isChecked ? "ak-cell-key ak-cell-key-active" : "ak-cell-key ak-cell-key-inactive";
                        const checkedAttr = isChecked ? 'checked' : '';
                        const keyPrefix = k.key.substring(0, 8);
                        const keySuffix = k.key.substring(k.key.length - 4);
                        const keyDisplay = `${keyPrefix}...${keySuffix}`;
                        const keyNameEscaped = escapeHtml(k.name);
                        const providerEscaped = escapeHtml(pName);
                        jfh.append(`<tr class="${rowClass}">`);
                        jfh.append(`<td class="ak-cell-center"><input type="radio" name="group_${providerEscaped}" ${checkedAttr} class="ak-radio" data-action="set-active" data-provider="${providerEscaped}" data-keyname="${keyNameEscaped}"></td>`);
                        jfh.append(`<td class="${nameClass}">${keyNameEscaped}</td>`);
                        jfh.append(`<td class="${keyClass}">${keyDisplay}</td>`);
                        jfh.append(`<td class="ak-cell-center"><button class="btn-danger ak-btn-del" data-action="delete-key" data-provider="${providerEscaped}" data-keyname="${keyNameEscaped}">X</button></td>`);
                        jfh.append('</tr>');
                    });
                }
            });
        }
        jfh.append('</tbody></table></div></div>');

        wnds.winfo.show(jfh.html());
    };

    const saveDb = async function() {
        db.last_updated = new Date().toISOString();
        await UaDb.saveJson(STORAGE_KEY, db);
        await render();
    };

    // Delega eventi sul container della finestra, registrata una sola volta:
    // i re-render sostituiscono il contenuto ma non il contenitore.
    const container = wnds.winfo.getElement();
    if (container) {
        container.addEventListener("click", async function(e) {
            const target = e.target.closest("[data-action]");
            if (!target) return;

            const action = target.dataset.action;

            if (action === "add-key") {
                await _handleAddKey(db, saveDb);
            } else if (action === "set-active") {
                const provider = target.dataset.provider;
                const keyName = target.dataset.keyname;
                await _handleSetActiveKey(provider, keyName, db, saveDb, render);
            } else if (action === "delete-key") {
                const provider = target.dataset.provider;
                const keyName = target.dataset.keyname;
                await _handleDeleteKey(provider, keyName, db, saveDb);
            }
        });
    }

    await render();
}

// ============================================================================
// HANDLER (private)
// ============================================================================

/**
 * Aggiunge una chiave al provider selezionato nel form.
 * @param {Object} db - Struttura dati delle chiavi.
 * @param {Function} saveDb - Callback di persistenza e re-render.
 * @returns {Promise<void>}
 */
const _handleAddKey = async function(db, saveDb) {
    const provider = document.getElementById("key-sel-provider").value;
    const name = document.getElementById("key-inp-name").value;
    const key = document.getElementById("key-inp-key").value;
    if (!provider || !name || !key) {
        await alert("Provider, Nome e Key obbligatori.");
        return;
    }

    if (!db.providers[provider]) {
        db.providers[provider] = { exported_key: null, keys: [] };
    }
    const providerData = db.providers[provider];
    if (providerData.keys.some(k => k.name === name)) {
        await alert(`Esiste già una chiave con nome '${name}' per ${provider}.`);
        return;
    }

    providerData.keys.push({ name, key });
    if (!providerData.exported_key) {
        providerData.exported_key = name;
        const { LlmProvider } = await import("../llm_provider.js");
        await LlmProvider.updateClient(provider);
    }

    await saveDb();
};

/**
 * Attiva una chiave esistente per un provider.
 * @param {string} provider - Nome del provider.
 * @param {string} keyName - Nome della chiave da attivare.
 * @param {Object} db - Struttura dati delle chiavi.
 * @param {Function} saveDb - Callback di persistenza e re-render.
 * @param {Function} render - Callback di re-render.
 * @returns {Promise<void>}
 */
const _handleSetActiveKey = async function(provider, keyName, db, saveDb, render) {
    if (!await confirm(`Attivare la chiave '${keyName}' per ${provider}?`)) {
        await render();
        return;
    }
    db.providers[provider].exported_key = keyName;
    await saveDb();

    const { LlmProvider } = await import("../llm_provider.js");
    await LlmProvider.updateClient(provider);
};

/**
 * Elimina una chiave di un provider.
 * @param {string} provider - Nome del provider.
 * @param {string} keyName - Nome della chiave da eliminare.
 * @param {Object} db - Struttura dati delle chiavi.
 * @param {Function} saveDb - Callback di persistenza e re-render.
 * @returns {Promise<void>}
 */
const _handleDeleteKey = async function(provider, keyName, db, saveDb) {
    if (!await confirm(`Eliminare la chiave '${keyName}' di ${provider}?`)) return;
    const providerData = db.providers[provider];
    providerData.keys = providerData.keys.filter(k => k.name !== keyName);
    if (providerData.exported_key === keyName) {
        providerData.exported_key = null;
    }
    await saveDb();
    const { LlmProvider } = await import("../llm_provider.js");
    await LlmProvider.updateClient(provider);
};
