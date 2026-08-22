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
const STORAGE_FILE = path.join(DATA_DIR, "storage.json");

function ensureStorage(): void {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

function load(): Storage {
  ensureStorage();

  if (!fs.existsSync(STORAGE_FILE)) {
    return {
      trustedDevices: []
    };
  }

  return JSON.parse(
    fs.readFileSync(STORAGE_FILE, "utf8")
  );
}

function save(storage: Storage): void {
  ensureStorage();

  fs.writeFileSync(
    STORAGE_FILE,
    JSON.stringify(storage, null, 2)
  );
}

export function getIdentity(): Identity | undefined {
  return load().identity;
}

export function saveIdentity(identity: Identity): void {
  const storage = load();

  storage.identity = identity;

  save(storage);
}

export function getTrustedDevices(): TrustedDevice[] {
  return load().trustedDevices;
}

export function getTrustedDevice(
  deviceId: string
): TrustedDevice | undefined {
  return load()
    .trustedDevices
    .find(device => device.deviceId === deviceId);
}

export function addTrustedDevice(
  device: TrustedDevice
): void {
  const storage = load();

  const existingIndex =
    storage.trustedDevices.findIndex(
      item => item.deviceId === device.deviceId
    );

  if (existingIndex >= 0) {
    storage.trustedDevices[existingIndex] = device;
  } else {
    storage.trustedDevices.push(device);
  }

  save(storage);
}