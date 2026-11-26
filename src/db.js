const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    })
  : null;

async function query(text, params) {
  if (!pool) throw new Error('Banco de dados não configurado. Defina DATABASE_URL.');
  return pool.query(text, params);
}

async function initDb() {
  if (!pool) {
    console.warn('DATABASE_URL ausente: banco de dados não inicializado.');
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      concept TEXT DEFAULT '',
      audience TEXT DEFAULT '3-8 anos',
      style TEXT DEFAULT 'Animação 3D colorida',
      script JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS generations (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      task_id TEXT,
      prompt TEXT,
      result_url TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS projects_user_created_idx ON projects(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS generations_user_created_idx ON generations(user_id, created_at DESC);
  `);
}

module.exports = { pool, query, initDb };
