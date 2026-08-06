import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Only `npm run migrate` needs this. `npm run db:generate` produces SQL without connecting,
    // which is all M0 requires — there is no database in M0.
    url: process.env.DATABASE_URL ?? '',
  },
})
