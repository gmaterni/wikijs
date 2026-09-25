/**
 * uajtfh.js — Joint Text From Hierarchy: builder testuale concatenabile.
 *
 * Utility per costruire stringhe o frammenti HTML in modo ordinato.
 * Alternativa a concatenazioni complesse e template literal annidati.
 *
 * @module  UaJtfh
 * @version 1.0.0
 * @date    2026-06-16
 */

/** @format */
"use strict";

const UaJtfh = function() {
  const _rows = [];

  const init = function() {
    _rows.length = 0;
    return api;
  };

  const insert = function(s) {
    _rows.unshift(s);
    return api;
  };

  const append = function(s) {
    _rows.push(s);
    return api;
  };

  const text = function(ln = "") {
    const r = _rows.join(ln);
    return r;
  };

  const html = function(ln = "") {
    const r = _rows.join(ln).replace(/\s+|\[rn\]/g, " ");
    return r;
  };

  const api = {
    rows: _rows,
    init: init,
    insert: insert,
    append: append,
    text: text,
    html: html,
  };

  return api;
};

export { UaJtfh };
