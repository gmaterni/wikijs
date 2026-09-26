/**
 * fixtures.mjs - Documenti reali da /u/AI/data per i test del workflow KB.
 *
 * Tre documenti con temi distinti così le query possono verificare
 * la coerenza della selezione:
 * - A: origini della Massoneria moderna/speculativa (1717)
 * - B: principi massonici come sistema di moralità
 * - C: padre Busa, pioniere della linguistica computazionale
 *
 * Si usano estratti di ~20k caratteri: con chunkChars=12000 coprono
 * ~2 chunk ciascuno, build veloce con adapter mock ma multi-pagina.
 */

import { readFileSync } from "node:fs";

const DATA_ROOT = "/u/AI/data";

const readExcerpt = function (path, chars) {
  const raw = readFileSync(path, "utf-8").replace(/^\uFEFF/, "");
  return raw.slice(0, chars).trim();
};

export const DOC_A = {
  name: "lucarelli_origine.txt",
  path: `${DATA_ROOT}/goi/lucarelli_origine.txt`,
  text: readExcerpt(`${DATA_ROOT}/goi/lucarelli_origine.txt`, 20000),
  keywords: ["massoneria", "speculativa", "1717"],
};

export const DOC_B = {
  name: "lucarelli_riflessioni.txt",
  path: `${DATA_ROOT}/goi/lucarelli_riflessioni.txt`,
  text: readExcerpt(`${DATA_ROOT}/goi/lucarelli_riflessioni.txt`, 20000),
  keywords: ["moralità", "allegorie", "simboli"],
};

export const DOC_C = {
  name: "busa.txt",
  path: `${DATA_ROOT}/cattedrale/busa.txt`,
  text: readExcerpt(`${DATA_ROOT}/cattedrale/busa.txt`, 20000),
  keywords: ["busa", "linguistica", "computazionale"],
};

export const ALL_DOCS = [DOC_A, DOC_B, DOC_C];

export const QUERIES = {
  origini: "Quando nasce la massoneria speculativa?",
  // Ancore verificate contro il catalog reale (title/summary = prime 6 parole
  // del chunk nel mock): ogni ancora matcha solo il proprio documento.
  busaAnchor: "nostromo",
  principiAnchor: "alcune",
  // Termini presenti solo nel body dei chunk (l'indice index-first non li
  // copre): la query corretta deve dichiarare missing (Q0), non inventare.
  busaBody: "Chi è il pioniere della linguistica computazionale?",
  unrelated: "Chi ha scritto la Divina Commedia?",
};
