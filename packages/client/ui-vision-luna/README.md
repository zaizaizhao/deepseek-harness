# `@deepseek-ai/dsh-client-ui-vision-luna`

English | [中文](README.zh.md)

Browser image-intake and sent-message presentation plugin for [`@deepseek-ai/dsh-tool-vision-luna`](../../subagent/tool-vision-luna/README.md). It mounts the Host package's generated `visionLuna` Remote, registers the sole submit-time image intake provider on `ctx.conversation`, and presents durable visual references as ordinary message images.

When this plugin is absent, `ui-conversation` keeps its native behavior and serializes draft images as raw image prompt blocks. When this plugin is present, submission becomes a gated two-stage operation: upload the complete ordered file batch to the Host, then send the parent prompt with text-only `asset_id` reference parts. Upload failure, adapter unload, conversation teardown, or prompt failure leaves the draft available for retry and never sends a partial prompt. A prompt failure can leave already authorized, content-addressed assets available for a retry; it does not roll durable storage back.

The browser accepts PNG, JPEG, WebP, and GIF files already admitted by the shared composer policy. A text-only submission bypasses the Remote. For a non-empty image batch, the adapter encodes the upload payload in bounded chunks, invokes the generated Remote with the target Session id, requires exactly one durable receipt per input file, and rejects an unsupported MIME type or inconsistent receipt count before the parent prompt is sent.

## Configuration

This package has no configuration and no secret handling. The Client receives no provider API key, credential reference, endpoint, or protocol. All model routing and credential resolution occur in the Host's existing Harness services; the only browser-to-Host payload is image data plus optional display names.

## Sent-message Presentation

The durable user message still contains the exact model reference, but this plugin projects each matching `vision/asset` event as a hidden, direct-key Chat node and shadows the standard user and admitted-steering renderers. A reference backed by the durable event is replaced with the shared image gallery, while the user's ordinary text remains in the bubble and copy action. If an older history page has not loaded the authorization event yet, the reference remains visible instead of presenting an unverified image; the projection updates when the event becomes available. This is a display transformation only and does not rewrite Session history or model input.

Projected images load through the generated `visionLuna.read` Remote with the rendered Session id and opaque asset id. The Host resolves that id against the exact Session's `vision/asset` event and verifies the stored object before returning browser-only base64; the Client combines those bytes with the durable event metadata to produce a data URL for the shared gallery. Native message images continue through the standard Harness image loader. Display bytes never enter the parent prompt or plugin configuration.

## Model Experience

### Browser image intake

#### What the model sees

The parent receives only text such as `Visual asset available through gpt_luna_vision: asset_id=…`. No base64 or raw image block reaches the text-only parent. The Host prompt section and tool schema then tell the parent how to delegate the visual question.

#### Token effect

One short reference line per submitted image is added to the parent prompt. Image bytes stay outside the model-visible text.

#### KV Cache effect

Reference lines are content-addressed and stable for the same persisted attachment, but adding any new image changes the current user-message suffix. Earlier stable prompt turns remain reusable according to the selected provider.

## Known Limitations and Deferred Work

- Exactly one image intake adapter may be active. A duplicate registration fails during plugin activation.
- Upload is submit-time rather than selection-time, so a large batch adds one Host round trip before the parent prompt.
- The plugin exposes no asset library or image editor. Draft preview and removal remain owned by `ui-conversation`; sent-message images reuse the shared attachment gallery.
- This package mounts its own generated Remote, so intake registration waits for the exact `remote.visionLuna` service and uses the explicit Session-id method. Runtime-minted Session contexts do not inherit service injections added by later plugins.
