/**
 * kb-query.test.mjs - Verifica delle query su KB coerente.
 *
 * Costruisce una KB con 3 documenti reali (temi distinti) e verifica:
 * - selezione coerente per tema in `offline` (ricerca locale su catalog)
 * - struttura risposta e budget chiamate in `llm` con adapter mock
 * - copertura parziale dichiarata (Q0): fuori corpus o termini non
 *   indicizzati -> `missing` con messaggio "non presente"
 * - domanda vuota rifiutata, query senza effetti su sorgenti/pagine
 *
 * Note oneste sul setup:
 * - il mock `select` estrae i termini dall'intero messaggio DOMANDA+CATALOG,
 *   quindi in `llm` seleziona largo: la precisione topica si verifica in
 *   `offline` (ricerca locale reale), in `llm` si verificano struttura,
 *   citazioni `[[slug]]`, budget chiamate (<=3, doc workflow-query.md) e
 *   catena di fallback;
 * - l'indice è index-first sul catalog (title/summary/slug, mock = prime
 *   6 parole del chunk): termini presenti solo nel body non matchano e
 *   devono dichiarare `missing` (Q0), non inventare.
 *
 * Esecuzione: `npm test` (node --test).
 */

import "fake-indexeddb/auto";
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { kbInit, addSource, kbBuild, kbQuery, kbStatus } from "../../static/js/kb/api.js";
import { listSources } from "../../static/js/kb/sources.js";
import { createMockAdapter } from "../../static/js/kb/mock.js";
import { DOC_A, DOC_B, DOC_C, QUERIES } from "./fixtures.mjs";

const KB = `test-query-${Date.now()}`;
const mockBuild = createMockAdapter({});
let mockQuery = null;

before(async () => {
  await kbInit({ kbId: KB });
  await addSource({ kbId: KB, name: DOC_A.name, mime: "text/plain", text: DOC_A.text });
  await addSource({ kbId: KB, name: DOC_B.name, mime: "text/plain", text: DOC_B.text });
  await addSource({ kbId: KB, name: DOC_C.name, mime: "text/plain", text: DOC_C.text });
  const report = await kbBuild({ kbId: KB, mode: "auto", adapter: mockBuild });
  assert.ok(report);
  assert.equal(report.status, "done");
  assert.equal(report.totals.sources, 3);
  const status = await kbStatus({ kbId: KB });
  assert.ok(status.counts.pages > 0);
  // Il mock di selezione/risposta lavora sul catalog passato alla creazione:
  // va costruito DOPO la build, con il catalog reale della KB.
  const { openDb, runTx, storeGetAll } = await import("../../static/js/kb/db.js");
  const db = await openDb(KB);
  const catalog = await runTx(db, ["catalog"], "readonly", async (stores) => await storeGetAll(stores.catalog));
  db.close();
  assert.ok(catalog.length > 0);
  mockQuery = createMockAdapter({ catalog });
});

describe("query offline: selezione coerente per tema", () => {
  test("massoneria speculativa -> pagine del documento A", async () => {
    const res = await kbQuery({ kbId: KB, question: QUERIES.origini, mode: "offline", adapter: mockBuild });
    assert.ok(res, "query senza risultato");
    assert.equal(res.missing, false);
    assert.ok(res.pagesUsed.length > 0);
    assert.ok(res.pagesUsed.some((s) => s.includes("massoneria")), `atteso slug massoneria, avuti: ${res.pagesUsed}`);
    assert.match(res.answer, /\[\[.+\]\]/);
  });

  test("nostromo -> pagine del documento C", async () => {
    const res = await kbQuery({ kbId: KB, question: QUERIES.busaAnchor, mode: "offline", adapter: mockBuild });
    assert.equal(res.missing, false);
    assert.ok(res.pagesUsed.some((s) => s.includes("nostromo")), `atteso slug nostromo, avuti: ${res.pagesUsed}`);
  });

  test("alcune -> pagine del documento B", async () => {
    const res = await kbQuery({ kbId: KB, question: QUERIES.principiAnchor, mode: "offline", adapter: mockBuild });
    assert.equal(res.missing, false);
    assert.ok(res.pagesUsed.length > 0);
    assert.ok(
      res.pagesUsed.some((s) => s.includes("alcune") || s.includes("fatto")),
      `atteso slug del doc B, avuti: ${res.pagesUsed}`
    );
  });
});

describe("query Q0: copertura parziale dichiarata", () => {
  test("fuori corpus -> missing con messaggio dichiarato", async () => {
    const res = await kbQuery({ kbId: KB, question: QUERIES.unrelated, mode: "offline", adapter: mockBuild });
    assert.ok(res);
    assert.equal(res.pagesUsed.length, 0);
    assert.equal(res.missing, true);
    assert.match(res.answer, /non presente/i);
  });

  test("termini solo nel body (non indicizzati) -> missing, nessuna invenzione", async () => {
    const res = await kbQuery({ kbId: KB, question: QUERIES.busaBody, mode: "offline", adapter: mockBuild });
    assert.ok(res);
    assert.equal(res.pagesUsed.length, 0);
    assert.equal(res.missing, true);
    assert.match(res.answer, /non presente/i);
  });

  test("domanda vuota -> rifiutata", async () => {
    const res = await kbQuery({ kbId: KB, question: "   ", mode: "offline", adapter: mockBuild });
    assert.equal(res, null);
  });
});

describe("query llm (mock con catalog): struttura e budget", () => {
  test("risposta con citazioni verificate e chiamate entro budget", async () => {
    const callsBefore = mockQuery.calls();
    const res = await kbQuery({ kbId: KB, question: QUERIES.busaAnchor, mode: "llm", adapter: mockQuery });
    assert.ok(res);
    assert.ok(res.pagesUsed.length > 0, "nessuna pagina usata");
    assert.match(res.answer, /\[\[.+\]\]/);
    const calls = mockQuery.calls() - callsBefore;
    assert.ok(calls <= 3, `fuori budget documentato (<=3 con due livelli): ${calls}`);
    assert.ok(res.meta.calls <= 3);
    assert.ok(["llm", "llm-min", "offline"].includes(res.mode), `mode imprevisto: ${res.mode}`);
  });

  test("query non altera sorgenti/pagine", async () => {
    const before = await kbStatus({ kbId: KB });
    await kbQuery({ kbId: KB, question: QUERIES.origini, mode: "offline", adapter: mockBuild });
    const after = await kbStatus({ kbId: KB });
    assert.equal(after.counts.sources, before.counts.sources);
    assert.equal(after.counts.pages, before.counts.pages);
    const sources = await listSources(KB);
    assert.equal(sources.length, 3);
  });
});
