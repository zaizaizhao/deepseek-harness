/** Package-owned invariant companion for `@deepseek-ai/dsh-tool-vision-luna`. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-vision-luna'

/** Cordis companion plugin name. */
export const name = 'tool-vision-luna-invariant'
/** Service required before package ownership can be reserved. */
export const inject = ['invariants']

/** No runtime invariant: the service directly owns its asset registry, capacity, cache, and operation lifetimes. */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['visionLuna'] })

/**
 * Register this package's invariant companion.
 * @param ctx - context carrying the invariant registry.
 * @returns disposer for the package reservation.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
