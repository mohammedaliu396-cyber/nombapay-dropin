const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const NOMBA_BASE_URL = process.env.NOMBA_BASE_URL || "https://sandbox.nomba.com";
const NOMBA_CLIENT_ID = process.env.NOMBA_CLIENT_ID;
const NOMBA_PRIVATE_KEY = process.env.NOMBA_PRIVATE_KEY;
const NOMBA_ACCOUNT_ID = process.env.NOMBA_ACCOUNT_ID;
const NOMBA_WEBHOOK_SECRET = process.env.NOMBA_WEBHOOK_SECRET || "NombaHackathon2026";

let cachedToken = null;
let tokenExpiresAt = 0;

// OAuth Token Generation
async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;

  console.log("Fetching fresh access token from Nomba...");
  const res = await fetch(`${NOMBA_BASE_URL}/v1/auth/token/issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accountId: NOMBA_ACCOUNT_ID,
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: NOMBA_CLIENT_ID,
      client_secret: NOMBA_PRIVATE_KEY,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.data || !data.data.access_token) {
    console.error("Nomba Authentication Failed:", data);
    throw new Error(data.description || "Failed to authenticate with Nomba");
  }

  cachedToken = data.data.access_token;
  tokenExpiresAt = now + 50 * 60 * 1000; // Cache for 50 minutes
  return cachedToken;
}

// Health Check
app.get("/health", (req, res) => {
  res.json({ status: "ok", environment: "sandbox" });
});

// Create Checkout Order (FIXED URL PATHS)
app.post("/api/checkout/create", async (req, res) => {
  try {
    const { amount, customerEmail, orderReference, callbackUrl } = req.body;

    if (!amount || !customerEmail) {
      return res.status(400).json({ error: "amount and customerEmail are required" });
    }

    const token = await getAccessToken();

    // FIXED: Correct Sandbox endpoint pathway
    const nombaRes = await fetch(`${NOMBA_BASE_URL}/v1/checkout/order`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        accountId: NOMBA_ACCOUNT_ID,
      },
      body: JSON.stringify({
        order: {
          amount: String(Number(amount).toFixed(2)),
          currency: "NGN",
          customerEmail: customerEmail,
          callbackUrl: callbackUrl || `${req.protocol}://${req.get("host")}/callback`,
          orderReference: orderReference || "EDO-" + Date.now(),
        },
      }),
    });

    const data = await nombaRes.json();

    if (data.code !== "00") {
      console.error("Nomba Checkout API Error:", data);
      return res.status(400).json({ 
        error: data.description || "Checkout creation failed", 
        details: data 
      });
    }

    res.json({
      checkoutLink: data.data.checkoutLink,
      orderReference: data.data.orderReference,
    });
  } catch (err) {
    console.error("Server Crash Error:", err.message);
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// Verify Order Transaction Status
app.get("/api/checkout/verify/:orderReference", async (req, res) => {
  try {
    const token = await getAccessToken();
    const { orderReference } = req.params;

    // FIXED: Correct Sandbox transaction lookup pathway
    const nombaRes = await fetch(
      `${NOMBA_BASE_URL}/v1/checkout/order?orderReference=${orderReference}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          accountId: NOMBA_ACCOUNT_ID,
        },
      }
    );

    const data = await nombaRes.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Nomba Webhook Receiver
// Verifies the `nomba-signature` header using HMAC-SHA256 per Nomba's documented method:
// https://developer.nomba.com/docs/api-basics/webhook
app.post("/webhook/nomba", (req, res) => {
  try {
    const receivedSignature = req.headers["nomba-signature"];
    const payload = req.body;

    console.log("=== Nomba Webhook Received ===");
    console.log("Event type:", payload?.event_type);
    console.log("Request ID:", payload?.requestId);
    console.log("Headers seen:", Object.keys(req.headers));

    if (!receivedSignature) {
      console.warn("No nomba-signature header present — cannot verify. Accepting for now (hackathon mode).");
      return res.status(200).json({ received: true, verified: false, reason: "missing signature header" });
    }

    // Build the hashing payload per Nomba's documented field order.
    // Falls back gracefully if a field is missing so we don't crash on unexpected payload shapes.
    const merchant = payload?.data?.merchant || {};
    const transaction = payload?.data?.transaction || {};

    const hashingPayload = [
      payload?.event_type || "",
      payload?.requestId || "",
      merchant.userId || "",
      merchant.walletId || "",
      transaction.transactionId || "",
      transaction.type || "",
      transaction.time || "",
      transaction.responseCode || "",
    ].join(":");

    // Nomba appends a timestamp to the signed message. If they send one as a header, use it;
    // otherwise fall back to just the hashing payload alone.
    const timestamp = req.headers["nomba-timestamp"] || req.headers["x-nomba-timestamp"];
    const message = timestamp ? `${hashingPayload}:${timestamp}` : hashingPayload;

    const expectedSignature = crypto
      .createHmac("sha256", NOMBA_WEBHOOK_SECRET)
      .update(message)
      .digest("base64");

    const isValid =
      expectedSignature.length === receivedSignature.length &&
      crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(receivedSignature));

    if (!isValid) {
      console.warn("Signature mismatch.");
      console.warn("Expected:", expectedSignature);
      console.warn("Received:", receivedSignature);
      // Still acknowledge receipt so Nomba doesn't endlessly retry during testing,
      // but flag it clearly as unverified in the response and logs.
      return res.status(200).json({ received: true, verified: false });
    }

    console.log("Signature verified successfully.");

    // Handle the event
    switch (payload?.event_type) {
      case "payment_success":
      case "order_success":
        console.log("Payment succeeded:", transaction.transactionId || payload.requestId);
        break;
      case "payment_failed":
        console.log("Payment failed:", transaction.transactionId || payload.requestId);
        break;
      default:
        console.log("Unhandled event type:", payload?.event_type);
    }

    res.status(200).json({ received: true, verified: true });
  } catch (err) {
    console.error("Webhook processing error:", err.message);
    // Acknowledge anyway so Nomba's retry logic doesn't hammer the endpoint over a parsing bug.
    res.status(200).json({ received: true, verified: false, error: err.message });
  }
});

app.get("/callback", (req, res) => {
  const { orderReference } = req.query;
  res.send(`<h2>Payment Complete</h2><p>Reference: ${orderReference}</p>`);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend proxy running on port ${PORT}`);
});
      
