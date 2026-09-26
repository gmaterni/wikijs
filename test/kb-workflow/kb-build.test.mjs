/**
 * kb-build.test.mjs - Verifica del workflow di creazione della KB.
 *
 * Copre gli scenari della delta spec `knowledge-base`:
 * registrazione (new/invariato/modificato/vuoto/riattivazione), prima
 * costruzione, incrementale, nulla-da-elaborare, delete senza toccare
 * le pagine (tombstone, I3, revive), export/import con filtro agli
 * ingested, coerenza kbStatus/listSources.
 *
 * Esecuzione: `npm test` (node --test).
 */

import "fake-indexeddb/auto";
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { kbInit, addSource, kbBuild, kbQuery, kbStatus, kbExport, kbImport } from "../../static/js/kb/api.js";
import { listSources, isPending, deleteSource } from "../../static/js/kb/sources.js";
import { createMockAdapter } from "../../static/js/kb/mock.js";
import { DOC_A, DOC_B, DOC_C } from "./fixtures.mjs";

const KB = `test-build-${Date.now()}`;
const mock = createMockAdapter({});

before(() => {
  assert.ok(DOC_A.text.length > 5000, "fixture A troppo corta");
  assert.ok(DOC_B.text.length > 5000, "fixture B troppo corta");
});

describe("registrazione documenti (addSource)", () => {
  test("nuovo documento -> stato new", async () => {
    await kbInit({ kbId: KB });
    const saved = await addSource({ kbId: KB, name: DOC_A.name, mime: "text/plain", text: DOC_A.text });
    assert.ok(saved, "registrazione fallita");
    assert.equal(saved.status, "new");
  });

  test("stesso nome + stesso contenuto -> invariato, nessuna rielaborazione", async () => {
    const again = await addSource({ kbId: KB, name: DOC_A.name, mime: "text/plain", text: DOC_A.text });
    assert.ok(again, "seconda registrazione fallita");
    assert.equal(again.changed, false);
    const sources = await listSources(KB);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].status, "new");
  });

  test("stesso nome + contenuto diverso -> changed, stesso sourceId", async () => {
    const before = (await listSources(KB)).find((r) => r.name === DOC_A.name);
    const modified = await addSource({
      kbId: KB,
      name: DOC_A.name,
      mime: "text/plain",
      text: `${DOC_A.text}\nAppendice di verifica changed.`,
    });
    assert.ok(modified);
    assert.equal(modified.status, "changed");
    assert.equal(modified.sourceId, before.sourceId);
    assert.equal(modified.changed, true);
  });

  test("testo vuoto -> registrazione rifiutata", async () => {
    const empty = await addSource({ kbId: KB, name: "vuoto.txt", mime: "text/plain", text: "   " });
    assert.equal(empty, null);
    const blank = await addSource({ kbId: KB, name: "vuoto2.txt", mime: "text/plain", text: "" });
    assert.equal(blank, null);
  });

  test("ricaricamento non bloccato: nome esistente accettato e marcato changed", async () => {
    const second = await addSource({ kbId: KB, name: DOC_B.name, mime: "text/plain", text: DOC_B.text });
    assert.ok(second);
    assert.equal(second.status, "new");
    // Ricarica B modificato: non deve essere scartato come duplicato
    const changed = await addSource({
      kbId: KB,
      name: DOC_B.name,
      mime: "text/plain",
      text: `${DOC_B.text}\nSeconda versione.`,
    });
    assert.ok(changed);
    assert.equal(changed.status, "changed");
  });
});

describe("prima costruzione e incrementale", () => {
  const KB2 = `test-first-${Date.now()}`;

  test("prima compilazione: elabora tutti i documenti caricati", async () => {
    await kbInit({ kbId: KB2 });
    await addSource({ kbId: KB2, name: DOC_A.name, mime: "text/plain", text: DOC_A.text });
    await addSource({ kbId: KB2, name: DOC_B.name, mime: "text/plain", text: DOC_B.text });
    const report = await kbBuild({ kbId: KB2, mode: "auto", adapter: mock });
    assert.ok(report, "build senza report");
    assert.equal(report.status, "done");
    assert.equal(report.totals.sources, 2);
    assert.ok(report.totals.pagesCreated > 0, "nessuna pagina creata");
    const sources = await listSources(KB2);
    assert.ok(sources.every((r) => r.status === "ingested"), "non tutte ingested dopo build");
    // doclist simulata come fa la UI: solo ingested
    const doclist = sources.filter((r) => r.status === "ingested").map((r) => r.name);
    assert.deepEqual(doclist.sort(), [DOC_A.name, DOC_B.name].sort());
  });

  test("stato reale coerente: kbStatus + listSources", async () => {
    const status = await kbStatus({ kbId: KB2 });
    assert.ok(status);
    assert.equal(status.counts.sources, 2);
    assert.ok(status.counts.pages > 0);
    const sources = await listSources(KB2);
    const processed = sources.filter((r) => !isPending(r));
    const available = sources.filter((r) => isPending(r));
    assert.equal(processed.length, 2);
    assert.equal(available.length, 0);
  });

  test("aggiunta successiva: solo il nuovo documento viene elaborato", async () => {
    await addSource({ kbId: KB2, name: DOC_C.name, mime: "text/plain", text: DOC_C.text });
    const before = await kbStatus({ kbId: KB2 });
    const report = await kbBuild({ kbId: KB2, mode: "auto", adapter: mock });
    assert.ok(report);
    assert.equal(report.totals.sources, 1);
    const after = await kbStatus({ kbId: KB2 });
    assert.ok(after.counts.pages >= before.counts.pages);
    const doclist = (await listSources(KB2)).filter((r) => r.status === "ingested").map((r) => r.name);
    assert.deepEqual(doclist.sort(), [DOC_A.name, DOC_B.name, DOC_C.name].sort());
  });

  test("nulla da elaborare: nessun pending -> 0 sorgenti", async () => {
    const report = await kbBuild({ kbId: KB2, mode: "auto", adapter: mock });
    assert.ok(report);
    assert.equal(report.totals.sources, 0);
  });

  test("documento modificato: solo quello viene rielaborato", async () => {
    await addSource({
      kbId: KB2,
      name: DOC_A.name,
      mime: "text/plain",
      text: `${DOC_A.text}\nNota aggiunta per test changed.`,
    });
    const pending = (await listSources(KB2)).filter((r) => isPending(r));
    assert.equal(pending.length, 1);
    assert.equal(pending[0].name, DOC_A.name);
    const report = await kbBuild({ kbId: KB2, mode: "auto", adapter: mock });
    assert.equal(report.totals.sources, 1);
  });
});

describe("cancellazione senza toccare le pagine", () => {
  const KB3 = `test-maint-${Date.now()}`;

  test("eliminazione singolo documento: testo liberato, pagine intatte e interrogabili", async () => {
    await kbInit({ kbId: KB3 });
    await addSource({ kbId: KB3, name: DOC_A.name, mime: "text/plain", text: DOC_A.text });
    await addSource({ kbId: KB3, name: DOC_B.name, mime: "text/plain", text: DOC_B.text });
    await kbBuild({ kbId: KB3, mode: "auto", adapter: mock });
    const pagesBefore = (await kbStatus({ kbId: KB3 })).counts.pages;
    assert.ok(pagesBefore > 0);
    const target = (await listSources(KB3)).find((r) => r.name === DOC_A.name);
    const del = await deleteSource(KB3, target.sourceId);
    assert.ok(del);
    assert.deepEqual(del, { removedPages: 0, updatedPages: 0 });
    // Le pagine restano: la KB resta interrogabile
    const status = await kbStatus({ kbId: KB3 });
    assert.equal(status.counts.pages, pagesBefore, "pagine rimosse dalla cancellazione");
    // Invariante I3 verificata: record sorgente esistente (tombstone)
    const i3 = status.invariants.find((v) => v.id === "I3");
    assert.ok(i3 && i3.ok, "I3 non verificata dopo cancellazione");
    // Il documento esce dagli elenchi (nomi, doclist ingested)
    const sources = await listSources(KB3);
    const tombstone = sources.find((r) => r.sourceId === target.sourceId);
    assert.equal(tombstone.status, "deleted");
    assert.equal(tombstone.text, null);
    const doclist = sources.filter((r) => r.status === "ingested").map((r) => r.name);
    assert.ok(!doclist.includes(DOC_A.name), "documento rimosso ancora in doclist");
    assert.ok(doclist.includes(DOC_B.name));
  });

  test("build ignora le tombstone in ogni modo (auto e full)", async () => {
    const autoReport = await kbBuild({ kbId: KB3, mode: "auto", adapter: mock });
    assert.equal(autoReport.totals.sources, 0, "tombstone selezionata in auto");
    const fullReport = await kbBuild({ kbId: KB3, mode: "full", adapter: mock });
    const touched = (fullReport.sources || []).map((s) => s.sourceId);
    assert.ok(!touched.includes((await listSources(KB3)).find((r) => r.status === "deleted").sourceId), "tombstone selezionata in full");
  });

  test("ricaricamento dopo cancellazione: riattiva sullo stesso sourceId", async () => {
    const tombstone = (await listSources(KB3)).find((r) => r.status === "deleted");
    const revived = await addSource({ kbId: KB3, name: DOC_A.name, mime: "text/plain", text: DOC_A.text });
    assert.ok(revived);
    assert.equal(revived.sourceId, tombstone.sourceId, "sourceId non conservato");
    assert.ok(revived.changed, "riattivazione non marcata da elaborare");
    assert.equal(revived.status, "changed");
    const pending = (await listSources(KB3)).filter((r) => isPending(r));
    assert.ok(pending.some((r) => r.name === DOC_A.name));
  });

  test("KB resta interrogabile dopo la cancellazione", async () => {
    const res = await kbQuery({ kbId: KB3, question: "massoneria", mode: "offline", adapter: mock });
    assert.ok(res);
    assert.ok(res.pagesUsed.length > 0, "pagine scomparse dopo cancellazione documenti");
    assert.equal(res.missing, false);
  });

  test("export/import replace: doclist filtrata ai soli ingested", async () => {
    const KB4 = `test-imp-${Date.now()}`;
    await kbInit({ kbId: KB4 });
    await addSource({ kbId: KB4, name: DOC_A.name, mime: "text/plain", text: DOC_A.text });
    await addSource({ kbId: KB4, name: DOC_B.name, mime: "text/plain", text: DOC_B.text });
    await kbBuild({ kbId: KB4, mode: "auto", adapter: mock });
    // Rende B pending senza rielaborarlo
    await addSource({ kbId: KB4, name: DOC_B.name, mime: "text/plain", text: `${DOC_B.text}\nModifica.` });
    const bundle = await kbExport({ kbId: KB4, includeLogs: false });
    assert.ok(bundle);
    const KB5 = `test-imp2-${Date.now()}`;
    await kbInit({ kbId: KB5 });
    const ok = await kbImport({ kbId: KB5, bundle, mode: "replace" });
    assert.equal(ok, true);
    // Logica UI di task 2.2: doclist = solo ingested del bundle
    const doclist = bundle.sources.filter((r) => r.status === "ingested").map((r) => r.name);
    assert.ok(doclist.includes(DOC_A.name));
    assert.ok(!doclist.includes(DOC_B.name), "B pending non deve entrare in doclist");
    const status = await kbStatus({ kbId: KB5 });
    assert.ok(status);
  });
});
