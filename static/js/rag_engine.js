/**
 * rag_engine.js - Motore RAG principale.
 *
 * Coordina la creazione della knowledge base, il recupero del contesto e
 * la generazione delle risposte tramite LLM. Gestisce il ciclo di vita del
 * Web Worker per le operazioni intensive.
 *
 * @module  rag_engine
 * @version 1.1.0
 * @date    2026-05-14
 * @author  Gemini CLI
 */

"use strict";

import { UaLog } from "./services/ualog3.js";
import { promptBuilder } from "./llm_prompts.js";
import { WORKER_PATH } from "./services/worker_path.js";
import { cleanLlmResponse } from "./services/history_utils.js";

// ============================================================================
// COSTANTI DI MODULO
// ============================================================================

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const CONTEXT_PERCENTAGE = 0.7;
const GENERATION_TEMPERATURE = 0.7;
const GENERATION_MAX_TOKENS = 4000;
const REQUEST_TIMEOUT_SEC = 90;
const GENERATION_RANDOM_SEED = 42;
const RETRYABLE_STATUS_CODES = [408, 500, 502, 503, 504];

/**
 * Quota del top score sotto la quale un risultato è escluso dal contesto.
 * Calibrazione sul set campione: il contenuto atteso sta al top score.
 */
const CONTEXT_SCORE_THRESHOLD_RATIO = 0.2;

/**
 * Numero massimo di parent inclusi nel contesto.
 * Calibrazione sul set campione: il contenuto atteso sta al rank 1.
 */
const CONTEXT_MAX_PARENTS = 8;

/**
 * Abilitazione default del giudizio semantico sui candidati.
 * Disattivabile via ragEngine.setRerankEnabled(false) per confronto BM25.
 */
const RERANK_ENABLED_DEFAULT = true;

/**
 * Numero massimo di parent candidati sottoposti al giudice semantico.
 * Il contesto finale resta limitato da CONTEXT_MAX_PARENTS.
 */
const RERANK_CANDIDATE_COUNT = 25;

// ============================================================================
// STATO PRIVATO DEL MODULO
// ============================================================================

let _worker = null;
const _requestPromises = {};
let _client = null;
let _model = null;
let _promptSize = 0;
let _rerankEnabled = RERANK_ENABLED_DEFAULT;

// ============================================================================
// FUNZIONI PRIVATE - Normalizzazione ricerca
// ============================================================================

/**
 * Normalizza una stringa di ricerca con le stesse regole applicate ai
 * documenti in fase di indicizzazione (trimmer, stopword e stemmer italiani).
 * Restituisce termini unici pronti per la query programmatica.
 *
 * @param {string} text - Testo grezzo da normalizzare (domanda o termini distillati).
 * @returns {Array<string>} Termini normalizzati, mai vuoti o duplicati.
 * @private
 */
const _sanitizeSearchTerms = function (text) {
    if (typeof text !== "string" || text.length === 0) {
        console.error("_sanitizeSearchTerms: testo mancante o non valido");
        const emptyTerms = [];
        return emptyTerms;
    }
    if (!self.lunr || !self.lunr.it || !self.lunr.Pipeline) {
        console.error("_sanitizeSearchTerms: normalizzazione Lunr non disponibile");
        const emptyTerms = [];
        return emptyTerms;
    }

    const sanitizer = new self.lunr.Pipeline();
    sanitizer.add(self.lunr.it.trimmer, self.lunr.it.stopWordFilter, self.lunr.it.stemmer);

    const tokens = self.lunr.tokenizer(text);
    const processed = sanitizer.run(tokens);
    const rawTerms = processed.map(token => token.toString());
    const nonEmpty = rawTerms.filter(term => term.length > 0);
    const uniqueTerms = [...new Set(nonEmpty)];
    return uniqueTerms;
};

/**
 * Esegue la ricerca per termini con query programmatica: OR tra i termini,
 * risultati ordinati per score decrescente. Non usa il parser testuale,
 * quindi nessun termine può causare errori di sintassi.
 *
 * @param {Object} index - Indice Lunr caricato.
 * @param {Array<string>} terms - Termini normalizzati da cercare.
 * @returns {Array<Object>} Risultati `{ref, score}` ordinati per score.
 * @private
 */
const _searchTerms = function (index, terms) {
    if (!index || !terms || terms.length === 0) {
        console.error("_searchTerms: indice o termini mancanti");
        const emptyResults = [];
        return emptyResults;
    }
    const searchResults = index.query(function (query) {
        for (const term of terms) {
            query.term(term);
        }
    });
    return searchResults;
};

/**
 * Esegue la ricerca per singoli termini con wildcard finale, in OR.
 * Ultimo ramo della cascata: recupera varianti che lo stemming non copre.
 *
 * @param {Object} index - Indice Lunr caricato.
 * @param {Array<string>} terms - Termini normalizzati da cercare.
 * @returns {Array<Object>} Risultati `{ref, score}` ordinati per score.
 * @private
 */
const _searchTermsWildcard = function (index, terms) {
    if (!index || !terms || terms.length === 0) {
        console.error("_searchTermsWildcard: indice o termini mancanti");
        const emptyResults = [];
        return emptyResults;
    }
    if (!self.lunr || !self.lunr.Query || !self.lunr.Query.wildcard) {
        console.error("_searchTermsWildcard: wildcard non supportata, uso ricerca semplice");
        const fallbackResults = _searchTerms(index, terms);
        return fallbackResults;
    }
    const trailingFlag = self.lunr.Query.wildcard.TRAILING;
    const searchResults = index.query(function (query) {
        for (const term of terms) {
            query.term(term, { wildcard: trailingFlag });
        }
    });
    return searchResults;
};

/**
 * Estrae termini di ricerca dalla domanda con compromise (nomi, verbi,
 * entità — le stesse fonti dell'indicizzazione) e li divide in parole
 * singole, come i token dell'indice.
 *
 * @param {string} query - Domanda originale dell'utente.
 * @returns {Array<string>} Parole estratte, minuscole e uniche.
 * @private
 */
const _extractLocalTerms = function (query) {
    if (typeof query !== "string" || query.length === 0) {
        console.error("_extractLocalTerms: query mancante o non valida");
        const emptyWords = [];
        return emptyWords;
    }
    if (!self.nlp) {
        console.error("_extractLocalTerms: compromise non disponibile");
        const emptyWords = [];
        return emptyWords;
    }
    const doc = self.nlp(query);
    const nouns = doc.nouns().out("array");
    const verbs = doc.verbs().out("array");
    const people = doc.people().out("array");
    const places = doc.places().out("array");
    const orgs = doc.organizations().out("array");
    const phrases = [...nouns, ...verbs, ...people, ...places, ...orgs];
    const words = [];
    for (const phrase of phrases) {
        const parts = String(phrase).toLowerCase().split(/\s+/);
        for (const part of parts) {
            if (part.length > 0 && !words.includes(part)) {
                words.push(part);
            }
        }
    }
    return words;
};

/**
 * Costruisce i rami della cascata di ricerca: termini distillati, poi
 * termini estratti localmente (se diversi), poi unione per wildcard.
 * Ogni ramo riporta i termini già sanificati.
 *
 * @param {string} query - Domanda originale dell'utente.
 * @param {string} distilledText - Output della distillazione (o query grezza in fallback).
 * @returns {Array<Object>} Rami `{name, terms, wildcard}` da provare in ordine.
 * @private
 */
const _buildSearchAttempts = function (query, distilledText) {
    const attempts = [];
    const distilledTerms = distilledText ? _sanitizeSearchTerms(distilledText) : [];
    if (distilledTerms.length > 0) {
        attempts.push({ name: "distilled", terms: distilledTerms, wildcard: false });
    }
    const localWords = _extractLocalTerms(query);
    const localTerms = _sanitizeSearchTerms(localWords.join(" "));
    const distilledKey = [...distilledTerms].sort().join(" ");
    const localKey = [...localTerms].sort().join(" ");
    if (localTerms.length > 0 && localKey !== distilledKey) {
        attempts.push({ name: "local", terms: localTerms, wildcard: false });
    }
    const combined = [...new Set([...distilledTerms, ...localTerms])];
    if (combined.length > 0) {
        attempts.push({ name: "single-wildcard", terms: combined, wildcard: true });
    }
    return attempts;
};

/**
 * Assembla il contesto dai risultati di ricerca: risoluzione dei parent,
 * deduplicazione e inclusione fino al budget di contesto.
 * Esclude i risultati sotto la soglia relativa al top score e limita il
 * numero di parent inclusi.
 *
 * @param {Array<Object>} searchResults - Risultati `{ref, score}` ordinati per score.
 * @param {Array<Object>} allChunks - Tutti i frammenti (Parent Chunks).
 * @returns {string} Stringa di contesto formattata.
 * @private
 */
const _assembleContext = function (searchResults, allChunks) {
    if (!searchResults || !allChunks) {
        console.error("ragEngine._assembleContext: input mancanti");
        const emptyContext = "";
        return emptyContext;
    }

    let context = "";
    const maxLength = _promptSize * CONTEXT_PERCENTAGE;
    const usedParentIds = new Set();
    const topScore = searchResults.length > 0 ? searchResults[0].score : 0;
    const scoreFloor = topScore * CONTEXT_SCORE_THRESHOLD_RATIO;
    let includedCount = 0;

    for (const result of searchResults) {
        if (result.score < scoreFloor) {
            continue;
        }
        if (includedCount >= CONTEXT_MAX_PARENTS) {
            break;
        }
        const parentId = result.ref.split("#")[0];

        if (!usedParentIds.has(parentId)) {
            usedParentIds.add(parentId);
            const chunk = allChunks.find(function (c) {
                const isMatch = c.id === parentId;
                return isMatch;
            });

            if (chunk) {
                const scoreStr = result.score.toFixed(4);
                const chunkId = chunk.id;
                const chunkText = chunk.text;
                const snippet = `--- Context: ${chunkId} (Score: ${scoreStr}) ---\n${chunkText}\n\n`;

                if (context.length + snippet.length <= maxLength) {
                    context += snippet;
                    includedCount++;
                } else {
                    break;
                }
            }
        }
    }

    const finalContext = context;
    return finalContext;
};

// ============================================================================
// FUNZIONI PRIVATE - Giudizio semantico dei candidati (rerank)
// ============================================================================

/**
 * Raccoglie i parent candidati dai risultati di ricerca, in ordine BM25
 * e deduplicati per parent, fino al limite indicato.
 *
 * @param {Array<Object>} searchResults - Risultati `{ref, score}` ordinati per score.
 * @param {Array<Object>} allChunks - Tutti i frammenti (Parent Chunks).
 * @param {number} limit - Numero massimo di candidati da raccogliere.
 * @returns {Array<Object>} Candidati `{id, text, bm25Score}`.
 * @private
 */
const _collectCandidateParents = function (searchResults, allChunks, limit) {
    if (!searchResults || !allChunks || !limit) {
        console.error("_collectCandidateParents: input mancanti");
        const emptyCandidates = [];
        return emptyCandidates;
    }
    const candidates = [];
    const seenParentIds = new Set();
    for (const result of searchResults) {
        if (candidates.length >= limit) {
            break;
        }
        const parentId = result.ref.split("#")[0];
        if (seenParentIds.has(parentId)) {
            continue;
        }
        seenParentIds.add(parentId);
        const chunk = allChunks.find(function (c) {
            const isMatch = c.id === parentId;
            return isMatch;
        });
        if (chunk) {
            const candidate = { id: parentId, text: chunk.text, bm25Score: result.score };
            candidates.push(candidate);
        }
    }
    return candidates;
};

/**
 * Chiede al modello un punteggio semantico 0-5 per ciascun candidato e
 * restituisce gli ID ordinati per punteggio (a parita', ordine BM25).
 * Restituisce null quando il giudizio non e' disponibile: il chiamante
 * usa l'ordine BM25 esistente (fallback invariato).
 *
 * @param {string} query - Domanda originale dell'utente.
 * @param {Array<Object>} candidates - Candidati `{id, text, bm25Score}`.
 * @returns {Promise<Array<string>|null>} ID parent ordinati, o null in fallback.
 * @private
 */
const _rerankCandidateIds = async function (query, candidates) {
    if (!_rerankEnabled) {
        const disabled = null;
        return disabled;
    }
    if (!query || !candidates || candidates.length === 0) {
        console.error("_rerankCandidateIds: query o candidati mancanti");
        const empty = null;
        return empty;
    }
    if (!_client) {
        console.warn("_rerankCandidateIds: client LLM assente, uso ordine BM25.");
        const missing = null;
        return missing;
    }

    UaLog.log("Giudizio semantico dei candidati...");

    const promptData = promptBuilder.buildRerankPrompt(query, candidates);
    if (!promptData || !promptData.messages) {
        console.warn("_rerankCandidateIds: buildRerankPrompt ha fallito, uso ordine BM25.");
        const failed = null;
        return failed;
    }

    const payload = {
        model: _model,
        messages: promptData.messages,
        temperature: promptData.temperature,
        max_tokens: promptData.max_tokens,
    };

    const rr = await _sendRequest(_client, payload, "ERR_RERANK");
    if (!rr || !rr.ok) {
        console.warn("_rerankCandidateIds: giudizio fallito, uso ordine BM25.");
        const failed = null;
        return failed;
    }

    const scores = promptBuilder.parseRerankScores(rr.data);
    const scoredIds = Object.keys(scores);
    if (scoredIds.length === 0) {
        console.warn("_rerankCandidateIds: nessun punteggio valido, uso ordine BM25.");
        const failed = null;
        return failed;
    }

    const ranked = candidates.slice();
    ranked.sort(function (first, second) {
        const scoreFirst = scores[first.id] !== undefined ? scores[first.id] : -1;
        const scoreSecond = scores[second.id] !== undefined ? scores[second.id] : -1;
        const scoreDiff = scoreSecond - scoreFirst;
        if (scoreDiff !== 0) {
            return scoreDiff;
        }
        const bm25Diff = second.bm25Score - first.bm25Score;
        return bm25Diff;
    });
    const orderedIds = ranked.map(function (candidate) {
        const candidateId = candidate.id;
        return candidateId;
    });

    const summaryParts = [];
    for (const candidate of ranked) {
        const candidateId = candidate.id;
        const rawScore = scores[candidateId];
        const shownScore = rawScore !== undefined ? rawScore : "-";
        const summaryPart = `${candidateId}:${shownScore}`;
        summaryParts.push(summaryPart);
    }
    const summary = summaryParts.join(" ");
    const rerankMsg = `Rerank semantico: ${summary}`;
    console.info(rerankMsg);
    UaLog.log(rerankMsg);

    return orderedIds;
};

/**
 * Riordina i risultati di ricerca secondo gli ID rerankati: prima i
 * risultati il cui parent e' in classifica (nell'ordine del giudice),
 * poi gli eventuali resti nell'ordine originale.
 *
 * @param {Array<Object>} searchResults - Risultati `{ref, score}` originali.
 * @param {Array<string>} rankedParentIds - ID parent ordinati dal giudice.
 * @returns {Array<Object>} Risultati riordinati.
 * @private
 */
const _applyRerankOrder = function (searchResults, rankedParentIds) {
    if (!searchResults || !rankedParentIds || rankedParentIds.length === 0) {
        console.error("_applyRerankOrder: input mancanti");
        const fallback = searchResults || [];
        return fallback;
    }
    const rankByParentId = {};
    for (let rank = 0; rank < rankedParentIds.length; rank++) {
        const parentId = rankedParentIds[rank];
        rankByParentId[parentId] = rank;
    }
    const ordered = searchResults.slice();
    ordered.sort(function (first, second) {
        const parentFirst = first.ref.split("#")[0];
        const parentSecond = second.ref.split("#")[0];
        const maxRank = Number.MAX_SAFE_INTEGER;
        const rankFirst = rankByParentId[parentFirst] !== undefined ? rankByParentId[parentFirst] : maxRank;
        const rankSecond = rankByParentId[parentSecond] !== undefined ? rankByParentId[parentSecond] : maxRank;
        const rankDiff = rankFirst - rankSecond;
        if (rankDiff !== 0) {
            return rankDiff;
        }
        const scoreDiff = second.score - first.score;
        return scoreDiff;
    });
    return ordered;
};

// ============================================================================
// FUNZIONI PRIVATE - Gestione Worker
// ============================================================================

/**
 * Inizializza il Web Worker per l'elaborazione RAG.
 * Configura gli handler per i messaggi e gli errori.
 *
 * @private
 */
const _initWorker = function () {
  if (_worker) {
    return;
  }

  try {
    const workerUrl = new URL(WORKER_PATH, import.meta.url).href;
    _worker = new Worker(workerUrl);
  } catch (e) {
    console.error("_initWorker: impossibile creare il Web Worker:", e);
    UaLog.log("ERRORE: Web Worker non disponibile, pipeline interrotta.");
    const workerErr = new Error("Web Worker non disponibile");
    Object.values(_requestPromises).forEach(function (p) {
      p.reject(workerErr);
    });
    for (const key in _requestPromises) {
      delete _requestPromises[key];
    }
    return;
  }

  /**
   * Handler per i messaggi dal worker.
   */
  _worker.onmessage = function (e) {
    const { status, command, result, error, progress } = e.data;

    if (status === "progress") {
      UaLog.log(progress);
      return;
    }

    const promise = _requestPromises[command];
    if (promise) {
      if (status === "complete") {
        promise.resolve(result);
      } else if (status === "error") {
        const err = new Error(error);
        promise.reject(err);
      }
      delete _requestPromises[command];
    }
  };

  /**
   * Handler per gli errori del worker.
   */
  _worker.onerror = function (e) {
    console.error("_initWorker (error):", e);
    const errorMsg = "Errore critico nel worker RAG";
    const workerErr = new Error(errorMsg);

    Object.values(_requestPromises).forEach(function (p) {
      p.reject(workerErr);
    });

    // Pulizia totale dei riferimenti alle promesse
    for (const key in _requestPromises) {
      delete _requestPromises[key];
    }
  };
};

/**
 * Invia un comando al worker e restituisce una promessa.
 *
 * @param {string} command - Nome del comando da eseguire.
 * @param {any} data - Dati associati al comando.
 * @returns {Promise<any>} Risultato dell'operazione.
 * @private
 */
const _postCommandToWorker = function (command, data) {
  _initWorker();

  if (!_worker) {
    const err = new Error("Web Worker non disponibile");
    UaLog.log(`ERRORE: ${err.message} — comando "${command}" annullato.`);
    return Promise.reject(err);
  }

  const promise = new Promise(function (resolve, reject) {
    _requestPromises[command] = { resolve, reject };
    _worker.postMessage({ command, data });
  });

  return promise;
};

// ============================================================================
// FUNZIONI PRIVATE - Comunicazione LLM
// ============================================================================

/**
 * Sanifica l'output della distillazione: divide in token e scarta tutto ciò
 * che non contiene lettere o numeri (punteggiatura, elenchi, markdown).
 * I token numerici sono conservati anche se oggi non ricercabili.
 *
 * @param {string} text - Output grezzo del modello di distillazione.
 * @returns {string} Termini validi separati da spazio (o stringa vuota).
 * @private
 */
const _sanitizeDistillOutput = function (text) {
  if (typeof text !== "string") {
    console.error("_sanitizeDistillOutput: testo non valido");
    const emptyOutput = "";
    return emptyOutput;
  }
  const rawTokens = text.split(/\s+/);
  const validTokens = rawTokens.filter(token => /[\p{L}\p{N}]/u.test(token));
  const cleaned = validTokens.join(" ");
  const result = cleaned.trim();
  return result;
};

/**
 * Distilla una query utente in termini di ricerca ottimizzati.
 *
 * @param {string} query - La domanda originale dell'utente.
 * @returns {Promise<string>} Termini di ricerca ottimizzati.
 * @private
 */
const _distillQuery = async function (query) {
  if (!query) {
    console.error("_distillQuery: query mancante");
    const empty = "";
    return empty;
  }

  UaLog.log("🔍 Ottimizzazione termini di ricerca...");

  const promptData = promptBuilder.buildDistillPrompt(query);
  if (!promptData || !promptData.messages) {
    console.warn("_distillQuery: buildDistillPrompt ha fallito, uso query originale.");
    return query;
  }

  const payload = {
    model: _model,
    messages: promptData.messages,
    temperature: promptData.temperature,
    max_tokens: promptData.max_tokens,
  };

  const rr = await _sendRequest(_client, payload, "ERR_DISTILL_QUERY");

  let result = query;
  if (rr && rr.ok) {
    result = _sanitizeDistillOutput(rr.data);
  } else {
    console.warn("_distillQuery: distillazione fallita, uso query originale.");
  }

  return result;
};

/**
 * Sospende l'esecuzione per un periodo specificato.
 *
 * @param {number} ms - Millisecondi di attesa.
 * @returns {Promise<void>}
 * @private
 */
const _sleep = function (ms) {
  const promise = new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
  return promise;
};

/**
 * Invia una richiesta al client LLM con gestione dei tentativi (retry).
 *
 * @param {Object} client - Istanza del client LLM.
 * @param {Object} payload - Payload della richiesta.
 * @param {string} errorTag - Etichetta per il logging degli errori.
 * @returns {Promise<Object|null>} Risultato della richiesta o null.
 * @private
 */
const _sendRequest = async function (client, payload, errorTag) {
  // Fail Fast
  if (!client || !payload) {
    console.error("_sendRequest: client o payload mancanti");
    const empty = null;
    return empty;
  }

  let result = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const rr = await client.sendRequest(payload, REQUEST_TIMEOUT_SEC);

    if (!rr || rr.ok) {
      result = rr;
      break;
    }

    const err = rr.error;
    const errCode = err ? err.code : null;
    const attemptLog = `Attempt ${attempt}/${MAX_RETRIES}`;
    console.error(`_sendRequest.${errorTag} (${attemptLog}):`, err);

    const isRetryable = RETRYABLE_STATUS_CODES.includes(errCode);

    if (isRetryable) {
      UaLog.log(`Errore transitorio ${errCode}. Riprovo... (${attempt}/${MAX_RETRIES})`);
      await _sleep(RETRY_DELAY_MS);
    } else {
      result = rr;
      break;
    }
  }

  return result;
};

// ============================================================================
// API PUBBLICA
// ============================================================================

/**
 * Gestore del motore RAG.
 */
export const ragEngine = {
  /**
   * Inizializza il motore con le configurazioni LLM.
   *
   * @param {Object} client - Client LLM attivo.
   * @param {string} model - Nome del modello selezionato.
   * @param {number} promptSize - Dimensione massima del prompt in byte.
   */
  init: function (client, model, promptSize) {
    _client = client;
    _model = model;
    _promptSize = promptSize;

    _initWorker();
  },

  /**
   * Ferma il motore RAG e termina il worker.
   * Pulisce le promesse pendenti.
   */
  stop: function () {
    if (_worker) {
      _worker.terminate();
      _worker = null;

      const stopErr = new Error("Operazione interrotta dall'utente");
      stopErr.code = 499;
      Object.values(_requestPromises).forEach(function (p) {
        p.reject(stopErr);
      });

      for (const key in _requestPromises) {
        delete _requestPromises[key];
      }

      console.debug("ragEngine.stop: Worker terminato.");
    }
  },

  /**
   * Avvia la creazione della Knowledge Base dai documenti.
   *
   * @param {Array<Object>} documents - Lista di documenti {name, text}.
   * @returns {Promise<Object>} Risultato della creazione KB.
   */
  createKnowledgeBase: function (documents) {
    const promise = _postCommandToWorker("createKnowledgeBase", documents);
    return promise;
  },

  /**
   * Esegue solo chunking su documenti, senza creare indice Lunr.
   * Usato per aggiornamenti incrementali della KB.
   *
   * @param {Array<Object>} documents - Lista di documenti {name, text}.
   * @param {number} startDocIndex - Indice di partenza per ID univoci.
   * @returns {Promise<Object>} {parents: [], childEntries: [{docName, children, docIndex}]}.
   */
  chunkDocumentsAsync: function (documents, startDocIndex) {
    const promise = _postCommandToWorker("chunkDocuments", {
      documents: documents,
      startDocIndex: startDocIndex,
    });
    return promise;
  },

  /**
   * Costruisce il contesto rilevante per una query tramite ricerca Lunr.
   * La query grezza viene sanificata con le stesse regole dell'indicizzazione
   * e la ricerca usa una query programmatica (OR tra termini): nessun errore
   * di sintassi possibile, ordinamento per score decrescente preservato.
   *
   * @param {string} serializedIndex - Indice Lunr serializzato in JSON.
   * @param {Array<Object>} allChunks - Tutti i frammenti (Parent Chunks).
   * @param {string} query - Testo grezzo di ricerca (domanda o termini distillati).
   * @returns {string} Stringa di contesto formattata.
   */
  buildContext: function (serializedIndex, allChunks, query) {
    // Fail Fast
    if (!serializedIndex || !allChunks || !query) {
      console.error("ragEngine.buildContext: input mancanti");
      const empty = "";
      return empty;
    }

    const indexJson = JSON.parse(serializedIndex);
    const index = self.lunr.Index.load(indexJson);
    const searchTerms = _sanitizeSearchTerms(query);
    const searchResults = _searchTerms(index, searchTerms);
    const context = _assembleContext(searchResults, allChunks);

    const finalContext = context;
    return finalContext;
  },

  /**
   * Ottiene il contesto ottimizzato tramite distillazione della query.
   * Solo per la prima domanda: prova i rami di ricerca in cascata
   * (distillati, locali, singoli con wildcard) e usa il primo che produce
   * contesto. A strategie esaurite restituisce stringa vuota (modalità
   * senza contesto, come prima).
   *
   * @param {string} query - Query originale dell'utente.
   * @param {Object} kbData - Dati della KB {index, chunks}.
   * @param {Array} thread - Cronologia messaggi della conversazione.
   * @returns {Promise<string>} Contesto recuperato.
   */
  getOptimizedContext: async function (query, kbData, thread) {
    const isFirstQuestion = !thread || thread.length <= 1;

    if (!kbData || !kbData.index || !isFirstQuestion) {
      const emptyResult = "";
      return emptyResult;
    }

    const indexJson = JSON.parse(kbData.index);
    const index = self.lunr.Index.load(indexJson);

    const searchTerms = await _distillQuery(query);
    UaLog.log("📄 Recupero informazioni pertinenti...");

    const attempts = _buildSearchAttempts(query, searchTerms);
    let context = "";
    let winningStrategy = "none";
    for (const attempt of attempts) {
      let attemptResults = [];
      if (attempt.wildcard) {
        attemptResults = _searchTermsWildcard(index, attempt.terms);
      } else {
        attemptResults = _searchTerms(index, attempt.terms);
      }
      if (attemptResults.length === 0) {
        continue;
      }
      const candidates = _collectCandidateParents(attemptResults, kbData.chunks, RERANK_CANDIDATE_COUNT);
      const rankedParentIds = await _rerankCandidateIds(query, candidates);
      let orderedResults = attemptResults;
      let rerankLabel = "bm25";
      if (rankedParentIds) {
        orderedResults = _applyRerankOrder(attemptResults, rankedParentIds);
        rerankLabel = "rerank";
      }
      const attemptContext = _assembleContext(orderedResults, kbData.chunks);
      if (attemptContext.length > 0) {
        context = attemptContext;
        const attemptName = attempt.name;
        winningStrategy = `${attemptName}+${rerankLabel}`;
        break;
      }
    }

    const strategyMsg = `Strategia contesto: ${winningStrategy} (${context.length} caratteri)`;
    console.info(strategyMsg);
    UaLog.log(strategyMsg);

    const result = context;
    return result;
  },

  /**
   * Attiva o disattiva il giudizio semantico sui candidati.
   * Disattivato, il contesto segue l'ordinamento BM25 esistente.
   *
   * @param {boolean} enabled - True per attivare il rerank semantico.
   */
  setRerankEnabled: function (enabled) {
    _rerankEnabled = enabled === true;
  },

  /**
   * Indica se il giudizio semantico sui candidati e' attivo.
   *
   * @returns {boolean} True se il rerank semantico e' attivo.
   */
  isRerankEnabled: function () {
    const enabled = _rerankEnabled;
    return enabled;
  },

  /**
   * Genera una risposta tramite LLM dato il contesto e il thread.
   *
   * @param {string} context - Contesto recuperato dai documenti.
   * @param {Array} thread - Cronologia messaggi.
   * @returns {Promise<string>} Risposta generata e pulita.
   */
  generateResponse: async function (context, thread) {
    // TODO: Valore contesto prima di generare risposta
    console.debug("ragEngine.generateResponse - context length:", context ? context.length : 0);
    const messages = promptBuilder.answerPrompt(context, thread);

    console.debug("%c🚀 LLM REQUEST — %d messaggi", "color:#00bd97;font-weight:bold;font-size:1.1em", messages.length);

    messages.forEach(function(msg, i) {
      const role = msg.role;
      const color = role === "system" ? "#e82323" : role === "user" ? "#f6e602" : "#00bd97";
      const label = role.toUpperCase();
      console.info("%c[%s]%c %s", "color:" + color + ";font-weight:bold", label, "color:#e0e0e0", msg.content);
    });

    const payload = {
      model: _model,
      messages: messages,
      random_seed: GENERATION_RANDOM_SEED,
      temperature: GENERATION_TEMPERATURE,
      max_tokens: GENERATION_MAX_TOKENS,
    };

    console.debug("PAYLOAD:", JSON.stringify(payload, null, 2));

    const modelName = _model;
    const contextLen = context ? context.length : 0;
    const llmLogMsg = `✍️ LLM: ${modelName} | Contesto: ${contextLen} caratteri`;
    UaLog.log(llmLogMsg);
    const rr = await _sendRequest(_client, payload, "ERR_GENERATE_RESPONSE");

    if (!rr || !rr.ok) {
      const errorToThrow = rr ? rr.error : new Error("Request failed without response");
      throw errorToThrow;
    }

    const rawData = rr.data;
    const cleanedData = cleanLlmResponse(rawData);
    console.info("%c[%s]%c %s", "color:#00bd97;font-weight:bold", "ASSISTANT", "color:#e0e0e0", cleanedData);
    const result = cleanedData;
    return result;
  },
};
