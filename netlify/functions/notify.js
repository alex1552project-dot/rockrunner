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
const OWNER_PHONE = '9363635803'; // Corey Pelletier — owner alerts

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

function deliveredEmail(delivery) {
  const firstName = (delivery.customerName || 'Customer').split(' ')[0];
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;">
  <div style="max-width:500px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0;">
    <div style="background:#001F3F;padding:24px 28px;text-align:center;">
      <div style="color:#C65D2A;font-size:22px;font-weight:700;">Texas Got Rocks</div>
      <div style="color:#22c55e;font-size:14px;font-weight:600;margin-top:4px;">&#x2705; Delivery Complete!</div>
    </div>
    <div style="padding:28px;">
      <p style="font-size:16px;color:#333;margin:0 0 16px;">Hi ${firstName},</p>
      <p style="font-size:15px;color:#333;margin:0 0 20px;line-height:1.5;">Your delivery has been completed! Here's a summary:</p>
      <div style="background:#f8f9fa;border-radius:8px;padding:18px;margin-bottom:20px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#666;font-size:13px;">Material</td><td style="padding:6px 0;font-weight:600;font-size:14px;text-align:right;">${delivery.materialName || 'Material'}</td></tr>
          <tr><td style="padding:6px 0;color:#666;font-size:13px;">Quantity</td><td style="padding:6px 0;font-weight:600;font-size:14px;text-align:right;">${delivery.quantity || '?'} tons</td></tr>
        </table>
      </div>
      ${delivery.deliveryPhoto && delivery.deliveryPhoto.startsWith('http') ? `
      <div style="margin-bottom:20px;">
        <p style="font-size:13px;color:#666;margin:0 0 8px;">Delivery Photo:</p>
        <img src="${delivery.deliveryPhoto}" alt="Delivery photo" style="max-width:100%;border-radius:8px;border:1px solid #e2e8f0;">
      </div>` : delivery.deliveryPhoto ? `
      <p style="font-size:14px;color:#666;margin:0 0 16px;">&#x1F4F8; A delivery photo has been saved to your order record.</p>` : ''}
      <p style="font-size:15px;color:#333;margin:0 0 12px;line-height:1.5;">Thank you for choosing Texas Got Rocks! We appreciate your business.</p>
      <p style="font-size:14px;color:#666;margin:0 0 20px;line-height:1.5;">If you have any questions or concerns about your delivery, please call us at <strong>(936) 259-2887</strong>.</p>
      <div style="background:#f0faf6;border-radius:8px;padding:16px;text-align:center;border:1px solid #bbeed8;">
        <p style="margin:0 0 12px;font-size:14px;color:#333;font-weight:600;">Enjoying your new rocks?</p>
        <p style="margin:0 0 12px;font-size:13px;color:#555;">A quick review helps other Texans find us — and it means the world to our small team.</p>
        <a href="https://www.trustpilot.com/review/texasgotrocks.com" style="display:inline-block;background:#00B67A;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">&#x2B50; Leave a Review</a>
      </div>
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

      // ─── Real ETA from Google Distance Matrix ──────────────
      let etaMinutes = 30; // fallback
      try {
        const destParts = [
          delivery.deliveryAddress,
          delivery.deliveryCity,
          delivery.deliveryState || 'TX',
          delivery.deliveryZip
        ].filter(Boolean);
        if (destParts.length > 1 && process.env.GOOGLE_MAPS_API_KEY) {
          // Use delivery's sourceAddress when driver is starting from a non-Conroe location
          const isConroe = !delivery.sourceName ||
            delivery.sourceName.toLowerCase().includes('conroe') ||
            !delivery.sourceAddress;
          const origin = isConroe
            ? '30.3119,-95.4561'
            : encodeURIComponent(delivery.sourceAddress);
          const destination = encodeURIComponent(destParts.join(', '));
          const gmRes = await fetch(
            `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destination}&mode=driving&units=imperial&key=${process.env.GOOGLE_MAPS_API_KEY}`
          );
          const gmData = await gmRes.json();
          const element = gmData?.rows?.[0]?.elements?.[0];
          if (element?.status === 'OK' && element.duration?.value) {
            etaMinutes = Math.ceil(element.duration.value / 60);
          }
        }
      } catch (etaErr) {
        console.error('[ETA] Google Distance Matrix error:', etaErr.message);
        // etaMinutes stays 30
      }
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

    // ─── Delivered / Thank You (single — after photo upload) ──
    if (body.type === 'delivered') {
      const deliveryId = body.deliveryId;
      if (!deliveryId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'deliveryId required' }) };
      }

      const delivery = await deliveryCol.findOne({ _id: new ObjectId(deliveryId) });
      if (!delivery) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Delivery not found' }) };
      }

      // Duplicate guard
      if (delivery.deliveredSmsSent && delivery.deliveredEmailSent) {
        console.log(`[Delivered] Already notified for ${deliveryId}, skipping`);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, alreadySent: true }) };
      }

      const smsMessage = `Thank you! Your ${delivery.materialName || 'material'} has been delivered. We appreciate your business! — Texas Got Rocks`;

      let smsResult = null;
      let emailResult = null;

      if (delivery.customerPhone && !delivery.deliveredSmsSent) {
        smsResult = await sendSMS(delivery.customerPhone, smsMessage);
      }

      if (delivery.customerEmail && !delivery.deliveredEmailSent) {
        emailResult = await sendEmail(
          delivery.customerEmail,
          delivery.customerName,
          'Your Delivery Is Complete!',
          deliveredEmail(delivery)
        );
      }

      // ── Trustpilot invite (piggybacked on delivery completion) ──
      const tpEmail = 'texasgotrocks.com+621d4324d2@invite.trustpilot.com';
      const tpHtml = `<p>Customer: ${delivery.customerName || ''}</p><p>Email: ${delivery.customerEmail || ''}</p><p>Order: ${delivery._id}</p>`;
      let tpResult = null;
      if (!delivery.trustpilotInviteSent) {
        tpResult = await sendEmail(tpEmail, 'Trustpilot Invite', 'New Invitation Request', tpHtml);
      }

      await deliveryCol.updateOne(
        { _id: new ObjectId(deliveryId) },
        { $set: {
          deliveredSmsSent: smsResult?.success || delivery.deliveredSmsSent || false,
          deliveredEmailSent: emailResult?.success || delivery.deliveredEmailSent || false,
          trustpilotInviteSent: tpResult?.success || delivery.trustpilotInviteSent || false,
          updatedAt: new Date()
        }}
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          smsSent: smsResult?.success || false,
          emailSent: emailResult?.success || false,
          trustpilotInviteSent: tpResult?.success || false
        })
      };
    }

    // ─── Review Request (sent ~5 min after delivery, triggered by driver app) ──
    if (body.type === 'review_request') {
      const deliveryId = body.deliveryId;
      if (!deliveryId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'deliveryId required' }) };
      }

      const delivery = await deliveryCol.findOne({ _id: new ObjectId(deliveryId) });
      if (!delivery) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Delivery not found' }) };
      }

      // Duplicate guard
      if (delivery.reviewRequestSent) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, alreadySent: true }) };
      }

      const firstName = (delivery.customerName || 'Customer').split(' ')[0];
      const reviewLink = 'https://www.trustpilot.com/review/texasgotrocks.com';

      // ── Customer warm message + review link ──
      let customerEmailResult = null;
      if (delivery.customerEmail) {
        const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;">
  <div style="max-width:500px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0;">
    <div style="background:#001F3F;padding:24px 28px;text-align:center;">
      <div style="color:#C65D2A;font-size:22px;font-weight:700;">Texas Got Rocks</div>
      <div style="color:#8891a0;font-size:13px;margin-top:4px;">We hope you love your delivery!</div>
    </div>
    <div style="padding:28px;">
      <p style="font-size:16px;color:#333;margin:0 0 16px;">Hi ${firstName},</p>
      <p style="font-size:15px;color:#333;margin:0 0 20px;line-height:1.5;">Your ${delivery.materialName || 'material'} delivery is now complete. We hope everything looks great!</p>
      <p style="font-size:15px;color:#333;margin:0 0 20px;line-height:1.5;">If you have a moment, we'd love to hear about your experience. It means the world to a small local business.</p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${reviewLink}" style="background:#00b67a;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">⭐ Leave a Review on Trustpilot</a>
      </div>
      <p style="font-size:13px;color:#999;text-align:center;">Thank you for choosing Texas Got Rocks!</p>
    </div>
  </div>
</body></html>`;
        customerEmailResult = await sendEmail(
          delivery.customerEmail,
          delivery.customerName,
          'How was your delivery? Tell us! ⭐',
          html
        );
      }

      // ── Trustpilot BCC invite ──
      const tpEmail = 'texasgotrocks.com+621d4324d2@invite.trustpilot.com';
      const tpHtml = `<p>Customer: ${delivery.customerName || ''}</p><p>Email: ${delivery.customerEmail || ''}</p><p>Order: ${delivery._id}</p>`;
      const tpResult = await sendEmail(tpEmail, 'Trustpilot Invite', 'New Invitation Request', tpHtml);

      await deliveryCol.updateOne(
        { _id: new ObjectId(deliveryId) },
        { $set: { reviewRequestSent: true, updatedAt: new Date() } }
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          customerEmailSent: customerEmailResult?.success || false,
          trustpilotInviteSent: tpResult?.success || false
        })
      };
    }

    // ─── Owner Alert: Board Finalized ─────────────────────────
    if (body.type === 'owner_finalized') {
      const { deliveryCount, truckCount, date } = body;
      const msg = `\u2705 Tomorrow's board is set: ${deliveryCount} deliveries assigned across ${truckCount} trucks. All customers have been notified. \u2014 RockRunner`;
      const smsResult = await sendSMS(OWNER_PHONE, msg);
      console.log(`[Owner Alert] Finalized ${date}:`, smsResult);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, ownerSmsSent: smsResult?.success || false })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type. Use: schedule_confirmation, en_route, delivered, owner_finalized' }) };

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
