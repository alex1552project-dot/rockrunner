// resolve-map-link.js
// Resolves short map URLs (goo.gl, maps.app.goo.gl) by following redirects
// Returns the final URL so the client can parse lat/lng from it

const https = require('https');
const http = require('http');

function followRedirects(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return resolve(url);

    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 5000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        followRedirects(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
      } else {
        // If not a redirect, read the body and look for a meta refresh or canonical URL
        let body = '';
        res.on('data', chunk => { body += chunk.toString().slice(0, 5000); }); // limit read
        res.on('end', () => {
          // Google sometimes embeds the real URL in the page
          const canonical = body.match(/href="(https:\/\/www\.google\.com\/maps\/[^"]+)"/);
          if (canonical) return resolve(canonical[1]);
          const metaRefresh = body.match(/url=(https?:\/\/[^"'\s>]+)/i);
          if (metaRefresh) return resolve(metaRefresh[1]);
          resolve(url); // return whatever we ended up at
        });
      }
    });
    req.on('error', () => resolve(url)); // fail gracefully
    req.on('timeout', () => { req.destroy(); resolve(url); });
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { url } = event.queryStringParameters || {};
  if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing url parameter' }) };

  try {
    const resolvedUrl = await followRedirects(url);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, resolvedUrl })
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: false, error: e.message, resolvedUrl: url })
    };
  }
};
