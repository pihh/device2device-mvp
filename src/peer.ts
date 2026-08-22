import dgram from "node:dgram";
import fs from "node:fs";
import readline from "node:readline";
import crypto from "node:crypto";

import {
  createIdentity,
  signChallenge,
  verifyChallenge,
  type Identity
} from "./crypto.js";

const RENDEZVOUS = "http://localhost:3000";

const IDENTITY_FILE = "./identity.json";

function loadIdentity(): Identity {
  if (fs.existsSync(IDENTITY_FILE)) {
    return JSON.parse(
      fs.readFileSync(IDENTITY_FILE, "utf8")
    );
  }

  const identity = createIdentity();

  fs.writeFileSync(
    IDENTITY_FILE,
    JSON.stringify(identity, null, 2)
  );

  return identity;
}

const identity = loadIdentity();

console.log();
console.log("Device:", identity.deviceId);
console.log();

const socket = dgram.createSocket("udp4");

await new Promise<void>((resolve) => {
  socket.bind(0, "0.0.0.0", () => resolve());
});

const address = socket.address();

if (typeof address === "string") {
  throw new Error("Invalid UDP address");
}

console.log("UDP port:", address.port);

async function register() {
  await fetch(`${RENDEZVOUS}/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      deviceId: identity.deviceId,
      publicKey: identity.publicKey,
      port: address.port
    })
  });
}

await register();

setInterval(register, 10_000);

interface HelloMessage {
  type: "hello";
  deviceId: string;
  publicKey: string;
  challenge: string;
  signature: string;
}

interface ResponseMessage {
  type: "response";
  deviceId: string;
  challenge: string;
  signature: string;
}

socket.on("message", (data, remote) => {
  let message: HelloMessage | ResponseMessage;

  try {
    message = JSON.parse(data.toString());
  } catch {
    return;
  }

  console.log(
    `\nReceived ${message.type} from ${remote.address}:${remote.port}`
  );

  if (message.type === "hello") {
    const valid = verifyChallenge(
      message.publicKey,
      message.challenge,
      message.signature
    );

    if (!valid) {
      console.log("❌ Invalid signature");
      return;
    }

    console.log(
      `✅ Authenticated peer ${message.deviceId}`
    );

    const challenge = crypto.randomBytes(32).toString("hex");

    const response: ResponseMessage = {
      type: "response",
      deviceId: identity.deviceId,
      challenge,
      signature: signChallenge(
        identity.privateKey,
        challenge
      )
    };

    socket.send(
      Buffer.from(JSON.stringify(response)),
      remote.port,
      remote.address
    );
  }

  if (message.type === "response") {
    console.log(
      "Peer responded to our challenge:",
      message.deviceId
    );
  }
});

async function connectTo(deviceId: string) {
  const response = await fetch(
    `${RENDEZVOUS}/peer/${deviceId}`
  );

  if (!response.ok) {
    throw new Error("Peer not found");
  }

  const peer = await response.json() as {
    deviceId: string;
    publicKey: string;
    ip: string;
    port: number;
  };

  console.log();
  console.log("Peer found:");
  console.log(peer);
  console.log();

  const challenge = crypto
    .randomBytes(32)
    .toString("hex");

  const hello: HelloMessage = {
    type: "hello",
    deviceId: identity.deviceId,
    publicKey: identity.publicKey,
    challenge,
    signature: signChallenge(
      identity.privateKey,
      challenge
    )
  };

  const packet = Buffer.from(
    JSON.stringify(hello)
  );

  // UDP hole punching / first packet.
  socket.send(
    packet,
    peer.port,
    peer.ip
  );

  console.log(
    `📡 Packet sent to ${peer.ip}:${peer.port}`
  );
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log(
  "Commands: connect <deviceId> | exit"
);

rl.on("line", async (line) => {
  const [command, argument] = line.trim().split(/\s+/);

  if (command === "connect" && argument) {
    try {
      await connectTo(argument);
    } catch (error) {
      console.error(error);
    }
  }

  if (command === "exit") {
    process.exit(0);
  }
});