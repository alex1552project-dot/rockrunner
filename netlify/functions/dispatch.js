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
    const collection = db.collection('delivery_schedule');

    // GET - List deliveries
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const { startDate, endDate, truckId } = params;
      
      const query = { status: { $ne: 'cancelled' } };
      if (startDate && endDate) {
        query.date = { $gte: startDate, $lte: endDate };
      } else if (startDate) {
        query.date = startDate;
      }
      if (truckId) query.truckId = truckId;

      const deliveries = await collection.find(query).sort({ date: 1, hour: 1 }).toArray();
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, deliveries }) };
    }

    // POST - Create delivery
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { date, hour, returnHour, truckId, truckNumber, customer, address, city, material, tons, source, notes } = body;

      if (!date || !hour || !truckId) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Date, time, and truck required' }) };
      }

      // Check for conflicts
      const existingDelivery = await collection.findOne({
        truckId,
        date,
        hour: parseInt(hour),
        status: { $ne: 'cancelled' }
      });

      if (existingDelivery) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Time slot already booked for this truck' }) };
      }

      const delivery = {
        date,
        hour: parseInt(hour),
        returnHour: returnHour ? parseInt(returnHour) : null,
        truckId,
        truckNumber: truckNumber || '',
        customer: customer || '',
        address: address || '',
        city: city || '',
        material: material || '',
        tons: parseFloat(tons) || 0,
        source: source || 'T&C Materials',
        notes: notes || '',
        status: 'scheduled',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await collection.insertOne(delivery);
      delivery._id = result.insertedId;

      return { statusCode: 201, headers, body: JSON.stringify({ success: true, delivery }) };
    }

    // PUT - Update delivery
    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      const { id, date, hour, returnHour, truckId, truckNumber, customer, address, city, material, tons, source, notes, status } = body;

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Delivery ID required' }) };
      }

      const updateData = { updatedAt: new Date() };
      if (date !== undefined) updateData.date = date;
      if (hour !== undefined) updateData.hour = parseInt(hour);
      if (returnHour !== undefined) updateData.returnHour = returnHour ? parseInt(returnHour) : null;
      if (truckId !== undefined) updateData.truckId = truckId;
      if (truckNumber !== undefined) updateData.truckNumber = truckNumber;
      if (customer !== undefined) updateData.customer = customer;
      if (address !== undefined) updateData.address = address;
      if (city !== undefined) updateData.city = city;
      if (material !== undefined) updateData.material = material;
      if (tons !== undefined) updateData.tons = parseFloat(tons);
      if (source !== undefined) updateData.source = source;
      if (notes !== undefined) updateData.notes = notes;
      if (status !== undefined) updateData.status = status;

      await collection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Delivery updated' }) };
    }

    // DELETE - Cancel delivery
    if (event.httpMethod === 'DELETE') {
      const body = JSON.parse(event.body || '{}');
      const { id } = body;

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Delivery ID required' }) };
      }

      await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'cancelled', updatedAt: new Date() } }
      );

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Delivery cancelled' }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (error) {
    console.error('Dispatch API error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message || 'Server error' }) };
  }
};
