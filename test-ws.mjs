#!/usr/bin/env node
/**
 * Quick WebSocket diagnostic script
 * Usage: node test-ws.mjs [url]
 * Default URL: ws://localhost:8082
 */

const url = process.argv[2] || "ws://localhost:8082";

console.log("=== WebSocket Diagnostic ===");
console.log(`Target: ${url}`);
console.log(`Time:   ${new Date().toISOString()}\n`);

// Step 1: Check if the port is reachable via HTTP
const httpUrl = url.replace("ws://", "http://").replace("wss://", "https://");
console.log(`[1] Testing HTTP reachability at ${httpUrl} ...`);

try {
    const res = await fetch(httpUrl, { signal: AbortSignal.timeout(3000) });
    console.log(`    ✅ HTTP response: ${res.status} ${res.statusText}`);
} catch (e) {
    console.log(`    ⚠️  HTTP failed: ${e.message}`);
    console.log(`    (This is normal if the server only speaks WebSocket)\n`);
}

// Step 2: Also test the API port
const apiUrl = "http://localhost:8080";
console.log(`[2] Testing REST API at ${apiUrl} ...`);
try {
    const res = await fetch(`${apiUrl}/api/rooms`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    console.log(`    ✅ API response: ${res.status} — ${JSON.stringify(data).slice(0, 120)}`);
} catch (e) {
    console.log(`    ❌ API failed: ${e.message}`);
}

// Step 3: Try WebSocket connection
console.log(`\n[3] Connecting WebSocket to ${url} ...`);

const ws = new WebSocket(url);
let gotMessage = false;

const timeout = setTimeout(() => {
    console.log("    ❌ Timed out after 5s — no connection established");
    ws.close();
    process.exit(1);
}, 5000);

ws.addEventListener("open", () => {
    console.log("    ✅ WebSocket OPEN — connection established!");
});

ws.addEventListener("message", (event) => {
    if (!gotMessage) {
        gotMessage = true;
        console.log(`    ✅ First message received from server:`);
    }
    try {
        const msg = JSON.parse(event.data);
        console.log(`       Type: ${msg.type}`);
        console.log(`       Data: ${JSON.stringify(msg).slice(0, 200)}`);
    } catch {
        console.log(`       Raw: ${String(event.data).slice(0, 200)}`);
    }

    // After receiving the welcome message, close cleanly
    clearTimeout(timeout);
    setTimeout(() => {
        console.log("\n=== Diagnosis ===");
        console.log("✅ WebSocket server is reachable and responding.");
        console.log("If the frontend still shows 'Offline', check:");
        console.log("  1. NEXT_PUBLIC_WS_URL in frontend/.env.local matches this URL");
        console.log("  2. The browser is not blocking ws:// connections (try wss://)");
        console.log("  3. No CORS or proxy issue (check browser console)");
        console.log("  4. The frontend was restarted after .env changes");
        ws.close();
        process.exit(0);
    }, 1000);
});

ws.addEventListener("error", (e) => {
    clearTimeout(timeout);
    console.log(`    ❌ WebSocket ERROR: ${e.message || e.type}`);
    console.log("\n=== Diagnosis ===");
    console.log("❌ Cannot connect to WebSocket server.");
    console.log("Possible causes:");
    console.log(`  1. Server is not running on ${url}`);
    console.log("  2. Server is listening on a different port");
    console.log("  3. Firewall blocking the connection");
    console.log("\nCheck with: lsof -i :8082");
    process.exit(1);
});

ws.addEventListener("close", (e) => {
    clearTimeout(timeout);
    if (!gotMessage) {
        console.log(`    ⚠️  WebSocket CLOSED (code: ${e.code}, reason: ${e.reason || "none"})`);
        console.log("    Server accepted connection but closed immediately.");
    }
});
