const { MongoClient } = require('mongodb');

let cachedClient = null;
async function connectToDatabase() {
  if (cachedClient) return cachedClient.db('gotrocks');
  cachedClient = await MongoClient.connect(process.env.MONGODB_URI);
  return cachedClient.db('gotrocks');
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const db = await connectToDatabase();
    const collection = db.collection('products');
    
    // Get all active products, sorted by name
    const products = await collection.find({ active: { $ne: false } }).sort({ name: 1 }).toArray();
    
    // Return list for dropdown + weight for CYD conversion
    const materials = products.map(p => ({
      id: p._id,
      productId: p.productId,
      name: p.name,
      category: p.category || '',
      weight: p.weight || null  // tons per CYD — used for CYD/tons display
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, materials }) };

  } catch (error) {
    console.error('Products API error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message || 'Server error' }) };
  }
};
