// netlify/functions/maps-config.js
// Serves Google Maps API key to the frontend without exposing it in HTML source

exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=3600'
    },
    body: JSON.stringify({ apiKey: process.env.GOOGLE_MAPS_API_KEY })
  };
};
