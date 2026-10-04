# Zweihander Modules — Documentatie

Dependency-free modules voor Webflow. Laad alleen wat je nodig hebt via een enkele script-tag.

**Huidige versie:** `v1.6.4`

---

## Installatie

Plak dit in je Webflow project-instellingen onder **Custom Code > Footer Code**:

```html
<script async type="module"
  src="https://cdn.jsdelivr.net/gh/zweihander-studio/modules@v1.6.4/zweihander.min.js"
  zh-auto>
</script>
```

### Laden: automatisch vs. handmatig

| Methode | Script tag | Gedrag |
|---------|-----------|--------|
| **Auto-detect** | `zh-auto` | Scant de DOM en laadt alleen modules die daadwerkelijk op de pagina worden gebruikt |
| **Handmatig** | `zh-slider zh-animate` | Laadt specifiek de genoemde modules |

Voorbeeld handmatig (alleen slider + animate):
```html
<script async type="module"
  src="https://cdn.jsdelivr.net/gh/zweihander-studio/modules@v1.6.4/zweihander.min.js"
  zh-slider
  zh-animate>
</script>
```

### Beschikbare modules

| Module | Attribute | Wat het doet |
|--------|----------|-------------|
| **zh-slider** | `zh-slider` | Touch-slider met loop, autoplay, pagination, scrollbar, progress bar, timeline |
| **zh-animate** | `zh-animate` | Scroll-triggered animaties (fade, slide, scale) met IntersectionObserver |
| **zh-parallax** | `zh-parallax` | Parallax scroll-effect op images, video's en divs |
| **zh-filter** | `zh-filter` | *(placeholder — nog niet geimplementeerd)* |

---

## Tijden

Overal waar een tijd gevraagd wordt (`zh-animate-delay`, `zh-animate-duration`, `zh-animate-stagger`, `zh-slider-duration`, `zh-slider-autoplay`) mag je milliseconden of seconden schrijven:

| Je schrijft | Betekent |
|-------------|----------|
| `300` of `300ms` | 300 milliseconden |
| `0.3` of `0.3s` | 0,3 seconde = 300 milliseconden |
| `4` | 4 seconden (een kaal getal onder de 10 is altijd seconden) |
| `4000` | 4000 milliseconden = 4 seconden |

Seconden werken dus net als in Webflow.

## zh-slider

Native, touch-enabled slider voor Webflow. Geen Swiper, geen dependencies.

### Basis markup

```html
<div zh-slider="naam"
     zh-slider-loop="true"
     zh-slider-duration="600"
     zh-slider-per-view="3"
     zh-slider-gap="16"
     zh-slider-autoplay="4000">

  <div zh-slider-list>
    <div zh-slider-item>Slide 1</div>
    <div zh-slider-item>Slide 2</div>
    <div zh-slider-item>Slide 3</div>
  </div>

  <!-- Optionele controls -->
  <button zh-slider-element="prev">←</button>
  <button zh-slider-element="next">→</button>
  <div zh-slider-element="pagination"></div>
  <div zh-slider-element="scrollbar">
    <div zh-slider-element="scrollbar-thumb"></div>
  </div>
  <div zh-slider-element="progress">
    <div zh-slider-element="progress-fill"></div>
  </div>

  <!-- Optionele tellers -->
  <div zh-slider-current="naam">01</div>
  <div zh-slider-total="naam">01</div>
</div>
```

### Configuratie-attributen

Alle opties staan als attributen op het root-element (`[zh-slider]`).

| Attribute | Type | Default | Beschrijving |
|-----------|------|---------|-------------|
| `zh-slider` | string | `""` | **Verplicht.** Naam van de slider (gebruikt voor sync, tellers, timeline). Mag leeg zijn. |
| `zh-slider-loop` | boolean | `false` | Eindeloos loopen (clonet slides aan beide kanten) |
| `zh-slider-center` | boolean | `false` | De actieve slide staat in het midden in plaats van links. Zie [Gecentreerd](#gecentreerd) |
| `zh-slider-duration` | tijd | `500` | Animatieduur. Zie [Tijden](#tijden) |
| `zh-slider-per-view` | number/`"auto"` | `1` | Aantal zichtbare slides. `"auto"` = laat CSS de breedte bepalen |
| `zh-slider-gap` | number | `0` | Ruimte tussen slides in px. Als niet gezet, bepaalt je CSS de gap |
| `zh-slider-autoplay` | `true`/`false`/number | uit | `true` = aan met 4000 ms, `false` of `0` = uit, een getal = eigen interval in ms |
| `zh-slider-marquee` | `true`/`false`/number | uit | Doorlopende marquee. `true` = 50 px per seconde, een getal = eigen snelheid in px per seconde. Zie [Marquee](#marquee) |
| `zh-slider-drag` | boolean | `true` | Touch/mouse drag aan/uit |
| `zh-slider-auto-hide` | boolean | `true` | Verbergt de navigatie en zet de slider stil als er niets te sliden valt. Zie [Weinig of geen slides](#weinig-of-geen-slides) |
| `zh-slider-drag-threshold` | number | `5` | Minimale px voordat drag start (voorkomt accidentele drags) |
| `zh-slider-easing` | string | `"cubic-bezier(.22,.61,.36,1)"` | CSS easing voor de slide-animatie: `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out` of een eigen `cubic-bezier(...)`. Kies bij voorkeur een ease-out, dan loopt een swipe vloeiend door na het loslaten |
| `zh-slider-pad-numbers` | boolean | `true` | Tellers met voorloop-nul (`01` ipv `1`) |
| `zh-slider-pause-on-hover` | boolean | `false` (marquee: `true`) | Autoplay of marquee pauzeert bij hover met de muis |
| `zh-slider-sync` | string | `null` | Naam van een andere slider om mee te syncen |
| `zh-slider-skiplink` | boolean | `false` | Voeg een skip-link toe voor toetsenbord-gebruikers (WCAG) |
| `zh-slider-pagination-clickable` | boolean | `true` | Klikbare pagination bullets |
| `zh-slider-breakpoints` | JSON | `null` | Responsive overrides (zie onder) |

### Slepen en swipen

Zo voelt slepen met de muis en swipen op mobiel vloeiend:

- Je kunt overal in de slider slepen, ook op een kaart die een link is. Klikken en hover op de kaart blijven gewoon werken; alleen een klik direct na een sleep wordt tegengehouden.
- Tijdens slepen met de muis wordt geen tekst geselecteerd.
- Met Tab door de kaarten lopen schuift de slider mee. Een muisklik op een kaart doet dat bewust niet, anders schuift de slider weg terwijl je sleept.

- De slide volgt je duim 1-op-1. De 5 px drempel (`zh-slider-drag-threshold`) zorgt alleen dat een tik geen sleep wordt, er is geen sprong.
- In de eerste pixels beslist de slider of je swipet of scrolt. Een swipe mag tot ongeveer 50° schuin gaan, want een duim beweegt in een boog. Is het een swipe, dan zit de pagina vast tot je je duim optilt, hoeveel je duim daarna ook omhoog of omlaag gaat. Duidelijk verticale bewegingen scrollen gewoon de pagina.
- Swipe je opnieuw terwijl de vorige slide nog glijdt, dan pak je hem direct vast waar hij is.
- Bij loslaten glijdt de slide door met de snelheid van je duim. Hou je je duim eerst stil, dan landt hij gewoon op de dichtstbijzijnde slide.
- In een loop raakt de slider nooit op, hoe ver je ook sleept.
- Het in- en uitschuiven van de adresbalk op mobiel onderbreekt een glijdende slide niet meer. Alleen een echte breedteverandering laat de slider opnieuw meten.
- Een slider die onzichtbaar laadt (in een Webflow Tab, dropdown of ingeklapt blok) meet zichzelf opnieuw zodra hij zichtbaar wordt.

### Breakpoints

Overschrijf `slidesPerView` en `spaceBetween` per viewport-breedte:

```html
<div zh-slider="projects"
     zh-slider-per-view="3"
     zh-slider-gap="24"
     zh-slider-breakpoints='{"0": {"slidesPerView": 1, "spaceBetween": 12}, "768": {"slidesPerView": 2, "spaceBetween": 16}, "1200": {"slidesPerView": 3, "spaceBetween": 24}}'>
```

Het systeem is **mobile-first**: de hoogste breakpoint die matcht (viewport >= waarde) wordt gebruikt.

### Elementen (controls)

Plaats deze binnen de slider-root. Ze worden automatisch gekoppeld.

| Attribute | Beschrijving |
|-----------|-------------|
| `zh-slider-element="prev"` | Vorige-slide knop |
| `zh-slider-element="next"` | Volgende-slide knop |
| `zh-slider-element="controls"` | Optionele wrapper rond je navigatie. Wordt in z'n geheel verborgen als er niets te sliden valt |
| `zh-slider-element="pagination"` | Container — wordt automatisch gevuld met `.zh-bullet` knoppen |
| `zh-slider-element="scrollbar"` | Scrollbar track (sleepbaar) |
| `zh-slider-element="scrollbar-thumb"` | Scrollbar thumb (optioneel, wordt auto-aangemaakt) |
| `zh-slider-element="progress"` | Progress bar wrapper |
| `zh-slider-element="progress-fill"` | Progress bar vulling (optioneel, wordt auto-aangemaakt) |
| `zh-slider-element="timeline"` | Per-slide progress bar (voor gallery-style autoplay). Eén per slide. |
| `zh-slider-element="timeline-fill"` | Fill-element binnen timeline item (optioneel, wordt auto-aangemaakt) |

### Tellers

Tonen het huidige slide-nummer en totaal. Kunnen binnen of buiten de slider staan.

```html
<!-- Binnen de slider -->
<div zh-slider-current>01</div>
<div zh-slider-total>01</div>

<!-- Of buiten de slider, gekoppeld via naam -->
<div zh-slider-current="naam">01</div>
<div zh-slider-total="naam">01</div>
```

### Timeline (gallery-style autoplay)

Per-slide voortgangsbalken die vullen gedurende de autoplay-duur. Handig voor hero-sliders.

```html
<div zh-slider="hero" zh-slider-autoplay="5000">
  <div zh-slider-list>
    <div zh-slider-item>Slide 1</div>
    <div zh-slider-item>Slide 2</div>
    <div zh-slider-item>Slide 3</div>
  </div>

  <!-- Eén timeline-item per slide -->
  <div zh-slider-element="timeline">
    <div zh-slider-element="timeline-fill"></div>
  </div>
  <div zh-slider-element="timeline">
    <div zh-slider-element="timeline-fill"></div>
  </div>
  <div zh-slider-element="timeline">
    <div zh-slider-element="timeline-fill"></div>
  </div>
</div>
```

Timeline items buiten de slider (bv. in een sibling component):
```html
<div zh-slider-timeline="hero">
  <div zh-slider-timeline-fill></div>
</div>
```

### Weinig of geen slides

Een CMS-lijst kan leeg zijn, of maar twee of drie items hebben die allemaal al in beeld passen. Dan doet de slider vanzelf het volgende:

| Situatie | Wat er gebeurt |
|----------|----------------|
| Geen items | Root krijgt `is-empty`. Pijltjes, tellers, pagination, progress en scrollbar worden verborgen |
| Alle slides passen in beeld | Root krijgt `is-static`. Navigatie verborgen, geen slepen of autoplay, loop-kopieën verborgen, slides staan links (of gecentreerd met `zh-slider-center`) |
| Slides passen niet (meer) | Alles werkt zoals altijd |

Dit wordt bij elke resize opnieuw gemeten. Passen twee kaarten op desktop wel en op tablet niet, dan schakelt de slider vanzelf mee.

Zo verberg je de navigatie het netst:

- Zet `zh-slider-element="controls"` op de wrapper rond je navigatie (bijvoorbeeld de rij met "01 / 05 ← →"). Dan verdwijnt de hele rij in één keer.
- Zonder die wrapper verbergt het script elk onderdeel apart. Een tekstregel als `<p>01 / 05</p>` waarin alleen de twee nummers staan, wordt als geheel verborgen, dus de "/" verdwijnt ook.
- Wil je dit gedrag niet, zet dan `zh-slider-auto-hide="false"`.
- Een marquee blijft altijd bewegen, ook als alle logo's passen.

#### Slides per view via CSS (aanbevolen voor responsive)

Laat `zh-slider-per-view` weg en geef de slides in Webflow per breakpoint een breedte, bijvoorbeeld 33% op desktop, 50% op tablet en 85% op mobiel. Het script meet de echte breedtes bij het laden en bij elke resize. Daarom kloppen pijltjes, slepen, tellers, progress en het verbergen van de navigatie op elk breakpoint. `zh-slider-per-view="auto"` doet hetzelfde als het attribuut weglaten.

### Gecentreerd

Met `zh-slider-center="true"` staat de actieve slide in het midden van de slider, dus bij het laden ook de eerste.

```html
<div zh-slider="cases" zh-slider-center="true" zh-slider-per-view="3" zh-slider-gap="16">
```

| Combinatie | Gedrag |
|------------|--------|
| Zonder loop | De eerste slide begint in het midden met lege ruimte links. Bij de laatste slide is er lege ruimte rechts. Slepen voorbij de eerste of laatste slide veert terug |
| Met loop | Er is nooit lege ruimte. Links en rechts van de actieve slide zie je de buren |
| Met marquee | Pijltjes zetten een kaart in het midden, en de teller toont de kaart die het dichtst bij het midden staat |

Tips:

- Gebruik een oneven of halve per-view (`3`, `2.5`, `1.5`) voor een mooi symmetrisch beeld.
- De actieve slide krijgt `is-active`. Daarmee kun je in Webflow de middelste kaart groter of donkerder maken.
- De progress bar loopt van 0% bij de eerste naar 100% bij de laatste slide.

### Marquee

Een slider die continu en lineair doorloopt, bijvoorbeeld voor een logo-wall. Pijltjes, slepen en hover blijven gewoon werken.

```html
<div zh-slider="logos" zh-slider-marquee="40" zh-slider-duration="600">
  <div class="list-wrapper">
    <div zh-slider-list>
      <a zh-slider-item href="/klant-a">Logo A</a>
      <a zh-slider-item href="/klant-b">Logo B</a>
      <a zh-slider-item href="/klant-c">Logo C</a>
    </div>
  </div>
  <button zh-slider-element="prev">←</button>
  <button zh-slider-element="next">→</button>
</div>
```

Hoe het zich gedraagt:

| Actie | Gedrag |
|-------|--------|
| Niets doen | Loopt continu met de ingestelde snelheid (px per seconde) |
| Hover met de muis | Remt vloeiend af tot stilstand, zodat je op een kaart kunt klikken. Na het verlaten trekt hij weer rustig op |
| Pijltje | Glijdt vanaf de huidige positie naar de rand van de volgende of vorige kaart, in `zh-slider-duration` ms. Snel meerdere keren klikken telt op |
| Slepen | Volgt je vinger of muis zonder te snappen. Bij loslaten glijdt hij met jouw vaart uit en gaat daarna terug naar het normale tempo |
| Tikken op touch | Houdt de marquee vast zolang je vinger erop staat, zodat de tik op de juiste kaart landt |
| Toetsenbord | Pijltjestoetsen stappen per kaart. Met toetsenbord-focus in de slider staat hij stil (WCAG 2.2.2) |
| Tellers | `zh-slider-current` toont de kaart die links in beeld staat en loopt mee met scrollen, pijltjes en slepen. `zh-slider-total` werkt zoals altijd |

Goed om te weten:

- `zh-slider-marquee` zet automatisch `loop` aan en `autoplay` uit. Die hoef je dus niet mee te geven.
- Kaarten mogen verschillende breedtes hebben. Laat `zh-slider-per-view` weg en bepaal de breedte in Webflow.
- `zh-slider-duration` en `zh-slider-easing` gelden hier alleen voor de pijltjes. Gebruik dus geen `duration="4000"` met `easing="linear"` meer, dat was de oude workaround.
- Wil je geen pauze bij hover, zet dan `zh-slider-pause-on-hover="false"`.
- Bij `prefers-reduced-motion` beweegt hij niet uit zichzelf. Pijltjes en slepen werken dan nog wel.
- Progress bar en scrollbar doen niets in marquee-modus, want een marquee heeft geen begin of eind. Verberg ze in Webflow als ze in je component zitten.

### Slider sync

Twee sliders koppelen (bv. een hoofdslider + thumbnail-nav):

```html
<div zh-slider="gallery">...</div>
<div zh-slider="thumbs" zh-slider-sync="gallery">...</div>
```

Sync is bidirectioneel — als `gallery` verandert, volgt `thumbs` en vice versa.

### CSS classes (automatisch gezet)

| Class | Op welk element | Wanneer |
|-------|----------------|--------|
| `is-active` | Huidige slide, bullet, timeline item | Slide is actief |
| `is-past` | Timeline items | Voorbije slides |
| `is-disabled` | Prev/next knoppen | Aan de rand (niet bij loop) |
| `is-dragging` | Slider root | Tijdens touch/mouse drag |
| `is-static` | Slider root | Alle slides passen in beeld, navigatie verborgen |
| `is-empty` | Slider root | Geen slides (lege CMS-lijst) |
| `is-animated` | *(niet door slider)* | — |

### JS API

```js
// Initialiseer alle sliders opnieuw
Zweihander.slider.init();

// Haal een slider instance op naam
var hero = Zweihander.slider.get("hero");
hero.goTo(2, true);     // Ga naar slide 3 (0-indexed), met animatie
hero.next();
hero.prev();
hero.destroy();

// Initialiseer één element
Zweihander.slider.initOne(document.querySelector('[zh-slider="new"]'));
```

### Styling tips

Het script forceert **zo min mogelijk** inline styles. Style alles in Webflow:

- **Overflow en cursor** stel je zelf in via Webflow
- **touch-action**: laat dit in Webflow op auto staan. Het script zet dan zelf `pan-y pinch-zoom` op de list-wrapper, zodat verticaal scrollen en inzoomen bij de browser blijven en horizontaal swipen bij de slider. Zet je zelf iets, dan blijft jouw waarde staan
- **Gap** — alleen als je `zh-slider-gap` gebruikt, anders pakt het script je CSS gap
- **Slide breedte** — alleen als je `zh-slider-per-view` gebruikt, anders bepaalt je CSS de breedte
- **Scrollbar/progress** — style de wrapper + thumb volledig zelf, het script zet alleen `width` en `transform`

---

## zh-animate

Scroll-triggered animaties via IntersectionObserver + CSS transitions. Geen GSAP, geen AOS.

### Basis markup

```html
<div zh-animate="up">Ik schuif omhoog in beeld</div>
```

### Configuratie-attributen

| Attribute | Type | Default | Beschrijving |
|-----------|------|---------|-------------|
| `zh-animate` | string | `"up"` | **Verplicht.** Animatierichting: `up`, `down`, `left`, `right`, `fade`, `scale`, `none` |
| `zh-animate-delay` | tijd | `0` | Vertraging voor de animatie start, bijv. `300` of `0.3`. Zie [Tijden](#tijden) |
| `zh-animate-duration` | tijd | `600` | Animatieduur. Zie [Tijden](#tijden) |
| `zh-animate-distance` | number | `30` | Afstand in px voor translate-animaties |
| `zh-animate-easing` | string | `"cubic-bezier(0.68, -0.6, 0.32, 1.6)"` | CSS easing (default heeft een lichte bounce) |
| `zh-animate-threshold` | number | `0.15` | Hoeveel van het element zichtbaar moet zijn (0-1) voordat het animeert |
| `zh-animate-once` | boolean | `true` | `true` = animeer eenmalig, `false` = opnieuw bij elke scroll in/uit |
| `zh-animate-mobile` | boolean | `true` | `false` = geen animatie onder 768px |

### Richtingen

| Waarde | Effect |
|--------|--------|
| `up` | Schuift van onder naar boven |
| `down` | Schuift van boven naar onder |
| `left` | Schuift van rechts naar links |
| `right` | Schuift van links naar rechts |
| `fade` | Alleen fade-in (geen beweging) |
| `scale` | Schaalt van 92% naar 100% + fade |
| `none` | Geen visueel effect (handig voor stagger-timing zonder animatie) |

### Stagger

Kinderen animeren in volgorde met een vertraging ertussen. Zet `zh-animate-stagger` op de **parent-wrapper**.

```html
<div zh-animate-stagger="100">
  <div zh-animate="up">Card 1 — 0ms delay</div>
  <div zh-animate="up">Card 2 — 100ms delay</div>
  <div zh-animate="up">Card 3 — 200ms delay</div>
  <div zh-animate="up">Card 4 — 300ms delay</div>
</div>
```

Combineer met een basis-delay per child:
```html
<div zh-animate-stagger="120">
  <div zh-animate="left" zh-animate-delay="200">0 + 200 = 200ms</div>
  <div zh-animate="left" zh-animate-delay="200">120 + 200 = 320ms</div>
  <div zh-animate="left" zh-animate-delay="200">240 + 200 = 440ms</div>
</div>
```

**Let op:** stagger werkt alleen op **directe kinderen** van de stagger-container die `zh-animate` hebben.

### CSS class

| Class | Wanneer |
|-------|--------|
| `is-animated` | Nadat de animatie klaar is |

Gebruik `is-animated` in Webflow om post-animatie styling toe te passen.

### Globale defaults overschrijven

```html
<script>
  window.Zweihander = window.Zweihander || {};
  window.Zweihander.animateDefaults = {
    duration: 800,
    distance: 50,
    easing: "ease-out"
  };
</script>
```

Zet dit **voor** het Zweihander script. Individuele attributen overschrijven altijd de defaults.

### JS API

```js
Zweihander.animate.init();       // Scan DOM voor nieuwe elementen
Zweihander.animate.refresh();    // Idem — handig na CMS-content load
Zweihander.animate.destroy();    // Stop alles, verwijder inline styles
Zweihander.animate.defaults({ duration: 800 }); // Overschrijf defaults
```

### Accessibility

- **prefers-reduced-motion:** alle elementen worden direct zichtbaar zonder animatie (WCAG 2.3.3)
- Geen content verdwijnt permanent — als JS faalt zijn elementen gewoon zichtbaar

---

## zh-parallax

Scroll-parallax effect op afbeeldingen, video's en divs. Gebaseerd op Ukiyo.js math.

### Basis markup

```html
<!-- Direct op een image -->
<img zh-parallax src="hero.jpg" alt="Hero image" />

<!-- Of op een wrapper met een image erin -->
<div zh-parallax>
  <img src="hero.jpg" alt="Hero image" />
</div>
```

### Configuratie-attributen

| Attribute | Type | Default | Beschrijving |
|-----------|------|---------|-------------|
| `zh-parallax` | — | — | **Verplicht.** Markeert het element voor parallax |
| `zh-parallax-speed` | number | `1.5` | Parallax-intensiteit. Hoger = meer effect |
| `zh-parallax-scale` | number | `1.15` | Hoeveel de afbeelding wordt vergroot (om gaten te voorkomen bij het scrollen) |

### Hoe het werkt

1. Het element wordt automatisch in een **wrapper-div** geplaatst
2. De wrapper behoudt de originele afmetingen (met `overflow: hidden`)
3. Het element wordt groter gemaakt (`scale`) en beweegt via `translate3d` bij scrollen
4. IntersectionObserver schakelt de animatie alleen in als het element zichtbaar is

### Styling tips

- Het script verplaatst `margin`, `border-radius`, `position`, `z-index`, `grid-area` en `transform` naar de wrapper
- De wrapper krijgt `overflow: hidden` — als je afgeronde hoeken hebt werkt dat automatisch
- `object-fit: cover` wordt automatisch gezet op `<img>` en `<video>` elementen

### Globale defaults

```html
<script>
  window.Zweihander = window.Zweihander || {};
  window.Zweihander.parallaxDefaults = {
    speed: 1.8,
    scale: 1.2
  };
</script>
```

### JS API

```js
Zweihander.parallax.init();      // Scan DOM voor nieuwe elementen
Zweihander.parallax.destroy();   // Stop alles, unwrap elementen
Zweihander.parallax.defaults({ speed: 2.0 }); // Overschrijf defaults
```

### Accessibility

- **prefers-reduced-motion:** module wordt niet geinitialiseerd (WCAG 2.3.3)
- Afbeeldingen zijn gewoon zichtbaar zonder parallax effect

---

## Loader — zweihander.js

De loader detecteert welke modules nodig zijn en importeert ze dynamisch.

### Hoe modules geladen worden

1. De loader leest attributen van de `<script>` tag
2. Modules worden geladen vanuit `modules/zh-{naam}.min.js` (jsDelivr) of `modules/zh-{naam}.js` (lokaal)
3. Elke module heeft een `init()` functie die via `Webflow.push()` wordt aangeroepen (of `DOMContentLoaded` als Webflow niet beschikbaar is)

### Load states

```js
window.Zweihander._loaded
// { slider: "ready", animate: "loading", parallax: "error" }
```

| State | Betekenis |
|-------|----------|
| `"loading"` | Module wordt geladen |
| `"ready"` | Module is geladen en geinitialiseerd |
| `"error"` | Laden mislukt (check console) |

---

## Versioning

De repo gebruikt semver tags. Pin altijd op een specifieke versie in productie:

```
@v1.6.4   ← specifieke versie (aanbevolen)
@main     ← altijd de laatste versie (niet voor productie)
```

### Changelog

| Versie | Wijziging |
|--------|----------|
| v1.6.4 | Tijden mogen in seconden (`0.3`, `0.3s`) of milliseconden (`300`, `300ms`). `zh-animate-delay="0.3"` werd eerder als 0,3 ms gelezen. Loader verdraagt een dubbele slash in de script-src |
| v1.6.3 | Muis-slepen op kaarten die links zijn: geen haperen of doorschieten meer (focus door de klik schoof de slider weg). Geen tekstselectie tijdens slepen |
| v1.6.2 | Swipe-lock op touch: een (schuine) swipe zet de pagina vast tot je loslaat. Adresbalk-resize onderbreekt geen glide meer. Sliders die onzichtbaar laden meten opnieuw zodra ze zichtbaar worden |
| v1.6.1 | Vloeiender swipen: `touch-action` wordt automatisch gezet, een glijdende slide kun je direct vastpakken, geen sprong bij de drempel, snelheid gemeten over de laatste 100 ms, en `zh-slider-easing` met `cubic-bezier()` wordt nu echt gebruikt (viel eerder terug op ease-in-out) |
| v1.6.0 | Navigatie verbergt zich bij een lege slider of als alles past (`is-empty`, `is-static`, `zh-slider-auto-hide`, `zh-slider-element="controls"`). `zh-auto` wacht nu tot de pagina geladen is, zodat sliders verderop niet worden overgeslagen als het script in de head staat |
| v1.5.0 | `zh-slider-center`: actieve slide in het midden, voor gewone sliders en de marquee |
| v1.4.1 | Tellers werken in marquee-modus. Progress bar en scrollbar staan daar bewust uit |
| v1.4.0 | Marquee-modus (`zh-slider-marquee`). `zh-slider-autoplay` accepteert nu `true`/`false`. Kaarten die links zijn blokkeren het slepen niet meer |
| v1.3.4 | Fix progress bar: 100% wanneer laatste slide zichtbaar is (multi-per-view) |
| v1.3.3 | Fix progress bar scaling: counter-based index |
| v1.3.2 | Laad geminificeerde modules via jsDelivr CDN |
| v1.3.1 | Fix carousel a11y: strip inherited role=list |
| v1.3.0 | `zh-slider-drag` attribuut om drag/swipe uit te schakelen |
| v1.2.0 | Default pause-on-hover naar off (opt-in) |
| v1.1.2 | Fade past timeline fills terug naar 0% |
| v1.1.1 | Timeline mag buiten de slider root staan |
| v1.1.0 | `zh-slider-sync` voor gekoppelde sliders |
| v1.0.3 | Skip link is opt-in via `zh-slider-skiplink` |
| v1.0.2 | Fix skip link crash bij diep geneste slider list |
| v1.0.1 | Debug logging voor timeline en autoplay |
| v1.0.0 | Gallery timeline: per-slide progress bars |
