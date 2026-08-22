import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify
} from "node:crypto";

export interface Identity {
  deviceId: string;
  publicKey: string;
  privateKey: string;
}

export function createIdentity(): Identity {
  const { publicKey, privateKey } =
    generateKeyPairSync("ed25519", {
      publicKeyEncoding: {
        type: "spki",
        format: "pem"
      },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem"
      }
    });

  const deviceId = createHash("sha256")
    .update(publicKey)
    .digest("hex")
    .slice(0, 16);

  return {
    deviceId,
    publicKey,
    privateKey
  };
}

export function signData(
  privateKey: string,
  data: string
): string {
  return sign(
    null,
    Buffer.from(data),
    privateKey
  ).toString("base64");
}

export function verifyData(
  publicKey: string,
  data: string,
  signature: string
): boolean {
  return verify(
    null,
    Buffer.from(data),
    publicKey,
    Buffer.from(signature, "base64")
  );
}

export function createPairingSecret(): string {
  return randomBytes(32).toString("base64url");
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256")
    .update(secret)
    .digest();
}

export interface EncryptedMessage {
  iv: string;
  tag: string;
  ciphertext: string;
}

export function encryptMessage(
  secret: string,
  plaintext: string
): EncryptedMessage {
  const key = deriveKey(secret);
  const iv = randomBytes(12);

  const cipher = createCipheriv(
    "aes-256-gcm",
    key,
    iv
  );

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);

  return {
    iv: iv.toString("base64url"),
    tag: cipher
      .getAuthTag()
      .toString("base64url"),
    ciphertext: ciphertext
      .toString("base64url")
  };
}

export function decryptMessage(
  secret: string,
  message: EncryptedMessage
): string {
  const key = deriveKey(secret);

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(message.iv, "base64url")
  );

  decipher.setAuthTag(
    Buffer.from(
      message.tag,
      "base64url"
    )
  );

  const plaintext = Buffer.concat([
    decipher.update(
      Buffer.from(
        message.ciphertext,
        "base64url"
      )
    ),
    decipher.final()
  ]);

  return plaintext.toString("utf8");
}