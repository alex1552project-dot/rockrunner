/**
 * rocky-apply.js — Apply Rocky's Assignment Plan
 *
 * POST /rocky-apply
 * Body: {
 *   date: "YYYY-MM-DD",
 *   assignments: [{ deliveryId, truckId, truckNumber, stopOrder, routeSource, driverId, driverName, timeWindow, reasoning }]
 * }
 *
 * Writes all assignments to MongoDB — sets each delivery status to SCHEDULED.
 * Called by the dispatch board after dispatcher reviews and confirms Rocky's plan.
 */

const { connectToDatabase, headers, handleOptions } = require('./utils/db');
const { ObjectId } = require('mongodb');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { date, assignments } = body;

    if (!date || !Array.isArray(assignments) || !assignments.length) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'date and assignments[] required' })
      };
    }

    const { db } = await connectToDatabase();
    const now = new Date().toISOString();

    let applied = 0;
    const errors = [];

    for (const a of assignments) {
      try {
        const result = await db.collection('delivery_schedule').updateOne(
          { _id: new ObjectId(a.deliveryId) },
          {
            $set: {
              truckId: a.truckId,
              truckNumber: a.truckNumber,
              stopOrder: a.stopOrder || 1,
              status: 'SCHEDULED',
              routeSource: a.routeSource || 'rocky',
              driverId: a.driverId || null,
              driverName: a.driverName || null,
              timeWindow: a.timeWindow || null,
              rockyReasoning: a.reasoning || null,
              updatedAt: now,
              updatedBy: 'rocky'
            }
          }
        );
        if (result.modifiedCount > 0) applied++;
      } catch (e) {
        errors.push({ deliveryId: a.deliveryId, error: e.message });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, applied, total: assignments.length, errors })
    };

  } catch (err) {
    console.error('Rocky Apply error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
