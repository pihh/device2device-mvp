export {};

declare global {
  interface Window {
    d2d: {
      identity(): Promise<any>;
      createPairing(): Promise<any>;
      acceptPairing(code: string): Promise<any>;
      signal(message: any): Promise<any>;
      onServerEvent(callback: (event: any) => void): void;
    };
  }
}

let identity: any;

let peer: RTCPeerConnection | null = null;

let channel: RTCDataChannel | null = null;

let remoteDeviceId: string | null = null;

const deviceElement = document.getElementById("device")!;

const pairCode = document.getElementById("pairCode")!;

const messages = document.getElementById("messages")!;

const messageInput = document.getElementById("message") as HTMLInputElement;

/*
|--------------------------------------------------------------------------
| IDENTITY
|--------------------------------------------------------------------------
*/

async function init() {
  identity = await window.d2d.identity();

  deviceElement.textContent = identity.deviceId;
}

init();

/*
|--------------------------------------------------------------------------
| PAIRING
|--------------------------------------------------------------------------
*/

document.getElementById("createPair")!.addEventListener("click", async () => {
  const result = await window.d2d.createPairing();

  pairCode.textContent = result.code;
});

document.getElementById("acceptPair")!.addEventListener("click", async () => {
  const input = document.getElementById("acceptCode") as HTMLInputElement;

  const code = input.value.trim().toUpperCase();

  if (!code) {
    return;
  }

  const result = await window.d2d.acceptPairing(code);

  if (!result.ok) {
    addMessage(`Pairing failed: ${result.error}`);

    return;
  }

  remoteDeviceId = result.device.deviceId;

  addMessage(`Paired with ${result.device.name}`);
});

/*
|--------------------------------------------------------------------------
| WEBRTC
|--------------------------------------------------------------------------
*/

function createPeer(remoteId: string) {
  remoteDeviceId = remoteId;

  peer = new RTCPeerConnection({
    iceServers: [
      {
        urls: "stun:stun.l.google.com:19302",
      },
    ],
  });

  peer.onicecandidate = async (event) => {
    if (!event.candidate) {
      return;
    }

    await window.d2d.signal({
      type: "ice",

      from: identity.deviceId,

      to: remoteId,

      data: event.candidate,
    });
  };

  peer.onconnectionstatechange = () => {
    console.log("WebRTC:", peer?.connectionState);
  };

  peer.ondatachannel = (event) => {
    setupChannel(event.channel);
  };

  return peer;
}

function setupChannel(dataChannel: RTCDataChannel) {
  channel = dataChannel;

  channel.onopen = () => {
    addMessage("🔐 P2P connection established");
  };

  channel.onmessage = (event) => {
    addMessage(`Remote: ${event.data}`);
  };

  channel.onclose = () => {
    addMessage("P2P connection closed");
  };
}

/*
|--------------------------------------------------------------------------
| CREATE CONNECTION
|--------------------------------------------------------------------------
*/

async function connectTo(remoteId: string) {
  const connection = createPeer(remoteId);

  const dataChannel = connection.createDataChannel("chat");

  setupChannel(dataChannel);

  const offer = await connection.createOffer();

  await connection.setLocalDescription(offer);

  await window.d2d.signal({
    type: "offer",

    from: identity.deviceId,

    to: remoteId,

    data: offer,
  });
}

/*
|--------------------------------------------------------------------------
| SERVER EVENTS
|--------------------------------------------------------------------------
*/

window.d2d.onServerEvent(async (event) => {
  /*
   * Someone accepted our pairing.
   */

  if (event.type === "paired") {
    remoteDeviceId = event.device.deviceId;

    addMessage(`✅ Paired with ${event.device.name}`);

    /*
     * Automatically establish
     * WebRTC connection.
     */

    await connectTo(event.device.deviceId);

    return;
  }

  /*
   * WebRTC signaling
   */

  if (event.type === "offer") {
    remoteDeviceId = event.from;

    const connection = createPeer(event.from);

    await connection.setRemoteDescription(event.data);

    const answer = await connection.createAnswer();

    await connection.setLocalDescription(answer);

    await window.d2d.signal({
      type: "answer",

      from: identity.deviceId,

      to: event.from,

      data: answer,
    });

    return;
  }

  if (event.type === "answer") {
    if (!peer) {
      return;
    }

    await peer.setRemoteDescription(event.data);

    return;
  }

  if (event.type === "ice") {
    if (!peer) {
      return;
    }

    try {
      await peer.addIceCandidate(event.data);
    } catch (error) {
      console.error("ICE error", error);
    }
  }
});

/*
|--------------------------------------------------------------------------
| SEND MESSAGE
|--------------------------------------------------------------------------
*/

document.getElementById("send")!.addEventListener("click", () => {
  const text = messageInput.value.trim();

  if (!text || !channel || channel.readyState !== "open") {
    return;
  }

  channel.send(text);

  addMessage(`You: ${text}`);

  messageInput.value = "";
});

/*
|--------------------------------------------------------------------------
| UI
|--------------------------------------------------------------------------
*/

function addMessage(text: string) {
  const element = document.createElement("div");

  element.className = "message";

  element.textContent = text;

  messages.appendChild(element);

  messages.scrollTop = messages.scrollHeight;
}
