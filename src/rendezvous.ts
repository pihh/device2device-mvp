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
    port: number;
  }
}>("/register", async (request) => {
  const { deviceId, publicKey, port } = request.body;

  const peer: Peer = {
    deviceId,
    publicKey,
    ip: request.ip,
    port,
    lastSeen: Date.now()
  };

  peers.set(deviceId, peer);

  return {
    ok: true
  };
});

app.get<{
  Params: {
    deviceId: string;
  };
}>("/peer/:deviceId", async (request, reply) => {
  const peer = peers.get(request.params.deviceId);

  if (!peer) {
    return reply.code(404).send({
      error: "peer_not_found"
    });
  }

  return peer;
});

app.get("/health", async () => ({
  ok: true
}));

await app.listen({
  host: "0.0.0.0",
  port: 3000
});