// Vercel Serverless Function
// POST /api/route
// body: { origin: {lat, lng}, destination: {lat, lng} }
//
// Calls Google Maps Platform Routes API (current v2, computeRoutes) with
// travelMode TRANSIT and departureTime = now, so results reflect real,
// currently-running trains/buses rather than a generic daytime schedule.
// If no transit route is currently available (e.g. late at night), this
// returns { available: false } — it deliberately does NOT make a second
// API call for a walking fallback. This app is for comparing options
// before deciding where to go, not for turn-by-turn navigation; once a
// choice is made, the frontend hands off to Apple Maps for that. So one
// store lookup == at most one Google Routes API call.
//
// The Google Maps API key lives only in the Vercel environment variable
// GOOGLE_MAPS_API_KEY and is never sent to the browser.

const ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';

// Restrict this to your actual GitHub Pages origin once you know it, e.g.
// 'https://your-username.github.io'. '*' works but allows any site to call
// your proxy (still safe for cost, since your key never leaves the server,
// but restricting is better practice).
const ALLOWED_ORIGIN = '*';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function callRoutes(apiKey, origin, destination, travelMode, departureTimeIso) {
  const fieldMask = travelMode === 'TRANSIT'
    ? 'routes.duration,routes.travelAdvisory.transitFare,routes.legs.steps.transitDetails,routes.legs.steps.travelMode'
    : 'routes.duration';

  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode: travelMode,
    departureTime: departureTimeIso
  };

  const resp = await fetch(ROUTES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    // Log server-side for debugging; don't leak details to the client.
    const text = await resp.text().catch(function () { return ''; });
    console.error('Routes API error', resp.status, text);
    return null;
  }

  const data = await resp.json();
  if (!data.routes || data.routes.length === 0) return null;
  return data.routes[0];
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'server_misconfigured' });
    return;
  }

  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }

  var origin = body && body.origin;
  var destination = body && body.destination;

  if (!origin || !destination ||
      typeof origin.lat !== 'number' || typeof origin.lng !== 'number' ||
      typeof destination.lat !== 'number' || typeof destination.lng !== 'number') {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }

  const departureTimeIso = new Date().toISOString();

  try {
    const transitRoute = await callRoutes(apiKey, origin, destination, 'TRANSIT', departureTimeIso);

    if (transitRoute && transitRoute.duration) {
      const seconds = parseInt(String(transitRoute.duration).replace('s', ''), 10);
      const arrivalIso = new Date(Date.now() + seconds * 1000).toISOString();

      let fare = null;
      const tf = transitRoute.travelAdvisory && transitRoute.travelAdvisory.transitFare;
      if (tf) {
        const amount = Number(tf.units || 0) + (Number(tf.nanos || 0) / 1e9);
        fare = { currencyCode: tf.currencyCode, amount: amount };
      }

      res.status(200).json({
        available: true,
        durationSeconds: seconds,
        arrivalTime: arrivalIso,
        fare: fare
      });
      return;
    }

    // No transit route currently running (e.g. late night). This app is only
    // meant for comparing options before deciding where to go — actual
    // navigation (including walking directions, if needed) happens in Apple
    // Maps afterwards — so we deliberately do NOT make a second Google API
    // call for a walking fallback here. One store == at most one Routes API
    // call.
    res.status(200).json({ available: false });
  } catch (err) {
    console.error('route handler error', err);
    res.status(502).json({ error: 'upstream_failed' });
  }
};
