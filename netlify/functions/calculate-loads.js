/**
 * calculate-loads.js — Multi-load order breakdown utility
 *
 * POST /.netlify/functions/calculate-loads
 * Body: { totalTons, truckCapacity, origin?, destination? }
 * Returns: { totalLoads, loads[{ loadNumber, quantity }], estimatedRoundTripMin }
 *
 * When origin + destination + GOOGLE_MAPS_API_KEY are provided, performs
 * two-leg Distance Matrix lookup (origin→dest + dest→origin) and adds
 * +10 min for load/dump time to produce estimatedRoundTripMin.
 *
 * Also exports calculateLoads() for server-side reuse.
 */

const { headers, handleOptions } = require('./utils/db');

function calculateLoads(totalTons, truckCapacity) {
  const totalLoads = Math.ceil(totalTons / truckCapacity);
  const loads = [];
  let remaining = parseFloat(totalTons.toFixed(2));
  for (let i = 1; i <= totalLoads; i++) {
    const loadTons = parseFloat(Math.min(remaining, truckCapacity).toFixed(2));
    loads.push({ loadNumber: i, quantity: loadTons });
    remaining = parseFloat((remaining - loadTons).toFixed(2));
  }
  return { totalLoads, loads };
}

exports.calculateLoads = calculateLoads;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const totalTons = parseFloat(body.totalTons);
    const truckCapacity = parseFloat(body.truckCapacity);

    if (!totalTons || !truckCapacity || isNaN(totalTons) || isNaN(truckCapacity)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'totalTons and truckCapacity required' }) };
    }

    const { totalLoads, loads } = calculateLoads(totalTons, truckCapacity);

    // Round-trip time: drive(origin→dest) + drive(dest→origin) + 5 min load + 5 min dump
    let estimatedRoundTripMin = null;
    if (body.origin && body.destination && process.env.GOOGLE_MAPS_API_KEY) {
      try {
        const enc = encodeURIComponent;
        const key = process.env.GOOGLE_MAPS_API_KEY;
        const orig = enc(body.origin);
        const dest = enc(body.destination);
        const [legA, legB] = await Promise.all([
          fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${orig}&destinations=${dest}&mode=driving&key=${key}`).then(r => r.json()),
          fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${dest}&destinations=${orig}&mode=driving&key=${key}`).then(r => r.json())
        ]);
        const durA = legA?.rows?.[0]?.elements?.[0]?.duration?.value || 0;
        const durB = legB?.rows?.[0]?.elements?.[0]?.duration?.value || 0;
        estimatedRoundTripMin = Math.ceil((durA + durB) / 60) + 10;
      } catch (e) {
        console.error('[calc-loads] ETA error:', e.message);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ totalLoads, loads, estimatedRoundTripMin })
    };
  } catch (e) {
    console.error('[calc-loads] Error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
