import { createApp } from './app'
import { createBackendRuntime } from './runtime'
import { stopServerGracefully } from './shutdown'

const runtime = createBackendRuntime()
const app = createApp({ env: runtime.env, prisma: runtime.prisma })

const server = Bun.serve({
  port: runtime.env.PORT,
  fetch: app.fetch,
})

console.log(`Backend listening on ${server.url}`)

let shuttingDown = false

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true

  console.log(`Backend received ${signal}; shutting down`)
  await stopServerGracefully(server, runtime.env.SHUTDOWN_GRACE_SECONDS * 1000)
  await runtime.close()
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
