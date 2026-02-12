const { MongoClient } = require('mongodb');

let cachedClient = null;
let cachedDb = null;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

function handleOptions() {
  return { statusCode: 204, headers, body: '' };
}

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('gotrocks');
  cachedClient = client;
  cachedDb = db;
  return { client, db };
}

module.exports = { connectToDatabase, headers, handleOptions };
