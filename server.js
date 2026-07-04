const http = require('http');
const https = require('https');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

function callClaude(prompt, reports, callback) {
  // Build message content — text prompt first, then any reports
  const userContent = [];

  // Add reports (images or PDFs) if provided
  if (reports && reports.length > 0) {
    reports.forEach(r => {
      if (r.type === 'image') {
        userContent.push({
          type: 'image',
          source: { type: 'base64', media_type: r.mediaType, data: r.base64 }
        });
      } else {
        // PDF or document
        userContent.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: r.base64 }
        });
      }
    });
    // Add instruction to read reports
    userContent.push({
      type: 'text',
      text: 'Above are the patient\'s medical reports. Please read all values carefully and incorporate findings into the plan below.\n\n' + prompt
    });
  } else {
    // No reports — just text prompt
    userContent.push({ type: 'text', text: prompt });
  }

  const payload = JSON.stringify({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: userContent }]
  });

  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  console.log('Calling Claude, reports:', reports ? reports.length : 0, ', key prefix:', API_KEY ? API_KEY.substring(0,10) : 'MISSING');

  const apiReq = https.request(options, apiRes => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      console.log('Claude HTTP status:', apiRes.statusCode);
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) {
          console.error('Claude API error:', parsed.error.type, parsed.error.message);
          callback(null, parsed.error.message);
          return;
        }
        const text = parsed.content?.[0]?.text || 'No response.';
        console.log('Success! text length:', text.length);
        callback(text, null);
      } catch(e) {
        console.error('Parse error:', e.message, data.substring(0, 200));
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

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', keySet: !!API_KEY, keyPrefix: API_KEY ? API_KEY.substring(0,10) : 'none' }));
    return;
  }

  if (req.method === 'GET' && req.url === '/test') {
    callClaude('Say exactly: Hello SA Yoga Classes', null, (text, err) => {
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
      const { prompt, reports } = JSON.parse(body);
      console.log('Generate request, prompt length:', prompt.length, ', reports:', reports ? reports.length : 0);
      callClaude(prompt, reports || null, (text, err) => {
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
      res.end(JSON.stringify({ error: 'Invalid request: ' + e.message }));
    }
  });
});

server.listen(PORT, () => console.log(`SA Yoga backend running on port ${PORT}`));
