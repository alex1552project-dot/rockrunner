const { MongoClient, ObjectId } = require('mongodb');

let cachedClient = null;
async function connectToDatabase() {
  if (cachedClient) return cachedClient.db('gotrocks');
  cachedClient = await MongoClient.connect(process.env.MONGODB_URI);
  return cachedClient.db('gotrocks');
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const db = await connectToDatabase();
    const collection = db.collection('trucks');

    // GET - List all trucks
    if (event.httpMethod === 'GET') {
      const trucks = await collection.find({ active: { $ne: false } }).sort({ truckNumber: 1 }).toArray();
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, trucks }) };
    }

    // POST - Add new truck
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { truckNumber, capacity, type, notes } = body;
      
      if (!truckNumber || !capacity) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Truck number and capacity required' }) };
      }

      // Check for duplicate - case insensitive
      const existing = await collection.findOne({ 
        truckNumber: { $regex: new RegExp(`^${truckNumber.trim()}$`, 'i') }, 
        active: { $ne: false } 
      });
      
      if (existing) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: `Truck "${truckNumber}" already exists in roster` }) };
      }

      const truck = {
        truckNumber: truckNumber.trim(),
        capacity: parseFloat(capacity),
        type: type || 'semi',
        notes: notes || '',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await collection.insertOne(truck);
      truck._id = result.insertedId;

      return { statusCode: 201, headers, body: JSON.stringify({ success: true, truck }) };
    }

    // PUT - Update truck
    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      const { id, truckNumber, capacity, type, notes, active } = body;
      
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Truck ID required' }) };
      }

      const updateData = { updatedAt: new Date() };
      if (truckNumber !== undefined) updateData.truckNumber = truckNumber.trim();
      if (capacity !== undefined) updateData.capacity = parseFloat(capacity);
      if (type !== undefined) updateData.type = type;
      if (notes !== undefined) updateData.notes = notes;
      if (active !== undefined) updateData.active = active;

      await collection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Truck updated' }) };
    }

    // DELETE - Deactivate truck
    if (event.httpMethod === 'DELETE') {
      const body = JSON.parse(event.body || '{}');
      const { id } = body;
      
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Truck ID required' }) };
      }

      await collection.updateOne({ _id: new ObjectId(id) }, { $set: { active: false, updatedAt: new Date() } });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Truck removed' }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (error) {
    console.error('Trucks API error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message || 'Server error' }) };
  }
};
