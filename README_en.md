[ 中文 ](README.md) | [ English ](README_en.md)

# 🌌 FileDust

> *"Where massive data turns into cosmic dust."*

**FileDust** is a zero-footprint decentralized storage engine built for geeks and Web3 believers.

Its core philosophy: Disintegrate your massive files (like gigabyte-sized videos or models) into precise, tiny fragments under `100KB` (Dust). After securing them with military-grade AES-256-GCM local encryption, FileDust scatters these fragments into the Arweave/Irys deep web using concurrency throttling. This elegantly capitalizes on the L2 protocol's underlying subsidies for micro-data uploads.

At this point, you only need to keep a tiny `manifest.json` file (a few kilobytes) locally, unlocking vast amounts of physical storage space. When you need to reconstruct the data, using your unique password, all fragments will stream back from the decentralized cosmic cloud, strictly verify their integrity, decrypt on-the-fly, and perfectly reconstruct the original massive file!

---

## 🌟 Core Features

- ✂️ **Nano-Precision Chunking**
  Applies a deliberately calculated `90KB` safety threshold by default. It gently slices any massive file into dimensions that perfectly fit the free-tier protocols without wasting a byte.
- 🛡️ **Military-Grade E2E Invisibility (AES-256-GCM)**
  What enters the blockchain is pure data noise. Not even the gods can piece together or guess your content from the public ledger. Only you, holding the local Password and random Salt, can rebuild the universe.
- 🌊 **Black-Hole Memory Pipeline (Streaming Reconstruct)**
  A uniquely minimalist pipeline design: `Download one block -> decrypt instantly -> append atomically -> release`. Even when reconstructing a 10GB epic video, Node.js remains absolutely stable, with memory spikes no larger than a mere `2MB`.
- 🚦 **Anti-Ban Camouflage Engine (Ratelimit & Jittering)**
  Built-in `p-limit` concurrent throttling combined with bottom-layer retry backpressure and random Jitter. It interacts gently and with restraint with free-tier nodes (like Irys/Bundlr) to avoid triggering DDoS firewalls and subsequent IP bans.

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
    // Feed it the feather-light .manifest.json coordinates, and the galaxy will flow in reverse to rebuild it.
    await downloadFromDust("./videos/secret_movie.mp4.manifest.json", "SuperStrongPassword123!");
    
    // 🎉 Your secret_movie.mp4 descends intact into the current directory.
}
reconstruct();
```

---

## 📜 Geek Vows & Legal (PolyForm Noncommercial 1.0.0)

This project is strictly guarded by the **PolyForm Noncommercial License 1.0.0**.

- ✅ **Unconditionally Permitted**: Any personal geek use, code dissection & learning, technical exploration, and self-hosted non-commercial service building.
- ❌ **Absolutely Prohibited**: Any corporate entity, startup team, or individual attempting to embed or disguise this engine's overall mechanism or core chunking logic into SaaS cloud drives, value-added modules, or to monetize it directly/indirectly for commercial gain.

Stay pure. Preserved only for the pioneers who passionately love geek culture.
