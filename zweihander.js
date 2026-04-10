/**
 * Zweihander — Module Loader
 * Reads zh-* attributes from the script tag and dynamically imports
 * only the modules you need.
 *
 * Usage:
 *   <script async type="module"
 *     src="https://cdn.jsdelivr.net/gh/USER/zweihander@main/zweihander.js"
 *     zh-slider
 *     zh-parallax
 *     zh-animate
 *     zh-filter
 *   ></script>
 */

const MODULES = ["slider", "parallax", "animate", "filter"];

// Resolve the base URL so module imports come from the same CDN origin.
const loaderScript =
  document.querySelector("script[src*='zweihander']") ||
  document.currentScript;

const baseUrl = loaderScript
  ? loaderScript.src.replace(/\/[^/]*$/, "")
  : ".";

// Global API
window.Zweihander = window.Zweihander || {};
window.Zweihander._loaded = window.Zweihander._loaded || {};

async function loadModule(name) {
  if (window.Zweihander._loaded[name]) return;
  window.Zweihander._loaded[name] = "loading";

  try {
    const mod = await import(`${baseUrl}/modules/zh-${name}.js`);
    if (mod && typeof mod.init === "function") {
      // Boot via Webflow.push if available, otherwise run directly.
      if (typeof window.Webflow !== "undefined" && window.Webflow.push) {
        window.Webflow.push(() => mod.init());
      } else if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => mod.init());
      } else {
        mod.init();
      }
    }
    window.Zweihander._loaded[name] = "ready";
  } catch (err) {
    window.Zweihander._loaded[name] = "error";
    console.error(`[Zweihander] failed to load module "${name}"`, err);
  }
}

// Read zh-* attributes from the script tag to decide which modules to load.
const requested = [];
for (const name of MODULES) {
  if (loaderScript && loaderScript.hasAttribute(`zh-${name}`)) {
    requested.push(name);
  }
}

// If no specific modules requested, check for an auto-detect mode:
// <script ... zh-auto> scans the DOM for any zh-* elements in use.
if (!requested.length && loaderScript && loaderScript.hasAttribute("zh-auto")) {
  for (const name of MODULES) {
    if (document.querySelector(`[zh-${name}]`)) {
      requested.push(name);
    }
  }
}

// Load all requested modules in parallel.
Promise.all(requested.map(loadModule));
