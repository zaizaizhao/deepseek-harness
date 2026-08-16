import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.resolve(process.argv[2] || path.join(HERE, "..", "output", "deck.pptx"));

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "Generated with build-beautiful-ppt";
pptx.subject = "Replace this starter content before delivery";
pptx.title = "Editable presentation starter";
pptx.company = "Local PptxGenJS backend";
pptx.lang = "en-US";
pptx.theme = {
  headFontFace: "Arial",
  bodyFontFace: "Arial",
  lang: "en-US",
};

const C = {
  ink: "111827",
  muted: "64748B",
  paper: "F8FAFC",
  accent: "D72638",
  line: "CBD5E1",
};

function addSources(slide, lines = []) {
  const body = lines.length ? lines.join("\n") : "None (original synthesis; no external claim or asset)";
  slide.addNotes(`[Sources]\n${body}\n[/Sources]`);
}

function addFooter(slide, number) {
  slide.addShape(pptx.ShapeType.line, { x: 0.55, y: 7.08, w: 12.2, h: 0, line: { color: C.line, width: 1 } });
  slide.addText(String(number).padStart(2, "0"), {
    x: 12.05, y: 7.12, w: 0.7, h: 0.2, fontFace: "Arial", fontSize: 9, color: C.muted, align: "right", margin: 0,
  });
}

const cover = pptx.addSlide();
cover.background = { color: C.ink };
cover.addShape(pptx.ShapeType.rect, { x: 0.6, y: 0.7, w: 0.12, h: 5.7, line: { color: C.accent, transparency: 100 }, fill: { color: C.accent } });
cover.addText("Replace with a takeaway title", {
  x: 1.05, y: 1.55, w: 10.8, h: 1.3, fontFace: "Arial", fontSize: 31, bold: true, color: "FFFFFF", margin: 0, breakLine: false,
});
cover.addText("A concise subtitle that defines the audience and purpose", {
  x: 1.08, y: 3.05, w: 8.8, h: 0.65, fontFace: "Arial", fontSize: 18, color: "CBD5E1", margin: 0,
});
cover.addText("LOCAL · EDITABLE · VERIFIED", {
  x: 1.08, y: 5.95, w: 4.5, h: 0.3, fontFace: "Arial", fontSize: 10, bold: true, color: C.accent, charSpacing: 1.4, margin: 0,
});
addSources(cover);

const body = pptx.addSlide();
body.background = { color: C.paper };
body.addText("One claim per slide", {
  x: 0.65, y: 0.55, w: 11.7, h: 0.55, fontFace: "Arial", fontSize: 26, bold: true, color: C.ink, margin: 0,
});
body.addText("Use the main canvas for evidence, not a grid of decorative cards.", {
  x: 0.68, y: 1.25, w: 8.7, h: 0.5, fontFace: "Arial", fontSize: 17, color: C.muted, margin: 0,
});
body.addShape(pptx.ShapeType.line, { x: 0.68, y: 2.05, w: 12, h: 0, line: { color: C.accent, width: 3 } });
body.addText("01", { x: 0.75, y: 2.45, w: 1.2, h: 0.65, fontSize: 32, bold: true, color: C.accent, margin: 0 });
body.addText("Replace this starter with sourced content and a visual form chosen for the argument.", {
  x: 2.0, y: 2.5, w: 8.9, h: 1.25, fontFace: "Arial", fontSize: 22, bold: true, color: C.ink, margin: 0,
});
body.addText("Keep text, shapes, charts, tables and images independently editable whenever possible.", {
  x: 2.0, y: 4.15, w: 8.9, h: 0.8, fontFace: "Arial", fontSize: 17, color: C.muted, margin: 0,
});
addFooter(body, 2);
addSources(body);

await pptx.writeFile({ fileName: OUTPUT, compression: true });
console.log(JSON.stringify({ output: OUTPUT, slides: pptx._slides.length }, null, 2));
