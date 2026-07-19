/**
 * HTTP API gateway WhatsApp.
 *
 * Keamanan: server ini HANYA mendengar di 127.0.0.1 dan setiap permintaan
 * wajib membawa header `x-gateway-token`. Ia tidak boleh diekspos ke internet —
 * siapa pun yang bisa memanggilnya bisa mengirim WhatsApp atas nama bisnis.
 */

import http from "node:http";
import { connect, getQr, getStatus, sendText } from "./wa.js";

const PORT = Number(process.env.WA_GATEWAY_PORT || 3471);
const HOST = "127.0.0.1";
const TOKEN = process.env.WA_GATEWAY_TOKEN;

if (!TOKEN) {
  console.error(
    "[wa-gateway] WA_GATEWAY_TOKEN wajib diisi — menolak berjalan tanpa autentikasi."
  );
  process.exit(1);
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let data = "";
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("Payload terlalu besar"));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

  // /health sengaja dibuka tanpa token supaya monitoring sederhana tetap bisa
  // memeriksa proses hidup — isinya tidak sensitif.
  if (req.method === "GET" && url.pathname === "/health") {
    const status = getStatus();
    return json(res, status.connected ? 200 : 503, status);
  }

  if (req.headers["x-gateway-token"] !== TOKEN) {
    return json(res, 401, { success: false, error: "Unauthorized" });
  }

  if (req.method === "GET" && url.pathname === "/qr") {
    const qr = getQr();
    if (!qr) {
      return json(res, 404, {
        success: false,
        error: getStatus().connected
          ? "Sudah terhubung — tidak perlu pairing"
          : "QR belum tersedia, coba lagi sesaat lagi",
      });
    }
    return json(res, 200, { success: true, qr });
  }

  if (req.method === "POST" && url.pathname === "/send") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { success: false, error: "JSON tidak valid" });
    }

    const result = await sendText(payload?.target, payload?.message);
    return json(res, result.success ? 200 : 502, {
      success: result.success,
      error: result.success ? undefined : result.reason,
      messageId: result.messageId,
    });
  }

  return json(res, 404, { success: false, error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`[wa-gateway] Mendengar di http://${HOST}:${PORT}`);
});

connect().catch((error) => {
  console.error("[wa-gateway] Gagal memulai koneksi WhatsApp:", error?.message ?? error);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`[wa-gateway] ${signal} diterima, menutup server...`);
    server.close(() => process.exit(0));
  });
}
