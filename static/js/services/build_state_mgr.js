/**
 * build_state_mgr.js - Stato di costruzione della knowledge base.
 *
 * Traccia l'avanzamento del build incrementale della KB.
 *
 * @module  services/build_state_mgr
 * @version 1.0.0
 * @date    2026-09-15
 */
"use strict";

import { UaDb } from "./uadb.js";
import { DATA_KEYS } from "./data_keys.js";

export const BuildStateMgr = {
  // Inizializza lo stato per un nuovo processo di build
  async initState(docNames) {
    const state = {
      status: "in_progress",
      docNames: docNames,
      currentDocIndex: 0,
      currentChunkIndex: 0,
    };
    await UaDb.saveJson(DATA_KEYS.KEY_BUILD_STATE, state);
    return state;
  },

  // Carica lo stato corrente
  async loadState() {
    const state = await UaDb.readJson(DATA_KEYS.KEY_BUILD_STATE);
    return state;
  },

  // Aggiorna e salva lo stato
  async updateState(state) {
    await UaDb.saveJson(DATA_KEYS.KEY_BUILD_STATE, state);
  },

  // Pulisce lo stato e tutti i dati intermedi
  async clearState() {
    const state = await this.loadState();
    if (state && state.docNames) {
      for (const docName of state.docNames) {
        await UaDb.delete(this.getChunkResultsKey(docName));
        await UaDb.delete(this.getDocKbKey(docName));
      }
    }
    await UaDb.delete(DATA_KEYS.KEY_BUILD_STATE);
  },

  // Funzioni per gestire i risultati intermedi dei chunk
  getChunkResultsKey: function(docName) {
    const key = `${DATA_KEYS.KEY_CHUNK_RES_PRE}${docName}`;
    return key;
  },

  async saveChunkResults(docName, results) {
    await UaDb.saveArray(this.getChunkResultsKey(docName), results);
  },

  async loadChunkResults(docName) {
    const results = await UaDb.readArray(this.getChunkResultsKey(docName));
    return results;
  },

  // Funzioni per gestire le KB dei singoli documenti
  getDocKbKey: function(docName) {
    const key = `${DATA_KEYS.KEY_DOC_KB_PRE}${docName}`;
    return key;
  },

  async saveDocKb(docName, docKb) {
    await UaDb.save(this.getDocKbKey(docName), docKb);
  },

  async loadDocKb(docName) {
    const docKb = await UaDb.read(this.getDocKbKey(docName));
    return docKb;
  },
};