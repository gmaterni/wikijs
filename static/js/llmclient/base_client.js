/**
 * base_client.js - Classe base per i client delle API LLM.
 *
 * Fornisce le funzionalità comuni per la gestione delle richieste HTTP,
 * la gestione degli errori e il formato standard dei risultati.
 * Ogni client specifico estende questa classe e implementa sendRequest().
 *
 * @module  BaseClient
 * @version 1.0.0
 * @date    2026-06-27
 * @author  Gemini CLI
 */

"use strict";

class BaseClient {
  /**
   * Inizializza il client base.
   *
   * @param {string} apiKey - Chiave API per l'autenticazione.
   * @param {string} baseUrl - URL base dell'endpoint API.
   */
  constructor(apiKey, baseUrl) {
    if (!apiKey) {
      console.error("BaseClient: apiKey mancante");
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.abortController = null;
    this.isCancelled = false;
  }

  /**
   * Annulla la richiesta attualmente in corso.
   *
   * @returns {boolean} True se una richiesta è stata effettivamente interrotta.
   */
  cancelRequest() {
    this.isCancelled = true;
    let success = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      success = true;
    }

    return success;
  }

  /**
   * Crea un oggetto risultato standard.
   *
   * @param {boolean} ok - Successo della richiesta.
   * @param {Object} [response=null] - Risposta grezza.
   * @param {string} [data=null] - Dati estratti.
   * @param {Object} [error=null] - Oggetto errore.
   * @returns {Object} Oggetto risultato.
   * @protected
   */
  _createResult(ok, response = null, data = null, error = null) {
    const result = {
      ok,
      response,
      data,
      error,
    };

    return result;
  }

  /**
   * Crea un oggetto errore standardizzato.
   *
   * @param {string} message - Messaggio d'errore.
   * @param {string} type - Tipo di errore.
   * @param {number|string} code - Codice errore.
   * @param {Object} [details] - Dettagli aggiuntivi.
   * @returns {Object} Oggetto errore.
   * @protected
   */
  _createError(message, type, code, details) {
    const errDetails = {
      message: details?.message || null,
      type: details?.type || null,
      param: details?.param || null,
      code: details?.code || null,
    };

    const error = {
      message: message || null,
      type: type || null,
      code: code || null,
      details: errDetails,
    };

    return error;
  }

  /**
   * Gestisce gli errori HTTP provenienti dalle API.
   *
   * @param {Response} response - Oggetto risposta della fetch.
   * @returns {Promise<Object>} Oggetto errore formattato.
   * @protected
   */
  async _handleHttpError(response) {
    const errorMessages = {
      400: "Richiesta non valida",
      401: "Non autorizzato - Controlla la API key",
      403: "Accesso negato",
      404: "Endpoint non trovato",
      429: "Troppe richieste - Rate limit superato",
      500: "Errore interno del server",
      503: "Servizio non disponibile",
    };

    const className = this.constructor.name;
    let detailsContent = null;
    let errorType = "HTTPError";
    const status = response.status;
    let message = errorMessages[status] || `Errore HTTP ${status}`;

    try {
      const contentType = response.headers.get("Content-Type");

      if (contentType && contentType.includes("application/json")) {
        detailsContent = await response.json();

        if (status === 400 && detailsContent) {
          const errorData = detailsContent.error || detailsContent;
          const errorMsg = typeof errorData === "string" ? errorData : errorData.message;

          if (errorMsg) {
            const isTokenLimit =
              errorMsg.includes("token limit") ||
              errorMsg.includes("token exceeded") ||
              errorMsg.includes("input too long") ||
              errorMsg.includes("context length") ||
              errorMsg.includes("max tokens");

            if (isTokenLimit) {
              message = "Input troppo lungo - Superato il limite di token";
              errorType = "TokenLimitError";
            }
          }
        }
      } else {
        const textContent = await response.text();

        if (
          status === 400 &&
          (textContent.includes("token limit") ||
            textContent.includes("input too long") ||
            textContent.includes("context length"))
        ) {
          message = "Input troppo lungo - Superato il limite di token";
          errorType = "TokenLimitError";
        }

        detailsContent = { message: textContent };
      }
    } catch (e) {
      console.error(`${className}._handleHttpError:`, e);
      detailsContent = { message: "Impossibile estrarre i dettagli dell'errore" };
    }

    const errorObj = this._createError(message, errorType, status, detailsContent);

    const result = errorObj;
    return result;
  }

  /**
   * Gestisce gli errori di rete o i timeout.
   *
   * @param {Error} error - L'oggetto errore catturato.
   * @returns {Object} Oggetto errore formattato.
   * @protected
   */
  _handleNetworkError(error) {
    let errorObj = null;

    if (error.name === "AbortError") {
      if (this.isCancelled) {
        errorObj = this._createError(
          "Richiesta interrotta dall'utente",
          "CancellationError",
          499,
          { message: "La richiesta è stata interrotta volontariamente dall'utente" }
        );

        return errorObj;
      }

      errorObj = this._createError(
        "Richiesta interrotta per timeout",
        "TimeoutError",
        408,
        { message: "La richiesta è stata interrotta a causa di un timeout", isTimeout: true }
      );
    } else if (error.name === "TypeError" && error.message.includes("Failed to fetch")) {
      errorObj = this._createError(
        "Errore di rete",
        "NetworkError",
        0,
        { message: "Impossibile raggiungere il server. Controlla la connessione." }
      );
    } else {
      const errName = error.name || "UnknownError";
      const errMsg = error.message || "Si è verificato un errore sconosciuto";

      errorObj = this._createError("Errore imprevisto", errName, 500, { message: errMsg });
    }

    const result = errorObj;
    return result;
  }

  /**
   * Esegue la chiamata fetch effettiva con gestione del timeout.
   *
   * @param {string} url - URL dell'endpoint API.
   * @param {Object} payload - Corpo della richiesta.
   * @param {Object} headers - Header HTTP.
   * @param {number} [timeout=60] - Timeout in secondi.
   * @returns {Promise<Object>} Risultato della fetch.
   * @protected
   */
  async _fetch(url, payload, headers, timeout = 60) {
    this.isCancelled = false;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const timeoutMs = timeout * 1000;
    const timeoutId = setTimeout(() => {
      if (this.abortController) {
        this.abortController.abort();
      }
    }, timeoutMs);

    let result = null;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload),
        signal: signal,
      });

      clearTimeout(timeoutId);

      if (this.isCancelled) {
        const cancelErr = this._createError(
          "Richiesta interrotta dall'utente",
          "CancellationError",
          499,
          { message: "La richiesta è stata interrotta volontariamente dall'utente" }
        );
        result = this._createResult(false, null, null, cancelErr);
      } else if (!response.ok) {
        const httpErr = await this._handleHttpError(response);
        result = this._createResult(false, null, null, httpErr);
      } else {
        const respJson = await response.json();
        result = this._createResult(true, respJson);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      const networkErr = this._handleNetworkError(error);
      result = this._createResult(false, null, null, networkErr);
    } finally {
      this.abortController = null;
    }

    return result;
  }
}

export { BaseClient };
