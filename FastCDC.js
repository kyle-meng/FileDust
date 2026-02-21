/**
 * A simple, educational implementation of the FastCDC (Content-Defined Chunking) algorithm in pure JavaScript.
 * FastCDC was proposed in the USENIX ATC '16 paper "FastCDC: a Fast and Efficient Content-Defined Chunking Approach for Data Deduplication".
 * It is much faster than Rabin fingerprinting because it uses Gear hashing.
 */

// 1. Generate Gear Hash Table
// FastCDC uses a precalculated array of 256 random 64-bit integers.
// For JS, we use BigInt to represent 64-bit integers.
const GEAR_SEED = 1337n;
const GEAR_TABLE = new BigInt64Array(256);

// A simple deterministic PRNG just to generate the table
function lcg(seed) {
    let state = seed;
    return function () {
        state = (state * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
        return state;
    };
}
const rand = lcg(GEAR_SEED);
for (let i = 0; i < 256; i++) {
    GEAR_TABLE[i] = rand();
}

/**
 * FastCDC Chunker Config
 */
class FastCDCConfig {
    /**
     * @param {number} minSize - Minimum chunk size
     * @param {number} avgSize - Target average chunk size
     * @param {number} maxSize - Maximum chunk size
     */
    constructor(minSize = 2048, avgSize = 8192, maxSize = 65536) {
        this.minSize = minSize;
        this.avgSize = avgSize;
        this.maxSize = maxSize;

        // Mask calculations based on avgSize to normalize chunk size distribution.
        // We use two masks: a stricter mask for the first half of the chunk,
        // and a looser mask for the second half.
        // Find the number of bits needed to represent avgSize.
        let bits = Math.log2(avgSize);
        let maskBits = Math.floor(bits);

        // This is a simplified mask generation for learning purposes
        this.maskS = (1n << BigInt(maskBits + 1)) - 1n;
        this.maskL = (1n << BigInt(maskBits - 1)) - 1n;
    }
}

class FastCDC {
    constructor(config = new FastCDCConfig()) {
        this.config = config;
    }

    /**
     * Chunk a given buffer
     * @param {Buffer|Uint8Array} data
     * @returns {number[]} Array of chunk boundary indices
     */
    chunk(data) {
        let boundaries = [];
        let offset = 0;
        let len = data.length;

        while (offset < len) {
            let chunkLen = this.getChunkSize(data, offset, len - offset);
            offset += chunkLen;
            boundaries.push(offset);
        }

        return boundaries;
    }

    getChunkSize(data, offset, remainingLen) {
        // If remaining data is smaller than minSize, just return the rest
        if (remainingLen <= this.config.minSize) {
            return remainingLen;
        }

        // Limit the maximum checked length
        let limit = Math.min(this.config.maxSize, remainingLen);

        // FastCDC ignores the string content up to minSize to save hashing time
        let hash = 0n;
        let i = this.config.minSize;
        let normalSize = this.config.avgSize;

        // Phase 1: Use stricter mask (maskS)
        while (i < normalSize && i < limit) {
            let byte = data[offset + i];
            // Gear Hashing operation: Left shift 1 bit, and add Gear table value
            hash = ((hash << 1n) + GEAR_TABLE[byte]) & 0xffffffffffffffffn;

            if ((hash & this.config.maskS) === 0n) {
                return i;
            }
            i++;
        }

        // Phase 2: Use looser mask (maskL) to forcefully find a boundary 
        // if Phase 1 didn't find one, reducing abnormally large chunks
        while (i < limit) {
            let byte = data[offset + i];
            // Gear Hashing operation
            hash = ((hash << 1n) + GEAR_TABLE[byte]) & 0xffffffffffffffffn;

            if ((hash & this.config.maskL) === 0n) {
                return i;
            }
            i++;
        }

        // If no boundary found until maxSize, force cut at maxSize
        return limit;
    }
}

export { FastCDC, FastCDCConfig };
