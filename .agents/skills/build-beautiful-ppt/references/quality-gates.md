# Presentation quality gates

Apply the gates in order. A later pass does not compensate for an earlier failure.

## 1. Request coverage

- Map every explicit requirement to a slide or deliverable.
- Confirm language, audience, page count, duration, aspect ratio, file type, and template constraints.
- Remove internal production language from visible slides.

## 2. Narrative and evidence

- Confirm every slide has one job and one primary claim.
- Read the slide titles in sequence; they must communicate a coherent story.
- Check every factual claim, date, number, quotation, chart, and image against source notes.
- Distinguish fact, source viewpoint, inference, estimate, and recommendation.
- Reject invented citations, placeholder statistics, and decorative data.

## 3. Structural PPTX validation

Run:

```bash
python3 scripts/validate_pptx.py /absolute/path/deck.pptx --json /absolute/path/qa/validation.json
```

Require a valid ZIP/CRC package, the expected slide count, resolvable slide relationships, and no unexpected external media relationships. When source notes are required, confirm their presence manually or with a backend-specific validator.

## 4. Render validation

Render every slide after the latest build. Inspect the contact sheet only for sequence, rhythm, palette, and repeated-layout problems. Inspect every slide separately at full size for:

- clipping and canvas overflow;
- unintended overlaps;
- unexpected title wrapping;
- font substitution and changed line breaks;
- distorted, blurry, or poorly cropped images;
- weak contrast;
- inconsistent margins, baselines, footers, and page numbers;
- broken connectors or labels detached from evidence;
- chart/title/data mismatches;
- unreadable citations and footnotes;
- unresolved placeholders.

On macOS, a bundled/headless LibreOffice process may start without a usable Fontconfig configuration. If Chinese, Japanese, or Korean text renders as empty squares while the source text is intact, render with a valid `FONTCONFIG_FILE` (commonly `/opt/homebrew/etc/fonts/fonts.conf`) or use `scripts/render_slides.py`, which detects common configurations automatically. Treat a missing-glyph render as a failed quality gate, not as a harmless preview difference.

Rebuild and re-render every corrected page. Do not rely on an earlier render after changing the source.

## 5. Presentation suitability

- Confirm title and body sizes remain readable at projection distance.
- Reduce text for live delivery; preserve necessary evidence for reading-oriented or submission decks.
- Use animation only when it clarifies sequence, causality, or pacing.
- Open the final PPTX in the target application when compatibility risk is material.

## Completion record

Record the final PPTX path, byte size, SHA-256, slide count, renderer, validation result, inspection date, known limitations, and user actions still required.
