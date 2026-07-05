const http = require('http');
const https = require('https');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;
const MAX_BODY_SIZE = 20 * 1024 * 1024; // 20MB limit

function callClaude(prompt, reports, callback) {
  const userContent = [];
  const hasImages = reports && reports.some(r => r.type === 'image');
  const hasPDFs = reports && reports.some(r => r.type === 'document');

  // Add each report
  if (reports && reports.length > 0) {
    reports.forEach(r => {
      if (r.type === 'image') {
        userContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: r.mediaType || 'image/jpeg',
            data: r.base64
          }
        });
      } else {
        // PDF
        userContent.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: r.base64
          }
        });
      }
    });

    userContent.push({
      type: 'text',
      text: 'The above are the patient\'s medical reports (Thyrocare lab reports). Read every single value carefully. Extract all test results. In the Clinical Assessment section of your response, list EVERY test with its value, unit, normal range, and status (HIGH/LOW/NORMAL). Then incorporate all findings into the diet and supplement plan.\n\n' + prompt
    });
  } else {
    userContent.push({ type: 'text', text: prompt });
  }

  // Build headers - include PDF beta only when PDFs are present
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
    'anthropic-version': '2023-06-01'
  };
  // Native PDF support (base64 document blocks) is now GA — no beta header needed.

  const bodyObj = {
    model: 'claude-opus-4-6',
    max_tokens: 16000,
    messages: [{ role: 'user', content: userContent }]
  };

  const payload = JSON.stringify(bodyObj);
  headers['Content-Length'] = Buffer.byteLength(payload, 'utf8');

  console.log('=== CLAUDE CALL ===');
  console.log('Reports:', reports ? reports.length : 0);
  console.log('Has PDFs:', hasPDFs, '| Has images:', hasImages);
  console.log('Payload size:', Math.round(payload.length / 1024), 'KB');
  console.log('PDF beta header: none (native PDF support is GA)');
  console.log('Key prefix:', API_KEY ? API_KEY.substring(0, 12) : 'MISSING');

  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers,
    timeout: 120000 // 2 minute timeout
  };

  const apiReq = https.request(options, apiRes => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      console.log('Claude HTTP status:', apiRes.statusCode);
      console.log('Response size:', data.length, 'chars');
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) {
          console.error('Claude API error:', parsed.error.type, '-', parsed.error.message);
          callback(null, 'Claude API error: ' + parsed.error.message);
          return;
        }
        const text = (parsed.content || []).map(b => b.type === 'text' ? b.text : '').join('');
        if (!text) {
          console.error('No text in response:', JSON.stringify(parsed).substring(0, 300));
          callback(null, 'No text in Claude response');
          return;
        }
        console.log('Success! Response length:', text.length);
        callback(text, null);
      } catch(e) {
        console.error('Parse error:', e.message);
        console.error('Raw response:', data.substring(0, 500));
        callback(null, 'Parse error: ' + e.message);
      }
    });
  });

  apiReq.on('timeout', () => {
    console.error('Request timed out');
    apiReq.destroy();
    callback(null, 'Request timed out — PDF may be too large. Try uploading a smaller file.');
  });

  apiReq.on('error', e => {
    console.error('Network error:', e.message);
    callback(null, 'Network error: ' + e.message);
  });

  apiReq.write(payload, 'utf8');
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
      version: 'v2-no-pdf-beta-2026-07-05',
      keySet: !!API_KEY,
      keyPrefix: API_KEY ? API_KEY.substring(0, 10) : 'none',
      maxBodyMB: MAX_BODY_SIZE / 1024 / 1024
    }));
    return;
  }

  if (req.method === 'GET' && req.url === '/test') {
    callClaude('Say exactly: Hello SA Yoga Classes — backend is working!', null, (text, err) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text, err }));
    });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/generate') {
    res.writeHead(404); res.end('Not found'); return;
  }

  // Accumulate body with size limit
  let body = '';
  let bodySize = 0;

  req.on('data', chunk => {
    bodySize += chunk.length;
    if (bodySize > MAX_BODY_SIZE) {
      console.error('Request body too large:', Math.round(bodySize / 1024 / 1024), 'MB');
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request too large. Please upload smaller files (max 15MB total).' }));
      req.destroy();
      return;
    }
    body += chunk;
  });

  req.on('end', () => {
    if (res.headersSent) return;
    try {
      const parsed = JSON.parse(body);
      const { prompt, reports } = parsed;

      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No prompt provided' }));
        return;
      }

      console.log('Generate request:');
      console.log('  Prompt length:', prompt.length);
      console.log('  Reports count:', reports ? reports.length : 0);
      if (reports) {
        reports.forEach((r, i) => {
          console.log(`  Report ${i+1}: ${r.name}, type: ${r.type}, size: ${Math.round((r.base64||'').length * 0.75 / 1024)}KB`);
        });
      }

      callClaude(prompt, reports || null, (text, err) => {
        if (res.headersSent) return;
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ text }));
        }
      });

    } catch(e) {
      console.error('JSON parse error:', e.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON: ' + e.message }));
    }
  });

  req.on('error', e => {
    console.error('Request error:', e.message);
  });
});

server.timeout = 150000; // 2.5 minutes server timeout
server.listen(PORT, () => {
  console.log('=== SERVER VERSION: v2-no-pdf-beta-2026-07-05 ===');
  console.log(`SA Yoga backend running on port ${PORT}`);
  console.log(`API key set: ${!!API_KEY}`);
  console.log(`Max body size: ${MAX_BODY_SIZE / 1024 / 1024}MB`);
});
