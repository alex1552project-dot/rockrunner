/**
 * daily-dispatch-reminder.js — Netlify Scheduled Function
 *
 * Runs daily at 3:00 PM CST (21:00 UTC) via cron.
 * Checks tomorrow's delivery_schedule for UNASSIGNED deliveries.
 * If any exist, texts the owner (Corey Pelletier) a reminder.
 */

const { schedule } = require('@netlify/functions');
const { connectToDatabase } = require('./utils/db');

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const OWNER_PHONE = '9363635803'; // Corey Pelletier — owner alerts

async function sendSMS(phone, message) {
  let formatted = phone.replace(/[^\d+]/g, '');
  if (!formatted.startsWith('+')) {
    if (formatted.startsWith('1') && formatted.length === 11) {
      formatted = '+' + formatted;
    } else if (formatted.length === 10) {
      formatted = '+1' + formatted;
    }
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/transactionalSMS/send', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'transactional',
        unicodeEnabled: false,
        sender: 'TXGotRocks',
        recipient: formatted,
        content: message
      })
    });
    const result = await response.json();
    console.log(`[SMS] ${formatted}: ${response.ok ? 'sent' : 'failed'}`, result);
    return { success: response.ok, result };
  } catch (err) {
    console.error('[SMS] Error:', err.message);
    return { success: false, error: err.message };
  }
}

function getTomorrowDateISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
}

const handler = async () => {
  try {
    const { db } = await connectToDatabase();
    const tomorrow = getTomorrowDateISO();

    const unassigned = await db.collection('delivery_schedule').countDocuments({
      deliveryDate: tomorrow,
      status: 'UNASSIGNED'
    });

    console.log(`[Daily Reminder] Tomorrow ${tomorrow}: ${unassigned} unassigned`);

    if (unassigned === 0) {
      console.log('[Daily Reminder] Board is clear — no alert needed');
      return { statusCode: 200 };
    }

    const msg = `\u26A0\uFE0F Dispatch Alert: There are ${unassigned} unassigned deliveries for tomorrow ${formatDate(tomorrow)}. The board has not been finalized yet. \u2014 RockRunner`;
    const result = await sendSMS(OWNER_PHONE, msg);
    console.log('[Daily Reminder] Owner SMS result:', result);

    return { statusCode: 200 };
  } catch (err) {
    console.error('[Daily Reminder] Error:', err);
    return { statusCode: 500 };
  }
};

// 21:00 UTC = 3:00 PM CST
exports.handler = schedule('0 21 * * *', handler);
