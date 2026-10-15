---
marp: true
theme: consultancy
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

# This title is far too long to fit on one line of the slide, so it wraps onto a second line below

- Bullet

<!-- Notes. -->

---

<!-- expect: overflow -->

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

# Four bullets are one too many

- One
- Two
- Three
- Four

<!-- Notes. -->

---

<!-- expect: bullet-too-long -->

# Long bullets are caught

- This bullet has far more than twelve words in it so it fails the check

<!-- Notes. -->

---

<!-- expect: banned-word -->

# Banned words are caught

- We leverage the platform

<!-- Notes. -->

---

<!-- expect: banned-word -->

# Banned words in speaker notes are caught

- Plain bullet

<!-- This is a game-changing idea. -->

---

<!-- expect: too-many-visuals -->

# Two visuals are one too many

<div class="visual placeholder">One</div>
<div class="visual placeholder">Two</div>

<!-- Notes. -->

---

<!-- expect: number-without-source -->

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

- A slide with no title

<!-- Notes. -->

---

<!-- expect: text-too-small -->

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

![w:500](assets/charts/cost.svg)

<!-- Notes. -->
