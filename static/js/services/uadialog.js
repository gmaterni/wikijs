/**
 * uadialog.js - Gestore dialoghi modali (alert/confirm/prompt).
 *
 * Sostituisce i dialoghi nativi con dialoghi HTML accessibili.
 *
 * @module  services/uadialog
 * @version 1.0.0
 * @date    2026-09-15
 */
"use strict";

import { UaJtfh } from "./uajtfh.js";

const DialogManager = {
  /**
   * Sanifica il testo per inserimento sicuro in HTML.
   * @param {string} unsafe - Testo da sanificare.
   * @returns {string} Testo con entita HTML escapate.
   */
  escapeHtml: function(unsafe) {
    const step1 = unsafe.replace(/&/g, "&amp;");
    const step2 = step1.replace(/</g, "&lt;");
    const step3 = step2.replace(/>/g, "&gt;");
    const step4 = step3.replace(/"/g, "&quot;");
    const safe = step4.replace(/'/g, "&#039;");
    return safe;
  },

  /**
   * Crea gli elementi DOM del dialogo.
   * @param {string} type - Tipo dialogo ("alert", "confirm", "prompt").
   * @param {string} message - Messaggio da mostrare.
   * @param {string} defaultValue - Valore iniziale per il prompt.
   * @returns {Object} Oggetto {dialog, overlay}.
   */
  createDialog: function(type, message, defaultValue = "") {
    const dialog = document.createElement("div");
    const overlay = document.createElement("div");

    const dialogClass = `${type}-dialog`;
    dialog.className = dialogClass;
    dialog.classList.add("inv");
    overlay.className = "overlay";

    // Aggiunge un campo di input per il dialogo di tipo "prompt"
    const isPrompt = type === "prompt";
    const escapedDefault = this.escapeHtml(defaultValue);
    const promptInput = `<input type="text" class="prompt-input" value="${escapedDefault}">`;
    const escapedMessage = this.escapeHtml(message);

    const dialogRole = type === "alert" ? "alertdialog" : "dialog";
    const isConfirmOrPrompt = type === "confirm" || type === "prompt";
    const cancelButton = '<button class="cancel" aria-label="Annulla">Annulla</button>';

    // Costruzione markup con builder ordinato
    const jfh = UaJtfh();
    const opener = `<div role="${dialogRole}" aria-labelledby="dialog-title" aria-describedby="dialog-message">`;
    jfh.append(opener);
    const title = `<h4 id="dialog-title">${escapedMessage}</h4>`;
    jfh.append(title);
    if (isPrompt) {
      jfh.append(promptInput);
    }
    jfh.append('<div class="buttons">');
    jfh.append('<button class="ok" aria-label="OK">OK</button>');
    if (isConfirmOrPrompt) {
      jfh.append(cancelButton);
    }
    jfh.append('</div>');
    jfh.append('</div>');

    // Riversa il markup costruito nel dialogo
    const dialogHtml = jfh.html();
    dialog.innerHTML = dialogHtml;

    // Aggiunge attributi ARIA per l'accessibilità
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    [dialog, overlay].forEach((el) => {
      el.classList.add("show");
      document.body.appendChild(el);
    });

    const result = { dialog, overlay };
    return result;
  },

  /**
   * Chiude e rimuove gli elementi del dialogo.
   * @param {Element} dialog - Elemento dialogo.
   * @param {Element} overlay - Elemento overlay.
   */
  closeDialog: function(dialog, overlay) {
    [dialog, overlay].forEach((el) => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 300);
    });
  },

  /**
   * Mostra il dialogo e risolve con la scelta dell'utente.
   * @param {string} type - Tipo dialogo ("alert", "confirm", "prompt").
   * @param {string} message - Messaggio da mostrare.
   * @param {string} defaultValue - Valore iniziale per il prompt.
   * @returns {Promise<*>} Risultato scelto dall'utente.
   */
  showDialog: function(type, message, defaultValue) {
    const promise = new Promise((resolve) => {
      // Chiudi eventuali dialoghi aperti
      const existingOverlay = document.querySelector('.overlay.show');
      if (existingOverlay) {
        const existingDialog = document.querySelector('[class*="-dialog"].show');
        if (existingDialog) {
          this.closeDialog(existingDialog, existingOverlay);
        }
      }

      const created = this.createDialog(type, message, defaultValue);
      const dialog = created.dialog;
      const overlay = created.overlay;
      const okBtn = dialog.querySelector(".ok");
      const cancelBtn = dialog.querySelector(".cancel");

      // Funzione per gestire la chiusura con ESC o click fuori
      const handleClose = function(result) {
        DialogManager.closeDialog(dialog, overlay);
        resolve(result);
        // Rimuovi gli event listener
        document.removeEventListener("keydown", handleKeyDown);
        overlay.removeEventListener("click", handleOverlayClick);
      };

      // Gestione del tasto ESC
      const handleKeyDown = function(e) {
        if (e.key === "Escape") {
          const dismissed = type === "confirm" ? false : null;
          handleClose(dismissed);
        }
      };

      // Gestione del click sull'overlay
      const handleOverlayClick = function() {
        const dismissed = type === "confirm" ? false : null;
        handleClose(dismissed);
      };

      document.addEventListener("keydown", handleKeyDown);
      overlay.addEventListener("click", handleOverlayClick);

      if (type === "prompt") {
        const input = dialog.querySelector(".prompt-input");
        input.focus();
        input.select();

        okBtn.onclick = () => {
          handleClose(input.value);
        };

        cancelBtn.onclick = () => {
          handleClose(null);
        };

        // Permette di inviare con il tasto Invio
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            okBtn.click();
          }
        });
      } else if (type === "confirm") {
        okBtn.onclick = () => {
          handleClose(true);
        };

        cancelBtn.onclick = () => {
          handleClose(false);
        };
      } else {
        // 'alert'
        okBtn.onclick = () => {
          handleClose(undefined);
        };
        // Per gli alert, il click fuori chiude il dialogo senza risultato
        const handleOverlayClickAlert = function() {
          handleClose(undefined);
        };
        overlay.onclick = handleOverlayClickAlert;
      }
    });

    return promise;
  },
};

// Sovrascriviamo alert
window.alert = async function (message) {
  if (message instanceof Error) {
    message = message.message;
  }
  const result = DialogManager.showDialog("alert", message);
  return result;
};

// Sovrascriviamo confirm
window.confirm = async function (message) {
  const result = DialogManager.showDialog("confirm", message);
  return result;
};

// Sovrascriviamo prompt
window.prompt = async function (message, defaultValue = "") {
  const result = DialogManager.showDialog("prompt", message, defaultValue);
  return result;
};
