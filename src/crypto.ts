import {
  generateKeyPairSync,
  sign,
  verify,
  createHash
} from "node:crypto";

export interface Identity {
  publicKey: string;
  privateKey: string;
  deviceId: string;
}

export function createIdentity(): Identity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
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
    publicKey,
    privateKey,
    deviceId
  };
}

export function signChallenge(
  privateKey: string,
  challenge: string
): string {
  return sign(
    null,
    Buffer.from(challenge),
    privateKey
  ).toString("base64");
}

export function verifyChallenge(
  publicKey: string,
  challenge: string,
  signature: string
): boolean {
  return verify(
    null,
    Buffer.from(challenge),
    publicKey,
    Buffer.from(signature, "base64")
  );
}
