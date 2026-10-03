/**
 * api.js - Facciata dell'API pubblica WikiJS.
 *
 * Wrapper 1:1 esposti anche come comandi UI/console. `kbUpdate` è un
 * alias documentato di `kbBuild` con `mode:"update"`, mai un motore
 * separato.
 *
 * @module api
 * @version 0.1.2
 * @date 2026-09-25
 * @author WikiJS
 */

"use strict";

import { kbInit } from "./lifecycle.js";
import { addSource, kbBuild } from "./build.js";
import { kbQuery } from "./query.js";
import { kbStatus, kbExport, kbImport, kbLint } from "./maintenance.js";

/**
 * Alias di `kbBuild` con `mode:"update"`.
 *
 * @param {object} opts - Stesse opzioni di `kbBuild`.
 * @returns {Promise<object|null>} Report di build.
 */
const kbUpdate = async function (opts) {
    if (!opts || typeof opts !== "object") {
        console.error("kbUpdate: opzioni non valide");
        return null;
    }
    const merged = Object.assign({}, opts, { mode: "update" });
    const report = await kbBuild(merged);
    return report;
};

export { kbInit, addSource, kbBuild, kbUpdate, kbQuery, kbStatus, kbExport, kbImport, kbLint };
