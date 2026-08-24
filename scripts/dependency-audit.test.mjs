import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  findForbiddenSourceImports,
  parseAuditReport,
  readDirectDependencies,
  readLockfileExposure,
  readRepositorySourceFiles,
  reviewAudit,
  runBunAudit,
} from './dependency-audit.mjs'

const advisory = {
  id: 1138808,
  severity: 'high',
  title: 'image-size parser can loop forever',
  url: 'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr',
  vulnerable_versions: '<=2.0.2',
}

const exception = {
  advisoryId: 'GHSA-w3rx-r6r6-pgpr',
  allowedDirectConsumers: ['metro'],
  allowedResolutions: ['image-size@1.2.1'],
  allowedWorkspaces: ['mobile'],
  expiresOn: '2026-09-24',
  packageName: 'image-size',
  severity: 'high',
}

const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('dependency audit exceptions', () => {
  test('parses Bun JSON even when its banner is emitted after the report', () => {
    expect(
      parseAuditReport(
        '{"image-size":[]}\n\u001b[1mbun audit\u001b[0m v1.3.14',
      ),
    ).toEqual({ 'image-size': [] })
  })

  test('rejects signals and exit statuses that do not match the parsed report', () => {
    const output = JSON.stringify({ 'image-size': [advisory] })
    expect(
      runBunAudit(() => ({ signal: null, status: 1, stderr: '', stdout: output }), '/tmp'),
    ).toEqual({ 'image-size': [advisory] })

    expect(() =>
      runBunAudit(
        () => ({ signal: 'SIGTERM', status: 1, stderr: '', stdout: output }),
        '/tmp',
      ),
    ).toThrow('Bun dependency audit terminated by SIGTERM.')
    expect(() =>
      runBunAudit(() => ({ signal: null, status: 2, stderr: '', stdout: output }), '/tmp'),
    ).toThrow('Bun dependency audit exited with status 2; expected 1 for 1 finding(s).')
    expect(() =>
      runBunAudit(() => ({ signal: null, status: 1, stderr: '', stdout: '{}' }), '/tmp'),
    ).toThrow('Bun dependency audit exited with status 1; expected 0 for 0 finding(s).')
  })

  test('accepts only the exact reviewed transitive finding before its review date', () => {
    const result = reviewAudit(
      { 'image-size': [advisory] },
      auditOptions(),
    )

    expect(result.errors).toEqual([])
    expect(result.accepted).toEqual([
      { advisoryId: 'GHSA-w3rx-r6r6-pgpr', packageName: 'image-size' },
    ])
  })

  test('rejects a new advisory even for the same package', () => {
    const result = reviewAudit(
      {
        'image-size': [
          advisory,
          {
            ...advisory,
            id: 999,
            url: 'https://github.com/advisories/GHSA-new1-new2-new3',
          },
        ],
      },
      auditOptions(),
    )

    expect(result.errors).toContain(
      'Unreviewed high vulnerability: image-size GHSA-new1-new2-new3.',
    )
  })

  test('rejects expired exceptions and lockfile exposure drift', () => {
    const expired = reviewAudit(
      { 'image-size': [advisory] },
      auditOptions({ now: new Date('2026-09-25T00:00:00Z') }),
    )
    expect(expired.errors).toContain(
      'Temporary exception expired on 2026-09-24: image-size GHSA-w3rx-r6r6-pgpr.',
    )

    const changedExposure = reviewAudit(
      { 'image-size': [advisory] },
      auditOptions({
        packageExposures: new Map([
          [
            'image-size',
            {
              directConsumers: new Set(['metro', 'runtime-parser']),
              reachableWorkspaces: new Set(['backend', 'mobile', 'website']),
              resolutions: new Set(['image-size@1.2.1', 'image-size@2.0.2']),
            },
          ],
        ]),
      }),
    )
    expect(changedExposure.errors).toContain(
      'Temporary exception expects only image-size@1.2.1, found image-size@1.2.1, image-size@2.0.2.',
    )
    expect(changedExposure.errors).toContain(
      'Temporary exception expects image-size to be consumed only by metro, found metro, runtime-parser.',
    )
    expect(changedExposure.errors).toContain(
      'Temporary exception expects image-size to be reachable only from workspace mobile, found backend, mobile, website.',
    )
  })

  test('rejects direct application use and stale exceptions', () => {
    const direct = reviewAudit(
      { 'image-size': [advisory] },
      auditOptions({ directDependencies: new Set(['image-size']) }),
    )
    expect(direct.errors).toContain(
      'Temporary exception cannot cover direct dependency image-size.',
    )

    const stale = reviewAudit({}, auditOptions())
    expect(stale.errors).toContain(
      'Temporary exception is stale and must be removed: image-size GHSA-w3rx-r6r6-pgpr.',
    )
  })

  test('rejects undeclared source imports while ignoring comments and string examples', () => {
    const sourceImports = findForbiddenSourceImports(
      [
        {
          path: 'backend/src/runtime.ts',
          source: [
            '#!/usr/bin/env bun',
            'import sizeOf from "image-size"',
            'const lazy = import("image-size/fromFile")',
            'const legacy = require("image-size")',
          ].join('\n'),
        },
        {
          path: 'backend/src/example.ts',
          source: '// import("image-size")\nconst example = "require(\\"image-size\\")"',
        },
      ],
      new Set(['image-size']),
    )
    expect(sourceImports.get('image-size')).toEqual(new Set(['backend/src/runtime.ts']))

    const result = reviewAudit(
      { 'image-size': [advisory] },
      auditOptions({ sourceImports }),
    )
    expect(result.errors).toContain(
      'Temporary exception cannot cover source imports of image-size: backend/src/runtime.ts.',
    )
  })

  test('rejects guarded imports from Astro frontmatter and scripts', () => {
    const root = temporaryDirectory()
    mkdirSync(join(root, 'website', 'src', 'pages'), { recursive: true })
    writeFileSync(
      join(root, 'website', 'src', 'pages', 'index.astro'),
      [
        '---',
        'const lazy = import("image-size/fromFile")',
        '---',
        '<main>Safe markup</main>',
        '<script>require("image-size")</script>',
      ].join('\n'),
    )
    expect(spawnSync('git', ['init', '--quiet'], { cwd: root }).status).toBe(0)

    const sourceImports = findForbiddenSourceImports(
      readRepositorySourceFiles(root),
      new Set(['image-size']),
    )

    expect(sourceImports.get('image-size')).toEqual(
      new Set(['website/src/pages/index.astro']),
    )
  })

  test('ignores non-JavaScript and commented Astro script blocks', () => {
    const sourceImports = findForbiddenSourceImports(
      [
        {
          path: 'website/src/pages/index.astro',
          source: [
            '<script type="application/ld+json">',
            '{"packageExample":"import(\\"image-size\\")"}',
            '</script>',
            '<script type="text/javascript; charset=utf-8">import "image-size"</script>',
            '<!-- <script>import "image-size"</script> -->',
          ].join('\n'),
        },
      ],
      new Set(['image-size']),
    )

    expect(sourceImports.has('image-size')).toBe(false)
  })

  test('scans every standard JavaScript MIME type in Astro scripts', () => {
    const javaScriptTypes = [
      '',
      'module',
      'application/ecmascript',
      'application/javascript',
      'application/x-ecmascript',
      'application/x-javascript',
      'text/ecmascript',
      'text/javascript',
      'text/javascript1.0',
      'text/javascript1.1',
      'text/javascript1.2',
      'text/javascript1.3',
      'text/javascript1.4',
      'text/javascript1.5',
      'text/jscript',
      'text/livescript',
      'text/x-ecmascript',
      'text/x-javascript',
    ]
    const files = javaScriptTypes.map((type, index) => ({
      path: `website/src/pages/mime-${index}.astro`,
      source: `<script type="${type}">import "image-size"</script>`,
    }))

    const sourceImports = findForbiddenSourceImports(files, new Set(['image-size']))

    expect(sourceImports.get('image-size')).toEqual(
      new Set(files.map(({ path }) => path)),
    )
  })

  test('does not confuse data-type with the Astro script MIME type', () => {
    const sourceImports = findForbiddenSourceImports(
      [
        {
          path: 'website/src/pages/index.astro',
          source:
            '<script data-type="application/ld+json">import "image-size"</script>',
        },
      ],
      new Set(['image-size']),
    )

    expect(sourceImports.get('image-size')).toEqual(
      new Set(['website/src/pages/index.astro']),
    )
  })

  test('discovers direct dependencies from root and workspace manifests', () => {
    const root = temporaryDirectory()
    mkdirSync(join(root, 'mobile'))
    mkdirSync(join(root, 'packages', 'contracts'), { recursive: true })
    writeManifest(root, 'package.json', { dependencies: { rootOnly: '1.0.0' } })
    writeManifest(root, 'mobile/package.json', {
      devDependencies: { 'image-parser': 'npm:image-size@1.2.1' },
    })
    writeManifest(root, 'packages/contracts/package.json', {
      optionalDependencies: { contractOnly: '1.0.0' },
      peerDependencies: { contractPeer: '1.0.0' },
    })

    expect([...readDirectDependencies(root)].sort()).toEqual([
      'contractOnly',
      'contractPeer',
      'image-parser',
      'image-size',
      'rootOnly',
    ])
  })

  test('derives every resolution, direct consumer, and reachable workspace from bun.lock', () => {
    const root = temporaryDirectory()
    writeFileSync(
      join(root, 'bun.lock'),
      JSON.stringify({
        lockfileVersion: 1,
        packages: {
          '@react-three/fiber': [
            '@react-three/fiber@9.6.1',
            '',
            { peerDependencies: { expo: '>=43.0' }, optionalPeers: ['expo'] },
          ],
          expo: ['expo@57.0.16', '', { dependencies: { metro: '0.84.4' } }],
          'image-size': ['image-size@1.2.1', '', {}],
          metro: ['metro@0.84.4', '', { dependencies: { 'image-size': '^1.0.2' } }],
        },
        workspaces: {
          mobile: { dependencies: { expo: '~57.0.16' } },
          website: { dependencies: { '@react-three/fiber': '^9.6.1' } },
        },
      }),
    )

    const exposure = readLockfileExposure(root, 'image-size')
    expect([...exposure.resolutions]).toEqual(['image-size@1.2.1'])
    expect([...exposure.directConsumers]).toEqual(['metro'])
    expect([...exposure.reachableWorkspaces]).toEqual(['mobile'])
  })

  test('treats an npm alias as the resolved package in the reverse lock graph', () => {
    const root = temporaryDirectory()
    writeFileSync(
      join(root, 'bun.lock'),
      JSON.stringify({
        lockfileVersion: 1,
        packages: {
          'image-parser': ['image-size@1.2.1', '', {}],
        },
        workspaces: {
          backend: { dependencies: { 'image-parser': 'npm:image-size@1.2.1' } },
        },
      }),
    )

    const exposure = readLockfileExposure(root, 'image-size')
    expect([...exposure.resolutions]).toEqual(['image-size@1.2.1'])
    expect([...exposure.directConsumers]).toEqual([])
    expect([...exposure.reachableWorkspaces]).toEqual(['backend'])
  })
})

function auditOptions(overrides = {}) {
  return {
    directDependencies: new Set(),
    exceptions: [exception],
    now: new Date('2026-08-24T12:00:00Z'),
    packageExposures: new Map([
      [
        'image-size',
        {
          directConsumers: new Set(['metro']),
          reachableWorkspaces: new Set(['mobile']),
          resolutions: new Set(['image-size@1.2.1']),
        },
      ],
    ]),
    sourceImports: new Map(),
    ...overrides,
  }
}

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'dependency-audit-'))
  temporaryDirectories.push(directory)
  return directory
}

function writeManifest(root, relativePath, contents) {
  writeFileSync(join(root, relativePath), JSON.stringify(contents))
}
