/**
 * driver-notify.js — Internal Driver Notification Handler
 *
 * Called fire-and-forget by dispatch.js after any schedule change.
 * Writes to driver_notifications collection + sends Brevo SMS.
 *
 * Only fires for today or tomorrow (America/Chicago).
 *
 * POST /driver-notify
 * { truckId, deliveryId, customerName, deliveryDate, type, extraDetail? }
 * Types: LOAD_ADDED | LOAD_CANCELLED | DATE_CHANGED | TRUCK_REASSIGNED
 */

const { connectToDatabase, headers, handleOptions } = require('./utils/db');
const { ObjectId } = require('mongodb');

const BREVO_API_KEY = process.env.BREVO_API_KEY;

// ─── Date helpers ────────────────────────────────────────────
function getChiDate(offset = 0) {
  const chi = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  if (offset) chi.setDate(chi.getDate() + offset);
  const pad = n => String(n).padStart(2, '0');
  return `${chi.getFullYear()}-${pad(chi.getMonth() + 1)}-${pad(chi.getDate())}`;
}

// ─── Message builders ────────────────────────────────────────
const MESSAGES = {
  LOAD_ADDED:       (c, d)    => `New load added: ${c} on ${d}`,
  LOAD_CANCELLED:   (c, d)    => `Load cancelled: ${c} on ${d}`,
  DATE_CHANGED:     (c, newD) => `Delivery rescheduled: ${c} moved to ${newD}`,
  TRUCK_REASSIGNED: (c, d)    => `Load reassigned to your truck: ${c} on ${d}`
};

const SMS_ACTION = {
  LOAD_ADDED:       'New load added',
  LOAD_CANCELLED:   'Load removed',
  DATE_CHANGED:     'Delivery rescheduled',
  TRUCK_REASSIGNED: 'Load assigned to you'
};

// ─── Brevo SMS ───────────────────────────────────────────────
async function sendSMS(phone, message) {
  if (!BREVO_API_KEY || !phone) return;
  let formatted = phone.replace(/[^\d+]/g, '');
  if (!formatted.startsWith('+')) {
    formatted = (formatted.startsWith('1') && formatted.length === 11)
      ? '+' + formatted
      : '+1' + formatted;
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/transactionalSMS/send', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'transactional',
        unicodeEnabled: false,
        sender: 'RockRunner',
        recipient: formatted,
        content: message
      })
    });
    console.log('[driver-notify] SMS', formatted, res.ok ? 'sent' : 'failed');
  } catch (err) {
    console.error('[driver-notify] SMS error:', err.message);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { truckId, deliveryId, customerName, deliveryDate, type, extraDetail } = JSON.parse(event.body);

    if (!truckId || !type || !deliveryDate) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'truckId, type, deliveryDate required' }) };
    }

    // Only notify for today / tomorrow
    const today    = getChiDate(0);
    const tomorrow = getChiDate(1);
    if (deliveryDate !== today && deliveryDate !== tomorrow) {
      console.log('[driver-notify] Skipping — date out of range:', deliveryDate);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, skipped: 'date out of range' }) };
    }

    const { db } = await connectToDatabase();

    // ─── Look up truck → driver info ───────────────────────
    let truck = null;
    try {
      truck = await db.collection('trucks').findOne({ _id: new ObjectId(truckId) });
    } catch (_) {
      // truckId wasn't a valid ObjectId — try string fields
      truck = await db.collection('trucks').findOne({ truckId });
    }

    if (!truck) {
      console.warn('[driver-notify] Truck not found:', truckId);
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Truck not found' }) };
    }

    const driverId   = truck.driverId   || truck.defaultDriver?.id   || null;
    const driverName = truck.driverName || truck.defaultDriver?.name || null;
    let driverPhone  = truck.driverPhone || truck.defaultDriver?.phone || null;

    // Fall back to users / drivers collection if phone not on truck
    if (!driverPhone && driverId) {
      const user = await db.collection('users').findOne({ driverId })
                || await db.collection('users').findOne({ _id: driverId });
      if (!user) {
        // Try drivers collection (rockrunner-specific)
        const driver = await db.collection('drivers').findOne({ driverId });
        if (driver) driverPhone = driver.phone || null;
      } else {
        driverPhone = user.phone || user.driverPhone || null;
      }
    }

    // ─── Build messages ─────────────────────────────────────
    const customer = customerName || 'Customer';
    const detail   = extraDetail  || deliveryDate;
    const builder  = MESSAGES[type] || MESSAGES.LOAD_ADDED;
    const message  = builder(customer, detail);
    const smsMsg   = `RockRunner: Your schedule was updated. ${customer} — ${SMS_ACTION[type] || 'Schedule updated'}. Open your Driver App for details.`;

    // ─── Write to MongoDB ────────────────────────────────────
    const notifDoc = {
      driverId,
      truckId,
      driverName,
      driverPhone,
      deliveryId:   deliveryId || null,
      customerName: customer,
      type,
      message,
      smsMessage:   smsMsg,
      date:         deliveryDate,
      createdAt:    new Date(),
      acknowledged: false,
      acknowledgedAt: null
    };

    const insertResult = await db.collection('driver_notifications').insertOne(notifDoc);
    console.log('[driver-notify]', type, customer, deliveryDate, '→ notif', insertResult.insertedId);

    // ─── Send SMS (async, don't block response) ──────────────
    if (driverPhone) {
      sendSMS(driverPhone, smsMsg).catch(() => {});
    } else {
      console.warn('[driver-notify] No phone for truck', truckId, '— SMS skipped');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, notificationId: insertResult.insertedId })
    };

  } catch (err) {
    console.error('[driver-notify] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
