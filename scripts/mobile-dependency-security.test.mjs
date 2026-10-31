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

test('Expo DevTools commands retain validation and MCP schema conversion with the security override', () => {
  runInNode(`
    const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
    const { tmpdir } = require('node:os')
    const { dirname, join } = require('node:path')
    const expo = createRequire(mobile.resolve('expo'))
    const cliEntry = expo.resolve('@expo/cli')
    const serverPath = resolve(dirname(cliEntry), '../src/start/server')
    const { PluginSchema, DevToolsPluginOutputSchema } = require(join(serverPath, 'DevToolsPlugin.schema.js'))
    const { createMCPDevToolsExtensionSchema } = require(join(serverPath, 'createMCPDevToolsExtensionSchema.js'))
    const { DevToolsPluginCliExtensionExecutor } = require(join(serverPath, 'DevToolsPluginCliExtensionExecutor.js'))
    const { toJSONSchema } = createRequire(cliEntry)('zod')

    async function verify() {
      const directory = mkdtempSync(join(tmpdir(), 'expo-devtools-security-'))
      try {
        writeFileSync(join(directory, 'command.cjs'),
          'process.stdout.write(JSON.stringify([{ type: "text", level: "info", text: JSON.stringify({ command: process.argv[2], args: JSON.parse(process.argv[3]) }) }]))')
        const descriptor = {
          packageName: 'expo-test-plugin', packageRoot: directory,
          cliExtensions: {
            description: 'Integration fixture', entryPoint: 'command.cjs',
            commands: [{ name: 'inspect', title: 'Inspect', environments: ['cli', 'mcp'], parameters: [
              { name: 'target', type: 'text' },
              { name: 'count', type: 'number' },
              { name: 'confirm', type: 'confirm' },
            ] }],
          },
        }
        const plugin = PluginSchema.parse(descriptor)
        const invalidDescriptor = PluginSchema.safeParse({ ...descriptor,
          cliExtensions: { ...descriptor.cliExtensions, commands: [{ name: '', title: 'Invalid', environments: ['shell'] }] },
        })
        assert.equal(invalidDescriptor.success, false)
        assert.ok(invalidDescriptor.error.issues.length > 0)

        // MCP clients receive this JSON Schema for the tool parameters.
        const schema = createMCPDevToolsExtensionSchema(plugin)
        const parameters = toJSONSchema(schema)
        assert.equal(parameters.additionalProperties, false)
        assert.deepEqual(parameters.required, ['command'])
        assert.deepEqual(parameters.properties.command.enum, ['inspect'])
        assert.equal(parameters.properties.target.type, 'string')
        assert.equal(parameters.properties.count.type, 'number')
        assert.equal(parameters.properties.confirm.type, 'boolean')

        const args = { target: 'device', count: 2, confirm: true }
        const { command, ...parsedArgs } = schema.parse({ command: 'inspect', ...args })
        const executor = new DevToolsPluginCliExtensionExecutor(plugin, directory)
        const content = DevToolsPluginOutputSchema.parse(await executor.execute({ command, args: parsedArgs }))
        assert.deepEqual(JSON.parse(content[0].text), { command: 'inspect', args })
        for (const invalid of [
          { command: 'unknown', ...args },
          { command: 'inspect', ...args, count: '2' },
          { command: 'inspect', ...args, extra: true },
        ]) {
          assert.equal(schema.safeParse(invalid).success, false)
        }
        // Expo enforces required command arguments before starting a subprocess.
        await assert.rejects(executor.execute({ command: 'inspect', args: {} }), /Expected 3 parameter/)
        assert.equal(DevToolsPluginOutputSchema.safeParse([{ type: 'image', url: 'invalid' }]).success, false)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
    verify().catch((error) => { console.error(error); process.exitCode = 1 })
  `)
})
