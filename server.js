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

// =========================================================================
// UNIVERSAL MEDIA DOWNLOADER API (yt-dlp + MULTI-ENGINE - ZERO STORAGE)
// =========================================================================
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

const YT_DLP_BIN = path.join(
  os.tmpdir(),
  process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
);
let ytDlpReadyPromise = null;

// Auto-download standalone yt-dlp binary on server boot (No Python needed)
function ensureYtDlpBinary() {
  if (ytDlpReadyPromise) return ytDlpReadyPromise;

  ytDlpReadyPromise = (async () => {
    try {
      if (fs.existsSync(YT_DLP_BIN) && fs.statSync(YT_DLP_BIN).size > 1000000) {
        return YT_DLP_BIN;
      }
      const downloadUrl =
        process.platform === 'win32'
          ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
          : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

      console.log('Downloading latest yt-dlp binary...');
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error(`Failed to fetch yt-dlp: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(YT_DLP_BIN, buffer);
      if (process.platform !== 'win32') {
        fs.chmodSync(YT_DLP_BIN, 0o755);
      }
      console.log('yt-dlp binary ready!');
      return YT_DLP_BIN;
    } catch (err) {
      ytDlpReadyPromise = null;
      console.error('yt-dlp setup error:', err.message);
      return null;
    }
  })();

  return ytDlpReadyPromise;
}

// Warm up binary immediately when server starts
ensureYtDlpBinary();

function isBlockedHost(hostname) {
  const h = (hostname || '').toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    h.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

function runYtDlpExtract(binPath, targetUrl) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-single-json',
      '--no-warnings',
      '--no-playlist',
      '--no-check-certificates',
      '--geo-bypass',
      '--extractor-args',
      'youtube:player_client=tv,mweb,web',
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ];

    if (process.env.YT_COOKIES) {
      const cookiePath = path.join(os.tmpdir(), 'yt_cookies.txt');
      const cookieContent = process.env.YT_COOKIES.replace(/\\n/g, '\n');
      fs.writeFileSync(cookiePath, cookieContent);
      args.push('--cookies', cookiePath);
    }

    args.push(targetUrl);

    execFile(binPath, args, { timeout: 55000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseErr) {
        reject(new Error('Invalid media metadata received'));
      }
    });
  });
}

// Helper: Fetch with clean timeout
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Helper: Extract 11-char YouTube Video ID
function extractYouTubeId(rawUrl) {
  const m = rawUrl.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|v\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

// Engine A: Unblocked YouTube Extractor (Piped + Invidious Mirrors - No Cookies Needed)
async function extractYouTubeUnblocked(videoId, mode) {
  const pipedNodes = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://api.piped.private.coffee',
    'https://pipedapi.nosebs.ru',
  ];

  for (const node of pipedNodes) {
    try {
      const r = await fetchWithTimeout(
        `${node}/streams/${videoId}`,
        { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } },
        8000
      );
      if (!r.ok) continue;
      const data = await r.json();
      const title = (data.title || 'YouTube_Video').slice(0, 110);
      const safeBase = title.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 45) || 'youtube_video';
      const thumbnail = data.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      const items = [];

      if (mode === 'audio') {
        const audios = (data.audioStreams || [])
          .filter((a) => a.url && /^https?:/.test(a.url))
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        if (audios[0]) {
          const ext = (audios[0].format || '').toLowerCase().includes('webm') ? 'webm' : 'm4a';
          const fname = `${safeBase}_audio.${ext}`;
          items.push({
            label: `Download Audio (${Math.round((audios[0].bitrate || 128000) / 1000)}kbps ${ext.toUpperCase()})`,
            filename: fname,
            proxyUrl: `/api/proxy-download?url=${encodeURIComponent(audios[0].url)}&filename=${encodeURIComponent(fname)}`,
            directUrl: audios[0].url,
          });
        }
      } else {
        const muxed = (data.videoStreams || [])
          .filter((v) => v.url && /^https?:/.test(v.url) && v.videoOnly === false)
          .sort((a, b) => parseInt(b.quality || '0', 10) - parseInt(a.quality || '0', 10));

        const seen = new Set();
        for (const v of muxed) {
          const q = v.quality || 'HD';
          if (seen.has(q)) continue;
          seen.add(q);
          const ext = (v.format || 'mp4').toLowerCase().includes('webm') ? 'webm' : 'mp4';
          const fname = `${safeBase}_${q}.${ext}`;
          items.push({
            label: `Download Video (${q} ${ext.toUpperCase()})`,
            filename: fname,
            proxyUrl: `/api/proxy-download?url=${encodeURIComponent(v.url)}&filename=${encodeURIComponent(fname)}`,
            directUrl: v.url,
          });
          if (items.length >= 2) break;
        }
      }

      if (items.length > 0) {
        return { success: true, platform: 'YouTube', title, thumbnail, items };
      }
    } catch (e) {}
  }

  const invidiousNodes = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://yewtu.be',
  ];

  for (const node of invidiousNodes) {
    try {
      const r = await fetchWithTimeout(
        `${node}/api/v1/videos/${videoId}`,
        { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } },
        8000
      );
      if (!r.ok) continue;
      const data = await r.json();
      const title = (data.title || 'YouTube_Video').slice(0, 110);
      const safeBase = title.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 45) || 'youtube_video';
      const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      const items = [];

      if (mode === 'audio') {
        const audios = (data.adaptiveFormats || [])
          .filter((f) => f.url && (f.type || '').startsWith('audio/'))
          .sort((a, b) => parseInt(b.bitrate || '0', 10) - parseInt(a.bitrate || '0', 10));
        if (audios[0]) {
          const ext = (audios[0].container || 'm4a').toLowerCase();
          const fname = `${safeBase}_audio.${ext}`;
          items.push({
            label: `Download Audio (${ext.toUpperCase()})`,
            filename: fname,
            proxyUrl: `/api/proxy-download?url=${encodeURIComponent(audios[0].url)}&filename=${encodeURIComponent(fname)}`,
            directUrl: audios[0].url,
          });
        }
      } else {
        const streams = (data.formatStreams || [])
          .filter((f) => f.url && /^https?:/.test(f.url))
          .sort((a, b) => parseInt(b.qualityLabel || '0', 10) - parseInt(a.qualityLabel || '0', 10));

        for (const s of streams.slice(0, 2)) {
          const q = s.qualityLabel || '720p';
          const ext = (s.container || 'mp4').toLowerCase();
          const fname = `${safeBase}_${q}.${ext}`;
          items.push({
            label: `Download Video (${q} ${ext.toUpperCase()})`,
            filename: fname,
            proxyUrl: `/api/proxy-download?url=${encodeURIComponent(s.url)}&filename=${encodeURIComponent(fname)}`,
            directUrl: s.url,
          });
        }
      }

      if (items.length > 0) {
        return { success: true, platform: 'YouTube', title, thumbnail, items };
      }
    } catch (e) {}
  }

  return null;
}

// Engine B: Fast Social Extractors (X/Twitter, TikTok, Instagram Embed, Facebook)
async function extractSocialFast(rawUrl, host, mode) {
  // 1. X / Twitter via FxTwitter API
  if (host.includes('twitter.com') || host.includes('x.com')) {
    try {
      const apiUrl = rawUrl.replace(/^https?:\/\/(www\.)?(twitter\.com|x\.com)/i, 'https://api.fxtwitter.com');
      const r = await fetchWithTimeout(apiUrl, { headers: { 'User-Agent': 'QRStudioBot/1.0' } }, 8000);
      if (r.ok) {
        const data = await r.json();
        const videos = data?.tweet?.media?.videos || [];
        if (videos[0]?.url) {
          const fname = `x_video_${Date.now()}.mp4`;
          return {
            success: true,
            platform: 'X (Twitter)',
            title: (data.tweet.text || 'X Video').slice(0, 100),
            thumbnail: videos[0].thumbnail_url || '',
            items: [
              {
                label: 'Download Video (HD MP4)',
                filename: fname,
                proxyUrl: `/api/proxy-download?url=${encodeURIComponent(videos[0].url)}&filename=${encodeURIComponent(fname)}`,
                directUrl: videos[0].url,
              },
            ],
          };
        }
      }
    } catch (e) {}
  }

  // 2. TikTok via TikWM API (HD No-Watermark)
  if (host.includes('tiktok.com')) {
    try {
      const r = await fetchWithTimeout(
        `https://www.tikwm.com/api/?url=${encodeURIComponent(rawUrl)}`,
        { headers: { Accept: 'application/json' } },
        9000
      );
      if (r.ok) {
        const data = await r.json();
        const d = data?.data;
        if (d) {
          const mediaUrl = mode === 'audio' ? (d.music || d.play) : (d.hdplay || d.play);
          if (mediaUrl) {
            const ext = mode === 'audio' ? 'mp3' : 'mp4';
            const fname = `tiktok_${Date.now()}.${ext}`;
            return {
              success: true,
              platform: 'TikTok',
              title: (d.title || 'TikTok Video').slice(0, 100),
              thumbnail: d.cover || '',
              items: [
                {
                  label: mode === 'audio' ? 'Download Audio (MP3)' : 'Download Video (No Watermark HD)',
                  filename: fname,
                  proxyUrl: `/api/proxy-download?url=${encodeURIComponent(mediaUrl)}&filename=${encodeURIComponent(fname)}`,
                  directUrl: mediaUrl,
                },
              ],
            };
          }
        }
      }
    } catch (e) {}
  }

  // 3. Instagram Reel/Post Embed Parser (Bypasses Login Wall)
  if (host.includes('instagram.com')) {
    try {
      const codeMatch = rawUrl.match(/\/(?:reel|reels|p|tv)\/([a-zA-Z0-9_-]+)/i);
      if (codeMatch) {
        const embedUrl = `https://www.instagram.com/reel/${codeMatch[1]}/embed/captioned/`;
        const r = await fetchWithTimeout(
          embedUrl,
          {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              Accept: 'text/html',
            },
          },
          9000
        );
        if (r.ok) {
          const html = await r.text();
          const vidMatch =
            html.match(/"video_url":"(https:[^"]+)"/) ||
            html.match(/<video[^>]+src="([^"]+)"/i);
          if (vidMatch && vidMatch[1]) {
            const cleanVideo = vidMatch[1]
              .replace(/\\u0026/g, '&')
              .replace(/\\\//g, '/')
              .replace(/&amp;/g, '&');
            const imgMatch = html.match(/<img[^>]+class="EmbeddedMediaImage"[^>]+src="([^"]+)"/i);
            const fname = `instagram_reel_${Date.now()}.mp4`;
            return {
              success: true,
              platform: 'Instagram',
              title: 'Instagram Reel / Video',
              thumbnail: imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : '',
              items: [
                {
                  label: 'Download Reel / Video (HD MP4)',
                  filename: fname,
                  proxyUrl: `/api/proxy-download?url=${encodeURIComponent(cleanVideo)}&filename=${encodeURIComponent(fname)}`,
                  directUrl: cleanVideo,
                },
              ],
            };
          }
        }
      }
    } catch (e) {}
  }

  // 4. Facebook Public Video / Reel Extractor
  if (host.includes('facebook.com') || host.includes('fb.watch')) {
    try {
      const r = await fetchWithTimeout(
        rawUrl,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
            'Sec-Fetch-Site': 'none',
          },
        },
        10000
      );
      if (r.ok) {
        const html = await r.text();
        const hdMatch =
          html.match(/"browser_native_hd_url":"([^"]+)"/) ||
          html.match(/"playable_url_quality_hd":"([^"]+)"/);
        const sdMatch =
          html.match(/"browser_native_sd_url":"([^"]+)"/) ||
          html.match(/"playable_url":"([^"]+)"/);

        const decodeFb = (u) => u.replace(/\\\//g, '/').replace(/\\u0025/g, '%').replace(/\\u0026/g, '&');
        const items = [];

        if (hdMatch && hdMatch[1]) {
          const hdUrl = decodeFb(hdMatch[1]);
          const fname = `facebook_hd_${Date.now()}.mp4`;
          items.push({
            label: 'Download Video (HD MP4)',
            filename: fname,
            proxyUrl: `/api/proxy-download?url=${encodeURIComponent(hdUrl)}&filename=${encodeURIComponent(fname)}`,
            directUrl: hdUrl,
          });
        }
        if (sdMatch && sdMatch[1]) {
          const sdUrl = decodeFb(sdMatch[1]);
          const fname = `facebook_sd_${Date.now()}.mp4`;
          items.push({
            label: 'Download Video (SD MP4)',
            filename: fname,
            proxyUrl: `/api/proxy-download?url=${encodeURIComponent(sdUrl)}&filename=${encodeURIComponent(fname)}`,
            directUrl: sdUrl,
          });
        }

        if (items.length > 0) {
          return {
            success: true,
            platform: 'Facebook',
            title: 'Facebook Video / Reel',
            thumbnail: '',
            items,
          };
        }
      }
    } catch (e) {}
  }

  return null;
}

app.post('/api/universal-download', async (req, res) => {
  try {
    const { url, mode } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Please provide a valid URL.' });
    }

    const cleanUrl = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;

    // 1. Direct file links (.mp4, .mp3, .pdf, .jpg, .zip)
    if (/\.(mp4|webm|mov|mp3|m4a|wav|pdf|jpg|jpeg|png|webp|zip)(\?.*)?$/i.test(cleanUrl)) {
      const extMatch = cleanUrl.match(/\.([a-z0-9]+)(?:\?.*)?$/i);
      const ext = extMatch ? extMatch[1].toLowerCase() : 'file';
      return res.json({
        platform: 'Direct File',
        title: `Direct ${ext.toUpperCase()} File`,
        items: [{
          label: `Download ${ext.toUpperCase()} File`,
          filename: `download_${Date.now()}.${ext}`,
          directUrl: cleanUrl,
          useDirectOnly: true
        }]
      });
    }

    // 2. RapidAPI Universal Extractor (YouTube, Instagram, Facebook, X, Pinterest)
    const rapidKey = process.env.RAPIDAPI_KEY;
    if (!rapidKey) {
      return res.status(500).json({
        error: 'RAPIDAPI_KEY missing in Render Environment Variables.'
      });
    }

    const apiRes = await fetch('https://social-download-all-in-one.p.rapidapi.com/v1/social/autolink', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-rapidapi-key': rapidKey,
        'x-rapidapi-host': 'social-download-all-in-one.p.rapidapi.com'
      },
      body: JSON.stringify({ url: cleanUrl })
    });

    const data = await apiRes.json();
    const medias = Array.isArray(data.medias) ? data.medias : [];

    const filtered = medias.filter((m) => {
      if (!m || !m.url) return false;
      const isAudio = m.type === 'audio' || /mp3|m4a|audio/i.test(m.extension || m.quality || '');
      return mode === 'audio' ? isAudio : !isAudio;
    });

    const chosen = filtered.length > 0 ? filtered : medias.filter((m) => m && m.url);

    if (chosen.length === 0) {
      return res.status(400).json({
        error: 'Could not extract media from this link. Make sure the post/video is public.'
      });
    }

    const items = chosen.slice(0, 3).map((m, idx) => {
      const ext = m.extension || (mode === 'audio' ? 'mp3' : 'mp4');
      const q = m.quality ? ` (${m.quality})` : '';
      return {
        label: `Download ${mode === 'audio' ? 'Audio' : 'Video'}${q} ${ext.toUpperCase()}`,
        filename: `media_${Date.now()}_${idx + 1}.${ext}`,
        directUrl: m.url,
        useDirectOnly: true
      };
    });

    return res.json({
      platform: data.source || 'Social Media',
      title: (data.title || 'Media Ready to Download').slice(0, 120),
      thumbnail: data.thumbnail || '',
      items
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server extraction error. Please try again.' });
  }
});

// Zero-Storage Direct Stream Proxy (Streams directly to user's Downloads folder)
app.get('/api/proxy-download', (req, res) => {
  const targetUrl = String(req.query.url || '').trim();
  const safeFilename = String(req.query.filename || 'qr_studio_video.mp4').replace(/[^a-zA-Z0-9._-]/g, '_');

  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).send('Invalid download URL');
  }

  const httpMod = require('http');
  const httpsMod = require('https');

  function streamWithRedirects(currentUrl, hops = 0) {
    if (hops > 6) return res.status(502).send('Too many redirects');
    let parsed;
    try {
      parsed = new URL(currentUrl);
    } catch (e) {
      return res.status(400).send('Invalid URL');
    }
    if (isBlockedHost(parsed.hostname)) return res.status(403).send('Blocked host');

    const client = parsed.protocol === 'https:' ? httpsMod : httpMod;
    client
      .get(
        currentUrl,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Accept: '*/*',
            Referer: parsed.origin + '/',
          },
        },
        (upstream) => {
          if ([301, 302, 303, 307, 308].includes(upstream.statusCode) && upstream.headers.location) {
            const nextUrl = new URL(upstream.headers.location, currentUrl).toString();
            upstream.resume();
            return streamWithRedirects(nextUrl, hops + 1);
          }

          if (upstream.statusCode && upstream.statusCode >= 400) {
            upstream.resume();
            return res.redirect(targetUrl);
          }

          res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
          res.setHeader('Content-Type', upstream.headers['content-type'] || 'application/octet-stream');
          if (upstream.headers['content-length']) {
            res.setHeader('Content-Length', upstream.headers['content-length']);
          }
          upstream.pipe(res);
        }
      )
      .on('error', () => {
        if (!res.headersSent) res.redirect(targetUrl);
      });
  }

  streamWithRedirects(targetUrl);
});

// =========================================================================
// PROGRAMMATIC SEO LANDING PAGES & DYNAMIC SITEMAP (AUTO ORGANIC TRAFFIC)
// =========================================================================
const SEO_PAGES = {
  '/pdf-to-qr-code': {
    title: 'PDF to QR Code Generator Free — Convert Multi-Page PDF to QR Link',
    desc: 'Upload any PDF document and convert it into a permanent scannable QR code link for free. Works on all mobile cameras without any app.',
    h1: 'Free PDF to QR Code Generator',
    sub: 'Upload any single or multi-page PDF and create an instant shareable QR code.',
    tab: 'generate',
    qrType: 'file',
  },
  '/photo-to-qr-code': {
    title: 'Photo & Image to QR Code Maker Free — Instant Picture QR Link',
    desc: 'Turn any JPG, PNG, or WEBP photo into a scannable QR code in seconds. Free online image to QR generator with high-resolution download.',
    h1: 'Free Photo & Image to QR Code Maker',
    sub: 'Upload any photo and generate a permanent scannable QR link immediately.',
    tab: 'generate',
    qrType: 'file',
  },
  '/wifi-qr-code-generator': {
    title: 'Wi-Fi QR Code Generator Free — Share Wi-Fi Password via QR Scan',
    desc: 'Create a free Wi-Fi QR code so guests can connect to your WPA/WPA2/WPA3 network instantly by scanning without typing passwords.',
    h1: 'Free Wi-Fi QR Code Generator',
    sub: 'Enter your Wi-Fi name and password to generate an instant scan-to-connect QR.',
    tab: 'generate',
    qrType: 'wifi',
  },
  '/vcard-qr-code-generator': {
    title: 'Free vCard Contact QR Code Generator — Digital Business Card QR',
    desc: 'Generate a free vCard QR code with your phone number, email, company, and address so anyone can save your contact in one scan.',
    h1: 'Free Contact vCard QR Code Generator',
    sub: 'Create a digital business card QR that saves directly to mobile contacts.',
    tab: 'generate',
    qrType: 'vcard',
  },
  '/qr-code-scanner-online': {
    title: 'Free Online QR Code Scanner — Scan QR via Camera, Image or PDF',
    desc: 'Scan any QR code online using your phone/laptop camera or by uploading a screenshot, photo, or multi-page PDF. No app required.',
    h1: 'Free Online QR Code Scanner',
    sub: 'Scan QR codes live via camera or upload any QR photo/PDF file.',
    tab: 'scanner',
  },
  '/scan-qr-from-pdf': {
    title: 'Scan QR Code from PDF Online Free — Multi-Page PDF QR Reader',
    desc: 'Upload any PDF document to automatically detect and decode QR codes on any page instantly in your browser.',
    h1: 'Scan QR Code from PDF Online',
    sub: 'Upload multi-page PDFs or screenshots to extract QR links and text instantly.',
    tab: 'scanner',
  },
  '/pdf-to-jpg-converter': {
    title: 'Free PDF to JPG & PNG Converter Online — High Quality No Limit',
    desc: 'Convert PDF pages into high-resolution JPG or PNG images online for free. Fast, private, and works directly in your browser.',
    h1: 'Free PDF to JPG & PNG Converter',
    sub: 'Upload any PDF and convert all pages into HD JPG or PNG images in seconds.',
    tab: 'ufc',
  },
  '/jpg-to-pdf-converter': {
    title: 'JPG to PDF Converter Free — Merge Multiple Images into 1 PDF',
    desc: 'Convert and combine multiple JPG, PNG, or WEBP images into a single clean PDF document online for free with zero watermarks.',
    h1: 'Free JPG & Image to PDF Converter',
    sub: 'Select one or multiple photos to merge them into a single downloadable PDF.',
    tab: 'ufc',
  },
  '/word-to-pdf-converter': {
    title: 'Word (DOCX) Opener & Converter to PDF / HTML / TXT Free',
    desc: 'Open DOCX Word documents online without MS Word and convert them to PDF, HTML, or plain text instantly for free.',
    h1: 'Free Word (DOCX) Opener & PDF Converter',
    sub: 'Read DOCX files in your browser and export them to PDF, HTML, or TXT.',
    tab: 'ufc',
  },
  '/excel-to-csv-json-converter': {
    title: 'Online Excel (XLSX) Viewer & Converter to CSV, JSON, HTML Free',
    desc: 'Open XLSX, XLS, and CSV spreadsheets online and convert between Excel, CSV, JSON, and HTML tables instantly.',
    h1: 'Free Excel (XLSX) & CSV Opener & Converter',
    sub: 'View spreadsheets online and convert XLSX, CSV, JSON, and HTML formats.',
    tab: 'ufc',
  },
  '/zip-file-opener-online': {
    title: 'Free Online ZIP File Opener & Extractor — View & Pack ZIP Archives',
    desc: 'Open ZIP archives directly in your browser, inspect files inside, or pack multiple files into a downloadable ZIP for free.',
    h1: 'Free Online ZIP Archive Opener & Creator',
    sub: 'Extract and view files inside any ZIP archive or compress files into ZIP.',
    tab: 'ufc',
  },
  '/universal-file-opener': {
    title: 'Universal File Opener & Format Converter — Open Any File Online',
    desc: 'Open and convert PDF, JPG, PNG, WEBP, DOCX, XLSX, CSV, ZIP, MP4, MP3, JSON, and raw files online for free.',
    h1: 'Universal File Opener & Format Converter',
    sub: 'Open any file format in your browser and convert between popular formats.',
    tab: 'ufc',
  },
  '/video-downloader-online': {
    title: 'Free Online Video, Reel & Audio Downloader — Direct HD Save',
    desc: 'Paste any public video, reel, audio, or direct media link to download MP4 or MP3 straight to your phone or PC for free.',
    h1: 'Free Universal Video & Media Downloader',
    sub: 'Paste any video, reel, or file URL to get an instant direct download link.',
    tab: 'downloader',
  },
  '/mp4-to-mp3-audio-downloader': {
    title: 'Online Audio & MP3 Extractor — Download Audio from Video Links',
    desc: 'Extract and download MP3 audio from public video links or convert audio files to WAV online for free.',
    h1: 'Free Online Audio & MP3 Downloader',
    sub: 'Paste a video link and choose Audio Only (MP3) to download fast.',
    tab: 'downloader',
  },
};

app.get(Object.keys(SEO_PAGES), (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const meta = SEO_PAGES[req.path];
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const fullUrl = `${baseUrl}${req.path}`;

  try {
    let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    html = html
      .replace(/<title>[\s\S]*?<\/title>/i, `<title>${meta.title}</title>`)
      .replace(/<meta name="description" content="[^"]*"\s*\/?>/i, `<meta name="description" content="${meta.desc}" />`)
      .replace('</head>', `<link rel="canonical" href="${fullUrl}" />\n<script>window.__INITIAL_SEO_STATE__ = ${JSON.stringify(meta)};</script>\n</head>`);
    return res.send(html);
  } catch (e) {
    return res.redirect('/');
  }
});

app.get('/sitemap.xml', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const today = new Date().toISOString().split('T')[0];
  const allPaths = ['/', ...Object.keys(SEO_PAGES)];

  const urlsXml = allPaths
    .map(
      (p) => `  <url>
    <loc>${baseUrl}${p}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${p === '/' ? '1.0' : '0.85'}</priority>
  </url>`
    )
    .join('\n');

  res.setHeader('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlsXml}
</urlset>`);
});
// Dedicated Smart Scan Result Page (Renders Exact Content Format + Converter Suggestion)
app.get('/scan-result', (req, res) => {
  const fs = require('fs');
  const path = require('path');


  res.send(`<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>QR Content Viewer — QR Studio</title>
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

  <main class="flex-1 max-w-2xl w-full mx-auto px-4 py-7">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-2xl">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <span id="qr-type-badge" class="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
          QR Content
        </span>
        <span id="qr-source-tag" class="text-xs text-slate-400"></span>
      </div>

      <h1 id="qr-title" class="text-xl sm:text-2xl font-bold text-white mb-4">Scanned Content</h1>

      <!-- Exact Visual Preview (Photo / PDF / Video / Website) -->
      <div id="exact-media-stage" class="hidden mb-5 rounded-xl overflow-hidden bg-slate-950 border border-slate-800"></div>

      <!-- Structured Details (Wi-Fi / Contact / UPI) -->
      <div id="parsed-details" class="hidden mb-5 p-4 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2.5 text-sm"></div>

      <!-- Clean Text / Link Box (Hidden when Photo/PDF/Video is displayed) -->
      <div id="raw-data-wrap" class="p-4 rounded-xl bg-slate-950 border border-slate-800 mb-5">
        <div id="raw-data-label" class="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5 font-semibold">Content</div>
        <pre id="raw-data-box" class="text-sm sm:text-base font-mono text-emerald-300 whitespace-pre-wrap break-all leading-relaxed"></pre>
      </div>

      <!-- Primary Action Buttons -->
      <div class="flex flex-wrap gap-3">
        <a id="primary-action-btn" href="#" target="_blank" rel="noopener noreferrer"
          class="hidden flex-1 min-w-[160px] text-center px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-lg transition">
          Open
        </a>
        <button id="copy-result-btn" type="button"
          class="flex-1 min-w-[140px] px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition">
          Copy
        </button>
        <a href="/"
          class="w-full sm:w-auto text-center px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm transition">
          Scan Another
        </a>
      </div>

      <!-- Smart Converter Suggestion Card -->
      <div id="converter-suggestion-box" class="mt-6 pt-5 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p class="text-xs font-bold text-indigo-300 uppercase tracking-wider">Need Another Format?</p>
          <p id="converter-suggestion-text" class="text-xs text-slate-400 mt-0.5">
            Convert PDF, JPG, PNG, WEBP, DOCX, Excel, Audio, or ZIP online for free.
          </p>
        </div>
        <a id="converter-cta-btn" href="/?open=converter"
          class="shrink-0 text-center px-4 py-2.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-xs font-semibold transition">
          Open File Converter &rarr;
        </a>
      </div>
    </div>

   <footer class="mt-6 min-h-[65px] flex justify-center items-center overflow-x-auto">
      <script>
        atOptions = {
          'key': '40bec14a9daa6fee69195e62b0bdf3d4',
          'format': 'iframe',
          'height': 60,
          'width': 468,
          'params': {}
        };
      </script>
      <script src="https://www.highperformanceformat.com/40bec14a9daa6fee69195e62b0bdf3d4/invoke.js"></script>
    </footer>
  </main>

  <script>
    const params = new URLSearchParams(window.location.search);
    const rawData = (params.get('data') || '').trim();
    const source = params.get('source') || '';

    const rawWrap = document.getElementById('raw-data-wrap');
    const rawBox = document.getElementById('raw-data-box');
    const rawLabel = document.getElementById('raw-data-label');
    const badge = document.getElementById('qr-type-badge');
    const title = document.getElementById('qr-title');
    const sourceTag = document.getElementById('qr-source-tag');
    const primaryBtn = document.getElementById('primary-action-btn');
    const parsedBox = document.getElementById('parsed-details');
    const copyBtn = document.getElementById('copy-result-btn');
    const mediaStage = document.getElementById('exact-media-stage');
    const convText = document.getElementById('converter-suggestion-text');

    if (source) sourceTag.textContent = 'Scanned via ' + source;
    rawBox.textContent = rawData || 'No QR content found.';

    function addDetailRow(label, value) {
      if (!value) return;
      parsedBox.classList.remove('hidden');
      const row = document.createElement('div');
      row.className = 'flex flex-wrap justify-between gap-2 border-b border-slate-800/80 pb-2 last:border-none last:pb-0';
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

    function decodeBase64Url(str) {
      try {
        const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
        return decodeURIComponent(escape(atob(b64)));
      } catch (e) {
        try { return atob(str); } catch (err) { return ''; }
      }
    }

    const isUrl = /^https?:\\/\\/[^\\s]+$/i.test(rawData) || (/^[a-zA-Z0-9-]+(\\.[a-zA-Z0-9-]+)+(\\/[^\\s]*)?$/i.test(rawData) && !rawData.includes('@'));

    if (isUrl) {
      const fullUrl = /^https?:\\/\\//i.test(rawData) ? rawData : 'https://' + rawData;
      let parsedUrl = null;
      try { parsedUrl = new URL(fullUrl); } catch (e) {}

      // Check if QR points to QR Studio /view?u=...&t=...&n=...
      if (parsedUrl && parsedUrl.pathname === '/view' && parsedUrl.searchParams.get('u')) {
        const cloudUrl = decodeBase64Url(parsedUrl.searchParams.get('u'));
        const fType = (parsedUrl.searchParams.get('t') || '').toLowerCase();
        const fName = parsedUrl.searchParams.get('n') || 'Shared File';

        rawWrap.classList.add('hidden');
        title.textContent = fName;
        copyBtn.textContent = 'Copy Share Link';
        copyBtn.dataset.copyText = fullUrl;

        if (fType === 'img' || /\\.(jpg|jpeg|png|webp|gif)(\\?|$)/i.test(cloudUrl)) {
          badge.textContent = 'PHOTO / IMAGE';
          mediaStage.classList.remove('hidden');
          mediaStage.innerHTML = '<img src="' + cloudUrl + '" alt="' + fName.replace(/"/g, '') + '" class="w-full max-h-[520px] object-contain mx-auto bg-black" />';
          primaryBtn.href = cloudUrl;
          primaryBtn.setAttribute('download', fName);
          primaryBtn.textContent = 'Download Photo';
          primaryBtn.classList.remove('hidden');
          convText.textContent = 'Convert this Photo to PDF, JPG, PNG, WEBP, or ICO using QR Studio Converter.';
        } else if (fType === 'pdf' || /\\.pdf(\\?|$)/i.test(cloudUrl)) {
          badge.textContent = 'PDF DOCUMENT';
          mediaStage.classList.remove('hidden');
          mediaStage.innerHTML = '<iframe src="' + cloudUrl + '" class="w-full h-[520px] border-0 bg-white"></iframe>';
          primaryBtn.href = cloudUrl;
          primaryBtn.setAttribute('download', fName);
          primaryBtn.textContent = 'Download PDF';
          primaryBtn.classList.remove('hidden');
          convText.textContent = 'Convert this PDF to JPG, PNG images, ZIP, or TXT using QR Studio Converter.';
        } else {
          badge.textContent = 'VIDEO';
          mediaStage.classList.remove('hidden');
          mediaStage.innerHTML = '<video src="' + cloudUrl + '" controls playsinline class="w-full max-h-[520px] bg-black"></video>';
          primaryBtn.href = cloudUrl;
          primaryBtn.setAttribute('download', fName);
          primaryBtn.textContent = 'Download Video';
          primaryBtn.classList.remove('hidden');
          convText.textContent = 'Pack into ZIP or convert other media files in QR Studio Converter.';
        }
      } else if (/\\.(jpg|jpeg|png|webp|gif|svg)(\\?|$)/i.test(fullUrl)) {
        badge.textContent = 'DIRECT IMAGE';
        title.textContent = 'Image QR Content';
        rawWrap.classList.add('hidden');
        mediaStage.classList.remove('hidden');
        mediaStage.innerHTML = '<img src="' + fullUrl + '" class="w-full max-h-[520px] object-contain mx-auto bg-black" />';
        primaryBtn.href = fullUrl;
        primaryBtn.textContent = 'Open Full Image';
        primaryBtn.classList.remove('hidden');
        convText.textContent = 'Convert images between JPG, PNG, WEBP, ICO, and PDF in QR Studio Converter.';
      } else if (/\\.pdf(\\?|$)/i.test(fullUrl)) {
        badge.textContent = 'DIRECT PDF';
        title.textContent = 'PDF Document';
        rawWrap.classList.add('hidden');
        mediaStage.classList.remove('hidden');
        mediaStage.innerHTML = '<iframe src="' + fullUrl + '" class="w-full h-[520px] border-0 bg-white"></iframe>';
        primaryBtn.href = fullUrl;
        primaryBtn.textContent = 'Open / Download PDF';
        primaryBtn.classList.remove('hidden');
        convText.textContent = 'Convert PDF pages to JPG, PNG, or TXT using QR Studio Converter.';
      } else {
        badge.textContent = 'WEBSITE / LINK';
        title.textContent = 'Website Link';
        rawLabel.textContent = 'Destination URL';
        primaryBtn.href = fullUrl;
        primaryBtn.textContent = 'Open Website';
        primaryBtn.classList.remove('hidden');
      }
    } else if (/^WIFI:/i.test(rawData)) {
      badge.textContent = 'WI-FI NETWORK';
      title.textContent = 'Wi-Fi Login Details';
      rawWrap.classList.add('hidden');
      const ssid = (rawData.match(/S:([^;]*)/i) || [])[1] || '';
      const pass = (rawData.match(/P:([^;]*)/i) || [])[1] || '';
      const type = (rawData.match(/T:([^;]*)/i) || [])[1] || 'WPA';
      addDetailRow('Network Name (SSID)', ssid);
      addDetailRow('Password', pass || '(Open Network)');
      addDetailRow('Security', type);
      if (pass) {
        copyBtn.textContent = 'Copy Wi-Fi Password';
        copyBtn.dataset.copyText = pass;
      }
    } else if (/^BEGIN:VCARD/i.test(rawData)) {
      badge.textContent = 'CONTACT CARD (VCARD)';
      title.textContent = 'Contact Information';
      rawWrap.classList.add('hidden');
      const fn = (rawData.match(/^FN:(.*)$/im) || [])[1] || '';
      const tel = (rawData.match(/^TEL[^:]*:(.*)$/im) || [])[1] || '';
      const email = (rawData.match(/^EMAIL[^:]*:(.*)$/im) || [])[1] || '';
      const org = (rawData.match(/^ORG:(.*)$/im) || [])[1] || '';
      addDetailRow('Name', fn);
      addDetailRow('Phone', tel);
      addDetailRow('Email', email);
      addDetailRow('Organization', org);
      const blob = new Blob([rawData], { type: 'text/vcard' });
      primaryBtn.href = URL.createObjectURL(blob);
      primaryBtn.download = (fn || 'contact') + '.vcf';
      primaryBtn.removeAttribute('target');
      primaryBtn.textContent = 'Save Contact (.vcf)';
      primaryBtn.classList.remove('hidden');
    } else if (/^upi:\\/\\//i.test(rawData)) {
      badge.textContent = 'UPI PAYMENT';
      title.textContent = 'UPI Payment Details';
      rawWrap.classList.add('hidden');
      const uParams = new URLSearchParams(rawData.split('?')[1] || '');
      addDetailRow('Payee Name', uParams.get('pn') || '');
      addDetailRow('UPI ID', uParams.get('pa') || '');
      addDetailRow('Amount', uParams.get('am') ? '₹' + uParams.get('am') : '');
      primaryBtn.href = rawData;
      primaryBtn.textContent = 'Pay via UPI App';
      primaryBtn.classList.remove('hidden');
    } else if (/^mailto:/i.test(rawData)) {
      badge.textContent = 'EMAIL';
      title.textContent = 'Email Address';
      rawBox.textContent = rawData.replace(/^mailto:/i, '');
      primaryBtn.href = rawData;
      primaryBtn.textContent = 'Send Email';
      primaryBtn.classList.remove('hidden');
    } else if (/^tel:/i.test(rawData)) {
      badge.textContent = 'PHONE NUMBER';
      title.textContent = 'Phone Number';
      rawBox.textContent = rawData.replace(/^tel:/i, '');
      primaryBtn.href = rawData;
      primaryBtn.textContent = 'Call Number';
      primaryBtn.classList.remove('hidden');
    } else {
      badge.textContent = 'PLAIN TEXT';
      title.textContent = 'Decoded Text';
      convText.textContent = 'Save or convert this text into PDF, HTML, or TXT in QR Studio Converter.';
    }

    copyBtn.addEventListener('click', () => {
      const textToCopy = copyBtn.dataset.copyText || rawData;
      navigator.clipboard.writeText(textToCopy).then(() => {
        const old = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = old; }, 1800);
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
  </main>

  <div style="display:flex;justify-content:center;padding:8px 16px;min-height:65px;">
    <script>
      atOptions = {
        'key': '40bec14a9daa6fee69195e62b0bdf3d4',
        'format': 'iframe',
        'height': 60,
        'width': 468,
        'params': {}
      };
    </script>
    <script src="https://www.highperformanceformat.com/40bec14a9daa6fee69195e62b0bdf3d4/invoke.js"></script>
  </div>

  <footer>
    Powered by <a href="/">QR Studio</a> ...
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