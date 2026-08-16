/** Package-owned invariant companion for `@deepseek-ai/dsh-vision-luna`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-vision-luna'

/** Cordis companion plugin name. */
export const name = 'vision-luna-bundle-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: static patch rows own no mutable relation beyond their mounted packages. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - context carrying the invariant registry.
 * @returns disposer for the package reservation.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
