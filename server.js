require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load all configured Cloudinary accounts (Primary + Extra Pool Accounts)
function getCloudPool() {
  const accounts = [];

  if (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  ) {
    accounts.push({
      name: 'Cloud-Node-1',
      cloudName: process.env.CLOUDINARY_CLOUD_NAME.trim(),
      apiKey: process.env.CLOUDINARY_API_KEY.trim(),
      apiSecret: process.env.CLOUDINARY_API_SECRET.trim(),
    });
  }

  Object.keys(process.env)
    .filter((k) => /^CLOUDINARY_URL_\d+$/.test(k))
    .sort()
    .forEach((key, idx) => {
      const val = (process.env[key] || '').trim();
      const match = val.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
      if (match) {
        accounts.push({
          name: `Cloud-Node-${idx + 2}`,
          apiKey: match[1],
          apiSecret: match[2],
          cloudName: match[3],
        });
      }
    });

  return accounts;
}

// Automated SEO: robots.txt & sitemap.xml for Google Indexing
app.get('/robots.txt', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.type('text/plain');
  res.send(`User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`);
});

// Public Config Endpoint (Injects Ad Script from Render Env without touching code)
app.get('/api/monetization-config', (req, res) => {
  res.json({
    adScriptUrl: (process.env.AD_SCRIPT_URL || '').trim(),
    upiId: (process.env.CREATOR_UPI_ID || '').trim(),
  });
});

// Check active cloud pool capacity
app.get('/api/cloud-status', (req, res) => {
  const pool = getCloudPool();
  res.json({
    activeNodes: pool.length,
    totalEstimatedStorageGB: pool.length * 25,
    nodes: pool.map((p) => ({ name: p.name, cloudName: p.cloudName })),
  });
});

// 1. Sign Direct Upload using Load-Balanced Cloud Pool
app.post('/api/sign-upload', (req, res) => {
  try {
    const pool = getCloudPool();
    if (!pool.length) {
      return res.status(500).json({ error: 'No cloud storage nodes configured.' });
    }

    const selected = pool[Math.floor(Math.random() * pool.length)];
    const timestamp = Math.round(Date.now() / 1000);
    const folder = 'qr_studio_uploads';

    const toSign = `folder=${folder}&timestamp=${timestamp}${selected.apiSecret}`;
    const signature = crypto.createHash('sha1').update(toSign).digest('hex');

    res.json({
      timestamp,
      signature,
      folder,
      cloudName: selected.cloudName,
      apiKey: selected.apiKey,
      nodeName: selected.name,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to sign upload request' });
  }
});

// 2. Create Permanent Shareable Viewer URL
app.post('/api/create-share-link', (req, res) => {
  const { cloudUrl, fileType, title } = req.body;
  if (!cloudUrl || !cloudUrl.startsWith('https://res.cloudinary.com/')) {
    return res.status(400).json({ error: 'Invalid cloud URL' });
  }

  const encodedUrl = Buffer.from(cloudUrl).toString('base64url');
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const shareUrl = `${baseUrl}/view?u=${encodedUrl}&t=${encodeURIComponent(fileType || 'img')}&n=${encodeURIComponent(title || 'Shared File')}`;

  res.json({ success: true, shareUrl });
});
// Auto SEO Robots & Sitemap
app.get('/robots.txt', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const today = new Date().toISOString().split('T')[0];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`);
});
// 3. Self-Promoting & Monetized Shared File Viewer (/view)
app.get('/view', (req, res) => {
  const { u, t, n } = req.query;
  if (!u) return res.status(400).send('<h2>Invalid QR Link</h2>');

  let cloudUrl = '';
  try {
    cloudUrl = Buffer.from(u, 'base64url').toString('utf8');
  } catch {
    return res.status(400).send('<h2>Corrupted Link</h2>');
  }

  if (!cloudUrl.startsWith('https://res.cloudinary.com/')) {
    return res.status(403).send('<h2>Unauthorized File Source</h2>');
  }

  const title = (n || 'Shared File').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const isPdf = t === 'pdf' || cloudUrl.toLowerCase().endsWith('.pdf');
  const isVideo = t === 'video' || /\.(mp4|webm|mov|mkv|avi)$/i.test(cloudUrl);
  const adScriptUrl = (process.env.AD_SCRIPT_URL || '').trim();

  const optimizedVideoUrl = isVideo
    ? cloudUrl.replace('/video/upload/', '/video/upload/q_auto,f_auto/')
    : cloudUrl;

  let mediaMarkup = '';
  if (isVideo) {
    mediaMarkup = `
      <video controls autoplay playsinline preload="metadata" src="${optimizedVideoUrl}">
        Your browser does not support HTML5 video playback.
      </video>`;
  } else if (isPdf) {
    mediaMarkup = `<iframe src="https://docs.google.com/gview?url=${encodeURIComponent(cloudUrl)}&embedded=true"></iframe>`;
  } else {
    mediaMarkup = `<img src="${cloudUrl}" alt="${title}" />`;
  }

  const adTag = adScriptUrl
    ? `<script async src="${adScriptUrl.replace(/"/g, '&quot;')}"></script>`
    : '';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — QR Studio</title>
  ${adTag}
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #090d16; color: #f8fafc; display: flex; flex-direction: column; min-height: 100vh; }
    header { padding: 14px 20px; background: #111827; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1f2937; gap: 12px; }
    h1 { font-size: 1rem; margin: 0; word-break: break-word; }
    .actions { display: flex; gap: 10px; align-items: center; }
    a.btn { background: #10b981; color: #fff; text-decoration: none; padding: 8px 14px; border-radius: 10px; font-weight: 600; font-size: 0.82rem; white-space: nowrap; }
    a.btn-secondary { background: #4f46e5; color: #fff; text-decoration: none; padding: 8px 14px; border-radius: 10px; font-weight: 600; font-size: 0.82rem; white-space: nowrap; }
    main { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 16px; gap: 16px; }
    img, video { max-width: 100%; max-height: 78vh; border-radius: 14px; box-shadow: 0 12px 36px rgba(0,0,0,0.65); background: #000; }
    video { width: 100%; max-width: 960px; outline: none; }
    iframe { width: 100%; height: 78vh; border: none; border-radius: 14px; background: #fff; }
    footer { padding: 14px 20px; background: #0f172a; border-top: 1px solid #1e293b; text-align: center; font-size: 0.82rem; color: #94a3b8; }
    footer a { color: #818cf8; font-weight: 600; text-decoration: none; }
  </style>
</head>
<body>
  <header>
    <h1>${title}</h1>
    <div class="actions">
      <a class="btn-secondary" href="/">+ Create Free QR</a>
      <a class="btn" href="${cloudUrl}" target="_blank" download>Download</a>
    </div>
  </header>
  <main>
    ${mediaMarkup}
  </main>
  <footer>
    Powered by <a href="/">QR Studio</a> — Convert any Photo, PDF, Video, or Link into a scannable QR code for free.
  </footer>
</body>
</html>`);
});

// 4. Permanently Delete Video/File from Cloudinary
app.post('/api/delete-cloud-media', async (req, res) => {
  try {
    const { cloudUrl } = req.body;
    if (!cloudUrl || !cloudUrl.includes('res.cloudinary.com/')) {
      return res.json({ success: true, skipped: true });
    }

    const match = cloudUrl.match(
      /^https:\/\/res\.cloudinary\.com\/([^/]+)\/(video|image|raw)\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/
    );

    if (!match) {
      return res.status(400).json({ error: 'Could not parse Cloudinary file path' });
    }

    const [, cloudName, resourceType, publicId] = match;
    const pool = getCloudPool();
    const node = pool.find((p) => p.cloudName === cloudName);

    if (!node) {
      return res.status(404).json({ error: 'Matching Cloud Node credentials not found' });
    }

    const timestamp = Math.round(Date.now() / 1000);
    const toSign = `public_id=${publicId}&timestamp=${timestamp}${node.apiSecret}`;
    const signature = crypto.createHash('sha1').update(toSign).digest('hex');

    const formBody = new URLSearchParams({
      public_id: publicId,
      api_key: node.apiKey,
      timestamp: String(timestamp),
      signature,
    });

    const destroyRes = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
      }
    );

    const destroyData = await destroyRes.json();
    if (destroyData.result === 'ok' || destroyData.result === 'not found') {
      return res.json({ success: true, result: destroyData.result });
    }

    return res.status(500).json({ error: destroyData.error?.message || 'Cloud deletion failed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error while deleting from cloud' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`QR Studio running on port ${PORT}`);
});