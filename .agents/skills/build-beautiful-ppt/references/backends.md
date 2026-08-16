# Backend selection

Select one implementation backend per deck. Keep content, visual decisions, and QA requirements backend-neutral.

## Capability test

Confirm whether the backend can:

1. create an editable PPTX;
2. import and preserve an existing PPTX when editing is requested;
3. create native charts, tables, notes, and images needed by the deck;
4. render or expose slides for full-size inspection;
5. export locally without a third-party presentation webpage.

Choose the first backend that satisfies the requested operation.

## Host-native backend

Prefer a host-native presentation tool or skill when it can satisfy the operation. Follow its mandatory implementation and citation rules. Use this skill for communication planning, visual-system selection, source discipline, and quality gates.

For Codex, use the installed Presentations Skill and its current `@oai/artifact-tool` workflow. Do not substitute PptxGenJS when the host instruction requires Artifact Tool.

## Portable PptxGenJS backend

Use PptxGenJS for new decks or explicit rebuilds when no suitable native backend exists.

Prerequisites:

- Node.js 18 or newer;
- npm or a compatible package manager;
- `pptxgenjs` and `jszip` installed in the project workspace;
- a local rendering route for visual QA.

Copy `assets/pptxgenjs-starter/` into the deck project's `source/` directory, install its pinned dependencies locally, and replace the sample content. Keep the generated PPTX editable by using native PptxGenJS text, shape, image, table, and chart objects.

PptxGenJS can define new slide masters, add speaker notes, create native charts, and write PPTX files. It does not import and losslessly edit arbitrary existing PPTX files, reproduce all PowerPoint animations, or create SmartArt. When those capabilities are required, use a host-native backend or disclose a rebuild.

## Existing PPTX without an import-capable backend

Preserve the original file. Inspect and render every source slide, then choose one:

- rebuild a new editable deck that follows the source visually;
- perform a narrowly scoped OOXML patch when the requested change is safe and deterministic;
- stop and report that faithful editing requires an import-capable backend.

Never describe a visual rebuild as lossless editing.

## Network boundary

Allow web access for research, source verification, and licensed or official visual acquisition when the task permits it. Keep the deck editor, renderer, and PPTX writer local. Do not load the deck into Kimi, Canva, Gamma, Beautiful.ai, or another presentation webpage unless the user explicitly changes this skill's local-only constraint.
