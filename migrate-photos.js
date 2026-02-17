/**
 * One-time migration: Upload existing base64 delivery photos to Cloudinary
 * and replace the deliveryPhoto field with the Cloudinary URL.
 *
 * Usage: node migrate-photos.js
 *
 * Requires env vars: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 */

const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const MONGO_URI = 'mongodb+srv://alexsaplala_db_user:texasgotrocks1234@txgotrocks.4wbfn9i.mongodb.net/gotrocks?appName=txgotrocks';

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

async function uploadToCloudinary(base64Image, deliveryId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'rockrunner/deliveries';
  const publicId = `delivery-${deliveryId}-migrated`;

  const signatureStr = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`;
  const signature = crypto.createHash('sha1').update(signatureStr).digest('hex');

  const formData = new URLSearchParams();
  formData.append('file', base64Image);
  formData.append('api_key', API_KEY);
  formData.append('timestamp', timestamp.toString());
  formData.append('signature', signature);
  formData.append('folder', folder);
  formData.append('public_id', publicId);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: formData
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || 'Upload failed');
  return result.secure_url;
}

async function migrate() {
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    console.error('Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET env vars');
    process.exit(1);
  }

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('gotrocks');
  const col = db.collection('delivery_schedule');

  // Find all deliveries with base64 photos (start with "data:")
  const docs = await col.find({
    deliveryPhoto: { $regex: '^data:' }
  }).project({ _id: 1, deliveryPhoto: 1 }).toArray();

  console.log(`Found ${docs.length} deliveries with base64 photos to migrate`);

  for (const doc of docs) {
    const id = doc._id.toString();
    console.log(`  Migrating ${id}...`);
    try {
      const url = await uploadToCloudinary(doc.deliveryPhoto, id);
      await col.updateOne(
        { _id: doc._id },
        { $set: { deliveryPhoto: url, updatedAt: new Date() } }
      );
      console.log(`    -> ${url}`);
    } catch (err) {
      console.error(`    ERROR: ${err.message}`);
    }
  }

  console.log('Migration complete');
  await client.close();
}

migrate();
