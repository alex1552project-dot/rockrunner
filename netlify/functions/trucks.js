// RockRunner Logistics - Trucks API
// Manage truck fleet roster

const { MongoClient, ObjectId } = require('mongodb');

let cachedDb = null;
async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  cachedDb = client.db('gotrocks');
  return cachedDb;
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
      const trucks = await collection.find({ active: true }).sort({ truckNumber: 1 }).toArray();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, trucks })
      };
    }

    // POST - Add new truck
    if (event.httpMethod === 'POST') {
      const { truckNumber, capacity, type, notes } = JSON.parse(event.body);
      
      if (!truckNumber || !capacity) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Truck number and capacity required' })
        };
      }

      // Check for duplicate
      const existing = await collection.findOne({ truckNumber, active: true });
      if (existing) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Truck number already exists' })
        };
      }

      const truck = {
        truckNumber,
        capacity: parseFloat(capacity),
        type: type || 'dump', // dump, end-dump, belly-dump, etc.
        notes: notes || '',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await collection.insertOne(truck);
      truck._id = result.insertedId;

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ success: true, truck })
      };
    }

    // PUT - Update truck
    if (event.httpMethod === 'PUT') {
      const { id, truckNumber, capacity, type, notes, active } = JSON.parse(event.body);
      
      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Truck ID required' })
        };
      }

      const updateData = { updatedAt: new Date() };
      if (truckNumber !== undefined) updateData.truckNumber = truckNumber;
      if (capacity !== undefined) updateData.capacity = parseFloat(capacity);
      if (type !== undefined) updateData.type = type;
      if (notes !== undefined) updateData.notes = notes;
      if (active !== undefined) updateData.active = active;

      await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Truck updated' })
      };
    }

    // DELETE - Deactivate truck (soft delete)
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body);
      
      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Truck ID required' })
        };
      }

      await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { active: false, updatedAt: new Date() } }
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Truck deactivated' })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('Trucks API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', message: error.message })
    };
  }
};
