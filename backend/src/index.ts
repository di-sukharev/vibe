import { createApp } from './app'
import { createBackendRuntime } from './runtime'
import { createSignalShutdown, shutdownBackend } from './shutdown'

const runtime = createBackendRuntime()
const app = createApp({
  backgroundTasks: runtime.backgroundTasks,
  emailDelivery: runtime.emailDelivery,
  env: runtime.env,
  prisma: runtime.prisma,
  privateStorage: runtime.privateStorage,
})

const server = Bun.serve({
  port: runtime.env.PORT,
  fetch: app.fetch,
})

console.log(`Backend listening on ${server.url}`)

const handleSignal = createSignalShutdown(async (signal) => {
  console.log(`Backend received ${signal}; shutting down`)
  await shutdownBackend(
    server,
    runtime,
    runtime.env.SHUTDOWN_GRACE_SECONDS * 1000,
  )
})

process.on('SIGINT', () => handleSignal('SIGINT'))
process.on('SIGTERM', () => handleSignal('SIGTERM'))
