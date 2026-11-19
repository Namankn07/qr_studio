require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const streamifier = require('streamifier');
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP, GIF, and PDF files are allowed!'));
  }
});

const uploadToCloudinary = (buffer, originalName, mimetype, title, description) => {
  return new Promise((resolve, reject) => {
    const isPdf = mimetype === 'application/pdf';
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'qr_studio_uploads',
        resource_type: isPdf ? 'raw' : 'image',
        public_id: `${Date.now()}_${path.parse(originalName).name.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        format: isPdf ? 'pdf' : undefined,
        context: {
          title: (title || originalName).replace(/[|=]/g, ' '),
          description: (description || '').replace(/[|=]/g, ' ')
        }
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file selected' });

    const result = await uploadToCloudinary(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      req.body.title,
      req.body.description
    );

    const encodedUrl = Buffer.from(result.secure_url).toString('base64url');
    const isPdf = req.file.mimetype === 'application/pdf';
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const shareUrl = `${baseUrl}/view?u=${encodedUrl}&t=${isPdf ? 'pdf' : 'img'}&n=${encodeURIComponent(req.body.title || req.file.originalname)}`;

    res.json({ success: true, shareUrl, cloudUrl: result.secure_url });
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ error: err.message || 'Cloud upload failed' });
  }
});

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

  const title = (n || 'Shared Document').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const isPdf = t === 'pdf' || cloudUrl.toLowerCase().endsWith('.pdf');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — QR Studio</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; flex-direction: column; min-height: 100vh; }
    header { padding: 14px 22px; background: #1e293b; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; }
    h1 { font-size: 1.05rem; margin: 0; }
    a.btn { background: #10b981; color: #fff; text-decoration: none; padding: 9px 16px; border-radius: 8px; font-weight: 600; font-size: 0.88rem; }
    main { flex: 1; display: flex; justify-content: center; align-items: center; padding: 16px; }
    img { max-width: 100%; max-height: 84vh; border-radius: 12px; }
    iframe { width: 100%; height: 84vh; border: none; border-radius: 12px; background: #fff; }
  </style>
</head>
<body>
  <header>
    <h1>${title}</h1>
    <a class="btn" href="${cloudUrl}" target="_blank" download>Download</a>
  </header>
  <main>
    ${isPdf
      ? `<iframe src="https://docs.google.com/gview?url=${encodeURIComponent(cloudUrl)}&embedded=true"></iframe>`
      : `<img src="${cloudUrl}" alt="${title}" />`
    }
  </main>
</body>
</html>`);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`QR Studio server running at http://localhost:${PORT}`);
});