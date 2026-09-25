/**
 * rag_worker.js - Web Worker per elaborazione RAG.
 *
 * Esegue chunking e indicizzazione in background senza bloccare la UI.
 * Utilizza Compromise.js per NLP e Lunr.js per indicizzazione.
 *
 * @module  rag_worker
 * @version 1.1.0
 * @date    2026-05-14
 * @author  Gemini CLI
 */

"use strict";

// Import script nel contesto worker
/* eslint-disable no-undef */
importScripts(
  "./services/vendor/compromise.js",
  "./services/vendor/lunr.js",
  "./services/vendor/lunr.stemmer.support.js",
  "./services/vendor/lunr.it.js"
);

// ============================================================================
// COSTANTI DI MODULO
// ============================================================================

/**
 * Configurazione chunking.
 * @type {Object}
 */
const CONFIG = {
  TARGET_PARENT_SIZE: 1000, // Dimensione target per Parent Chunk
  MIN_CHILD_LENGTH: 15, // Lunghezza minima per Child Chunk
};

// ============================================================================
// FUNZIONI PRIVATE
// ============================================================================

/**
 * Estrae metadati (keywords ed entità) da un testo.
 *
 * @param {string} text - Testo da analizzare.
 * @returns {Object} Oggetto con keywords ed entities.
 * @private
 */
const _processText = function (text) {
  // Fail Fast
  if (!text) {
    console.error("_processText: testo mancante");
    const emptyResult = { keywords: [], entities: [] };
    return emptyResult;
  }

  const doc = self.nlp(text);

  // Estrazione parti del discorso
  const nouns = doc.nouns().out("array");
  const verbs = doc.verbs().out("array");

  // Parole chiave (nomi + verbi, lowercase, lunghezza > 3)
  const allWords = [...nouns, ...verbs];
  const uniqueWords = [...new Set(allWords)];
  const keywords = uniqueWords.map((w) => w.toLowerCase()).filter((w) => w.length > 3);

  // Named Entity Recognition
  const people = doc.people().out("array");
  const places = doc.places().out("array");
  const orgs = doc.organizations().out("array");

  const allEntities = [...people, ...places, ...orgs];
  const uniqueEntities = [...new Set(allEntities)];
  const entities = uniqueEntities.map((e) => e.toLowerCase());

  const result = { keywords, entities };
  return result;
};

/**
 * Costruisce l'indice Lunr da un array di entry.
 *
 * @param {Array<Object>} indexEntries - Array di {id, body, keywords, entities}.
 * @returns {Object} Indice Lunr serializzabile.
 * @private
 */
const _buildIndex = function (indexEntries) {
  // Fail Fast
  if (!indexEntries || indexEntries.length === 0) {
    console.error("_buildIndex: indexEntries mancanti o vuote");
    const empty = null;
    return empty;
  }

  const idx = self.lunr(function () {
    // Configura lingua italiana
    this.use(self.lunr.it);

    // Campo di riferimento (ID)
    this.ref("id");

    // Campo principale per ricerca
    this.field("body");

    // Aggiunge ogni entry all'indice
    indexEntries.forEach((entry) => {
      // Unisce corpo, keywords ed entities in un unico testo
      const keywordsStr = entry.keywords.join(" ");
      const entitiesStr = entry.entities.join(" ");
      const fullText = `${entry.body} ${keywordsStr} ${entitiesStr}`;

      this.add({ id: entry.id, body: fullText });
    });
  });

  const result = idx;
  return result;
};

/**
 * Esegue il chunking gerarchico Parent-Child su un documento.
 *
 * @param {string} text - Testo del documento.
 * @param {number} docIndex - Indice del documento (per ID univoci).
 * @returns {Promise<Object>} {parents: [], indexEntries: []}.
 * @private
 */
const _chunkDocument = async function (text, docIndex) {
  // Fail Fast
  if (!text) {
    console.error("_chunkDocument: testo mancante");
    const emptyResult = { parents: [], indexEntries: [] };
    return emptyResult;
  }

  const parents = [];
  const indexEntries = [];

  // Usa compromise per dividere in frasi
  const sentences = self.nlp(text).sentences().out("array");

  let currentParentText = "";
  let currentParentSentences = [];
  let parentIdx = 0;

  /**
   * Finalizza un Parent Chunk e crea i relativi Children.
   * @returns {void}
   */
  const finalizeParent = async function () {
    const parentNum = parentIdx++;
    const docNum = docIndex;
    const pid = `d${docNum}p${parentNum}`;

    // 1. Creo il Parent (Contesto)
    parents.push({
      id: pid,
      text: currentParentText,
      source: `doc_${docIndex}`, // Metadata per citazioni future
    });

    // 2. Creo i Children (Unità di Ricerca)
    let childIdx = 0;

    for (const sent of currentParentSentences) {
      // Filtro frasi troppo brevi che sporcano l'indice
      if (sent.length < CONFIG.MIN_CHILD_LENGTH) {
        continue;
      }

      const childNum = childIdx++;
      const cid = `${pid}#${childNum}`; // ID Composito: ParentID#ChildID
      const meta = _processText(sent);

      indexEntries.push({
        id: cid,
        body: sent,
        keywords: meta.keywords,
        entities: meta.entities,
      });
    }
  };

  // Accumulo frasi in Parent (sliding window)
  for (const s of sentences) {
    const shouldFinalize =
      currentParentText.length > 0 && currentParentText.length + s.length > CONFIG.TARGET_PARENT_SIZE;

    if (shouldFinalize) {
      await finalizeParent();
      currentParentText = s;
      currentParentSentences = [s];
    } else {
      const separator = currentParentText.length > 0 ? " " : "";
      currentParentText += separator + s;
      currentParentSentences.push(s);
    }
  }

  // Flush finale
  if (currentParentText.length > 0) {
    await finalizeParent();
  }

  const result = { parents, indexEntries };
  return result;
};

/**
 * Crea la Knowledge Base da un array di documenti.
 *
 * @param {Array<Object>} documents - Array di {name, text}.
 * @returns {Promise<Object>} {chunks: [], serializedIndex: ""}.
 * @private
 */
const _createKnowledgeBase = async function (documents) {
  // Fail Fast
  if (!documents || documents.length === 0) {
    console.error("_createKnowledgeBase: documenti mancanti o vuoti");
    const emptyResult = { chunks: [], serializedIndex: "" };
    return emptyResult;
  }

  // Fase 0: Chunking Gerarchico (Parent-Child)
  self.postMessage({
    status: "progress",
    command: "createKnowledgeBase",
    progress: "Fase 0: Segmentazione (Parent-Child)...",
  });

  const allParents = [];
  const allIndexEntries = [];
  const allChildEntries = [];

  // Elabora ogni documento
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const docName = doc.name;
    const progressMsg = ` -> Elaboro ${docName}`;

    self.postMessage({
      status: "progress",
      command: "createKnowledgeBase",
      progress: progressMsg,
    });

    const result = await _chunkDocument(doc.text, i);
    allParents.push(...result.parents);
    allIndexEntries.push(...result.indexEntries);
    allChildEntries.push({
      docName: docName,
      children: result.indexEntries,
      docIndex: i,
    });
  }

  // Fase 1: Indicizzazione
  const itemsCount = allIndexEntries.length;
  const indexProgressMsg = `Fase 1: Indicizzazione (${itemsCount} items)...`;

  self.postMessage({
    status: "progress",
    command: "createKnowledgeBase",
    progress: indexProgressMsg,
  });

  const index = _buildIndex(allIndexEntries);
  const serializedIndex = JSON.stringify(index);

  // Restituisce chunks (Parent), indice serializzato e child entries
  const finalResult = {
    chunks: allParents,
    serializedIndex: serializedIndex,
    childEntries: allChildEntries,
  };

  return finalResult;
};

/**
 * Esegue chunking su array di documenti senza creare indice Lunr.
 * Usato per aggiornamenti incrementali della KB.
 *
 * @param {Array<Object>} documents - Array di {name, text}.
 * @param {number} startDocIndex - Indice di partenza per ID univoci.
 * @returns {Promise<Object>} {parents: [], childEntries: [{docName, children, docIndex}]}.
 * @private
 */
const _chunkDocuments = async function (documents, startDocIndex) {
  const allParents = [];
  const allChildEntries = [];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const docIdx = startDocIndex + i;

    self.postMessage({
      status: "progress",
      command: "chunkDocuments",
      progress: ` -> Chunking ${doc.name} (doc ${docIdx})...`,
    });

    const result = await _chunkDocument(doc.text, docIdx);
    allParents.push(...result.parents);
    allChildEntries.push({
      docName: doc.name,
      children: result.indexEntries,
      docIndex: docIdx,
    });
  }

  const finalResult = { parents: allParents, childEntries: allChildEntries };
  return finalResult;
};

// ============================================================================
// MESSAGE HANDLER
// ============================================================================

/**
 * Gestisce i messaggi in arrivo dal thread principale.
 *
 * @param {MessageEvent} e - Evento messaggio contenente {command, data}.
 */
self.onmessage = async function (e) {
  const { command, data } = e.data;

  try {
    let result = null;

    switch (command) {
      case "createKnowledgeBase":
        result = await _createKnowledgeBase(data);
        break;

      case "chunkDocuments":
        result = await _chunkDocuments(data.documents, data.startDocIndex);
        break;

      default: {
        const errorMsg = `Comando non riconosciuto per il worker: ${command}`;
        throw new Error(errorMsg);
      }
    }

    self.postMessage({
      status: "complete",
      command: command,
      result: result,
    });
  } catch (error) {
    console.error(`rag_worker.onmessage [${command}]:`, error);
    self.postMessage({
      status: "error",
      command: command,
      error: error.message,
    });
  }
};

