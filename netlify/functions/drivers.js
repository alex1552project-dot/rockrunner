/**
 * drivers.js — Read-only driver list for RockRunner
 *
 * GET /drivers           — list all active drivers
 * GET /drivers?all=true  — list all drivers (active + inactive)
 *
 * Reads from the shared "drivers" collection in the gotrocks database.
 */

const { connectToDatabase, headers, handleOptions } = require('./utils/db');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'GET only' }) };
  }

  try {
    const { db } = await connectToDatabase();
    const p = event.queryStringParameters || {};
    const query = p.all === 'true' ? {} : { active: true };

    const drivers = await db.collection('drivers').find(query).sort({ name: 1 }).toArray();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, drivers })
    };
  } catch (err) {
    console.error('Drivers API error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
