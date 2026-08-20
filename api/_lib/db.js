import { neon } from '@neondatabase/serverless'
import { getDatabaseUrl } from './config.js'

let database

export function getDatabase() {
  if (!database) database = neon(getDatabaseUrl())
  return database
}
