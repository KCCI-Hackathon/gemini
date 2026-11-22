import { expect, it } from "vitest";
import { openDb } from "@/lib/db/sqlite";

it("opens an in-memory database with foreign keys enabled", () => {
  const db = openDb(":memory:");
  try {
    expect(db.prepare("SELECT 1 AS x").get()).toEqual({x: 1});
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({foreign_keys: 1});
  } finally { db.close(); }
});
