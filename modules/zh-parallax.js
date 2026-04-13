/**
 * Zweihander — zh-parallax
 * Native, dependency-free parallax for Webflow.
 * Scroll math from Ukiyo.js, with WCAG accessibility.
 *
 * Usage:
 *   <img zh-parallax src="hero.jpg" alt="…" />
 *   <div zh-parallax><img src="hero.jpg" /></div>
 *
 * Attributes:
 *   zh-parallax                — the element to parallax
 *   zh-parallax-speed="1.5"   — intensity (default 1.5)
 *   zh-parallax-scale="1.15"  — image oversizing (default 1.15)
 *
 * Global defaults:
 *   window.Zweihander.parallaxDefaults = { speed: 1.5, scale: 1.15 }
 *
 * prefers-reduced-motion: skips init entirely (WCAG 2.3.3).
 */

var ATTR = {
  root: "zh-parallax",
  speed: "zh-parallax-speed",
  scale: "zh-parallax-scale",
};

function attrNum(el, name, fb) {
  if (!el || !el.hasAttribute(name)) return fb;
  var n = parseFloat(el.getAttribute(name));
  return isNaN(n) ? fb : n;
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function isImg(el) {
  var t = el.tagName.toLowerCase();
  return t === "img" || t === "picture" || t === "video";
}
function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

var items = [], rafId = null, observer = null, bound = false, resizeRaf = null;

// ── Small-screen damping (Ukiyo formula) ─────────────────────────────────
function calcDamp(speed, scale) {
  var w = window.innerWidth;
  if (w > 1000 || (speed < 1.4 && scale < 1.4)) return 1;
  var e = Math.max(1, scale), i = Math.max(1, speed);
  var n = 1.2 - (1 - (w / 1000 + (3 - (e + i))));
  return clamp(Math.floor(n * 100) / 100, 0.5, 1);
}

// ── ParallaxItem ─────────────────────────────────────────────────────────
function ParallaxItem(el) {
  var d = (window.Zweihander && window.Zweihander.parallaxDefaults) || {};
  this.speed = attrNum(el, ATTR.speed, d.speed != null ? d.speed : 1.5);
  this.scale = attrNum(el, ATTR.scale, d.scale != null ? d.scale : 1.15);
  this.wrapped = false;
  this.visible = false;
  this.origEl = el; // keep ref to the original element

  if (isImg(el)) {
    this._wrapImage(el);
  } else {
    this.wrapper = el;
    this.inner = el.firstElementChild;
    if (!this.inner) { console.warn("[zh-parallax] no child in", el); return; }
  }

  // Wrapper: clip overflow, needs position for layout
  this.wrapper.style.overflow = "hidden";
  if (!this.wrapper.style.position || this.wrapper.style.position === "static") {
    this.wrapper.style.position = "relative";
  }

  // Inner: GPU-accelerated, cover the wrapper
  this.inner.style.display = "block";
  this.inner.style.willChange = "transform";
  if (isImg(this.inner)) {
    this.inner.style.objectFit = "cover";
  }

  this._measure();
  this.wrapper.__zhParallax = this;
}

// ── Wrap an image element (exactly like Ukiyo) ──────────────────────────
ParallaxItem.prototype._wrapImage = function (el) {
  // Measure the RENDERED size before touching anything
  var elH = el.getBoundingClientRect().height;
  var cs = window.getComputedStyle(el);

  // Create wrapper div
  var w = document.createElement("div");

  // The wrapper must occupy exactly the same space as the original image.
  // Copy ALL the image's CSS classes so Webflow styles carry over.
  if (el.className) w.className = el.className;

  // Position: inherit absolute/fixed, otherwise relative (for overflow clip)
  var pos = cs.position;
  if (pos === "absolute" || pos === "fixed") {
    w.style.position = pos;
  } else {
    w.style.position = "relative";
  }
  w.style.overflow = "hidden";

  // Lock the wrapper height to the image's rendered height.
  // Width comes from the copied classes (e.g. width:100% from Webflow).
  w.style.height = elH + "px";

  // Transfer margins to wrapper, zero them on the image
  if (cs.margin && cs.margin !== "0px") {
    w.style.margin = cs.margin;
    el.style.margin = "0";
  }

  // DOM: insert wrapper where image was, move image inside
  el.parentNode.insertBefore(w, el);
  w.appendChild(el);

  // Transfer the attribute so the observer can find the wrapper
  w.setAttribute(ATTR.root, el.getAttribute(ATTR.root) || "");

  this.wrapper = w;
  this.inner = el;
  this.wrapped = true;

  // Clear the image's classes (wrapper has them now) and reset image styles
  // so the image fills the wrapper purely via inline styles
  el.className = "";
  el.style.width = "100%";
  el.style.margin = "0";
  el.style.padding = "0";
  el.style.border = "0";
  el.style.display = "block";
  el.style.objectFit = "cover";
};

// ── Measure + set dimensions ─────────────────────────────────────────────
ParallaxItem.prototype._measure = function () {
  var wH;

  if (this.wrapped) {
    // Temporarily unlock height so we can re-measure at current viewport
    this.inner.style.height = "auto";
    this.wrapper.style.height = "auto";
    wH = this.inner.getBoundingClientRect().height;
    // Re-lock wrapper to measured height
    this.wrapper.style.height = wH + "px";
  } else {
    wH = this.wrapper.getBoundingClientRect().height;
  }

  // Inner height: original height × scale (Ukiyo formula)
  var innerH = Math.floor(10 * (wH * this.scale)) / 10;
  this.inner.style.height = innerH + "px";

  // Overflow: how many extra pixels the inner has (negative)
  this.overflow = Math.floor(10 * (wH - innerH)) / 10;

  // Cache position
  var scrollY = window.pageYOffset || document.documentElement.scrollTop;
  var rect = this.wrapper.getBoundingClientRect();
  this.elTop = rect.top + scrollY;
  this.elH = rect.height;

  // Damping + centering offset
  this.damp = calcDamp(this.speed, this.scale);
  this.offset = (this.overflow * this.speed - this.overflow) / 2;
};

// ── Per-frame update (Ukiyo scroll formula) ──────────────────────────────
ParallaxItem.prototype._update = function () {
  if (!this.visible) return;
  var scrollY = Math.max(0, window.pageYOffset || document.documentElement.scrollTop);
  var viewH = window.innerHeight;
  var raw = (scrollY + viewH - this.elTop) / ((viewH + this.elH) / 100);
  var progress = clamp(raw, 0, 100) / 100;
  var ty = this.overflow * (1 - progress) * this.speed * this.damp - this.offset;
  this.inner.style.transform = "translate3d(0," + ty.toFixed(2) + "px,0)";
};

// ── Destroy ──────────────────────────────────────────────────────────────
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
    this.inner.style.padding = "";
    this.inner.style.border = "";
  }
  // Unwrap: move image back, restore its classes
  if (this.wrapped && this.wrapper && this.inner && this.wrapper.parentNode) {
    if (this.wrapper.className) this.inner.className = this.wrapper.className;
    this.wrapper.parentNode.insertBefore(this.inner, this.wrapper);
    this.wrapper.parentNode.removeChild(this.wrapper);
  } else if (this.wrapper) {
    this.wrapper.style.overflow = "";
  }
  if (this.wrapper) {
    this.wrapper.__zhParallaxInit = false;
    delete this.wrapper.__zhParallax;
  }
};

// ── Loop ─────────────────────────────────────────────────────────────────
function tick() {
  var any = false;
  for (var i = 0; i < items.length; i++) {
    if (items[i].visible) { items[i]._update(); any = true; }
  }
  rafId = any ? requestAnimationFrame(tick) : null;
}
function startLoop() { if (!rafId) rafId = requestAnimationFrame(tick); }

// ── Observer ─────────────────────────────────────────────────────────────
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
  if (bound) return; bound = true;
  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("orientationchange", onResize, { passive: true });
  window.addEventListener("load", onResize, { passive: true });
}
function unbindGlobal() {
  if (!bound) return; bound = false;
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
  } catch (err) { console.error("[zh-parallax]", el, err); }
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
      (function (t) {
        t.addEventListener("load", function f() { t.removeEventListener("load", f); initOne(t); });
      })(el);
    } else { initOne(el); }
  }
}

function destroyAll() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  for (var i = 0; i < items.length; i++) items[i].destroy();
  items = [];
  if (observer) { observer.disconnect(); observer = null; }
  unbindGlobal();
}

// ── API ──────────────────────────────────────────────────────────────────
window.Zweihander = window.Zweihander || {};
window.Zweihander.parallax = {
  init: bootstrap,
  destroy: destroyAll,
  defaults: function (opts) { window.Zweihander.parallaxDefaults = opts; },
};

export { bootstrap as init };
