/**
 * Zweihander — zh-parallax
 * Native, dependency-free parallax for Webflow.
 * Uses IntersectionObserver + requestAnimationFrame for performance.
 * GPU-accelerated via translate3d, Safari-friendly.
 *
 * Markup:
 *   <div zh-parallax>
 *     <img src="hero.jpg" alt="…" />
 *   </div>
 *
 *   <!-- Or with explicit inner target: -->
 *   <div zh-parallax zh-parallax-speed="0.5" zh-parallax-scale="1.3">
 *     <div zh-parallax-inner>…</div>
 *   </div>
 *
 * Attributes (all zh-parallax-* prefixed):
 *   zh-parallax              — placed on the wrapper (clips overflow)
 *   zh-parallax-speed="0.5"  — intensity: 0 = none, 1 = full scroll, negative = reverse. Default 0.3
 *   zh-parallax-direction    — "vertical" (default) or "horizontal"
 *   zh-parallax-scale="1.3"  — scale factor to prevent edge gaps. Default 1.2
 *
 * Style it however you like in Webflow. The script only sets inline
 * transform / overflow values and never touches classes.
 */

// ES module — loaded by zweihander.js loader

// ───────────────────────────────────────────────────────────────────────────
// Attribute names — single source of truth
// ───────────────────────────────────────────────────────────────────────────
var ATTR = {
  root: "zh-parallax",
  inner: "zh-parallax-inner",
  speed: "zh-parallax-speed",
  direction: "zh-parallax-direction",
  scale: "zh-parallax-scale",
};

// ───────────────────────────────────────────────────────────────────────────
// Tiny helpers
// ───────────────────────────────────────────────────────────────────────────
function attrNumber(el, name, fallback) {
  if (!el || !el.hasAttribute(name)) return fallback;
  var raw = el.getAttribute(name);
  if (raw === null || raw === "") return fallback;
  var n = parseFloat(raw);
  return isNaN(n) ? fallback : n;
}

function attr(el, name, fallback) {
  if (!el || !el.hasAttribute(name)) return fallback;
  var raw = el.getAttribute(name);
  return raw === null || raw === "" ? fallback : raw;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ───────────────────────────────────────────────────────────────────────────
// Reduced motion check (WCAG 2.3.3)
// ───────────────────────────────────────────────────────────────────────────
function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ───────────────────────────────────────────────────────────────────────────
// Module state
// ───────────────────────────────────────────────────────────────────────────
var instances = [];       // all active ParallaxItem instances
var rafId = null;         // current requestAnimationFrame id
var observer = null;      // shared IntersectionObserver
var resizeRaf = null;     // debounced resize rAF id
var bound = false;        // whether global listeners are attached

// ───────────────────────────────────────────────────────────────────────────
// ParallaxItem — one instance per zh-parallax element
// ───────────────────────────────────────────────────────────────────────────
function ParallaxItem(root) {
  this.root = root;

  // ── Read options from attributes, falling back to global defaults ────
  // Global defaults can be set via: window.Zweihander.parallaxDefaults = { speed, scale, direction }
  var d = (window.Zweihander && window.Zweihander.parallaxDefaults) || {};
  this.speed = attrNumber(root, ATTR.speed, d.speed != null ? d.speed : 0.3);
  this.direction = attr(root, ATTR.direction, d.direction || "vertical");
  this.scale = attrNumber(root, ATTR.scale, d.scale != null ? d.scale : 1.2);

  // ── Find the inner element (explicit or first child) ──────────────────
  this.inner = root.querySelector("[" + ATTR.inner + "]") || root.firstElementChild;
  if (!this.inner) {
    console.warn("[zh-parallax] no child element found inside", root);
    return;
  }

  // ── Apply base styles ────────────────────────────────────────────────
  // Wrapper clips overflow so the scaled child doesn't bleed out
  root.style.overflow = "hidden";

  // Inner element gets scaled to cover potential gaps at scroll extremes
  this.inner.style.willChange = "transform";
  this.inner.style.backfaceVisibility = "hidden";
  this.inner.style.webkitBackfaceVisibility = "hidden";

  // Scale uses the same translate3d string we update each frame,
  // so we just set the initial transform here
  this._applyScale();

  // ── Cache layout measurements ────────────────────────────────────────
  this.inViewport = false;
  this._measure();

  // ── Store reference on the DOM node for external access ──────────────
  root.__zhParallax = this;
}

// ── Measure element position (called on init + resize) ─────────────────
ParallaxItem.prototype._measure = function () {
  var rect = this.root.getBoundingClientRect();
  var scrollY = window.pageYOffset || document.documentElement.scrollTop;
  var scrollX = window.pageXOffset || document.documentElement.scrollLeft;

  // Absolute position in the document
  this.offsetTop = rect.top + scrollY;
  this.offsetLeft = rect.left + scrollX;
  this.height = rect.height;
  this.width = rect.width;
};

// ── Apply scale transform (without clobbering the translate) ───────────
ParallaxItem.prototype._applyScale = function () {
  // We always build the full transform string in _update,
  // but on init we need at least the scale so there are no gaps
  if (this.direction === "horizontal") {
    this.inner.style.transform =
      "translate3d(0, 0, 0) scale(" + this.scale + ")";
  } else {
    this.inner.style.transform =
      "translate3d(0, 0, 0) scale(" + this.scale + ")";
  }
};

// ── Per-frame update (only called when element is in viewport) ─────────
ParallaxItem.prototype._update = function () {
  if (!this.inViewport) return;

  var viewH = window.innerHeight;
  var viewW = window.innerWidth;

  if (this.direction === "horizontal") {
    // Horizontal parallax: based on element's horizontal position
    var scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    // How far through the viewport the element has travelled (0 → 1)
    var progressX = (scrollX + viewW - this.offsetLeft) / (viewW + this.width);
    progressX = clamp(progressX, 0, 1);
    // Max travel distance — proportional to the extra space from scaling
    var maxShiftX = this.width * (this.scale - 1) * 0.5;
    var tx = (progressX - 0.5) * 2 * maxShiftX * this.speed;
    this.inner.style.transform =
      "translate3d(" + tx.toFixed(2) + "px, 0, 0) scale(" + this.scale + ")";
  } else {
    // Vertical parallax (default)
    var scrollY = window.pageYOffset || document.documentElement.scrollTop;
    // How far through the viewport the element has travelled (0 → 1)
    var progressY = (scrollY + viewH - this.offsetTop) / (viewH + this.height);
    progressY = clamp(progressY, 0, 1);
    // Max travel distance — proportional to the extra space from scaling
    var maxShiftY = this.height * (this.scale - 1) * 0.5;
    var ty = (progressY - 0.5) * 2 * maxShiftY * this.speed;
    this.inner.style.transform =
      "translate3d(0, " + ty.toFixed(2) + "px, 0) scale(" + this.scale + ")";
  }
};

// ── Cleanup ─────────────────────────────────────────────────────────────
ParallaxItem.prototype.destroy = function () {
  // Reset inline styles
  this.root.style.overflow = "";
  if (this.inner) {
    this.inner.style.transform = "";
    this.inner.style.willChange = "";
    this.inner.style.backfaceVisibility = "";
    this.inner.style.webkitBackfaceVisibility = "";
  }
  // Remove observer tracking
  if (observer && this.root) {
    observer.unobserve(this.root);
  }
  this.root.__zhParallaxInit = false;
  delete this.root.__zhParallax;
};

// ───────────────────────────────────────────────────────────────────────────
// Animation loop — runs only when at least one element is in the viewport
// ───────────────────────────────────────────────────────────────────────────
function tick() {
  var anyVisible = false;
  for (var i = 0; i < instances.length; i++) {
    if (instances[i].inViewport) {
      instances[i]._update();
      anyVisible = true;
    }
  }
  // Keep the loop alive only while something is visible
  if (anyVisible) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = null;
  }
}

function startLoop() {
  if (rafId !== null) return; // already running
  rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// IntersectionObserver — gates the rAF loop per-element
// ───────────────────────────────────────────────────────────────────────────
function createObserver() {
  if (observer) return;
  observer = new IntersectionObserver(
    function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var inst = entry.target.__zhParallax;
        if (!inst) continue;
        inst.inViewport = entry.isIntersecting;
      }
      // Kick the loop if anything just entered the viewport
      startLoop();
    },
    {
      // Observe slightly outside the viewport so the effect starts
      // before the element scrolls into view (avoids pop-in)
      rootMargin: "10% 0px",
      threshold: 0,
    }
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Global listeners (resize + orientationchange)
// ───────────────────────────────────────────────────────────────────────────
function onResize() {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(function () {
    for (var i = 0; i < instances.length; i++) {
      instances[i]._measure();
      instances[i]._update();
    }
  });
}

function bindGlobal() {
  if (bound) return;
  bound = true;
  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("orientationchange", onResize, { passive: true });
  // Also recalculate after images / fonts finish loading
  window.addEventListener("load", onResize, { passive: true });
}

function unbindGlobal() {
  if (!bound) return;
  bound = false;
  window.removeEventListener("resize", onResize);
  window.removeEventListener("orientationchange", onResize);
  window.removeEventListener("load", onResize);
}

// ───────────────────────────────────────────────────────────────────────────
// Bootstrap — find all [zh-parallax] elements and initialise them
// ───────────────────────────────────────────────────────────────────────────
function bootstrap() {
  // WCAG 2.3.3 — respect prefers-reduced-motion. When enabled, parallax
  // effects are skipped entirely. The images remain visible (just static).
  if (prefersReducedMotion()) return;

  createObserver();
  bindGlobal();

  var roots = document.querySelectorAll("[" + ATTR.root + "]");
  for (var i = 0; i < roots.length; i++) {
    var el = roots[i];
    if (el.__zhParallaxInit) continue;
    el.__zhParallaxInit = true;
    try {
      var item = new ParallaxItem(el);
      instances.push(item);
      observer.observe(el);
    } catch (err) {
      console.error("[zh-parallax] init failed", el, err);
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Destroy — tear down everything cleanly
// ───────────────────────────────────────────────────────────────────────────
function destroyAll() {
  stopLoop();

  for (var i = 0; i < instances.length; i++) {
    instances[i].destroy();
  }
  instances = [];

  if (observer) {
    observer.disconnect();
    observer = null;
  }

  unbindGlobal();
}

// ── Public API (exposed on window AND as ES module exports) ─────────────
window.Zweihander = window.Zweihander || {};
window.Zweihander.parallax = {
  init: bootstrap,
  destroy: destroyAll,
  defaults: function (opts) {
    window.Zweihander.parallaxDefaults = opts;
  },
};

// Named exports for the loader
export { bootstrap as init };
