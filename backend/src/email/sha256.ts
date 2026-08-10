import { createHash, createHmac } from 'node:crypto'

/**
 * The hash `@smithy/signature-v4` needs, over `node:crypto`.
 *
 * The AWS SDK supplies its own from `@smithy/core/checksum`, and importing that instead would be
 * the obvious move - but `@smithy/core` is a 5 MB package, and declaring it as a direct dependency
 * makes the package manager hoist a newer copy than the one the SDK has already resolved, pushing
 * the SDK's copy down into nineteen nested duplicates. Twelve lines here keep the image with one
 * copy of everything.
 *
 * The signer uses this both as a plain digest and, with a key, as an HMAC. That is the whole
 * interface: construct, `update`, `digest`.
 */
export class Sha256 {
  private readonly hash: ReturnType<typeof createHash> | ReturnType<typeof createHmac>

  constructor(secret?: unknown) {
    this.hash =
      secret === undefined
        ? createHash('sha256')
        : createHmac('sha256', secret as Parameters<typeof createHmac>[1])
  }

  /**
    * Narrower than smithy's `Hash.update`, which also admits a raw `ArrayBuffer` that
    * `node:crypto` would reject at runtime. No path the signer takes passes one - it chains
    * `Uint8Array` between rounds and strings for the scope parts - so widening it would be
    * modelling a case that does not occur. TypeScript's method bivariance hides the difference,
    * which is why it is written down here.
    */
  update(chunk: Uint8Array | string) {
    this.hash.update(chunk)
  }

  async digest(): Promise<Uint8Array> {
    return new Uint8Array(this.hash.digest())
  }
}
