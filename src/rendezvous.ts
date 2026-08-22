import Fastify from "fastify";
import dgram from "node:dgram";

const HTTP_PORT = 3000;
const UDP_PORT = 4000;

interface Peer {
  deviceId: string;
  publicKey: string;
  address?: string;
  port?: number;
  lastSeen: number;
}

const peers = new Map<string, Peer>();

const app = Fastify({
  logger: true
});

app.get("/health", async () => {
  return {
    ok: true
  };
});

app.post<{
  Body: {
    deviceId: string;
    publicKey: string;
  };
}>("/register", async request => {
  const {
    deviceId,
    publicKey
  } = request.body;

  const existing = peers.get(deviceId);

  peers.set(deviceId, {
    deviceId,
    publicKey,
    address: existing?.address,
    port: existing?.port,
    lastSeen: Date.now()
  });

  return {
    ok: true
  };
});

app.get<{
  Params: {
    deviceId: string;
  };
}>("/peer/:deviceId", async (request, reply) => {

  const peer =
    peers.get(request.params.deviceId);

  if (!peer) {
    return reply
      .code(404)
      .send({
        error: "peer_not_found"
      });
  }

  return peer;
});

await app.listen({
  host: "127.0.0.1",
  port: HTTP_PORT
});

console.log(
  `Rendezvous HTTP running on http://127.0.0.1:${HTTP_PORT}`
);

//
// UDP rendezvous
//

const udp =
  dgram.createSocket("udp4");

udp.on("message", (data, remote) => {

  let packet: any;

  try {
    packet =
      JSON.parse(
        data.toString()
      );
  } catch {
    return;
  }

  if (
    packet.type !== "rendezvous"
  ) {
    return;
  }

  const peer =
    peers.get(
      packet.deviceId
    );

  if (!peer) {
    return;
  }

  peer.address =
    remote.address;

  peer.port =
    remote.port;

  peer.lastSeen =
    Date.now();

  peers.set(
    packet.deviceId,
    peer
  );

  console.log(
    `UDP ${packet.deviceId} -> ${remote.address}:${remote.port}`
  );
});

udp.bind(
  UDP_PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Rendezvous UDP running on :${UDP_PORT}`
    );
  }
);