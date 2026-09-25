/**
 * models.js - Modelli di dati e validazione schemi.
 *
 * Definisce le strutture dati e le funzioni di validazione per messaggi,
 * payload e risposte, equivalente JS dei modelli Pydantic in models.py.
 *
 * @module  models
 * @version 1.0.0
 * @date    2026-06-27
 * @author  Gemini CLI
 */

"use strict";

const validateMessage = function(msg) {
  const result = { valid: false, error: null };

  if (!msg || typeof msg !== 'object') {
    result.error = 'Message must be an object';
    return result;
  }
  if (!msg.role || typeof msg.role !== 'string') {
    result.error = 'Message role is required and must be a string';
    return result;
  }
  if (msg.content !== undefined && msg.content !== null && typeof msg.content !== 'string' && !Array.isArray(msg.content)) {
    result.error = 'Message content must be a string or array';
    return result;
  }
  if (msg.tool_calls !== undefined && !Array.isArray(msg.tool_calls)) {
    result.error = 'Message tool_calls must be an array';
    return result;
  }

  result.valid = true;
  return result;
};

const validatePayload = function(payload) {
  const result = { valid: false, error: null };

  if (!payload || typeof payload !== 'object') {
    result.error = 'Payload must be an object';
    return result;
  }
  if (!payload.model || typeof payload.model !== 'string') {
    result.error = 'model is required and must be a string';
    return result;
  }
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    result.error = 'messages must be a non-empty array';
    return result;
  }

  for (const msg of payload.messages) {
    const check = validateMessage(msg);
    if (!check.valid) {
      return check;
    }
  }

  if (payload.temperature !== undefined && (typeof payload.temperature !== 'number' || payload.temperature < 0 || payload.temperature > 2)) {
    result.error = 'temperature must be a number between 0 and 2';
    return result;
  }
  if (payload.max_tokens !== undefined && (typeof payload.max_tokens !== 'number' || payload.max_tokens < 1)) {
    result.error = 'max_tokens must be a positive number';
    return result;
  }

  result.valid = true;
  return result;
};

const createMessage = function(role, content = null, options = {}) {
  const message = { role };

  if (content !== null) {
    message.content = content;
  }
  if (options.name) {
    message.name = options.name;
  }
  if (options.tool_calls) {
    message.tool_calls = options.tool_calls;
  }
  if (options.tool_call_id) {
    message.tool_call_id = options.tool_call_id;
  }

  const result = message;
  return result;
};

const createLlmPayload = function(model, messages, options = {}) {
  const payload = {
    model,
    messages,
  };

  if (options.temperature !== undefined) payload.temperature = options.temperature;
  if (options.max_tokens !== undefined) payload.max_tokens = options.max_tokens;
  if (options.top_p !== undefined) payload.top_p = options.top_p;
  if (options.stream !== undefined) payload.stream = options.stream;
  if (options.stop !== undefined) payload.stop = options.stop;
  if (options.tools !== undefined) payload.tools = options.tools;
  if (options.tool_choice !== undefined) payload.tool_choice = options.tool_choice;
  if (options.frequency_penalty !== undefined) payload.frequency_penalty = options.frequency_penalty;
  if (options.presence_penalty !== undefined) payload.presence_penalty = options.presence_penalty;
  if (options.response_format !== undefined) payload.response_format = options.response_format;
  if (options.seed !== undefined) payload.seed = options.seed;

  const result = payload;
  return result;
};

/**
 * Converte un contenuto messaggio in testo semplice.
 * Le risposte con tool_calls arrivano dai client come oggetti: usarle così
 * com'è produce "[object Object]" nei payload (i provider rigidi rispondono
 * 400) e rompe le utility che si aspettano stringhe. Se l'oggetto ha un
 * content testuale lo usa, altrimenti lo serializza in JSON.
 * @param {*} content - Contenuto messaggio (stringa o oggetto).
 * @returns {string} Contenuto testuale sicuro.
 */
const toTextContent = function(content) {
  if (typeof content === "string") {
    return content;
  }
  if (content && typeof content.content === "string" && content.content !== "") {
    const innerText = content.content;
    return innerText;
  }
  let text = "";
  try {
    const serialized = JSON.stringify(content === undefined ? null : content);
    text = serialized;
  } catch (e) {
    console.error("toTextContent: contenuto non serializzabile", e);
    text = "[contenuto non testuale omesso]";
  }
  return text;
};

export { validateMessage, validatePayload, createMessage, createLlmPayload, toTextContent };
