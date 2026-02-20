import crypto from 'crypto';
import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';

const DEFAULT_ALGO = 'aes-256-gcm';
const KEY_LENGTH = 128;
const SALT_LENGTH = 32;
const IV_LENGTH = 12;
const SCRYPT_COST = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

async function generateKeyFromPassword(password, saltBase64) {
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('password 不能为空');
    }

    const salt = saltBase64
        ? Buffer.from(saltBase64, 'base64')
        : crypto.randomBytes(SALT_LENGTH);

    const key = await new Promise((resolve, reject) => {
        crypto.scrypt(
            password,
            salt,
            KEY_LENGTH,
            { N: SCRYPT_COST, r: SCRYPT_R, p: SCRYPT_P },
            (err, derivedKey) => {
                if (err) return reject(err);
                resolve(derivedKey);
            }
        );
    });

    return {
        key,
        salt: salt.toString('base64'),
    };
}

async function encrypt(data, key, options = {}) {
    let keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(String(key), 'base64');
    if (keyBuf.length > 32) keyBuf = keyBuf.subarray(0, 32);

    let plain = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(DEFAULT_ALGO, keyBuf, iv);

    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const packed = Buffer.concat([iv, authTag, encrypted]);
    return options.returnBuffer === true ? packed : packed.toString('base64');
}

async function decrypt(cipherText, key, options = {}) {
    let keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(String(key), 'base64');
    if (keyBuf.length > 32) keyBuf = keyBuf.subarray(0, 32);

    const buf = Buffer.isBuffer(cipherText) ? cipherText : Buffer.from(cipherText, 'base64');

    if (buf.length <= IV_LENGTH + 16) {
        throw new Error('cipherText 长度异常');
    }

    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
    const encrypted = buf.subarray(IV_LENGTH + 16);

    const decipher = crypto.createDecipheriv(DEFAULT_ALGO, keyBuf, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    if (options.autoJson === false) {
        return decrypted;
    }

    const text = decrypted.toString('utf8');
    try {
        return JSON.parse(text);
    } catch (error) {
        return text; // return text if json fails
    }
}

async function loadOrGenerateKey(password, keyFile = 'salt.json') {
    let key, salt;

    if (existsSync(keyFile)) {
        console.log("读取 salt.json 文件...");
        const keyDataStr = await readFile(keyFile, 'utf8');
        const keyData = JSON.parse(keyDataStr);
        const result = await generateKeyFromPassword(password, keyData.salt);
        key = result.key;
        salt = keyData.salt;
    } else {
        const result = await generateKeyFromPassword(password);
        key = result.key;
        salt = result.salt;

        // const keyData = { key: key.toString('base64'), salt: salt };
        const keyData = { salt: salt };
        await writeFile(keyFile, JSON.stringify(keyData, null, 2), 'utf8');
    }
    return { key, salt };
}

export { generateKeyFromPassword, encrypt, decrypt, loadOrGenerateKey };
