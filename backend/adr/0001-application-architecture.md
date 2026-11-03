# 0001: Application architecture

Status: Accepted. Updated: 2026-11-01.

The template has three applications. The website builds public pages as static HTML. The webapp renders signed-in pages in the browser. Only the backend can grant access, set prices, or confirm payments, so client code and static pages never make these decisions. The cost is that public content changes need a rebuild, and the webapp needs JavaScript.

Zod schemas in `packages/contracts` define all API requests, responses, and errors. The backend validates with these schemas, and the clients use the same schemas and types. Thus the applications cannot disagree about the API. The cost is that a contract change can need a coordinated release of the backend and the clients.

PostgreSQL keeps all data and all durable background tasks in an outbox. Each additional service, such as a broker or a cache, adds operational work. Add one only when measurements show that PostgreSQL is not sufficient. The cost is that an outbox task can run more than once, so each handler must make a repeated run harmless.

The backend uses Prisma 7. On 2026-11-01, Prisma 8 and Drizzle 1.0 were only release candidates, and Prisma 8 has a different API. A change of ORM needs a new record.

The frontends build to static files. The backend builds to one Docker image for the API, the scheduler, the jobs, and the database migration. Thus the template does not depend on a hosting provider. The cost is that the derived project must supply hosting, secrets, routing, backups, and release coordination.

Deployment applies migrations before it replaces the application. Thus the running version must work with the new schema, and a breaking schema change needs several compatible releases.
