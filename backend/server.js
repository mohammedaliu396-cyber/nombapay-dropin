const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.use(cors());

const NOMBA_BASE_URL = process.env.NOMBA_BASE_URL || "https://sandbox.nomba.com";
const NOMBA_CLIENT_ID = process.env.NOMBA_CLIENT_ID;
const NOMBA_PRIVATE_KEY = process.env.NOMBA_PRIVATE_KEY;
const NOMBA_ACCOUNT_ID = process.env.NOMBA_ACCOUNT_ID;

// Signing key from the hackathon form: NombaHackathon2026
// (in production, load this from an env var instead of hardcoding it)
const NOMBA_WEBHOOK_SIGNING_KEY = process.env.NOMBA_WEBHOOK_SIGNING_KEY || "NombaHackathon2026";

// IMPORTANT: the webhook route needs the raw request body to verify the
// signature, so we capture it before express's JSON parser touches it.
// Every other route still gets normal JSON parsing.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

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

app.get("/debug", async (req, res) => {
  try {
    const response = await fetch(`${NOMBA_BASE_URL}/v1/auth/token/issue`, {
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
    const data = await response.json();
    res.json({ status: response.status, nombaResponse: data });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Create Checkout Order
app.post("/api/checkout/create", async (req, res) => {
  try {
    const { amount, customerEmail, orderReference, callbackUrl } = req.body;

    if (!amount || !customerEmail) {
      return res.status(400).json({ error: "amount and customerEmail are required" });
    }

    const token = await getAccessToken();

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
        details: data,
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

app.get("/callback", (req, res) => {
  const { orderReference } = req.query;
  res.send(`<h2>Payment Complete</h2><p>Reference: ${orderReference}</p>`);
});

// ---------------------------------------------------------------------------
// NOMBA WEBHOOK
// ---------------------------------------------------------------------------
// This is the server-to-server endpoint that Nomba's systems call directly
// whenever an event happens (e.g. a successful payment). It is separate from
// /callback, which only handles the customer's browser redirect.
//
// Per Nomba's signature verification docs, the signature is computed as:
//   hashingPayload = event_type:requestId:merchant.userId:merchant.walletId:
//                    transaction.transactionId:transaction.type:
//                    transaction.time:transaction.responseCode
//   message         = hashingPayload:timestamp
//   signature       = base64( HMAC_SHA256(message, signingKey) )
//
// The computed signature is compared against the `nomba-signature` header.
// The timestamp is expected in a `nomba-timestamp` header alongside it — if
// your dashboard sends it under a different header name, check the request
// logs below and adjust NOMBA_TIMESTAMP_HEADER accordingly.
// ---------------------------------------------------------------------------

const NOMBA_SIGNATURE_HEADER = "nomba-signature";
const NOMBA_TIMESTAMP_HEADER = "nomba-timestamp";

function safeGet(obj, path) {
  return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : ""), obj);
}

function verifyNombaSignature(payload, timestamp, signingKey) {
  const hashingPayload = [
    payload.event_type,
    payload.requestId,
    safeGet(payload, "data.merchant.userId"),
    safeGet(payload, "data.merchant.walletId"),
    safeGet(payload, "data.transaction.transactionId"),
    safeGet(payload, "data.transaction.type"),
    safeGet(payload, "data.transaction.time"),
    safeGet(payload, "data.transaction.responseCode"),
  ].join(":");

  const message = `${hashingPayload}:${timestamp}`;

  const expected = crypto
    .createHmac("sha256", signingKey)
    .update(message)
    .digest("base64");

  return expected;
}

app.post("/webhook/nomba", (req, res) => {
  try {
    const receivedSignature = req.headers[NOMBA_SIGNATURE_HEADER];
    const timestamp = req.headers[NOMBA_TIMESTAMP_HEADER];

    if (!receivedSignature) {
      console.warn("Nomba webhook missing signature header");
      return res.status(400).json({ error: "Missing signature header" });
    }

    const payload = req.body;

    const expectedSignature = verifyNombaSignature(
      payload,
      timestamp || "",
      NOMBA_WEBHOOK_SIGNING_KEY
    );

    const sigBuffer = Buffer.from(receivedSignature);
    const expectedBuffer = Buffer.from(expectedSignature);

    const isValid =
      sigBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(sigBuffer, expectedBuffer);

    if (!isValid) {
      console.warn("Nomba webhook signature mismatch", {
        received: receivedSignature,
        expected: expectedSignature,
      });
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Signature verified — safe to trust this payload.
    console.log("Verified Nomba webhook event:", payload.event_type);

    switch (payload.event_type) {
      case "payment_success":
        // TODO: mark the matching orderReference/transaction as paid in your DB
        console.log("Payment succeeded:", safeGet(payload, "data.transaction.transactionId"));
        break;
      case "payment_failed":
        console.log("Payment failed:", safeGet(payload, "data.transaction.transactionId"));
        break;
      case "payment_reversal":
        console.log("Payment reversed:", safeGet(payload, "data.transaction.transactionId"));
        break;
      case "payout_success":
        console.log("Payout succeeded:", safeGet(payload, "data.transaction.transactionId"));
        break;
      case "payout_failed":
        console.log("Payout failed:", safeGet(payload, "data.transaction.transactionId"));
        break;
      case "payout_refund":
        console.log("Payout refunded:", safeGet(payload, "data.transaction.transactionId"));
        break;
      default:
        console.log("Unhandled Nomba event type:", payload.event_type);
    }

    // Respond quickly with 200 so Nomba doesn't retry.
    res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook processing error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend proxy running on port ${PORT}`);
});
        
