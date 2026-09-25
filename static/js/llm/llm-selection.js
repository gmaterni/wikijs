/**
 * llm-selection.js - Finestra modale "Seleziona LLM" stile window-info.
 *
 * Mostra esclusivamente i discovered validi (già filtrati vote>=MIN_VOTE
 * in salvataggio) con spunta su selectedIds: solo i modelli scaricati
 * e testati con "Aggiorna LLM".
 * Aggiorna subito l'albero LLM dopo Salva/Aggiungi.
 *
 * @module llm/llm-selection
 * @version 1.0.0
 * @date    2026-09-21
 */

"use strict";

import { UaWindowAdm } from "../services/uawindow.js";
import { UaJtfh } from "../services/uajtfh.js";
import { UaLog } from "../services/ualog3.js";
import { LlmProvider } from "../llm_provider.js";

import { updateActiveModelDisplay, refreshProviderTree } from "../app_ui.js";

// ============================================================================
// COSTANTI
// ============================================================================

/** Livello z-index della finestra di selezione LLM. */
const WINDOW_Z_INDEX = 12;

/** Classe del body quando il menu laterale è aperto. */
const CSS_MENU_OPEN = "menu-open";

/** Posizione orizzontale in vw a menu aperto (come factory info di agnochat). */
const WINDOW_X_MENU_OPEN = 22;

/** Posizione orizzontale in vw a menu chiuso (come factory info di agnochat). */
const WINDOW_X_DEFAULT = 2;

/** Posizione verticale della finestra in vw. */
const WINDOW_Y_VW = 6;

/** Altezza minima della finestra di selezione (px). */
const MIN_WINDOW_HEIGHT_PX = 120;

/** Colonne fisse della tabella LLM (larghezze percentuali). */
const HEADER_COLS = '<col style="width: 68%;"><col style="width: 8%;"><col style="width: 12%;"><col style="width: 10%;">';

/**
 * Crea la finestra di selezione LLM stile window-info.
 * @param {Object} db - Istanza del database LLM (llmDb)
 * @param {Object} [options] - Opzioni di apertura.
 * @param {boolean} [options.startUnselected=false] - Se true, apre la finestra
 *   con tutti i modelli deselezionati, senza modificare la selezione salvata.
 * @returns {Object} API: { show() }
 */
export const createLlmSelectionWindow = function(db, options) {
    let _windowId = "llm-selection-window";
    const startUnselected = !!(options && options.startUnselected);

    /**
     * Mostra la finestra modale con tabella LLM compatta.
     */
    const show = async function() {
        const state = await _loadStateAsync();
        const selectedIds = startUnselected ? new Set() : _buildSelectedIds(state.selected);
        const discoveredMap = _buildDiscoveredMap(state.discovered);
        const providers = _collectProviders(state.discovered);

        // Diagnostica: logga stato per capire differenza menu vs Aggiorna LLM
        console.log("llm-selection.show:", {
            startUnselected,
            discovered: state.discovered.length,
            selected: state.selected.length,
            providers: providers.length,
            selectedIds: Array.from(selectedIds).slice(0,5)
        });
        try { UaLog.log("Seleziona LLM: discovered=" + state.discovered.length + " selected=" + state.selected.length + " providers=" + providers.length + " startUnselected=" + startUnselected); } catch(e){}
        try { console.log("UaLog Seleziona LLM:", "discovered=" + state.discovered.length + " selected=" + state.selected.length); } catch(e){}

        const jfh = UaJtfh();
        jfh.append('<div class="window-info">');
        _appendHeader(jfh);
        jfh.append('<div class="div-info llm-select-content">');
        _appendTable(jfh, providers, state.discovered, selectedIds);
        jfh.append("</div>"); // .div-info
        jfh.append("</div>"); // .window-info

        // Crea finestra stile window-info (simile a Gestione API Key).
        // Allineamento come in agnochat: segue lo stato del menu laterale.
        const win = UaWindowAdm.create(_windowId);
        win.drag().setZ(WINDOW_Z_INDEX);
        win.setHtml(jfh.html());
        const isMenuOpen = document.body.classList.contains(CSS_MENU_OPEN);
        const xPos = isMenuOpen ? WINDOW_X_MENU_OPEN : WINDOW_X_DEFAULT;
        win.vw_vh().setXY(xPos, WINDOW_Y_VW, -1);
        win.show();

        const winEl = win.getElement();
        if (winEl) {
            _sizeWindow(winEl);
            _bindCheckboxEvents(winEl);
            _bindActionButtons(winEl, discoveredMap, selectedIds);
            // Nessun auto-restore: se nessun valido è spuntato ma ci sono
            // eletti, resta solo il log (la finestra mostra solo i validi).
            if (selectedIds.size > 0) {
                const anyChecked = winEl.querySelector(".llm-model-check:checked");
                const totalChecks = winEl.querySelectorAll(".llm-model-check").length;
                console.log("llm-selection post-render:", { totalChecks, anyChecked: !!anyChecked, selectedIdsSize: selectedIds.size });
                if (!anyChecked && totalChecks > 0) {
                    try { UaLog.log("Seleziona LLM: " + selectedIds.size + " eletti, 0 spuntati tra i validi"); } catch(e){}
                }
            }
        }
    };

    /**
     * Legge lo stato corrente (modelli scoperti, config provider, selezione).
     * @returns {Promise<{discovered: Array, providerConfig: Object, selected: Array}>}
     */
    const _loadStateAsync = async function() {
        let discovered = [];
        let providerConfig = {};
        let selected = [];

        try {
            discovered = await db.getDiscovered();
            providerConfig = LlmProvider.getProviderConfig ? LlmProvider.getProviderConfig() : {};
            selected = await db.getSelected();
        } catch (error) {
            console.error("createLlmSelectionWindow.show:", error);
            UaLog.log("ERRORE: Impossibile leggere i modelli scoperti.");
        }

        const state = { discovered, providerConfig, selected };
        return state;
    };

    /**
     * Costruisce il set degli id dei modelli già selezionati.
     * @param {Array<Object>} selected - Modelli selezionati.
     * @returns {Set<string>}
     */
    const _buildSelectedIds = function(selected) {
        const selectedIds = new Set();
        for (const m of selected) {
            const id = m.provider + ":" + m.model;
            selectedIds.add(id);
        }
        return selectedIds;
    };

    /**
     * Mappa modelli scoperti per id (provider:model), per arricchire il salvataggio.
     * @param {Array<Object>} discovered - Modelli scoperti.
     * @returns {Object<string, Object>}
     */
    const _buildDiscoveredMap = function(discovered) {
        const discoveredMap = {};
        for (const m of discovered) {
            const id = m.provider + ":" + m.model;
            discoveredMap[id] = m;
        }
        return discoveredMap;
    };

    /**
     * Raccoglie i provider da mostrare (solo discovered validi).
     * @param {Array<Object>} discovered - Modelli scoperti (già validi).
     * @returns {Array<string>}
     */
    const _collectProviders = function(discovered) {
        const providerSet = new Set();
        for (const m of discovered) {
            providerSet.add(m.provider);
        }
        const providers = Array.from(providerSet);
        return providers;
    };

    /**
     * Aggiunge l'header con i pulsanti di azione.
     * @param {Object} jfh - Istanza UaJtfh della finestra.
     */
    const _appendHeader = function(jfh) {
        const ttSave = "Salva|Sostituisce i salvati con gli spuntati";
        const ttAdd = "Aggiungi|Unisce gli spuntati ai salvati";
        const ttCancel = "Annulla|Deseleziona tutto";
        const ttRestore = "Seleziona Attivi|Ripristina solo gli attivi";
        jfh.append('<div class="btn-wrapper llm-btn-wrapper">');
        jfh.append('<span class="llm-header-btns">');
        jfh.append("<button class=\"btn-success\" data-help=\"" + ttSave + "\" data-action=\"llm-save\">Salva</button>");
        jfh.append("<button class=\"btn-yellow\" data-help=\"" + ttAdd + "\" data-action=\"llm-add\">Aggiungi</button>");
        jfh.append("<button class=\"btn-danger\" data-help=\"" + ttCancel + "\" data-action=\"llm-reset\">Annulla</button>");
        jfh.append("<button class=\"btn-info\" data-help=\"" + ttRestore + "\" data-action=\"llm-restore\">Seleziona Attivi</button>");
        jfh.append('</span>');
        jfh.append('<button class="btn-close" data-help="Chiudi" data-action="llm-close">X</button>');
        jfh.append('</div>');
    };

    /**
     * Raccoglie i modelli discovered validi (già filtrati vote>=MIN_VOTE
     * in salvataggio: nessun filtro-display qui), dedup per provider:model.
     * @param {Array<string>} providers - Provider da considerare.
     * @param {Array<Object>} discovered - Modelli scoperti.
     * @returns {Array<Object>} Modelli validi normalizzati.
     */
    const _collectValidModels = function(providers, discovered) {
        const allModels = [];
        const seen = new Set();
        for (const providerName of providers) {
            const models = discovered.filter(m => m.provider === providerName);
            for (const m of models) {
                const id = m.provider + ":" + m.model;
                if (seen.has(id)) continue;
                seen.add(id);
                allModels.push({
                    provider: providerName,
                    model: m.model,
                    name: m.name,
                    windowSize: m.windowSize,
                    elapsedMs: m.elapsedMs,
                    vote: m.vote
                });
            }
        }
        return allModels;
    };

    /**
     * Raggruppa i modelli per provider.
     * @param {Array<Object>} allModels - Modelli ordinati.
     * @returns {Object<string, Array<Object>>}
     */
    const _groupByProvider = function(allModels) {
        const byProvider = {};
        for (const m of allModels) {
            if (!byProvider[m.provider]) byProvider[m.provider] = [];
            byProvider[m.provider].push(m);
        }
        return byProvider;
    };

     /**
      * Aggiunge la tabella dei modelli (header fisso + corpo scrollabile).
      * Mostra solo i discovered validi: la finestra non elenca altro.
      * @param {Object} jfh - Istanza UaJtfh della finestra.
      * @param {Array<string>} providers - Provider disponibili (da discovered).
      * @param {Array<Object>} discovered - Modelli scoperti (già validi).
      * @param {Set<string>} selectedIds - Id dei modelli già selezionati.
      */
    const _appendTable = function(jfh, providers, discovered, selectedIds) {
        const allModels = _collectValidModels(providers, discovered);

        if (providers.length === 0) {
            jfh.append("<p>Nessun modello disponibile. Esegui prima \"Aggiorna LLM\".</p>");
            return;
        }

        if (allModels.length === 0) {
            jfh.append("<p>Nessun modello scoperto.</p>");
            return;
        }

        // Ordina: prima per provider, poi per nome modello
        allModels.sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));

        const byProvider = _groupByProvider(allModels);

        if (allModels.length > 0) {
            jfh.append('<div class="llm-scroll-wrap">');
            jfh.append('<table class="table-data llm-select-table llm-select-head">');
            jfh.append(HEADER_COLS);
            jfh.append('<thead><tr>');
            jfh.append('<th data-help="LLM">LLM</th>');
            jfh.append('<th data-help="V|Voto (6-10): punteggio qualità basato su velocità e completezza risposta">V</th>');
            jfh.append('<th data-help="T|Tempo di risposta in secondi">T</th>');
            jfh.append('<th data-help="W|Dimensione finestra di contesto in migliaia di token (k)">W</th>');
            jfh.append('</tr></thead>');
            jfh.append('</table>');

            jfh.append('<div class="llm-scroll-body">');
            jfh.append('<table class="table-data llm-select-table">');
            jfh.append(HEADER_COLS);
            jfh.append('<tbody>');

            for (const providerName of Object.keys(byProvider).sort()) {
                _appendProviderRow(jfh, providerName, byProvider[providerName], selectedIds);
            }

            jfh.append('</tbody></table>');
            jfh.append('</div>'); // .llm-scroll-body
            jfh.append('</div>'); // .llm-scroll-wrap
        } else {
            jfh.append("<p>Nessun modello scoperto tra i validi.</p>");
        }
    };

    /**
     * Aggiunge la riga di un provider (flag di selezione su tutti i modelli).
     * @param {Object} jfh - Istanza UaJtfh della finestra.
     * @param {string} providerName - Nome del provider.
     * @param {Array<Object>} models - Modelli del provider.
     * @param {Set<string>} selectedIds - Id dei modelli già selezionati.
     */
    const _appendProviderRow = function(jfh, providerName, models, selectedIds) {
        jfh.append('<tr class="llm-provider-row" data-provider="' + providerName + '">');
        jfh.append('<td colspan="4" class="llm-provider-cell">');
        jfh.append('  <label class="llm-provider-label">');
        jfh.append('    <input type="checkbox" class="llm-provider-check" data-provider="' + providerName + '">');
        jfh.append('    <b>' + providerName + '</b>');
        jfh.append('  </label>');
        jfh.append('</td>');
        jfh.append('</tr>');

        for (const m of models) {
            _appendModelRow(jfh, m, selectedIds);
        }
    };

    /**
     * Aggiunge la riga di un singolo modello.
     * @param {Object} jfh - Istanza UaJtfh della finestra.
     * @param {Object} m - Modello {provider, model, name, windowSize, elapsedMs, vote}.
     * @param {Set<string>} selectedIds - Id dei modelli già selezionati.
     */
    const _appendModelRow = function(jfh, m, selectedIds) {
        const label = m.name ? m.model + " (" + m.name + ")" : m.model;
        const windowSize = m.windowSize ? m.windowSize : "-";
        const elapsedMs = m.elapsedMs ? (m.elapsedMs / 1000).toFixed(1) + "s" : "-";
        const vote = (m.vote !== undefined && m.vote !== null) ? m.vote : "-";
        const providerModel = m.provider + ":" + m.model;
        const checkedAttr = selectedIds.has(providerModel) ? "checked" : "";
        const selectedClass = selectedIds.has(providerModel) ? " selected" : "";

        jfh.append('<tr class="llm-row' + selectedClass + '" data-provider-model="' + providerModel + '">');
        jfh.append('  <td class="llm-name-cell">');
        jfh.append('    <label class="llm-row-label">');
        jfh.append('      <input type="checkbox" class="llm-model-check" data-provider-model="' + providerModel + '" data-provider="' + m.provider + '" data-model="' + m.model + '" ' + checkedAttr + '>');
        jfh.append('      <span class="llm-name-text">' + label + '</span>');
        jfh.append('    </label>');
        jfh.append('  </td>');
        jfh.append('  <td class="llm-vote-cell">' + vote + '</td>');
        jfh.append('  <td class="llm-time-cell">' + elapsedMs + '</td>');
        jfh.append('  <td class="llm-window-cell">' + windowSize + '</td>');
        jfh.append('</tr>');
    };

    /**
     * Adatta l'altezza della finestra al contenuto, con limite massimo.
     * @param {HTMLElement} winEl - Elemento della finestra.
     */
    const _sizeWindow = function(winEl) {
        winEl.style.width = "62vw";
        winEl.style.maxWidth = "89vw";
        winEl.style.overflow = "hidden";

        // Calcola altezza massima = output + input (container) senza aggiunte.
        // La finestra parte sotto la barra menu: max = bottom container - top finestra.
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

        // Imposta l'altezza massima sul window e un'altezza effettiva
        // sul contenuto interno (.window-info) così il body scrolla.
        winEl.style.height = targetH + "px";
        winEl.style.maxHeight = targetH + "px";

        const inner = winEl.querySelector(".window-info");
        if (inner) {
            inner.style.height = targetH + "px";
            inner.style.maxHeight = targetH + "px";
        }

        // Adatta l'altezza al contenuto: se il corpo della tabella è più corto del
        // limite (pochi modelli), usa l'altezza naturale; se è più lungo,
        // usa il limite e il body scrolla.
        const bodyEl = winEl.querySelector(".llm-scroll-body");
        const headEl = winEl.querySelector(".llm-select-head");
        const btnsEl = winEl.querySelector(".llm-btn-wrapper");
        const bodyNaturalH = bodyEl ? bodyEl.scrollHeight : 0;
        const headH = headEl ? headEl.getBoundingClientRect().height : 0;
        const btnsH = btnsEl ? btnsEl.getBoundingClientRect().height : 0;
        const naturalH = btnsH + headH + bodyNaturalH + 2;
        const finalH = Math.min(naturalH, targetH);
        winEl.style.height = finalH + "px";
        if (inner) {
            inner.style.height = finalH + "px";
            inner.style.maxHeight = targetH + "px";
        }
    };

    /**
     * Associa gli eventi alle checkbox di modelli e provider.
     * @param {HTMLElement} winEl - Elemento della finestra.
     */
    const _bindCheckboxEvents = function(winEl) {
        // Gestione selezione riga con evidenziazione
        winEl.querySelectorAll(".llm-model-check").forEach(function(cb) {
            cb.addEventListener("change", function() {
                const row = cb.closest(".llm-row");
                if (row) {
                    row.classList.toggle("selected", cb.checked);
                }
                _syncProviderCheckbox(winEl, cb.dataset.provider);
            });
        });

        // Gestione flag provider: seleziona/deseleziona tutti i suoi modelli
        winEl.querySelectorAll(".llm-provider-check").forEach(function(cb) {
            cb.addEventListener("change", function() {
                const providerName = cb.dataset.provider;
                const modelCbs = winEl.querySelectorAll('.llm-model-check[data-provider="' + providerName + '"]');
                modelCbs.forEach(function(modelCb) {
                    modelCb.checked = cb.checked;
                    const row = modelCb.closest(".llm-row");
                    if (row) {
                        row.classList.toggle("selected", cb.checked);
                    }
                });
            });
        });

        // Sincronizza lo stato iniziale dei flag provider
        winEl.querySelectorAll(".llm-provider-check").forEach(function(cb) {
            _syncProviderCheckbox(winEl, cb.dataset.provider);
        });
    };

    /**
     * Raccoglie i modelli selezionati con dati completi da discoveredMap.
     * @param {Object<string, Object>} discoveredMap - Modelli scoperti per id.
     * @returns {Array<Object>}
     */
    const _collectSelected = function(discoveredMap) {
        const winEl = UaWindowAdm.get(_windowId).getElement();
        if (!winEl) {
            const emptyModels = [];
            return emptyModels;
        }

        const collected = [];
        winEl.querySelectorAll(".llm-model-check").forEach(function(cb) {
            if (cb.checked) {
                const providerModel = cb.dataset.provider + ":" + cb.dataset.model;
                const full = discoveredMap[providerModel] || {};
                collected.push({
                    provider: cb.dataset.provider,
                    model: cb.dataset.model,
                    name: full.name,
                    windowSize: full.windowSize,
                    elapsedMs: full.elapsedMs,
                    vote: full.vote
                });
            }
        });
        return collected;
    };

    /**
     * Salva la selezione corrente sostituendo quella salvata.
     * @param {Object<string, Object>} discoveredMap - Modelli scoperti per id.
     */
    const _saveSelectionAsync = async function(discoveredMap) {
        const selectedModels = _collectSelected(discoveredMap);
        const count = selectedModels.length;

        const proceed = await confirm("Salva: sostituire completamente la selezione corrente con i " + count + " modelli selezionati?");
        if (!proceed) return;

        try {
            await db.saveSelected(selectedModels);
            await _applySelection();
        } catch (error) {
            console.error("llmSelectionSave:", error);
            UaLog.log("ERRORE: Salvataggio selezione LLM fallito.");
            await alert("ERRORE: Salvataggio selezione LLM fallito.");
            return;
        }

        UaWindowAdm.get(_windowId).close();
        UaLog.log(">>> Selezione LLM salvata (sostituzione): " + count + " modelli. <<<");
        await alert("Salvataggio completato: " + count + " modelli selezionati.");
    };

    /**
     * Aggiunge i modelli selezionati a quelli già presenti nell'albero.
     * @param {Object<string, Object>} discoveredMap - Modelli scoperti per id.
     */
    const _addSelectionAsync = async function(discoveredMap) {
        const selectedModels = _collectSelected(discoveredMap);

        if (selectedModels.length === 0) {
            await alert("Nessun modello selezionato da aggiungere.");
            return;
        }

        const proceed = await confirm("Aggiungi: unire i " + selectedModels.length + " modelli selezionati a quelli già presenti nell'albero?");
        if (!proceed) return;

        try {
            await db.addSelected(selectedModels);
            await _applySelection();
        } catch (error) {
            console.error("llmSelectionAdd:", error);
            UaLog.log("ERRORE: Aggiunta modelli alla selezione fallita.");
            await alert("ERRORE: Aggiunta modelli alla selezione fallita.");
            return;
        }

        UaWindowAdm.get(_windowId).close();
        UaLog.log(">>> Modelli aggiunti alla selezione LLM: " + selectedModels.length + ". <<<");
        await alert("Aggiunta completata: " + selectedModels.length + " modelli aggiunti all'albero.");
    };

    /**
     * Deseleziona tutti i modelli e i provider.
     * @param {HTMLElement} winEl - Elemento della finestra.
     */
    const _resetSelection = function(winEl) {
        winEl.querySelectorAll(".llm-model-check").forEach(function(cb) {
            cb.checked = false;
            const row = cb.closest(".llm-row");
            if (row) row.classList.remove("selected");
        });
        winEl.querySelectorAll(".llm-provider-check").forEach(function(cb) {
            cb.checked = false;
            cb.indeterminate = false;
        });
    };

    /**
     * Ripristina la selezione agli LLM già attivi (selected-models).
     * Inverso di Annulla: seleziona solo quelli in selectedIds.
     * @param {HTMLElement} winEl - Elemento della finestra.
     * @param {Set<string>} selectedIds - Id "provider:model" già attivi.
     */
    const _restoreActiveSelection = function(winEl, selectedIds) {
        winEl.querySelectorAll(".llm-model-check").forEach(function(cb) {
            const id = cb.dataset.provider + ":" + cb.dataset.model;
            const shouldChecked = selectedIds.has(id);
            cb.checked = shouldChecked;
            const row = cb.closest(".llm-row");
            if (row) row.classList.toggle("selected", shouldChecked);
        });
        winEl.querySelectorAll(".llm-provider-check").forEach(function(cb) {
            _syncProviderCheckbox(winEl, cb.dataset.provider);
        });
    };

    /**
     * Chiude la finestra di selezione.
     */
    const _closeWindow = function() {
        UaWindowAdm.get(_windowId).close();
    };

    /**
     * Registra i listener sui pulsanti di azione (senza globali window).
     * @param {HTMLElement} winEl - Elemento della finestra.
     * @param {Object<string, Object>} discoveredMap - Modelli scoperti per id.
     * @param {Set<string>} selectedIds - Id dei modelli già attivi.
     */
    const _bindActionButtons = function(winEl, discoveredMap, selectedIds) {
        const btnSave = winEl.querySelector('[data-action="llm-save"]');
        const btnAdd = winEl.querySelector('[data-action="llm-add"]');
        const btnReset = winEl.querySelector('[data-action="llm-reset"]');
        const btnRestore = winEl.querySelector('[data-action="llm-restore"]');
        const btnClose = winEl.querySelector('[data-action="llm-close"]');

        if (btnSave) {
            btnSave.addEventListener("click", () => _saveSelectionAsync(discoveredMap));
        }

        if (btnAdd) {
            btnAdd.addEventListener("click", () => _addSelectionAsync(discoveredMap));
        }

        if (btnReset) {
            btnReset.addEventListener("click", () => _resetSelection(winEl));
        }

        if (btnRestore) {
            btnRestore.addEventListener("click", () => _restoreActiveSelection(winEl, selectedIds));
        }

        if (btnClose) {
            btnClose.addEventListener("click", _closeWindow);
        }
    };

    /**
     * Sincronizza il flag del provider in base ai suoi modelli.
     * @param {HTMLElement} container
     * @param {string} providerName
     */
    const _syncProviderCheckbox = function(container, providerName) {
        const providerCb = container.querySelector('.llm-provider-check[data-provider="' + providerName + '"]');
        if (!providerCb) return;

        const modelCbs = container.querySelectorAll('.llm-model-check[data-provider="' + providerName + '"]');
        let checkedCount = 0;
        modelCbs.forEach(function(cb) {
            if (cb.checked) checkedCount++;
        });

        providerCb.checked = modelCbs.length > 0 && checkedCount === modelCbs.length;
        providerCb.indeterminate = checkedCount > 0 && checkedCount < modelCbs.length;
    };

    /**
     * Ricarica il catalogo modelli, applica il filtro della selezione
     * corrente salvata in IndexedDB, aggiorna il display del modello attivo
     * e l'albero LLM se aperto.
     */
    const _applySelection = async function() {
        // NON ricaricare i .txt. Il catalogo in memoria è già popolato
        // (da discovery "Aggiorna LLM" o da default "Reset LLM").
        // Applica solo il filtro della selezione corrente.

        const selected = await db.getSelected();
        if (selected && selected.length > 0) {
            LlmProvider.ensureSelectedModels(selected);
            LlmProvider.applySelectionFilter(selected);
        }

        LlmProvider.validateActive();
        updateActiveModelDisplay();
        refreshProviderTree();
    };

    const api = { show };
    return api;
};