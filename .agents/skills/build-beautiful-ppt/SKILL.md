---
name: build-beautiful-ppt
description: Create, rebuild, review, and validate polished editable PowerPoint presentations with evidence-led narrative, purposeful visuals, speaker-note sources, and rendered-slide quality checks. Use for PPT, PPTX, slide deck, presentation, pitch deck, courseware, research talk, report deck, poster, infographic, template-based deck, or presentation redesign tasks. Prefer a host-native presentation backend when available and otherwise use the bundled local PptxGenJS fallback; never depend on Kimi or another third-party presentation webpage for editing, rendering, or export.
---

# Build Beautiful PPT

Create editable presentations through one local, reproducible source and a render-inspect-repair loop. Treat beauty as communication quality: a coherent argument, intentional composition, relevant evidence, readable typography, and precise finishing.

## Non-negotiables

- Keep the presentation build, rendering, and export independent of Kimi and other third-party presentation webpages. Do not run browser editors, public-editor iframes, remote PPT writers, or webpage download automation.
- Prefer editable text, shapes, charts, tables, connectors, and images over full-slide bitmaps.
- Keep one canonical source for the delivered PPTX. Do not generate a parallel PPTD or another layout source unless the user explicitly requests that format.
- Preserve user-provided originals. Edit in place only when explicitly requested and the selected backend can preserve the original structure; otherwise create a copy.
- Record every external non-trivial claim and visual asset in source notes and in a `[Sources] ... [/Sources]` speaker-notes block on the relevant slide when the backend supports notes.
- Render and inspect every final slide before declaring the deck complete. Structural validation alone is not visual QA.
- Never invent facts, quotations, statistics, citations, people, case results, or image provenance.

## 1. Define the communication job

Inspect every supplied file, URL, template, and prior deck. Determine the audience, purpose, desired outcome, central takeaway, required topics, language, length, format, and source constraints.

Write one internal sentence:

> By the end, **[audience]** should **[understand / believe / choose / do]** because **[central takeaway]**.

Choose a cumulative narrative rather than an agenda-shaped inventory. Give each slide one job and one primary claim. Use takeaway titles that form a coherent story when read alone.

Completion criterion: every user requirement maps to at least one planned slide, and every planned slide advances the communication job.

## 2. Select the visual route

Apply the first matching route:

1. Use a user-provided PPTX, template, or reference deck as the visual contract. Preserve its master, layouts, spacing, typography, and recurring components when the backend can import them.
2. Use a user-named design system exactly; do not mix unrelated systems.
3. Translate an explicit brand, mood, or visual direction into a compact custom design specification.
4. With no visual direction, use the relevant scenario baseline rather than choosing a decorative preset arbitrarily.

Read [references/slides-categories.md](references/slides-categories.md), then read exactly one matching file under `references/slides-categories/`. If the user names a preset, or a preset materially clarifies an explicit direction, read [references/design-systems.md](references/design-systems.md) and exactly one matching `design.md`. For a poster, infographic, or highly visual one-page deliverable, also read [references/general-poster.md](references/general-poster.md). For typography or cross-platform delivery, read [references/fonts.md](references/fonts.md).

Define palette, type hierarchy, margins, image treatment, chart language, recurring elements, and prohibited treatments before implementation. Vary adjacent slide silhouettes while preserving the system.

Completion criterion: the chosen route is explicit, the required reference is loaded, and the visual system is specific enough to build without improvising a second style.

## 3. Plan content and evidence

Create a slide sequence before drawing. For each slide specify:

- claim or narrative job;
- essential evidence;
- best visual form;
- source requirements;
- speaker-note purpose when needed.

Prefer concrete evidence and relevant real imagery. Use charts only for real comparisons or trends. Use simple native diagrams only when relationships are clearer visually than in prose. Do not add decorative metrics, fake dashboards, icon walls, or repeated card grids.

Create `source-notes.txt` with the title, publisher, date, URL or local path, access date, claim or asset supported, and any limitation. Distinguish official statements, independently verified facts, estimates, allegations, and inference.

Completion criterion: every non-trivial factual slide has adequate evidence, every planned visual has a sourcing or generation route, and unsupported claims have been removed or qualified.

## 4. Choose the implementation backend

Read [references/backends.md](references/backends.md) before implementation.

- Prefer a host-native presentation backend that creates editable PPTX and supports rendering or inspection. Follow that backend's own instructions in addition to this skill.
- Use the bundled PptxGenJS starter for a new deck when no capable native backend exists.
- Do not claim lossless editing of an arbitrary existing PPTX through PptxGenJS; use an import-capable native backend or rebuild a clearly labeled copy.
- Keep compilation local even when research or image sourcing uses the web.

Run `scripts/check_environment.py` when using the portable fallback or local QA tools. Stop at a concrete missing prerequisite rather than silently skipping the required output or validation.

Completion criterion: the chosen backend can satisfy the requested operation, and any fidelity or feature limitation is recorded before building.

## 5. Build the editable deck

Use this project contract unless the user specifies another destination:

```text
deck-project/
  source/
    build.mjs
    content.json
    source-notes.txt
    assets/
  output/
    deck.pptx
    deck.pdf              # optional
  qa/
    validation.json
    rendered/
    contact-sheet.png
```

Keep `content.json`, `build.mjs`, and local assets synchronized as the canonical source. Use native charts for data that may need editing. Keep labels attached to the evidence they explain. Shorten copy or change layout before shrinking text. Use notes for presenter context and sources; keep production commentary off visible slides.

Add a `[Sources]` block to every slide with an external claim or asset. Use `None (original synthesis; no external claim or asset)` for genuinely source-free slides when a uniform notes contract is required.

Completion criterion: the PPTX opens, contains the intended slide count, retains editability appropriate to the backend, and has no unresolved placeholders or missing assets.

## 6. Validate, render, inspect, and repair

Read [references/quality-gates.md](references/quality-gates.md). Run `scripts/validate_pptx.py` on every final candidate. Add slide-level fade transitions only when appropriate, using `scripts/patch_fade_transitions.py`, then validate again.

Render every slide with the host renderer or `scripts/render_slides.py`. Build a contact sheet with `scripts/make_montage.py`. Inspect the deck-level flow from the contact sheet and every slide individually at full size. Repair overflow, clipping, unintended overlap, broken crops, poor contrast, inconsistent alignment, unreadable sources, data mismatches, and weak narrative transitions. Re-render every changed slide and repeat until all gates pass.

If no rendering route is available, report that visual QA is incomplete. Do not describe the deck as final-quality based only on ZIP or XML validation.

Completion criterion: structural validation passes, every slide has been inspected at full size after the latest change, and no known blocking visual or content defect remains.

## 7. Deliver

Return the final editable PPTX and, when useful, a PDF. Include the canonical source and concise QA result when the user requested reproducibility. State the selected backend, source coverage, known limitations, and any fields the user must complete. Do not deliver scratch plans or duplicate competing PPTX files.

For a newly created deck, deliver exactly one primary PPTX candidate unless the user explicitly requests variants.
