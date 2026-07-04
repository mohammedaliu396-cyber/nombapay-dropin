const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const NOMBA_BASE_URL = process.env.NOMBA_BASE_URL || "https://sandbox.nomba.com";
const NOMBA_CLIENT_ID = process.env.NOMBA_CLIENT_ID;
const NOMBA_PRIVATE_KEY = process.env.NOMBA_PRIVATE_KEY;
const NOMBA_ACCOUNT_ID = process.env.NOMBA_ACCOUNT_ID;

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
  if (!res.ok || !data.access_token) {
    console.error("Nomba Authentication Failed:", data);
    throw new Error(data.description || "Failed to authenticate with Nomba");
  }

  cachedToken = data.access_token;
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
    const nombaRes = await fetch(`${NOMBA_BASE_URL}/sandbox/checkout/order`, {
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
      `${NOMBA_BASE_URL}/sandbox/checkout/transaction?orderReference=${orderReference}`,
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend proxy running on port ${PORT}`);
});
