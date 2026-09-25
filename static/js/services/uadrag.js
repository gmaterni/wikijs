/**
 * uadrag.js — Abilita trascinamento con mouse su elementi DOM.
 *
 * @module  UaDrag
 * @version 1.0.0
 * @date    2026-06-16
 */

/** @format */
"use strict";

const nodrag_tds = ["input", "select", "a"];
const nodrag_cls = "nodrag";

const UaDrag = function(e) {
  const drag = function(element) {
    let pos1 = 0;
    let pos2 = 0;
    let pos3 = 0;
    let pos4 = 0;

    const dragMouseDown = function(e) {
      e = e || window.event;
      let t = e.target;
      t = t || null;
      if (!t) {
        return;
      }
      if (nodrag_tds.includes(t.tagName.toLowerCase())) {
        return;
      }
      if (t.classList.contains(nodrag_cls)) {
        return;
      }
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    };

    const elementDrag = function(e) {
      e = e || window.event;
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      const top = element.offsetTop - pos2 + "px";
      const left = element.offsetLeft - pos1 + "px";
      element.style.top = top;
      element.style.left = left;
    };

    const closeDragElement = function() {
      document.onmouseup = null;
      document.onmousemove = null;
    };

    element.onmousedown = dragMouseDown;
  };

  const r = drag(e);
  return r;
};

export { UaDrag };
