/**
 * Zweihander — zh-parallax
 * Native, dependency-free parallax for Webflow.
 * Uses IntersectionObserver + requestAnimationFrame for performance.
 * GPU-accelerated via translate3d, Safari-friendly.
 *
 * Works on BOTH images and divs:
 *
 *   <!-- On an image: auto-wraps in a clipping container -->
 *   <img zh-parallax src="hero.jpg" alt="…" />
 *
 *   <!-- On a div with a background or child content -->
 *   <div zh-parallax>
 *     <img src="hero.jpg" alt="…" />
 *   </div>
 *
 *   <!-- With explicit inner target (only the inner moves): -->
 *   <div zh-parallax>
 *     <div zh-parallax-inner>…</div>
 *     <h2>This heading stays put</h2>
 *   </div>
 *
 * Attributes (all zh-parallax-* prefixed):
 *   zh-parallax              — the parallax element (img or wrapper div)
 *   zh-parallax-speed="0.3"  — intensity: 0 = none, 1 = full scroll, negative = reverse. Default 0.3
 *   zh-parallax-direction    — "vertical" (default) or "horizontal"
 *   zh-parallax-scale="1.2"  — how much taller the inner element is (prevents edge gaps). Default 1.2
 *   zh-parallax-inner        — explicit inner target (only this child moves)
 *
 * Style it however you like in Webflow. The script only sets inline
 * transform / overflow values and never touches classes.
 *
 * prefers-reduced-motion: parallax is skipped entirely (WCAG 2.3.3).
 */

// ES module — loaded by zweihander.js loader

// ───────────────────────────────────────────────────────────────────────────
// Attribute names
// ───────────────────────────────────────────────────────────────────────────
var ATTR = {
  root: "zh-parallax",
  inner: "zh-parallax-inner",
  speed: "zh-parallax-speed",
  direction: "zh-parallax-direction",
  scale: "zh-parallax-scale",
};

// ───────────────────────────────────────────────────────────────────────────
// Helpers
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
var instances = [];
var rafId = null;
var observer = null;
var resizeRaf = null;
var bound = false;

// ───────────────────────────────────────────────────────────────────────────
// Detect if an element is an image-like element
// ───────────────────────────────────────────────────────────────────────────
function isImageElement(el) {
  var tag = el.tagName.toLowerCase();
  return tag === "img" || tag === "picture" || tag === "video";
}

// ───────────────────────────────────────────────────────────────────────────
// ParallaxItem — one instance per zh-parallax element
// ───────────────────────────────────────────────────────────────────────────
function ParallaxItem(el) {
  // ── Read options from attributes, falling back to global defaults ────
  var d = (window.Zweihander && window.Zweihander.parallaxDefaults) || {};
  this.speed = attrNumber(el, ATTR.speed, d.speed != null ? d.speed : 0.3);
  this.direction = attr(el, ATTR.direction, d.direction || "vertical");
  this.scale = attrNumber(el, ATTR.scale, d.scale != null ? d.scale : 1.2);

  this.wrapped = false; // did we auto-create a wrapper?

  // ── Handle img/picture/video: auto-wrap in a clipping container ──────
  if (isImageElement(el)) {
    var wrapper = document.createElement("div");

    // Copy layout-relevant styles from the image to the wrapper
    var cs = window.getComputedStyle(el);
    wrapper.style.position = cs.position === "absolute" || cs.position === "fixed"
      ? cs.position : "relative";
    wrapper.style.overflow = "hidden";
    wrapper.style.display = cs.display === "inline" ? "block" : cs.display;

    // Copy dimensions — wrapper takes the image's original space
    if (el.style.width) wrapper.style.width = el.style.width;
    if (el.style.height) wrapper.style.height = el.style.height;
    if (el.style.maxWidth) wrapper.style.maxWidth = el.style.maxWidth;
    if (cs.borderRadius && cs.borderRadius !== "0px") {
      wrapper.style.borderRadius = cs.borderRadius;
    }
    if (cs.margin && cs.margin !== "0px") {
      wrapper.style.margin = cs.margin;
      el.style.margin = "0";
    }

    // Insert wrapper into DOM and move the image inside
    el.parentNode.insertBefore(wrapper, el);
    wrapper.appendChild(el);

    // Transfer the zh-parallax attribute to the wrapper
    wrapper.setAttribute(ATTR.root, el.getAttribute(ATTR.root) || "");

    // The image becomes the inner element
    this.root = wrapper;
    this.inner = el;
    this.wrapped = true;

    // Image styles: fill the wrapper, scaled taller for parallax travel
    el.style.display = "block";
    el.style.width = "100%";
    el.style.height = (this.scale * 100) + "%";
    el.style.objectFit = "cover";
    el.style.objectPosition = "center";
  } else {
    // ── Div/section: use as-is, find inner element ────────────────────
    this.root = el;
    this.inner = el.querySelector("[" + ATTR.inner + "]") || el.firstElementChild;

    if (!this.inner) {
      console.warn("[zh-parallax] no child element found inside", el);
      return;
    }

    // Wrapper clips overflow
    this.root.style.overflow = "hidden";

    // Inner element: scale it to cover gaps
    this.inner.style.width = "100%";
    this.inner.style.height = (this.scale * 100) + "%";

    // If the inner is an img, make sure it covers
    if (this.inner.tagName.toLowerCase() === "img") {
      this.inner.style.objectFit = "cover";
      this.inner.style.objectPosition = "center";
      this.inner.style.display = "block";
    }
  }

  // ── Common inner styles ──────────────────────────────────────────────
  this.inner.style.willChange = "transform";

  // Set initial position (centered)
  this.inner.style.transform = "translate3d(0, 0, 0)";

  // ── Cache layout measurements ────────────────────────────────────────
  this.inViewport = false;
  this._measure();

  // ── Store reference on the DOM node for external access ──────────────
  this.root.__zhParallax = this;
}

// ── Measure element position (called on init + resize) ─────────────────
ParallaxItem.prototype._measure = function () {
  var rect = this.root.getBoundingClientRect();
  var scrollY = window.pageYOffset || document.documentElement.scrollTop;
  var scrollX = window.pageXOffset || document.documentElement.scrollLeft;

  this.offsetTop = rect.top + scrollY;
  this.offsetLeft = rect.left + scrollX;
  this.height = rect.height;
  this.width = rect.width;
};

// ── Per-frame update (only when in viewport) ───────────────────────────
ParallaxItem.prototype._update = function () {
  if (!this.inViewport) return;

  var viewH = window.innerHeight;
  var viewW = window.innerWidth;

  if (this.direction === "horizontal") {
    var scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    var progressX = (scrollX + viewW - this.offsetLeft) / (viewW + this.width);
    progressX = clamp(progressX, 0, 1);
    // Max travel = extra height from scaling
    var maxShiftX = this.width * (this.scale - 1) * 0.5;
    var tx = (progressX - 0.5) * 2 * maxShiftX * this.speed;
    this.inner.style.transform = "translate3d(" + tx.toFixed(2) + "px, 0, 0)";
  } else {
    var scrollY = window.pageYOffset || document.documentElement.scrollTop;
    var progressY = (scrollY + viewH - this.offsetTop) / (viewH + this.height);
    progressY = clamp(progressY, 0, 1);
    var maxShiftY = this.height * (this.scale - 1) * 0.5;
    var ty = (progressY - 0.5) * 2 * maxShiftY * this.speed;
    this.inner.style.transform = "translate3d(0, " + ty.toFixed(2) + "px, 0)";
  }
};

// ── Cleanup ────────────────────────────────────────────────────────────
ParallaxItem.prototype.destroy = function () {
  if (observer && this.root) {
    observer.unobserve(this.root);
  }

  // Reset inner styles
  if (this.inner) {
    this.inner.style.transform = "";
    this.inner.style.willChange = "";
    this.inner.style.width = "";
    this.inner.style.height = "";
    this.inner.style.objectFit = "";
    this.inner.style.objectPosition = "";
    this.inner.style.display = "";
    this.inner.style.margin = "";
  }

  // If we auto-wrapped, unwrap: move inner back to original position
  if (this.wrapped && this.root && this.inner) {
    this.root.parentNode.insertBefore(this.inner, this.root);
    this.root.parentNode.removeChild(this.root);
  } else if (this.root) {
    this.root.style.overflow = "";
  }

  this.root.__zhParallaxInit = false;
  delete this.root.__zhParallax;
};

// ───────────────────────────────────────────────────────────────────────────
// Animation loop
// ───────────────────────────────────────────────────────────────────────────
function tick() {
  var anyVisible = false;
  for (var i = 0; i < instances.length; i++) {
    if (instances[i].inViewport) {
      instances[i]._update();
      anyVisible = true;
    }
  }
  if (anyVisible) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = null;
  }
}

function startLoop() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// IntersectionObserver
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
      startLoop();
    },
    {
      rootMargin: "10% 0px",
      threshold: 0,
    }
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Global listeners
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
// Bootstrap
// ───────────────────────────────────────────────────────────────────────────
function bootstrap() {
  // WCAG 2.3.3 — respect prefers-reduced-motion
  if (prefersReducedMotion()) return;

  createObserver();
  bindGlobal();

  var els = document.querySelectorAll("[" + ATTR.root + "]");
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.__zhParallaxInit) continue;
    el.__zhParallaxInit = true;

    // For images: wait until loaded before measuring
    if (isImageElement(el) && !el.complete) {
      (function (target) {
        target.addEventListener("load", function onLoad() {
          target.removeEventListener("load", onLoad);
          initOne(target);
        });
      })(el);
    } else {
      initOne(el);
    }
  }
}

function initOne(el) {
  try {
    var item = new ParallaxItem(el);
    instances.push(item);
    observer.observe(item.root);
  } catch (err) {
    console.error("[zh-parallax] init failed", el, err);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Destroy
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

// ── Public API ─────────────────────────────────────────────────────────
window.Zweihander = window.Zweihander || {};
window.Zweihander.parallax = {
  init: bootstrap,
  destroy: destroyAll,
  defaults: function (opts) {
    window.Zweihander.parallaxDefaults = opts;
  },
};

export { bootstrap as init };
