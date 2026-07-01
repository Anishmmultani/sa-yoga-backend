const http = require('http');
const https = require('https');

const API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;

function callGemini(prompt, callback) {
  const payload = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 2048, temperature: 0.7 }
  });

  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${API_KEY}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  console.log('Calling Gemini, key prefix:', API_KEY ? API_KEY.substring(0, 8) : 'MISSING');

  const apiReq = https.request(options, apiRes => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      console.log('Gemini HTTP status:', apiRes.statusCode);
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) {
          console.error('Gemini API error:', JSON.stringify(parsed.error));
          callback(null, 'API Error: ' + parsed.error.message);
          return;
        }
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
        callback(text, null);
      } catch(e) {
        console.error('Parse error:', data.substring(0, 300));
        callback(null, 'Parse error');
      }
    });
  });

  apiReq.on('error', e => {
    console.error('Network error:', e.message);
    callback(null, e.message);
  });
  apiReq.write(payload);
  apiReq.end();
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', keySet: !!API_KEY, keyPrefix: API_KEY ? API_KEY.substring(0,8) : 'none' }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/generate') {
    res.writeHead(404); res.end('Not found'); return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { prompt } = JSON.parse(body);
      callGemini(prompt, (text, err) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ text }));
        }
      });
    } catch(e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request' }));
    }
  });
});

server.listen(PORT, () => console.log(`SA Yoga backend running on port ${PORT}`));
