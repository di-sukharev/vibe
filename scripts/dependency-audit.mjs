import { Glob } from 'bun'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceExtension = /\.(?:[cm]?[jt]sx?|astro)$/
const javaScriptMimeTypes = new Set([
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
])

export const temporaryAuditExceptions = [
  {
    advisoryId: 'GHSA-w3rx-r6r6-pgpr',
    allowedDirectConsumers: ['metro'],
    allowedResolutions: ['image-size@1.2.1'],
    allowedWorkspaces: ['mobile'],
    expiresOn: '2026-09-24',
    packageName: 'image-size',
    reason:
      'Metro uses this parser for local build assets; the installed dependency graph reaches it only from mobile, and no patched npm release exists.',
    severity: 'high',
  },
  {
    advisoryId: 'GHSA-5p2g-fcmc-qvqq',
    allowedDirectConsumers: ['metro'],
    allowedResolutions: ['image-size@1.2.1'],
    allowedWorkspaces: ['mobile'],
    expiresOn: '2026-09-24',
    packageName: 'image-size',
    reason:
      'Metro uses this parser for local build assets; the installed dependency graph reaches it only from mobile, and no patched npm release exists.',
    severity: 'high',
  },
]

export function reviewAudit(
  report,
  {
    directDependencies,
    exceptions = temporaryAuditExceptions,
    now = new Date(),
    packageExposures,
    sourceImports = new Map(),
  },
) {
  const accepted = []
  const errors = []
  const matchedExceptions = new Set()

  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return { accepted, errors: ['Bun returned a malformed dependency audit report.'] }
  }

  for (const [packageName, findings] of Object.entries(report)) {
    if (!Array.isArray(findings)) {
      errors.push(`Bun returned malformed findings for ${packageName}.`)
      continue
    }

    for (const finding of findings) {
      const advisoryId = advisoryIdFromFinding(finding)
      const severity = typeof finding?.severity === 'string' ? finding.severity : 'unknown'
      const exceptionIndex = exceptions.findIndex(
        (candidate) =>
          candidate.packageName === packageName &&
          candidate.advisoryId === advisoryId &&
          candidate.severity === severity,
      )

      if (exceptionIndex === -1) {
        errors.push(`Unreviewed ${severity} vulnerability: ${packageName} ${advisoryId}.`)
        continue
      }

      const exception = exceptions[exceptionIndex]
      matchedExceptions.add(exceptionIndex)
      let isAccepted = true

      if (isExpired(exception.expiresOn, now)) {
        errors.push(
          `Temporary exception expired on ${exception.expiresOn}: ${packageName} ${advisoryId}.`,
        )
        isAccepted = false
      }

      const exposure = packageExposures.get(packageName)
      if (!sameValues(exposure?.resolutions, exception.allowedResolutions)) {
        errors.push(
          `Temporary exception expects only ${exception.allowedResolutions.join(', ')}, found ${formatValues(exposure?.resolutions)}.`,
        )
        isAccepted = false
      }

      if (!sameValues(exposure?.directConsumers, exception.allowedDirectConsumers)) {
        errors.push(
          `Temporary exception expects ${packageName} to be consumed only by ${exception.allowedDirectConsumers.join(', ')}, found ${formatValues(exposure?.directConsumers)}.`,
        )
        isAccepted = false
      }

      if (!sameValues(exposure?.reachableWorkspaces, exception.allowedWorkspaces)) {
        errors.push(
          `Temporary exception expects ${packageName} to be reachable only from workspace ${exception.allowedWorkspaces.join(', ')}, found ${formatValues(exposure?.reachableWorkspaces)}.`,
        )
        isAccepted = false
      }

      if (directDependencies.has(packageName)) {
        errors.push(`Temporary exception cannot cover direct dependency ${packageName}.`)
        isAccepted = false
      }

      const importedBy = sourceImports.get(packageName)
      if (importedBy?.size > 0) {
        errors.push(
          `Temporary exception cannot cover source imports of ${packageName}: ${[...importedBy].sort().join(', ')}.`,
        )
        isAccepted = false
      }

      if (isAccepted) accepted.push({ advisoryId, packageName })
    }
  }

  for (const [index, exception] of exceptions.entries()) {
    if (!matchedExceptions.has(index)) {
      errors.push(
        `Temporary exception is stale and must be removed: ${exception.packageName} ${exception.advisoryId}.`,
      )
    }
  }

  return {
    accepted: uniqueAccepted(accepted),
    errors: [...new Set(errors)],
  }
}

export function parseAuditReport(output) {
  const normalized = output.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/g, '').trim()
  const objectStart = normalized.indexOf('{')
  const objectEnd = normalized.lastIndexOf('}')
  if (objectStart === -1 || objectEnd < objectStart) {
    throw new Error('Bun did not return a JSON dependency audit report.')
  }
  return JSON.parse(normalized.slice(objectStart, objectEnd + 1))
}

export function runBunAudit(runAudit = spawnSync, root = repositoryRoot) {
  const audit = runAudit(process.execPath, ['audit', '--json'], {
    cwd: root,
    encoding: 'utf8',
  })

  if (audit.error) throw audit.error

  let report
  try {
    report = parseAuditReport(`${audit.stdout ?? ''}\n${audit.stderr ?? ''}`)
  } catch (error) {
    const detail = audit.stderr?.trim()
    throw new Error(
      `Could not read Bun's dependency audit${detail ? `: ${detail}` : '.'}`,
      { cause: error },
    )
  }

  const invocationErrors = validateAuditInvocation(audit, report)
  if (invocationErrors.length > 0) throw new Error(invocationErrors.join(' '))
  return report
}

export function validateAuditInvocation(audit, report) {
  const errors = []
  const findingCount = Object.values(report).reduce(
    (count, findings) => count + (Array.isArray(findings) ? findings.length : 0),
    0,
  )
  const expectedStatus = findingCount > 0 ? 1 : 0

  if (audit.signal) errors.push(`Bun dependency audit terminated by ${audit.signal}.`)
  if (!Number.isInteger(audit.status)) {
    errors.push('Bun dependency audit did not report an exit status.')
  } else if (audit.status !== expectedStatus) {
    errors.push(
      `Bun dependency audit exited with status ${audit.status}; expected ${expectedStatus} for ${findingCount} finding(s).`,
    )
  }

  return errors
}

function runDependencyAudit() {
  const report = runBunAudit(spawnSync, repositoryRoot)
  const directDependencies = readDirectDependencies(repositoryRoot)
  const packageExposures = new Map(
    temporaryAuditExceptions.map(({ packageName }) => [
      packageName,
      readLockfileExposure(repositoryRoot, packageName),
    ]),
  )
  const guardedPackages = new Set(
    temporaryAuditExceptions.map(({ packageName }) => packageName),
  )
  const sourceImports = findForbiddenSourceImports(
    readRepositorySourceFiles(repositoryRoot),
    guardedPackages,
  )
  const result = reviewAudit(report, {
    directDependencies,
    packageExposures,
    sourceImports,
  })

  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`[dependency-audit] ${error}`)
    process.exitCode = 1
    return
  }

  if (result.accepted.length === 0) {
    console.log('Dependency audit passed with no known vulnerabilities.')
    return
  }

  console.log(
    `Dependency audit passed with ${result.accepted.length} temporary build-time exception(s):`,
  )
  for (const accepted of result.accepted) {
    const exception = temporaryAuditExceptions.find(
      (candidate) =>
        candidate.packageName === accepted.packageName &&
        candidate.advisoryId === accepted.advisoryId,
    )
    console.log(
      `- ${accepted.packageName} ${accepted.advisoryId}; review by ${exception.expiresOn}. ${exception.reason}`,
    )
  }
}

export function readDirectDependencies(root) {
  const dependencyNames = new Set()
  const manifests = new Set()
  for (const pattern of ['package.json', '*/package.json', 'packages/*/package.json']) {
    for (const manifest of new Glob(pattern).scanSync({ cwd: root, onlyFiles: true })) {
      manifests.add(manifest)
    }
  }

  for (const manifest of manifests) {
    const parsed = JSON.parse(readFileSync(path.join(root, manifest), 'utf8'))
    for (const field of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      for (const [name, specifier] of Object.entries(parsed[field] ?? {})) {
        dependencyNames.add(name)
        const aliasTarget = npmAliasTarget(specifier)
        if (aliasTarget) dependencyNames.add(aliasTarget)
      }
    }
  }

  return dependencyNames
}

export function readLockfileExposure(root, packageName) {
  const lockfile = Bun.JSONC.parse(readFileSync(path.join(root, 'bun.lock'), 'utf8'))
  const reverseConsumers = new Map()
  const resolutions = new Set()

  for (const entry of Object.values(lockfile.packages ?? {})) {
    const resolution = entry?.[0]
    const consumerName = packageNameFromResolution(resolution)
    if (!consumerName) continue
    if (consumerName === packageName) resolutions.add(resolution)
    addReverseDependencies(reverseConsumers, consumerName, entry?.[2])
  }

  for (const [workspacePath, manifest] of Object.entries(lockfile.workspaces ?? {})) {
    addReverseDependencies(
      reverseConsumers,
      `workspace:${workspacePath || '.'}`,
      manifest,
    )
  }

  const directConsumers = new Set(
    [...(reverseConsumers.get(packageName) ?? [])]
      .filter((consumer) => !consumer.startsWith('workspace:')),
  )
  const reachableWorkspaces = new Set()
  const visitedPackages = new Set([packageName])
  const pendingPackages = [packageName]

  while (pendingPackages.length > 0) {
    const dependency = pendingPackages.shift()
    for (const consumer of reverseConsumers.get(dependency) ?? []) {
      if (consumer.startsWith('workspace:')) {
        reachableWorkspaces.add(consumer.slice('workspace:'.length))
      } else if (!visitedPackages.has(consumer)) {
        visitedPackages.add(consumer)
        pendingPackages.push(consumer)
      }
    }
  }

  return { directConsumers, reachableWorkspaces, resolutions }
}

export function findForbiddenSourceImports(files, packageNames) {
  const findings = new Map()

  for (const file of files) {
    const transpiler = new Bun.Transpiler({ loader: sourceLoader(file.path) })
    let imports
    try {
      imports = transpiler.scanImports(sourceForImportScan(file))
    } catch (error) {
      throw new Error(`Could not inspect imports in ${file.path}.`, { cause: error })
    }

    for (const imported of imports) {
      for (const packageName of packageNames) {
        if (
          imported.path !== packageName &&
          !imported.path.startsWith(`${packageName}/`)
        ) continue
        const paths = findings.get(packageName) ?? new Set()
        paths.add(file.path)
        findings.set(packageName, paths)
      }
    }
  }

  return findings
}

export function readRepositorySourceFiles(root) {
  const files = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
  )
  if (files.error) throw files.error
  if (files.signal || files.status !== 0) {
    throw new Error(
      `Could not enumerate repository source files${files.signal ? `: terminated by ${files.signal}` : `: git exited ${files.status}`}.`,
    )
  }

  return files.stdout
    .split('\0')
    .filter((filePath) => sourceExtension.test(filePath))
    .map((filePath) => ({
      path: filePath,
      source: readFileSync(path.join(root, filePath), 'utf8'),
    }))
}

function sourceLoader(filePath) {
  if (filePath.endsWith('.astro')) return 'ts'
  if (filePath.endsWith('.tsx')) return 'tsx'
  if (filePath.endsWith('.ts') || filePath.endsWith('.mts') || filePath.endsWith('.cts')) {
    return 'ts'
  }
  if (filePath.endsWith('.jsx')) return 'jsx'
  return 'js'
}

function sourceForImportScan(file) {
  if (!file.path.endsWith('.astro')) {
    return file.source.replace(/^#![^\n]*(?:\n|$)/, '')
  }

  const sections = []
  const frontmatter = file.source.match(
    /^\uFEFF?---[\t ]*\r?\n([\s\S]*?)\r?\n---(?:[\t ]*\r?\n|[\t ]*$)/,
  )
  if (frontmatter) sections.push(frontmatter[1])

  const markup = frontmatter ? file.source.slice(frontmatter[0].length) : file.source
  for (const script of markup.matchAll(
    /<!--[\s\S]*?(?:-->|$)|<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (script[2] !== undefined && isJavaScriptScript(script[1])) sections.push(script[2])
  }

  return sections.join('\n')
}

function isJavaScriptScript(attributes) {
  const typeAttribute = attributes.match(
    /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i,
  )
  if (!typeAttribute) return true

  const type = (typeAttribute[1] ?? typeAttribute[2] ?? typeAttribute[3]).toLowerCase()
  return type === '' || type === 'module' || javaScriptMimeTypes.has(type)
}

function addReverseDependencies(reverseConsumers, consumerName, manifest) {
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
  ]) {
    for (const [declaredName, specifier] of Object.entries(manifest?.[field] ?? {})) {
      const dependencyName = npmAliasTarget(specifier) ?? declaredName
      const consumers = reverseConsumers.get(dependencyName) ?? new Set()
      consumers.add(consumerName)
      reverseConsumers.set(dependencyName, consumers)
    }
  }
}

function packageNameFromResolution(resolution) {
  if (typeof resolution !== 'string') return undefined
  const versionSeparator = resolution.lastIndexOf('@')
  if (versionSeparator <= 0) return undefined
  return resolution.slice(0, versionSeparator)
}

function npmAliasTarget(specifier) {
  if (typeof specifier !== 'string' || !specifier.startsWith('npm:')) return undefined
  const target = specifier.slice('npm:'.length)
  const versionSeparator = target.lastIndexOf('@')
  if (target.startsWith('@')) {
    return versionSeparator > target.indexOf('/') ? target.slice(0, versionSeparator) : target
  }
  return versionSeparator > 0 ? target.slice(0, versionSeparator) : target
}

function sameValues(actual, expected) {
  if (!actual || actual.size !== expected.length) return false
  return expected.every((value) => actual.has(value))
}

function formatValues(values) {
  return values && values.size > 0 ? [...values].sort().join(', ') : 'none'
}

function advisoryIdFromFinding(finding) {
  if (typeof finding?.url === 'string') {
    const match = finding.url.match(/(GHSA-[\w-]+)\/?$/i)
    if (match) return match[1]
  }
  return `unknown-${finding?.id ?? 'advisory'}`
}

function isExpired(expiresOn, now) {
  const finalReviewMoment = new Date(`${expiresOn}T23:59:59.999Z`)
  return Number.isNaN(finalReviewMoment.valueOf()) || now > finalReviewMoment
}

function uniqueAccepted(accepted) {
  return [
    ...new Map(
      accepted.map((entry) => [`${entry.packageName}:${entry.advisoryId}`, entry]),
    ).values(),
  ]
}

if (import.meta.main) runDependencyAudit()
