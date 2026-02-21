[ 中文 ](README.md) | [ English ](README_en.md)

# 🌌 FileDust

> *"Where massive data turns into cosmic dust."*

**FileDust** is a zero-footprint decentralized storage engine built for geeks and Web3 believers.

Its core philosophy: Disintegrate your massive files (like gigabyte-sized videos or models) into precise, tiny fragments under `100KB` (Dust). After securing them with military-grade AES-256-GCM local encryption, FileDust scatters these fragments into the Arweave/Irys deep web using concurrency throttling. This elegantly capitalizes on the L2 protocol's underlying subsidies for micro-data uploads.

At this point, you only need to keep a tiny `.dust` file (a few kilobytes) locally, unlocking vast amounts of physical storage space. When you need to reconstruct the data, using your unique password, all fragments will stream back from the decentralized cosmic cloud, strictly verify their integrity, decrypt on-the-fly, and perfectly reconstruct the original massive file!

---

## 🌟 Core Features

- ✂️ **Nano-Precision Chunking**
  Applies a deliberately calculated `90KB` safety threshold by default. It gently slices any massive file into dimensions that perfectly fit the free-tier protocols without wasting a byte.
- 🛡️ **Military-Grade E2E Invisibility (AES-256-GCM)**
  What enters the blockchain is pure data noise. Not even the gods can piece together or guess your content from the public ledger. By locally generating a high-strength password (Password) combined with a 32-byte random salt (Salt), it derives a 128-byte key, allowing you to rebuild the universe.
- 🌊 **Black-Hole Memory Pipeline (Streaming Reconstruct)**
  A uniquely minimalist pipeline design: `Download one block -> decrypt instantly -> append atomically -> release`. Even when reconstructing a 10GB epic video, Node.js remains absolutely stable, with memory spikes no larger than a mere `2MB`.
- 🚦 **Anti-Ban Camouflage Engine (Ratelimit & Jittering)**
  Built-in `p-limit` concurrent throttling combined with bottom-layer retry backpressure and random Jitter. It interacts gently and with restraint with free-tier nodes (like Irys/Bundlr) to avoid triggering DDoS firewalls and subsequent IP bans.
- 📺 **Star Dust Media Streaming (Dust Browser)**
  An embedded Express local server acts as a frontend rendering proxy. It achieves a true "download-while-watching" streaming experience with multi-instance support and drag-to-seek caching directly from the decentralized chain. Pictures open instantly, videos stream smoothly, elevating the reconstruction experience to cloud-drive standards!

---

## 🛠️ Installation

Prepare to enter the zero-dimension. Ensure you have the [Node.js](https://nodejs.org/) >= 18 runtime:

```bash
git clone https://github.com/YourUsername/FileDust.git
cd FileDust
npm install
```

*(💡 Upon its first awakening, the engine will thoughtfully generate a `wallet.json` in the directory, allowing seamless mounting to decentralized protocols without complex cross-border configurations.)*

---

## 🚀 Quick Start

Command the cosmic sea with just a few lines of code.

### 1. Disintegrate to Dust

```javascript
import { uploadToDust } from "./FileDustUploader.js";

async function makeItDust() {
    // Cast the spell: Local file path, your secret password, and desired chunk size (default safe value is 90KB)
    const manifestPath = await uploadToDust("./videos/secret_movie.mp4", "SuperStrongPassword123!");
    
    console.log(`Generated star map index: ${manifestPath}`);
    // 👋 You can now safely wipe the massive secret_movie.mp4 from your Earthly hard drive.
}
makeItDust();
```

### 2. Reconstruct from Dust

```javascript
import { downloadFromDust } from "./FileDustMerger.js";

async function reconstruct() {
    // Feed it the feather-light .dust coordinates, and the galaxy will flow in reverse to rebuild it.
    await downloadFromDust("./videos/secret_movie.mp4.dust", "SuperStrongPassword123!");
    
    // 🎉 Your secret_movie.mp4 descends intact into the current directory.
}
reconstruct();
```

### 3. Dust Browser

If your cosmic dust consists of **images**, **videos**, **audio**, or even **Text/Markdown**, you can skip downloading it entirely and spin up a local decentralized browser gateway:

```bash
# Start your local proxy
node DustBrowser.js <Your_Reconstruction_Password>
```

👉 **Once running, visit:** `http://localhost:3000`
The page will mount and render all `*.dust` star maps found in the current directory. Simply click to initiate a multi-threaded "download on the fly, decrypt on the fly, preview on the fly" experience! It also provides a minimalist upload and chunking interface.

**🌟 Feature Previews:**

* **🌌 Star Map Index Listing:**
  <br><img src="./pic/DustBrowser.png" width="800">

* **🎬 Video Dust Streaming (Native Memory Pool Buffering):**
  <br><img src="./pic/DustBrowserMP4test.png" width="800">

* **🖼️ Instant Image Rendering:**
  <br><img src="./pic/DustBrowsertestpng.png" width="800">
  <br><img src="./pic/DustBrowsertestpng2.png" width="800">

* **📝 Text & Markdown Cross-Layer Reading:**
  <br><img src="./pic/DustBrowserreadme.png" width="800">

---

## 📜 Geek Vows & Legal (PolyForm Noncommercial 1.0.0)

This project is strictly guarded by the **PolyForm Noncommercial License 1.0.0**.

- ✅ **Unconditionally Permitted**: Any personal geek use, code dissection & learning, technical exploration, and self-hosted non-commercial service building.
- ❌ **Absolutely Prohibited**: Any corporate entity, startup team, or individual attempting to embed or disguise this engine's overall mechanism or core chunking logic into SaaS cloud drives, value-added modules, or to monetize it directly/indirectly for commercial gain.

### ⚠️ Permanent Storage Disclaimer & Warning

1. **On-Chain Immutability**: Based on the Arweave protocol, **all data scattered into the chain is permanent, irrevocable, and undeletable**. Think carefully about any content you upload, because once uploaded, not even the gods can wipe it from the network.
2. **Abuse and Illegal Use Strictly Prohibited**: Although FileDust maximizes the micro-data free subsidies of L2 networks (like Turbo/Irys), essentially granting you "infinite space" secure storage, this tool is **developed solely for geek experiments, learning data sovereignty concepts, and personal non-infringing/legal asset backup**.
3. **Legal Responsibility**: **It is strictly forbidden to use FileDust to process or distribute any data that violates the laws of your country/region (including but not limited to hacking materials, illegal transaction data, copyright infringement, etc.). The authors and contributors are not responsible for any data or legal consequences arising from the use of this tool, and provide no form of commercial warranty or customer service obligations.**

Stay pure. Preserved only for the pioneers who passionately love geek culture.
