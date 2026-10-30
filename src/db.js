// Data layer: SQLite via Node's built-in node:sqlite (no native build step needed)
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');

function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('requester','technician','admin')),
      salt TEXT NOT NULL,
      hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      location TEXT NOT NULL,
      description TEXT NOT NULL,
      urgency TEXT NOT NULL,
      safety_risk INTEGER NOT NULL DEFAULT 0,
      report_count INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL,
      priority_label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open',
      technician_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reporters (
      request_id INTEGER NOT NULL REFERENCES requests(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      PRIMARY KEY (request_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES requests(id),
      status TEXT NOT NULL,
      note TEXT,
      actor_id INTEGER NOT NULL REFERENCES users(id),
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_requests_dup ON requests(category, location, status);
  `);
  return db;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(password, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function addUser(db, { username, name, role, password }) {
  const { salt, hash } = hashPassword(password);
  const r = db.prepare('INSERT INTO users (username,name,role,salt,hash) VALUES (?,?,?,?,?)').run(username, name, role, salt, hash);
  return Number(r.lastInsertRowid);
}
function seedUsers(db) {
  addUser(db, { username: 'student1', name: 'Ayesha (Student)', role: 'requester', password: 'Pass1234' });
  addUser(db, { username: 'student2', name: 'Bilal (Student)', role: 'requester', password: 'Pass1234' });
  addUser(db, { username: 'tech1', name: 'Imran (Technician)', role: 'technician', password: 'Pass1234' });
  addUser(db, { username: 'admin1', name: 'Dr. Sana (Admin)', role: 'admin', password: 'Pass1234' });
}
module.exports = { openDb, addUser, seedUsers, verifyPassword };
