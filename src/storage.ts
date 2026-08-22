import fs from "node:fs";
import path from "node:path";

import type { Identity } from "./crypto.js";

export interface TrustedDevice {
  deviceId: string;
  name: string;
  publicKey: string;
  pairingSecret: string;
}

interface Storage {
  identity?: Identity;
  trustedDevices: TrustedDevice[];
}

const DATA_DIR = path.resolve("./data");

const STORAGE_FILE =
  path.join(DATA_DIR, "storage.json");

function load(): Storage {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });

  if (!fs.existsSync(STORAGE_FILE)) {
    return {
      trustedDevices: []
    };
  }

  return JSON.parse(
    fs.readFileSync(
      STORAGE_FILE,
      "utf8"
    )
  );
}

function save(storage: Storage): void {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });

  fs.writeFileSync(
    STORAGE_FILE,
    JSON.stringify(
      storage,
      null,
      2
    )
  );
}

export function getIdentity():
  Identity | undefined {
  return load().identity;
}

export function saveIdentity(
  identity: Identity
): void {
  const storage = load();

  storage.identity = identity;

  save(storage);
}

export function getTrustedDevices():
  TrustedDevice[] {
  return load().trustedDevices;
}

export function getTrustedDevice(
  deviceId: string
): TrustedDevice | undefined {
  return load()
    .trustedDevices
    .find(
      d => d.deviceId === deviceId
    );
}

export function addTrustedDevice(
  device: TrustedDevice
): void {
  const storage = load();

  const index =
    storage.trustedDevices.findIndex(
      d =>
        d.deviceId === device.deviceId
    );

  if (index >= 0) {
    storage.trustedDevices[index] =
      device;
  } else {
    storage.trustedDevices.push(
      device
    );
  }

  save(storage);
}