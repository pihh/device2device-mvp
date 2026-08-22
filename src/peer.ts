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

const RENDEZVOUS_HOST =
  new URL(
    RENDEZVOUS
  ).hostname;

const RENDEZVOUS_UDP_PORT =
  Number(
    process.env.RENDEZVOUS_UDP_PORT ??
    4000
  );

//
// IDENTITY
//

let identity =
  getIdentity();

if (!identity) {
  identity =
    createIdentity();

  saveIdentity(
    identity
  );
}

console.log();
console.log(
  "================================="
);
console.log(
  " DEVICE 2 DEVICE"
);
console.log(
  "================================="
);
console.log();

console.log(
  "Device:",
  identity.deviceId
);

//
// UDP SOCKET
//

const socket =
  dgram.createSocket("udp4");

await new Promise<void>(
  resolve => {

    socket.bind(
      0,
      "0.0.0.0",
      () => resolve()
    );

  }
);

const local =
  socket.address();

if (
  typeof local === "string"
) {
  throw new Error(
    "Invalid UDP address"
  );
}

console.log(
  "Local UDP port:",
  local.port
);

//
// REGISTER HTTP
//

async function register(): Promise<void> {

  const response =
    await fetch(
      `${RENDEZVOUS}/register`,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body: JSON.stringify({
          deviceId:
            identity!.deviceId,

          publicKey:
            identity!.publicKey
        })
      }
    );

  if (!response.ok) {
    throw new Error(
      `Register failed: ${response.status}`
    );
  }
}

await register();

setInterval(
  () => {
    register()
      .catch(console.error);
  },
  10_000
);

//
// UDP RENDEZVOUS
//

function sendRendezvousPacket() {

  const packet = {
    type: "rendezvous",

    deviceId:
      identity!.deviceId
  };

  socket.send(
    Buffer.from(
      JSON.stringify(packet)
    ),
    RENDEZVOUS_UDP_PORT,
    RENDEZVOUS_HOST
  );
}

sendRendezvousPacket();

setInterval(
  sendRendezvousPacket,
  5_000
);

//
// PACKETS
//

interface Punch {
  type: "punch";

  deviceId: string;
}

interface Hello {
  type: "hello";

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

type Packet =
  | Punch
  | Hello
  | ChatMessage;

function sendPacket(
  packet: Packet,
  host: string,
  port: number
) {
  socket.send(
    Buffer.from(
      JSON.stringify(packet)
    ),
    port,
    host
  );
}

//
// RECEIVE UDP
//

socket.on(
  "message",
  data => {

    let packet: Packet;

    try {
      packet =
        JSON.parse(
          data.toString()
        );
    } catch {
      return;
    }

    //
    // PUNCH
    //

    if (
      packet.type ===
      "punch"
    ) {

      console.log(
        `\n📡 UDP received from ${packet.deviceId}`
      );

      return;
    }

    //
    // HELLO
    //

    if (
      packet.type ===
      "hello"
    ) {

      const trusted =
        getTrustedDevice(
          packet.deviceId
        );

      if (!trusted) {
        console.log(
          "\n❌ Untrusted device:"
          ,
          packet.deviceId
        );

        return;
      }

      const valid =
        verifyData(
          packet.publicKey,

          packet.deviceId +
            packet.nonce,

          packet.signature
        );

      if (!valid) {
        console.log(
          "\n❌ Invalid signature"
        );

        return;
      }

      console.log(
        `\n🔐 Authenticated ${packet.deviceId}`
      );

      return;
    }

    //
    // CHAT
    //

    if (
      packet.type ===
      "message"
    ) {

      const trusted =
        getTrustedDevice(
          packet.deviceId
        );

      if (!trusted) {
        console.log(
          "\n❌ Message from untrusted device"
        );

        return;
      }

      try {

        const text =
          decryptMessage(
            trusted.pairingSecret,
            packet.encrypted
          );

        console.log();
        console.log(
          `💬 ${text}`
        );
        console.log();

      } catch {

        console.log(
          "\n❌ Could not decrypt message"
        );

      }
    }
  }
);

//
// FIND PEER
//

async function getPeer(
  deviceId: string
) {

  const response =
    await fetch(
      `${RENDEZVOUS}/peer/${deviceId}`
    );

  if (!response.ok) {
    throw new Error(
      `Peer unavailable: ${response.status}`
    );
  }

  return await response.json() as {
    deviceId: string;
    publicKey: string;
    address: string;
    port: number;
  };
}

//
// CONNECT
//

async function connect(
  deviceId: string
) {

  const peer =
    await getPeer(
      deviceId
    );

  console.log();
  console.log(
    "Peer endpoint:"
  );

  console.log(
    `${peer.address}:${peer.port}`
  );

  console.log();

  //
  // Send multiple packets.
  //
  // Both sides need to do this.
  // This is the basic hole-punching
  // mechanism.
  //

  const packet: Punch = {
    type: "punch",

    deviceId:
      identity!.deviceId
  };

  for (
    let i = 0;
    i < 20;
    i++
  ) {

    sendPacket(
      packet,
      peer.address,
      peer.port
    );

    await sleep(250);
  }

  //
  // Authenticated hello
  //

  const nonce =
    crypto
      .randomBytes(32)
      .toString("hex");

  const hello: Hello = {
    type: "hello",

    deviceId:
      identity!.deviceId,

    publicKey:
      identity!.publicKey,

    nonce,

    signature:
      signData(
        identity!.privateKey,

        identity!.deviceId +
          nonce
      )
  };

  sendPacket(
    hello,
    peer.address,
    peer.port
  );

  console.log(
    "🚀 Connection attempt sent."
  );
}

//
// SEND CHAT
//

async function sendMessage(
  deviceId: string,
  text: string
) {

  const trusted =
    getTrustedDevice(
      deviceId
    );

  if (!trusted) {
    console.log(
      "❌ Device is not trusted."
    );

    return;
  }

  const peer =
    await getPeer(
      deviceId
    );

  const message: ChatMessage = {
    type: "message",

    deviceId:
      identity!.deviceId,

    messageId:
      crypto.randomUUID(),

    timestamp:
      Date.now(),

    encrypted:
      encryptMessage(
        trusted.pairingSecret,
        text
      )
  };

  //
  // Punch first
  //

  for (
    let i = 0;
    i < 5;
    i++
  ) {

    sendPacket(
      {
        type: "punch",
        deviceId:
          identity!.deviceId
      },
      peer.address,
      peer.port
    );

    await sleep(100);
  }

  sendPacket(
    message,
    peer.address,
    peer.port
  );

  console.log(
    `You: ${text}`
  );
}

//
// PAIR
//

async function pair(
  deviceId: string
) {

  const peer =
    await getPeer(
      deviceId
    );

  const pairingSecret =
    createPairingSecret();

  //
  // For this MVP the secret is
  // encrypted later.
  //
  // We keep this temporarily simple
  // so we can first prove connectivity.
  //

  const nonce =
    crypto
      .randomBytes(32)
      .toString("hex");

  const packet = {
    type: "hello",

    deviceId:
      identity!.deviceId,

    publicKey:
      identity!.publicKey,

    nonce,

    signature:
      signData(
        identity!.privateKey,

        identity!.deviceId +
          nonce
      )
  };

  //
  // Store trusted peer.
  //

  addTrustedDevice({
    deviceId:
      peer.deviceId,

    name:
      "Remote device",

    publicKey:
      peer.publicKey,

    pairingSecret
  });

  //
  // Punch.
  //

  for (
    let i = 0;
    i < 20;
    i++
  ) {

    sendPacket(
      {
        type: "punch",
        deviceId:
          identity!.deviceId
      },
      peer.address,
      peer.port
    );

    await sleep(250);
  }

  sendPacket(
    packet,
    peer.address,
    peer.port
  );

  console.log();
  console.log(
    "✅ Pair request sent."
  );
}

//
// QR
//

function showQr() {

  const payload =
    JSON.stringify({
      v: 2,

      deviceId:
        identity!.deviceId,

      publicKey:
        identity!.publicKey
    });

  console.log();

  qrcode.generate(
    payload,
    {
      small: true
    }
  );
}

//
// DEVICES
//

function listDevices() {

  console.log();

  for (
    const device of
      getTrustedDevices()
  ) {

    console.log(
      `${device.name} | ${device.deviceId}`
    );
  }

  console.log();
}

//
// UTIL
//

function sleep(
  ms: number
) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

//
// CLI
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
  "  connect <deviceId>"
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
      line.trim()
        .split(/\s+/);

    const command =
      parts.shift();

    try {

      switch (command) {

        case "qr":
          showQr();
          break;

        case "pair":
          if (parts[0]) {
            await pair(
              parts[0]
            );
          }
          break;

        case "connect":
          if (parts[0]) {
            await connect(
              parts[0]
            );
          }
          break;

        case "devices":
          listDevices();
          break;

        case "send":

          if (
            parts.length >= 2
          ) {

            const deviceId =
              parts.shift()!;

            await sendMessage(
              deviceId,
              parts.join(" ")
            );
          }

          break;

        case "exit":
          process.exit(0);

        default:
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