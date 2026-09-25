/**
 * fetcher.js - Modulo generico per la scoperta e normalizzazione dei modelli LLM.
 *
 * Classe base dei fetcher per provider: filtra i modelli per capacità e
 * deduplica per nome base mantenendo la versione più recente.
 *
 * @module  llmlist/fetcher
 * @version 1.0.0
 * @date    2026-09-21
 */

"use strict";

export class ModelFetcher {
    /**
     * @param {string} provider - Nome del provider
     * @param {Object} config - Configurazione per il fetch
     */
    constructor(provider, config = {}) {
        this.provider = provider;
        this.config = config;
    }

    /**
     * Filtra e ordina i modelli basandosi sulla logica comune:
     * 1. Filtro per capacità (opzionale)
     * 2. Selezione del modello più recente in base al nome
     */
    filterAndSortModels(models, filterFn) {
        let filtered = models;
        if (filterFn) {
            filtered = models.filter(filterFn);
        }

        const latestModels = new Map();

        for (const m of filtered) {
            const parsed = this.parseModelName(m.id || m.name, m);
            const baseName = parsed.baseName;
            const version = parsed.version;

            if (!latestModels.has(baseName) || version > latestModels.get(baseName).version) {
                latestModels.set(baseName, { version, model: m });
            }
        }

        const mappedModels = Array.from(latestModels.values()).map(item => item.model);
        return mappedModels;
    }

    /**
     * Parso il nome del modello per estrarre base name e versione.
     * Logica comune: separazione tramite '-' o ':'. Se il modello fornisce
     * un hint di versione preimpostato (es. "latest" per Mistral), viene usato.
     * @param {string} modelId
     * @param {Object} [model]
     * @returns {{baseName: string, version: string}}
     */
    parseModelName(modelId, model) {
        const name = String(modelId || "").replace(`${this.provider}/`, "");
        const parts = name.split(/[-:]/);
        
        let version = "000";
        let baseName = name;

        if (parts.length > 1) {
            const lastPart = parts[parts.length - 1];
            if (/^\d+$/.test(lastPart)) {
                version = lastPart;
                baseName = parts.slice(0, -1).join("-");
            }
        }

        if (model && model.version != null && model.version !== "000") {
            version = model.version;
        }

        const parsed = { baseName, version };
        return parsed;
    }
}
