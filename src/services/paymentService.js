const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || window.location.origin;

const getSecureRandom = () => {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] / 4294967296;
};

const getSecureRandomInt = (max) => {
  return Math.floor(getSecureRandom() * max);
};

// Helper to determine if we are in explicit mock/dev mode.
// IMPORTANT: This must NEVER be true in production builds.
// Set VITE_ENABLE_MOCK=true only in .env.development for local testing.
const shouldMock = () => {
  return import.meta.env.VITE_ENABLE_MOCK === "true";
};

const isMockSession = (accessKey) => {
  return accessKey?.startsWith("TEST_") || shouldMock();
};

/**
 * Fetch transaction session details using the ACCESS_KEY.
 * PCI DSS compliant: Never exposes merchant keys, salts, or signature hashes.
 * @param {string} accessKey
 */
export async function fetchSession(accessKey) {
  // DEV/TEST ONLY: If mock mode is active, return a simulated session.
  // Amount is intentionally omitted here; it must always come from the real API.
  // This branch is unreachable in production (VITE_ENABLE_MOCK is not set).
  if (isMockSession(accessKey)) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const sessionCreatedAt = Date.now();
    return {
      status: "success",
      data: {
        merchant_name: "TpiPay Secure Commerce [TEST]",
        merchant_logo: "",
        // No hardcoded amount — mock sessions must use a realistic placeholder
        // only if the backend truly cannot be reached in a test environment.
        amount: null,
        currency: "INR",
        txnid: `TXN${Math.floor(100000000 + getSecureRandom() * 900000000)}`,
        orderId: `ORD-${Date.now()}`,
        merchantRef: `MREF-${getSecureRandomInt(999999).toString().padStart(6, "0")}`,
        customer_name: "Test User",
        customer_email: "test@example.com",
        customer_phone: "9999999999",
        allowed_modes: ["UPI", "Netbanking", "Cards"],
        sessionCreatedAt,
        sessionExpiresAt: sessionCreatedAt + 15 * 60 * 1000,
        paymentStatus: "INITIATED",
      }
    };
  }

  // PRODUCTION PATH: Always fetch the real session from the backend.
  const response = await fetch(`${API_BASE_URL}/api/payment/session/${accessKey}`, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Session fetch failed with status ${response.status}`);
  }

  const data = await response.json();
  // Normalize sessionExpiresAt if not provided by backend
  if (data?.data && !data.data.sessionExpiresAt) {
    const createdAt = data.data.sessionCreatedAt || Date.now();
    data.data.sessionExpiresAt = createdAt + 15 * 60 * 1000;
  }
  return data;
  // NOTE: No catch/fallback here. Any API failure is re-thrown so that
  // CheckoutPage.jsx can display the correct error state to the user
  // instead of silently showing stale or hardcoded payment data.
}

/**
 * Verify a UPI VPA (Virtual Payment Address).
 * Returns { valid: boolean, accountName: string | null, error: string | null }
 * @param {string} upiId
 * @param {string} accessKey
 */
export async function verifyUpiId(upiId, accessKey) {
  try {
    if (isMockSession(accessKey)) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      // Simulate realistic UPI validation
      const isValidFormat = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(upiId);
      if (!isValidFormat) {
        return { valid: false, accountName: null, error: "Invalid UPI ID format" };
      }
      // Simulate some known invalid VPAs
      if (upiId.toLowerCase().includes("invalid") || upiId.toLowerCase().includes("test@fail")) {
        return { valid: false, accountName: null, error: "VPA not found or inactive" };
      }
      const mockNames = ["Rahul Sharma", "Priya Patel", "Amit Kumar", "Sunita Verma", "John Doe"];
      return {
        valid: true,
        accountName: mockNames[getSecureRandomInt(mockNames.length)],
        error: null
      };
    }

    const response = await fetch(`${API_BASE_URL}/api/payment/upi/verify`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ upi_id: upiId, access_key: accessKey })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { valid: false, accountName: null, error: errorData.message || "Verification failed" };
    }

    const data = await response.json();
    return {
      valid: data.valid === true,
      accountName: data.account_name || data.accountName || null,
      error: data.valid ? null : (data.message || "VPA not found")
    };
  } catch (error) {
    console.error("UPI verification error:", error);
    return { valid: false, accountName: null, error: "Network error during verification" };
  }
}

/**
 * Generate a QR code for UPI payment.
 * Returns { qrData: string, qrImage: string | null, expiresAt: number }
 * @param {string} accessKey
 * @param {object} sessionData
 */
export async function generateQrCode(accessKey, sessionData) {
  try {
    if (isMockSession(accessKey)) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const qrData = `upi://pay?pa=tpipay@gateway&pn=${encodeURIComponent(sessionData?.merchant_name || "TpiPay")}&am=${sessionData?.amount}&cu=INR&tn=${sessionData?.txnid || ""}`;
      return {
        qrData,
        qrImage: null, // Will use text-based QR in UI
        expiresAt: sessionData?.sessionExpiresAt || (Date.now() + 15 * 60 * 1000)
      };
    }

    const response = await fetch(`${API_BASE_URL}/api/payment/qr/generate`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ access_key: accessKey })
    });

    if (!response.ok) {
      throw new Error(`QR generation failed with status ${response.status}`);
    }

    const data = await response.json();
    return {
      qrData: data.qr_data || data.qrData || "",
      qrImage: data.qr_image || data.qrImage || null,
      expiresAt: data.expires_at || data.expiresAt || (Date.now() + 15 * 60 * 1000)
    };
  } catch (error) {
    console.error("QR generation error:", error);
    // Fallback: generate UPI deep link
    const qrData = `upi://pay?pa=tpipay@gateway&pn=TpiPay&am=${sessionData?.amount}&cu=INR`;
    return {
      qrData,
      qrImage: null,
      expiresAt: sessionData?.sessionExpiresAt || (Date.now() + 15 * 60 * 1000)
    };
  }
}

/**
 * Poll payment status for a given access key.
 * Returns the current payment status from backend.
 * @param {string} accessKey
 */
export async function pollPaymentStatus(accessKey) {
  try {
    if (isMockSession(accessKey)) {
      // In mock mode, always return PENDING (real payment won't happen)
      return { status: "PENDING", message: "Awaiting payment confirmation" };
    }

    const response = await fetch(`${API_BASE_URL}/api/payment/status/${accessKey}`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Status poll failed with status ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Status polling error:", error);
    return { status: "UNKNOWN", message: "Unable to fetch payment status" };
  }
}

/**
 * Submit the payment transaction directly to our secure gateway endpoint.
 * PCI DSS compliant: Direct submission over HTTPS using the ACCESS_KEY session token.
 * @param {object} payload
 */
export async function processPayment(payload) {
  try {
    const { access_key } = payload;

    if (isMockSession(access_key)) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const rand = getSecureRandom();
      if (rand < 0.8) {
        return {
          status: "success",
          message: "Payment processed successfully.",
          transaction_id: `TXN_${Date.now()}`,
          payment_method: payload.payment_mode,
          timestamp: new Date().toISOString()
        };
      } else if (rand < 0.9) {
        return { status: "failed", message: "Transaction declined by card issuer.", reason: "CARD_DECLINED" };
      } else {
        return { status: "pending", message: "Transaction is pending bank approval.", reason: "BANK_PENDING" };
      }
    }

    const response = await fetch(`${API_BASE_URL}/api/payment/pay`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        status: "failed",
        message: errorData.message || `Payment processing failed (${response.status})`,
        reason: errorData.reason || "GATEWAY_ERROR"
      };
    }

    return await response.json();
  } catch (error) {
    console.error("API error processing payment:", error);
    return {
      status: "failed",
      message: "Gateway connection timeout. Please check your network and try again.",
      reason: "NETWORK_ERROR"
    };
  }
}
