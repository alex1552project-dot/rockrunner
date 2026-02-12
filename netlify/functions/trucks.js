/**
 * trucks.js — Fleet & Driver Management
 * 
 * Manages the truck roster and driver assignments.
 * Each truck can have a default driver, but drivers can be reassigned per day.
 * 
 * GET    /trucks              — list all trucks (active by default)
 * GET    /trucks?id=xxx       — single truck
 * POST   /trucks              — add a truck
 * PUT    /trucks              — update a truck
 * DELETE /trucks?id=xxx       — deactivate a truck
 * 
 * GET    /trucks?drivers=true — list all drivers
 */

const { connectToDatabase, headers, handleOptions } = require('./utils/db');
const { ObjectId } = require('mongodb');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  try {
    const { db } = await connectToDatabase();
    const trucksCol = db.collection('trucks');

    // ─── GET ──────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const p = event.queryStringParameters || {};

      // List drivers
      if (p.drivers === 'true') {
        const allTrucks = await trucksCol.find({ active: { $ne: false } }).toArray();
        const drivers = allTrucks
          .filter(t => t.defaultDriver)
          .map(t => ({
            driverId: t.defaultDriver.id || t._id.toString(),
            driverName: t.defaultDriver.name,
            driverPhone: t.defaultDriver.phone || '',
            truckId: t._id,
            truckNumber: t.truckNumber
          }));
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, drivers }) };
      }

      // Single truck
      if (p.id) {
        const truck = await trucksCol.findOne({ _id: new ObjectId(p.id) });
        return { statusCode: truck ? 200 : 404, headers, body: JSON.stringify(truck || { error: 'Not found' }) };
      }

      // All active trucks
      const query = p.all === 'true' ? {} : { active: { $ne: false } };
      const trucks = await trucksCol.find(query).sort({ truckNumber: 1 }).toArray();
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, trucks }) };
    }

    // ─── POST — Add truck ─────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);

      // Check for duplicate truck number
      const existing = await trucksCol.findOne({ truckNumber: body.truckNumber });
      if (existing) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'Truck number already exists' }) };
      }

      const truck = {
        truckNumber: body.truckNumber,
        type: body.type || 'End Dump',            // "End Dump", "Tandem", "Semi"
        capacity: parseFloat(body.capacity) || 24, // tons
        active: true,
        defaultDriver: body.defaultDriver || null, // { name, phone, id }
        notes: body.notes || '',
        createdAt: new Date()
      };

      const result = await trucksCol.insertOne(truck);
      return { statusCode: 201, headers, body: JSON.stringify({ success: true, truckId: result.insertedId }) };
    }

    // ─── PUT — Update truck ───────────────────────────────────
    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body);
      const id = body.id || body._id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) };

      const update = {};
      if (body.truckNumber !== undefined) update.truckNumber = body.truckNumber;
      if (body.type !== undefined) update.type = body.type;
      if (body.capacity !== undefined) update.capacity = parseFloat(body.capacity);
      if (body.active !== undefined) update.active = body.active;
      if (body.defaultDriver !== undefined) update.defaultDriver = body.defaultDriver;
      if (body.notes !== undefined) update.notes = body.notes;

      const result = await trucksCol.updateOne({ _id: new ObjectId(id) }, { $set: update });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, modified: result.modifiedCount }) };
    }

    // ─── DELETE — Deactivate truck ────────────────────────────
    if (event.httpMethod === 'DELETE') {
      const p = event.queryStringParameters || {};
      if (!p.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) };

      const result = await trucksCol.updateOne(
        { _id: new ObjectId(p.id) },
        { $set: { active: false } }
      );
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, deactivated: result.modifiedCount }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    console.error('Trucks API error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
