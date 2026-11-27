// WebCrypto utilities: AES-256-GCM account encryption + PBKDF2 bootstrap verification

const PBKDF2_ITERATIONS = 100000;

export const DEFAULT_ADMIN_BOOTSTRAP_HASH =
  'pbkdf2_sha256$100000$4d4246535f41444d494e5f53414c5431$59f811ee1a68a19bed2df625e23856da366cb5228bda91b6b8a12e4ab8de0a4f';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function generateSpaceAesKeyBase64(): Promise<string> {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  return bytesToBase64(raw);
}

export async function importSpaceAesKey(keyBase64: string): Promise<CryptoKey> {
  const rawBytes = base64ToBytes(keyBase64);
  return crypto.subtle.importKey(
    'raw',
    new Uint8Array(rawBytes).buffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJsonPayload(key: CryptoKey, data: unknown): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv).buffer },
    key,
    encoded
  );
  return `aes256gcm$${bytesToBase64(iv)}$${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptJsonPayload<T>(
  key: CryptoKey,
  payload: string
): Promise<T | null> {
  if (!payload || !payload.startsWith('aes256gcm$')) return null;
  const parts = payload.split('$');
  if (parts.length !== 3) return null;
  try {
    const iv = base64ToBytes(parts[1]);
    const cipherBytes = base64ToBytes(parts[2]);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv).buffer },
      key,
      new Uint8Array(cipherBytes).buffer
    );
    const jsonStr = new TextDecoder().decode(decrypted);
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}

async function derivePbkdf2Hex(
  password: string,
  saltBytes: Uint8Array,
  iterations: number
): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const saltBuffer = new Uint8Array(saltBytes).buffer;
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number(parts[1]);
  const saltHex = parts[2];
  const expectedHex = parts[3];
  if (!iterations || !saltHex || !expectedHex) return false;

  const actualHex = await derivePbkdf2Hex(
    password,
    hexToBytes(saltHex),
    iterations
  );
  if (actualHex.length !== expectedHex.length) return false;

  let diff = 0;
  for (let i = 0; i < actualHex.length; i++) {
    diff |= actualHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  }
  return diff === 0;
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) {
    return 'Mật khẩu mới phải có ít nhất 8 ký tự.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Mật khẩu mới phải chứa ít nhất 1 chữ cái viết hoa.';
  }
  if (!/[a-z]/.test(password)) {
    return 'Mật khẩu mới phải chứa ít nhất 1 chữ cái viết thường.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Mật khẩu mới phải chứa ít nhất 1 chữ số.';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Mật khẩu mới phải chứa ít nhất 1 ký tự đặc biệt (VD: @, #, !, ...).';
  }
  return null;
}
