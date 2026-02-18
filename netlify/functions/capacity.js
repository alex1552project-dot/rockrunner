/**
 * capacity.js — Delivery Capacity Calculator
 *
 * GET /capacity?from=2026-02-18&to=2026-02-25
 *
 * Returns daily capacity data: trucks, tons, slots, availability status.
 * Single source of truth for TV display and TGR website date picker.
 * No authentication required — read-only.
 */

const { connectToDatabase, headers, handleOptions } = require('./utils/db');

const DELIVERIES_PER_TRUCK = 5;
const SAME_DAY_CUTOFF_HOUR = 12; // noon CST

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'GET only' }) };
  }

  try {
    const { db } = await connectToDatabase();
    const p = event.queryStringParameters || {};

    if (!p.from || !p.to) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'from and to date params required (YYYY-MM-DD)' }) };
    }

    // ─── Load active trucks ──────────────────────────
    const activeTrucks = await db.collection('trucks').find({ active: { $ne: false } }).toArray();
    const totalTrucks = activeTrucks.length;
    const totalCapacityTons = activeTrucks.reduce((s, t) => s + (t.capacity || 24), 0);
    const maxDeliveries = totalTrucks * DELIVERIES_PER_TRUCK;

    // ─── Load deliveries in date range ───────────────
    const deliveries = await db.collection('delivery_schedule').find({
      deliveryDate: { $gte: p.from, $lte: p.to },
      status: { $nin: ['CANCELLED'] }
    }).toArray();

    // ─── Group deliveries by date ────────────────────
    const byDate = {};
    deliveries.forEach(d => {
      if (!byDate[d.deliveryDate]) byDate[d.deliveryDate] = [];
      byDate[d.deliveryDate].push(d);
    });

    // ─── Current time in CST ─────────────────────────
    const nowCST = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const todayStr = nowCST.getFullYear() + '-' +
      String(nowCST.getMonth() + 1).padStart(2, '0') + '-' +
      String(nowCST.getDate()).padStart(2, '0');

    // ─── Build days array ────────────────────────────
    const days = [];
    const start = new Date(p.from + 'T12:00:00');
    const end = new Date(p.to + 'T12:00:00');

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
      const dayName = DAY_NAMES[d.getDay()];
      const isSunday = d.getDay() === 0;

      if (isSunday) {
        days.push({
          date: dateStr,
          dayName,
          totalTrucks: 0,
          trucksUsed: 0,
          trucksAvailable: 0,
          totalCapacityTons: 0,
          scheduledTons: 0,
          availableTons: 0,
          deliveryCount: 0,
          maxDeliveries: 0,
          availableSlots: 0,
          status: 'closed',
          sameDayAvailable: false,
          sameDayCutoff: '12:00 PM'
        });
        continue;
      }

      const dayDels = byDate[dateStr] || [];
      const scheduledTons = dayDels.reduce((s, del) => s + (parseFloat(del.quantity) || 0), 0);
      const deliveryCount = dayDels.length;
      const trucksUsed = new Set(dayDels.map(del => del.truckId).filter(Boolean)).size;
      const trucksAvailable = Math.max(0, totalTrucks - trucksUsed);
      const availableTons = Math.max(0, totalCapacityTons - scheduledTons);
      const availableSlots = Math.max(0, maxDeliveries - deliveryCount);

      const pctRemaining = totalCapacityTons > 0 ? (availableTons / totalCapacityTons) : 0;
      let status;
      if (pctRemaining > 0.3) status = 'available';
      else if (pctRemaining > 0.1) status = 'limited';
      else status = 'full';

      const isToday = dateStr === todayStr;
      const sameDayAvailable = isToday && nowCST.getHours() < SAME_DAY_CUTOFF_HOUR && availableSlots > 0;

      days.push({
        date: dateStr,
        dayName,
        totalTrucks,
        trucksUsed,
        trucksAvailable,
        totalCapacityTons,
        scheduledTons: Math.round(scheduledTons * 10) / 10,
        availableTons: Math.round(availableTons * 10) / 10,
        deliveryCount,
        maxDeliveries,
        availableSlots,
        status,
        sameDayAvailable,
        sameDayCutoff: '12:00 PM'
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, days })
    };

  } catch (err) {
    console.error('Capacity API error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
