/**
 * Zweihander — zh-parallax
 * Native, dependency-free parallax for Webflow.
 * Scroll math and DOM wrapping from Ukiyo.js, with WCAG accessibility.
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

var items = [], rafId = null, observer = null, bound = false, resizeTimer = null;

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
  this.element = el;
  this.wrapper = document.createElement("div");
  this.visible = false;
  this.vh = document.documentElement.clientHeight;
  this.elementTag = el.tagName.toLowerCase();

  var d = (window.Zweihander && window.Zweihander.parallaxDefaults) || {};
  this.speed = attrNum(el, ATTR.speed, d.speed != null ? d.speed : 1.5);
  this.scale = attrNum(el, ATTR.scale, d.scale != null ? d.scale : 1.15);
  this.damp = calcDamp(this.speed, this.scale);

  this.setStyle(true);
  this.wrapElement();
  this.createObserver();
}

// ── Set styles on wrapper + element (Ukiyo pattern) ──────────────────────
// First call (init=true) also sets one-time styles.
// Called again on resize after a reset.
ParallaxItem.prototype.setStyle = function (init) {
  var el = this.element;
  var elH = el.clientHeight;
  var elW = el.clientWidth;
  var cs = window.getComputedStyle(el);
  var isAbs = cs.position === "absolute";
  var ws = this.wrapper.style;
  var es = el.style;

  // Overflow: extra pixels from scaling (negative)
  this.overflow = Math.floor(10 * (elH - elH * this.scale)) / 10;

  // ── Transfer layout properties from element to wrapper ──────────────

  // Margins → wrapper
  if (cs.marginTop !== "0px" || cs.marginBottom !== "0px") {
    ws.marginTop = cs.marginTop;
    ws.marginBottom = cs.marginBottom;
    es.marginTop = "0";
    es.marginBottom = "0";
  }

  // Absolute positioning: transfer inset to wrapper
  if (cs.inset && cs.inset !== "auto") {
    ws.top = cs.top;
    ws.right = cs.right;
    ws.bottom = cs.bottom;
    ws.left = cs.left;
    es.top = "0";
    es.right = "0";
    es.bottom = "0";
    es.left = "0";
  }

  // Transform, z-index, grid-area → wrapper
  if (cs.transform !== "none") {
    ws.transform = cs.transform;
    es.transform = "";
  }
  if (cs.zIndex !== "auto") ws.zIndex = cs.zIndex;
  if (cs.gridArea && cs.gridArea !== "auto" && cs.gridArea !== "auto / auto / auto / auto") {
    ws.gridArea = cs.gridArea;
    es.gridArea = "auto";
  }

  // Position
  ws.position = isAbs ? "absolute" : "relative";

  // One-time styles (only on init)
  if (init) {
    ws.width = "100%";
    ws.overflow = "hidden";
    es.display = "block";
    es.overflow = "hidden";
    es.backfaceVisibility = "hidden";
    if (cs.padding !== "0px") es.padding = "0";

    if (this.elementTag === "img") {
      es.objectFit = "cover";
    } else if (this.elementTag === "video") {
      es.objectFit = "cover";
    } else {
      es.backgroundPosition = "center";
    }
  }

  // Border radius → wrapper (with isolation to clip properly)
  if (cs.borderRadius !== "0px") {
    ws.borderRadius = cs.borderRadius;
    ws.isolation = "isolate";
    if (cs.marginLeft !== "0px") {
      ws.marginLeft = cs.marginLeft;
      es.marginLeft = "0";
    }
    if (cs.marginRight !== "0px") {
      ws.marginRight = cs.marginRight;
      es.marginRight = "0";
    }
    ws.width = elW + "px";
  }

  // Absolute elements: lock width
  if (isAbs) {
    ws.width = elW + "px";
    es.width = "100%";
  }

  // Max/min height → wrapper
  if (cs.maxHeight !== "none") {
    ws.maxHeight = cs.maxHeight;
    es.maxHeight = "none";
  }
  if (cs.minHeight !== "0px") {
    ws.minHeight = cs.minHeight;
    es.minHeight = "none";
  }

  // Final dimensions — the core of the parallax:
  // Wrapper = original size, Element = scaled taller
  es.width = elW + "px";
  ws.setProperty("height", elH + "px", "important");
  es.setProperty("height", (elH * this.scale) + "px", "important");

  this.wrapperHeight = elH;
};

// ── Wrap element in the wrapper div ──────────────────────────────────────
ParallaxItem.prototype.wrapElement = function () {
  // Handle <picture> wrapping
  var picture = this.element.closest("picture");
  if (picture) {
    picture.parentNode.insertBefore(this.wrapper, picture);
    this.wrapper.appendChild(picture);
  } else {
    var parent = this.element.parentNode;
    if (parent) {
      parent.insertBefore(this.wrapper, this.element);
      this.wrapper.appendChild(this.element);
    }
  }
  this.wrapper.setAttribute(ATTR.root + "-wrapper", "");
};

// ── Observer ─────────────────────────────────────────────────────────────
ParallaxItem.prototype.createObserver = function () {
  var self = this;
  this.observer = new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) {
      self.element.style.willChange = "transform";
      self.visible = true;
    } else {
      self.element.style.willChange = "";
      self.visible = false;
    }
    startLoop();
  }, { root: null, rootMargin: "0px", threshold: 0 });
  this.observer.observe(this.wrapper);
};

// ── Scroll math (Ukiyo formula) ──────────────────────────────────────────
ParallaxItem.prototype.calcTranslate = function () {
  var scrollY = Math.max(0, window.pageYOffset || 0);
  var elTop = this.wrapper.getBoundingClientRect().top + scrollY;
  var raw = (scrollY + this.vh - elTop) / ((this.vh + this.wrapperHeight) / 100);
  var progress = clamp(raw, 0, 100) / 100;
  var offset = (this.overflow * this.speed - this.overflow) / 2;
  return Number((this.overflow * (1 - progress) * this.speed * this.damp - offset).toFixed(4));
};

ParallaxItem.prototype.animate = function () {
  if (this.visible) {
    this.element.style.transform = "translate3d(0," + this.calcTranslate() + "px,0)";
  }
};

// ── Reset (called on resize — let browser re-layout, then re-measure) ────
ParallaxItem.prototype.reset = function () {
  this.damp = calcDamp(this.speed, this.scale);
  var ws = this.wrapper.style;
  var es = this.element.style;
  this.vh = document.documentElement.clientHeight;

  // Temporarily clear dimensions so the browser can re-layout
  ws.width = "";
  ws.position = "";
  ws.height = "100%";
  es.width = "";

  if (this.elementTag === "img" && ws.position === "absolute") {
    ws.height = "100%";
  }

  if (!ws.gridArea || ws.gridArea === "auto") {
    es.height = "";
  } else {
    es.height = "100%";
  }

  if (ws.margin !== "0px") {
    ws.margin = "";
    es.margin = "";
  }
  if (ws.inset !== "auto") {
    ws.top = ""; ws.right = ""; ws.bottom = ""; ws.left = "";
    es.top = ""; es.right = ""; es.bottom = ""; es.left = "";
  }
  if (ws.transform !== "none") {
    ws.transform = "";
    es.transform = "";
  }
  if (ws.zIndex !== "auto") ws.zIndex = "";
  if (ws.borderRadius !== "0px") {
    ws.borderRadius = "";
    ws.isolation = "";
  }

  // Re-measure and re-apply
  this.setStyle();
  this.animate();
};

// ── Destroy ──────────────────────────────────────────────────────────────
ParallaxItem.prototype.destroy = function () {
  if (this.observer) this.observer.disconnect();
  this.wrapper.removeAttribute("style");
  this.element.removeAttribute("style");
  // Unwrap: move children back
  while (this.wrapper.firstChild) {
    this.wrapper.parentNode.insertBefore(this.wrapper.firstChild, this.wrapper);
  }
  this.wrapper.parentNode.removeChild(this.wrapper);
};

// ── Animation loop ───────────────────────────────────────────────────────
function tick() {
  var any = false;
  for (var i = 0; i < items.length; i++) {
    if (items[i].visible) { items[i].animate(); any = true; }
  }
  rafId = any ? requestAnimationFrame(tick) : null;
}
function startLoop() { if (!rafId) rafId = requestAnimationFrame(tick); }

// ── Resize ───────────────────────────────────────────────────────────────
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function () {
    for (var i = 0; i < items.length; i++) items[i].reset();
  }, 500);
}

function bindGlobal() {
  if (bound) return; bound = true;
  if (navigator.userAgent.match(/(iPhone|iPad|iPod|Android)/)) {
    window.addEventListener("orientationchange", onResize);
  } else {
    window.addEventListener("resize", onResize);
  }
}
function unbindGlobal() {
  if (!bound) return; bound = false;
  window.removeEventListener("resize", onResize);
  window.removeEventListener("orientationchange", onResize);
}

// ── Bootstrap ────────────────────────────────────────────────────────────
function bootstrap() {
  if (prefersReducedMotion()) return;
  bindGlobal();

  var els = document.querySelectorAll("[" + ATTR.root + "]");
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.__zhParallaxInit) continue;
    el.__zhParallaxInit = true;

    if (el.tagName.toLowerCase() === "img") {
      var src = el.getAttribute("src");
      if (!src) continue;
      (function (target) {
        var img = new Image();
        img.src = src;
        if (img.decode) {
          img.decode().then(function () { initOne(target); });
        } else {
          img.onload = function () { initOne(target); };
        }
      })(el);
    } else {
      initOne(el);
    }
  }

  // Start the loop
  startLoop();
}

function initOne(el) {
  try {
    var item = new ParallaxItem(el);
    items.push(item);
  } catch (err) { console.error("[zh-parallax]", el, err); }
}

function destroyAll() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  for (var i = 0; i < items.length; i++) items[i].destroy();
  items = [];
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
