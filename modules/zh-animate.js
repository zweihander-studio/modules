/**
 * Zweihander — zh-animate
 * Native, dependency-free scroll-triggered animation for Webflow.
 * Uses IntersectionObserver + CSS transitions. No GSAP, no AOS, no deps.
 *
 * Markup:
 *   <div zh-animate="up"
 *        zh-animate-delay="200"
 *        zh-animate-duration="800"
 *        zh-animate-distance="40"
 *        zh-animate-easing="cubic-bezier(0.68, -0.6, 0.32, 1.6)"
 *        zh-animate-threshold="0.2"
 *        zh-animate-once="true"
 *        zh-animate-mobile="true">
 *     Content slides up into view
 *   </div>
 *
 *   <!-- Stagger: children animate in sequence -->
 *   <div zh-animate-stagger="100">
 *     <div zh-animate="up">Child 1 — 0ms</div>
 *     <div zh-animate="up">Child 2 — 100ms</div>
 *     <div zh-animate="up">Child 3 — 200ms</div>
 *   </div>
 *
 * Attributes:
 *   zh-animate          = "up|down|left|right|fade|scale|none"  (default "up")
 *   zh-animate-delay    = delay before animation starts         (default 0)
 *   zh-animate-duration = animation duration                    (default 600)
 *   zh-animate-distance = translate distance in px              (default 30)
 *   zh-animate-easing   = CSS easing string                     (default "cubic-bezier(0.68, -0.6, 0.32, 1.6)")
 *   zh-animate-stagger  = stagger delay between siblings        (container attr)
 *   Times: "300", "300ms", "0.3" and "0.3s" all mean 300ms.
 *   zh-animate-threshold= how much of element must be visible   (default 0.15)
 *   zh-animate-once     = "true|false" animate once or repeat   (default true)
 *   zh-animate-mobile   = "true|false" animate on <768px        (default true)
 *   zh-animate-after    = not before this long after page start (default 0)
 *                         On this element or any ancestor (e.g. a section).
 *                         Unlike delay, it doesn't add up after scrolling:
 *                         content that scrolls in later shows right away.
 *
 * The script sets initial hidden state via inline styles (opacity + transform),
 * then uses IntersectionObserver to detect viewport entry. On enter it applies
 * a CSS transition and removes the transform/opacity to reveal the element.
 * Class "is-animated" is added when complete.
 */

// ES module — loaded by zweihander.js loader

// ───────────────────────────────────────────────────────────────────────────
// Attribute names — single source of truth
// ───────────────────────────────────────────────────────────────────────────
var ATTR = {
  root:      "zh-animate",
  delay:     "zh-animate-delay",
  duration:  "zh-animate-duration",
  distance:  "zh-animate-distance",
  easing:    "zh-animate-easing",
  stagger:   "zh-animate-stagger",
  threshold: "zh-animate-threshold",
  once:      "zh-animate-once",
  mobile:    "zh-animate-mobile",
  after:     "zh-animate-after",
};

// ───────────────────────────────────────────────────────────────────────────
// Defaults
// ───────────────────────────────────────────────────────────────────────────
var HARDCODED = {
  direction: "up",
  delay:     0,
  duration:  600,
  distance:  30,
  easing:    "cubic-bezier(0.68, -0.6, 0.32, 1.6)",
  threshold: 0.15,
  once:      true,
  mobile:    true,
};

// Merged defaults: hardcoded ← global overrides.
// Global overrides can be set via: window.Zweihander.animateDefaults = { duration: 800, distance: 50, … }
function getDefaults() {
  var g = (window.Zweihander && window.Zweihander.animateDefaults) || {};
  var d = {};
  for (var key in HARDCODED) {
    d[key] = g[key] != null ? g[key] : HARDCODED[key];
  }
  return d;
}

// ───────────────────────────────────────────────────────────────────────────
// Tiny helpers (same pattern as zh-slider)
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

// Times may be written in ms ("300", "300ms") or in seconds like Webflow
// does ("0.3", "0.3s"). A bare number below 10 can only sensibly mean
// seconds, so it's read as such.
function toMs(raw) {
  var v = String(raw).trim().toLowerCase();
  var n = parseFloat(v);
  if (isNaN(n)) return NaN;
  if (/ms$/.test(v)) return n;
  if (/s$/.test(v)) return n * 1000;
  return n < 10 ? n * 1000 : n;
}
function attrMs(el, name, fallback) {
  var v = attr(el, name, null);
  if (v === null) return fallback;
  var n = toMs(v);
  return isNaN(n) || n < 0 ? fallback : n;
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ───────────────────────────────────────────────────────────────────────────
// State tracking
// ───────────────────────────────────────────────────────────────────────────
var observer = null;
var elements = [];       // all managed [zh-animate] elements
var isMobile = false;
var startedAt = 0;       // when the module started, i.e. when on-load animations begin

function checkMobile() {
  isMobile = window.innerWidth < 768;
}

// ───────────────────────────────────────────────────────────────────────────
// Transform helpers — GPU-accelerated via translate3d
// ───────────────────────────────────────────────────────────────────────────

/**
 * Return the initial CSS transform string for a given direction + distance.
 */
function getInitialTransform(direction, distance) {
  switch (direction) {
    case "up":    return "translate3d(0, " + distance + "px, 0)";
    case "down":  return "translate3d(0, " + -distance + "px, 0)";
    case "left":  return "translate3d(" + distance + "px, 0, 0)";
    case "right": return "translate3d(" + -distance + "px, 0, 0)";
    case "scale": return "scale3d(0.92, 0.92, 1)";
    case "fade":  return "translate3d(0, 0, 0)";
    case "none":  return "translate3d(0, 0, 0)";
    default:      return "translate3d(0, " + distance + "px, 0)";
  }
}

/**
 * Read all zh-animate-* options from an element, returning a config object.
 */
function readConfig(el) {
  var d = getDefaults();
  return {
    direction: attr(el, ATTR.root, d.direction),
    delay:     attrMs(el, ATTR.delay, d.delay),
    duration:  attrMs(el, ATTR.duration, d.duration),
    distance:  attrNumber(el, ATTR.distance, d.distance),
    easing:    attr(el, ATTR.easing, d.easing),
    threshold: attrNumber(el, ATTR.threshold, d.threshold),
    once:      attrBool(el, ATTR.once, d.once),
    mobile:    attrBool(el, ATTR.mobile, d.mobile),
    after:     readAfter(el),
  };
}

// zh-animate-after can sit on the element itself or on a wrapper such as
// the section, so one attribute covers everything inside it.
function readAfter(el) {
  var host = el.hasAttribute(ATTR.after) ? el : el.closest("[" + ATTR.after + "]");
  return host ? attrMs(host, ATTR.after, 0) : 0;
}

// ───────────────────────────────────────────────────────────────────────────
// Initial state — hides element before it scrolls into view
// ───────────────────────────────────────────────────────────────────────────

/**
 * Apply the hidden (pre-animation) styles to an element.
 */
function setHiddenState(el, cfg) {
  var opacity = cfg.direction === "none" ? "1" : "0";
  var transform = getInitialTransform(cfg.direction, cfg.distance);

  el.style.opacity = opacity;
  el.style.transform = transform;
  el.style.willChange = "opacity, transform";

  // Remove any leftover transition so initial state is instant
  el.style.transition = "none";

  el.classList.remove("is-animated");
}

/**
 * Animate element to its natural position (visible state).
 */
function setVisibleState(el, cfg, delay) {
  var totalDelay = delay || 0;

  // Use rAF to ensure the hidden state is painted before transition starts
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      el.style.transition =
        "opacity " + cfg.duration + "ms " + cfg.easing + " " + totalDelay + "ms, " +
        "transform " + cfg.duration + "ms " + cfg.easing + " " + totalDelay + "ms";
      el.style.opacity = "1";
      el.style.transform = "translate3d(0, 0, 0)";

      // Add "is-animated" class after transition completes
      var cleanup = function () {
        el.style.willChange = "";
        el.classList.add("is-animated");
        el.removeEventListener("transitionend", cleanup);
      };
      el.addEventListener("transitionend", cleanup);
    });
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Stagger — apply incremental delays to children of a stagger container
// ───────────────────────────────────────────────────────────────────────────

/**
 * Find all stagger containers and compute additional delay for each child.
 * Stores the computed stagger delay on el.__zhAnimateStagger.
 */
function applyStaggerDelays() {
  var containers = document.querySelectorAll("[" + ATTR.stagger + "]");
  for (var i = 0; i < containers.length; i++) {
    var container = containers[i];
    var staggerMs = attrMs(container, ATTR.stagger, 0);
    if (staggerMs <= 0) continue;

    // Find direct children that have zh-animate
    var children = container.children;
    var idx = 0;
    for (var c = 0; c < children.length; c++) {
      if (children[c].hasAttribute(ATTR.root)) {
        children[c].__zhAnimateStagger = idx * staggerMs;
        idx++;
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// IntersectionObserver callback
// ───────────────────────────────────────────────────────────────────────────

function onIntersect(entries) {
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var el = entry.target;
    var cfg = el.__zhAnimateCfg;
    if (!cfg) continue;

    // Skip mobile if disabled
    if (isMobile && !cfg.mobile) continue;

    if (entry.isIntersecting) {
      // Element entered viewport — animate in
      var staggerDelay = el.__zhAnimateStagger || 0;
      // after: wait only for whatever is left of it since the page
      // started. Visible on load → waits for the hero; scrolled into view
      // later → that time has passed, so no extra wait.
      var afterLeft = cfg.after ? Math.max(0, cfg.after - (performance.now() - startedAt)) : 0;
      var totalDelay = Math.max(cfg.delay, afterLeft) + staggerDelay;
      setVisibleState(el, cfg, totalDelay);

      // If animate-once, stop observing after it enters
      if (cfg.once && observer) {
        observer.unobserve(el);
      }
    } else {
      // Element left viewport — reset if not once-only
      if (!cfg.once) {
        setHiddenState(el, cfg);
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Core: scan DOM, set initial states, observe
// ───────────────────────────────────────────────────────────────────────────

/**
 * Scan the DOM for [zh-animate] elements that haven't been initialized yet.
 * Sets their hidden state and starts observing them.
 */
function scan() {
  checkMobile();
  applyStaggerDelays();

  var nodes = document.querySelectorAll("[" + ATTR.root + "]");
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];

    // Skip already-initialized elements
    if (el.__zhAnimateInit) continue;
    el.__zhAnimateInit = true;

    var cfg = readConfig(el);
    el.__zhAnimateCfg = cfg;

    // If mobile animations are disabled and we're on mobile, skip entirely
    if (isMobile && !cfg.mobile) continue;

    // Set hidden (pre-animation) state immediately
    setHiddenState(el, cfg);

    // Track for cleanup
    elements.push(el);

    // Observe with the element's own threshold
    // We group elements by threshold for efficiency, but since each element
    // can have its own threshold we create per-threshold observers as needed.
    observeElement(el, cfg.threshold);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Observer management — group by threshold for efficiency
// ───────────────────────────────────────────────────────────────────────────
var observers = {};  // keyed by threshold string

function observeElement(el, threshold) {
  var key = String(threshold);

  if (!observers[key]) {
    observers[key] = new IntersectionObserver(onIntersect, {
      threshold: threshold,
      rootMargin: "0px",
    });
  }

  observers[key].observe(el);
}

// ───────────────────────────────────────────────────────────────────────────
// Public: refresh — re-scans DOM for new elements (e.g. after CMS load)
// ───────────────────────────────────────────────────────────────────────────
function refresh() {
  scan();
}

// ───────────────────────────────────────────────────────────────────────────
// Public: destroy — disconnect observers, clean up inline styles
// ───────────────────────────────────────────────────────────────────────────
function destroy() {
  // Disconnect all observers
  var keys = Object.keys(observers);
  for (var k = 0; k < keys.length; k++) {
    observers[keys[k]].disconnect();
  }
  observers = {};

  // Clean up element styles and flags
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    el.style.opacity = "";
    el.style.transform = "";
    el.style.transition = "";
    el.style.willChange = "";
    el.classList.remove("is-animated");
    delete el.__zhAnimateInit;
    delete el.__zhAnimateCfg;
    delete el.__zhAnimateStagger;
  }
  elements = [];
}

// ───────────────────────────────────────────────────────────────────────────
// Bootstrap — called by the loader
// ───────────────────────────────────────────────────────────────────────────
// Content may have been hidden until now to avoid a flash before the first
// animation (head snippet / loader). Every element has its own start state
// once this runs, so lift the page-wide hiding.
function releasePending() {
  document.documentElement.classList.remove("zh-animate-pending");
}

function bootstrap() {
  startedAt = performance.now();
  // WCAG 2.3.3 — respect prefers-reduced-motion. Elements are shown
  // immediately without any animation, so nothing stays invisible.
  if (prefersReducedMotion()) {
    var els = document.querySelectorAll("[" + ATTR.root + "]");
    for (var i = 0; i < els.length; i++) {
      els[i].style.opacity = "";
      els[i].style.transform = "";
      els[i].classList.add("is-animated");
    }
    releasePending();
    return;
  }

  scan();
  releasePending();

  // Re-check mobile on resize
  window.addEventListener("resize", function () {
    checkMobile();
  });
}

// ── Public API (exposed on window AND as ES module exports) ─────────────
window.Zweihander = window.Zweihander || {};
window.Zweihander.animate = {
  init:    bootstrap,
  refresh: refresh,
  destroy: destroy,
  defaults: function (opts) {
    window.Zweihander.animateDefaults = opts;
  },
};

// Named exports for the loader
export { bootstrap as init };
