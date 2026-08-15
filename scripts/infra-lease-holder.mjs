#!/usr/bin/env node

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'

const owner = required('INFRA_LEASE_OWNER')
const readySignal = required('INFRA_LEASE_READY_SIGNAL')
const releaseSignal = required('INFRA_LEASE_RELEASE_SIGNAL')
const parentPid = Number(required('INFRA_LEASE_PARENT_PID'))

if (!Number.isSafeInteger(parentPid) || parentPid <= 1) {
  throw new Error('INFRA_LEASE_PARENT_PID must identify the wrapper process')
}

writeFileSync(readySignal, owner, { mode: 0o600 })

while (true) {
  if (!processExists(parentPid)) process.exit(0)
  if (existsSync(releaseSignal)) {
    if (readFileSync(releaseSignal, 'utf8') === owner) break
    // A different process cannot release this owner. Remove the invalid signal and keep the
    // Terraform apply (and therefore its remote state lock) alive.
    unlinkSync(releaseSignal)
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000))
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
