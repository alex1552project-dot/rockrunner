/**
 * upload-photo.js — Upload delivery photo to Cloudinary
 *
 * POST /upload-photo
 *   { image: "data:image/jpeg;base64,/9j/...", deliveryId: "optional-tag" }
 *
 * Returns:
 *   { success: true, url: "https://res.cloudinary.com/..." }
 *
 * Environment Variables:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */

const { headers, handleOptions } = require('./utils/db');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { image, deliveryId } = body;

    if (!image) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'image required' }) };
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Cloudinary not configured' }) };
    }

    // Generate signature for signed upload
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = 'rockrunner/deliveries';
    const publicId = deliveryId ? `delivery-${deliveryId}-${timestamp}` : `delivery-${timestamp}`;

    // Build signature string (params in alphabetical order)
    const signatureStr = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const crypto = require('crypto');
    const signature = crypto.createHash('sha1').update(signatureStr).digest('hex');

    // Upload to Cloudinary
    const formData = new URLSearchParams();
    formData.append('file', image);
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp.toString());
    formData.append('signature', signature);
    formData.append('folder', folder);
    formData.append('public_id', publicId);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[Upload] Cloudinary error:', result);
      return { statusCode: 500, headers, body: JSON.stringify({ error: result.error?.message || 'Upload failed' }) };
    }

    console.log(`[Upload] Success: ${result.secure_url} (${Math.round(result.bytes / 1024)}KB)`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        url: result.secure_url,
        publicId: result.public_id
      })
    };

  } catch (err) {
    console.error('[Upload] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
