const { Pool } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const pool = new Pool({ connectionString: databaseUrl });

function convertPlaceholders(sqlStr) {
  let idx = 0;
  return sqlStr.replace(/\?/g, () => `$${++idx}`);
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      points INTEGER DEFAULT 10000,
      is_admin INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      team1 TEXT NOT NULL,
      team2 TEXT NOT NULL,
      match_time TIMESTAMP,
      status TEXT DEFAULT 'upcoming',
      winner INTEGER DEFAULT NULL,
      tournament_name TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      match_id INTEGER NOT NULL,
      bet_team INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      payout INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'upcoming',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournament_teams (
      id SERIAL PRIMARY KEY,
      tournament_id INTEGER NOT NULL,
      team_name TEXT NOT NULL,
      eliminated INTEGER DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournament_predictions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      tournament_id INTEGER NOT NULL,
      prediction_type TEXT NOT NULL,
      team_id INTEGER NOT NULL,
      bet_amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      payout INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const adminResult = await pool.query('SELECT id FROM users WHERE is_admin = 1');
  if (adminResult.rows.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await pool.query('INSERT INTO users (username, password, points, is_admin) VALUES ($1, $2, $3, $4)', ['admin', hash, 999999, 1]);
  }
}

async function queryAll(sqlStr, params = []) {
  const finalSql = convertPlaceholders(sqlStr);
  const result = await pool.query(finalSql, params);
  return result.rows;
}

async function queryOne(sqlStr, params = []) {
  const rows = await queryAll(sqlStr, params);
  return rows.length > 0 ? rows[0] : null;
}

async function runSql(sqlStr, params = []) {
  const finalSql = convertPlaceholders(sqlStr);
  const isInsert = /^\s*INSERT/i.test(finalSql);
  const sqlWithReturning = isInsert && !/RETURNING/i.test(finalSql)
    ? finalSql.replace(/;?\s*$/, ' RETURNING id')
    : finalSql;
  const result = await pool.query(sqlWithReturning, params);
  let lastInsertRowid = 0;
  if (isInsert && result.rows && result.rows.length > 0) {
    lastInsertRowid = result.rows[0].id;
  }
  return {
    lastInsertRowid: Number(lastInsertRowid) || 0,
    changes: result.rowCount || 0
  };
}

module.exports = { initDb, queryAll, queryOne, runSql };
