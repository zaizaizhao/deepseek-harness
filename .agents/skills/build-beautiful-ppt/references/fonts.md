# Cross-platform typography

Choose fonts by role, availability, and delivery environment. Verify installed family names before building; specifying a font name does not embed the font.

## Safe fallback stacks

- Latin sans: Arial → Aptos → Helvetica → Liberation Sans.
- Chinese sans: Noto Sans CJK SC → Microsoft YaHei → PingFang SC → Source Han Sans SC.
- Academic serif: Times New Roman → Liberation Serif → Noto Serif.
- Monospace: JetBrains Mono → Consolas → Menlo → Liberation Mono.

Use one primary family and, only when the visual system benefits, one contrasting display or serif family. Keep numerals and chart labels in a highly legible family.

## Hierarchy

When the template or user does not specify sizes, use at least:

- deck title: 50 pt;
- slide title: 35 pt;
- subheading or callout title: 24 pt;
- body: 16 pt;
- chart labels and sources: as large as the composition permits without overwhelming the evidence.

Shorten content or change layout before reducing body text below the baseline. Never allow a title designed for one line to wrap unexpectedly.

## Delivery check

Render through the target or a compatibility application. If the final machine may not have the selected font, use a safe fallback, embed fonts only when the backend and licensing permit it, or disclose the substitution risk.
