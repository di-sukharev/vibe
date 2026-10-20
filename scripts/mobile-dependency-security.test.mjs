import { test } from 'bun:test'
import { execFileSync } from 'node:child_process'

const mobileModules = `
  const assert = require('node:assert/strict')
  const { createRequire } = require('node:module')
  const { resolve } = require('node:path')
  const mobile = createRequire(resolve('mobile/package.json'))
`

function runInNode(source) {
  execFileSync('node', ['--input-type=commonjs', '-e', mobileModules + source], {
    cwd: new URL('..', import.meta.url), timeout: 3000, stdio: 'pipe',
  })
}

test('Expo query parsing preserves valid parameters and handles malformed encoded input', () => {
  runInNode(`
    const router = createRequire(mobile.resolve('expo-router'))
    const query = router('query-string')
    const malformed = '%C0'.repeat(2000)
    const result = query.parse('name=%D0%94%D0%B8%D0%BC%D0%B0&tag=a&tag=b&bad=' + malformed)
    assert.deepEqual({ ...result }, { name: 'Дима', tag: ['a', 'b'], bad: malformed })
  `)
})

test('Expo signing tools reject RSA signatures with garbage inside the digest algorithm', () => {
  runInNode(`
    const crypto = require('node:crypto')
    const expo = createRequire(mobile.resolve('expo'))
    const cli = createRequire(expo.resolve('@expo/cli'))
    const forge = cli('node-forge')
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 })
    const key = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }))
    const data = Buffer.from('Expo signing regression fixture')
    const digest = crypto.createHash('sha256').update(data).digest()
    assert.equal(key.verify(digest.toString('binary'), crypto.sign('sha256', data, privateKey).toString('binary')), true)

    const { asn1 } = forge
    const universal = asn1.Class.UNIVERSAL
    const sequence = (nodes) => asn1.create(universal, asn1.Type.SEQUENCE, true, nodes)
    const malformed = sequence([
      sequence([
        asn1.create(universal, asn1.Type.OID, false, asn1.oidToDer(forge.pki.oids.sha256).getBytes()),
        asn1.create(universal, asn1.Type.NULL, false, ''),
        asn1.create(universal, asn1.Type.OCTETSTRING, false, 'unconsumed garbage'),
      ]),
      asn1.create(universal, asn1.Type.OCTETSTRING, false, digest.toString('binary')),
    ])
    const signature = crypto.privateEncrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(asn1.toDer(malformed).getBytes(), 'binary'))
    let accepted = false
    try { accepted = key.verify(digest.toString('binary'), signature.toString('binary')) } catch {}
    assert.equal(accepted, false)
  `)
})
