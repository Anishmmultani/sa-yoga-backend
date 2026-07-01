const http = require('http');
const https = require('https');

const API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;

function callGemini(prompt, callback) {
  const payload = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 2048, temperature: 0.7 }
  });

  // Try v1 instead of v1beta
  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1/models/gemini-1.5-flash:generateContent?key=${API_KEY}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  console.log('Calling Gemini v1, key prefix:', API_KEY ? API_KEY.substring(0, 10) : 'MISSING');

  const apiReq = https.request(options, apiRes => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      console.log('Gemini HTTP status:', apiRes.statusCode);
      console.log('Gemini response preview:', data.substring(0, 300));
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) {
          console.error('Gemini API error:', parsed.error.code, parsed.error.message);
          // Try v1beta as fallback
          callGeminiBeta(prompt, callback);
          return;
        }
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
        console.log('Success! text length:', text.length);
        callback(text, null);
      } catch(e) {
        console.error('Parse error:', e.message);
        callback(null, 'Parse error: ' + e.message);
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

function callGeminiBeta(prompt, callback) {
  const payload = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 2048, temperature: 0.7 }
  });

  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  console.log('Trying v1beta fallback...');

  const apiReq = https.request(options, apiRes => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      console.log('v1beta status:', apiRes.statusCode);
      console.log('v1beta response:', data.substring(0, 300));
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) {
          console.error('v1beta error:', parsed.error.code, parsed.error.message);
          callback(null, parsed.error.message);
          return;
        }
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
        callback(text, null);
      } catch(e) {
        callback(null, 'Parse error');
      }
    });
  });

  apiReq.on('error', e => callback(null, e.message));
  apiReq.write(payload);
  apiReq.end();
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      keySet: !!API_KEY, 
      keyPrefix: API_KEY ? API_KEY.substring(0,10) : 'none',
      keyLength: API_KEY ? API_KEY.length : 0
    }));
    return;
  }

  if (req.method === 'GET' && req.url === '/test') {
    callGemini('Say exactly: Hello SA Yoga', (text, err) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text, err }));
    });
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
      console.log('Generate request received, prompt length:', prompt.length);
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
