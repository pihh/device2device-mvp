import Fastify from "fastify";

const app = Fastify({
  logger: true
});

interface Peer {
  deviceId: string;
  publicKey: string;

  ip: string;
  port: number;

  lastSeen: number;
}

const peers = new Map<string, Peer>();

app.post<{
  Body: {
    deviceId: string;
    publicKey: string;
    udpPort: number;
  };
}>("/register", async (request) => {
  const {
    deviceId,
    publicKey,
    udpPort
  } = request.body;

  const ip =
    request.headers["x-forwarded-for"]?.toString()
      ?.split(",")[0]
      ?.trim()
    ?? request.ip;

  const peer: Peer = {
    deviceId,
    publicKey,
    ip,
    port: udpPort,
    lastSeen: Date.now()
  };

  peers.set(deviceId, peer);

  return {
    ok: true,
    deviceId
  };
});

app.get<{
  Params: {
    deviceId: string;
  };
}>("/peer/:deviceId", async (request, reply) => {
  const peer = peers.get(
    request.params.deviceId
  );

  if (!peer) {
    return reply.code(404).send({
      error: "peer_not_found"
    });
  }

  return peer;
});

app.get("/peers", async () => {
  const now = Date.now();

  return [...peers.values()]
    .filter(peer =>
      now - peer.lastSeen < 30_000
    )
    .map(peer => ({
      deviceId: peer.deviceId,
      publicKey: peer.publicKey,
      ip: peer.ip,
      port: peer.port,
      lastSeen: peer.lastSeen
    }));
});

app.get("/health", async () => ({
  ok: true
}));

await app.listen({
  host: "0.0.0.0",
  port: 3000
});