// RockRunner Logistics - Dispatch Schedule API
// Manage delivery schedule

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
    const collection = db.collection('delivery_schedule');

    // GET - List deliveries (with optional date filter)
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const query = {};
      
      // Filter by date range
      if (params.date) {
        // Single date
        query.date = params.date;
      } else if (params.startDate && params.endDate) {
        // Date range
        query.date = { $gte: params.startDate, $lte: params.endDate };
      } else {
        // Default: today and future
        const today = new Date().toISOString().split('T')[0];
        query.date = { $gte: today };
      }

      // Filter by source
      if (params.source) {
        query.source = params.source;
      }

      // Filter by truck
      if (params.truckId) {
        query.truckId = params.truckId;
      }

      const deliveries = await collection
        .find(query)
        .sort({ date: 1, hour: 1 })
        .toArray();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, deliveries })
      };
    }

    // POST - Add new delivery
    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body);
      const { 
        date, 
        hour, 
        truckId, 
        truckNumber,
        customer, 
        address, 
        city,
        material, 
        tons, 
        source,
        notes,
        createdBy 
      } = data;
      
      if (!date || hour === undefined || !truckId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Date, hour, and truck required' })
        };
      }

      // Check for conflicts (same truck, same date, same hour)
      const conflict = await collection.findOne({ 
        date, 
        hour: parseInt(hour), 
        truckId,
        status: { $ne: 'cancelled' }
      });
      
      if (conflict) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: 'Time slot already booked for this truck' })
        };
      }

      const delivery = {
        date,
        hour: parseInt(hour),
        truckId,
        truckNumber: truckNumber || '',
        customer: customer || '',
        address: address || '',
        city: city || '',
        material: material || '',
        tons: parseFloat(tons) || 0,
        source: source || 'T&C Materials', // 'T&C Materials', 'Yard Sale', 'Texas Got Rocks'
        status: 'scheduled', // scheduled, en-route, delivered, cancelled
        notes: notes || '',
        createdBy: createdBy || 'system',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await collection.insertOne(delivery);
      delivery._id = result.insertedId;

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ success: true, delivery })
      };
    }

    // PUT - Update delivery (move, edit, change status)
    if (event.httpMethod === 'PUT') {
      const data = JSON.parse(event.body);
      const { id, ...updates } = data;
      
      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Delivery ID required' })
        };
      }

      // If moving to new slot, check for conflicts
      if (updates.date || updates.hour !== undefined || updates.truckId) {
        const existing = await collection.findOne({ _id: new ObjectId(id) });
        const checkDate = updates.date || existing.date;
        const checkHour = updates.hour !== undefined ? parseInt(updates.hour) : existing.hour;
        const checkTruck = updates.truckId || existing.truckId;

        const conflict = await collection.findOne({ 
          _id: { $ne: new ObjectId(id) },
          date: checkDate, 
          hour: checkHour, 
          truckId: checkTruck,
          status: { $ne: 'cancelled' }
        });
        
        if (conflict) {
          return {
            statusCode: 409,
            headers,
            body: JSON.stringify({ error: 'Time slot already booked for this truck' })
          };
        }
      }

      // Build update object
      const updateData = { updatedAt: new Date() };
      const allowedFields = ['date', 'hour', 'truckId', 'truckNumber', 'customer', 'address', 'city', 'material', 'tons', 'source', 'status', 'notes'];
      
      allowedFields.forEach(field => {
        if (updates[field] !== undefined) {
          if (field === 'hour') updateData[field] = parseInt(updates[field]);
          else if (field === 'tons') updateData[field] = parseFloat(updates[field]);
          else updateData[field] = updates[field];
        }
      });

      await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Delivery updated' })
      };
    }

    // DELETE - Cancel delivery
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body);
      
      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Delivery ID required' })
        };
      }

      // Soft delete - mark as cancelled
      await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'cancelled', updatedAt: new Date() } }
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Delivery cancelled' })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('Dispatch API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', message: error.message })
    };
  }
};
