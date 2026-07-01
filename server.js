const http = require('http');
const https = require('https');

const API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/generate') {
    res.writeHead(404); res.end('Not found'); return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { prompt } = JSON.parse(body);
      const payload = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0.7 }
      });

      const options = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      };

      const apiReq = https.request(options, apiRes => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ text }));
          } catch(e) {
            res.writeHead(500); res.end(JSON.stringify({ error: 'Parse error' }));
          }
        });
      });

      apiReq.on('error', e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
      apiReq.write(payload);
      apiReq.end();
    } catch(e) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid request' }));
    }
  });
});

server.listen(PORT, () => console.log(`SA Yoga backend running on port ${PORT}`));
