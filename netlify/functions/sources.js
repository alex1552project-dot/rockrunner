/**
 * sources.js — Delivery Sources / Pickup Locations API
 *
 * Collection: delivery_sources
 *   { name, address, updatedAt, createdAt }
 *
 * GET  /sources          — list all saved sources (sorted by name)
 * POST /sources          — upsert a source by name
 *   body: { name: "Supplier X", address: "123 Main St, Conroe TX" }
 */

const { connectToDatabase, headers, handleOptions } = require('./utils/db');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  try {
    const { db } = await connectToDatabase();
    const sources = db.collection('delivery_sources');

    // ─── GET — list all sources ───────────────────────────────
    if (event.httpMethod === 'GET') {
      const all = await sources.find({}).sort({ name: 1 }).toArray();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, sources: all })
      };
    }

    // ─── POST — upsert a source ───────────────────────────────
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);
      if (!body.name) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'name required' }) };
      }
      await sources.updateOne(
        { name: body.name },
        {
          $set: { name: body.name, address: body.address || '', updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true }
      );
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    console.error('Sources API error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
