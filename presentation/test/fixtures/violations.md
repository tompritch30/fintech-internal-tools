---
marp: true
theme: cognition
paginate: true
header: Selftest
---

<!-- expect: pass -->

# A clean slide passes every check

- Short bullet one
- Short bullet two

<div class="visual placeholder">Diagram</div>

<!-- Notes: control slide. -->

---

<!-- expect: title-wraps -->
<!-- also: unused-space -->

# This title is far too long to fit on one line of the slide, so it wraps onto a second line below

- Bullet

<!-- Notes. -->

---

<!-- expect: overflow -->
<!-- also: elements-touch -->

# Overflowing content is caught

<div class="visual placeholder" style="height:1400px">Too tall</div>

<!-- Notes. -->

---

<!-- expect: overflow -->
<!-- _footer: "Source: an extremely long source line that keeps going and going past the footer width so it gets clipped by the ellipsis rule in the theme, and then keeps going for a while longer still" -->

# A clipped source line is caught

<div class="visual placeholder">Diagram</div>

<!-- Notes. -->

---

<!-- expect: too-many-bullets -->
<!-- also: unused-space -->

# Four bullets are one too many

- One
- Two
- Three
- Four

<!-- Notes. -->

---

<!-- expect: bullet-too-long -->
<!-- also: unused-space -->

# Long bullets are caught

- This bullet has far more than twelve words in it so it fails the check

<!-- Notes. -->

---

<!-- expect: banned-word -->
<!-- also: unused-space -->

# Banned words are caught

- We leverage the platform

<!-- Notes. -->

---

<!-- expect: banned-word -->
<!-- also: unused-space -->

# Banned words in speaker notes are caught

- Plain bullet

<!-- This is a game-changing idea. -->

---

<!-- expect: too-many-visuals -->
<!-- also: elements-touch too-many-accents -->

# Two visuals are one too many

<div class="visual placeholder">One</div>
<div class="visual placeholder">Two</div>

<!-- Notes. -->

---

<!-- expect: number-without-source -->
<!-- also: unused-space -->

# A number needs a source line

- Costs fell by 40%

<!-- Notes. -->

---

<!-- expect: pass -->
<!-- _footer: "Source: Selftest fixture" -->

# A number with a source line passes

- Costs fell by 40%

<div class="visual placeholder">Chart</div>

<!-- Notes. -->

---

<!-- expect: paragraph -->

# Paragraphs are caught

This is a paragraph of prose that goes on well past twenty words, which is the limit for any text block on a slide.

<!-- Notes. -->

---

<!-- expect: missing-title -->
<!-- also: unused-space -->

- A slide with no title

<!-- Notes. -->

---

<!-- expect: text-too-small -->
<!-- also: unused-space -->

# Small text is caught

- <span style="font-size:18px">Tiny</span>

<!-- Notes. -->

---

<!-- expect: missing-image -->

# A missing image is caught

![Screenshot that does not exist](assets/does-not-exist.png)

<!-- Notes. -->

---

<!-- expect: too-many-visuals -->
<!-- also: elements-touch -->
<!-- _footer: "Source: selftest fixture" -->

# Two images in one paragraph are two visuals

<div class="visual placeholder">x</div>

| A | B |
|---|---|
| x | y |

<!-- Notes. -->

---

<!-- expect: chart-text-too-small -->
<!-- _footer: "Source: fixture" -->

# A chart squeezed so small its labels can't be read

![w:500](assets/charts/three-year-cost.svg)

<!-- Notes. -->

---

<!-- expect: unused-space -->

# Content that stops halfway down is caught

- One short bullet

<!-- Notes. -->

---

<!-- expect: off-left-edge -->

# A block off the shared left edge is caught

<div class="visual placeholder" style="margin-left:40px">Diagram</div>

<!-- Notes. -->

---

<!-- expect: uneven-gaps -->

###### Section label

# Label-to-title and title-to-content gaps must match

<div class="visual placeholder" style="margin-top:40px">Diagram</div>

<!-- Notes. -->

---

<!-- expect: too-many-accents -->

# Blue is one accent per slide

- A bullet in *blue*

<div class="visual placeholder">Diagram</div>

<!-- Notes. -->

---

<!-- expect: too-many-text-styles -->

# Three text styles are one too many

- A bullet with `code` in it

<div class="visual placeholder">Diagram</div>

<!-- Notes. -->

---

<!-- expect: low-contrast -->

# Pale text is caught

- <span style="color:#dddddd">Hard to read</span>

<div class="visual placeholder">Diagram</div>

<!-- Notes. -->

---

<!-- expect: elements-touch -->

# A visual pushed up into the title is caught

<div class="visual placeholder" style="margin-top:-60px">Diagram</div>

<!-- Notes. -->

---

<!-- expect: orphan-word -->
<!-- _footer: "Source: fixture" -->

# A bullet that leaves one word alone on its last line

- 34 refund rule tests, 30 shown failing first

<div class="visual placeholder">Diagram</div>

<!-- Notes. -->

---

<!-- _class: title -->
<!-- expect: cover-caveat -->

# Cover title

Draft, dummy data only

<!-- Notes. -->

---

<!-- _class: title -->
<!-- expect: subtitle-wraps -->

# Cover title

A subtitle that goes on far too long to fit on one line beside the art

<!-- Notes. -->

---

<!-- expect: image-aspect -->
<!-- also: unused-space -->

# A drawing squashed out of shape is caught

<img src="assets/cognition-mark.svg" alt="Squashed" style="width:300px;height:100px">

<!-- Notes. -->

---

<!-- expect: image-aspect -->
<!-- also: unused-space -->

# A framed drawing letterboxed in a Markdown image is caught

![w:600 h:200](assets/title-art-dark.svg)

<!-- Notes. -->

---

<!-- expect: em-dash -->
<!-- also: unused-space -->

# An em dash in the slide text fails

- Refunds — the first app

<!-- Notes. -->

---

<!-- expect: em-dash -->
<!-- also: unused-space -->

# An en dash only in the notes still fails

- Refunds first

<!-- Weeks 1–4. -->

---

<!-- expect: em-dash -->
<!-- also: image-aspect unused-space -->

# A dash drawn inside an SVG image fails

![w:400](test/fixtures/dash.svg)

<!-- Notes. -->

---

<!-- expect: pass -->
<!-- _class: allow-bullet-too-long allow-unused-space -->

# A slide can accept a named failure

- This bullet is deliberately longer than twelve words so the check would fail it

<!-- Notes. -->

---

<!-- expect: spills-out -->
<!-- also: unused-space -->
<!-- _footer: "Source: fixture" -->

# A visual squeezed by its row while its content spills out

- Short bullet

<div class="visual" style="height: 120px"><div style="height: 400px; background: #ddd">tall content</div></div>

<!-- Notes. -->
