/**
 * migrate-photos.js — One-time migration: base64 photos → Cloudinary
 *
 * GET /migrate-photos — finds all delivery_schedule docs with base64 photos,
 * uploads each to Cloudinary, and replaces the field with the URL.
 *
 * Delete this function after running it once.
 */

const { connectToDatabase, headers, handleOptions } = require('./utils/db');
const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Cloudinary not configured' }) };
  }

  try {
    const { db } = await connectToDatabase();
    const col = db.collection('delivery_schedule');

    const docs = await col.find({
      deliveryPhoto: { $regex: '^data:' }
    }).project({ _id: 1, deliveryPhoto: 1 }).toArray();

    const results = [];

    for (const doc of docs) {
      const id = doc._id.toString();
      try {
        const timestamp = Math.floor(Date.now() / 1000);
        const folder = 'rockrunner/deliveries';
        const publicId = `delivery-${id}-migrated`;

        const signatureStr = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
        const signature = crypto.createHash('sha1').update(signatureStr).digest('hex');

        const formData = new URLSearchParams();
        formData.append('file', doc.deliveryPhoto);
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
        if (!response.ok) throw new Error(result.error?.message || 'Upload failed');

        await col.updateOne(
          { _id: doc._id },
          { $set: { deliveryPhoto: result.secure_url, updatedAt: new Date() } }
        );

        results.push({ id, url: result.secure_url, success: true });
      } catch (err) {
        results.push({ id, error: err.message, success: false });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ migrated: results.length, results })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
