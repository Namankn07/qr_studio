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
// Dedicated Scan Result Page for All QR Formats
app.get('/scan-result', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  let adScripts = '';
  try {
    const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    adScripts = (indexHtml.match(/<script[\s\S]*?<\/script>/gi) || [])
      .filter((s) => /atOptions|invoke\.js|profitable|effectivegate|adsterra|highperformance/i.test(s))
      .join('\n');
  } catch (e) {}

  res.send(`<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>QR Scan Result — QR Studio</title>
  <meta name="robots" content="noindex, nofollow" />
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col">
  <header class="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-20">
    <div class="max-w-3xl mx-auto px-4 py-3.5 flex items-center justify-between">
      <a href="/" class="flex items-center gap-2.5 font-bold text-white text-lg">
        <span class="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-emerald-500 flex items-center justify-center text-sm font-extrabold">QR</span>
        <span>QR Studio</span>
      </a>
      <a href="/" class="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition">
        + Scan / Create QR
      </a>
    </div>
  </header>

  <main class="flex-1 max-w-2xl w-full mx-auto px-4 py-8">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-2xl">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
        <span id="qr-type-badge" class="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
          QR Decoded
        </span>
        <span id="qr-source-tag" class="text-xs text-slate-400"></span>
      </div>

      <h1 id="qr-title" class="text-xl sm:text-2xl font-bold text-white mb-4">Scanned QR Content</h1>

      <div id="parsed-details" class="hidden mb-4 p-4 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2 text-sm"></div>

      <div class="p-4 rounded-xl bg-slate-950 border border-slate-800 mb-5">
        <div class="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5 font-semibold">Raw Decoded Data</div>
        <pre id="raw-data-box" class="text-sm sm:text-base font-mono text-emerald-300 whitespace-pre-wrap break-all leading-relaxed"></pre>
      </div>

      <div class="flex flex-wrap gap-3">
        <a id="primary-action-btn" href="#" target="_blank" rel="noopener noreferrer"
          class="hidden flex-1 min-w-[160px] text-center px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-lg transition">
          Open Link
        </a>
        <button id="copy-result-btn" type="button"
          class="flex-1 min-w-[140px] px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition">
          Copy Content
        </button>
        <a href="/"
          class="w-full sm:w-auto text-center px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm transition">
          Scan Another QR
        </a>
      </div>
    </div>

    <div class="mt-6 flex justify-center overflow-x-auto">
      ${adScripts}
    </div>
  </main>

  <script>
    const params = new URLSearchParams(window.location.search);
    const rawData = (params.get('data') || '').trim();
    const source = params.get('source') || '';

    const rawBox = document.getElementById('raw-data-box');
    const badge = document.getElementById('qr-type-badge');
    const title = document.getElementById('qr-title');
    const sourceTag = document.getElementById('qr-source-tag');
    const primaryBtn = document.getElementById('primary-action-btn');
    const parsedBox = document.getElementById('parsed-details');
    const copyBtn = document.getElementById('copy-result-btn');

    if (source) sourceTag.textContent = 'Source: ' + source;
    rawBox.textContent = rawData || 'No QR data found.';

    function addDetailRow(label, value) {
      if (!value) return;
      parsedBox.classList.remove('hidden');
      const row = document.createElement('div');
      row.className = 'flex flex-wrap justify-between gap-2 border-b border-slate-800/80 pb-1.5 last:border-none last:pb-0';
      const k = document.createElement('span');
      k.className = 'text-slate-400 font-medium';
      k.textContent = label;
      const v = document.createElement('span');
      v.className = 'text-white font-semibold break-all';
      v.textContent = value;
      row.appendChild(k);
      row.appendChild(v);
      parsedBox.appendChild(row);
    }

    if (/^https?:\\/\\/[^\\s]+$/i.test(rawData) || (/^[a-zA-Z0-9-]+(\\.[a-zA-Z0-9-]+)+(\\/[^\\s]*)?$/i.test(rawData) && !rawData.includes('@'))) {
      const url = /^https?:\\/\\//i.test(rawData) ? rawData : 'https://' + rawData;
      badge.textContent = 'Website / URL';
      title.textContent = 'Website Link Detected';
      primaryBtn.textContent = 'Open Website';
      primaryBtn.href = url;
      primaryBtn.classList.remove('hidden');
    } else if (/^WIFI:/i.test(rawData)) {
      badge.textContent = 'Wi-Fi Network';
      title.textContent = 'Wi-Fi Credentials';
      const ssid = (rawData.match(/S:([^;]*)/i) || [])[1] || '';
      const pass = (rawData.match(/P:([^;]*)/i) || [])[1] || '';
      const type = (rawData.match(/T:([^;]*)/i) || [])[1] || 'WPA';
      addDetailRow('Network Name (SSID)', ssid);
      addDetailRow('Password', pass || '(No Password)');
      addDetailRow('Security', type);
      if (pass) {
        copyBtn.textContent = 'Copy Wi-Fi Password';
        copyBtn.dataset.copyText = pass;
      }
    } else if (/^BEGIN:VCARD/i.test(rawData)) {
      badge.textContent = 'Contact Card (vCard)';
      title.textContent = 'Contact Details';
      const fn = (rawData.match(/^FN:(.*)$/im) || [])[1] || '';
      const tel = (rawData.match(/^TEL[^:]*:(.*)$/im) || [])[1] || '';
      const email = (rawData.match(/^EMAIL[^:]*:(.*)$/im) || [])[1] || '';
      addDetailRow('Name', fn);
      addDetailRow('Phone', tel);
      addDetailRow('Email', email);
      const blob = new Blob([rawData], { type: 'text/vcard' });
      primaryBtn.href = URL.createObjectURL(blob);
      primaryBtn.download = (fn || 'contact') + '.vcf';
      primaryBtn.removeAttribute('target');
      primaryBtn.textContent = 'Save Contact (.vcf)';
      primaryBtn.classList.remove('hidden');
    } else if (/^upi:\\/\\//i.test(rawData)) {
      badge.textContent = 'UPI Payment';
      title.textContent = 'UPI Payment Link';
      const uParams = new URLSearchParams(rawData.split('?')[1] || '');
      addDetailRow('Payee Name', uParams.get('pn') || '');
      addDetailRow('UPI ID', uParams.get('pa') || '');
      addDetailRow('Amount', uParams.get('am') ? '₹' + uParams.get('am') : '');
      primaryBtn.href = rawData;
      primaryBtn.textContent = 'Open in UPI App';
      primaryBtn.classList.remove('hidden');
    } else if (/^mailto:/i.test(rawData)) {
      badge.textContent = 'Email Address';
      title.textContent = 'Email QR Code';
      primaryBtn.href = rawData;
      primaryBtn.textContent = 'Send Email';
      primaryBtn.classList.remove('hidden');
    } else if (/^tel:/i.test(rawData)) {
      badge.textContent = 'Phone Number';
      title.textContent = 'Phone Number QR';
      primaryBtn.href = rawData;
      primaryBtn.textContent = 'Call Number';
      primaryBtn.classList.remove('hidden');
    } else {
      badge.textContent = 'Text / Data QR';
      title.textContent = 'Decoded Text / Information';
    }

    copyBtn.addEventListener('click', () => {
      const textToCopy = copyBtn.dataset.copyText || rawData;
      navigator.clipboard.writeText(textToCopy).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy Content'; }, 1800);
      });
    });
  </script>
</body>
</html>`);
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