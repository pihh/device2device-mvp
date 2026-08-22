import { app, BrowserWindow, ipcMain } from "electron";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SERVER = process.env.D2D_SERVER ?? "http://localhost:3000";

interface Identity {
  deviceId: string;
  name: string;
  publicKey: string;
  privateKey: string;
}

let mainWindow: BrowserWindow | null = null;

let eventRequest: import("node:http").ClientRequest | null = null;

function identityPath() {
  return path.join(app.getPath("userData"), "identity.json");
}

function createIdentity(): Identity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },

    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  const deviceId = crypto
    .createHash("sha256")
    .update(publicKey)
    .digest("hex")
    .slice(0, 16);

  return {
    deviceId,

    name: `Device-${deviceId.slice(0, 6)}`,

    publicKey,
    privateKey,
  };
}

function loadIdentity(): Identity {
  const file = identityPath();

  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  const identity = createIdentity();

  fs.mkdirSync(path.dirname(file), {
    recursive: true,
  });

  fs.writeFileSync(file, JSON.stringify(identity, null, 2));

  return identity;
}

const identity = loadIdentity();

/*
|--------------------------------------------------------------------------
| REGISTER
|--------------------------------------------------------------------------
*/

async function register() {
  const response = await fetch(`${SERVER}/device/register`, {
    method: "POST",

    headers: {
      "content-type": "application/json",
    },

    body: JSON.stringify({
      deviceId: identity.deviceId,

      name: identity.name,

      publicKey: identity.publicKey,
    }),
  });

  if (!response.ok) {
    throw new Error(`Registration failed: ${response.status}`);
  }
}

/*
|--------------------------------------------------------------------------
| SERVER EVENTS
|--------------------------------------------------------------------------
|
| Node 22 does not expose EventSource globally in
| the process we're using, so use fetch() and read
| the SSE stream manually.
|
*/

async function connectEvents() {
  const response = await fetch(
    `${SERVER}/events?deviceId=${identity.deviceId}`,
    {
      headers: {
        Accept: "text/event-stream",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Events connection failed: ${response.status}`);
  }

  if (!response.body) {
    throw new Error("Server returned no event stream");
  }

  console.log("Connected to signaling server");

  const reader = response.body.getReader();

  const decoder = new TextDecoder();

  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, {
      stream: true,
    });

    const events = buffer.split("\n\n");

    buffer = events.pop() ?? "";

    for (const event of events) {
      const line = event.split("\n").find((line) => line.startsWith("data:"));

      if (!line) {
        continue;
      }

      const json = line.slice(5).trim();

      if (!json) {
        continue;
      }

      try {
        const message = JSON.parse(json);

        mainWindow?.webContents.send("server-event", message);
      } catch (error) {
        console.error("Invalid SSE message", error);
      }
    }
  }
}

/*
|--------------------------------------------------------------------------
| PAIR CREATE
|--------------------------------------------------------------------------
*/

ipcMain.handle("pair-create", async () => {
  const response = await fetch(`${SERVER}/pair/create`, {
    method: "POST",

    headers: {
      "content-type": "application/json",
    },

    body: JSON.stringify({
      deviceId: identity.deviceId,
    }),
  });

  return response.json();
});

/*
|--------------------------------------------------------------------------
| PAIR ACCEPT
|--------------------------------------------------------------------------
*/

ipcMain.handle("pair-accept", async (_event, code: string) => {
  const response = await fetch(`${SERVER}/pair/accept`, {
    method: "POST",

    headers: {
      "content-type": "application/json",
    },

    body: JSON.stringify({
      code,

      deviceId: identity.deviceId,
    }),
  });

  return response.json();
});

/*
|--------------------------------------------------------------------------
| IDENTITY
|--------------------------------------------------------------------------
*/

ipcMain.handle("identity", () => {
  return {
    deviceId: identity.deviceId,

    name: identity.name,

    publicKey: identity.publicKey,
  };
});

/*
|--------------------------------------------------------------------------
| SIGNAL
|--------------------------------------------------------------------------
*/

ipcMain.handle("signal", async (_event, message) => {
  const response = await fetch(`${SERVER}/signal`, {
    method: "POST",

    headers: {
      "content-type": "application/json",
    },

    body: JSON.stringify(message),
  });

  return response.json();
});

/*
|--------------------------------------------------------------------------
| WINDOW
|--------------------------------------------------------------------------
*/

function createWindow() {

  const clientRoot =
    path.resolve(
      app.getAppPath(),
      ".."
    );

  mainWindow =
    new BrowserWindow({
      width: 1100,
      height: 750,

      webPreferences: {
        preload:
          path.join(
            app.getAppPath(),
            "preload.cjs"
          ),

        contextIsolation:
          true,

        nodeIntegration:
          false
      }
    });

  const indexPath =
    path.join(
      clientRoot,
      "src",
      "index.html"
    );

  console.log(
    "Loading:",
    indexPath
  );

  mainWindow.loadFile(
    indexPath
  );
}
/*
|--------------------------------------------------------------------------
| START
|--------------------------------------------------------------------------
*/

app.whenReady().then(async () => {
  try {
    await register();

    console.log("Registered:", identity.deviceId);

    /*
     * Create window BEFORE connecting
     * to events so renderer is available.
     */

    createWindow();

    /*
     * Keep signaling connection alive.
     */

    connectEvents().catch((error) => {
      console.error("Signaling connection failed:", error);
    });
  } catch (error) {
    console.error("Could not connect to server", error);

    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
