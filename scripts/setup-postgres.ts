import { initializePostgres, closePostgres } from "../lib/postgres";
try {
  await initializePostgres();
  console.log("Private PostgreSQL records table and indexes are ready.");
} finally {
  await closePostgres();
}
