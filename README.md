
# NombaPay Drop-in SDK 🚀 

[![Hackathon Year](https://img.shields.io/badge/Nomba%20%C3%97%20DevCareer-Hackathon%202026-0f766e)](https://github.com/mohammedaliu396-cyber/nombapay-dropin)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Deployment](https://img.shields.io/badge/Production-Live%20Console-success)](https://nombapay-dropin.netlify.app)

A lightweight, high-performance, and secure JavaScript Drop-in SDK that wraps Nomba's Checkout API. This developer tool simplifies merchant payment flows by injecting a responsive, sandboxed secure iframe modal directly into any web application via a single script tag configuration—bypassing build tools and complex framework overhead.

---

## 🎯 Top-3 Differentiation Highlights

*   **Zero Credential Exposure (Absolute Browser Isolation)**: Eliminates client-side security risks by decoupling API token authorization from the browser's viewable network inspection panel.
*   **Automatic Network Resiliency (Fault-Tolerant Retries)**: Integrated network middleware instantly retries intermittent payment handshakes automatically before dropping active checkouts.
*   **Production Developer UX Panel**: Built a custom dynamic runtime logger dashboard providing transparent insight into application execution lifecycles.

---

## 🏗️ Two-Tier Architecture Pattern

```text
[ Browser Context ]                          [ Encrypted Server Proxy ]           [ Nomba Gateway ]
 NombaPayDropin.setup()                        Listen on Port 4000                 Sandbox Server
         |                                              |                                 |
         |------ (POST /api/checkout/create) ---------->|                                 |
         |                                              |-- (Verify cached token / Auth)->|
         |                                              |<-- (Token Handshake Validated)--|
         |                                              |                                 |
         |                                              |---- (Dispatches Order Payload)->|
         |                                              |<--- (Returns checkoutLink URL)--|
         |<----- (Delivers isolated checkoutLink URL)---|                                 |
         |                                                                                |
         |====== (Mounts Isolated Iframe Interface View) ================================>|

```

1. **Frontend Engine (`dist/nombapay-dropin.js`)**: A zero-dependency vanilla JS plugin responsible for DOM modal wrapper setups, iframe sandboxing, event lifecycle listening (`onSuccess`, `onClose`, `onError`), and backdrop animation layers.
2. **Backend Proxy Gateway (`backend/server.js`)**: A secure Node.js Express microservice that securely encapsulates API credentials and handles server-side token state caching for 50 minutes to optimize speed.

---

## 🛠️ Code Implementations

### 1. Simple Drop-in Setup

Include the engine script and initialize the parameters via any button handler:

```html
<!-- Inject the core SDK -->
<script src="[https://nombapay-dropin.netlify.app/dist/nombapay-dropin.js](https://nombapay-dropin.netlify.app/dist/nombapay-dropin.js)"></script>

<script>
  function handlePaymentClick() {
    NombaPayDropin.setup({
      backendUrl: "[https://your-backend-proxy.onrender.com](https://your-backend-proxy.onrender.com)",
      amount: 5000,
      customerEmail: "developer@edoboy.dev",
      onSuccess: function (orderReference) {
        console.log("Payment Confirmed. Reference: " + orderReference);
      },
      onClose: function () {
        console.log("Checkout window dismissed safely.");
      },
      onError: function (error) {
        console.error("SDK Runtime Exception Intercepted: ", error);
      }
    }).open();
  }
</script>

```

### 2. Embedded Fault-Tolerant Retry Logic (SDK Core)

The frontend core features resilient asynchronous retry middleware out-of-the-box to absorb packet drops on mobile networks:

```javascript
async function fetchWithRetry(url, options, retries = 3, delay = 1000) {
  try {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP Error Status: ${response.status}`);
    return await response.json();
  } catch (error) {
    if (retries > 0) {
      console.warn(`Network handshake interrupted. Retrying in ${delay}ms... (${retries} attempts left)`);
      await new Promise(res => setTimeout(res, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 1.5);
    }
    throw error;
  }
}

```

---

## 🚀 Deployment Environment Variables

Configure these secrets within your production environment variables (e.g., Render Dashboard Settings) to protect your merchant keys:

```env
NOMBA_BASE_URL=[https://sandbox.nomba.com](https://sandbox.nomba.com)
NOMBA_ACCOUNT_ID=your_parent_account_id
NOMBA_CLIENT_ID=your_hackathon_client_id
NOMBA_PRIVATE_KEY=your_hackathon_private_key
PORT=4000

```

---

## 📂 Project Directory Topography

```text
nombapay-dropin/
├── index.html                  # Official Product Presentation Platform
├── README.md                   # System Architecture Documentation
├── dist/
│   └── nombapay-dropin.js      # Compiled Client-side SDK Engine
└── backend/
    ├── server.js               # Node.js Token Management Proxy Gateway
    └── package.json            # Microservice Dependencies

```

---

## 📜 License & Acknowledgments

Designed and engineered by **Mohammed Aliu Oziegbe (Edoboy)** for the **Nomba × DevCareer Hackathon 2026**. Distributed under the open-source MIT License terms.
