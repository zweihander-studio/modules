/**
 * Zweihander — zh-slider
 * Native, dependency-free slider for Webflow.
 *
 * Markup:
 *   <div zh-slider="hero"
 *        zh-slider-loop="true"
 *        zh-slider-duration="600"
 *        zh-slider-per-view="1"
 *        zh-slider-gap="16"
 *        zh-slider-autoplay="4000">
 *     <div zh-slider-list>
 *       <div zh-slider-item>…</div>
 *       <div zh-slider-item>…</div>
 *     </div>
 *
 *     <button zh-slider-element="prev">←</button>
 *     <button zh-slider-element="next">→</button>
 *     <div zh-slider-element="pagination"></div>
 *     <div zh-slider-element="scrollbar"><div zh-slider-element="scrollbar-thumb"></div></div>
 *     <div zh-slider-element="progress"><div zh-slider-element="progress-fill"></div></div>
 *
 *     <div zh-slider-current="hero">1</div>
 *     <div zh-slider-total="hero">1</div>
 *   </div>
 *
 * Style it however you like in Webflow. The script only sets dynamic
 * transform/transition values inline and toggles a few state classes:
 *   - is-active   on current pagination bullet & slide
 *   - is-disabled on nav buttons at the bounds (when not looping)
 *   - is-dragging on the root while user is interacting
 */

// ES module — loaded by zweihander.js loader

// ───────────────────────────────────────────────────────────────────────────
// Attribute names — single source of truth
// ───────────────────────────────────────────────────────────────────────────
var ATTR = {
  root: "zh-slider",
  list: "zh-slider-list",
  item: "zh-slider-item",
  element: "zh-slider-element",
  numberCurrent: "zh-slider-current",
  numberTotal: "zh-slider-total",
};

// ───────────────────────────────────────────────────────────────────────────
// Tiny helpers
// ───────────────────────────────────────────────────────────────────────────
function attr(el, name, fallback) {
  if (!el || !el.hasAttribute(name)) return fallback;
  var raw = el.getAttribute(name);
  return raw === null || raw === "" ? fallback : raw;
}
function attrBool(el, name, fallback) {
  var v = attr(el, name, null);
  if (v === null) return fallback;
  return v === "true" || v === "1" || v === "";
}
function attrNumber(el, name, fallback) {
  var v = attr(el, name, null);
  if (v === null) return fallback;
  var n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}
function attrJSON(el, name, fallback) {
  var v = attr(el, name, null);
  if (v === null) return fallback;
  try {
    return JSON.parse(v);
  } catch (e) {
    console.warn("[zh-slider] invalid JSON in", name, "→", v);
    return fallback;
  }
}
function pad(n) {
  return n < 10 ? "0" + n : "" + n;
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * Strip animation attributes and inline styles from a cloned slide so
 * zh-animate (or legacy data-animate) doesn't hide it with opacity:0.
 */
function cleanClone(el) {
  el.setAttribute("zh-slider-clone", "true");
  el.setAttribute("aria-hidden", "true");

  // Remove any animate attributes (zh-animate, data-animate, etc.)
  var animAttrs = ["zh-animate", "data-animate", "zh-animate-delay",
    "data-animate-delay", "zh-animate-stagger", "data-animate-stagger",
    "zh-animate-duration", "data-animate-duration"];
  var targets = [el].concat(Array.prototype.slice.call(el.querySelectorAll("*")));
  for (var t = 0; t < targets.length; t++) {
    var node = targets[t];
    for (var a = 0; a < animAttrs.length; a++) {
      node.removeAttribute(animAttrs[a]);
    }
    if (node.style.opacity === "0") node.style.opacity = "";
    node.classList.remove("is-animated");
  }

  // Make all focusable elements inside clones un-tabbable.
  // This prevents keyboard users from tabbing into cloned slides.
  var focusable = "a, button, input, select, textarea, [tabindex]";
  var els = [el].concat(Array.prototype.slice.call(el.querySelectorAll(focusable)));
  for (var f = 0; f < els.length; f++) {
    els[f].setAttribute("tabindex", "-1");
  }
}

/**
 * Find descendants matching a selector that belong to THIS slider only —
 * never reach into a nested zh-slider.
 */
function scopedQuery(root, selector) {
  var matches = root.querySelectorAll(selector);
  var out = [];
  for (var i = 0; i < matches.length; i++) {
    var el = matches[i];
    var p = el.parentElement;
    while (p && p !== root) {
      if (p.hasAttribute && p.hasAttribute(ATTR.root)) break;
      p = p.parentElement;
    }
    if (p === root) out.push(el);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Slider class (one instance per zh-slider element)
// ───────────────────────────────────────────────────────────────────────────
function Slider(root) {
  this.root = root;
  this.name = root.getAttribute(ATTR.root) || "";

  this.list = scopedQuery(root, "[" + ATTR.list + "]")[0];
  if (!this.list) {
    console.warn("[zh-slider] missing [zh-slider-list] inside", root);
    return;
  }
  this.originalItems = scopedQuery(root, "[" + ATTR.item + "]");
  if (!this.originalItems.length) {
    console.warn("[zh-slider] no [zh-slider-item] elements inside", root);
    return;
  }

  // Read declarative options
  this.opts = this._readOptions();

  // State
  this.realCount = this.originalItems.length;
  this.index = 0;            // logical index into displayed items array
  this.realIndex = 0;        // index into original (un-cloned) items
  this.translate = 0;        // current px offset
  this.slideSize = 0;        // px per slide (incl. spaceBetween)
  this.containerSize = 0;    // px of viewport
  this.items = [];           // displayed items (incl. clones if loop)
  this.loopOffset = 0;       // number of cloned slides at the start
  this.isDragging = false;
  this.dragStart = 0;
  this.dragLastX = 0;
  this.dragLastT = 0;
  this.dragVelocity = 0;
  this.startTranslate = 0;
  this.autoplayTimer = null;
  this.resizeRaf = 0;

  this._setupDom();
  this._setupA11y();
  this._bindControls();
  this._bindPointer();
  this._bindScrollbarDrag();
  this._bindKeyboard();
  this._bindResize();
  this._bindVisibility();
  this._applyBreakpoint();
  this.layout(true);
  this.goTo(0, false);
  this._startAutoplay();

  root.__zhSlider = this;
}

Slider.prototype._readOptions = function () {
  var r = this.root;
  // Every option lives under the zh-slider-* namespace. Avoids collisions
  // with HTML reserved names (autoplay, loop, …) AND with other Zweihander
  // modules (zh-animate-duration vs zh-slider-duration, etc.).
  //
  // gapSet / perViewSet let us tell "I want JS to control this" apart from
  // "leave my CSS alone". When false, the script measures from the DOM and
  // never touches widths/margins/gap on the list or items.
  // WCAG 2.3.3 — when the user prefers reduced motion, disable autoplay
  // and use a minimal transition duration so slides still snap (but fast).
  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return {
    loop: attrBool(r, "zh-slider-loop", false),
    duration: reducedMotion ? 0 : attrNumber(r, "zh-slider-duration", 500),
    slidesPerView: this._parseSpv(attr(r, "zh-slider-per-view", "1")),
    perViewSet: r.hasAttribute("zh-slider-per-view"),
    spaceBetween: attrNumber(r, "zh-slider-gap", 0),
    gapSet: r.hasAttribute("zh-slider-gap"),
    autoplayMs: reducedMotion ? 0 : attrNumber(r, "zh-slider-autoplay", 0),
    pauseOnHover: attrBool(r, "zh-slider-pause-on-hover", true),
    threshold: attrNumber(r, "zh-slider-drag-threshold", 5),
    easing: attr(r, "zh-slider-easing", "cubic-bezier(.22,.61,.36,1)"),
    padNumbers: attrBool(r, "zh-slider-pad-numbers", true),
    breakpoints: attrJSON(r, "zh-slider-breakpoints", null),
    paginationClickable: attrBool(r, "zh-slider-pagination-clickable", true),
  };
};

Slider.prototype._parseSpv = function (v) {
  if (v === "auto") return "auto";
  var n = parseFloat(v);
  return isNaN(n) || n <= 0 ? 1 : n;
};

// Apply matching breakpoint overrides over the base options.
Slider.prototype._applyBreakpoint = function () {
  if (!this.opts.breakpoints) return;
  var w = window.innerWidth;
  var keys = Object.keys(this.opts.breakpoints)
    .map(function (k) { return parseFloat(k); })
    .filter(function (k) { return !isNaN(k); })
    .sort(function (a, b) { return a - b; });

  var match = null;
  for (var i = 0; i < keys.length; i++) {
    if (w >= keys[i]) match = keys[i];
  }
  if (match !== null) {
    var o = this.opts.breakpoints[String(match)] || this.opts.breakpoints[match];
    if (o) {
      if (o.slidesPerView != null) {
        this.opts.slidesPerView = this._parseSpv(String(o.slidesPerView));
        this.opts.perViewSet = true;
      }
      if (o.spaceBetween != null) {
        this.opts.spaceBetween = parseFloat(o.spaceBetween) || 0;
        this.opts.gapSet = true;
      }
    }
  }
};

// ── DOM setup ─────────────────────────────────────────────────────────────
Slider.prototype._setupDom = function () {
  var root = this.root;
  var list = this.list;

  // No overflow, touchAction, or cursor styles are forced by the script.
  // Style everything yourself in Webflow. The script only sets position
  // on the root if it's not already set (needed for layout calculations).
  var rs = root.style;
  if (!rs.position) rs.position = "relative";

  var ls = list.style;
  ls.display = "flex";
  ls.flexWrap = "nowrap";
  ls.willChange = "transform";
  ls.backfaceVisibility = "hidden";
  ls.webkitBackfaceVisibility = "hidden"; // Safari hint
  ls.transform = "translate3d(0,0,0)";

  // If looping, clone slides on each side so we can wrap seamlessly.
  // When per-view is NOT declared we don't know the slide count yet, so we
  // clone the entire set on each side — that guarantees enough headroom
  // regardless of how CSS ends up sizing the slides.
  if (this.opts.loop && this.realCount > 1) {
    var spv;
    if (!this.opts.perViewSet || this.opts.slidesPerView === "auto") {
      spv = this.realCount;
    } else {
      spv = Math.ceil(this.opts.slidesPerView);
    }
    this.loopOffset = Math.max(spv, 1);

    // Clone tail → prepend
    for (var i = this.realCount - 1, c = 0; c < this.loopOffset; c++, i--) {
      var idx = ((i % this.realCount) + this.realCount) % this.realCount;
      var cloneL = this.originalItems[idx].cloneNode(true);
      cleanClone(cloneL);
      list.insertBefore(cloneL, list.firstChild);
    }
    // Clone head → append
    for (var j = 0; j < this.loopOffset; j++) {
      var cloneR = this.originalItems[j % this.realCount].cloneNode(true);
      cleanClone(cloneR);
      list.appendChild(cloneR);
    }
  }

  this.items = scopedQuery(root, "[" + ATTR.item + "]");

  // Build pagination bullets if a pagination element exists
  this.paginationEl = scopedQuery(root, "[" + ATTR.element + "='pagination']")[0] || null;
  if (this.paginationEl) {
    clearChildren(this.paginationEl);
    this.bullets = [];
    for (var b = 0; b < this.realCount; b++) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "zh-bullet";
      btn.setAttribute("aria-label", "Go to slide " + (b + 1));
      btn.dataset.zhBullet = String(b);
      this.paginationEl.appendChild(btn);
      this.bullets.push(btn);
    }
  }

  // Scrollbar (optional)
  this.scrollbarEl = scopedQuery(root, "[" + ATTR.element + "='scrollbar']")[0] || null;
  this.scrollbarThumbEl = scopedQuery(root, "[" + ATTR.element + "='scrollbar-thumb']")[0] || null;
  if (this.scrollbarEl && !this.scrollbarThumbEl) {
    this.scrollbarThumbEl = document.createElement("div");
    this.scrollbarThumbEl.setAttribute(ATTR.element, "scrollbar-thumb");
    this.scrollbarEl.appendChild(this.scrollbarThumbEl);
  }
  if (this.scrollbarThumbEl) {
    this.scrollbarThumbEl.style.position = "absolute";
    this.scrollbarThumbEl.style.left = "0";
    this.scrollbarThumbEl.style.top = "0";
    if (this.scrollbarEl) this.scrollbarEl.style.position = "relative";
  }

  // Progress bar (optional) — fills from 0% to 100% as you advance
  this.progressEl = scopedQuery(root, "[" + ATTR.element + "='progress']")[0] || null;
  this.progressFillEl = scopedQuery(root, "[" + ATTR.element + "='progress-fill']")[0] || null;
  if (this.progressEl && !this.progressFillEl) {
    this.progressFillEl = document.createElement("div");
    this.progressFillEl.setAttribute(ATTR.element, "progress-fill");
    this.progressEl.appendChild(this.progressFillEl);
  }
  if (this.progressFillEl) {
    this.progressFillEl.style.height = "100%";
    this.progressFillEl.style.width = "0%";
    this.progressFillEl.style.willChange = "width";
    if (this.progressEl) {
      this.progressEl.style.overflow = "hidden";
    }
  }

  // Number trackers — always try scoped first (inside this component).
  // Only fall back to global name-matching when nothing is found inside
  // AND the slider has a name. This way identical components on the same
  // page each find their own counters automatically.
  this.currentEls = scopedQuery(root, "[" + ATTR.numberCurrent + "]");
  if (!this.currentEls.length && this.name) {
    this.currentEls = Array.prototype.slice.call(
      document.querySelectorAll("[" + ATTR.numberCurrent + "='" + this.name + "']")
    );
  }
  this.totalEls = scopedQuery(root, "[" + ATTR.numberTotal + "]");
  if (!this.totalEls.length && this.name) {
    this.totalEls = Array.prototype.slice.call(
      document.querySelectorAll("[" + ATTR.numberTotal + "='" + this.name + "']")
    );
  }

  var totStr = this.opts.padNumbers ? pad(this.realCount) : String(this.realCount);
  for (var t = 0; t < this.totalEls.length; t++) this.totalEls[t].textContent = totStr;
};

// ── Accessibility ──────────────────────────────────────────────────────────
Slider.prototype._setupA11y = function () {
  var root = this.root;
  var sliderName = this.name || "slider";

  // 1. Root gets role="region" with a label so screenreaders announce it
  if (!root.getAttribute("role")) root.setAttribute("role", "region");
  if (!root.getAttribute("aria-roledescription")) root.setAttribute("aria-roledescription", "carousel");
  if (!root.getAttribute("aria-label")) root.setAttribute("aria-label", sliderName);

  // 2. Slide list is a live region — polite so it doesn't interrupt
  this.list.setAttribute("aria-live", "off"); // "off" during drag/autoplay, "polite" when idle
  this.list.setAttribute("aria-atomic", "false");

  // 3. Each original slide gets role + roledescription + label
  for (var i = 0; i < this.originalItems.length; i++) {
    var slide = this.originalItems[i];
    slide.setAttribute("role", "group");
    slide.setAttribute("aria-roledescription", "slide");
    slide.setAttribute("aria-label", (i + 1) + " of " + this.realCount);
  }

  // 4. Nav buttons get aria-labels if not already set
  if (this.prevEl && !this.prevEl.getAttribute("aria-label")) {
    this.prevEl.setAttribute("aria-label", "Previous slide");
  }
  if (this.nextEl && !this.nextEl.getAttribute("aria-label")) {
    this.nextEl.setAttribute("aria-label", "Next slide");
  }

  // 5. Pagination gets role="tablist", bullets get role="tab"
  if (this.paginationEl) {
    this.paginationEl.setAttribute("role", "tablist");
    this.paginationEl.setAttribute("aria-label", "Slide navigation");
  }
  if (this.bullets) {
    for (var b = 0; b < this.bullets.length; b++) {
      this.bullets[b].setAttribute("role", "tab");
      this.bullets[b].setAttribute("aria-label", "Slide " + (b + 1) + " of " + this.realCount);
    }
  }

  // 6. Skip link — lets keyboard users jump past all slides.
  //    Inserted as the first child of the slider root.
  //    Visually hidden (sr-only) until focused, then appears on screen.
  //    Jump target: the first focusable element AFTER the slide list
  //    (usually a nav button), or an invisible anchor at the end.
  this._createSkipLink();
};

Slider.prototype._createSkipLink = function () {
  var root = this.root;
  var list = this.list;
  var listWrapper = list.parentElement || list;

  // Custom skip text via attribute, or auto-generate from slider name
  var skipText = root.getAttribute("zh-slider-skip-text");
  if (!skipText) {
    var name = this.name || "slider";
    skipText = "Skip " + name + " list";
  }

  // Create an invisible anchor AFTER the list wrapper as the skip target
  var skipTargetId = "zh-skip-" + (this.name || Math.random().toString(36).substr(2, 8));
  var skipTarget = document.createElement("span");
  skipTarget.id = skipTargetId;
  skipTarget.setAttribute("tabindex", "-1");
  skipTarget.setAttribute("aria-hidden", "true");
  skipTarget.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);";

  // Insert the skip target right after the list wrapper
  if (listWrapper.nextSibling) {
    root.insertBefore(skipTarget, listWrapper.nextSibling);
  } else {
    root.appendChild(skipTarget);
  }

  // Create the skip link
  var skipLink = document.createElement("a");
  skipLink.href = "#" + skipTargetId;
  skipLink.className = "zh-slider-skip";
  skipLink.textContent = skipText;
  skipLink.setAttribute("zh-slider-skip-link", "true");

  // sr-only styles: invisible until :focus
  skipLink.style.cssText = [
    "position:absolute",
    "width:1px",
    "height:1px",
    "padding:0",
    "margin:-1px",
    "overflow:hidden",
    "clip:rect(0,0,0,0)",
    "white-space:nowrap",
    "border:0",
    "z-index:9999"
  ].join(";");

  // On focus: become visible
  skipLink.addEventListener("focus", function () {
    skipLink.style.cssText = [
      "position:absolute",
      "top:0",
      "left:0",
      "z-index:9999",
      "padding:8px 16px",
      "background:#000",
      "color:#fff",
      "font-size:14px",
      "font-weight:600",
      "text-decoration:underline",
      "border-radius:4px",
      "outline:2px solid #fff",
      "outline-offset:2px"
    ].join(";");
  });

  // On blur: go back to sr-only
  skipLink.addEventListener("blur", function () {
    skipLink.style.cssText = [
      "position:absolute",
      "width:1px",
      "height:1px",
      "padding:0",
      "margin:-1px",
      "overflow:hidden",
      "clip:rect(0,0,0,0)",
      "white-space:nowrap",
      "border:0",
      "z-index:9999"
    ].join(";");
  });

  // On click: jump to skip target and focus it
  skipLink.addEventListener("click", function (e) {
    e.preventDefault();
    var target = document.getElementById(skipTargetId);
    if (target) target.focus();
  });

  // Insert as the very first child of root
  root.insertBefore(skipLink, root.firstChild);

  // Store references for cleanup
  this._skipLink = skipLink;
  this._skipTarget = skipTarget;
};

// Update aria-hidden on slides, aria-current on bullets, and live region
// Called from _updateState on every slide change.
Slider.prototype._updateA11y = function () {
  // aria-hidden on non-visible slides (for screenreaders).
  // We do NOT use "inert" — slides must stay interactive so links,
  // hover effects, and Webflow interactions work on all visible cards.
  var spv = Math.floor(this.effectiveSpv || 1);
  for (var i = 0; i < this.items.length; i++) {
    var visible = i >= this.index && i < this.index + spv;
    this.items[i].setAttribute("aria-hidden", visible ? "false" : "true");
    this.items[i].removeAttribute("inert");
  }

  // aria-current on bullets
  if (this.bullets) {
    for (var b = 0; b < this.bullets.length; b++) {
      this.bullets[b].setAttribute("aria-selected", b === this.realIndex ? "true" : "false");
    }
  }

  // Briefly set aria-live to "polite" so the slide change is announced,
  // but only when not dragging or autoplaying (to avoid spam).
  if (!this.isDragging && !this.autoplayTimer) {
    this.list.setAttribute("aria-live", "polite");
  } else {
    this.list.setAttribute("aria-live", "off");
  }
};

// ── Keyboard navigation ──────────────────────────────────────────────────
Slider.prototype._bindKeyboard = function () {
  var self = this;

  // Don't force tabindex on root — let Webflow control tab order.
  // Keyboard nav works when ANY element inside the slider has focus.
  this.root.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") {
      // In loop mode with keyboard: stop at first slide (no loop trap)
      if (!self.opts.loop || self.realIndex > 0) {
        e.preventDefault();
        self.prev();
        self._restartAutoplay();
      }
    } else if (e.key === "ArrowRight") {
      // In loop mode with keyboard: stop at last slide (no loop trap)
      if (!self.opts.loop || self.realIndex < self.realCount - 1) {
        e.preventDefault();
        self.next();
        self._restartAutoplay();
      }
    }
  });

  // ── Focus-driven slide navigation ──────────────────────────────────
  // When a user Tabs into a slide, the slider scrolls to that slide.
  // This makes Tab key navigate slide-by-slide through the real slides.
  // Cloned slides are already tabindex="-1" so they're skipped.
  this.root.addEventListener("focusin", function (e) {
    // Find which slide contains the focused element
    var slide = e.target.closest("[" + ATTR.item + "]");
    if (!slide) return;

    // Skip cloned slides (shouldn't happen since they're tabindex=-1)
    if (slide.getAttribute("zh-slider-clone") === "true") return;

    // Find the index of this slide in the items array
    var idx = -1;
    for (var i = 0; i < self.items.length; i++) {
      if (self.items[i] === slide) { idx = i; break; }
    }
    if (idx < 0) return;

    // Only slide if it's not already the current slide
    if (idx !== self.index) {
      if (self.opts.loop) {
        self.index = idx;
        self.realIndex = self._realIndexFromDisplayed(idx);
        self._setTranslate(-self.index * self.slideSize, true);
        self._updateState();
      } else {
        self.goTo(idx, true);
      }
    }

    // Pause autoplay while slider has focus (WCAG 2.2.2)
    self._stopAutoplay();
  });

  if (this.opts.autoplayMs > 0) {
    this.root.addEventListener("focusout", function () {
      self._startAutoplay();
    });
  }
};

// ── Layout: compute sizes, set widths, position ───────────────────────────
//
// Two orthogonal knobs control how much the script touches CSS:
//   • zh-slider-gap declared  → script sets `gap` on the list
//   • zh-slider-per-view declared → script sets `width` on each item
// When neither is declared, the script leaves CSS completely alone and
// measures the real slide pitch from the DOM. That means you can set
// widths/margins/gap in Webflow (even per-breakpoint) and it just works.
Slider.prototype.layout = function (silent) {
  this.containerSize = this.root.clientWidth;
  var gapSet = this.opts.gapSet;
  var perViewSet = this.opts.perViewSet;
  var declaredGap = this.opts.spaceBetween;
  var declaredSpv = this.opts.slidesPerView;

  // 1. Apply gap if declared (otherwise leave the user's CSS alone)
  if (gapSet) {
    this.list.style.gap = declaredGap + "px";
  }

  // 2. Apply widths if per-view declared (otherwise leave CSS alone)
  if (perViewSet && declaredSpv !== "auto") {
    // Read the actual gap currently in effect (may come from CSS).
    var effectiveGap = declaredGap;
    if (!gapSet) {
      var cs = window.getComputedStyle(this.list);
      effectiveGap = parseFloat(cs.columnGap || cs.gap) || 0;
    }
    var per = (this.containerSize - effectiveGap * (declaredSpv - 1)) / declaredSpv;
    for (var i = 0; i < this.items.length; i++) {
      this.items[i].style.flexShrink = "0";
      this.items[i].style.width = per + "px";
    }
  } else {
    for (var j = 0; j < this.items.length; j++) {
      this.items[j].style.flexShrink = "0";
    }
  }

  // Give each slide its own compositing layer. This prevents absolutely
  // positioned children (titles, icons, pricing overlays) from "jumping"
  // during translate3d transitions on the parent list.
  for (var k = 0; k < this.items.length; k++) {
    this.items[k].style.backfaceVisibility = "hidden";
    this.items[k].style.webkitBackfaceVisibility = "hidden";
    this.items[k].style.transform = "translate3d(0,0,0)";
  }

  // 3. Measure the real slide pitch (width + gap) from the DOM. This is
  //    the single source of truth for swipe math, regardless of who set
  //    the sizes. Falls back gracefully when there's only one slide.
  if (this.items.length >= 2) {
    var a = this.items[0].getBoundingClientRect();
    var b = this.items[1].getBoundingClientRect();
    this.slideSize = b.left - a.left;
  } else if (this.items.length === 1) {
    this.slideSize = this.items[0].getBoundingClientRect().width;
  } else {
    this.slideSize = this.containerSize;
  }

  // 4. Effective slides-per-view (used for max index, disabled state,
  //    scrollbar ratio). If declared, trust it; otherwise derive from
  //    the measured pitch.
  if (perViewSet && declaredSpv !== "auto") {
    this.effectiveSpv = declaredSpv;
  } else if (this.slideSize > 0) {
    this.effectiveSpv = this.containerSize / this.slideSize;
  } else {
    this.effectiveSpv = 1;
  }

  if (!silent) this.goTo(this.realIndex, false);
  this._updateScrollbar(false);
  this._updateProgress(false);
};

// ── Movement ──────────────────────────────────────────────────────────────
Slider.prototype._setTranslate = function (px, animate) {
  this.translate = px;
  this.list.style.transition = animate
    ? "transform " + this.opts.duration + "ms " + this.opts.easing
    : "none";
  this.list.style.transform = "translate3d(" + px + "px, 0, 0)";
};

Slider.prototype._displayedIndexFromReal = function (real) {
  return real + this.loopOffset;
};

Slider.prototype._realIndexFromDisplayed = function (disp) {
  if (!this.opts.loop) return clamp(disp, 0, this.realCount - 1);
  var r = (disp - this.loopOffset) % this.realCount;
  if (r < 0) r += this.realCount;
  return r;
};

Slider.prototype.goTo = function (realIndex, animate) {
  if (animate == null) animate = true;
  var target;

  if (this.opts.loop) {
    target = realIndex + this.loopOffset;
  } else {
    var max = Math.max(0, this.realCount - Math.floor(this.effectiveSpv || 1));
    target = clamp(realIndex, 0, max);
  }

  this.index = target;
  this.realIndex = this._realIndexFromDisplayed(target);
  var x = -target * this.slideSize;
  this._setTranslate(x, animate);
  this._updateState();
};

Slider.prototype.next = function () { this.goTo(this.realIndex + 1, true); };
Slider.prototype.prev = function () { this.goTo(this.realIndex - 1, true); };

// After a loop wrap, jump instantly back to the equivalent real position.
Slider.prototype._handleLoopWrap = function () {
  if (!this.opts.loop) return;
  var max = this.loopOffset + this.realCount; // exclusive
  if (this.index >= max) {
    this.index -= this.realCount;
    this._setTranslate(-this.index * this.slideSize, false);
  } else if (this.index < this.loopOffset) {
    this.index += this.realCount;
    this._setTranslate(-this.index * this.slideSize, false);
  }
};

// ── State: nav disabled, active bullet/slide, numbers, scrollbar ─────────
Slider.prototype._updateState = function () {
  for (var i = 0; i < this.items.length; i++) {
    this.items[i].classList.toggle("is-active", i === this.index);
  }
  if (this.bullets) {
    for (var b = 0; b < this.bullets.length; b++) {
      this.bullets[b].classList.toggle("is-active", b === this.realIndex);
    }
  }
  if (!this.opts.loop) {
    var maxReal = Math.max(0, this.realCount - Math.floor(this.effectiveSpv || 1));
    if (this.prevEl) this.prevEl.classList.toggle("is-disabled", this.realIndex <= 0);
    if (this.nextEl) this.nextEl.classList.toggle("is-disabled", this.realIndex >= maxReal);
  }
  var curStr = this.opts.padNumbers ? pad(this.realIndex + 1) : String(this.realIndex + 1);
  for (var c = 0; c < this.currentEls.length; c++) this.currentEls[c].textContent = curStr;

  this._updateScrollbar(true);
  this._updateProgress(true);
  this._updateA11y();
};

// ── Progress bar ─────────────────────────────────────────────────────────
// Fills from 0% (first slide) to 100% (last slide in the set).
// Progress is based on which individual slide is active (realIndex),
// NOT on the scroll-bound. So with 5 slides & 3 visible, slide 1 = 0%,
// slide 3 = 50%, slide 5 = 100%.
Slider.prototype._updateProgress = function (animate) {
  if (!this.progressFillEl) return;
  var maxSlide = Math.max(1, this.realCount - 1);
  var pct = clamp(this.realIndex / maxSlide, 0, 1) * 100;

  this.progressFillEl.style.transition = animate
    ? "width " + this.opts.duration + "ms " + this.opts.easing
    : "none";
  this.progressFillEl.style.width = pct + "%";
};

// Called during slide-drag so progress follows in real time.
Slider.prototype._updateProgressFromTranslate = function (tx) {
  if (!this.progressFillEl) return;
  var maxSlide = Math.max(1, this.realCount - 1);
  var totalTravel = maxSlide * this.slideSize;
  if (totalTravel <= 0) return;

  var adjusted = -(tx + this.loopOffset * this.slideSize);
  var pct = clamp(adjusted / totalTravel, 0, 1) * 100;

  this.progressFillEl.style.transition = "none";
  this.progressFillEl.style.width = pct + "%";
};

// animate = true  → thumb slides with same easing as the slider
// animate = false → instant (used during drag)
// Scrollbar tracks individual slides (like progress), NOT the scroll-bound.
// With 5 slides & 3 visible: slide 1 → thumb at 0%, slide 5 → thumb at 100%.
Slider.prototype._updateScrollbar = function (animate) {
  if (!this.scrollbarThumbEl || !this.scrollbarEl) return;
  var spv = this.effectiveSpv || 1;
  var ratio = clamp(spv / this.realCount, 0.05, 1);
  var trackW = this.scrollbarEl.clientWidth;
  var thumbW = trackW * ratio;
  var maxSlide = Math.max(1, this.realCount - 1);
  var progress = this.realCount <= 1 ? 0 : this.realIndex / maxSlide;
  var x = (trackW - thumbW) * progress;

  this.scrollbarThumbEl.style.width = thumbW + "px";
  this.scrollbarThumbEl.style.transition = animate
    ? "transform " + this.opts.duration + "ms " + this.opts.easing
    : "none";
  this.scrollbarThumbEl.style.transform = "translate3d(" + x + "px, 0, 0)";

  // Cache for drag math
  this._scrollbarTrackW = trackW;
  this._scrollbarThumbW = thumbW;
};

// Map an arbitrary translate value to a scrollbar thumb position (instant).
// Called during slide-drag so the scrollbar follows your finger in real time.
Slider.prototype._updateScrollbarFromTranslate = function (tx) {
  if (!this.scrollbarThumbEl || !this.scrollbarEl) return;
  var trackW = this._scrollbarTrackW || this.scrollbarEl.clientWidth;
  var thumbW = this._scrollbarThumbW || 40;
  var maxThumbX = trackW - thumbW;
  if (maxThumbX <= 0) return;

  // Total travel based on individual slides, not scroll-bound
  var maxSlide = Math.max(1, this.realCount - 1);
  var totalTravel = maxSlide * this.slideSize;
  if (totalTravel <= 0) return;

  // In loop mode, adjust for the clone offset
  var adjusted = -(tx + this.loopOffset * this.slideSize);
  var progress = clamp(adjusted / totalTravel, 0, 1);

  this.scrollbarThumbEl.style.transition = "none";
  this.scrollbarThumbEl.style.transform =
    "translate3d(" + (maxThumbX * progress) + "px, 0, 0)";
};

// ── Scrollbar drag ────────────────────────────────────────────────────────
Slider.prototype._bindScrollbarDrag = function () {
  if (!this.scrollbarEl || !this.scrollbarThumbEl) return;
  var self = this;
  var dragging = false;
  var startX = 0;
  var startThumbX = 0;

  // touchAction:none on thumb so drag works on touch devices
  this.scrollbarThumbEl.style.touchAction = "none";

  function getThumbX() {
    var m = self.scrollbarThumbEl.style.transform.match(/translate3d\(([^,]+)/);
    return m ? parseFloat(m[1]) : 0;
  }

  function onDown(e) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startX = e.clientX;
    startThumbX = getThumbX();
    self.root.classList.add("is-dragging");
    self._stopAutoplay();
    try { self.scrollbarEl.setPointerCapture(e.pointerId); } catch (err) {}
  }

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    var dx = e.clientX - startX;
    var trackW = self._scrollbarTrackW || self.scrollbarEl.clientWidth;
    var thumbW = self._scrollbarThumbW || 40;
    var maxThumbX = trackW - thumbW;
    if (maxThumbX <= 0) return;

    var newX = clamp(startThumbX + dx, 0, maxThumbX);
    var progress = newX / maxThumbX; // 0..1

    // Move thumb instantly (no transition)
    self.scrollbarThumbEl.style.transition = "none";
    self.scrollbarThumbEl.style.transform = "translate3d(" + newX + "px, 0, 0)";

    // Move slides CONTINUOUSLY — smooth, no snapping during drag.
    // The thumb position maps to a fractional slide index.
    var maxSlide = Math.max(1, self.realCount - 1);
    var continuousSlide = progress * maxSlide;
    var translateX = -(continuousSlide + self.loopOffset) * self.slideSize;
    self.list.style.transition = "none";
    self.list.style.transform = "translate3d(" + translateX + "px, 0, 0)";
    self.translate = translateX;

    // Update realIndex for counter (this one does snap — integers only)
    var snappedReal = Math.round(continuousSlide);
    if (snappedReal !== self.realIndex) {
      self.realIndex = snappedReal;
      self.index = snappedReal + self.loopOffset;

      // Update counter + bullets + active slide
      for (var i = 0; i < self.items.length; i++) {
        self.items[i].classList.toggle("is-active", i === self.index);
      }
      if (self.bullets) {
        for (var b = 0; b < self.bullets.length; b++) {
          self.bullets[b].classList.toggle("is-active", b === self.realIndex);
        }
      }
      var curStr = self.opts.padNumbers ? pad(self.realIndex + 1) : String(self.realIndex + 1);
      for (var c = 0; c < self.currentEls.length; c++) self.currentEls[c].textContent = curStr;
    }

    // Update progress bar continuously
    if (self.progressFillEl) {
      var pct = clamp(progress, 0, 1) * 100;
      self.progressFillEl.style.transition = "none";
      self.progressFillEl.style.width = pct + "%";
    }
  }

  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    self.root.classList.remove("is-dragging");
    try { self.scrollbarEl.releasePointerCapture(e.pointerId); } catch (err) {}

    // Snap to nearest slide with smooth animation
    self.goTo(self.realIndex, true);
    self._restartAutoplay();
  }

  this.scrollbarEl.addEventListener("pointerdown", onDown);
  this.scrollbarEl.addEventListener("pointermove", onMove);
  this.scrollbarEl.addEventListener("pointerup", onUp);
  this.scrollbarEl.addEventListener("pointercancel", onUp);

  // Clicking on the track (outside thumb) jumps to that position
  this.scrollbarEl.addEventListener("click", function (e) {
    if (dragging) return;
    if (e.target === self.scrollbarThumbEl) return;
    var rect = self.scrollbarEl.getBoundingClientRect();
    var clickX = e.clientX - rect.left;
    var trackW = self._scrollbarTrackW || self.scrollbarEl.clientWidth;
    var thumbW = self._scrollbarThumbW || 40;
    var maxThumbX = trackW - thumbW;
    if (maxThumbX <= 0) return;

    // Center the thumb on click position
    var newX = clamp(clickX - thumbW / 2, 0, maxThumbX);
    var progress = newX / maxThumbX;
    var maxSlide = Math.max(1, self.realCount - 1);
    var targetReal = Math.round(progress * maxSlide);
    self.goTo(targetReal, true);
    self._restartAutoplay();
  });
};

// ── Controls (nav + bullet clicks) ───────────────────────────────────────
Slider.prototype._bindControls = function () {
  var self = this;
  this.prevEl = scopedQuery(this.root, "[" + ATTR.element + "='prev']")[0] || null;
  this.nextEl = scopedQuery(this.root, "[" + ATTR.element + "='next']")[0] || null;

  if (this.prevEl) this.prevEl.addEventListener("click", function (e) {
    e.preventDefault();
    self.prev();
    self._restartAutoplay();
  });
  if (this.nextEl) this.nextEl.addEventListener("click", function (e) {
    e.preventDefault();
    self.next();
    self._restartAutoplay();
  });

  if (this.bullets && this.opts.paginationClickable) {
    for (var i = 0; i < this.bullets.length; i++) {
      (function (idx) {
        self.bullets[idx].addEventListener("click", function (e) {
          e.preventDefault();
          self.goTo(idx, true);
          self._restartAutoplay();
        });
      })(i);
    }
  }

  this.list.addEventListener("transitionend", function (e) {
    if (e.target !== self.list || e.propertyName !== "transform") return;
    self._handleLoopWrap();
  });
};

// ── Pointer / drag ───────────────────────────────────────────────────────
// Uses Swiper-inspired "allowClick" pattern:
//   - pointerdown on the wrapper: record start, set allowClick = true
//   - pointermove on document: once threshold exceeded, allowClick = false
//   - click handler (capture phase): if !allowClick → swallow the click
// No setPointerCapture, no preventDefault on pointerdown, no forced styles.
// Links, hover interactions, and Webflow IX all work normally.
Slider.prototype._bindPointer = function () {
  var self = this;
  var wrapper = this.list.parentElement || this.list;
  var allowClick = true;
  var tracking = false;

  // ── Click gate (capture phase) ────────────────────────────────────
  // Registered once — stays active. Only blocks clicks after a real drag.
  wrapper.addEventListener("click", function (e) {
    if (!allowClick) {
      e.preventDefault();
      e.stopPropagation();
      // Reset after swallowing so the next tap works
      allowClick = true;
    }
  }, true);

  function onDown(e) {
    if (e.button != null && e.button !== 0) return;
    tracking = true;
    allowClick = true;
    self.isDragging = false;
    self.dragMoved = false;
    self.dragStart = e.clientX;
    self.dragLastX = e.clientX;
    self.dragLastT = performance.now();
    self.dragVelocity = 0;
    self.startTranslate = self.translate;

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  function onMove(e) {
    if (!tracking) return;
    var dx = e.clientX - self.dragStart;

    // ── Before threshold ────────────────────────────────────────────
    if (!self.isDragging) {
      if (Math.abs(dx) < self.opts.threshold) return;

      // Threshold exceeded → enter drag mode
      self.isDragging = true;
      self.dragMoved = true;
      allowClick = false; // ← this is the key: block the upcoming click
      self.list.style.transition = "none";
      self.root.classList.add("is-dragging");
      self._stopAutoplay();
    }

    // ── Active drag ─────────────────────────────────────────────────
    var now = performance.now();
    var dt = now - self.dragLastT;
    if (dt > 0) self.dragVelocity = (e.clientX - self.dragLastX) / dt;
    self.dragLastX = e.clientX;
    self.dragLastT = now;

    var next = self.startTranslate + dx;

    if (!self.opts.loop) {
      var minX = -(self.items.length - 1) * self.slideSize;
      if (next > 0) next = next * 0.35;
      else if (next < minX) next = minX + (next - minX) * 0.35;
    }

    self.list.style.transform = "translate3d(" + next + "px, 0, 0)";
    self.translate = next;

    self._updateScrollbarFromTranslate(next);
    self._updateProgressFromTranslate(next);
  }

  function onUp(e) {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);

    var wasDragging = self.isDragging;
    self.isDragging = false;
    self.root.classList.remove("is-dragging");
    tracking = false;

    // Tap/click — let the native event chain handle it
    if (!wasDragging) return;

    // ── Drag release: snap to nearest slide ─────────────────────────
    var moved = self.translate - self.startTranslate;
    var velocityPxMs = self.dragVelocity;
    var projected = moved + velocityPxMs * 120;
    var stepDelta = -projected / self.slideSize;

    var direction;
    if (Math.abs(stepDelta) < 0.15 && Math.abs(velocityPxMs) < 0.2) {
      direction = 0;
    } else {
      direction = stepDelta > 0 ? Math.ceil(stepDelta) : Math.floor(stepDelta);
    }

    var targetDisplayed = self.index + direction;
    if (!self.opts.loop) {
      var maxDisp = Math.max(0, self.realCount - Math.floor(self.effectiveSpv || 1));
      targetDisplayed = clamp(targetDisplayed, 0, maxDisp);
    }

    if (self.opts.loop) {
      self.index = targetDisplayed;
      self.realIndex = self._realIndexFromDisplayed(targetDisplayed);
      self._setTranslate(-self.index * self.slideSize, true);
      self._updateState();
    } else {
      self.goTo(targetDisplayed, true);
    }

    self._restartAutoplay();
  }

  // pointerdown on the wrapper (slider_list-wrapper), NOT the root
  wrapper.addEventListener("pointerdown", onDown);

  // Prevent native image dragging from hijacking pointer events in Safari
  var imgs = this.list.querySelectorAll("img");
  for (var i = 0; i < imgs.length; i++) {
    imgs[i].setAttribute("draggable", "false");
  }
};

// ── Resize handling ──────────────────────────────────────────────────────
Slider.prototype._bindResize = function () {
  var self = this;
  function onResize() {
    cancelAnimationFrame(self.resizeRaf);
    self.resizeRaf = requestAnimationFrame(function () {
      self._applyBreakpoint();
      self.layout(false);
    });
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
};

// ── Pause when tab/page is hidden (Safari battery friendly) ──────────────
Slider.prototype._bindVisibility = function () {
  var self = this;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) self._stopAutoplay();
    else self._startAutoplay();
  });

  if (this.opts.pauseOnHover && this.opts.autoplayMs > 0) {
    this.root.addEventListener("mouseenter", function () { self._stopAutoplay(); });
    this.root.addEventListener("mouseleave", function () { self._startAutoplay(); });
  }
};

// ── Autoplay ─────────────────────────────────────────────────────────────
Slider.prototype._startAutoplay = function () {
  if (this.opts.autoplayMs <= 0) return;
  if (this.autoplayTimer) return;
  var self = this;
  this.autoplayTimer = setInterval(function () {
    if (!self.opts.loop) {
      var maxAuto = Math.max(0, self.realCount - Math.floor(self.effectiveSpv || 1));
      if (self.realIndex >= maxAuto) {
        self.goTo(0, true);
        return;
      }
    }
    self.next();
  }, this.opts.autoplayMs);
};
Slider.prototype._stopAutoplay = function () {
  if (this.autoplayTimer) {
    clearInterval(this.autoplayTimer);
    this.autoplayTimer = null;
  }
};
Slider.prototype._restartAutoplay = function () {
  this._stopAutoplay();
  this._startAutoplay();
};

// ── Public destroy (handy for Webflow CMS re-renders) ───────────────────
Slider.prototype.destroy = function () {
  this._stopAutoplay();
  var clones = this.root.querySelectorAll("[zh-slider-clone='true']");
  for (var i = 0; i < clones.length; i++) clones[i].parentNode.removeChild(clones[i]);
  this.list.style.transform = "";
  this.list.style.transition = "";
  this.list.style.willChange = "";
  this.root.classList.remove("is-dragging");
  if (this._skipLink && this._skipLink.parentNode) this._skipLink.parentNode.removeChild(this._skipLink);
  if (this._skipTarget && this._skipTarget.parentNode) this._skipTarget.parentNode.removeChild(this._skipTarget);
  this.root.__zhSliderInit = false;
  delete this.root.__zhSlider;
};

// ───────────────────────────────────────────────────────────────────────────
// Bootstrap
// ───────────────────────────────────────────────────────────────────────────
function bootstrap() {
  var roots = document.querySelectorAll("[" + ATTR.root + "]");
  for (var i = 0; i < roots.length; i++) {
    var r = roots[i];
    if (r.__zhSliderInit) continue;
    r.__zhSliderInit = true;
    try {
      new Slider(r);
    } catch (err) {
      console.error("[zh-slider] init failed", r, err);
    }
  }
}

// ── Public API (exposed on window AND as ES module exports) ─────────────
window.Zweihander = window.Zweihander || {};
window.Zweihander.slider = {
  init: bootstrap,
  initOne: function (el) {
    if (!el || el.__zhSliderInit) return null;
    el.__zhSliderInit = true;
    return new Slider(el);
  },
  get: function (name) {
    var el = document.querySelector("[" + ATTR.root + "='" + name + "']");
    return el ? el.__zhSlider : null;
  },
  destroy: function (name) {
    var inst = this.get(name);
    if (inst) inst.destroy();
  },
};

// Named exports for the loader
export { bootstrap as init };
