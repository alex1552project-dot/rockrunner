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

      const deliveries = await collection.find(query).sort({ date: 1, time: 1, hour: 1 }).toArray();
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, deliveries }) };
    }

    // POST - Create delivery
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { date, time, hour, returnTime, returnHour, truckId, truckNumber, customer, address, city, material, tons, source, notes } = body;

      // Support both time (new 30-min) and hour (legacy)
      const deliveryTime = time !== undefined ? parseFloat(time) : (hour !== undefined ? parseInt(hour) : null);
      const deliveryReturnTime = returnTime !== undefined ? parseFloat(returnTime) : (returnHour !== undefined ? parseInt(returnHour) : null);

      if (!date || deliveryTime === null || !truckId) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Date, time, and truck required' }) };
      }

      // Check for exact time conflict
      const existingDelivery = await collection.findOne({
        truckId,
        date,
        $or: [
          { time: deliveryTime },
          { hour: deliveryTime, time: { $exists: false } }
        ],
        status: { $ne: 'cancelled' }
      });

      if (existingDelivery) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Time slot already booked for this truck' }) };
      }

      const delivery = {
        date,
        time: deliveryTime,
        returnTime: deliveryReturnTime,
        // Keep legacy fields for backward compatibility
        hour: Math.floor(deliveryTime),
        returnHour: deliveryReturnTime ? Math.floor(deliveryReturnTime) : null,
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
      const { id, date, time, hour, returnTime, returnHour, truckId, truckNumber, customer, address, city, material, tons, source, notes, status } = body;

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Delivery ID required' }) };
      }

      const updateData = { updatedAt: new Date() };
      if (date !== undefined) updateData.date = date;
      if (time !== undefined) {
        updateData.time = parseFloat(time);
        updateData.hour = Math.floor(parseFloat(time));
      } else if (hour !== undefined) {
        updateData.hour = parseInt(hour);
        updateData.time = parseInt(hour);
      }
      if (returnTime !== undefined) {
        updateData.returnTime = returnTime ? parseFloat(returnTime) : null;
        updateData.returnHour = returnTime ? Math.floor(parseFloat(returnTime)) : null;
      } else if (returnHour !== undefined) {
        updateData.returnHour = returnHour ? parseInt(returnHour) : null;
        updateData.returnTime = returnHour ? parseInt(returnHour) : null;
      }
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
