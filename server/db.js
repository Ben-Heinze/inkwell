import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), 'seed');

// The database holds private journal entries, so it lives under XDG data by
// default — never inside the project tree (which nix may copy to the store).
export function defaultDbPath() {
  if (process.env.INKWELL_DB) return process.env.INKWELL_DB;
  const dataHome =
    process.env.XDG_DATA_HOME ||
    (process.platform === 'win32' && process.env.LOCALAPPDATA) ||
    join(homedir(), '.local', 'share');
  return join(dataHome, 'inkwell', 'inkwell.db');
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL UNIQUE,
  pos TEXT NOT NULL,
  definition TEXT NOT NULL,
  example TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  text TEXT NOT NULL,
  image TEXT
);
CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'seed',
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  min_words INTEGER,
  required_words TEXT,
  image TEXT
);
CREATE TABLE IF NOT EXISTS daily_prompts (
  date TEXT PRIMARY KEY,
  prompt_id INTEGER NOT NULL REFERENCES prompts(id)
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('journal','daily','challenge')),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  entry_date TEXT NOT NULL,
  prompt_id INTEGER REFERENCES prompts(id),
  challenge_id INTEGER REFERENCES challenges(id),
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  wordbank_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, entry_date);
CREATE TABLE IF NOT EXISTS words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  pos TEXT NOT NULL DEFAULT '',
  definition TEXT NOT NULL DEFAULT '',
  example TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'custom',
  catalog_id INTEGER REFERENCES catalog_words(id),
  mastery REAL NOT NULL DEFAULT 0,
  mastery_updated_at TEXT NOT NULL,
  times_used INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  added_at TEXT NOT NULL,
  UNIQUE(user_id, word)
);
CREATE TABLE IF NOT EXISTS xp_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xp_user ON xp_events(user_id, created_at);
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS achievements (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, achievement_id)
);
`;

export function openDb(path = defaultDbPath()) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

// Load/refresh seed content. Upserts by stable key so edits to the seed files
// propagate on restart without duplicating rows.
function seed(db) {
  const read = (name) => JSON.parse(readFileSync(join(SEED_DIR, name), 'utf8'));
  const words = read('words.json');
  const prompts = read('prompts.json');
  const challenges = read('challenges.json');

  db.exec('BEGIN');
  try {
    const insWord = db.prepare(
      `INSERT INTO catalog_words (word, pos, definition, example) VALUES (?, ?, ?, ?)
       ON CONFLICT(word) DO UPDATE SET pos = excluded.pos, definition = excluded.definition, example = excluded.example`,
    );
    for (const w of words) insWord.run(w.word, w.pos, w.definition, w.example);

    const insPrompt = db.prepare(
      `INSERT INTO prompts (key, text, image) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET text = excluded.text, image = excluded.image`,
    );
    for (const p of prompts) insPrompt.run(p.key, p.text, p.image ?? null);

    const insChallenge = db.prepare(
      `INSERT INTO challenges (key, kind, title, description, min_words, required_words, image) VALUES (?, 'seed', ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET title = excluded.title, description = excluded.description,
         min_words = excluded.min_words, required_words = excluded.required_words, image = excluded.image`,
    );
    for (const c of challenges) {
      insChallenge.run(
        c.key,
        c.title,
        c.description,
        c.minWords ?? null,
        c.requiredWords ? JSON.stringify(c.requiredWords) : null,
        c.image ?? null,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Run fn inside a transaction (nested calls just run inline).
export function tx(db, fn) {
  let began = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    began = true;
  } catch {
    return fn(); // already in a transaction
  }
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    if (began) db.exec('ROLLBACK');
    throw err;
  }
}
