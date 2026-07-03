const getApiBaseUrl = () => {
  const configured = import.meta.env.VITE_API_BASE_URL;

  // 1) Prefer configured value if it is a non-empty string.
  if (typeof configured === "string" && configured.trim().length > 0) {
    return configured.trim().replace(/\/+$/, "");
  }

  // 2) Fallback to current origin (only if valid/non-empty).
  try {
    const origin = typeof window !== "undefined" && window.location && typeof window.location.origin === "string"
      ? window.location.origin
      : "";

    if (origin && origin.trim().length > 0) {
      return origin.trim().replace(/\/+$/, "");
    }
  } catch {
    // ignore and move to dev fallback
  }


  // 3) Local development fallback: ensure local backend on port 8080.
  // Only used when both (1) and (2) are unavailable.
  return "http://localhost:8080";
};

const API_BASE_URL = getApiBaseUrl();


const getSecureRandom = () => {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] / 4294967296;
};

const getSecureRandomInt = (max) => {
  return Math.floor(getSecureRandom() * max);
};


/**
 * Fetch transaction session details using the ACCESS_KEY.
 * PCI DSS compliant: Never exposes merchant keys, salts, or signature hashes.
 * @param {string} accessKey
 */
export async function fetchSession(accessKey) {
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
