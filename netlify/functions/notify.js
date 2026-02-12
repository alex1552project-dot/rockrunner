/**
 * notify.js — Customer Notification Handler (Brevo SMS + Email)
 * 
 * Sends BOTH SMS and email for every notification.
 * If one channel fails, the other still delivers.
 * 
 * Two trigger points:
 *   1. Schedule confirmation — dispatcher finalizes tomorrow's board
 *   2. En-route alert — driver taps "En Route" button
 * 
 * POST /notify
 *   { type: "schedule_confirmation", deliveries: [...] }
 *   { type: "en_route", deliveryId: "xxx" }
 * 
 * Environment Variables:
 *   BREVO_API_KEY          — Brevo API key
 *   BREVO_SENDER_EMAIL     — From email (default: info@texasgotrocks.com)
 *   BREVO_SENDER_NAME      — From name (default: Texas Got Rocks)
 */

const { connectToDatabase, headers, handleOptions } = require('./utils/db');
const { ObjectId } = require('mongodb');

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'info@texasgotrocks.com';
const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Texas Got Rocks';

// ─── SMS via Brevo ───────────────────────────────────
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
    return { success: response.ok, phone: formatted, result };
  } catch (err) {
    console.error('[SMS] Error:', err.message);
    return { success: false, phone: formatted, error: err.message };
  }
}

// ─── Email via Brevo ─────────────────────────────────
async function sendEmail(to, toName, subject, htmlContent) {
  if (!to) return { success: false, reason: 'No email address' };

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: to, name: toName || '' }],
        subject,
        htmlContent
      })
    });
    const result = await response.json();
    console.log(`[Email] ${to}: ${response.ok ? 'sent' : 'failed'}`, result);
    return { success: response.ok, email: to, result };
  } catch (err) {
    console.error('[Email] Error:', err.message);
    return { success: false, email: to, error: err.message };
  }
}

// ─── Email Templates ─────────────────────────────────
function scheduleConfirmationEmail(del) {
  const firstName = (del.customerName || 'Customer').split(' ')[0];
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;">
  <div style="max-width:500px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0;">
    <div style="background:#001F3F;padding:24px 28px;text-align:center;">
      <div style="color:#C65D2A;font-size:22px;font-weight:700;">Texas Got Rocks</div>
      <div style="color:#8891a0;font-size:13px;margin-top:4px;">Delivery Confirmation</div>
    </div>
    <div style="padding:28px;">
      <p style="font-size:16px;color:#333;margin:0 0 16px;">Hi ${firstName},</p>
      <p style="font-size:15px;color:#333;margin:0 0 20px;line-height:1.5;">Your delivery is confirmed and on the schedule. Here are the details:</p>
      <div style="background:#f8f9fa;border-radius:8px;padding:18px;margin-bottom:20px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#666;font-size:13px;">Material</td><td style="padding:6px 0;font-weight:600;font-size:14px;text-align:right;">${del.materialName || 'TBD'}</td></tr>
          <tr><td style="padding:6px 0;color:#666;font-size:13px;">Quantity</td><td style="padding:6px 0;font-weight:600;font-size:14px;text-align:right;">${del.quantity || '?'} tons</td></tr>
          <tr><td style="padding:6px 0;color:#666;font-size:13px;">Date</td><td style="padding:6px 0;font-weight:600;font-size:14px;text-align:right;">${formatDate(del.deliveryDate)}</td></tr>
          ${del.timeWindow ? `<tr><td style="padding:6px 0;color:#666;font-size:13px;">Time Window</td><td style="padding:6px 0;font-weight:600;font-size:14px;text-align:right;">${del.timeWindow}</td></tr>` : ''}
        </table>
      </div>
      <p style="font-size:14px;color:#666;margin:0 0 8px;line-height:1.5;">You'll receive another notification when your driver is on the way with an estimated arrival time.</p>
      <p style="font-size:14px;color:#666;margin:0;line-height:1.5;">Please make sure the delivery area is accessible for our truck.</p>
    </div>
    <div style="padding:16px 28px;background:#f8f9fa;border-top:1px solid #e0e0e0;text-align:center;">
      <p style="margin:0;font-size:12px;color:#999;">Texas Got Rocks &middot; Always FREE Delivery &middot; (936) 259-2887</p>
      <p style="margin:4px 0 0;font-size:11px;color:#bbb;">Reply STOP to opt out of text messages.</p>
    </div>
  </div>
</body></html>`;
}

function enRouteEmail(delivery, etaMinutes) {
  const firstName = (delivery.customerName || 'Customer').split(' ')[0];
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;">
  <div style="max-width:500px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0;">
    <div style="background:#001F3F;padding:24px 28px;text-align:center;">
      <div style="color:#C65D2A;font-size:22px;font-weight:700;">Texas Got Rocks</div>
      <div style="color:#22c55e;font-size:14px;font-weight:600;margin-top:4px;">&#x1F69B; Your Delivery Is On the Way!</div>
    </div>
    <div style="padding:28px;">
      <p style="font-size:16px;color:#333;margin:0 0 16px;">Hi ${firstName},</p>
      <p style="font-size:15px;color:#333;margin:0 0 20px;line-height:1.5;">Your driver just left and is heading to your location now.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:18px;text-align:center;margin-bottom:20px;">
        <div style="font-size:13px;color:#666;margin-bottom:4px;">Estimated Arrival</div>
        <div style="font-size:28px;font-weight:700;color:#16a34a;">~${etaMinutes || 30} min</div>
      </div>
      <div style="background:#f8f9fa;border-radius:8px;padding:18px;margin-bottom:20px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#666;font-size:13px;">Material</td><td style="padding:6px 0;font-weight:600;font-size:14px;text-align:right;">${delivery.materialName || 'Material'}</td></tr>
          <tr><td style="padding:6px 0;color:#666;font-size:13px;">Quantity</td><td style="padding:6px 0;font-weight:600;font-size:14px;text-align:right;">${delivery.quantity || '?'} tons</td></tr>
        </table>
      </div>
      <p style="font-size:14px;color:#666;margin:0;line-height:1.5;">Please ensure your delivery area is clear and accessible for our truck. If you need to reach us, call <strong>(936) 259-2887</strong>.</p>
    </div>
    <div style="padding:16px 28px;background:#f8f9fa;border-top:1px solid #e0e0e0;text-align:center;">
      <p style="margin:0;font-size:12px;color:#999;">Texas Got Rocks &middot; Always FREE Delivery &middot; (936) 259-2887</p>
    </div>
  </div>
</body></html>`;
}

// ─── Main Handler ────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  try {
    const { db } = await connectToDatabase();
    const deliveryCol = db.collection('delivery_schedule');
    const body = JSON.parse(event.body);

    // ─── Schedule Confirmation (batch — night before) ─────────
    if (body.type === 'schedule_confirmation') {
      const results = [];

      for (const del of (body.deliveries || [])) {
        const firstName = (del.customerName || 'Customer').split(' ')[0];
        const smsMessage = `Hi ${firstName}! Your delivery of ${del.quantity} tons of ${del.materialName} from Texas Got Rocks is scheduled for ${formatDate(del.deliveryDate)}${del.timeWindow ? ' between ' + del.timeWindow : ''}. You'll get a text when the driver is on the way. Reply STOP to opt out.`;

        const result = { deliveryId: del.id, sms: null, email: null };

        // Send SMS (if phone exists)
        if (del.customerPhone) {
          result.sms = await sendSMS(del.customerPhone, smsMessage);
        }

        // Send Email (if email exists)
        if (del.customerEmail) {
          result.email = await sendEmail(
            del.customerEmail,
            del.customerName,
            `Delivery Confirmed - ${formatDate(del.deliveryDate)}`,
            scheduleConfirmationEmail(del)
          );
        }

        results.push(result);

        // Update DB with notification status
        if (del.id) {
          await deliveryCol.updateOne(
            { _id: new ObjectId(del.id) },
            { $set: {
              scheduleSmsSent: result.sms?.success || false,
              scheduleEmailSent: result.email?.success || false,
              updatedAt: new Date()
            }}
          );
        }
      }

      const smsSent = results.filter(r => r.sms?.success).length;
      const emailSent = results.filter(r => r.email?.success).length;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, smsSent, emailSent, total: results.length, results })
      };
    }

    // ─── En Route Alert (single — real-time) ──────────────────
    if (body.type === 'en_route') {
      const deliveryId = body.deliveryId;
      if (!deliveryId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'deliveryId required' }) };
      }

      const delivery = await deliveryCol.findOne({ _id: new ObjectId(deliveryId) });
      if (!delivery) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Delivery not found' }) };
      }

      const etaMinutes = body.etaMinutes || 30;
      const smsMessage = `Your Texas Got Rocks delivery is on the way! Estimated arrival: ~${etaMinutes} minutes. Please ensure your delivery area is accessible.`;

      let smsResult = null;
      let emailResult = null;

      // Send SMS
      if (delivery.customerPhone) {
        smsResult = await sendSMS(delivery.customerPhone, smsMessage);
      }

      // Send Email
      if (delivery.customerEmail) {
        emailResult = await sendEmail(
          delivery.customerEmail,
          delivery.customerName,
          'Your Delivery Is On the Way!',
          enRouteEmail(delivery, etaMinutes)
        );
      }

      // Update delivery record
      await deliveryCol.updateOne(
        { _id: new ObjectId(deliveryId) },
        {
          $set: {
            status: 'EN_ROUTE',
            enRouteAt: new Date(),
            enRouteSmsSent: smsResult?.success || false,
            enRouteEmailSent: emailResult?.success || false,
            updatedAt: new Date()
          },
          $push: {
            statusHistory: {
              status: 'EN_ROUTE',
              timestamp: new Date(),
              updatedBy: body.driverId || 'driver',
              notes: `Driver en route - SMS: ${smsResult?.success ? 'sent' : 'skipped'}, Email: ${emailResult?.success ? 'sent' : 'skipped'}`
            }
          }
        }
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          smsSent: smsResult?.success || false,
          emailSent: emailResult?.success || false
        })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type. Use: schedule_confirmation, en_route' }) };

  } catch (err) {
    console.error('Notify API error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function formatDate(dateStr) {
  if (!dateStr) return 'soon';
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
}
