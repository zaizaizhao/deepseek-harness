import { Buffer } from 'node:buffer'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assetIdFor,
  detectImageMediaType,
  sanitizeName,
  traceFor,
  VisionAssetResolver,
} from '../src/assets.ts'
import { config, GIF, PNG } from './helpers.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

interface BenchOptions {
  readonly cwd?: string | false
  readonly fs?: boolean
  readonly durable?: boolean
  readonly maxImageBytes?: number
  readonly maxImagesPerMessage?: number
  readonly maxMessageImageBytes?: number
}

async function bench(options: BenchOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-vision-assets-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LocalAttachmentStore, {
    dshHome: join(root, 'home'),
    ...(options.maxImageBytes === undefined ? {} : { maxImageBytes: options.maxImageBytes }),
    ...(options.maxImagesPerMessage === undefined ? {} : { maxImagesPerMessage: options.maxImagesPerMessage }),
    ...(options.maxMessageImageBytes === undefined ? {} : { maxMessageImageBytes: options.maxMessageImageBytes }),
  })
  if (options.fs !== false) await ctx.plugin(LocalFileSystem, { cwd: workspace })
  if (options.durable !== false) ctx.on('session/flush', () => {})
  const id = SessionId(`asset-${roots.length}`)
  const cwd = options.cwd === false ? undefined : options.cwd ?? workspace
  const session = ctx.sessions.create(id, cwd === undefined ? {} : { meta: { cwd } })
  const agent = { id, ctx, session } as unknown as Agent
  return { root, workspace, ctx, agent, resolver: new VisionAssetResolver(ctx, config()) }
}

const upload = (data = PNG, mediaType: 'image/png' | 'image/gif' = 'image/png', name?: string) => ({
  images: [{ data: Buffer.from(data).toString('base64'), mediaType, ...(name === undefined ? {} : { name }) }],
})

describe('VisionAssetResolver browser admission', () => {
  it('saves, checkpoints, reuses, authorizes, and traces a stable content id', async () => {
    const b = await bench()
    const first = await b.resolver.upload(b.agent, upload(PNG, 'image/png', '../folder/pixel.png'))
    expect(first.toolName).toBe('gpt_luna_vision')
    expect(first.assets).toHaveLength(1)
    expect(first.assets[0]).toMatchObject({ mediaType: 'image/png', width: 1, height: 1, name: 'pixel.png' })
    expect(first.assets[0]?.assetId).toMatch(/^vision:/)
    expect(b.agent.session.events.filter(event => event.type === 'vision/asset')).toHaveLength(1)

    const second = await b.resolver.upload(b.agent, upload())
    expect(second.assets[0]?.assetId).toBe(first.assets[0]?.assetId)
    expect(b.agent.session.events.filter(event => event.type === 'vision/asset')).toHaveLength(1)
    const [resolved] = await b.resolver.resolve(
      b.agent,
      [{ asset_id: String(first.assets[0]?.assetId) }],
      new AbortController().signal,
    )
    if (resolved === undefined) throw new Error('resolved asset missing')
    expect(assetIdFor(resolved.attachment)).toBe(resolved.assetId)
    expect(traceFor(resolved)).toEqual({
      assetId: resolved.assetId,
      mediaType: 'image/png',
      bytes: PNG.byteLength,
      width: 1,
      height: 1,
    })
    const unnamed = await b.resolver.upload(b.agent, upload(GIF, 'image/gif'))
    expect(unnamed.assets[0]).not.toHaveProperty('name')
  })

  it('rejects invalid count, aggregate size, duplicate content, and unauthorized ids', async () => {
    const count = await bench({ maxImagesPerMessage: 1 })
    await expect(count.resolver.upload(count.agent, { images: [] }))
      .rejects.toMatchObject({ code: 'VISION_TOO_MANY_ASSETS' })
    await expect(count.resolver.upload(count.agent, { images: [upload().images[0]!, upload(GIF, 'image/gif').images[0]!] }))
      .rejects.toMatchObject({ code: 'VISION_TOO_MANY_ASSETS' })

    const aggregate = await bench({ maxMessageImageBytes: PNG.byteLength + GIF.byteLength - 1 })
    await expect(aggregate.resolver.upload(aggregate.agent, {
      images: [upload().images[0]!, upload(GIF, 'image/gif').images[0]!],
    })).rejects.toMatchObject({ code: 'VISION_TOO_MANY_ASSETS' })

    const duplicate = await bench()
    const duplicateSave = vi.spyOn(duplicate.ctx.attachments, 'saveImage')
    await expect(duplicate.resolver.upload(duplicate.agent, {
      images: [upload().images[0]!, upload().images[0]!],
    })).rejects.toMatchObject({ code: 'VISION_INVALID_ASSET' })
    expect(duplicateSave).not.toHaveBeenCalled()
    await expect(duplicate.resolver.resolve(
      duplicate.agent,
      [{ asset_id: 'vision:not-authorized' }],
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_ASSET_FORBIDDEN' })
  })

  it.each([
    ['', 'canonical bounded base64'],
    ['A', 'canonical bounded base64'],
    ['!!!!', 'canonical bounded base64'],
    ['AB==', 'canonical bounded base64'],
  ])('rejects malformed canonical base64 %j', async (data, fragment) => {
    const b = await bench()
    await expect(b.resolver.upload(b.agent, { images: [{ data, mediaType: 'image/png' }] }))
      .rejects.toThrow(fragment)
  })

  it('rejects base64 before allocation when encoded or decoded bytes exceed policy', async () => {
    const b = await bench({ maxImageBytes: 2, maxMessageImageBytes: 2 })
    await expect(b.resolver.upload(b.agent, {
      images: [{ data: 'AAAAAA==', mediaType: 'image/png' }],
    })).rejects.toMatchObject({ code: 'VISION_INVALID_ASSET' })
    await expect(b.resolver.upload(b.agent, {
      images: [{ data: 'AAAA', mediaType: 'image/png' }],
    })).rejects.toMatchObject({ code: 'VISION_INVALID_ASSET' })
  })

  it('validates every member before saving and fails when no durability listener participates', async () => {
    const invalid = await bench()
    const save = vi.spyOn(invalid.ctx.attachments, 'saveImage')
    await expect(invalid.resolver.upload(invalid.agent, {
      images: [upload().images[0]!, { data: 'AQIDBA==', mediaType: 'image/png' }],
    })).rejects.toThrow()
    expect(save).not.toHaveBeenCalled()

    const noDurability = await bench({ durable: false })
    await expect(noDurability.resolver.upload(noDurability.agent, upload()))
      .rejects.toMatchObject({ code: 'VISION_DURABILITY_FAILED' })
    expect(noDurability.agent.session.events.filter(event => event.type === 'vision/asset')).toHaveLength(1)
    noDurability.ctx.on('session/flush', () => {})
    const retried = await noDurability.resolver.upload(noDurability.agent, upload())
    expect(String(retried.assets[0]?.assetId)).toMatch(/^vision:/)
    expect(noDurability.agent.session.events.filter(event => event.type === 'vision/asset')).toHaveLength(1)
  })
})

describe('VisionAssetResolver Tool resolution', () => {
  it('reads a workspace image, sanitizes metadata, and rejects duplicate resolved content', async () => {
    const b = await bench()
    const path = join(b.workspace, 'pixel.png')
    await writeFile(path, PNG)
    const resolved = await b.resolver.resolve(b.agent, [{ file_path: 'pixel.png' }], new AbortController().signal)
    expect(resolved[0]).toMatchObject({ attachment: { name: 'pixel.png', width: 1, height: 1 } })
    expect(b.agent.session.events.findLast(event => event.type === 'vision/asset')).toMatchObject({
      data: { source: { kind: 'path', path: 'pixel.png' } },
    })
    await expect(b.resolver.resolve(
      b.agent,
      [{ file_path: 'pixel.png' }, { asset_id: String(resolved[0]?.assetId) }],
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_INVALID_ASSET' })
  })

  it('rejects empty and oversized batches before resolution', async () => {
    const b = await bench({ maxImagesPerMessage: 1 })
    await expect(b.resolver.resolve(b.agent, [], new AbortController().signal))
      .rejects.toMatchObject({ code: 'VISION_TOO_MANY_ASSETS' })
    await expect(b.resolver.resolve(
      b.agent,
      [{ asset_id: 'a' }, { asset_id: 'b' }],
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_TOO_MANY_ASSETS' })
  })

  it('rejects every unsafe or invalid workspace path posture', async () => {
    const empty = await bench()
    await expect(empty.resolver.resolve(empty.agent, [{ file_path: ' ' }], new AbortController().signal))
      .rejects.toMatchObject({ code: 'VISION_INVALID_ASSET' })

    const noWorkspace = await bench({ cwd: false })
    await expect(noWorkspace.resolver.resolve(noWorkspace.agent, [{ file_path: 'x.png' }], new AbortController().signal))
      .rejects.toMatchObject({ code: 'VISION_ASSET_FORBIDDEN' })

    const noFs = await bench({ fs: false })
    await expect(noFs.resolver.resolve(noFs.agent, [{ file_path: 'x.png' }], new AbortController().signal))
      .rejects.toMatchObject({ code: 'VISION_UNAVAILABLE' })

    const b = await bench()
    await expect(b.resolver.resolve(b.agent, [{ file_path: 'missing.png' }], new AbortController().signal))
      .rejects.toMatchObject({ code: 'VISION_INVALID_ASSET' })
    await writeFile(join(b.root, 'outside.png'), PNG)
    await expect(b.resolver.resolve(b.agent, [{ file_path: '../outside.png' }], new AbortController().signal))
      .rejects.toMatchObject({ code: 'VISION_ASSET_FORBIDDEN' })
    await symlink(join(b.root, 'outside.png'), join(b.workspace, 'link.png'))
    await expect(b.resolver.resolve(b.agent, [{ file_path: 'link.png' }], new AbortController().signal))
      .rejects.toMatchObject({ code: 'VISION_ASSET_FORBIDDEN' })
    await mkdir(join(b.workspace, 'directory'))
    await expect(b.resolver.resolve(b.agent, [{ file_path: 'directory' }], new AbortController().signal))
      .rejects.toMatchObject({ code: 'VISION_INVALID_ASSET' })
    await writeFile(join(b.workspace, 'text.png'), 'not an image')
    await expect(b.resolver.resolve(b.agent, [{ file_path: 'text.png' }], new AbortController().signal))
      .rejects.toMatchObject({ code: 'VISION_INVALID_ASSET' })

    await mkdir(join(b.workspace, 'odd'))
    await writeFile(join(b.workspace, 'odd', ' '), PNG)
    const unnamed = await b.resolver.resolve(b.agent, [{ file_path: 'odd/ ' }], new AbortController().signal)
    expect(unnamed[0]?.attachment).not.toHaveProperty('name')
  })

  it('rejects aggregate path bytes before saving any new object', async () => {
    const b = await bench({ maxMessageImageBytes: PNG.byteLength + GIF.byteLength - 1 })
    await writeFile(join(b.workspace, 'a.png'), PNG)
    await writeFile(join(b.workspace, 'b.gif'), GIF)
    const save = vi.spyOn(b.ctx.attachments, 'saveImage')
    await expect(b.resolver.resolve(
      b.agent,
      [{ file_path: 'a.png' }, { file_path: 'b.gif' }],
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_TOO_MANY_ASSETS' })
    expect(save).not.toHaveBeenCalled()
  })
})

describe('image signature and name helpers', () => {
  it('detects each admitted raster signature', () => {
    expect(detectImageMediaType(PNG)).toBe('image/png')
    expect(detectImageMediaType(Uint8Array.of(0xff, 0xd8, 0xff))).toBe('image/jpeg')
    expect(detectImageMediaType(Buffer.from('RIFF0000WEBP'))).toBe('image/webp')
    expect(detectImageMediaType(Buffer.from('GIF87a'))).toBe('image/gif')
    expect(detectImageMediaType(Buffer.from('GIF89a'))).toBe('image/gif')
    expect(() => detectImageMediaType(Uint8Array.of(1, 2, 3))).toThrow('not PNG, JPEG, WebP, or GIF')
  })

  it('drops unusable names and bounds basenames', () => {
    expect(sanitizeName(undefined)).toBeUndefined()
    expect(sanitizeName(' / \\ ')).toBeUndefined()
    expect(sanitizeName('../folder/photo.png')).toBe('photo.png')
    expect(sanitizeName('x'.repeat(300))).toHaveLength(255)
  })
})
