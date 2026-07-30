// ============================================================
//  keepAlive.js — Prevent Render backend from sleeping
//  Usage: import and call keepAlive() after your server starts
// ============================================================

const BACKEND_URL =
  process.env.BACKEND_URL || "https://updated-stage3.onrender.com";

const PING_INTERVAL_MS = 11 * 60 * 1000; // 11 minutes (Render sleeps at 15)

/**
 * Pings the /health endpoint on a fixed interval to prevent
 * Render's free-tier spin-down. Call this once after app.listen().
 */
function keepAlive() {
  console.log(
    `[keep-alive] Started. Pinging ${BACKEND_URL}/health every 11 minutes.`
  );

  async function ping() {
    try {
      const res = await fetch(`${BACKEND_URL}/health`);
      console.log(
        `[keep-alive] Ping OK — status: ${res.status} at ${new Date().toISOString()}`
      );
    } catch (err) {
      console.error(`[keep-alive] Ping failed: ${err.message}`);
    }
  }

  // Immediate first ping, then on interval
  ping();
  setInterval(ping, PING_INTERVAL_MS);
}

module.exports = keepAlive;