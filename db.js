const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN || '';

if (!url) {
  throw new Error('TURSO_DATABASE_URL environment variable is not set');
}

const client = createClient({ url, authToken });

async function initDb() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      points INTEGER DEFAULT 10000,
      is_admin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team1 TEXT NOT NULL,
      team2 TEXT NOT NULL,
      match_time DATETIME,
      status TEXT DEFAULT 'upcoming',
      winner INTEGER DEFAULT NULL,
      tournament_name TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      match_id INTEGER NOT NULL,
      bet_team INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      payout INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (match_id) REFERENCES matches(id)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'upcoming',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS tournament_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL,
      team_name TEXT NOT NULL,
      eliminated INTEGER DEFAULT 0,
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS tournament_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tournament_id INTEGER NOT NULL,
      prediction_type TEXT NOT NULL,
      team_id INTEGER NOT NULL,
      bet_amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      payout INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
      FOREIGN KEY (team_id) REFERENCES tournament_teams(id)
    )
  `);

  const adminResult = await client.execute('SELECT id FROM users WHERE is_admin = 1');
  if (adminResult.rows.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await client.execute({
      sql: 'INSERT INTO users (username, password, points, is_admin) VALUES (?, ?, ?, ?)',
      args: ['admin', hash, 999999, 1]
    });
  }
}

async function queryAll(sql, params = []) {
  const result = await client.execute({ sql, args: params });
  return result.rows;
}

async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

async function runSql(sql, params = []) {
  const result = await client.execute({ sql, args: params });
  return {
    lastInsertRowid: Number(result.lastInsertRowid) || 0,
    changes: result.rowsAffected || 0
  };
}

module.exports = { initDb, queryAll, queryOne, runSql };
