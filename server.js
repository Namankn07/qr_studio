require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3000;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. Generate Secure Cloudinary Signature for Direct Browser Upload (Zero Server RAM load)
app.post('/api/sign-upload', (req, res) => {
  try {
    const timestamp = Math.round(Date.now() / 1000);
    const folder = 'qr_studio_uploads';

    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder },
      process.env.CLOUDINARY_API_SECRET
    );

    res.json({
      timestamp,
      signature,
      folder,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not generate upload signature' });
  }
});

// 2. Build Permanent Shareable Viewer URL from Uploaded Cloud URL
app.post('/api/create-share-link', (req, res) => {
  const { cloudUrl, fileType, title } = req.body;
  if (!cloudUrl || !cloudUrl.startsWith('https://res.cloudinary.com/')) {
    return res.status(400).json({ error: 'Invalid Cloudinary URL' });
  }

  const encodedUrl = Buffer.from(cloudUrl).toString('base64url');
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const shareUrl = `${baseUrl}/view?u=${encodedUrl}&t=${encodeURIComponent(fileType || 'img')}&n=${encodeURIComponent(title || 'Shared File')}`;

  res.json({ success: true, shareUrl });
});

// 3. Permanent Shared Viewer Page (Supports Photo, Multi-Page PDF & Smooth Video Streaming)
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

  // Optimize video delivery URL for fast adaptive streaming
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

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — QR Studio</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #090d16; color: #f8fafc; display: flex; flex-direction: column; min-height: 100vh; }
    header { padding: 14px 20px; background: #111827; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1f2937; gap: 12px; }
    h1 { font-size: 1rem; margin: 0; word-break: break-word; }
    a.btn { background: #10b981; color: #fff; text-decoration: none; padding: 9px 16px; border-radius: 10px; font-weight: 600; font-size: 0.85rem; shrink: 0; white-space: nowrap; }
    main { flex: 1; display: flex; justify-content: center; align-items: center; padding: 16px; }
    img, video { max-width: 100%; max-height: 84vh; border-radius: 14px; box-shadow: 0 12px 36px rgba(0,0,0,0.65); background: #000; }
    video { width: 100%; max-width: 960px; outline: none; }
    iframe { width: 100%; height: 84vh; border: none; border-radius: 14px; background: #fff; }
  </style>
</head>
<body>
  <header>
    <h1>${title}</h1>
    <a class="btn" href="${cloudUrl}" target="_blank" download>Download</a>
  </header>
  <main>${mediaMarkup}</main>
</body>
</html>`);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`QR Studio server running on port ${PORT}`);
});