import Fastify from "fastify";
import cors from "@fastify/cors";
import crypto from "node:crypto";

interface Device {
  deviceId: string;
  name: string;
  publicKey: string;
  createdAt: number;
  lastSeen: number;
  socket?: any;
}

interface PairingRequest {
  code: string;
  initiator: string;
  expiresAt: number;
}

interface SignalMessage {
  type:
    | "offer"
    | "answer"
    | "ice";

  from: string;
  to: string;

  data: unknown;
}

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

const devices =
  new Map<string, Device>();

const pairings =
  new Map<string, PairingRequest>();

/*
|--------------------------------------------------------------------------
| HEALTH
|--------------------------------------------------------------------------
*/

app.get("/health", async () => {
  return {
    ok: true,
    service: "device2device-access-server"
  };
});

/*
|--------------------------------------------------------------------------
| REGISTER DEVICE
|--------------------------------------------------------------------------
*/

app.post<{
  Body: {
    deviceId: string;
    name: string;
    publicKey: string;
  };
}>("/device/register", async request => {

  const {
    deviceId,
    name,
    publicKey
  } = request.body;

  const existing =
    devices.get(deviceId);

  const device: Device = {
    deviceId,
    name,
    publicKey,

    createdAt:
      existing?.createdAt ??
      Date.now(),

    lastSeen:
      Date.now(),

    socket:
      existing?.socket
  };

  devices.set(
    deviceId,
    device
  );

  return {
    ok: true,
    deviceId
  };
});

/*
|--------------------------------------------------------------------------
| DEVICE INFO
|--------------------------------------------------------------------------
*/

app.get<{
  Params: {
    deviceId: string;
  };
}>(
  "/device/:deviceId",
  async (request, reply) => {

    const device =
      devices.get(
        request.params.deviceId
      );

    if (!device) {
      return reply
        .code(404)
        .send({
          error:
            "device_not_found"
        });
    }

    return {
      deviceId:
        device.deviceId,

      name:
        device.name,

      publicKey:
        device.publicKey,

      online:
        Boolean(device.socket),

      lastSeen:
        device.lastSeen
    };
  }
);

/*
|--------------------------------------------------------------------------
| PAIRING CODE
|--------------------------------------------------------------------------
*/

app.post<{
  Body: {
    deviceId: string;
  };
}>(
  "/pair/create",
  async request => {

    const {
      deviceId
    } = request.body;

    const device =
      devices.get(deviceId);

    if (!device) {
      throw new Error(
        "Device not registered"
      );
    }

    const code =
      crypto
        .randomBytes(4)
        .toString("hex")
        .toUpperCase();

    const pairing: PairingRequest = {
      code,

      initiator:
        deviceId,

      expiresAt:
        Date.now() + 5 * 60 * 1000
    };

    pairings.set(
      code,
      pairing
    );

    return {
      code,
      expiresAt:
        pairing.expiresAt
    };
  }
);

/*
|--------------------------------------------------------------------------
| PAIRING ACCEPT
|--------------------------------------------------------------------------
*/

app.post<{
  Body: {
    code: string;
    deviceId: string;
  };
}>(
  "/pair/accept",
  async request => {

    const {
      code,
      deviceId
    } = request.body;

    const pairing =
      pairings.get(code);

    if (!pairing) {
      return {
        ok: false,
        error: "invalid_code"
      };
    }

    if (
      pairing.expiresAt <
      Date.now()
    ) {

      pairings.delete(code);

      return {
        ok: false,
        error: "expired_code"
      };
    }

    const initiator =
      devices.get(
        pairing.initiator
      );

    const accepter =
      devices.get(
        deviceId
      );

    if (
      !initiator ||
      !accepter
    ) {

      return {
        ok: false,
        error: "device_not_found"
      };
    }

    pairings.delete(code);

    /*
     * Tell the initiator that a device
     * accepted the pairing.
     */

    if (initiator.socket) {

      initiator.socket.send(
        JSON.stringify({
          type: "paired",

          device: {
            deviceId:
              accepter.deviceId,

            name:
              accepter.name,

            publicKey:
              accepter.publicKey
          }
        })
      );
    }

    return {
      ok: true,

      device: {
        deviceId:
          initiator.deviceId,

        name:
          initiator.name,

        publicKey:
          initiator.publicKey
      }
    };
  }
);

/*
|--------------------------------------------------------------------------
| WEBSOCKET
|--------------------------------------------------------------------------
*/

const clients =
  new Map<string, any>();

/*
|--------------------------------------------------------------------------
| SIMPLE HTTP LONG-POLL STYLE SIGNALING
|--------------------------------------------------------------------------
|
| For this MVP we use Server-Sent Events.
|
*/

app.get<{
  Querystring: {
    deviceId: string;
  };
}>(
  "/events",
  async (
    request,
    reply
  ) => {

    const deviceId =
      request.query.deviceId;

    const device =
      devices.get(deviceId);

    if (!device) {
      return reply
        .code(404)
        .send({
          error:
            "device_not_found"
        });
    }

    reply.hijack();

    const response =
      reply.raw;

    response.writeHead(
      200,
      {
        "Content-Type":
          "text/event-stream",

        "Cache-Control":
          "no-cache",

        "Connection":
          "keep-alive",

        "Access-Control-Allow-Origin":
          "*"
      }
    );

    response.write(
      `data: ${JSON.stringify({
        type: "connected"
      })}\n\n`
    );

    clients.set(
      deviceId,
      response
    );

    device.socket =
      response;

    device.lastSeen =
      Date.now();

    request.raw.on(
      "close",
      () => {

        clients.delete(
          deviceId
        );

        device.socket =
          undefined;
      }
    );
  }
);

/*
|--------------------------------------------------------------------------
| SIGNALING
|--------------------------------------------------------------------------
*/

app.post<{
  Body: SignalMessage;
}>(
  "/signal",
  async request => {

    const message =
      request.body;

    const target =
      clients.get(
        message.to
      );

    if (!target) {

      return {
        ok: false,
        error:
          "target_offline"
      };
    }

    target.write(
      `data: ${JSON.stringify(
        message
      )}\n\n`
    );

    return {
      ok: true
    };
  }
);

/*
|--------------------------------------------------------------------------
| START
|--------------------------------------------------------------------------
*/

const PORT =
  Number(
    process.env.PORT ?? 3000
  );

await app.listen({
  host: "0.0.0.0",
  port: PORT
});

console.log();
console.log(
  "================================="
);
console.log(
  " DEVICE 2 DEVICE ACCESS SERVER"
);
console.log(
  "================================="
);
console.log();
console.log(
  `Listening on port ${PORT}`
);