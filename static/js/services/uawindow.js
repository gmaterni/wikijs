/**
 * uawindow.js — Amministratore di finestre fluttuanti.
 *
 * Gestisce creazione, posizionamento, ciclo di vita e
 * trascinamento di finestre DOM fluttuanti.
 *
 * @module  UaWindowAdm
 * @version 1.0.0
 * @date    2026-06-16
 */

/** @format */
"use strict";

import { UaDrag } from "./uadrag.js";

const UaWindowAdm = {
  ws: {},

  create(id, parent_id = null) {
    let w = document.getElementById(id);
    if (!w) {
      w = document.createElement("div");
      if (!parent_id) {
        document.body.appendChild(w);
      } else {
        document.getElementById(parent_id).appendChild(w);
      }
      w.id = id;
      w.setAttribute("data-name", "ua-window");
      const uaw = this.newUaWindow(w);
      this.ws[id] = uaw;
    }
    const uaw = this.ws[id];
    w.style.display = "none";
    return uaw;
  },

  get(id) {
    if (!this.ws[id]) {
      return null;
    }
    const w = this.ws[id];
    return w;
  },

  show(id) {
    if (!!this.ws[id]) {
      this.ws[id].show();
    }
  },

  close(id) {
    if (!!this.ws[id]) {
      this.ws[id].close();
    }
  },

  toggle(id) {
    if (!!this.ws[id]) {
      this.ws[id].toggle();
    }
  },

  hide(id) {
    if (!!this.ws[id]) {
      this.ws[id].hide();
    }
  },

  closeThis(e) {
    const ancestor = e.closest('[data-name="ua-window"]');
    const id = ancestor.id;
    this.ws[id].close();
  },

  showAll() {
    for (const k in this.ws) {
      this.ws[k].show();
    }
  },

  hideAll() {
    for (const k in this.ws) {
      this.ws[k].hide();
    }
  },

  closeAll() {
    for (const k in this.ws) {
      this.ws[k].close();
    }
  },

  remove(id) {
    if (!this.ws[id]) {
      return;
    }
    document.getElementById(id).remove();
    this.ws[id] = null;
    delete this.ws[id];
  },

  removeAll() {
    const ids = Object.keys(this.ws);
    for (const id of ids) {
      this.remove(id);
    }
  },

  newUaWindow(jqw) {
    const wnd = {
      initialize(w) {
        this.w = w;
        this.wx = "0px";
        this.wy = "0px";
        this.isOpen = false;
        this.isVisible = false;
        this.firstShow = true;
        this.pos = 0;
        this.wz = 0;
        this.vw = "px";
        this.vh = "px";
      },

      vw_vh() {
        this.vw = "vw";
        this.vh = "vh";
        return this;
      },

      addClassStyle(className) {
        if (!this.w.classList.contains(className)) {
          this.w.classList.add(className);
        }
        return this;
      },

      removeClassStyle(className) {
        if (this.w.classList.contains(className)) {
          this.w.classList.remove(className);
        }
        return this;
      },

      getWindow() {
        const r = this.w;
        return r;
      },

      getElement() {
        const r = this.w;
        return r;
      },

      getId() {
        const r = this.w.id;
        return r;
      },

      setStyle(styles) {
        for (const prop in styles) {
          if (!Object.prototype.hasOwnProperty.call(styles, prop)) {
            continue;
          }
          this.w.style[prop] = styles[prop];
        }
        return this;
      },

      setHtml(content) {
        if (content instanceof HTMLElement) {
          this.w.innerHTML = "";
          this.w.appendChild(content);
        } else {
          this.w.innerHTML = content;
        }
        return this;
      },

      getHtml() {
        const r = this.w.innerHTML;
        return r;
      },

      setXY(x, y, pos = 0) {
        this.wx = x;
        this.wy = y;
        this.pos = pos;
        return this;
      },

      setCenterY(y, pos) {
        const xd = window.innerWidth;
        const wd = this.w.clientWidth;
        const x = (xd - wd) / 2;
        this.setXY(x, y, pos);
        return this;
      },

      setCenter(pos) {
        const xd = window.innerWidth;
        const yd = window.innerHeight;
        const wd = this.w.clientWidth;
        const wh = this.w.clientHeight;
        const x = (xd - wd) / 2;
        const y = (yd - wh) / 2;
        this.setXY(x, y, pos);
        return this;
      },

      linkToId(linked_id, dx, dy, pos) {
        const lk = document.getElementById(linked_id);
        this.linkToElement(lk, dx, dy, pos);
        return this;
      },

      linkToElement(elm, dx, dy, pos) {
        const x = elm.offsetLeft + elm.offsetWidth + dx;
        let y = elm.offsetTop + dy;
        if (y < 0) {
          y = 0;
        }
        this.setXY(x, y, pos);
        return this;
      },

      setZ(z) {
        this.wz = z;
        return this;
      },

      reset() {
        this.firstShow = true;
        return this;
      },

      toggle() {
        if (!this.isVisible) {
          this.show();
        } else {
          this.hide();
        }
        return this;
      },

      show() {
        if (this.firstShow || this.pos === 1 || (this.pos === 0 && this.isVisible === false)) {
          this.w.style.position = "absolute";
          this.w.style.marginLeft = 0;
          this.w.style.marginTop = 0;
          const topVal = `${this.wy}${this.vh}`;
          this.w.style.top = topVal;
          if (this.wx >= 0) {
            const leftVal = `${this.wx}${this.vw}`;
            this.w.style.left = leftVal;
          } else {
            const absX = -this.wx;
            const rightVal = `${absX}${this.vw}`;
            this.w.style.right = rightVal;
          }
          if (this.wz > 0) {
            this.w.style.zIndex = this.wz;
          }
        }
        this.w.style.display = "";
        this.firstShow = false;
        this.isVisible = true;
        this.isOpen = true;
        return this;
      },

      hide() {
        this.w.style.display = "none";
        this.isVisible = false;
        return this;
      },

      close() {
        this.w.style.display = "none";
        this.w.innerHTML = "";
        this.isOpen = false;
        return this;
      },

      remove() {
        const id = this.w.id;
        UaWindowAdm.remove(id);
        return null;
      },

      drag() {
        UaDrag(this.w);
        return this;
      },
    };

    wnd.initialize(jqw);
    return wnd;
  },
};

export { UaWindowAdm };
