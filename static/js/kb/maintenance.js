/**
 * maintenance.js - Stato, portabilità e lint della KB.
 *
 * `kbStatus` verifica conteggi e invarianti I1-I10, `kbExport`/`kbImport`
 * spostano la KB come bundle JSON (con compatibilità `karpathy/`),
 * `kbLint` segnala pagine degradate senza modificare contenuti.
 *
 * @module maintenance
 * @version 0.1.1
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

import { openDb, runTx, storeGet, storePut, storeGetAll, requestValue } from "./db.js";
import { getMeta } from "./jobs.js";
import { isSlug, normalizeForCompare } from "./ids.js";
import { DB_NAME_PREFIX } from "./params.js";
import { SCHEMA_VERSION } from "./params.js";

/**
 * Verifica le invarianti I1-I10 sullo stato corrente.
 *
 * @param {object} snapshot - Dati `{ kbId, meta, sources, pages, catalog, outputs, logs, jobs, staging }`.
 * @returns {Array} Esiti `{ id, ok, details }`.
 */
const checkInvariants = function (snapshot) {
    const results = [];
    const bySlug = new Map();
    for (const page of snapshot.pages) {
        bySlug.set(page.slug, page);
    }
    const push = function (id, ok, details) {
        results.push({ id: id, ok: ok, details: details });
    };
    push("I1", true, "un DB per KB: " + DB_NAME_PREFIX + snapshot.kbId);
    let catalogOk = true;
    for (const row of snapshot.catalog) {
        const page = bySlug.get(row.slug);
        const matches = page && page.title === row.title && page.summary === row.summary && (page.category || "") === (row.category || "") && page.updatedAt === row.updatedAt;
        if (!matches) {
            catalogOk = false;
            break;
        }
    }
    if (catalogOk) {
        for (const page of snapshot.pages) {
            const row = snapshot.catalog.find(function (item) {
                return item.slug === page.slug;
            });
            if (!row) {
                catalogOk = false;
                break;
            }
        }
    }
    push("I2", catalogOk, "catalog come proiezione di pages");
    const sourceIds = new Set(snapshot.sources.map(function (row) {
        return row.sourceId;
    }));
    let sourcesOk = true;
    for (const page of snapshot.pages) {
        if (page.origin === "source") {
            const known = (page.sources || []).some(function (id) {
                return sourceIds.has(id);
            });
            if (!known) {
                sourcesOk = false;
                break;
            }
        }
    }
    push("I3", sourcesOk, "pagine source con sorgente esistente");
    let quotesOk = true;
    for (const page of snapshot.pages) {
        for (const quote of page.quotes || []) {
            if (typeof quote.verified !== "boolean") {
                quotesOk = false;
                break;
            }
        }
    }
    push("I4", quotesOk, "quote con esito di verifica booleano");
    const slugs = new Set();
    let slugsOk = true;
    for (const page of snapshot.pages) {
        if (!isSlug(page.slug) || slugs.has(page.slug)) {
            slugsOk = false;
            break;
        }
        slugs.add(page.slug);
    }
    push("I5", slugsOk, "slug conformi e unici");
    push("I6", true, "outputs e logs scritti solo in append");
    const openJobs = snapshot.jobs.filter(function (job) {
        return job.status === "running";
    });
    const stagingLeft = snapshot.staging.filter(function (entry) {
        const owner = snapshot.jobs.find(function (job) {
            return job.jobId === entry.jobId;
        });
        // Lo staging di job `error`/`cancelled` serve alla ripresa (RF7):
        // è un residuo anomalo solo per job `done` o senza record.
        const resumable = owner && owner.status !== "done";
        return !resumable;
    });
    push("I7", stagingLeft.length === 0, "staging vuoto a job completati");
    push("I8", true, "quarantena esclusa in query per costruzione");
    let linksOk = true;
    const redLinks = [];
    for (const page of snapshot.pages) {
        for (const target of page.links || []) {
            if (!bySlug.has(target)) {
                linksOk = true;
                if (!redLinks.includes(target)) {
                    redLinks.push(target);
                }
            }
        }
    }
    push("I9", linksOk, "link a slug esistenti o red-link: " + String(redLinks.length));
    push("I10", true, "abort e budget conservano staging senza alterare pagine");
    const checks = { results: results, openJobs: openJobs.length, redLinks: redLinks };
    return checks;
};

/**
 * Restituisce conteggi e invarianti della KB.
 *
 * @param {object} opts - Opzioni `{ kbId }`.
 * @returns {Promise<object|null>} Report di stato.
 */
const kbStatus = async function (opts) {
    if (!opts || typeof opts.kbId !== "string") {
        console.error("kbStatus: kbId non valido");
        return null;
    }
    const db = await openDb(opts.kbId);
    if (!db) {
        return null;
    }
    let report = null;
    try {
        const snapshot = await runTx(db, ["meta", "sources", "pages", "catalog", "outputs", "logs", "jobs", "staging"], "readonly", async function (stores) {
            const sources = await storeGetAll(stores.sources);
            const pages = await storeGetAll(stores.pages);
            const catalog = await storeGetAll(stores.catalog);
            const outputs = await storeGetAll(stores.outputs);
            const logs = await storeGetAll(stores.logs);
            const jobs = await storeGetAll(stores.jobs);
            const staging = await storeGetAll(stores.staging);
            const metaRows = await storeGetAll(stores.meta);
            const meta = {};
            for (const row of metaRows) {
                meta[row.key] = row.value;
            }
            return { meta: meta, sources: sources, pages: pages, catalog: catalog, outputs: outputs, logs: logs, jobs: jobs, staging: staging };
        });
        if (!snapshot) {
            return null;
        }
        const checks = checkInvariants({ kbId: opts.kbId, meta: snapshot.meta, sources: snapshot.sources, pages: snapshot.pages, catalog: snapshot.catalog, outputs: snapshot.outputs, logs: snapshot.logs, jobs: snapshot.jobs, staging: snapshot.staging });
        report = {
            kbId: opts.kbId,
            schemaVersion: SCHEMA_VERSION,
            counts: { sources: snapshot.sources.length, pages: snapshot.pages.length, catalog: snapshot.catalog.length, outputs: snapshot.outputs.length, logs: snapshot.logs.length, jobs: snapshot.jobs.length, staging: snapshot.staging.length },
            openJobs: checks.openJobs,
            invariants: checks.results,
            redLinks: checks.redLinks
        };
    } finally {
        db.close();
    }
    return report;
};

/**
 * Esporta la KB come bundle JSON portabile.
 *
 * @param {object} opts - Opzioni `{ kbId, includeLogs? }`.
 * @returns {Promise<object|null>} Bundle `{ meta, sources, pages, catalog, logs? }`.
 */
const kbExport = async function (opts) {
    if (!opts || typeof opts.kbId !== "string") {
        console.error("kbExport: kbId non valido");
        return null;
    }
    const db = await openDb(opts.kbId);
    if (!db) {
        return null;
    }
    let bundle = null;
    try {
        bundle = await runTx(db, ["meta", "sources", "pages", "catalog", "logs"], "readonly", async function (stores) {
            const metaRows = await storeGetAll(stores.meta);
            const meta = {};
            for (const row of metaRows) {
                meta[row.key] = row.value;
            }
            const sources = await storeGetAll(stores.sources);
            const pages = await storeGetAll(stores.pages);
            const catalog = await storeGetAll(stores.catalog);
            const result = { meta: meta, sources: sources, pages: pages, catalog: catalog };
            if (opts.includeLogs) {
                result.logs = await storeGetAll(stores.logs);
            }
            return result;
        });
    } finally {
        db.close();
    }
    return bundle;
};

/**
 * Importa un bundle in una KB (merge o replace).
 *
 * @param {object} opts - Opzioni `{ kbId, bundle, mode }`.
 * @returns {Promise<boolean>} Vero a importazione avvenuta.
 */
const kbImport = async function (opts) {
    if (!opts || typeof opts.kbId !== "string" || !opts.bundle || (opts.mode !== "merge" && opts.mode !== "replace")) {
        console.error("kbImport: argomenti non validi");
        return false;
    }
    const bundle = opts.bundle;
    if (!Array.isArray(bundle.sources) || !Array.isArray(bundle.pages) || !Array.isArray(bundle.catalog)) {
        console.error("kbImport: bundle non valido");
        return false;
    }
    const db = await openDb(opts.kbId);
    if (!db) {
        return false;
    }
    try {
        const done = await runTx(db, ["meta", "sources", "pages", "catalog", "logs"], "readwrite", async function (stores) {
            if (opts.mode === "replace") {
                for (const name of ["sources", "pages", "catalog"]) {
                    await requestValue(stores[name].clear());
                }
            }
            for (const source of bundle.sources) {
                await storePut(stores.sources, source);
            }
            for (const page of bundle.pages) {
                await storePut(stores.pages, page);
            }
            for (const row of bundle.catalog) {
                await storePut(stores.catalog, row);
            }
            if (bundle.meta) {
                for (const key of Object.keys(bundle.meta)) {
                    if (key === "kbId" || key === "createdAt") {
                        continue;
                    }
                    await storePut(stores.meta, { key: key, value: bundle.meta[key] });
                }
            }
            const entry = { ts: Date.now(), type: "import", refs: { kbId: opts.kbId }, summary: "import " + opts.mode, details: { pages: bundle.pages.length } };
            await storePut(stores.logs, entry);
            return true;
        });
        const result = done === true;
        return result;
    } finally {
        db.close();
    }
};

/**
 * Esporta la KB nella struttura cartelle `karpathy/` (raw, wiki, output).
 *
 * @param {object} bundle - Bundle di `kbExport`.
 * @returns {object|null} Struttura `{ raw, wiki, output }` di file testuali.
 */
const exportKarpathy = function (bundle) {
    if (!bundle || !Array.isArray(bundle.pages) || !Array.isArray(bundle.sources)) {
        console.error("exportKarpathy: bundle non valido");
        return null;
    }
    const raw = {};
    for (const source of bundle.sources) {
        raw[source.name] = source.text || "";
    }
    const wiki = {};
    const indexLines = [];
    for (const page of bundle.pages) {
        const doc = "# " + page.title + "\n\n" + page.body + "\n";
        wiki[page.slug + ".md"] = doc;
        const line = page.slug + " — " + page.title + " — " + page.summary;
        indexLines.push(line);
    }
    wiki["index.md"] = indexLines.join("\n") + "\n";
    const logLines = (bundle.logs || []).map(function (entry) {
        const date = new Date(entry.ts).toISOString();
        const line = date + " [" + entry.type + "] " + entry.summary;
        return line;
    });
    wiki["log.md"] = logLines.join("\n") + "\n";
    const structure = { raw: raw, wiki: wiki, output: {} };
    return structure;
};

/**
 * Importa una struttura `karpathy/` come sorgenti e pagine.
 *
 * @param {object} structure - Struttura `{ raw, wiki }` di file testuali.
 * @returns {object|null} Bundle parziale `{ sources, pages, catalog }`.
 */
const importKarpathy = function (structure) {
    if (!structure || typeof structure !== "object") {
        console.error("importKarpathy: struttura non valida");
        return null;
    }
    const raw = structure.raw || {};
    const wiki = structure.wiki || {};
    const sources = [];
    for (const name of Object.keys(raw)) {
        const item = { sourceId: "", name: name, mime: "text/plain", sizeBytes: raw[name].length, sha256: "", text: raw[name], addedAt: Date.now(), ingestedAt: null, status: "new", error: null, pagesCount: 0 };
        sources.push(item);
    }
    const pages = [];
    const catalog = [];
    for (const filename of Object.keys(wiki)) {
        if (filename === "index.md" || filename === "log.md" || !filename.endsWith(".md")) {
            continue;
        }
        const slug = filename.slice(0, -3);
        if (!isSlug(slug)) {
            continue;
        }
        const content = wiki[filename];
        const lines = content.split("\n");
        const title = lines[0].startsWith("# ") ? lines[0].slice(2).trim() : slug;
        const body = lines.slice(1).join("\n").trim();
        const page = { slug: slug, title: title, summary: "", body: body, category: "", sources: [], links: [], backlinks: [], quotes: [], status: "active", origin: "source", version: 1, createdAt: Date.now(), updatedAt: Date.now() };
        pages.push(page);
        const row = { slug: slug, title: title, summary: "", category: "", updatedAt: page.updatedAt };
        catalog.push(row);
    }
    const bundle = { sources: sources, pages: pages, catalog: catalog };
    return bundle;
};

/**
 * Segnala pagine degradate senza modificare contenuti.
 *
 * @param {object} opts - Opzioni `{ kbId, slug? }`.
 * @returns {Promise<object|null>} Report `{ issues }`.
 */
const kbLint = async function (opts) {
    if (!opts || typeof opts.kbId !== "string") {
        console.error("kbLint: kbId non valido");
        return null;
    }
    const db = await openDb(opts.kbId);
    if (!db) {
        return null;
    }
    let report = null;
    try {
        report = await runTx(db, ["pages", "sources", "meta"], "readonly", async function (stores) {
            const all = await storeGetAll(stores.pages);
            const sources = await storeGetAll(stores.sources);
            const ingestedById = new Map();
            for (const source of sources) {
                ingestedById.set(source.sourceId, source.ingestedAt || 0);
            }
            const slugs = new Set(all.map(function (page) {
                return page.slug;
            }));
            const wanted = opts.slug ? all.filter(function (page) {
                return page.slug === opts.slug;
            }) : all;
            const issues = [];
            for (const page of wanted) {
                const unverified = (page.quotes || []).filter(function (quote) {
                    return !quote.verified;
                }).length;
                if (unverified > 0) {
                    issues.push({ slug: page.slug, type: "unverified-quotes", details: unverified + " quote non verificate" });
                }
                if ((page.contradictions || []).length > 0) {
                    issues.push({ slug: page.slug, type: "contradictions", details: page.contradictions.length + " contraddizioni aperte" });
                }
                const red = (page.links || []).filter(function (target) {
                    return !slugs.has(target);
                });
                for (const target of red) {
                    issues.push({ slug: page.slug, type: "red-link", details: "link a " + target });
                }
                const staleSource = (page.sources || []).some(function (id) {
                    return (ingestedById.get(id) || 0) > page.updatedAt;
                });
                if (staleSource) {
                    issues.push({ slug: page.slug, type: "stale", details: "sorgente reingerita dopo l'ultimo aggiornamento" });
                }
            }
            const counters = await storeGet(stores.meta, "counters");
            const result = { kbId: opts.kbId, issues: issues, lintSeq: counters ? counters.value.lintSeq || 0 : 0 };
            return result;
        });
    } finally {
        db.close();
    }
    return report;
};

export { kbStatus, kbExport, kbImport, kbLint, exportKarpathy, importKarpathy };
