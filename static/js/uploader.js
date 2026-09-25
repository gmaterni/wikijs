/**
 * @fileoverview uploader.js - Upload documenti
 * @description Gestisce l'upload di documenti (TXT, PDF, DOCX).
 *              Modulo specifico dell'applicazione RagIndex.
 * @module uploader
 */
"use strict";

import { DocsMgr } from "./docs_mgr.js";
import { UaWindowAdm } from "./services/uawindow.js";
import { cleanDoc } from "./services/text_cleaner.js";

export const documentUploader = {
  dragoverHandler: null,
  dropHandler: null,
  uploadMode: "single",

  open() {
    const htmlContent = `
      <div class="window-text">
        <div class="btn-wrapper">
         <button class="btn-close" data-help="Chiudi">X</button>
        </div>
        <div class="upload-dialog-content">
          <p class="upload-description">Trascina uno o più file (testo, PDF, DOCX, ODT) o un'intera cartella per aggiungerli alla knowledge base.</p>
          
          <!-- Selector modalitÃ  upload -->
          <div class="upload-mode-selector">
            <label>
              <input type="radio" name="upload-mode" value="single" checked> <span>File singoli</span>
            </label>
            <label>
              <input type="radio" name="upload-mode" value="directory"> <span>Intera directory</span>
            </label>
          </div>
          
          <div id="drop-zone" class="drop-zone">
            <p id="drop-zone-text">Trascina i file qui o clicca per selezionare</p>
            <input type="file" id="id_fileupload" multiple>
          </div>
          
          <!-- Barra di progresso -->
          <div id="progress-container">
            <div>
              <div id="progress-bar"></div>
            </div>
            <p id="progress-text">0 / 0 file processati</p>
          </div>
          <div id="file-list-container"></div>        
        </div>
      </div>
    `;

    const uploadWindow = UaWindowAdm.create("wnd-upload");
    uploadWindow.drag();
    uploadWindow.setZ(12);
    uploadWindow.vw_vh().setXY(16.5, 5, -1);
    uploadWindow.setHtml(htmlContent);

    document.getElementById("wnd-upload").addEventListener("click", (e) => {
      if (e.target.classList.contains("btn-close")) {
        uploadWindow.close();
      }
    });

    uploadWindow.show();

    const dropZone = document.getElementById("drop-zone");
    const dropZoneText = document.getElementById("drop-zone-text");
    const fileInput = document.getElementById("id_fileupload");
    const fileListContainer = document.getElementById("file-list-container");
    const modeRadios = document.querySelectorAll('input[name="upload-mode"]');

    // Pulisce la lista dei file ogni volta che la finestra viene aperta
    fileListContainer.innerHTML = "";

    // Gestione cambio modalitÃ 
    modeRadios.forEach(radio => {
      radio.addEventListener("change", (e) => {
        this.uploadMode = e.target.value;
        if (this.uploadMode === "directory") {
          fileInput.setAttribute("webkitdirectory", "");
          fileInput.setAttribute("directory", "");
          dropZoneText.textContent = "Trascina una directory qui o clicca per selezionare";
        } else {
          fileInput.removeAttribute("webkitdirectory");
          fileInput.removeAttribute("directory");
          dropZoneText.textContent = "Trascina i file qui o clicca per selezionare";
        }
      });
    });

    dropZone.addEventListener("click", () => fileInput.click());

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("drag-over");
    });

    dropZone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("drag-over");
    });

    dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("drag-over");

      const items = e.dataTransfer.items;
      const files = [];

      // Gestisce sia file che directory tramite drag & drop
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i].webkitGetAsEntry();
          if (item) {
            await this.traverseFileTree(item, files);
          }
        }
      } else {
        // Fallback per browser che non supportano webkitGetAsEntry
        for (const file of e.dataTransfer.files) {
          files.push(file);
        }
      }

      if (files.length > 0) {
        await this.handleMultipleFiles(files);
      }
    });

    fileInput.addEventListener("change", async (e) => {
      if (e.target.files.length > 0) {
        const files = Array.from(e.target.files);
        await this.handleMultipleFiles(files);
      }
    });

    // Previene il comportamento di default del browser
    this.dragoverHandler = function(e) {
        const result = e.preventDefault();
        return result;
    };
    this.dropHandler = function(e) {
        const result = e.preventDefault();
        return result;
    };
    window.addEventListener("dragover", this.dragoverHandler);
    window.addEventListener("drop", this.dropHandler);
  },

  /**
   * Attraversa ricorsivamente l'albero di file/directory
   */
  async traverseFileTree(item, files) {
    if (item.isFile) {
      const promise = new Promise((resolve) => {
        item.file((file) => {
          files.push(file);
          resolve();
        });
      });

      return promise;
    } else if (item.isDirectory) {
      const dirReader = item.createReader();
      const promise = new Promise((resolve) => {
        dirReader.readEntries(async (entries) => {
          for (const entry of entries) {
            await this.traverseFileTree(entry, files);
          }
          resolve();
        });
      });

      return promise;
    }
  },

  /**
   * Gestisce l'upload di file multipli con feedback progressivo
   */
  async handleMultipleFiles(files) {
    // Filtra solo i file supportati
    const supportedExtensions = ["txt", "pdf", "docx", "odt"];
    const validFiles = files.filter(file => {
      const ext = file.name.split(".").pop().toLowerCase();
      return supportedExtensions.includes(ext);
    });

    if (validFiles.length === 0) {
      await alert("Nessun file valido trovato. Formati supportati: .txt, .pdf, .docx, .odt");
      return;
    }

    const unsupportedCount = files.length - validFiles.length;
    if (unsupportedCount > 0) {
      console.debug(`${unsupportedCount} file ignorati (formato non supportato)`);
    }

    // Mostra barra di progresso
    const progressContainer = document.getElementById("progress-container");
    const progressBar = document.getElementById("progress-bar");
    const progressText = document.getElementById("progress-text");

    progressContainer.style.display = "block";

    const stats = {
      total: validFiles.length,
      success: 0,
      duplicates: 0,
      errors: 0,
      errorFiles: []
    };

    // Processa i file in sequenza
    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      const percentage = Math.round(((i + 1) / stats.total) * 100);
      const fileNum = i + 1;
      const fileTotal = stats.total;
      const progressLabel = `${fileNum} / ${fileTotal} file processati`;
      progressText.textContent = progressLabel;
      progressBar.style.width = `${percentage}%`;
      progressBar.textContent = `${percentage}%`;

      const result = await this.handleFile(file, true);

      if (result.status === "success") {
        stats.success++;
      } else if (result.status === "duplicate") {
        stats.duplicates++;
      } else if (result.status === "error") {
        stats.errors++;
        stats.errorFiles.push({ name: file.name, error: result.error });
      }
    }

    // Nascondi la barra dopo 2 secondi se tutto ok
    if (stats.errors === 0) {
      setTimeout(() => {
        progressContainer.style.display = "none";
      }, 2000);
    }
  },

  close() {
    window.removeEventListener("dragover", this.dragoverHandler);
    window.removeEventListener("drop", this.dropHandler);
    UaWindowAdm.close("wnd-upload");
  },

  /**
   * Gestisce un singolo file
   * @param {File} file - Il file da processare
   * @param {boolean} silent - Se true, non mostra alert
   * @returns {Object} - Oggetto con status e eventuali dettagli
   */
  async handleFile(file, silent = false) {
    if (!file) {
      const errorResult = { status: "error", error: "Nessun file fornito" };
      return errorResult;
    }

    const fileName = file.name;
    const fileListContainer = document.getElementById("file-list-container");

    // Controlla duplicati ma NON blocca il processo
    if (await DocsMgr.exists(fileName)) {
      if (!silent) {
        await alert(`Il file "${fileName}"già in archivio. Verrà  ignorato.`);
      }

      // Aggiunge comunque un elemento visivo
      const fileItem = document.createElement("div");
      fileItem.className = "file-list-item duplicate";
      fileItem.textContent = `${fileName} - Duplicato (ignorato)`;
      fileListContainer.appendChild(fileItem);

      const duplicateResult = { status: "duplicate", fileName };
      return duplicateResult;
    }

    const fileExtension = file.name.split(".").pop().toLowerCase();

    let result = null;

    try {
      let text;

      if (fileExtension === "pdf") {
        const pdfHandler = new PdfHandler();
        await pdfHandler.loadPdfJs();
        text = await pdfHandler.extractTextFromPDF(file);
        pdfHandler.cleanup();
      } else if (fileExtension === "txt") {
        text = await FileReaderUtil.readTextFile(file);
      } else if (fileExtension === "docx") {
        const docxHandler = new DocxHandler();
        await docxHandler.loadMammoth();
        text = await docxHandler.extractTextFromDocx(file);
        docxHandler.cleanup();
      } else if (fileExtension === "odt") {
        const odtHandler = new OdtHandler();
        await odtHandler.loadJsZip();
        text = await odtHandler.extractTextFromOdt(file);
        odtHandler.cleanup();
      } else {
        const errorMsg = "Formato non supportato";
        if (!silent) {
          await alert(`${fileName}: ${errorMsg}`);
        }
        const errorResult = { status: "error", error: errorMsg, fileName };
        return errorResult;
      }

      const cleanedText = cleanDoc(text);
      
      // Validazione: rifiuta se il testo è troppo corto o vuoto dopo la pulizia
      if (!cleanedText || cleanedText.length < 50) {
        throw new Error("Il documento non contiene abbastanza testo leggibile (possibile PDF d'immagine o solo link).");
      }

      await DocsMgr.add(fileName, cleanedText);

      const fileItem = document.createElement("div");
      fileItem.className = "file-list-item success";
      fileItem.textContent = `${fileName} - Caricato con successo`;
      fileListContainer.appendChild(fileItem);

      const successResult = { status: "success", fileName };
      result = successResult;

    } catch (error) {
      const errorMsg = error.message || "Errore sconosciuto";
      console.error("uploader.handleFile:", errorMsg);

      const fileItem = document.createElement("div");
      fileItem.className = "file-list-item error";
      fileItem.textContent = `${fileName} - ${errorMsg}`;
      fileListContainer.appendChild(fileItem);

      const errorResult = { status: "error", error: errorMsg, fileName };
      result = errorResult;
    }

    return result;
  },
};

class PdfHandler {
  constructor() {
    this.pdfjsLib = null;
    this.scriptElement = null;
    this.workerScriptElement = null;
  }

  async loadPdfJs() {
    if (window["pdfjsLib"]) {
      this.pdfjsLib = window["pdfjs-dist/build/pdf"];
      this.pdfjsLib.GlobalWorkerOptions.workerSrc = "js/services/vendor/pdf.worker.min.js";
      return;
    }
    this.scriptElement = document.createElement("script");
    this.scriptElement.src = "js/services/vendor/pdf.min.js";
    document.body.appendChild(this.scriptElement);

    await new Promise((resolve, reject) => {
      this.scriptElement.onload = () => {
        // Forza l'inizializzazione dopo il caricamento dello script
        this.pdfjsLib = window["pdfjs-dist/build/pdf"];
        this.pdfjsLib.GlobalWorkerOptions.workerSrc = "js/services/vendor/pdf.worker.min.js";
        
        this.workerScriptElement = document.createElement("script");
        this.workerScriptElement.src = "js/services/vendor/pdf.worker.min.js";
        document.body.appendChild(this.workerScriptElement);
        this.workerScriptElement.onload = resolve;
        this.workerScriptElement.onerror = () => reject(new Error("Impossibile caricare pdf.worker.min.js"));
      };
      this.scriptElement.onerror = () => reject(new Error("Impossibile caricare pdf.min.js"));
    });
  }

  async extractTextFromPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await this.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(" ");
      text += pageText + "\n";
    }
    return text;
  }

  cleanup() {
    if (this.scriptElement) document.body.removeChild(this.scriptElement);
    if (this.workerScriptElement) document.body.removeChild(this.workerScriptElement);
    this.pdfjsLib = null;
    if (window.gc) window.gc();
  }
}

class OdtHandler {
  constructor() {
    this.jszip = null;
    this.scriptElement = null;
  }

  async loadJsZip() {
    if (window["JSZip"]) {
      this.jszip = window["JSZip"];
      return;
    }
    this.scriptElement = document.createElement("script");
    // Il percorso è relativo alla root della cartella static dove risiede l'app
    this.scriptElement.src = "js/services/vendor/jszip.min.js";
    document.body.appendChild(this.scriptElement);

    await new Promise((resolve, reject) => {
      this.scriptElement.onload = () => {
        this.jszip = window["JSZip"];
        resolve();
      };
      this.scriptElement.onerror = () => reject(new Error("Impossibile caricare JSZip da js/services/vendor/jszip.min.js"));
    });
  }

  async extractTextFromOdt(file) {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await this.jszip.loadAsync(arrayBuffer);
    const contentXml = await zip.file("content.xml").async("string");
    
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(contentXml, "text/xml");
    const paragraphs = xmlDoc.getElementsByTagName("text:p");
    
    return Array.from(paragraphs).map(p => p.textContent).join("\n");
  }

  cleanup() {
    if (this.scriptElement) document.body.removeChild(this.scriptElement);
    this.jszip = null;
    if (window.gc) window.gc();
  }
}

class DocxHandler {
  constructor() {
    this.mammoth = null;
    this.scriptElement = null;
  }

  async loadMammoth() {
    if (window["mammoth"]) {
      this.mammoth = window["mammoth"];
      return;
    }
    this.scriptElement = document.createElement("script");
    this.scriptElement.src = "js/services/vendor/mammoth.browser.min.js";
    document.body.appendChild(this.scriptElement);

    await new Promise((resolve, reject) => {
      this.scriptElement.onload = () => {
        this.mammoth = window["mammoth"];
        resolve();
      };
      this.scriptElement.onerror = () => reject(new Error("Impossibile caricare mammoth.browser.min.js"));
    });
  }

  async extractTextFromDocx(file) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await this.mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }

  cleanup() {
    if (this.scriptElement) document.body.removeChild(this.scriptElement);
    this.mammoth = null;
    if (window.gc) window.gc();
  }
}

export const FileReaderUtil = {
  readTextFile: async function(file) {
    if (!file) {
      throw new Error("Nessun file fornito");
    }
    // Accetta file .txt basandosi sull'estensione, non sul MIME type
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext !== "txt") {
      throw new Error("Formato non supportato. Seleziona un file .txt");
    }
    const promise = new Promise(function(resolve, reject) {
      const reader = new FileReader();
      reader.onload = function(event) {
        const content = event.target.result;
        resolve(content);
      };
      reader.onerror = function(error) {
        const message = "Error reading file: " + error.message;
        const failure = new Error(message);
        reject(failure);
      };
      reader.readAsText(file);
    });
    const content = await promise;
    return content;
  }
};