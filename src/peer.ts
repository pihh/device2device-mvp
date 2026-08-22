import dgram from "node:dgram";
import readline from "node:readline";
import crypto from "node:crypto";

import qrcode from "qrcode-terminal";

import {
  createIdentity,
  createPairingSecret,
  encryptMessage,
  decryptMessage,
  signData,
  verifyData,
  type Identity
} from "./crypto.js";

import {
  getIdentity,
  saveIdentity,
  getTrustedDevices,
  getTrustedDevice,
  addTrustedDevice
} from "./storage.js";

const RENDEZVOUS =
  process.env.RENDEZVOUS ??
  "http://localhost:3000";

//
// ------------------------------------------------------------
// IDENTITY
// ------------------------------------------------------------
//

let identity: Identity | undefined =
  getIdentity();

if (!identity) {
  identity = createIdentity();

  saveIdentity(identity);

  console.log(
    "Created new device identity."
  );
}

console.log();
console.log("=================================");
console.log(" P2P CHAT");
console.log("=================================");
console.log();
console.log("Device:", identity.deviceId);
console.log();

//
// ------------------------------------------------------------
// UDP
// ------------------------------------------------------------
//

const socket = dgram.createSocket("udp4");

await new Promise<void>((resolve) => {
  socket.bind(0, "0.0.0.0", () => {
    resolve();
  });
});

const address = socket.address();

if (typeof address === "string") {
  throw new Error("Invalid UDP address");
}

console.log(
  "UDP port:",
  address.port
);

//
// ------------------------------------------------------------
// REGISTER
// ------------------------------------------------------------
//

async function register(): Promise<void> {
  await fetch(
    `${RENDEZVOUS}/register`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        deviceId: identity!.deviceId,
        publicKey: identity!.publicKey,
        udpPort: address.port
      })
    }
  );
}

await register();

setInterval(register, 10_000);

//
// ------------------------------------------------------------
// PROTOCOL
// ------------------------------------------------------------
//

interface PairRequest {
  type: "pair-request";

  deviceId: string;
  publicKey: string;

  name: string;

  pairingSecret: string;

  nonce: string;

  signature: string;
}

interface PairResponse {
  type: "pair-response";

  deviceId: string;
  publicKey: string;

  nonce: string;

  signature: string;
}

interface ChatMessage {
  type: "message";

  deviceId: string;

  messageId: string;

  timestamp: number;

  encrypted: ReturnType<
    typeof encryptMessage
  >;
}

interface PingMessage {
  type: "ping";

  deviceId: string;
}

type Packet =
  | PairRequest
  | PairResponse
  | ChatMessage
  | PingMessage;

//
// ------------------------------------------------------------
// SEND
// ------------------------------------------------------------
//

function sendPacket(
  packet: Packet,
  ip: string,
  port: number
): void {
  const data = Buffer.from(
    JSON.stringify(packet)
  );

  socket.send(
    data,
    port,
    ip
  );
}

//
// ------------------------------------------------------------
// RECEIVE
// ------------------------------------------------------------
//

socket.on(
  "message",
  async (data, remote) => {
    let packet: Packet;

    try {
      packet = JSON.parse(
        data.toString()
      );
    } catch {
      console.log(
        "Received invalid packet."
      );

      return;
    }

    //
    // ------------------------------------------------------
    // PAIR REQUEST
    // ------------------------------------------------------
    //

    if (
      packet.type === "pair-request"
    ) {
      console.log();
      console.log(
        "Pair request from:",
        packet.deviceId
      );

      const signedData =
        packet.deviceId +
        packet.publicKey +
        packet.nonce;

      const valid =
        verifyData(
          packet.publicKey,
          signedData,
          packet.signature
        );

      if (!valid) {
        console.log(
          "❌ Invalid pairing signature"
        );

        return;
      }

      console.log(
        "✅ Pairing signature valid"
      );

      console.log();
      console.log(
        `Device "${packet.name}" wants to pair.`
      );

      console.log(
        "Automatically accepting for MVP..."
      );

      addTrustedDevice({
        deviceId:
          packet.deviceId,

        name:
          packet.name,

        publicKey:
          packet.publicKey,

        pairingSecret:
          packet.pairingSecret
      });

      const nonce =
        crypto
          .randomBytes(32)
          .toString("hex");

      const responseData =
        identity!.deviceId +
        identity!.publicKey +
        nonce;

      const response: PairResponse = {
        type: "pair-response",

        deviceId:
          identity!.deviceId,

        publicKey:
          identity!.publicKey,

        nonce,

        signature:
          signData(
            identity!.privateKey,
            responseData
          )
      };

      sendPacket(
        response,
        remote.address,
        remote.port
      );

      console.log(
        "✅ Device paired:"
        ,
        packet.deviceId
      );

      return;
    }

    //
    // ------------------------------------------------------
    // PAIR RESPONSE
    // ------------------------------------------------------
    //

    if (
      packet.type === "pair-response"
    ) {
      const signedData =
        packet.deviceId +
        packet.publicKey +
        packet.nonce;

      const valid =
        verifyData(
          packet.publicKey,
          signedData,
          packet.signature
        );

      if (!valid) {
        console.log(
          "❌ Invalid pair response"
        );

        return;
      }

      console.log(
        "✅ Pair response authenticated."
      );

      return;
    }

    //
    // ------------------------------------------------------
    // CHAT MESSAGE
    // ------------------------------------------------------
    //

    if (
      packet.type === "message"
    ) {
      const device =
        getTrustedDevice(
          packet.deviceId
        );

      if (!device) {
        console.log(
          "❌ Message from untrusted device."
        );

        return;
      }

      try {
        const plaintext =
          decryptMessage(
            device.pairingSecret,
            packet.encrypted
          );

        console.log();
        console.log(
          `[${packet.deviceId}] ${plaintext}`
        );
        console.log("> ");

      } catch {
        console.log(
          "❌ Could not decrypt message."
        );
      }

      return;
    }

    //
    // ------------------------------------------------------
    // PING
    // ------------------------------------------------------
    //

    if (
      packet.type === "ping"
    ) {
      console.log(
        `💓 Ping from ${packet.deviceId}`
      );

      return;
    }
  }
);

//
// ------------------------------------------------------------
// PAIRING
// ------------------------------------------------------------
//

async function pair(
  deviceId: string,
  name = "My Device"
): Promise<void> {

  const peerResponse =
    await fetch(
      `${RENDEZVOUS}/peer/${deviceId}`
    );

  if (!peerResponse.ok) {
    throw new Error(
      "Peer not found"
    );
  }

  const peer =
    await peerResponse.json() as {
      deviceId: string;
      publicKey: string;
      ip: string;
      port: number;
    };

  const pairingSecret =
    createPairingSecret();

  const nonce =
    crypto
      .randomBytes(32)
      .toString("hex");

  const signedData =
    identity!.deviceId +
    identity!.publicKey +
    nonce;

  const packet: PairRequest = {
    type: "pair-request",

    deviceId:
      identity!.deviceId,

    publicKey:
      identity!.publicKey,

    name,

    pairingSecret,

    nonce,

    signature:
      signData(
        identity!.privateKey,
        signedData
      )
  };

  sendPacket(
    packet,
    peer.ip,
    peer.port
  );

  console.log();
  console.log(
    "Pair request sent."
  );

  console.log(
    "Pairing secret generated."
  );

  //
  // Store peer immediately for MVP.
  //
  addTrustedDevice({
    deviceId:
      peer.deviceId,

    name:
      "Remote Device",

    publicKey:
      peer.publicKey,

    pairingSecret
  });

  console.log(
    "✅ Device added to trusted devices."
  );
}

//
// ------------------------------------------------------------
// CHAT
// ------------------------------------------------------------
//

async function sendMessage(
  deviceId: string,
  text: string
): Promise<void> {

  const device =
    getTrustedDevice(
      deviceId
    );

  if (!device) {
    console.log(
      "❌ Device is not trusted."
    );

    return;
  }

  const peerResponse =
    await fetch(
      `${RENDEZVOUS}/peer/${deviceId}`
    );

  if (!peerResponse.ok) {
    console.log(
      "❌ Peer is offline."
    );

    return;
  }

  const peer =
    await peerResponse.json() as {
      ip: string;
      port: number;
    };

  const packet: ChatMessage = {
    type: "message",

    deviceId:
      identity!.deviceId,

    messageId:
      crypto
        .randomUUID(),

    timestamp:
      Date.now(),

    encrypted:
      encryptMessage(
        device.pairingSecret,
        text
      )
  };

  sendPacket(
    packet,
    peer.ip,
    peer.port
  );

  console.log(
    `You: ${text}`
  );
}

//
// ------------------------------------------------------------
// LIST DEVICES
// ------------------------------------------------------------
//

function listDevices(): void {
  const devices =
    getTrustedDevices();

  console.log();

  if (!devices.length) {
    console.log(
      "No trusted devices."
    );

    return;
  }

  for (
    const device of devices
  ) {
    console.log(
      `${device.name} | ${device.deviceId}`
    );
  }

  console.log();
}

//
// ------------------------------------------------------------
// QR
// ------------------------------------------------------------
//

function showPairingQr(): void {
  const data = JSON.stringify({
    v: 2,

    deviceId:
      identity!.deviceId,

    publicKey:
      identity!.publicKey
  });

  console.log();
  console.log(
    "Scan this QR from the other device:"
  );

  qrcode.generate(
    data,
    {
      small: true
    }
  );
}

//
// ------------------------------------------------------------
// CLI
// ------------------------------------------------------------
//

const rl =
  readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

console.log();
console.log(
  "Commands:"
);

console.log(
  "  qr"
);

console.log(
  "  pair <deviceId>"
);

console.log(
  "  devices"
);

console.log(
  "  send <deviceId> <message>"
);

console.log(
  "  exit"
);

console.log();

rl.on(
  "line",
  async line => {

    const parts =
      line.trim().split(/\s+/);

    const command =
      parts.shift();

    try {

      if (
        command === "qr"
      ) {
        showPairingQr();
      }

      else if (
        command === "pair"
        && parts[0]
      ) {
        await pair(
          parts[0]
        );
      }

      else if (
        command === "devices"
      ) {
        listDevices();
      }

      else if (
        command === "send"
        && parts.length >= 2
      ) {
        const deviceId =
          parts.shift()!;

        const message =
          parts.join(" ");

        await sendMessage(
          deviceId,
          message
        );
      }

      else if (
        command === "exit"
      ) {
        process.exit(0);
      }

      else {
        console.log(
          "Unknown command."
        );
      }

    } catch (error) {
      console.error(
        error
      );
    }

  }
);