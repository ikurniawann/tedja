/**
 * Manajer koneksi WhatsApp berbasis Baileys.
 *
 * Ditulis JavaScript polos (ESM) dengan sengaja: service ini harus hidup terus
 * di PM2, dan menghindari langkah build membuat operasionalnya lebih sederhana
 * serta mengurangi cara-cara ia bisa gagal saat restart.
 *
 * Dua hal yang menentukan keandalan gateway ini:
 * 1. Sesi harus persisten — kalau kredensial hilang, nomor wajib scan QR lagi
 *    dan OTP berhenti total sampai ada orang yang menanganinya.
 * 2. Pengiriman harus diberi jeda — mengirim beruntun tanpa jeda adalah pola
 *    paling khas yang memicu WhatsApp memblokir nomor.
 */

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcodeTerminal from "qrcode-terminal";

const SESSION_DIR = process.env.WA_SESSION_DIR || new URL("../.session", import.meta.url).pathname;

/** Jeda acak antar pesan (ms) — meniru ritme manusia, menekan risiko blokir. */
const MIN_SEND_GAP_MS = Number(process.env.WA_MIN_GAP_MS || 1500);
const MAX_SEND_GAP_MS = Number(process.env.WA_MAX_GAP_MS || 3500);

const logger = pino({ level: process.env.WA_LOG_LEVEL || "warn" });

const state = {
  socket: null,
  connected: false,
  /** QR terakhir yang belum dipakai — dibaca lewat GET /qr saat pairing. */
  qr: null,
  phone: null,
  lastConnectedAt: null,
  lastDisconnectReason: null,
  startedAt: new Date().toISOString(),
};

/** Antrean serial: satu pesan pada satu waktu, selalu berjeda. */
let sendChain = Promise.resolve();
let lastSentAt = 0;

function randomGap() {
  return MIN_SEND_GAP_MS + Math.floor(Math.random() * (MAX_SEND_GAP_MS - MIN_SEND_GAP_MS + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ubah nomor jadi JID WhatsApp. Input diharapkan digit 62xxx. */
export function toJid(target) {
  const digits = String(target || "").replace(/\D/g, "");
  if (!digits) return null;
  const normalized = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  if (normalized.length < 10 || normalized.length > 15) return null;
  return `${normalized}@s.whatsapp.net`;
}

export function getStatus() {
  return {
    connected: state.connected,
    phone: state.phone,
    needsPairing: Boolean(state.qr) && !state.connected,
    lastConnectedAt: state.lastConnectedAt,
    lastDisconnectReason: state.lastDisconnectReason,
    startedAt: state.startedAt,
  };
}

export function getQr() {
  return state.qr;
}

export async function connect() {
  const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    auth: authState,
    logger,
    // Gateway tidak membaca chat; menandai online justru membuat notifikasi HP
    // pemilik nomor jadi kacau.
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  state.socket = socket;

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      state.qr = qr;
      console.log("[wa-gateway] QR pairing tersedia. Pindai dengan WhatsApp nomor pengirim:");
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === "open") {
      state.connected = true;
      state.qr = null;
      state.lastConnectedAt = new Date().toISOString();
      state.lastDisconnectReason = null;
      state.phone = socket.user?.id?.split(":")[0] ?? null;
      console.log(`[wa-gateway] Terhubung sebagai ${state.phone}`);
    }

    if (connection === "close") {
      state.connected = false;
      // Baileys membungkus error dengan Boom; statusCode dibaca langsung
      // agar tidak bergantung pada @hapi/boom yang cuma dependensi transitif.
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      state.lastDisconnectReason = String(statusCode ?? "unknown");

      // loggedOut = sesi dicabut dari HP; scan ulang wajib, reconnect percuma.
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.warn(
        `[wa-gateway] Terputus (alasan ${state.lastDisconnectReason}).` +
          (loggedOut
            ? " Sesi dicabut — hapus .session lalu pairing ulang."
            : " Mencoba sambung ulang...")
      );

      if (!loggedOut) {
        setTimeout(() => {
          connect().catch((error) =>
            console.error("[wa-gateway] Gagal sambung ulang:", error?.message ?? error)
          );
        }, 3000);
      }
    }
  });

  return socket;
}

/**
 * Kirim pesan teks. Dijalankan serial dengan jeda acak antar pesan.
 * Mengembalikan objek hasil, tidak melempar, agar pemanggil HTTP mudah.
 */
export function sendText(target, message) {
  const jid = toJid(target);
  if (!jid) {
    return Promise.resolve({ success: false, reason: "Nomor tujuan tidak valid" });
  }
  if (!message || !String(message).trim()) {
    return Promise.resolve({ success: false, reason: "Pesan kosong" });
  }

  const task = sendChain.then(async () => {
    if (!state.connected || !state.socket) {
      return { success: false, reason: "WhatsApp belum terhubung" };
    }

    const gap = randomGap();
    const sinceLast = Date.now() - lastSentAt;
    if (sinceLast < gap) await sleep(gap - sinceLast);

    try {
      const result = await state.socket.sendMessage(jid, { text: String(message) });
      lastSentAt = Date.now();
      return { success: true, messageId: result?.key?.id ?? null };
    } catch (error) {
      lastSentAt = Date.now();
      return { success: false, reason: error?.message ?? "Gagal mengirim" };
    }
  });

  // Rantai tidak boleh putus walau satu tugas gagal.
  sendChain = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}
