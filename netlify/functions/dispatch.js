/**
 * dispatch.js — Delivery Lifecycle API
 * 
 * Collections used:
 *   delivery_schedule  — all delivery records (any status)
 *   trucks             — fleet roster
 *   products           — material catalog (shared with TGR)
 *   inventory          — stock levels (depleted on DELIVERED)
 * 
 * Statuses:
 *   UNASSIGNED  — order placed, no truck yet
 *   SCHEDULED   — truck assigned, customer notified (night before)
 *   EN_ROUTE    — driver tapped "En Route" (real-time SMS fired)
 *   DELIVERED   — driver confirmed + photo uploaded
 *   CANCELLED   — order cancelled before delivery
 * 
 * Endpoints:
 *   GET    /dispatch                       — list deliveries (filter by date, status, truck, driver)
 *   GET    /dispatch?id=xxx                — single delivery by ID
 *   POST   /dispatch                       — create new delivery (from TGR checkout or yard sale)
 *   PUT    /dispatch                       — update delivery (assign truck, change status, etc.)
 *   PUT    /dispatch  {action:"finalize"}  — batch finalize tomorrow's schedule (triggers SMS)
 *   DELETE /dispatch?id=xxx                — cancel a delivery
 */

const { connectToDatabase, headers, handleOptions } = require('./utils/db');
const { ObjectId } = require('mongodb');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  try {
    const { db } = await connectToDatabase();
    const deliveries = db.collection('delivery_schedule');

    // ─── GET — Query deliveries ───────────────────────────────
    if (event.httpMethod === 'GET') {
      const p = event.queryStringParameters || {};

      // Single delivery by ID
      if (p.id) {
        const doc = await deliveries.findOne({ _id: new ObjectId(p.id) });
        return { statusCode: doc ? 200 : 404, headers, body: JSON.stringify(doc || { error: 'Not found' }) };
      }

      const query = {};

      // Date range filter
      if (p.date) {
        query.deliveryDate = p.date; // "2026-02-13"
      } else if (p.startDate && p.endDate) {
        query.deliveryDate = { $gte: p.startDate, $lte: p.endDate };
      }

      // Status filter (single or comma-separated)
      if (p.status) {
        const statuses = p.status.split(',');
        query.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
      }

      // Truck filter
      if (p.truckId) query.truckId = p.truckId;

      // Driver filter (for driver app)
      if (p.driverId) query.driverId = p.driverId;

      // Source filter
      if (p.source) query.source = p.source;

      const results = await deliveries
        .find(query)
        .sort({ deliveryDate: 1, timeWindow: 1, stopOrder: 1 })
        .toArray();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, deliveries: results, count: results.length })
      };
    }

    // ─── POST — Create new delivery ──────────────────────────
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);

      const newDelivery = {
        // Order info
        source: body.source || 'Yard Sale',         // "Texas Got Rocks", "Yard Sale", "T&C Materials"
        orderId: body.orderId || null,               // TGR order ID or null for yard sales
        
        // Customer
        customerName: body.customerName,
        customerPhone: body.customerPhone || '',
        customerEmail: body.customerEmail || '',
        
        // Delivery address
        deliveryAddress: body.deliveryAddress || '',
        deliveryCity: body.deliveryCity || '',
        deliveryState: body.deliveryState || 'TX',
        deliveryZip: body.deliveryZip || '',
        deliveryLat: body.deliveryLat || null,
        deliveryLng: body.deliveryLng || null,
        
        // Material
        productId: body.productId || null,
        materialName: body.materialName,
        quantity: parseFloat(body.quantity) || 0,     // tons
        unit: body.unit || 'tons',
        
        // Scheduling
        deliveryDate: body.deliveryDate,              // "2026-02-13" (requested or selected)
        timeWindow: body.timeWindow || null,          // "10:00 AM - 12:00 PM" (set by dispatcher)
        hour: body.hour || null,                      // 10 (numeric hour, for calendar slot)
        
        // Assignment (set by dispatcher)
        truckId: body.truckId || null,
        truckNumber: body.truckNumber || null,
        driverId: body.driverId || null,
        driverName: body.driverName || null,
        stopOrder: body.stopOrder || null,            // 1, 2, 3... (position in truck route)
        
        // Status lifecycle
        status: body.truckId ? 'SCHEDULED' : 'UNASSIGNED',
        
        // Timestamps
        createdAt: new Date(),
        updatedAt: new Date(),
        scheduledAt: body.truckId ? new Date() : null,
        enRouteAt: null,
        deliveredAt: null,
        cancelledAt: null,
        
        // Proof of delivery
        deliveryPhoto: null,
        deliveryNotes: body.deliveryNotes || '',
        
        // Notifications
        scheduleSmsSent: false,
        scheduleEmailSent: false,
        enRouteSmsSent: false,
        enRouteEmailSent: false,
        deliveredSmsSent: false,
        deliveredEmailSent: false,
        
        // Audit trail
        statusHistory: [{
          status: body.truckId ? 'SCHEDULED' : 'UNASSIGNED',
          timestamp: new Date(),
          updatedBy: body.createdBy || 'system',
          notes: 'Order created'
        }],
        createdBy: body.createdBy || 'system'
      };

      const result = await deliveries.insertOne(newDelivery);

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          success: true,
          deliveryId: result.insertedId,
          status: newDelivery.status
        })
      };
    }

    // ─── PUT — Update delivery ───────────────────────────────
    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body);

      // ── Batch finalize: lock tomorrow's schedule + trigger SMS ──
      if (body.action === 'finalize') {
        const date = body.date; // "2026-02-13"
        if (!date) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'date required for finalize' }) };
        }

        // Find all UNASSIGNED deliveries that now have trucks assigned for this date
        // (dispatcher already dragged them to trucks but hasn't finalized)
        const result = await deliveries.updateMany(
          { deliveryDate: date, status: 'SCHEDULED', scheduleSmsSent: false },
          {
            $set: { scheduleSmsSent: true, updatedAt: new Date() },
            $push: {
              statusHistory: {
                status: 'FINALIZED',
                timestamp: new Date(),
                updatedBy: body.updatedBy || 'dispatcher',
                notes: 'Schedule finalized — SMS queued'
              }
            }
          }
        );

        // Return the deliveries that need SMS (caller handles Brevo)
        const toNotify = await deliveries.find({
          deliveryDate: date,
          status: 'SCHEDULED',
          $or: [{ customerPhone: { $ne: '' } }, { customerEmail: { $ne: '' } }]
        }).toArray();

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            finalized: result.modifiedCount,
            toNotify: toNotify.map(d => ({
              id: d._id,
              customerName: d.customerName,
              customerPhone: d.customerPhone,
              customerEmail: d.customerEmail || '',
              materialName: d.materialName,
              quantity: d.quantity,
              timeWindow: d.timeWindow,
              deliveryDate: d.deliveryDate
            }))
          })
        };
      }

      // ── Single delivery update ──
      const id = body.id || body._id;
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) };
      }

      const update = { $set: { updatedAt: new Date() }, $push: {} };
      const historyEntry = { timestamp: new Date(), updatedBy: body.updatedBy || 'system' };

      // Assign truck (dispatcher drags to truck)
      if (body.truckId !== undefined) {
        update.$set.truckId = body.truckId;
        update.$set.truckNumber = body.truckNumber || null;
        update.$set.driverId = body.driverId || null;
        update.$set.driverName = body.driverName || null;
        if (body.truckId && body.status !== 'UNASSIGNED') {
          update.$set.status = 'SCHEDULED';
          update.$set.scheduledAt = new Date();
          historyEntry.status = 'SCHEDULED';
          historyEntry.notes = `Assigned to truck ${body.truckNumber || body.truckId}`;
        }
      }

      // Update time window
      if (body.timeWindow !== undefined) {
        update.$set.timeWindow = body.timeWindow;
        update.$set.hour = body.hour || null;
      }

      // Update stop order
      if (body.stopOrder !== undefined) {
        update.$set.stopOrder = body.stopOrder;
      }

      // Status change
      if (body.status) {
        update.$set.status = body.status;
        historyEntry.status = body.status;
        historyEntry.notes = body.notes || `Status changed to ${body.status}`;

        if (body.status === 'EN_ROUTE') {
          update.$set.enRouteAt = new Date();
        }
        if (body.status === 'DELIVERED') {
          update.$set.deliveredAt = new Date();
          if (body.deliveryPhoto) {
            update.$set.deliveryPhoto = body.deliveryPhoto;
          }
          if (body.deliveryNotes) {
            update.$set.deliveryNotes = body.deliveryNotes;
          }
        }
        if (body.status === 'CANCELLED') {
          update.$set.cancelledAt = new Date();
        }
      }

      // SMS tracking
      if (body.enRouteSmsSent) update.$set.enRouteSmsSent = true;

      // Push history entry if it has a status
      if (historyEntry.status) {
        update.$push.statusHistory = historyEntry;
      } else {
        delete update.$push;
      }

      const result = await deliveries.updateOne(
        { _id: new ObjectId(id) },
        update
      );

      // ── If DELIVERED, deplete inventory ──
      if (body.status === 'DELIVERED') {
        const delivery = await deliveries.findOne({ _id: new ObjectId(id) });
        if (delivery && delivery.productId) {
          const inventory = db.collection('inventory');
          await inventory.updateOne(
            { productId: delivery.productId },
            { $inc: { quantity: -(delivery.quantity) } }
          );
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, modified: result.modifiedCount })
      };
    }

    // ─── DELETE — Cancel delivery ─────────────────────────────
    if (event.httpMethod === 'DELETE') {
      const p = event.queryStringParameters || {};
      if (!p.id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) };
      }

      const result = await deliveries.updateOne(
        { _id: new ObjectId(p.id) },
        {
          $set: { status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() },
          $push: {
            statusHistory: {
              status: 'CANCELLED',
              timestamp: new Date(),
              updatedBy: p.by || 'admin',
              notes: p.reason || 'Cancelled'
            }
          }
        }
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, cancelled: result.modifiedCount })
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    console.error('Dispatch API error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
