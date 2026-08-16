import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { config, GIF, PNG } from './helpers.ts'

const downloadRemoteImage = vi.hoisted(() => vi.fn())

vi.mock('../src/url-image.ts', () => ({ downloadRemoteImage }))

const { VisionAssetResolver } = await import('../src/assets.ts')

const roots: string[] = []

afterEach(async () => {
  downloadRemoteImage.mockReset()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function bench() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-vision-url-assets-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LocalAttachmentStore, { dshHome: join(root, 'home') })
  await ctx.plugin(LocalFileSystem, { cwd: workspace })
  ctx.on('session/flush', () => {})
  const id = SessionId(`url-asset-${roots.length}`)
  const session = ctx.sessions.create(id, { meta: { cwd: workspace } })
  const agent = { id, ctx, session } as unknown as Agent
  return { ctx, agent, resolver: new VisionAssetResolver(ctx, config()) }
}

describe('VisionAssetResolver URL input', () => {
  it('persists redacted final URL metadata with and without a usable filename', async () => {
    const b = await bench()
    downloadRemoteImage
      .mockResolvedValueOnce({ data: PNG, finalUrl: new URL('https://images.example/') })
      .mockResolvedValueOnce({ data: GIF, finalUrl: new URL('https://images.example/photo.gif?secret=redacted') })

    const first = await b.resolver.resolve(
      b.agent,
      [{ url: 'https://images.example/token-one' }],
      new AbortController().signal,
    )
    const second = await b.resolver.resolve(
      b.agent,
      [{ url: 'https://images.example/token-two' }],
      new AbortController().signal,
    )
    expect(first[0]?.attachment).not.toHaveProperty('name')
    expect(second[0]?.attachment).toMatchObject({ name: 'photo.gif', mediaType: 'image/gif' })
    const events = b.agent.session.events.filter(event => event.type === 'vision/asset')
    expect(events).toHaveLength(2)
    expect(JSON.stringify(events)).not.toContain('token-one')
    expect(JSON.stringify(events)).not.toContain('token-two')
    expect(JSON.stringify(events)).not.toContain('secret=redacted')
    expect(downloadRemoteImage).toHaveBeenNthCalledWith(
      1,
      'https://images.example/token-one',
      expect.any(Object),
      b.ctx.attachments.imageLimits.maxImageBytes,
      expect.any(AbortSignal),
    )
  })
})
