const {
  contextBridge,
  ipcRenderer
} = require("electron");

contextBridge.exposeInMainWorld(
  "d2d",
  {
    identity:
      () =>
        ipcRenderer.invoke(
          "identity"
        ),

    createPairing:
      () =>
        ipcRenderer.invoke(
          "pair-create"
        ),

    acceptPairing:
      code =>
        ipcRenderer.invoke(
          "pair-accept",
          code
        ),

    signal:
      message =>
        ipcRenderer.invoke(
          "signal",
          message
        ),

    onServerEvent:
      callback => {

        ipcRenderer.on(
          "server-event",
          (_event, data) => {

            callback(data);
          }
        );
      }
  }
);