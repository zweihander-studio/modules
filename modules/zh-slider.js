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
 *     <!-- Timeline: per-slide progress bars (gallery-style autoplay) -->
 *     <div zh-slider-element="timeline">
 *       <div zh-slider-element="timeline-fill"></div>
 *     </div>
 *     <!-- Repeat for each slide, or use a CMS collection list -->
 *
 *     <div zh-slider-current="hero">1</div>
 *     <div zh-slider-total="hero">1</div>
 *   </div>
 *
 * Marquee (continuous scroll, e.g. a logo wall; arrows, drag and
 * pause-on-hover keep working):
 *   <div zh-slider="logos" zh-slider-marquee="40">…</div>
 *
 * Centered (active slide in the middle, also on load):
 *   <div zh-slider="cases" zh-slider-center="true">…</div>
 *
 * Style it however you like in Webflow. The script only sets dynamic
 * transform/transition values inline and toggles a few state classes:
 *   - is-active   on current pagination bullet, slide & timeline item
 *   - is-past     on timeline items before the current slide
 *   - is-disabled on nav buttons at the bounds (when not looping)
 *   - is-dragging on the root while user is interacting
 *   - is-static   on the root when every slide fits (navigation hidden)
 *   - is-empty    on the root when there are no slides (navigation hidden)
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
// On/off-or-number attribute (autoplay, marquee):
//   absent, "false", "0"  → 0 (off)
//   "true" or empty       → onValue (the default when switched on)
//   a number              → that number
function attrToggleNumber(el, name, onValue) {
  if (!el || !el.hasAttribute(name)) return 0;
  var raw = (el.getAttribute(name) || "").trim().toLowerCase();
  if (raw === "" || raw === "true") return onValue;
  if (raw === "false") return 0;
  var n = parseFloat(raw);
  return isNaN(n) || n < 0 ? 0 : n;
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

// Navigation that only makes sense when there's something to slide to.
// [zh-slider-element="controls"] is an optional wrapper (e.g. around
// "01 / 05 ← →") so the whole group, separators included, hides at once.
var CONTROL_SELECTOR = ["controls", "prev", "next", "pagination", "progress", "scrollbar"]
  .map(function (n) { return "[" + ATTR.element + "='" + n + "']"; })
  .concat(["[" + ATTR.numberCurrent + "]", "[" + ATTR.numberTotal + "]"])
  .join(", ");

// Hide/show with display:none, restoring whatever inline display was there.
function setHidden(el, hidden) {
  if (hidden) {
    if (el.__zhDisplay === undefined) el.__zhDisplay = el.style.display;
    el.style.display = "none";
  } else if (el.__zhDisplay !== undefined) {
    el.style.display = el.__zhDisplay;
    delete el.__zhDisplay;
  }
}

// Counters usually sit in one text element like <p>01 / 05</p>. Hiding
// just the numbers would leave the "/" behind, so when a counter's parent
// holds nothing but counters (and text), hide that parent instead.
function controlTarget(el) {
  if (!el.hasAttribute(ATTR.numberCurrent) && !el.hasAttribute(ATTR.numberTotal)) return el;
  var parent = el.parentElement;
  if (!parent || parent.hasAttribute(ATTR.root)) return el;
  var kids = parent.children;
  for (var i = 0; i < kids.length; i++) {
    if (!kids[i].hasAttribute(ATTR.numberCurrent) && !kids[i].hasAttribute(ATTR.numberTotal)) return el;
  }
  return parent;
}

function setControlsHidden(root, hidden) {
  var els = scopedQuery(root, CONTROL_SELECTOR);
  for (var i = 0; i < els.length; i++) setHidden(controlTarget(els[i]), hidden);
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
    // An empty CMS list is normal: hide the navigation rather than
    // leaving "01 / 00" and dead arrows on the page.
    root.classList.add("is-empty");
    if (attrBool(root, "zh-slider-auto-hide", true)) setControlsHidden(root, true);
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
  this.centerOffset = 0;     // px shift that centers the active slide (center mode)
  this.items = [];           // displayed items (incl. clones if loop)
  this.loopOffset = 0;       // number of cloned slides at the start
  this.isStatic = false;     // every slide fits: nothing to navigate
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
  this._initMarquee();
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

  // Marquee: continuous linear scroll in px/second. It needs the loop
  // clones and replaces autoplay, so it forces loop on and autoplay off.
  // Under reduced motion it stays a marquee-style slider that doesn't move
  // on its own (speed 0), so the arrows and drag keep working.
  var marqueeSpeed = attrToggleNumber(r, "zh-slider-marquee", 50);
  var marquee = marqueeSpeed > 0;

  return {
    marquee: marquee,
    marqueeSpeed: reducedMotion ? 0 : marqueeSpeed,
    loop: marquee || attrBool(r, "zh-slider-loop", false),
    // Center: the active slide sits in the middle instead of on the left.
    center: attrBool(r, "zh-slider-center", false),
    duration: reducedMotion ? 0 : attrNumber(r, "zh-slider-duration", 500),
    slidesPerView: this._parseSpv(attr(r, "zh-slider-per-view", "1")),
    perViewSet: r.hasAttribute("zh-slider-per-view"),
    spaceBetween: attrNumber(r, "zh-slider-gap", 0),
    gapSet: r.hasAttribute("zh-slider-gap"),
    autoplayMs: reducedMotion || marquee ? 0 : attrToggleNumber(r, "zh-slider-autoplay", 4000),
    skipLink: attrBool(r, "zh-slider-skiplink", false),
    syncTo: attr(r, "zh-slider-sync", null),
    // A marquee pauses on hover by default so people can click a card.
    pauseOnHover: attrBool(r, "zh-slider-pause-on-hover", marquee),
    drag: attrBool(r, "zh-slider-drag", true),
    // Hide navigation and stand still when every slide already fits.
    autoHide: attrBool(r, "zh-slider-auto-hide", true),
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

    // A marquee can show any stretch of the list at any moment, so the
    // clones after the real set must cover the full width plus one step.
    // A few narrow logos on a wide screen need several copies of the set.
    if (this.opts.marquee) {
      if (this.opts.perViewSet && this.opts.slidesPerView !== "auto") {
        this.loopOffset = spv + 1;
      } else {
        var copies = this._marqueeCopiesNeeded();
        this.loopOffset = this.realCount * copies;
      }
    }

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

  // Timeline: per-slide progress bars (gallery-style autoplay).
  // Each timeline item corresponds to one real slide.
  // When autoplay is active, the current item's fill animates from 0% to 100%
  // over the autoplay duration. On completion, the slider advances.
  // Clicking a timeline item jumps to that slide.
  //
  // Two ways to hook up timeline items:
  //   1. Inside the slider root: [zh-slider-element="timeline"] (scoped)
  //   2. Anywhere on the page: [zh-slider-timeline="sliderName"] (global)
  //      — useful when the timeline lives outside the slider wrapper
  //      (e.g. a sibling progress bar component).
  this.timelineItems = scopedQuery(root, "[" + ATTR.element + "='timeline']");
  if (!this.timelineItems.length && this.name) {
    this.timelineItems = Array.prototype.slice.call(
      document.querySelectorAll("[zh-slider-timeline='" + this.name + "']")
    );
  }
  this.timelineFills = [];
  for (var ti = 0; ti < this.timelineItems.length; ti++) {
    var fill = this.timelineItems[ti].querySelector(
      "[" + ATTR.element + "='timeline-fill'], [zh-slider-timeline-fill]"
    );
    if (!fill) {
      fill = document.createElement("div");
      fill.setAttribute(ATTR.element, "timeline-fill");
      this.timelineItems[ti].appendChild(fill);
    }
    this.timelineFills.push(fill);
  }
  this._hasTimeline = this.timelineItems.length > 0;

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

  // 2. Slide list is a live region — polite so it doesn't interrupt.
  //    Strip any inherited role="list" (e.g. from Webflow CMS collection
  //    lists). The W3C APG carousel pattern uses role="group" on slides,
  //    not role="listitem", so role="list" on the wrapper creates a
  //    mismatch that screenreaders flag as an error.
  if (this.list.getAttribute("role") === "list") {
    this.list.removeAttribute("role");
  }
  // Webflow CMS often wraps items in a .w-dyn-items div with role="list".
  // If that sits between the list and the items, strip its role too.
  var innerList = this.list.querySelector("[role='list']");
  if (innerList) innerList.removeAttribute("role");

  this.list.setAttribute("aria-live", "off"); // "off" during drag/autoplay, "polite" when idle
  this.list.setAttribute("aria-atomic", "false");

  // 3. Each slide (real + clones) gets role="group" so the W3C APG
  //    carousel pattern is consistent — overrides any role="listitem"
  //    Webflow CMS added. Clones keep aria-hidden="true" (set earlier)
  //    and don't get an aria-label so they're invisible to screenreaders.
  for (var i = 0; i < this.originalItems.length; i++) {
    var slide = this.originalItems[i];
    slide.setAttribute("role", "group");
    slide.setAttribute("aria-roledescription", "slide");
    slide.setAttribute("aria-label", (i + 1) + " of " + this.realCount);
  }
  // Also fix up any cloned slides (loop mode)
  for (var ci = 0; ci < this.items.length; ci++) {
    var it = this.items[ci];
    if (it.getAttribute("zh-slider-clone") === "true") {
      it.setAttribute("role", "group");
      it.setAttribute("aria-roledescription", "slide");
    }
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
  // Skip link is opt-in: only create when zh-slider-skiplink="true"
  // or when a [zh-slider-skip] element already exists in the markup.
  var hasManualSkip = !!this.root.querySelector("[zh-slider-skip]");
  if (!this.opts.skipLink && !hasManualSkip) return;

  var root = this.root;
  var list = this.list;
  var listWrapper = list.parentElement || list;
  var autoCreated = false;

  // ── Skip target: invisible anchor right after the slide list ──────
  var skipTargetId = "zh-skip-" + (this.name || Math.random().toString(36).substr(2, 8));
  var skipTarget = document.createElement("span");
  skipTarget.id = skipTargetId;
  skipTarget.setAttribute("tabindex", "-1");
  skipTarget.setAttribute("aria-hidden", "true");
  skipTarget.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);";

  // Walk up from listWrapper to find the direct child of root, then
  // insert after that. This handles nested wrappers like
  //   root > gallery_bg > list-wrapper > list
  var insertAfter = listWrapper;
  while (insertAfter.parentElement && insertAfter.parentElement !== root) {
    insertAfter = insertAfter.parentElement;
  }
  if (insertAfter.nextSibling) {
    root.insertBefore(skipTarget, insertAfter.nextSibling);
  } else {
    root.appendChild(skipTarget);
  }

  // ── Skip link: use existing [zh-slider-skip] or auto-create ───────
  var skipLink = root.querySelector("[zh-slider-skip]");

  if (skipLink) {
    // User placed their own element in Webflow — just wire up the behavior.
    // No inline styles are forced. Style it however you want in Webflow.
    // The script only adds sr-only behavior via a class toggle.
    autoCreated = false;
  } else {
    // No element found — auto-create a minimal skip link
    autoCreated = true;
    var skipText = root.getAttribute("zh-slider-skip-text");
    if (!skipText) {
      var name = this.name || "slider";
      skipText = "Skip " + name + " list";
    }

    skipLink = document.createElement("a");
    skipLink.textContent = skipText;
    skipLink.setAttribute("zh-slider-skip", "");
    root.insertBefore(skipLink, root.firstChild);

    // Auto-created: use sr-only pattern (hidden until focused)
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
  }

  // Wire up the skip behavior (works for both custom and auto-created)
  skipLink.setAttribute("role", "link");
  skipLink.setAttribute("href", "#" + skipTargetId);
  if (!skipLink.getAttribute("tabindex")) skipLink.setAttribute("tabindex", "0");

  skipLink.addEventListener("click", function (e) {
    e.preventDefault();
    var target = document.getElementById(skipTargetId);
    if (target) target.focus();
  });

  skipLink.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      var target = document.getElementById(skipTargetId);
      if (target) target.focus();
    }
  });

  // Store references for cleanup
  this._skipLink = skipLink;
  this._skipTarget = skipTarget;
  this._skipAutoCreated = autoCreated;
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
    if (this.opts.center) {
      var half = (spv - 1) / 2;
      visible = i >= this.index - Math.floor(half) && i <= this.index + Math.ceil(half);
    }
    // A marquee is always moving, so "visible" can't be tracked per slide:
    // expose every real card, keep the clones hidden.
    if (this.opts.marquee) visible = this.items[i].getAttribute("zh-slider-clone") !== "true";
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
    if (self.isStatic) return;
    if (self.opts.marquee) {
      if (e.key === "ArrowLeft") { e.preventDefault(); self.prev(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); self.next(); }
      return;
    }
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
    if (self.isStatic) return;
    // Marquee: stop moving while keyboard focus is inside (WCAG 2.2.2)
    // and bring a focused card into view if it's partly off-screen.
    // Mouse clicks also move focus (e.g. onto an arrow button); those are
    // ignored, otherwise the marquee would stay frozen after a click.
    if (self.opts.marquee) {
      var keyboard = true;
      try { keyboard = e.target.matches(":focus-visible"); } catch (err) {}
      if (!keyboard) return;
      self._marqueeSetPaused("focus", true);
      var card = e.target.closest("[" + ATTR.item + "]");
      if (card) self._marqueeReveal(card);
      return;
    }

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
        self._setTranslate(self._posFor(self.index), true);
        self._updateState();
      } else {
        self.goTo(idx, true);
      }
    }

    // Pause autoplay while slider has focus (WCAG 2.2.2)
    self._stopAutoplay();
  });

  if (this.opts.marquee) {
    this.root.addEventListener("focusout", function (e) {
      if (!e.relatedTarget || !self.root.contains(e.relatedTarget)) {
        self._marqueeSetPaused("focus", false);
      }
    });
  }

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


  // Nothing to slide? Every real slide fits (a CMS list with two items,
  // or CSS showing all of them at this breakpoint). Then hide the
  // navigation and stand still. Re-checked on every resize, so it follows
  // CSS breakpoints. A marquee keeps moving: its motion is the point.
  var wasStatic = this.isStatic;
  this._setStatic(this._realSlidesFit());
  if (this.isStatic) {
    // Center mode centers the group; otherwise it sits on the left.
    var spare = this.opts.center ? (this.containerSize - this._realWidth) / 2 : 0;
    this.translate = spare;
    this.list.style.transition = "none";
    this.list.style.transform = spare ? "translate3d(" + spare + "px, 0, 0)" : "";
    return;
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

  // 5. Center mode: shift so the active slide's middle meets the container's.
  this.centerOffset = 0;
  if (this.opts.center && this.items.length) {
    var w = this.items[0].getBoundingClientRect().width;
    this.centerOffset = (this.containerSize - w) / 2;
  }

  if (this._mq) {
    this._marqueeMeasure();
  } else if (!silent || wasStatic) {
    this.goTo(this.realIndex, false);
  }
  this._updateScrollbar(false);
  this._updateProgress(false);
  if (wasStatic) this._startAutoplay();
};

// Width of the real slides (clones ignored) and whether it fits.
Slider.prototype._realSlidesFit = function () {
  // Not rendered yet (hidden tab, display:none): can't tell, so don't
  // hide anything. The ResizeObserver lays out again once it shows.
  if (!this.opts.autoHide || this.opts.marquee || !this.containerSize) return false;
  var first = this.originalItems[0].getBoundingClientRect();
  var last = this.originalItems[this.realCount - 1].getBoundingClientRect();
  this._realWidth = last.right - first.left;
  return this._realWidth <= this.containerSize + 1;
};

Slider.prototype._setStatic = function (on) {
  if (on === this.isStatic) return;
  this.isStatic = on;
  this.root.classList.toggle("is-static", on);
  setControlsHidden(this.root, on);
  // Loop clones would show up as duplicates next to the real slides.
  for (var i = 0; i < this.items.length; i++) {
    if (this.items[i].getAttribute("zh-slider-clone") === "true") setHidden(this.items[i], on);
  }
  if (on) {
    this._stopAutoplay();
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    this.realIndex = 0;
    this.index = this.loopOffset;
    // Every real slide is on screen now, so none should be hidden from
    // screen readers.
    for (var r = 0; r < this.originalItems.length; r++) {
      this.originalItems[r].setAttribute("aria-hidden", "false");
    }
  }
};

// ── Movement ──────────────────────────────────────────────────────────────
// flickVelocity (px/ms, optional): after a swipe, shorten the glide so it
// starts at the speed the finger let go with instead of braking first.
Slider.prototype._setTranslate = function (px, animate, flickVelocity) {
  var self = this;
  if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }

  if (!animate || this.opts.duration <= 0) {
    // Instant jump — no animation
    this.translate = px;
    this.list.style.transition = "none";
    this.list.style.transform = "translate3d(" + px + "px, 0, 0)";
    return;
  }

  // rAF-based animation — smoother than CSS transitions on mobile Safari.
  // CSS transitions on translate3d cause sub-pixel jank for position:absolute
  // children. rAF lets the browser composite everything in one pass per frame.
  var from = this.translate;
  var dist = px - from;
  var duration = this.opts.duration;
  var start = null;
  this.list.style.transition = "none";

  var ease = this._getEasing(this.opts.easing);

  if (flickVelocity && Math.abs(flickVelocity) > 0.05 && dist !== 0) {
    var startSlope = ease(0.02) / 0.02; // how fast the curve leaves 0
    duration = clamp(Math.abs(dist) * startSlope / Math.abs(flickVelocity), 180, duration);
  }

  function step(ts) {
    // Count the first frame as already elapsed, so the glide moves right
    // away instead of holding still for one frame after a release.
    if (!start) start = ts - 1000 / 60;
    var elapsed = ts - start;
    var t = Math.min(elapsed / duration, 1);
    var val = from + dist * ease(t);
    self.translate = val;
    self.list.style.transform = "translate3d(" + val + "px, 0, 0)";

    if (t < 1) {
      self._rafId = requestAnimationFrame(step);
    } else {
      self.translate = px;
      self.list.style.transform = "translate3d(" + px + "px, 0, 0)";
      self._rafId = null;
      self._handleLoopWrap();
    }
  }

  this._rafId = requestAnimationFrame(step);
};

// CSS cubic-bezier() as a JS function of progress t (0..1), solved the
// way browsers do it (Newton steps, bisection as a fallback).
function cubicBezier(x1, y1, x2, y2) {
  var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  function curveX(t) { return ((ax * t + bx) * t + cx) * t; }
  function curveY(t) { return ((ay * t + by) * t + cy) * t; }
  function slopeX(t) { return (3 * ax * t + 2 * bx) * t + cx; }
  function solveT(x) {
    var t = x, i;
    for (i = 0; i < 8; i++) {
      var err = curveX(t) - x;
      if (Math.abs(err) < 1e-6) return t;
      var d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    var lo = 0, hi = 1;
    t = x;
    for (i = 0; i < 30; i++) {
      var v = curveX(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (x > v) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  }
  return function (t) { return t <= 0 ? 0 : t >= 1 ? 1 : curveY(solveT(t)); };
}

var NAMED_EASINGS = {
  "ease": [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

// Turn the zh-slider-easing value into a JS function. Accepts the CSS
// keywords and cubic-bezier(); anything else falls back to the default
// ease-out, so a release never starts slower than the finger was moving.
Slider.prototype._getEasing = function (css) {
  var v = String(css || "").trim().toLowerCase();
  if (v === "linear") return function (t) { return t; };
  var pts = NAMED_EASINGS[v];
  var m = v.match(/^cubic-bezier\(([^)]+)\)$/);
  if (m) {
    var n = m[1].split(",").map(parseFloat);
    if (n.length === 4 && !n.some(isNaN)) pts = n;
  }
  if (!pts) pts = [0.22, 0.61, 0.36, 1];
  return cubicBezier(pts[0], pts[1], pts[2], pts[3]);
};

// Translate that puts displayed slide `idx` in its resting spot: on the
// left edge, or in the middle when zh-slider-center is on.
Slider.prototype._posFor = function (idx) {
  return -idx * this.slideSize + this.centerOffset;
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

Slider.prototype.goTo = function (realIndex, animate, flickVelocity) {
  if (this.isStatic) return;
  if (this._mq) return this._marqueeGoTo(realIndex);
  if (animate == null) animate = true;
  var target;

  if (this.opts.loop) {
    // One step past either end is fine (that's the clone we glide onto);
    // anything further is folded back into the real set.
    if (realIndex > this.realCount || realIndex < -1) {
      realIndex = ((realIndex % this.realCount) + this.realCount) % this.realCount;
    }
    target = realIndex + this.loopOffset;
  } else {
    // Allow navigating to every real slide (0 … realCount-1).
    target = clamp(realIndex, 0, this.realCount - 1);
  }

  this.index = target;
  this.realIndex = this._realIndexFromDisplayed(target);

  // Calculate translate, but clamp so the last slide sits flush
  // against the right edge — no empty space beyond the last card.
  var x = this._posFor(target);
  if (!this.opts.loop && !this.opts.center) {
    var maxTranslate = -((this.realCount - 1) * this.slideSize - (this.containerSize - this.slideSize));
    // maxTranslate = -(totalContentWidth - containerWidth)
    if (maxTranslate > 0) maxTranslate = 0;
    x = Math.max(x, maxTranslate);
  }

  this._setTranslate(x, animate, flickVelocity);
  this._updateState();
  this._notifySync();
};

// Notify all sliders that sync to this one (by name), making them
// jump to the same realIndex. Uses a flag to avoid infinite loops
// when sync is bidirectional (A syncs to B, B syncs to A).
Slider.prototype._notifySync = function () {
  if (this._syncing) return;
  if (!this.name) return;

  var targets = document.querySelectorAll("[zh-slider-sync='" + this.name + "']");
  for (var i = 0; i < targets.length; i++) {
    var inst = targets[i].__zhSlider;
    if (!inst || inst === this) continue;
    if (inst.realIndex === this.realIndex) continue;

    inst._syncing = true;
    inst.goTo(this.realIndex, true);
    inst._syncing = false;
  }
};

Slider.prototype.next = function () {
  if (this._mq) return this._marqueeStep(1);
  this.goTo(this.realIndex + 1, true);
};
Slider.prototype.prev = function () {
  if (this._mq) return this._marqueeStep(-1);
  this.goTo(this.realIndex - 1, true);
};

// Loop: if the position sits in the clones, move to the identical spot in
// the real set. Same content on screen, so nothing visibly changes; it
// just guarantees clones on both sides for the next drag.
Slider.prototype._normalizeLoopIndex = function () {
  if (!this.opts.loop || this._mq || !this.slideSize) return;
  var shift = 0;
  if (this.index >= this.loopOffset + this.realCount) shift = -this.realCount;
  else if (this.index < this.loopOffset) shift = this.realCount;
  if (!shift) return;
  this.index += shift;
  this.translate -= shift * this.slideSize;
  this.list.style.transform = "translate3d(" + this.translate + "px, 0, 0)";
};

// After a loop wrap, jump instantly back to the equivalent real position.
Slider.prototype._handleLoopWrap = function () {
  if (!this.opts.loop || this.realCount < 1) return;
  var max = this.loopOffset + this.realCount; // exclusive
  if (this.index >= max || this.index < this.loopOffset) {
    while (this.index >= max) this.index -= this.realCount;
    while (this.index < this.loopOffset) this.index += this.realCount;
    this._setTranslate(this._posFor(this.index), false);
  }
};

// ── Marquee ──────────────────────────────────────────────────────────────
// Continuous linear scroll (logo walls and the like). A single rAF loop
// owns the transform: it moves the list at `marqueeSpeed` px/s, eases the
// speed down to 0 while paused (hover, keyboard focus, finger down) and
// back up afterwards, plays the short tween when an arrow is clicked, and
// wraps around the cloned sets. Positions come from the DOM (each card's
// offset), not index * slideSize, so cards of different widths work too.

// Copies of the set needed on each side so clones always cover the visible
// area plus one card. Runs before cloning, so it measures the originals.
Slider.prototype._marqueeCopiesNeeded = function () {
  var items = this.originalItems;
  var widest = 0;
  for (var i = 0; i < items.length; i++) {
    items[i].style.flexShrink = "0";
    widest = Math.max(widest, items[i].getBoundingClientRect().width);
  }
  var first = items[0].getBoundingClientRect();
  var last = items[items.length - 1].getBoundingClientRect();
  var cs = window.getComputedStyle(this.list);
  var gap = this.opts.gapSet ? this.opts.spaceBetween : (parseFloat(cs.columnGap || cs.gap) || 0);
  var setWidth = last.right - first.left + gap;
  if (setWidth <= 0) return 2;
  var cover = Math.max(this.root.clientWidth, window.innerWidth) + widest;
  return Math.max(1, Math.ceil(cover / setWidth));
};

Slider.prototype._initMarquee = function () {
  if (!this.opts.marquee || this.loopOffset < 1) return;
  var self = this;
  this._mq = {
    speed: 0,                 // current px/s; eases towards the target
    paused: { hover: false, focus: false, press: false },
    tween: null,              // { from, to, start, dur } while an arrow step plays
    raf: 0,
    last: 0,
    inView: true,
    ease: this._getEasing(this.opts.easing),
  };
  this._marqueeMeasure();
  this._marqueeRender(-this._mq.stops[this.loopOffset]);

  if (this.opts.pauseOnHover) {
    // Mouse only: on touch screens pointerleave may never fire, which
    // would leave the marquee stuck after a tap.
    this.root.addEventListener("pointerenter", function (e) {
      if (e.pointerType === "mouse") self._marqueeSetPaused("hover", true);
    });
    this.root.addEventListener("pointerleave", function (e) {
      if (e.pointerType === "mouse") self._marqueeSetPaused("hover", false);
    });
  }

  document.addEventListener("visibilitychange", function () { self._marqueeKick(); });

  // Don't burn frames while the slider is scrolled out of view.
  if ("IntersectionObserver" in window) {
    this._mqObserver = new IntersectionObserver(function (entries) {
      self._mq.inView = entries[0].isIntersecting;
      self._marqueeKick();
    });
    this._mqObserver.observe(this.root);
  }

  this._marqueeKick();
};

// Cache each card's offset within the list, the width of one full set,
// and each card's resting spot ("stop"): the scroll position where that
// card sits on the left edge, or in the middle when zh-slider-center is on.
Slider.prototype._marqueeMeasure = function () {
  var mq = this._mq;
  var origin = this.items[0].getBoundingClientRect().left;
  mq.offsets = [];
  mq.stops = [];
  for (var i = 0; i < this.items.length; i++) {
    var rect = this.items[i].getBoundingClientRect();
    var off = rect.left - origin;
    mq.offsets.push(off);
    mq.stops.push(this.opts.center ? off + rect.width / 2 - this.containerSize / 2 : off);
  }
  mq.start = mq.offsets[this.loopOffset];
  mq.setWidth = mq.offsets[this.loopOffset + this.realCount] - mq.start;
  mq.minStep = 0.3 * mq.setWidth / this.realCount;
  this._marqueeRender(this._marqueeWrap(this.translate));
};

// Keep the position inside the real set. Moving by exactly one set width
// shows identical content, so the jump is invisible.
Slider.prototype._marqueeWrap = function (tx) {
  var mq = this._mq;
  if (!(mq.setWidth > 0)) return tx;
  var p = -tx;
  while (p >= mq.start + mq.setWidth) p -= mq.setWidth;
  while (p < mq.start) p += mq.setWidth;
  return -p;
};

Slider.prototype._marqueeRender = function (tx) {
  this.translate = tx;
  this.list.style.transform = "translate3d(" + tx + "px, 0, 0)";
  this._marqueeTrackIndex();
};

// Counters (and bullets) follow the card nearest its resting spot (left
// edge, or the middle in center mode), so they tick along with the
// scroll, the arrows and dragging. The DOM is only touched when that
// card changes, not every frame.
Slider.prototype._marqueeTrackIndex = function () {
  var mq = this._mq;
  if (!mq || !mq.stops) return;
  var p = -this.translate, offs = mq.stops, best = 0;
  for (var i = 1; i < offs.length; i++) {
    if (Math.abs(offs[i] - p) < Math.abs(offs[best] - p)) best = i;
    else if (offs[i] > p) break;
  }
  var real = this._realIndexFromDisplayed(best);
  if (real === mq.shown) return;
  mq.shown = real;
  this.realIndex = real;
  this.index = best;

  var str = this.opts.padNumbers ? pad(real + 1) : String(real + 1);
  for (var c = 0; c < this.currentEls.length; c++) this.currentEls[c].textContent = str;
  if (this.bullets) {
    for (var b = 0; b < this.bullets.length; b++) {
      this.bullets[b].classList.toggle("is-active", b === real);
      this.bullets[b].setAttribute("aria-selected", b === real ? "true" : "false");
    }
  }
};

Slider.prototype._marqueePaused = function () {
  var p = this._mq.paused;
  return p.hover || p.focus || p.press;
};

Slider.prototype._marqueeSetPaused = function (reason, on) {
  if (!this._mq) return;
  this._mq.paused[reason] = on;
  this._marqueeKick();
};

// (Re)start the loop unless there's nothing to animate.
Slider.prototype._marqueeKick = function () {
  var mq = this._mq;
  if (!mq || mq.raf) return;
  var target = this._marqueePaused() ? 0 : this.opts.marqueeSpeed;
  var idle = !mq.tween && (this.isDragging || (mq.speed === 0 && target === 0));
  if (idle || !mq.inView || document.hidden) { mq.last = 0; return; }
  var self = this;
  mq.raf = requestAnimationFrame(function (ts) { self._marqueeTick(ts); });
};

Slider.prototype._marqueeTick = function (ts) {
  var mq = this._mq;
  mq.raf = 0;
  // Cap the step so a dropped frame or a background tab can't cause a leap.
  var dt = mq.last ? Math.min(ts - mq.last, 50) / 1000 : 0;
  mq.last = ts;

  if (mq.tween) {
    var tw = mq.tween;
    var t = tw.dur > 0 ? clamp((performance.now() - tw.start) / tw.dur, 0, 1) : 1;
    this._marqueeRender(tw.from + (tw.to - tw.from) * mq.ease(t));
    if (t >= 1) {
      mq.tween = null;
      mq.speed = 0; // glide back into the scroll instead of lurching
      this._marqueeRender(this._marqueeWrap(this.translate));
    }
  } else if (!this.isDragging) {
    var target = this._marqueePaused() ? 0 : this.opts.marqueeSpeed;
    mq.speed += (target - mq.speed) * (1 - Math.exp(-dt / 0.35));
    if (target === 0 && Math.abs(mq.speed) < 1) mq.speed = 0;
    if (mq.speed !== 0) {
      this._marqueeRender(this._marqueeWrap(this.translate - mq.speed * dt));
    }
  }

  this._marqueeKick();
};

Slider.prototype._marqueeTweenTo = function (tx) {
  this._mq.tween = {
    from: this.translate,
    to: tx,
    start: performance.now(),
    dur: this.opts.duration,
  };
  this._marqueeKick();
};

// Arrow step: glide the next/previous card to its resting spot from
// wherever the marquee is right now. Fast clicks chain from where the
// running step is heading, so they add up instead of restarting half-way.
Slider.prototype._marqueeStep = function (dir) {
  var mq = this._mq;
  var anchor = mq.tween ? mq.tween.to : this.translate;
  var wrapped = this._marqueeWrap(anchor);
  this._marqueeRender(this.translate + (wrapped - anchor)); // whole set widths: invisible

  var p = -wrapped, offs = mq.stops, target = null, i;
  if (dir > 0) {
    for (i = 0; i < offs.length; i++) {
      if (offs[i] > p + mq.minStep) { target = offs[i]; break; }
    }
  } else {
    for (i = offs.length - 1; i >= 0; i--) {
      if (offs[i] < p - mq.minStep) { target = offs[i]; break; }
    }
  }
  if (target !== null) this._marqueeTweenTo(-target);
};

// Bullets, sync and the JS API land here: glide to a real card.
Slider.prototype._marqueeGoTo = function (realIndex) {
  var mq = this._mq;
  var r = ((realIndex % this.realCount) + this.realCount) % this.realCount;
  this._marqueeRender(this._marqueeWrap(this.translate));
  this._marqueeTweenTo(-mq.stops[this.loopOffset + r]);
  // Counters catch up on their own as the glide passes each card; sync
  // partners get the destination straight away.
  this.realIndex = r;
  this._notifySync();
};

// Bring a keyboard-focused card fully into view.
Slider.prototype._marqueeReveal = function (card) {
  var r = card.getBoundingClientRect();
  var box = this.root.getBoundingClientRect();
  if (r.left >= box.left && r.right <= box.right) return;
  this._marqueeTweenTo(this.translate + (box.left - r.left));
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
    if (this.prevEl) this.prevEl.classList.toggle("is-disabled", this.realIndex <= 0);
    if (this.nextEl) this.nextEl.classList.toggle("is-disabled", this.realIndex >= this.realCount - 1);
  }
  var curStr = this.opts.padNumbers ? pad(this.realIndex + 1) : String(this.realIndex + 1);
  for (var c = 0; c < this.currentEls.length; c++) this.currentEls[c].textContent = curStr;

  this._updateScrollbar(true);
  this._updateProgress(true);
  this._updateTimeline();
  this._updateA11y();
};

// ── Progress bar ─────────────────────────────────────────────────────────
// Fills from 0% (first slide) to 100% (last slide in the set).
// Progress is based on which individual slide is active (realIndex),
// NOT on the scroll-bound. So with 5 slides & 3 visible, slide 1 = 0%,
// slide 3 = 50%, slide 5 = 100%.
// Total scrollable distance in px.
//  - loop:      realCount slides each slideSize wide.
//  - non-loop:  content width minus one viewport, i.e. the last slide sits
//               flush against the right edge (matches the clamp in goTo()).
// This is the denominator progress/scrollbar must divide by so that 100%
// lines up exactly with the last reachable position — not realCount-1.
Slider.prototype._travelDist = function () {
  if (this.opts.loop) {
    return Math.max(1, this.realCount - 1) * this.slideSize;
  }
  if (this.opts.center) return Math.max(0, this.realCount - 1) * this.slideSize;
  var dist = (this.realCount - 1) * this.slideSize - (this.containerSize - this.slideSize);
  // When all slides fit in view there's nothing to scroll → avoid div-by-0.
  return dist > 0 ? dist : 0;
};

// Discrete progress: fraction of the *reachable* travel the current slide
// represents. In non-loop mode the last few slides share the final viewport,
// so the reachable index range is smaller than realCount-1.
Slider.prototype._maxIndex = function () {
  if (this.opts.loop) return Math.max(1, this.realCount - 1);
  if (this.slideSize <= 0) return Math.max(1, this.realCount - 1);
  var reachable = this._travelDist() / this.slideSize;
  return Math.max(1, reachable);
};

Slider.prototype._updateProgress = function (animate) {
  // An endless marquee has no start or end, so there's no progress to show.
  if (!this.progressFillEl || this.opts.marquee) return;
  var travel = this._travelDist();
  if (travel <= 0) {
    this.progressFillEl.style.width = "100%";
    return;
  }

  // Compute the clamped target translate for the current index — same
  // clamping as goTo() so progress reaches 100% the moment the last
  // slide sits flush against the right edge of the container.
  var x = -this.index * this.slideSize;
  if (!this.opts.loop && !this.opts.center) {
    x = Math.max(x, -travel);
  }
  var scrolled = this.opts.loop
    ? this.realIndex * this.slideSize
    : -x;
  var pct = clamp(scrolled / travel, 0, 1) * 100;

  this.progressFillEl.style.transition = animate
    ? "width " + this.opts.duration + "ms " + this.opts.easing
    : "none";
  this.progressFillEl.style.width = pct + "%";
};

// Called during slide-drag so progress follows in real time.
// Based on scroll position so 100% = all content revealed.
Slider.prototype._updateProgressFromTranslate = function (tx) {
  if (!this.progressFillEl) return;
  var totalTravel = this._travelDist();
  if (totalTravel <= 0) { this.progressFillEl.style.width = "100%"; return; }

  var adjusted = -(tx - this.centerOffset + this.loopOffset * this.slideSize);
  var pct = clamp(adjusted / totalTravel, 0, 1) * 100;

  this.progressFillEl.style.transition = "none";
  this.progressFillEl.style.width = pct + "%";
};

// ── Timeline (per-slide progress bars) ──────────────────────────────────
// Updates is-active class and triggers fill animation for the current slide.
Slider.prototype._updateTimeline = function () {
  if (!this._hasTimeline) return;

  for (var i = 0; i < this.timelineItems.length; i++) {
    var isActive = i === this.realIndex;
    var isPast = i < this.realIndex;
    this.timelineItems[i].classList.toggle("is-active", isActive);
    this.timelineItems[i].classList.toggle("is-past", isPast);

    // Active slide: starts at 0% (no anim), then _startTimelineFill
    //   animates to 100% over autoplayMs.
    // Past slide: was at 100% (filled), now animates smoothly back to 0%
    //   so it "empties" out as the next one fills.
    // Future slide: stays at 0%, no animation.
    if (this.timelineFills[i]) {
      if (isActive) {
        this.timelineFills[i].style.transition = "none";
        this.timelineFills[i].style.width = "0%";
      } else if (isPast) {
        // Smooth fade-out using the slider's own duration/easing
        this.timelineFills[i].style.transition =
          "width " + this.opts.duration + "ms " + this.opts.easing;
        this.timelineFills[i].style.width = "0%";
      } else {
        this.timelineFills[i].style.transition = "none";
        this.timelineFills[i].style.width = "0%";
      }
    }
  }
};

// Start the fill animation for the active timeline item.
// Uses CSS transition for smooth 0→100% over autoplayMs.
// If the fill was paused partway, it resumes from its current position
// with the remaining duration so the pace stays consistent.
Slider.prototype._startTimelineFill = function () {
  if (!this._hasTimeline) return;
  if (this.opts.autoplayMs <= 0) return;

  var idx = this.realIndex;
  if (idx < 0 || idx >= this.timelineFills.length) return;

  var fill = this.timelineFills[idx];
  if (!fill) return;

  var self = this;
  var totalDuration = this.opts.autoplayMs;

  // Measure current fill progress (may be >0 if resuming from pause)
  var parentW = this.timelineItems[idx].getBoundingClientRect().width;
  var currentW = fill.getBoundingClientRect().width;
  var progress = parentW > 0 ? currentW / parentW : 0;
  var remaining = totalDuration * (1 - progress);
  if (remaining < 50) remaining = totalDuration; // near-complete → restart

  // Force a reflow so the current width is painted before we start the transition
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      fill.style.transition = "width " + remaining + "ms linear";
      fill.style.width = "100%";
    });
  });
};

// Stop all timeline fill animations (e.g. on pause/drag).
Slider.prototype._stopTimelineFill = function () {
  if (!this._hasTimeline) return;

  for (var i = 0; i < this.timelineFills.length; i++) {
    if (this.timelineFills[i]) {
      // Freeze the fill at its current width
      var current = this.timelineFills[i].getBoundingClientRect().width;
      var parent = this.timelineItems[i].getBoundingClientRect().width;
      var pct = parent > 0 ? (current / parent) * 100 : 0;
      this.timelineFills[i].style.transition = "none";
      this.timelineFills[i].style.width = pct + "%";
    }
  }
};

// animate = true  → thumb slides with same easing as the slider
// animate = false → instant (used during drag)
// Scrollbar thumb follows SCROLL POSITION: the thumb (fixed width = how much
// is visible) travels fully left→right, sitting flush right exactly when the
// last slide is flush right. This differs from the progress bar, which fills
// on the counter scale.
Slider.prototype._updateScrollbar = function (animate) {
  if (!this.scrollbarThumbEl || !this.scrollbarEl || this.opts.marquee) return;
  var spv = this.effectiveSpv || 1;
  var ratio = clamp(spv / this.realCount, 0.05, 1);
  var trackW = this.scrollbarEl.clientWidth;
  var thumbW = trackW * ratio;
  var progress = clamp(this.realIndex / this._maxIndex(), 0, 1);
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

  // Total travel matches the real scroll-bound (non-loop: content - viewport)
  var totalTravel = this._travelDist();
  if (totalTravel <= 0) return;

  // In loop mode, adjust for the clone offset
  var adjusted = -(tx - this.centerOffset + this.loopOffset * this.slideSize);
  var progress = clamp(adjusted / totalTravel, 0, 1);

  this.scrollbarThumbEl.style.transition = "none";
  this.scrollbarThumbEl.style.transform =
    "translate3d(" + (maxThumbX * progress) + "px, 0, 0)";
};

// ── Scrollbar drag ────────────────────────────────────────────────────────
Slider.prototype._bindScrollbarDrag = function () {
  // Dragging a thumb would fight the marquee's own movement.
  if (!this.scrollbarEl || !this.scrollbarThumbEl || this.opts.marquee) return;
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
    // The thumb position (0..1) maps to a fraction of the real travel
    // distance, so the slides reach their flush right-edge exactly when
    // the thumb hits the end of its track.
    var travelSlides = self.slideSize > 0 ? self._travelDist() / self.slideSize : 0;
    var continuousSlide = progress * travelSlides;
    var translateX = -(continuousSlide + self.loopOffset) * self.slideSize + self.centerOffset;
    self.list.style.transition = "none";
    self.list.style.transform = "translate3d(" + translateX + "px, 0, 0)";
    self.translate = translateX;

    // Update realIndex for counter (this one does snap — integers only)
    var snappedReal = clamp(Math.round(continuousSlide), 0, self.realCount - 1);
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

    // Update progress bar continuously — based on scroll position so
    // 100% lines up with the last slide flush right.
    if (self.progressFillEl) {
      var totalTravel = self._travelDist();
      if (totalTravel > 0) {
        var travelSlides2 = totalTravel / self.slideSize;
        var pct = clamp(continuousSlide / travelSlides2, 0, 1) * 100;
        self.progressFillEl.style.transition = "none";
        self.progressFillEl.style.width = pct + "%";
      }
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
    var targetReal = Math.round(progress * self._maxIndex());
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

  // Timeline item clicks → jump to that slide
  if (this.timelineItems) {
    for (var ti = 0; ti < this.timelineItems.length; ti++) {
      (function (idx) {
        self.timelineItems[idx].addEventListener("click", function (e) {
          e.preventDefault();
          self.goTo(idx, true);
          self._restartAutoplay();
        });
      })(ti);
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
  // Drag can be disabled entirely via zh-slider-drag="false".
  // Useful for hero sliders where clicking/interacting should never
  // hijack the pointer for sliding.
  if (!this.opts.drag) return;

  var self = this;
  var wrapper = this.list.parentElement || this.list;
  var allowClick = true;
  var tracking = false;
  var startY = 0;
  var samples = [];          // recent { x, t } for a steady release speed
  var interrupted = false;   // this press stopped a glide half-way
  var axis = null;           // touch: "x" = swiping, "y" = scrolling the page

  // Touch: let the browser handle vertical scrolling and pinch-zoom, and
  // leave horizontal swipes to the slider. Without this the browser and
  // the slider fight over the same thumb, and a slightly diagonal swipe
  // gets taken over by page scrolling half-way. Only set when the designer
  // hasn't chosen a touch-action in Webflow.
  if (window.getComputedStyle(wrapper).touchAction === "auto") {
    wrapper.style.touchAction = "pan-y pinch-zoom";
  }

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

  // Release speed in px/ms over the last ~100ms of movement. A single
  // event pair is too noisy on touch screens, and if the finger stopped
  // before letting go, there's no fling at all.
  function releaseVelocity() {
    var now = performance.now();
    while (samples.length > 2 && now - samples[0].t > 100) samples.shift();
    if (samples.length < 2) return 0;
    var a = samples[0], b = samples[samples.length - 1];
    if (now - b.t > 80 || b.t === a.t) return 0;
    return (b.x - a.x) / (b.t - a.t);
  }

  // Touch: decide once, in the first few pixels, whether this is a swipe
  // or a page scroll, then stick to it until the finger lifts. Thumbs move
  // in an arc, so a swipe may drift up to ~50° and still count as
  // horizontal; only clearly vertical moves scroll the page.
  function decideAxis(dx, dy) {
    var adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx + ady < 6) return null;
    return adx >= ady * 0.8 ? "x" : "y";
  }

  function onDown(e) {
    if (e.button != null && e.button !== 0) return;
    if (self.isStatic) return;
    tracking = true;
    allowClick = true;
    self._pointerDown = true;
    self.isDragging = false;
    self.dragMoved = false;
    self.dragStart = e.clientX;
    startY = e.clientY;
    axis = null;
    samples = [{ x: e.clientX, t: performance.now() }];
    self.dragVelocity = 0;

    // Marquee: a press holds it still (so a tap lands on the card under
    // the finger) and grabs it mid-step if an arrow glide is running.
    if (self._mq) {
      self._mq.tween = null;
      self._mq.speed = 0;
      self._marqueeSetPaused("press", true);
    } else {
      // Grab a slide that's still gliding from the previous swipe:
      // stop that animation right where it is, otherwise it keeps
      // writing positions underneath the finger (the classic stutter
      // when swiping twice quickly).
      interrupted = !!self._rafId;
      if (self._rafId) { cancelAnimationFrame(self._rafId); self._rafId = null; }
      self._normalizeLoopIndex();
    }
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
      if (e.pointerType !== "mouse" && !axis) {
        axis = decideAxis(dx, e.clientY - startY);
        if (!axis) return;
      }
      if (axis === "y") {
        tracking = false;
        return;
      }
      if (Math.abs(dx) < self.opts.threshold) return;

      // Threshold exceeded → enter drag mode. Measure from here on, so
      // the slide doesn't jump by the threshold distance.
      self.isDragging = true;
      self.dragMoved = true;
      allowClick = false; // ← this is the key: block the upcoming click
      self.dragStart = e.clientX;
      dx = 0;
      self.list.style.transition = "none";
      self.root.classList.add("is-dragging");
      self._stopAutoplay();
    }

    // ── Active drag ─────────────────────────────────────────────────
    samples.push({ x: e.clientX, t: performance.now() });
    if (samples.length > 20) samples.shift();

    var next = self.startTranslate + dx;

    // Marquee: free drag, wrapping around the clones so it never runs out.
    if (self._mq) {
      var wrapped = self._marqueeWrap(next);
      self.startTranslate += wrapped - next;
      self._marqueeRender(wrapped);
      return;
    }

    if (self.opts.loop && self.slideSize > 0) {
      // Long drags: hop to the identical spot one set further so the
      // clones never run out under the finger.
      var setPx = self.realCount * self.slideSize;
      var pos = -(next - self.centerOffset) / self.slideSize;
      var hop = 0;
      if (pos < self.loopOffset - 0.5) hop = self.realCount;
      else if (pos > self.loopOffset + self.realCount - 0.5) hop = -self.realCount;
      if (hop) {
        next -= hop * self.slideSize;
        self.startTranslate -= hop * self.slideSize;
        self.index += hop;
      }
    } else if (!self.opts.loop) {
      // Clamp: last slide flush with right edge of container, or, when
      // centered, first and last slide in the middle.
      var maxX = self.opts.center ? self.centerOffset : 0;
      var minX = self.opts.center
        ? self._posFor(self.realCount - 1)
        : -((self.realCount - 1) * self.slideSize - (self.containerSize - self.slideSize));
      if (minX > maxX) minX = maxX;
      if (next > maxX) next = maxX + (next - maxX) * 0.35;
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
    // pointercancel = the browser took over (e.g. started scrolling);
    // settle on the nearest slide without flinging.
    var cancelled = e.type === "pointercancel";
    var velocity = cancelled ? 0 : releaseVelocity();
    self.dragVelocity = velocity;
    self.isDragging = false;
    self._pointerDown = false;
    self.root.classList.remove("is-dragging");
    tracking = false;

    // Marquee: no snapping. Hand the release speed to the loop, which
    // eases it back to the normal pace (or to a stop while hovered).
    if (self._mq) {
      if (wasDragging) self._mq.speed = clamp(-velocity * 1000, -3000, 3000);
      self._marqueeSetPaused("press", false);
      return;
    }

    // Tap/click — let the native event chain handle it. If the tap
    // grabbed a slide mid-glide, finish that glide.
    if (!wasDragging) {
      if (interrupted) {
        if (self.opts.loop) self._setTranslate(self._posFor(self.index), true);
        else self.goTo(self.realIndex, true);
      }
      return;
    }

    // ── Drag release: snap to nearest slide ─────────────────────────
    var moved = self.translate - self.startTranslate;
    var projected = moved + velocity * 120;
    var stepDelta = -projected / self.slideSize;

    var direction;
    if (cancelled) {
      direction = Math.round(-moved / self.slideSize);
    } else if (Math.abs(stepDelta) < 0.15 && Math.abs(velocity) < 0.2) {
      direction = 0;
    } else {
      direction = stepDelta > 0 ? Math.ceil(stepDelta) : Math.floor(stepDelta);
    }

    var targetDisplayed = self.index + direction;
    if (!self.opts.loop) {
      targetDisplayed = clamp(targetDisplayed, 0, self.realCount - 1);
    }

    if (self.opts.loop) {
      self.index = targetDisplayed;
      self.realIndex = self._realIndexFromDisplayed(targetDisplayed);
      self._setTranslate(self._posFor(self.index), true, velocity);
      self._updateState();
    } else {
      self.goTo(targetDisplayed, true, velocity);
    }

    self._restartAutoplay();
  }

  // pointerdown on the wrapper (slider_list-wrapper), NOT the root
  wrapper.addEventListener("pointerdown", onDown);

  // Swipe lock: once a touch is a horizontal swipe, the page stays put for
  // the rest of that touch, however much the thumb drifts up or down.
  // Pointer events can't stop scrolling, touch events can. Usually the
  // pointermove for this movement already decided; if this browser sends
  // the touchmove first, decide here.
  wrapper.addEventListener("touchmove", function (e) {
    if (!tracking) return;
    if (!axis && e.touches.length) {
      axis = decideAxis(e.touches[0].clientX - self.dragStart, e.touches[0].clientY - startY);
    }
    if (axis === "x" && e.cancelable) e.preventDefault();
  }, { passive: false });

  // Prevent native image dragging from hijacking pointer events in Safari
  var imgs = this.list.querySelectorAll("img");
  for (var i = 0; i < imgs.length; i++) {
    imgs[i].setAttribute("draggable", "false");
  }

  // Same for cards that are links: the browser's own link drag would
  // cancel the pointer stream half-way and leave the slider stuck.
  this.list.addEventListener("dragstart", function (e) { e.preventDefault(); });
};

// ── Resize handling ──────────────────────────────────────────────────────
Slider.prototype._bindResize = function () {
  var self = this;
  this._lastWidth = this.root.clientWidth;
  function onResize() {
    cancelAnimationFrame(self.resizeRaf);
    self.resizeRaf = requestAnimationFrame(function () {
      // Only the width matters. Mobile browsers fire resize when the
      // address bar slides in or out (height only); laying out again then
      // would cut a running glide short.
      var w = self.root.clientWidth;
      if (w === self._lastWidth) return;
      self._lastWidth = w;
      self._applyBreakpoint();
      self.layout(false);
    });
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  // Also catches the slider becoming visible (Webflow tabs, accordions,
  // display:none at load) or its column changing width on its own.
  if ("ResizeObserver" in window) {
    this._resizeObserver = new ResizeObserver(onResize);
    this._resizeObserver.observe(this.root);
  }
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
// Two modes:
//   1. Timeline mode (_hasTimeline): fill animation drives slide advance.
//      A transitionend listener on the active fill triggers next().
//   2. Classic mode: setInterval.
Slider.prototype._startAutoplay = function () {
  if (this.opts.autoplayMs <= 0 || this.isStatic) return;
  if (this.autoplayTimer) return;
  // Synced sliders follow their master — they don't autoplay independently.
  if (this.opts.syncTo) return;
  var self = this;

  if (this._hasTimeline) {
    // Timeline mode — fill animation drives advancement
    this._startTimelineFill();

    // Listen for the fill transition to complete → advance.
    // We bind directly to each fill element (not delegated on root) because
    // timeline items can live outside the slider root.
    if (!this._timelineTransitionBound) {
      this._timelineTransitionBound = true;
      var onFillEnd = function (e) {
        if (e.propertyName !== "width") return;

        // Check this is the ACTIVE fill (not a leftover)
        var activeIdx = self.realIndex;
        if (activeIdx < 0 || activeIdx >= self.timelineFills.length) return;
        if (e.target !== self.timelineFills[activeIdx]) return;

        // Advance to next slide
        if (!self.opts.loop && self.realIndex >= self.realCount - 1) {
          self.goTo(0, true);
        } else {
          self.next();
        }
        // _updateState → _updateTimeline resets fills, then _startAutoplay
        // fires again via _restartAutoplay in the goTo chain.
        // We need to kick the fill for the new slide:
        self._startTimelineFill();
      };
      // Attach the listener to every fill element
      for (var fi = 0; fi < this.timelineFills.length; fi++) {
        this.timelineFills[fi].addEventListener("transitionend", onFillEnd);
      }
    }

    // Mark as "running" so _stopAutoplay knows to stop
    this.autoplayTimer = true;
  } else {
    // Classic mode — setInterval
    this.autoplayTimer = setInterval(function () {
      if (self._pointerDown) return; // never move a slide out from under a finger
      if (!self.opts.loop) {
        if (self.realIndex >= self.realCount - 1) {
          self.goTo(0, true);
          return;
        }
      }
      self.next();
    }, this.opts.autoplayMs);
  }
};
Slider.prototype._stopAutoplay = function () {
  if (this._hasTimeline) {
    this._stopTimelineFill();
    this.autoplayTimer = null;
  } else {
    if (this.autoplayTimer) {
      clearInterval(this.autoplayTimer);
      this.autoplayTimer = null;
    }
  }
};
Slider.prototype._restartAutoplay = function () {
  this._stopAutoplay();
  this._startAutoplay();
};

// ── Public destroy (handy for Webflow CMS re-renders) ───────────────────
Slider.prototype.destroy = function () {
  this._stopAutoplay();
  if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  if (this._resizeObserver) this._resizeObserver.disconnect();
  if (this._mq) {
    if (this._mq.raf) cancelAnimationFrame(this._mq.raf);
    if (this._mqObserver) this._mqObserver.disconnect();
    this._mq = null;
  }
  var clones = this.root.querySelectorAll("[zh-slider-clone='true']");
  for (var i = 0; i < clones.length; i++) clones[i].parentNode.removeChild(clones[i]);
  this.list.style.transform = "";
  this.list.style.transition = "";
  this.list.style.willChange = "";
  this.root.classList.remove("is-dragging");
  if (this._skipAutoCreated && this._skipLink && this._skipLink.parentNode) this._skipLink.parentNode.removeChild(this._skipLink);
  if (this._skipTarget && this._skipTarget.parentNode) this._skipTarget.parentNode.removeChild(this._skipTarget);

  // Clean up timeline fills
  if (this._hasTimeline) {
    for (var ti = 0; ti < this.timelineFills.length; ti++) {
      if (this.timelineFills[ti]) {
        this.timelineFills[ti].style.transition = "";
        this.timelineFills[ti].style.width = "";
      }
    }
    for (var tj = 0; tj < this.timelineItems.length; tj++) {
      this.timelineItems[tj].classList.remove("is-active", "is-past");
    }
  }

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
