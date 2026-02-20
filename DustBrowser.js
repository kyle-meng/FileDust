import express from 'express';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import axios from 'axios';
import crypto from 'node:crypto';
import mime from 'mime';
import { loadOrGenerateKey, decrypt } from './CryptoUtils.js';

// ---- Configuration ----
const PORT = 3000;
const MAX_CACHE_SIZE = 50; // Cache 50 chunks (approx 4.5MB) to handle fast seeking / range overlapping

let encryptionKey = null;

const manifestCache = new Map(); // key: filename, value: { manifest, chunkSize, chunkCache, pendingRequests }

const calculateHash = (buffer) => crypto.createHash('md5').update(buffer).digest('hex');

// ---- Chunk Fetcher with In-Memory Cache ----
async function getOrInitManifestInfo(manifestFilename) {
    if (manifestCache.has(manifestFilename)) {
        return manifestCache.get(manifestFilename);
    }

    // Safety check: ensure the manifest exists in the current working directory
    const cwd = process.cwd();
    const manifestPath = path.resolve(cwd, manifestFilename);
    if (!manifestPath.startsWith(cwd)) {
        throw new Error(`Invalid manifest path`);
    }

    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Manifest not found: ${manifestPath}`);
    }

    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent);
    manifest.chunks.sort((a, b) => a.part - b.part);

    const info = {
        manifest,
        chunkSize: null,
        chunkCache: new Map(),
        pendingRequests: new Map()
    };

    // Define helper specifically for this manifest
    info.getDecryptedChunk = async (index) => {
        if (info.chunkCache.has(index)) return info.chunkCache.get(index);
        if (info.pendingRequests.has(index)) return info.pendingRequests.get(index);

        const chunkPromise = (async () => {
            const chunkInfo = info.manifest.chunks.find(c => c.part === index);
            if (!chunkInfo) throw new Error(`Chunk ${index} not found in manifest`);

            console.log(`☁️  [${manifestFilename}] Fetching Chunk [${index}]...`);

            // Timeout 30s
            const response = await axios.get(chunkInfo.url, { responseType: 'arraybuffer', timeout: 30000 });
            const netData = Buffer.from(response.data);

            // Hash Verification
            if (calculateHash(netData) !== chunkInfo.hash) {
                throw new Error(`Hash mismatch for chunk ${index} from network`);
            }

            // Decryption
            const decrypted = await decrypt(netData, encryptionKey, { autoJson: false });

            // Maintain Cache Size
            if (info.chunkCache.size >= MAX_CACHE_SIZE) {
                const firstKey = info.chunkCache.keys().next().value;
                info.chunkCache.delete(firstKey);
            }

            info.chunkCache.set(index, decrypted);
            info.pendingRequests.delete(index);

            return decrypted;
        })().catch(e => {
            info.pendingRequests.delete(index);
            throw e;
        });

        info.pendingRequests.set(index, chunkPromise);
        return chunkPromise;
    };

    console.log(`📦 Loaded Manifest: ${manifest.filename} (Total Size: ${manifest.total_size})`);
    console.log(`🔍 Determining dynamic chunk size structure...`);

    // Download chunk 0 to gauge size
    const chunk0 = await info.getDecryptedChunk(0);
    info.chunkSize = chunk0.length;
    console.log(`📏 Decrypted Chunk Size determined: ${info.chunkSize} bytes/chunk`);

    manifestCache.set(manifestFilename, info);
    return info;
}

// ---- Express Server ----
const app = express();

app.get('/', (req, res) => {
    // List all .manifest.json in current directory
    const files = fs.readdirSync(process.cwd());
    const manifests = files.filter(f => f.endsWith('.manifest.json'));

    let listHtml = manifests.map(m => {
        return `<a class="manifest-link" href="/view?m=${encodeURIComponent(m)}">📄 ${m}</a>`;
    }).join('');

    if (manifests.length === 0) {
        listHtml = `<p>No .manifest.json files found in the current directory.</p>`;
    }

    res.send(`
        <html>
        <head>
            <meta charset="utf-8" />
            <title>Dust Browser</title>
            <style>
               body { 
                   font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
                   background: #0f172a; 
                   color: #f8fafc; 
                   display: flex; 
                   flex-direction: column; 
                   align-items: center; 
                   padding-top: 50px;
                   min-height: 100vh; 
                   margin: 0; 
               }
               .container { 
                   text-align: left; 
                   max-width: 900px; 
                   width: 100%;
                   padding: 40px; 
                   background: #1e293b; 
                   border-radius: 16px; 
                   box-shadow: 0 10px 25px rgba(0,0,0,0.5); 
               }
               .title { font-size: 1.8rem; font-weight: 600; margin-bottom: 20px; }
               .manifest-link {
                   display: block;
                   padding: 15px;
                   margin: 10px 0;
                   background: #334155;
                   color: #e2e8f0;
                   text-decoration: none;
                   border-radius: 8px;
                   transition: background 0.2s;
                   font-size: 1.1rem;
               }
               .manifest-link:hover {
                   background: #475569;
               }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="title">🌌 Star Dust Browser</div>
                <p>Select a manifest file to explore:</p>
                ${listHtml}
            </div>
        </body>
        </html>
    `);
});

app.get('/view', async (req, res) => {
    const m = req.query.m;
    if (!m) return res.redirect('/');

    try {
        const info = await getOrInitManifestInfo(m);
        const filename = info.manifest.filename.replace(/\.enc$/, '');
        const mimeType = mime.getType(filename) || 'application/octet-stream';

        let mediaTag = `<p style="margin-top:20px;">Unsupported Preview Type (${mimeType})</p>`;

        const streamUrl = `/stream?m=${encodeURIComponent(m)}`;

        if (mimeType.startsWith('image/')) {
            mediaTag = `<img src="${streamUrl}" alt="${filename}" style="max-width: 100%; max-height: 60vh; border-radius: 8px;" />`;
        } else if (mimeType.startsWith('video/')) {
            mediaTag = `<video src="${streamUrl}" controls style="max-width: 100%; max-height: 60vh; border-radius: 8px;" autoplay></video>`;
        } else if (mimeType.startsWith('audio/')) {
            mediaTag = `<audio src="${streamUrl}" controls autoplay></audio>`;
        }

        res.send(`
            <html>
            <head>
                <meta charset="utf-8" />
                <title>Dust Browser: ${filename}</title>
                <style>
                   body { 
                       font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
                       background: #0f172a; 
                       color: #f8fafc; 
                       display: flex; 
                       flex-direction: column; 
                       align-items: center; 
                       justify-content: center; 
                       min-height: 100vh; 
                       margin: 0; 
                   }
                   .container { 
                       text-align: center; 
                       max-width: 900px; 
                       width: 100%;
                       padding: 40px; 
                       background: #1e293b; 
                       border-radius: 16px; 
                       box-shadow: 0 10px 25px rgba(0,0,0,0.5); 
                   }
                   .title { font-size: 1.5rem; font-weight: 600; margin-bottom: 20px; word-break: break-all; }
                   a.download-btn {
                       display: inline-block;
                       margin-top: 30px;
                       padding: 10px 20px;
                       background: #3b82f6;
                       color: #fff;
                       text-decoration: none;
                       border-radius: 6px;
                       font-weight: 600;
                       transition: background 0.2s;
                   }
                   a.download-btn:hover { background: #2563eb; }
                   .nav { margin-bottom: 20px; text-align: left; }
                   .nav a { color: #94a3b8; text-decoration: none; font-size: 1rem; }
                   .nav a:hover { color: #f8fafc; }
                   .footer { margin-top: 30px; font-size: 0.85em; color: #94a3b8; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="nav"><a href="/">← Back to List</a></div>
                    <div class="title">🌌 ${filename}</div>
                    
                    ${mediaTag}
                    
                    <div>
                       <a class="download-btn" href="${streamUrl}" download="${filename}">⬇️ Download Unencrypted File</a>
                    </div>
                    
                    <div class="footer">
                      Directly streaming from Star Dust (Arweave Network)
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (e) {
        res.status(500).send("Error loading manifest: " + e.message);
    }
});

app.get('/stream', async (req, res) => {
    const m = req.query.m;
    if (!m) return res.status(400).send("Missing manifest parameter");

    try {
        const info = await getOrInitManifestInfo(m);
        const { manifest, chunkSize, getDecryptedChunk } = info;

        const totalSize = manifest.total_size;
        const filename = manifest.filename.replace(/\.enc$/, '');
        const mimeType = mime.getType(filename) || 'application/octet-stream';

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

        let start = 0;
        let end = totalSize - 1;

        if (req.headers.range) {
            const parts = req.headers.range.replace(/bytes=/, "").split("-");
            start = parseInt(parts[0], 10);
            const requestedEnd = parts[1] ? parseInt(parts[1], 10) : end;
            end = Math.min(requestedEnd, end);

            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
            res.setHeader('Content-Length', end - start + 1);
        } else {
            res.status(200);
            res.setHeader('Content-Length', totalSize);
        }

        let currentOffset = start;
        let aborted = false;

        req.on('close', () => { aborted = true; });

        while (currentOffset <= end) {
            if (aborted) {
                console.log('⚠️ Stream aborted by client.');
                break;
            }

            const chunkIndex = Math.floor(currentOffset / chunkSize);
            const chunkStartOffset = chunkIndex * chunkSize;

            const decryptedChunk = await getDecryptedChunk(chunkIndex);

            const sliceStart = currentOffset - chunkStartOffset;
            const sliceEnd = Math.min(decryptedChunk.length, (end - chunkStartOffset) + 1);

            const slice = decryptedChunk.subarray(sliceStart, sliceEnd);

            if (!res.write(slice)) {
                await new Promise(resolve => res.once('drain', resolve));
            }

            currentOffset += slice.length;
        }

        res.end();
    } catch (e) {
        console.error("Stream Error:", e);
        if (!res.headersSent) {
            res.status(500).send("Stream Error");
        } else {
            res.end();
        }
    }
});

// ---- Entry Point ----
const args = process.argv.slice(2);
if (args.length < 1) {
    console.log("FileDust Browser - Decentralized Streaming Viewer");
    console.log("Usage: node DustBrowser.js <password>");
    process.exit(1);
}

loadOrGenerateKey(args[0]).then(({ key }) => {
    encryptionKey = key;
    app.listen(PORT, () => {
        console.log(`\n=================================================`);
        console.log(`🚀 Dust Browser is proudly serving your manifests!`);
        console.log(`🔗 Click / Open URL: http://localhost:${PORT}`);
        console.log(`=================================================\n`);
    });
}).catch(err => {
    console.error("Failed to start DustBrowser:", err);
});
