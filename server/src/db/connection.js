const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config/env');

let dbInstance = null;

function getDb(customPath = null) {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const dbPath = customPath || config.databasePath;
  
  if (dbPath !== ':memory:') {
    const dir = path.dirname(path.resolve(process.cwd(), dbPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath === ':memory:' ? ':memory:' : path.resolve(process.cwd(), dbPath));
  
  // Enable foreign keys and WAL mode for high concurrency and safety
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }

  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

function closeDb() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // Ignore if already closed
    }
    dbInstance = null;
  }
}

module.exports = {
  getDb,
  closeDb
};
