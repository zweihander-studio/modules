/**
 * Zweihander — zh-parallax
 * Native, dependency-free parallax for Webflow.
 * Scroll-feel inspired by Ukiyo.js, with accessibility built in.
 *
 * Usage — just add zh-parallax to any image or wrapper div:
 *
 *   <img zh-parallax src="hero.jpg" alt="…" />
 *
 *   <div zh-parallax>
 *     <img src="hero.jpg" alt="…" />
 *   </div>
 *
 * Attributes:
 *   zh-parallax                — the element to parallax
 *   zh-parallax-speed="1.5"   — parallax intensity (default 1.5)
 *   zh-parallax-scale="1.5"   — image scale factor (default 1.5)
 *
 * Global defaults:
 *   window.Zweihander.parallaxDefaults = { speed: 1.5, scale: 1.5 }
 *
 * prefers-reduced-motion: skips init entirely (WCAG 2.3.3).
 */

var ATTR = {
  root: "zh-parallax",
  speed: "zh-parallax-speed",
  scale: "zh-parallax-scale",
};

// ── Helpers ──────────────────────────────────────────────────────────────
function attrNum(el, name, fallback) {
  if (!el || !el.hasAttribute(name)) return fallback;
  var n = parseFloat(el.getAttribute(name));
  return isNaN(n) ? fallback : n;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function isImg(el) {
  var tag = el.tagName.toLowerCase();
  return tag === "img" || tag === "picture" || tag === "video";
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ── Module state ─────────────────────────────────────────────────────────
var items = [];
var rafId = null;
var observer = null;
var bound = false;

// ── Damping on small screens (same logic as Ukiyo) ──────────────────────
function calcDamp(speed, scale) {
  var w = window.innerWidth;
  if (w > 1000 || (speed < 1.4 && scale < 1.4)) return 1;
  var e = Math.max(1, scale);
  var i = Math.max(1, speed);
  var n = 1.2 - (1 - (w / 1000 + (3 - (e + i))));
  return clamp(Math.floor(n * 100) / 100, 0.5, 1);
}

// ── ParallaxItem ─────────────────────────────────────────────────────────
function ParallaxItem(el) {
  var d = (window.Zweihander && window.Zweihander.parallaxDefaults) || {};
  this.speed = attrNum(el, ATTR.speed, d.speed != null ? d.speed : 1.5);
  this.scale = attrNum(el, ATTR.scale, d.scale != null ? d.scale : 1.5);
  this.wrapped = false;
  this.visible = false;

  // ── Image element: auto-wrap ───────────────────────────────────────
  if (isImg(el)) {
    this._wrapImage(el);
  } else {
    // Div/section: use as wrapper, first child is the inner
    this.wrapper = el;
    this.inner = el.firstElementChild;
    if (!this.inner) {
      console.warn("[zh-parallax] no child found in", el);
      return;
    }
  }

  // ── Wrapper styles ─────────────────────────────────────────────────
  this.wrapper.style.overflow = "hidden";
  this.wrapper.style.position = this.wrapper.style.position || "relative";

  // ── Inner styles ───────────────────────────────────────────────────
  this.inner.style.display = "block";
  this.inner.style.willChange = "transform";
  if (isImg(this.inner)) {
    this.inner.style.objectFit = "cover";
  }

  // ── Calculate dimensions ───────────────────────────────────────────
  this._measure();

  // Store ref
  this.wrapper.__zhParallax = this;
}

ParallaxItem.prototype._wrapImage = function (el) {
  // Measure rendered size BEFORE wrapping
  var rect = el.getBoundingClientRect();
  var cs = window.getComputedStyle(el);

  var w = document.createElement("div");
  w.style.overflow = "hidden";
  w.style.position = cs.position === "absolute" || cs.position === "fixed"
    ? cs.position : "relative";

  // Take over the image's space
  w.style.width = cs.width;
  w.style.height = rect.height + "px";

  // Inherit visual properties
  if (cs.borderRadius && cs.borderRadius !== "0px") w.style.borderRadius = cs.borderRadius;
  if (cs.margin && cs.margin !== "0px") {
    w.style.margin = cs.margin;
    el.style.margin = "0";
  }
  if (cs.gridArea && cs.gridArea !== "auto") w.style.gridArea = cs.gridArea;

  // DOM swap
  el.parentNode.insertBefore(w, el);
  w.appendChild(el);
  w.setAttribute(ATTR.root, el.getAttribute(ATTR.root) || "");

  this.wrapper = w;
  this.inner = el;
  this.wrapped = true;
};

ParallaxItem.prototype._measure = function () {
  // For wrapped images: re-measure natural height at current viewport
  if (this.wrapped) {
    this.inner.style.height = "";
    this.wrapper.style.height = "auto";
    var natH = this.inner.getBoundingClientRect().height;
    this.wrapper.style.height = natH + "px";
  }

  var wrapperH = this.wrapper.getBoundingClientRect().height;

  // Overflow = extra pixels from scaling (negative value)
  // e.g. 400px wrapper, scale 1.5 → inner 600px → overflow = -200
  this.overflow = Math.floor(10 * (wrapperH - wrapperH * this.scale)) / 10;

  // Set inner height to the scaled size
  this.inner.style.width = "100%";
  this.inner.style.height = (wrapperH * this.scale) + "px";

  // Cache wrapper position in document
  var scrollY = window.pageYOffset || document.documentElement.scrollTop;
  var rect = this.wrapper.getBoundingClientRect();
  this.elTop = rect.top + scrollY;
  this.elH = rect.height;

  // Damp factor for small screens
  this.damp = calcDamp(this.speed, this.scale);

  // Centering offset so image is centered at progress=0.5
  this.offset = (this.overflow * this.speed - this.overflow) / 2;
};

ParallaxItem.prototype._update = function () {
  if (!this.visible) return;

  var scrollY = Math.max(0, window.pageYOffset || document.documentElement.scrollTop);
  var viewH = window.innerHeight;

  // Progress: 0 = element entering viewport bottom, 1 = leaving viewport top
  var raw = (scrollY + viewH - this.elTop) / ((viewH + this.elH) / 100);
  var progress = clamp(raw, 0, 100) / 100;

  // Translate: same formula as Ukiyo for matching scroll feel
  var ty = this.overflow * (1 - progress) * this.speed * this.damp - this.offset;

  this.inner.style.transform = "translate3d(0," + ty.toFixed(2) + "px,0)";
};

ParallaxItem.prototype.destroy = function () {
  if (observer && this.wrapper) observer.unobserve(this.wrapper);

  if (this.inner) {
    this.inner.style.transform = "";
    this.inner.style.willChange = "";
    this.inner.style.width = "";
    this.inner.style.height = "";
    this.inner.style.objectFit = "";
    this.inner.style.display = "";
    this.inner.style.margin = "";
  }

  if (this.wrapped && this.wrapper && this.inner) {
    this.wrapper.parentNode.insertBefore(this.inner, this.wrapper);
    this.wrapper.parentNode.removeChild(this.wrapper);
  } else if (this.wrapper) {
    this.wrapper.style.overflow = "";
  }

  this.wrapper.__zhParallaxInit = false;
  delete this.wrapper.__zhParallax;
};

// ── Animation loop ───────────────────────────────────────────────────────
function tick() {
  var any = false;
  for (var i = 0; i < items.length; i++) {
    if (items[i].visible) {
      items[i]._update();
      any = true;
    }
  }
  rafId = any ? requestAnimationFrame(tick) : null;
}

function startLoop() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(tick);
}

// ── IntersectionObserver ─────────────────────────────────────────────────
function createObserver() {
  if (observer) return;
  observer = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var inst = entries[i].target.__zhParallax;
      if (inst) inst.visible = entries[i].isIntersecting;
    }
    startLoop();
  }, { rootMargin: "10% 0px", threshold: 0 });
}

// ── Resize ───────────────────────────────────────────────────────────────
var resizeRaf = null;
function onResize() {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(function () {
    for (var i = 0; i < items.length; i++) {
      items[i]._measure();
      items[i]._update();
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

// ── Bootstrap ────────────────────────────────────────────────────────────
function initOne(el) {
  try {
    var item = new ParallaxItem(el);
    items.push(item);
    observer.observe(item.wrapper);
  } catch (err) {
    console.error("[zh-parallax]", el, err);
  }
}

function bootstrap() {
  if (prefersReducedMotion()) return;

  createObserver();
  bindGlobal();

  var els = document.querySelectorAll("[" + ATTR.root + "]");
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.__zhParallaxInit) continue;
    el.__zhParallaxInit = true;

    if (isImg(el) && !el.complete) {
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

function destroyAll() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  for (var i = 0; i < items.length; i++) items[i].destroy();
  items = [];
  if (observer) { observer.disconnect(); observer = null; }
  unbindGlobal();
}

// ── Public API ───────────────────────────────────────────────────────────
window.Zweihander = window.Zweihander || {};
window.Zweihander.parallax = {
  init: bootstrap,
  destroy: destroyAll,
  defaults: function (opts) {
    window.Zweihander.parallaxDefaults = opts;
  },
};

export { bootstrap as init };
