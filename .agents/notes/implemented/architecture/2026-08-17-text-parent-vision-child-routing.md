# Agent Note: Text-only parent routing with an isolated vision child

Status: implemented

English | [中文](2026-08-17-text-parent-vision-child-routing.zh.md)

## Problem

A deployment may deliberately keep its main DeepSeek agent on a text-only route while still needing to inspect screenshots, diagrams, and uploaded images. Sending the raw image to that route is invalid, making a vision gateway the parent model changes the deployment's reasoning and cost policy, and letting a feature plugin own an API key duplicates the Harness settings and credentials system. The browser also previously submitted draft images directly as prompt parts, so a host-only tool could not guarantee that the parent request remained text-only.

## Decision

The feature is three plugins composed by one bundle. `@deepseek-ai/dsh-tool-vision-luna` owns host-side asset authorization, download policy, delegation, cache, jobs, and the `gpt_luna_vision` tool. `@deepseek-ai/dsh-client-ui-vision-luna` owns browser image intake and replaces raw draft-image prompt parts with opaque text references after a successful upload. `@deepseek-ai/dsh-vision-luna` only inserts both plugins with conservative policy defaults. The existing `ui-conversation` service exposes a sole-provider image-intake adapter; without a provider it preserves its previous raw-image behavior, while duplicate providers fail instead of making precedence depend on load order.

The vision plugin config names only an LLM route (`provider`, `model`) and non-secret execution policy. Provider profiles remain in the Harness `llm-pi-ai` settings namespace, including `api`, `baseURL`, model catalog, image modality, credential reference, headers, retries, and transport. The referenced secret remains in the Models page, the credentials provider's owner-only document, or the launch environment. Unknown plugin fields fail schema validation, so `apiKey`, `apiKeyEnv`, `baseURL`, and related transport fields cannot migrate into the plugin by accident. Credential lookup remains per request inside the selected Harness adapter, and an unresolved reference reaches the caller as `LlmError('MISSING_CREDENTIAL')` without the plugin reading or rewriting it.

Each vision call uses the registered `spawn` subagent provider with the configured vision route, depth one, no model-facing tools except the generated structured-output tool, and a hostile-image persona that treats image content as data rather than instructions. The child returns a fixed evidence schema. Only that validated text result reaches the parent tool transcript; the child request, including its image attachment, remains in the child Session. Provider/model capability resolution happens before delegation and refuses routes whose declared input modalities omit images.

Images enter a durable content-addressed asset store before a model call. A `vision/asset` Session event binds each opaque `vision:<attachment-id>` reference to the owning Session; tool calls can use only references found in that Session's authoritative events. Local paths resolve through the filesystem capability, remain inside the Session workspace after realpath and symlink checks, and must be regular files with accepted magic bytes under the byte limit. Remote images use HTTPS only, exact allowlisted origins, no credentials or literal IP addresses, public DNS answers only, per-request DNS pinning, redirect revalidation, streaming byte limits, and accepted image magic bytes. Each batch is fully validated and duplicate-checked before its first save. Immutable objects are saved before authorization events, and no receipt is returned until the Session flush succeeds. A storage failure may leave an unreferenced content-addressed object, while a flush failure leaves its events pending and a retry forces another flush instead of treating the in-memory event as durable.

The service keeps a bounded process-local LRU of completed structured results, scoped by parent Session, and coalesces identical in-flight requests within that Session. One cancelled subscriber does not stop shared work while another subscriber is waiting. Optional background execution uses the existing jobs capability. Disposal stops admission, aborts active downloads and child runs, waits for settlement, and unregisters every contribution through Cordis effects.

## Package topology

The host and browser plugins evolve independently because one secures model-side inputs while the other adapts a GUI submission path. The bundle is intentionally shallow: it declares no provider endpoint or credential reference and therefore remains reusable across deployments. Non-GUI compositions can mount the host plugin alone and create authorized asset references through the attachment RPC or another trusted client.

## Verification

The keyless ACP snapshot assembles the real attachment store, Session persistence, subagent driver, tool registry, and vision plugin around a deterministic two-route adapter. Its fixture rejects any image block in the parent request, requires `zaizaizhao/gpt-5.6-luna` and an image block in the child request, and returns evidence through structured output. The committed parent and child Session artifacts pin the separate request headers and transcripts. Package tests cover config rejection, credential-error preservation, route modalities, cache races, lifecycle drain, Session authorization, path containment, URL validation, redirects, DNS pinning, byte limits, image signatures, atomic uploads, browser fallback, adapter replacement, and draft retention after failure.

## Alternatives considered

**Send images to the parent and rely on the provider to ignore them.** A text-only route rejects the request before the model can decide what to do, and over-claiming image support would make a durable Session repeat a request that cannot succeed.

**Configure the vision endpoint and API key inside the feature plugin.** This creates a second provider registry and credential store, prevents the Models page and hot reload from owning the route, and increases the number of components that can expose a key.

**Make the vision model the main agent.** This changes every turn's routing, reasoning behavior, latency, and cost to solve a capability needed only for selected images.

**Put all code in one package.** A host-only ACP or headless deployment would then carry browser code, while a GUI concern would share lifecycle and security-sensitive input code with model execution.

**Authorize unrestricted file paths or arbitrary URLs directly in tool arguments.** Model-generated arguments are not authority to escape the Session workspace or contact an arbitrary host. The implemented path route stays inside the Agent filesystem capability, the URL route requires an exact operator allowlist, and browser input uses Session-scoped opaque references so replay remains reconstructable.

## Consequences

The main model's request stays text-only and the existing Harness configuration remains the single source for model routing and credentials. Deployments can change the visual provider without rebuilding the plugin, and every model-visible result is reconstructable from Session logs. The cost is an extra child request, durable asset storage, a browser-to-host upload step, and explicit configuration of a vision-capable route. The process-local result cache does not survive restart, background jobs do not make child runs durable across process failure, remote URL intake intentionally rejects private-network and non-HTTPS sources, and the bundle supports one active browser image-intake provider at a time.
