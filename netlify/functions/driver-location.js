/**
 * driver-location.js — Driver GPS Tracking
 *
 * Collection: driver_locations (shared gotrocks database)
 *
 * POST /driver-location  — upsert driver's latest GPS position
 * GET  /driver-location  — return all driver positions updated within last 2 hours
 */

const { connectToDatabase, headers, handleOptions } = require('./utils/db');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  try {
    const { db } = await connectToDatabase();
    const col = db.collection('driver_locations');

    // ─── GET — All recent driver locations ────────────
    if (event.httpMethod === 'GET') {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const locations = await col.find({ timestamp: { $gte: twoHoursAgo } }).toArray();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, locations })
      };
    }

    // ─── POST — Upsert driver position ────────────────
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);

      if (!body.driverId || body.lat == null || body.lng == null) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'driverId, lat, lng required' }) };
      }

      await col.updateOne(
        { driverId: body.driverId },
        {
          $set: {
            driverId: body.driverId,
            driverName: body.driverName || null,
            lat: parseFloat(body.lat),
            lng: parseFloat(body.lng),
            heading: body.heading != null ? parseFloat(body.heading) : null,
            speed: body.speed != null ? parseFloat(body.speed) : null,
            timestamp: new Date()
          }
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
    console.error('Driver location API error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
