/**
 * Zweihander — zh-filter
 * Filter, search, sort and paginate Webflow CMS lists. No dependencies.
 *
 * Markup:
 *   <!-- The list: on the Collection List (or its wrapper) -->
 *   <div zh-filter="agenda" zh-filter-limit="9">
 *     <div class="w-dyn-item">
 *       <h3 zh-filter-field="titel">Baltz</h3>
 *       <div zh-filter-field="categorie">Acteur</div>
 *       <div zh-filter-field="datum">05/11/2025</div>
 *     </div>
 *   </div>
 *
 *   <!-- Controls: anywhere, linked by zh-filter-controls / zh-filter-target,
 *        or automatically when there's only one list on the page -->
 *   <form zh-filter-controls="agenda">
 *     <input zh-filter-search placeholder="Zoek">
 *     <a zh-filter-by="categorie" zh-filter-value="">Alles</a>
 *     <a zh-filter-by="categorie">Acteur <span zh-filter-facet></span></a>
 *     <label><input type="checkbox" zh-filter-by="opleiding"> Productie</label>
 *     <select zh-filter-by="locatie">…</select>
 *     <select zh-filter-sort><option value="datum-asc">Datum</option></select>
 *     <a zh-filter-reset>Wis filters</a>
 *   </form>
 *   <p><span zh-filter-results></span> van <span zh-filter-total></span></p>
 *   <div zh-filter-empty>Niets gevonden</div>
 *   <a zh-filter-more>Toon meer</a>
 *
 * Within a field, chosen values are OR; across fields, AND.
 * Chosen filters are kept in the URL (?categorie=acteur&q=bang) so a
 * filtered view can be shared. Lists paginated by Webflow are loaded in
 * full first, so filtering covers every item.
 *
 * Classes: is-active on chosen chips/labels/sort buttons, is-empty on
 * options with no results, is-disabled on reset/prev/next when inert,
 * is-filtered / is-no-results / is-loading on the list.
 */

// ES module — loaded by zweihander.js loader

var ATTR = {
  root: "zh-filter",
  item: "zh-filter-item",
  field: "zh-filter-field",
  value: "zh-filter-value",
  type: "zh-filter-type",
  split: "zh-filter-split",
  controls: "zh-filter-controls",
  target: "zh-filter-target",
  by: "zh-filter-by",
  multi: "zh-filter-multi",
  search: "zh-filter-search",
  sort: "zh-filter-sort",
  reset: "zh-filter-reset",
  more: "zh-filter-more",
  page: "zh-filter-page",
  pagination: "zh-filter-pagination",
  limit: "zh-filter-limit",
  results: "zh-filter-results",
  total: "zh-filter-total",
  empty: "zh-filter-empty",
  facet: "zh-filter-facet",
  url: "zh-filter-url",
  loadAll: "zh-filter-load-all",
  announce: "zh-filter-announce",
};

var CONTROL_SELECTOR = [
  ATTR.by, ATTR.search, ATTR.sort, ATTR.reset, ATTR.more, ATTR.page,
  ATTR.pagination, ATTR.results, ATTR.total, ATTR.empty,
].map(function (a) { return "[" + a + "]"; }).join(", ");

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────
function attr(el, name, fallback) {
  if (!el || !el.hasAttribute(name)) return fallback;
  var raw = el.getAttribute(name);
  return raw === null || raw === "" ? fallback : raw;
}
function attrBool(el, name, fallback) {
  var v = attr(el, name, null);
  if (v === null) return el && el.hasAttribute(name) ? true : fallback;
  return v === "true" || v === "1";
}

// Compare text the way people expect: no case, no accents, single spaces.
function norm(s) {
  s = String(s == null ? "" : s);
  if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// Text of an element without the text of any facet counter inside it.
function ownText(el) {
  var out = "";
  (function walk(node) {
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) out += c.nodeValue;
      else if (c.nodeType === 1 && !c.hasAttribute(ATTR.facet) && !/^(SCRIPT|STYLE|INPUT|SELECT)$/.test(c.tagName)) walk(c);
    }
  })(el);
  // "Acteur (<facet>)" leaves "Acteur ()": drop the empty brackets and
  // separators that only framed the counter.
  return out.replace(/[(\[{]\s*[)\]}]/g, "").replace(/\s+/g, " ").replace(/^[\s·•|:\-–—]+|[\s·•|:\-–—]+$/g, "").trim();
}

function setHidden(el, hidden) {
  if (hidden) {
    if (el.__zhFilterDisplay === undefined) el.__zhFilterDisplay = el.style.display;
    el.style.display = "none";
  } else if (el.__zhFilterDisplay !== undefined) {
    el.style.display = el.__zhFilterDisplay;
    delete el.__zhFilterDisplay;
  }
}
function isHidden(el) { return el.__zhFilterDisplay !== undefined; }

function reducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function toArray(list) { return Array.prototype.slice.call(list || []); }

// Elements matching selector that belong to this root, not to a nested one.
function scoped(root, selector, rootAttr) {
  return toArray(root.querySelectorAll(selector)).filter(function (el) {
    var p = el.parentElement;
    while (p && p !== root) {
      if (p.hasAttribute(rootAttr)) return false;
      p = p.parentElement;
    }
    return true;
  });
}

// ── Values for sorting ─────────────────────────────────────────────────────
var MONTHS = {
  jan: 0, januari: 0, january: 0, feb: 1, februari: 1, february: 1,
  mrt: 2, maart: 2, mar: 2, march: 2, apr: 3, april: 3, mei: 4, may: 4,
  jun: 5, juni: 5, june: 5, jul: 6, juli: 6, july: 6, aug: 7, augustus: 7,
  august: 7, sep: 8, sept: 8, september: 8, okt: 9, oktober: 9, oct: 9,
  october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

// Dates as Webflow tends to print them: 2025-11-05, 05/11/2025 (day
// first), 5 november 2025, Nov 5, 2025. Text after the date (a range,
// a time) is ignored. loose = also try the browser's own parser.
function parseDate(raw, loose) {
  var s = norm(raw), m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return Date.UTC(+m[1], m[2] - 1, +m[3]);
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/))) return Date.UTC(+m[3], m[2] - 1, +m[1]);
  if ((m = s.match(/(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})/)) && MONTHS[m[2]] != null) return Date.UTC(+m[3], MONTHS[m[2]], +m[1]);
  if ((m = s.match(/([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/)) && MONTHS[m[1]] != null) return Date.UTC(+m[3], MONTHS[m[1]], +m[2]);
  if (loose) {
    var t = Date.parse(raw);
    if (!isNaN(t)) return t;
  }
  return null;
}

// 12, 12.5, 12,50, € 1.250,00, 1,250.00
function parseNumber(raw) {
  var s = String(raw).replace(/[^\d,.\-]/g, "");
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseSort(v) {
  v = String(v || "").trim();
  if (!v) return null;
  var m = v.match(/^(.*?)[-_ ](asc|desc)$/i);
  if (m) return { field: m[1], dir: m[2].toLowerCase(), explicit: true };
  return { field: v, dir: "asc", explicit: false };
}

var collator = window.Intl && Intl.Collator ? new Intl.Collator("nl", { numeric: true, sensitivity: "base" }) : null;
function compareText(a, b) { return collator ? collator.compare(a, b) : (a < b ? -1 : a > b ? 1 : 0); }

// Visually hidden live region so screen readers hear the new result count.
var liveRegion = null;
function announce(text) {
  if (!liveRegion) {
    liveRegion = document.createElement("div");
    liveRegion.setAttribute("role", "status");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
    document.body.appendChild(liveRegion);
  }
  liveRegion.textContent = "";
  setTimeout(function () { liveRegion.textContent = text; }, 50);
}

// ───────────────────────────────────────────────────────────────────────────
// FilterList (one per [zh-filter])
// ───────────────────────────────────────────────────────────────────────────
var instances = [];

function FilterList(root) {
  this.root = root;
  this.name = root.getAttribute(ATTR.root) || "";
  // Works on the Collection List itself or on its wrapper.
  this.container = root.classList.contains("w-dyn-items") ? root : (root.querySelector(".w-dyn-items") || root);
  this.limit = parseInt(attr(root, ATTR.limit, "0"), 10) || 0;
  this.useUrl = attrBool(root, ATTR.url, true);
  this.announceTpl = attr(root, ATTR.announce, null);

  this.state = { fields: {}, text: {}, textRaw: {}, search: "", searchRaw: "", sort: null, page: 1, shown: this.limit };
  this.controls = [];
  this.multi = {};         // field → multiple values allowed
  this.textFields = {};    // fields filtered by a text input
  this.fieldTypes = {};    // field → zh-filter-type from item fields
  this.sortTypes = {};     // field → zh-filter-type from a sort control
  this.searchFields = null;
  this.paging = "more";
  this.items = [];
  this._seq = 0;
  this._orderKey = "";

  this._readItems();
  root.__zhFilter = this;
}

// ── Items ──────────────────────────────────────────────────────────────────
FilterList.prototype._itemElements = function () {
  var marked = scoped(this.container, "[" + ATTR.item + "]", ATTR.root);
  if (marked.length) return marked;
  return toArray(this.container.children).filter(function (el) {
    return !/^(SCRIPT|STYLE|TEMPLATE)$/.test(el.tagName);
  });
};

FilterList.prototype._readItems = function () {
  var self = this;
  this.items = this._itemElements().map(function (el) {
    if (el.__zhFilterIndex === undefined) el.__zhFilterIndex = self._seq++;
    var fields = {}, raw = {};
    toArray(el.querySelectorAll("[" + ATTR.field + "]")).forEach(function (f) {
      var name = f.getAttribute(ATTR.field);
      if (!name) return;
      if (f.hasAttribute(ATTR.type) && !self.fieldTypes[name]) self.fieldTypes[name] = norm(f.getAttribute(ATTR.type));
      var v = f.hasAttribute(ATTR.value) ? f.getAttribute(ATTR.value) : f.textContent;
      var parts = f.hasAttribute(ATTR.split) ? String(v).split(f.getAttribute(ATTR.split) || ",") : [v];
      parts.forEach(function (p) {
        p = String(p).replace(/\s+/g, " ").trim();
        if (!p) return;
        (raw[name] = raw[name] || []).push(p);
        (fields[name] = fields[name] || []).push(norm(p));
      });
    });
    return { el: el, index: el.__zhFilterIndex, fields: fields, raw: raw, text: norm(el.textContent), keys: {} };
  });
  this._autoTypes = {};
};

// ── Controls ───────────────────────────────────────────────────────────────
function controlValue(el, input, label) {
  if (el.hasAttribute(ATTR.value)) return el.getAttribute(ATTR.value);
  if (input && input !== el && input.hasAttribute(ATTR.value)) return input.getAttribute(ATTR.value);
  if (label && label !== el && label.hasAttribute(ATTR.value)) return label.getAttribute(ATTR.value);
  if (input && input.value && input.value !== "on") return input.value;
  return ownText(label || el);
}

// Webflow builds most clickable things as links or divs. Make them behave
// as buttons for keyboard and screen reader users.
function makePressable(el) {
  if (el.tagName === "BUTTON") return;
  if (!el.hasAttribute("role")) el.setAttribute("role", "button");
  if (!el.hasAttribute("tabindex") && !(el.tagName === "A" && el.hasAttribute("href"))) el.setAttribute("tabindex", "0");
  el.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
  });
}

FilterList.prototype._bind = function (el) {
  var self = this;
  if (el.__zhFilterBound && el.__zhFilterBound.indexOf(this) !== -1) return;
  (el.__zhFilterBound = el.__zhFilterBound || []).push(this);
  var c = { el: el };

  if (el.hasAttribute(ATTR.by)) {
    var field = el.getAttribute(ATTR.by);
    c.field = field;
    // The attribute may sit on a Webflow checkbox/radio field (the label)
    // instead of on the input itself.
    var input = el;
    if (el.tagName !== "INPUT" && el.tagName !== "SELECT" && el.tagName !== "TEXTAREA") {
      input = el.querySelector("input[type=checkbox], input[type=radio]") || null;
    }
    var type = input ? (input.type || "").toLowerCase() : "";
    if (el.tagName === "SELECT") c.kind = "select";
    else if (input && (type === "checkbox" || type === "radio")) c.kind = type;
    else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") c.kind = "text";
    else c.kind = "chip";
    c.input = input;
    c.label = c.kind === "checkbox" || c.kind === "radio" ? (input.closest("label") || el) : el;
    c.facets = toArray((c.kind === "chip" ? el : c.label).querySelectorAll("[" + ATTR.facet + "]"));

    if (c.kind === "checkbox" || c.kind === "radio" || c.kind === "chip") {
      var rawValue = controlValue(el, input, c.label);
      c.isAll = norm(rawValue) === "";
      c.value = norm(rawValue);
    }
    var wrap = el.closest("[" + ATTR.controls + "]");
    if (c.kind === "checkbox" || attrBool(el, ATTR.multi, false) || attrBool(wrap, ATTR.multi, false)) this.multi[field] = true;
    if (c.kind === "text") this.textFields[field] = true;

    if (c.kind === "checkbox") {
      input.addEventListener("change", function () {
        if (c.isAll) self._setField(field, []);
        else self._toggle(field, c.value, input.checked);
        self._changed();
      });
    } else if (c.kind === "radio") {
      input.addEventListener("change", function () {
        if (!input.checked) return;
        self._setField(field, c.isAll ? [] : [c.value]);
        self._changed();
      });
    } else if (c.kind === "select") {
      el.addEventListener("change", function () {
        var v = norm(el.value);
        self._setField(field, v ? [v] : []);
        self._changed();
      });
    } else if (c.kind === "text") {
      var t;
      el.addEventListener("input", function () {
        clearTimeout(t);
        t = setTimeout(function () {
          self.state.textRaw[field] = el.value;
          self.state.text[field] = norm(el.value);
          self._changed();
        }, 150);
      });
    } else {
      makePressable(el);
      if (!el.hasAttribute("aria-pressed")) el.setAttribute("aria-pressed", "false");
      el.addEventListener("click", function (e) {
        e.preventDefault();
        var cur = self.state.fields[field] || [];
        if (c.isAll) self._setField(field, []);
        else if (self.multi[field]) self._toggle(field, c.value, cur.indexOf(c.value) === -1);
        else self._setField(field, cur.length === 1 && cur[0] === c.value ? [] : [c.value]);
        self._changed();
      });
    }
  } else if (el.hasAttribute(ATTR.search)) {
    c.kind = "search";
    var list = el.getAttribute(ATTR.search);
    if (list) this.searchFields = list.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var st;
    el.addEventListener("input", function () {
      clearTimeout(st);
      st = setTimeout(function () {
        self.state.searchRaw = el.value;
        self.state.search = norm(el.value);
        self._changed();
      }, 150);
    });
  } else if (el.hasAttribute(ATTR.sort)) {
    if (el.tagName === "SELECT") {
      c.kind = "sort-select";
      toArray(el.options).forEach(function (o) {
        var s = parseSort(o.value);
        if (s && el.hasAttribute(ATTR.type)) self.sortTypes[s.field] = norm(el.getAttribute(ATTR.type));
      });
      el.addEventListener("change", function () { self.state.sort = parseSort(el.value); self._changed(); });
    } else {
      c.kind = "sort-button";
      c.sort = parseSort(el.getAttribute(ATTR.sort));
      if (c.sort && el.hasAttribute(ATTR.type)) this.sortTypes[c.sort.field] = norm(el.getAttribute(ATTR.type));
      makePressable(el);
      el.addEventListener("click", function (e) {
        e.preventDefault();
        if (!c.sort) { self.state.sort = null; self._changed(); return; }
        var cur = self.state.sort;
        if (c.sort.explicit) self.state.sort = { field: c.sort.field, dir: c.sort.dir };
        else if (cur && cur.field === c.sort.field) self.state.sort = { field: cur.field, dir: cur.dir === "asc" ? "desc" : "asc" };
        else self.state.sort = { field: c.sort.field, dir: "asc" };
        self._changed();
      });
    }
  } else if (el.hasAttribute(ATTR.reset)) {
    c.kind = "reset";
    c.field = el.getAttribute(ATTR.reset) || "";
    makePressable(el);
    el.addEventListener("click", function (e) { e.preventDefault(); self.reset(c.field); });
  } else if (el.hasAttribute(ATTR.more)) {
    c.kind = "more";
    makePressable(el);
    el.addEventListener("click", function (e) {
      e.preventDefault();
      self.state.shown = (self.state.shown || self.limit) + (self.limit || self.items.length);
      self.apply(true, { more: true });
    });
  } else if (el.hasAttribute(ATTR.page)) {
    c.kind = "page";
    c.dir = norm(el.getAttribute(ATTR.page));
    this.paging = "pages";
    makePressable(el);
    el.addEventListener("click", function (e) {
      e.preventDefault();
      self._goPage(self.state.page + (c.dir === "prev" ? -1 : 1));
    });
  } else if (el.hasAttribute(ATTR.pagination)) {
    c.kind = "pagination";
    this.paging = "pages";
    var tpl = el.firstElementChild;
    c.template = tpl ? tpl.cloneNode(true) : null;
    while (el.firstChild) el.removeChild(el.firstChild);
  } else if (el.hasAttribute(ATTR.results)) {
    c.kind = "results";
  } else if (el.hasAttribute(ATTR.total)) {
    c.kind = "total";
  } else if (el.hasAttribute(ATTR.empty)) {
    c.kind = "empty";
    setHidden(el, true);
  }
  if (c.kind) this.controls.push(c);
};

// ── State changes ──────────────────────────────────────────────────────────
FilterList.prototype._setField = function (field, values) {
  if (values.length) this.state.fields[field] = values.slice();
  else delete this.state.fields[field];
};
FilterList.prototype._toggle = function (field, value, on) {
  var cur = (this.state.fields[field] || []).filter(function (v) { return v !== value; });
  if (on) cur.push(value);
  this._setField(field, cur);
};
FilterList.prototype._changed = function () {
  this.state.page = 1;
  this.state.shown = this.limit;
  this.apply(true);
};
FilterList.prototype._goPage = function (n) {
  var pages = this._pageCount;
  n = Math.max(1, Math.min(pages || 1, n));
  if (n === this.state.page) return;
  this.state.page = n;
  this.apply(true, { scroll: true });
};

FilterList.prototype.isFiltered = function (field) {
  var st = this.state;
  if (field === "search") return !!st.search;
  if (field) return !!((st.fields[field] && st.fields[field].length) || st.text[field]);
  if (st.search) return true;
  for (var f in st.fields) if (st.fields[f].length) return true;
  for (var t in st.text) if (st.text[t]) return true;
  return false;
};

FilterList.prototype.reset = function (field) {
  var st = this.state;
  if (!field) {
    st.fields = {}; st.text = {}; st.textRaw = {}; st.search = ""; st.searchRaw = "";
  } else if (field === "search") {
    st.search = ""; st.searchRaw = "";
  } else if (field === "sort") {
    st.sort = null;
  } else {
    delete st.fields[field]; delete st.text[field]; delete st.textRaw[field];
  }
  // Text inputs only show state while they don't have focus; clear them now.
  this.controls.forEach(function (c) {
    if ((c.kind === "search" && (!field || field === "search")) || (c.kind === "text" && (!field || field === c.field))) c.el.value = "";
  });
  this._changed();
};

// ── Matching ───────────────────────────────────────────────────────────────
FilterList.prototype._passes = function (it, skip) {
  var st = this.state, f, i;
  for (f in st.fields) {
    if (f === skip) continue;
    var want = st.fields[f];
    if (!want.length) continue;
    var have = it.fields[f] || [], hit = false;
    for (i = 0; i < want.length; i++) if (have.indexOf(want[i]) !== -1) { hit = true; break; }
    if (!hit) return false;
  }
  for (f in st.text) {
    if (f === skip || !st.text[f]) continue;
    if ((it.fields[f] || []).join(" ").indexOf(st.text[f]) === -1) return false;
  }
  if (st.search) {
    var hay = it.text;
    if (this.searchFields) {
      hay = this.searchFields.map(function (n) { return (it.fields[n] || []).join(" "); }).join(" ");
    }
    var words = st.search.split(" ");
    for (i = 0; i < words.length; i++) if (hay.indexOf(words[i]) === -1) return false;
  }
  return true;
};

// ── Sorting ────────────────────────────────────────────────────────────────
FilterList.prototype._typeOf = function (field) {
  var t = this.sortTypes[field] || this.fieldTypes[field] || this._autoTypes[field];
  if (t) return t;
  var vals = this.items.map(function (it) { return (it.raw[field] || [])[0]; }).filter(Boolean);
  // Numbers may carry a short prefix or suffix (€ 12,50, 45 min). Values
  // without any digit ("Gratis") don't block it; they just sort last.
  var numeric = vals.filter(function (v) { return /^[^\d]{0,3}\s?[-+]?\d[\d.,]*\s?[^\d]{0,4}$/.test(v.trim()); });
  var digitless = vals.filter(function (v) { return !/\d/.test(v); });
  if (numeric.length && numeric.length >= vals.length / 2 && numeric.length + digitless.length === vals.length) t = "number";
  else if (vals.length && vals.every(function (v) { return parseDate(v, false) !== null; })) t = "date";
  else t = "text";
  this._autoTypes[field] = t;
  return t;
};

FilterList.prototype._key = function (it, field, type) {
  var k = field + "|" + type;
  if (k in it.keys) return it.keys[k];
  var raw = (it.raw[field] || [])[0], v = null;
  if (raw != null) {
    if (type === "number") v = parseNumber(raw);
    else if (type === "date") v = parseDate(raw, true);
    else v = raw;
  }
  it.keys[k] = v;
  return v;
};

FilterList.prototype._sorted = function (list) {
  var s = this.state.sort, self = this;
  if (!s) return list.slice().sort(function (a, b) { return a.index - b.index; });
  var type = this._typeOf(s.field), dir = s.dir === "desc" ? -1 : 1;
  return list.slice().sort(function (a, b) {
    var ka = self._key(a, s.field, type), kb = self._key(b, s.field, type);
    if (ka == null && kb == null) return a.index - b.index;
    if (ka == null) return 1;      // missing values always last
    if (kb == null) return -1;
    var r = type === "text" ? compareText(ka, kb) : ka - kb;
    return r ? r * dir : a.index - b.index;
  });
};

// ── Render ─────────────────────────────────────────────────────────────────
// user: the change came from the visitor (fade new items in, announce,
// write the URL). opts.scroll: bring the list into view (page change).
FilterList.prototype.apply = function (user, opts) {
  opts = opts || {};
  var self = this, st = this.state;
  this.items.forEach(function (it) { it.match = self._passes(it, null); });
  var matches = this._sorted(this.items.filter(function (it) { return it.match; }));

  // DOM order: matches in sort order, the rest after them.
  var rest = this._sorted(this.items.filter(function (it) { return !it.match; }));
  var order = st.sort ? matches.concat(rest) : this._sorted(this.items);
  var key = order.map(function (it) { return it.index; }).join(",");
  if (key !== this._orderKey) {
    order.forEach(function (it) { self.container.appendChild(it.el); });
    this._orderKey = key;
  }

  var total = matches.length, from = 0, to = total;
  if (this.limit) {
    if (this.paging === "pages") {
      this._pageCount = Math.max(1, Math.ceil(total / this.limit));
      st.page = Math.max(1, Math.min(st.page, this._pageCount));
      from = (st.page - 1) * this.limit;
      to = Math.min(total, from + this.limit);
    } else {
      to = Math.min(total, st.shown || this.limit);
    }
  } else {
    this._pageCount = 1;
  }

  var show = {};
  for (var i = from; i < to; i++) show[matches[i].index] = true;
  var animate = user && !reducedMotion() && typeof Element.prototype.animate === "function";
  this.items.forEach(function (it) {
    var wasHidden = isHidden(it.el);
    setHidden(it.el, !show[it.index]);
    if (show[it.index] && wasHidden && animate) {
      it.el.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: "ease-out" });
    }
  });

  this._total = total;
  this._shown = to - from;
  this._render(total, from, to);

  this.root.classList.toggle("is-filtered", this.isFiltered());
  this.root.classList.toggle("is-no-results", this.items.length > 0 && total === 0);

  if (user) {
    this._writeUrl();
    var msg = this.announceTpl
      ? this.announceTpl.replace("{count}", total)
      : total === 1 ? "1 resultaat" : total + " resultaten";
    announce(msg);
  }
  if (opts.scroll) {
    var top = this.root.getBoundingClientRect().top;
    if (top < 0) this.root.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  }

  // Elements shown for the first time may still need their zh-animate entrance.
  try {
    this.root.dispatchEvent(new CustomEvent("zh-filter:update", { bubbles: true, detail: { name: this.name, results: total, shown: to - from, total: this.items.length } }));
  } catch (err) {}
};

FilterList.prototype._facetCount = function (c) {
  var self = this;
  return this.items.filter(function (it) {
    if (!self._passes(it, c.field)) return false;
    return c.isAll || (it.fields[c.field] || []).indexOf(c.value) !== -1;
  }).length;
};

FilterList.prototype._render = function (total, from, to) {
  var self = this, st = this.state;
  var pages = this._pageCount || 1;

  this.controls.forEach(function (c) {
    var el = c.el, chosen, on;
    switch (c.kind) {
      case "checkbox":
      case "radio":
      case "chip":
        chosen = st.fields[c.field] || [];
        on = c.isAll ? !chosen.length : chosen.indexOf(c.value) !== -1;
        if (c.input) {
          c.input.checked = on;
          var vis = c.label.querySelector(".w-checkbox-input--inputType-custom, .w-radio-input--inputType-custom, .w-checkbox-input, .w-radio-input");
          if (vis) vis.classList.toggle("w--redirected-checked", on);
        } else {
          el.setAttribute("aria-pressed", on ? "true" : "false");
        }
        c.label.classList.toggle("is-active", on);
        var n = self._facetCount(c);
        c.facets.forEach(function (f) { f.textContent = n; });
        c.label.classList.toggle("is-empty", n === 0 && !on);
        break;
      case "select":
        chosen = (st.fields[c.field] || [])[0] || "";
        var idx = -1;
        toArray(el.options).forEach(function (o, i) { if (norm(o.value) === chosen && idx === -1) idx = i; });
        if (idx !== -1) el.selectedIndex = idx;
        el.classList.toggle("is-active", !!chosen);
        break;
      case "text":
        if (document.activeElement !== el) el.value = st.textRaw[c.field] || "";
        break;
      case "search":
        if (document.activeElement !== el) el.value = st.searchRaw || "";
        break;
      case "sort-select":
        var want = st.sort ? st.sort.field + "-" + st.sort.dir : "";
        var sidx = -1;
        toArray(el.options).forEach(function (o, i) {
          var s = parseSort(o.value);
          var str = s ? s.field + "-" + s.dir : "";
          if (sidx === -1 && str === want) sidx = i;
        });
        if (sidx !== -1) el.selectedIndex = sidx;
        break;
      case "sort-button":
        var act = !!(st.sort && c.sort && st.sort.field === c.sort.field && (!c.sort.explicit || st.sort.dir === c.sort.dir));
        if (!c.sort) act = !st.sort;
        el.classList.toggle("is-active", act);
        el.classList.toggle("is-asc", act && !!st.sort && st.sort.dir === "asc");
        el.classList.toggle("is-desc", act && !!st.sort && st.sort.dir === "desc");
        el.setAttribute("aria-pressed", act ? "true" : "false");
        break;
      case "reset":
        var activeNow = c.field === "sort" ? !!st.sort : self.isFiltered(c.field);
        el.classList.toggle("is-disabled", !activeNow);
        break;
      case "results":
        el.textContent = total;
        break;
      case "total":
        el.textContent = self.items.length;
        break;
      case "empty":
        setHidden(el, !(self.items.length > 0 && total === 0));
        break;
      case "more":
        setHidden(el, !(self.limit && self.paging === "more" && to < total));
        break;
      case "page":
        setHidden(el, pages <= 1);
        var atEdge = c.dir === "prev" ? st.page <= 1 : st.page >= pages;
        el.classList.toggle("is-disabled", atEdge);
        el.setAttribute("aria-disabled", atEdge ? "true" : "false");
        break;
      case "pagination":
        self._renderPagination(c, pages);
        break;
    }
  });
};

// Page numbers: 1 … 4 5 6 … 12. Built from the first child you placed in
// the container (so it keeps your Webflow styling), or a plain button.
FilterList.prototype._renderPagination = function (c, pages) {
  var self = this, el = c.el, cur = this.state.page;
  while (el.firstChild) el.removeChild(el.firstChild);
  setHidden(el, pages <= 1);
  if (pages <= 1) return;
  var list = [];
  for (var p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - cur) <= 1 || pages <= 7) list.push(p);
    else if (list[list.length - 1] !== "…") list.push("…");
  }
  list.forEach(function (p) {
    var b = c.template ? c.template.cloneNode(true) : document.createElement("button");
    if (!c.template) { b.type = "button"; b.className = "zh-page"; }
    b.removeAttribute("id");
    b.textContent = p;
    if (p === "…") {
      b.classList.add("is-ellipsis");
      b.setAttribute("aria-hidden", "true");
      if (b.tagName === "BUTTON") b.disabled = true;
    } else {
      b.classList.toggle("is-active", p === cur);
      if (p === cur) b.setAttribute("aria-current", "page");
      b.setAttribute("aria-label", "Pagina " + p);
      makePressable(b);
      b.addEventListener("click", function (e) { e.preventDefault(); self._goPage(p); });
    }
    el.appendChild(b);
  });
};

// ── URL ────────────────────────────────────────────────────────────────────
// ?categorie=acteur,muziek&q=bang&sort=datum-desc&page=2
// With more than one list on the page, keys get the list name as prefix:
// ?agenda_categorie=acteur
FilterList.prototype._prefix = function () {
  return instances.length > 1 && this.name ? this.name + "_" : "";
};

FilterList.prototype._knownFields = function () {
  var known = {}, self = this;
  this.items.forEach(function (it) { for (var f in it.fields) known[f] = true; });
  this.controls.forEach(function (c) { if (c.field) known[c.field] = true; });
  Object.keys(this.textFields).forEach(function (f) { known[f] = true; });
  return known;
};

FilterList.prototype._readUrl = function () {
  if (!this.useUrl || !window.URLSearchParams) return false;
  var params = new URLSearchParams(location.search), pre = this._prefix(), known = this._knownFields(), st = this.state, any = false, self = this;
  params.forEach(function (value, key) {
    if (pre && key.indexOf(pre) !== 0) return;
    var k = key.slice(pre.length);
    if (k === "q") { st.searchRaw = value; st.search = norm(value); any = true; }
    else if (k === "sort") { st.sort = parseSort(value); any = true; }
    else if (k === "page") { st.page = parseInt(value, 10) || 1; any = true; }
    else if (known[k]) {
      if (self.textFields[k]) { st.textRaw[k] = value; st.text[k] = norm(value); }
      else {
        var vals = value.split(",").map(norm).filter(Boolean);
        if (!self.multi[k]) vals = vals.slice(0, 1);
        if (vals.length) st.fields[k] = vals;
      }
      any = true;
    }
  });
  return any;
};

FilterList.prototype._writeUrl = function () {
  if (!this.useUrl || !window.URLSearchParams || !history.replaceState) return;
  var params = new URLSearchParams(location.search), pre = this._prefix(), st = this.state;
  var known = this._knownFields();
  Object.keys(known).concat(["q", "sort", "page"]).forEach(function (k) { params.delete(pre + k); });
  Object.keys(st.fields).forEach(function (f) { if (st.fields[f].length) params.set(pre + f, st.fields[f].join(",")); });
  Object.keys(st.text).forEach(function (f) { if (st.text[f]) params.set(pre + f, st.textRaw[f].trim()); });
  if (st.search) params.set(pre + "q", st.searchRaw.trim());
  if (st.sort) params.set(pre + "sort", st.sort.field + "-" + st.sort.dir);
  if (this.paging === "pages" && st.page > 1) params.set(pre + "page", st.page);
  var qs = params.toString();
  history.replaceState(history.state, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
};

// Start from what the controls already show (a checked box, a chosen
// option), then let the URL override that.
FilterList.prototype._readControls = function () {
  var st = this.state, self = this;
  this.controls.forEach(function (c) {
    if (c.kind === "checkbox" && c.input.checked && !c.isAll) self._toggle(c.field, c.value, true);
    else if (c.kind === "radio" && c.input.checked && !c.isAll) self._setField(c.field, [c.value]);
    else if (c.kind === "select" && norm(c.el.value)) self._setField(c.field, [norm(c.el.value)]);
    else if (c.kind === "sort-select" && c.el.value) st.sort = parseSort(c.el.value);
  });
};

// ── Webflow pagination: load every page first ─────────────────────────────
// A Collection List shows at most 100 items per page. When Webflow's own
// pagination is on, fetch the following pages and add their items, so
// filtering and search cover the whole collection.
FilterList.prototype._loadAll = function () {
  var self = this;
  if (!attrBool(this.root, ATTR.loadAll, true) || !window.fetch || !window.DOMParser) return;
  var wrap = this.root.closest(".w-dyn-list") || this.root.parentElement;
  var pag = wrap && wrap.querySelector(".w-pagination-wrapper");
  if (!pag) return;
  var next = pag.querySelector("a.w-pagination-next");
  setHidden(pag, true);
  if (!next) return;

  var same = toArray(document.querySelectorAll("[" + ATTR.root + "]")).filter(function (r) { return r.getAttribute(ATTR.root) === self.name; });
  var pos = Math.max(0, same.indexOf(this.root));
  var seen = {}, count = 0;
  this.root.classList.add("is-loading");

  function done() {
    self.root.classList.remove("is-loading");
    if (window.Zweihander && window.Zweihander.animate && window.Zweihander.animate.refresh) window.Zweihander.animate.refresh();
  }
  function step(url) {
    if (!url || seen[url] || count++ >= 50) return done();
    seen[url] = true;
    fetch(url, { credentials: "same-origin" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        var roots = toArray(doc.querySelectorAll("[" + ATTR.root + "]")).filter(function (r) { return r.getAttribute(ATTR.root) === self.name; });
        var r = roots[pos] || roots[0];
        if (!r) return done();
        var cont = r.classList.contains("w-dyn-items") ? r : (r.querySelector(".w-dyn-items") || r);
        var marked = toArray(cont.querySelectorAll("[" + ATTR.item + "]"));
        var kids = marked.length ? marked : toArray(cont.children);
        kids.forEach(function (k) { self.container.appendChild(document.importNode(k, true)); });
        self._readItems();
        self._orderKey = "";
        self.apply(false);
        var w = r.closest(".w-dyn-list") || r.parentElement;
        var n = w && w.querySelector("a.w-pagination-next");
        step(n ? new URL(n.getAttribute("href"), url).href : null);
      })
      .catch(function (err) {
        console.warn("[zh-filter] could not load", url, err);
        done();
      });
  }
  step(new URL(next.getAttribute("href"), location.href).href);
};

FilterList.prototype.refresh = function () {
  this._readItems();
  this._orderKey = "";
  this.apply(false);
};

FilterList.prototype.set = function (field, values) {
  this._setField(field, (values || []).map(norm).filter(Boolean));
  this._changed();
};
FilterList.prototype.setSearch = function (q) {
  this.state.searchRaw = q || "";
  this.state.search = norm(q);
  this._changed();
};
FilterList.prototype.setSort = function (field, dir) {
  this.state.sort = field ? { field: field, dir: dir === "desc" ? "desc" : "asc" } : null;
  this._changed();
};

// ───────────────────────────────────────────────────────────────────────────
// Bootstrap
// ───────────────────────────────────────────────────────────────────────────
function controlTargets(el) {
  var name = null;
  if (el.hasAttribute(ATTR.target)) name = el.getAttribute(ATTR.target);
  else {
    var w = el.closest("[" + ATTR.controls + "]");
    if (w) name = w.getAttribute(ATTR.controls);
    else {
      var r = el.closest("[" + ATTR.root + "]");
      if (r) name = r.getAttribute(ATTR.root);
    }
  }
  if (name) return instances.filter(function (i) { return i.name === name; });
  return instances.length === 1 ? instances.slice() : [];
}

// Webflow form blocks around filter controls must never submit.
var submitGuarded = false;
function guardSubmit() {
  if (submitGuarded) return;
  submitGuarded = true;
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (form && form.querySelector && (form.hasAttribute(ATTR.controls) || form.querySelector(CONTROL_SELECTOR) || form.closest("[" + ATTR.controls + "]"))) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

function bootstrap() {
  var fresh = [];
  toArray(document.querySelectorAll("[" + ATTR.root + "]")).forEach(function (root) {
    if (root.__zhFilter) return;
    try {
      var inst = new FilterList(root);
      instances.push(inst);
      fresh.push(inst);
    } catch (err) {
      console.error("[zh-filter] init failed", root, err);
    }
  });
  if (!fresh.length) return;
  guardSubmit();

  toArray(document.querySelectorAll(CONTROL_SELECTOR)).forEach(function (el) {
    controlTargets(el).forEach(function (inst) {
      if (fresh.indexOf(inst) !== -1) inst._bind(el);
    });
  });
  if (!instances.length) return;

  fresh.forEach(function (inst) {
    inst._readControls();
    inst._readUrl();
    inst.apply(false);
    inst.root.classList.add("is-ready");
    inst._loadAll();
  });
}

// ── Public API (exposed on window AND as ES module exports) ─────────────
window.Zweihander = window.Zweihander || {};
window.Zweihander.filter = {
  init: bootstrap,
  get: function (name) {
    for (var i = 0; i < instances.length; i++) if (instances[i].name === (name || "")) return instances[i];
    return instances.length === 1 && !name ? instances[0] : null;
  },
  refresh: function (name) {
    instances.forEach(function (i) { if (!name || i.name === name) i.refresh(); });
  },
  reset: function (name) {
    instances.forEach(function (i) { if (!name || i.name === name) i.reset(); });
  },
};

// Named exports for the loader
export { bootstrap as init };
