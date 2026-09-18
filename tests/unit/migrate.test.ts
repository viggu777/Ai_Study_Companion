import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { migrationVersion, sortMigrationFiles, parseDotEnv } from "../../scripts/migrate.mjs";

const ROOT = path.resolve(__dirname, "../..");

describe("migration runner helpers", () => {
  it("versions files by basename", () => {
    expect(migrationVersion("/x/db/schema/007_practice.sql")).toBe("007_practice.sql");
    expect(migrationVersion("001_initial_schema.sql")).toBe("001_initial_schema.sql");
  });

  it("sorts migrations in apply order", () => {
    const shuffled = [
      path.join(ROOT, "db/schema/007_practice.sql"),
      path.join(ROOT, "db/schema/001_initial_schema.sql"),
      path.join(ROOT, "db/schema/006_embeddings_gemini_768.sql"),
      path.join(ROOT, "db/schema/002_retrieve.sql"),
    ];
    const sorted = sortMigrationFiles(shuffled).map((f) => path.basename(f));
    expect(sorted).toEqual([
      "001_initial_schema.sql",
      "002_retrieve.sql",
      "006_embeddings_gemini_768.sql",
      "007_practice.sql",
    ]);
  });

  it("parses .env files without overriding semantics", () => {
    const parsed = parseDotEnv('# comment\nDATABASE_URL="postgres://u:p@host:5432/db"\nEMPTY=\nNOEQUALS\nFOO=bar baz\n');
    expect(parsed.DATABASE_URL).toBe("postgres://u:p@host:5432/db");
    expect(parsed.EMPTY).toBe("");
    expect(parsed.FOO).toBe("bar baz");
    expect(parsed).not.toHaveProperty("NOEQUALS");
  });

  it("discovers every migration file including 007", () => {
    const files = fs.readdirSync(path.join(ROOT, "db/schema")).filter((f) => f.endsWith(".sql"));
    expect(files).toContain("001_initial_schema.sql");
    expect(files).toContain("007_practice.sql");
    // Runner + package script exist (the automated path the UI points at).
    expect(fs.existsSync(path.join(ROOT, "scripts/migrate.mjs"))).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.migrate).toContain("scripts/migrate.mjs");
  });
});
