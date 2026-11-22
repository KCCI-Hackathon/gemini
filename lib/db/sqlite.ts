import { DatabaseSync } from "node:sqlite";

export function openDb(path: string, readOnly = false): DatabaseSync {
  const db = new DatabaseSync(path, {readOnly});
  db.exec("PRAGMA foreign_keys=ON");
  return db;
}
