/**
 * registry.js - Registro unico dei provider LLM supportati.
 *
 * Single source of truth: associa ogni nome provider alla sua classe client.
 * Chi aggiunge un provider tocca solo questo file (una voce) più il file
 * del client; nessuno switch o whitelist separata da aggiornare a mano.
 * Non importa llm_provider.js né index.js: solo i client foglia, quindi
 * non introduce cicli di importazione.
 *
 * @module  llmclient/registry
 * @version 1.0.0
 * @date    2026-09-21
 */

"use strict";

import { GeminiClient } from "./gemini_client.js";
import { MistralClient } from "./mistral_client.js";
import { GroqClient } from "./groq_client.js";
import { OpenRouterClient } from "./openrouter_client.js";
import { HuggingFaceClient } from "./huggingface_client.js";

/**
 * Mappa nome provider → classe client. L'ordine di inserimento definisce
 * l'ordine dei provider (usato anche per il default: primo disponibile).
 * @type {Map<string, Function>}
 */
const PROVIDER_REGISTRY = new Map([
    ["gemini", GeminiClient],
    ["mistral", MistralClient],
    ["groq", GroqClient],
    ["openrouter", OpenRouterClient],
    ["huggingface", HuggingFaceClient]
]);

/**
 * Verifica se un provider è supportato dal registry.
 * @param {string} providerName - Nome del provider (es. 'groq').
 * @returns {boolean} True se esiste una classe client registrata.
 */
const isSupported = function(providerName) {
    const supported = PROVIDER_REGISTRY.has(providerName);
    return supported;
};

/**
 * Restituisce i nomi dei provider supportati nell'ordine del registry.
 * @returns {Array<string>} Copia dell'elenco (modifiche senza effetti interni).
 */
const getProviderNames = function() {
    const names = Array.from(PROVIDER_REGISTRY.keys());
    return names;
};

/**
 * Crea un'istanza client per il provider specificato.
 * @param {string} providerName - Nome del provider.
 * @param {string} apiKey - Chiave API per l'autenticazione.
 * @returns {Object|null} Istanza client, o null se provider sconosciuto.
 */
const createClient = function(providerName, apiKey) {
    if (!providerName || !PROVIDER_REGISTRY.has(providerName)) {
        console.error(`createClient: provider non supportato: ${providerName}`);
        const missing = null;
        return missing;
    }

    const ClientClass = PROVIDER_REGISTRY.get(providerName);
    const client = new ClientClass(apiKey);
    return client;
};

export { PROVIDER_REGISTRY, isSupported, getProviderNames, createClient };
