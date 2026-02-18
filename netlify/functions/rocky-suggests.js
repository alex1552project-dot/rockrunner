/**
 * rocky-suggests.js — AI-Powered Auto-Dispatch
 *
 * GET /rocky-suggests?date=2026-02-19
 *
 * 1. Fetches all UNASSIGNED deliveries for the given date
 * 2. Fetches all active trucks with capacities
 * 3. Calls Claude claude-sonnet-4-6 to produce an optimized assignment plan
 * 4. Returns the plan as JSON — no DB writes, caller decides to apply
 */

const Anthropic = require('@anthropic-ai/sdk');
const { connectToDatabase, headers, handleOptions } = require('./utils/db');

const YARD_ADDRESS = '18565 Main St, Conroe, TX 77385';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'GET only' }) };
  }

  const p = event.queryStringParameters || {};
  if (!p.date) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'date param required (YYYY-MM-DD)' }) };
  }

  try {
    const { db } = await connectToDatabase();

    // ─── Fetch UNASSIGNED deliveries for the date ──
    const deliveries = await db.collection('delivery_schedule').find({
      deliveryDate: p.date,
      status: 'UNASSIGNED'
    }).toArray();

    if (!deliveries.length) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, date: p.date, assignments: [], message: 'No unassigned deliveries for this date' })
      };
    }

    // ─── Fetch active trucks ───────────────────────
    const trucks = await db.collection('trucks').find({ active: { $ne: false } }).toArray();

    if (!trucks.length) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, date: p.date, assignments: [], message: 'No active trucks available' })
      };
    }

    // ─── Build prompt context ──────────────────────
    const deliveryList = deliveries.map((d, i) => ({
      index: i + 1,
      id: d._id.toString(),
      customer: d.customerName || 'Unknown',
      address: [d.deliveryAddress, d.deliveryCity, d.deliveryState || 'TX', d.deliveryZip].filter(Boolean).join(', '),
      material: d.materialName || 'Unknown',
      tons: parseFloat(d.quantity) || 0,
      timeWindow: d.timeWindow || 'Flexible'
    }));

    const truckList = trucks.map(t => ({
      id: t._id.toString(),
      truckNumber: t.truckNumber,
      type: t.type || 'End Dump',
      capacityTons: t.capacity || 24,
      driver: t.defaultDriver?.name || 'Unassigned'
    }));

    const prompt = `You are Rocky, an expert logistics dispatcher for a rock and landscaping materials delivery company in the greater Houston/Conroe, Texas area.

YARD (origin for all trucks): ${YARD_ADDRESS}

DATE: ${p.date}

ACTIVE TRUCKS:
${JSON.stringify(truckList, null, 2)}

UNASSIGNED DELIVERIES TO ASSIGN:
${JSON.stringify(deliveryList, null, 2)}

INSTRUCTIONS:
- Assign every delivery to exactly one truck
- Do not exceed any truck's capacityTons (sum of delivery tons per truck must be <= capacityTons)
- Group deliveries geographically when possible to minimize total drive time
- Respect time windows — deliveries with the same time window should go on the same truck when possible
- Assign stop order (1 = first stop) within each truck's route, optimizing for geography
- If there are more tons than total truck capacity, assign as many as fit and leave the rest unassigned
- A truck can have multiple stops

Respond with ONLY a valid JSON object in this exact format, no markdown, no explanation:
{
  "assignments": [
    {
      "deliveryId": "<id from delivery list>",
      "truckId": "<id from truck list>",
      "truckNumber": "<truckNumber>",
      "stopOrder": 1,
      "reasoning": "<one short sentence explaining this assignment>"
    }
  ],
  "unassigned": ["<deliveryId>", ...],
  "summary": "<2-3 sentence plain English summary of the plan>"
}`;

    // ─── Call Claude ────────────────────────────────
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = message.content[0]?.text || '';

    // ─── Parse Claude's response ────────────────────
    let plan;
    try {
      plan = JSON.parse(raw);
    } catch (parseErr) {
      // Try to extract JSON from the response if Claude added any surrounding text
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        plan = JSON.parse(match[0]);
      } else {
        console.error('Rocky parse error. Raw response:', raw);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to parse Claude response', raw })
        };
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        date: p.date,
        deliveryCount: deliveries.length,
        truckCount: trucks.length,
        assignments: plan.assignments || [],
        unassigned: plan.unassigned || [],
        summary: plan.summary || '',
        usage: {
          inputTokens: message.usage?.input_tokens,
          outputTokens: message.usage?.output_tokens
        }
      })
    };

  } catch (err) {
    console.error('Rocky Suggests error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
