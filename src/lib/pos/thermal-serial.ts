const BAUD_KEY = "arkiv-pos-thermal-baud";
const DEFAULT_BAUD = 9600;

type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  writable: WritableStream<Uint8Array> | null;
};

type SerialApi = {
  requestPort: () => Promise<SerialPortLike>;
  getPorts: () => Promise<SerialPortLike[]>;
};

function getSerialApi(): SerialApi | null {
  if (typeof navigator === "undefined") return null;
  const serial = (navigator as Navigator & { serial?: SerialApi }).serial;
  return serial ?? null;
}

export function canUseDirectThermalPrint() {
  return Boolean(getSerialApi());
}

export const THERMAL_BAUD_OPTIONS = [9600, 19200, 115200] as const;
export type ThermalBaud = (typeof THERMAL_BAUD_OPTIONS)[number];

export function getThermalBaud(): ThermalBaud {
  if (typeof window === "undefined") return DEFAULT_BAUD;
  const raw = Number(window.localStorage.getItem(BAUD_KEY));
  return THERMAL_BAUD_OPTIONS.includes(raw as ThermalBaud) ? (raw as ThermalBaud) : DEFAULT_BAUD;
}

export function setThermalBaud(baud: ThermalBaud) {
  window.localStorage.setItem(BAUD_KEY, String(baud));
}

export async function getPairedThermalCount() {
  const serial = getSerialApi();
  if (!serial) return 0;
  const ports = await serial.getPorts();
  return ports.length;
}

async function writeToPort(port: SerialPortLike, bytes: Uint8Array) {
  const baudRate = getThermalBaud();
  await port.open({ baudRate });
  try {
    if (!port.writable) throw new Error("Printer tidak writable");
    const writer = port.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  } finally {
    try {
      await port.close();
    } catch {
      // ignore close race
    }
  }
}

export async function pairThermalPrinter() {
  const serial = getSerialApi();
  if (!serial) {
    throw new Error("Browser ini tidak mendukung print langsung. Pakai Chrome/Edge di laptop.");
  }
  const port = await serial.requestPort();
  await writeToPort(port, Uint8Array.from([0x1b, 0x40]));
}

export async function printBytesToPairedThermal(bytes: Uint8Array): Promise<boolean> {
  const serial = getSerialApi();
  if (!serial) return false;
  const ports = await serial.getPorts();
  const port = ports[0];
  if (!port) return false;
  await writeToPort(port, bytes);
  return true;
}
