const tcb = require('@cloudbase/node-sdk');
const bcrypt = require('bcryptjs');

let app = null;
let db = null;

function getApp() {
  if (!app) {
    app = tcb.init({
      env: process.env.TCB_ENV || 'default'
    });
  }
  return app;
}

function getDb() {
  if (!db) {
    db = getApp().database();
  }
  return db;
}

const _ = getDb().command;
const $ = getDb().command.aggregate;

async function initDb() {
  const db = getDb();
  
  const adminResult = await db.collection('users').where({ is_admin: 1 }).limit(1).get();
  
  if (adminResult.data.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await db.collection('users').add({
      username: 'admin',
      password: hash,
      points: 999999,
      is_admin: 1,
      created_at: new Date()
    });
  }
}

async function queryAll(collection, where = {}) {
  const db = getDb();
  const result = await db.collection(collection).where(where).limit(1000).get();
  return result.data;
}

async function queryOne(collection, where) {
  const db = getDb();
  const result = await db.collection(collection).where(where).limit(1).get();
  return result.data.length > 0 ? result.data[0] : null;
}

async function insert(collection, data) {
  const db = getDb();
  const result = await db.collection(collection).add({
    ...data,
    created_at: new Date()
  });
  return { id: result.id };
}

async function update(collection, where, data) {
  const db = getDb();
  const result = await db.collection(collection).where(where).update(data);
  return { changes: result.stats.updated };
}

async function remove(collection, where) {
  const db = getDb();
  const result = await db.collection(collection).where(where).remove();
  return { changes: result.stats.removed };
}

async function updateMany(collection, where, data) {
  const db = getDb();
  let totalUpdated = 0;
  const docs = await db.collection(collection).where(where).limit(1000).get();
  
  for (const doc of docs.data) {
    const result = await db.collection(collection).doc(doc._id).update(data);
    totalUpdated += result.stats.updated;
  }
  
  return { changes: totalUpdated };
}

module.exports = { 
  initDb, 
  queryAll, 
  queryOne, 
  insert, 
  update, 
  remove, 
  updateMany,
  getDb,
  _: getDb().command
};
