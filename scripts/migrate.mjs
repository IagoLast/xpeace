import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";
import { readFile, readdir } from "node:fs/promises";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL)
  throw new Error("Configura DATABASE_URL en .env.local");
const sql = neon(process.env.DATABASE_URL);
const directory = new URL("../db/", import.meta.url);
// Migrations are deliberately idempotent; never run them as part of a build.
for (const file of (await readdir(directory))
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  const migration = await readFile(new URL(file, directory), "utf8");
  await sql.transaction(
    migration
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((statement) => sql.query(statement)),
  );
}
console.log("Base de datos preparada.");
