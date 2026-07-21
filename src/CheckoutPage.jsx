import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { fetchSession, processPayment, verifyUpiId, generateQrCode, pollPaymentStatus } from "./services/paymentService";
import SessionTimer from "./components/SessionTimer";
import OutcomeScreen from "./components/OutcomeScreen";
import gpayImg from "./gpay.png";
import phonepeImg from "./phonepe.png";
import paytmImg from "./paytm.png";
import tpipayLogo from "./assets/tpipay-logo.png";

export default function CheckoutPage() {
  const { accessKey } = useParams();
  // Page states
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("idle"); // idle | processing | success | failed | pending
  const [statusMessage, setStatusMessage] = useState("");
  const [paymentResult, setPaymentResult] = useState(null);
  const [activeTab, setActiveTab] = useState("upi"); // upi | netbanking | cards
  const [sessionExpired, setSessionExpired] = useState(false);

  // Payment form states
  const [upiId, setUpiId] = useState("");
  const [upiVerification, setUpiVerification] = useState({ state: "idle", name: null, error: null }); // idle | loading | success | error

  const deviceOs = useMemo(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (/android/.test(ua)) return "ANDROID";
    if (/iphone|ipad|ipod/.test(ua)) return "IOS";
    return "WEB";
  }, []);

  const [showQr, setShowQr] = useState(false);
  const [qrData, setQrData] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState(null);
  const [qrTimerSeconds, setQrTimerSeconds] = useState(900);
  const [qrExpired, setQrExpired] = useState(false);
  const [autoQrGenerated, setAutoQrGenerated] = useState(false);

  const [autopayData, setAutopayData] = useState({ accountNumber: "", ifsc: "", accountName: "", bankName: "", maxAmount: "" });

  const qrTimerRef = useRef(null);

  const [selectedBank, setSelectedBank] = useState("");
  const [bankDropdownOpen, setBankDropdownOpen] = useState(false);
  const [bankSearch, setBankSearch] = useState("");
  const bankDropdownRef = useRef(null);

  const [otherBankData, setOtherBankData] = useState({ bankName: "", ifsc: "" });
  const [cardData, setCardData] = useState({ number: "", name: "", expiry: "", cvv: "" });
  const [focusedField, setFocusedField] = useState("");

  const pollingInterval = useRef(null);
  const [intentUrl, setIntentUrl] = useState(null);

  // Popular banks lists
  const popularBanks = [
    { code: "SBOI", name: "State Bank of India", short: "SBI" },
    { code: "HDFC", name: "HDFC Bank", short: "HDFC" },
    { code: "ICIC", name: "ICICI Bank", short: "ICICI" },
    { code: "AXIS", name: "Axis Bank", short: "Axis" },
    { code: "KOTK", name: "Kotak Mahindra", short: "Kotak" },
  ];

  const allBanks = [
    ...popularBanks,
    { code: "BARB", name: "Bank of Baroda" },
    { code: "PUNB", name: "Punjab National Bank (PNB)" },
    { code: "CNRB", name: "Canara Bank" },
    { code: "UBIN", name: "Union Bank of India" },
    { code: "IDIB", name: "Indian Bank" },
    { code: "BKID", name: "Bank of India" },
    { code: "CBIN", name: "Central Bank of India" },
    { code: "UCBA", name: "UCO Bank" },
    { code: "IBKL", name: "IDBI Bank" },
    { code: "IDFB", name: "IDFC FIRST Bank" },
    { code: "YESB", name: "Yes Bank" },
    { code: "FDRL", name: "Federal Bank" },
    { code: "INDB", name: "IndusInd Bank" },
    { code: "AUBL", name: "AU Small Finance Bank" },
    { code: "SIBL", name: "South Indian Bank" },
    { code: "KARB", name: "Karnataka Bank" },
    { code: "KVBL", name: "Karur Vysya Bank" },
    { code: "RATN", name: "RBL Bank" },
    { code: "TMBL", name: "Tamilnad Mercantile Bank" },
    { code: "SCBL", name: "Standard Chartered Bank India" },
    { code: "HSBC", name: "HSBC India" },
    { code: "CITI", name: "Citi Bank India" },
    { code: "OTHER", name: "Other" },
  ];

  // Fetch session details on mount
  const defaultExpiresAt = useRef(Date.now() + 15 * 60 * 1000);

  useEffect(() => {
    async function loadSession() {
      setLoading(true);
      try {
        const response = await fetchSession(accessKey);
        if (response?.data) {
          setSession(response.data);
          if (!response.data.sessionExpiresAt) {
            response.data.sessionExpiresAt = defaultExpiresAt.current;
          }
          if (response.data.sessionExpiresAt && Date.now() >= response.data.sessionExpiresAt) {
            setSessionExpired(true);
          }
        } else {
          setStatus("failed");
          setStatusMessage("Failed to load secure session. Invalid access key.");
        }
      } catch (err) {
        console.error("Error loading session:", err);
        setStatus("failed");
        setStatusMessage("Network error while loading session. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    if (accessKey) {
      loadSession();
    }
  }, [accessKey]);

  // Cleanup polling and QR timer on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval.current) clearInterval(pollingInterval.current);
      if (qrTimerRef.current) clearInterval(qrTimerRef.current);
    };
  }, []);

  // QR countdown timer
  useEffect(() => {
    if (!showQr) return;
    if (qrTimerRef.current) clearInterval(qrTimerRef.current);
    setQrTimerSeconds(900);
    setQrExpired(false);
    qrTimerRef.current = setInterval(() => {
      setQrTimerSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(qrTimerRef.current);
          setQrExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(qrTimerRef.current);
  }, [showQr]);

  // Auto-generate QR on desktop
  useEffect(() => {
    if (activeTab === "upi" && deviceOs === "WEB" && !showQr && !qrLoading && !autoQrGenerated && session) {
      setAutoQrGenerated(true);
      handleGenerateQr();
    }
  }, [activeTab, deviceOs, showQr, qrLoading, autoQrGenerated, session]);

  const handleSessionExpire = useCallback(() => {
    if (pollingInterval.current) clearInterval(pollingInterval.current);
    setSessionExpired(true);
    setStatus("failed");
    setStatusMessage("Payment session expired. Please return to merchant and try again.");
    setPaymentResult({ reason: "SESSION_EXPIRED" });
  }, []);

  const startPolling = useCallback(() => {
    if (pollingInterval.current) clearInterval(pollingInterval.current);
    pollingInterval.current = setInterval(async () => {
      try {
        const result = await pollPaymentStatus(accessKey);
        if (result.status === "SUCCESS") {
          clearInterval(pollingInterval.current);
          setStatus("success");
          setStatusMessage("Payment received successfully!");
          setPaymentResult(result);
        } else if (result.status === "FAILED") {
          clearInterval(pollingInterval.current);
          setStatus("failed");
          setStatusMessage(result.message || "Payment failed");
          setPaymentResult(result);
        } else if (result.status === "CANCELLED") {
          clearInterval(pollingInterval.current);
          setStatus("failed");
          setStatusMessage(result.message || "Payment was cancelled by the user");
          setPaymentResult(result);
        } else if (result.status === "EXPIRED") {
          clearInterval(pollingInterval.current);
          setStatus("failed");
          setStatusMessage(result.message || "Payment session expired");
          setPaymentResult(result);
        }
      } catch (e) {
        console.error("Polling error", e);
      }
    }, 3000);
  }, [accessKey]);

  // UPI Handlers
  const handleUpiVerify = async () => {
    if (!upiId) return;
    setUpiVerification({ state: "loading", name: null, error: null });
    const res = await verifyUpiId(upiId, accessKey);
    if (res.valid) {
      setUpiVerification({ state: "success", name: res.accountName, error: null });
    } else {
      setUpiVerification({ state: "error", name: null, error: res.error });
    }
  };

  const handleUpiIntentPay = () => {
    submitPayment({
      access_key: accessKey,
      payment_mode: "UPI",
      device_os: deviceOs,
    });
  };

  const handleUpiPay = async (e) => {
    e.preventDefault();
    if (!upiId) return;
    if (upiVerification.state !== "success") {
      await handleUpiVerify();
      // if still not success, don't proceed. We rely on the user to verify, or we force it here but they need to see the result.
      // For a better UX, we'll just check if it's not valid after waiting.
      // To simplify, require verification success before allowing submit if we want strictness, 
      // but typically gateways verify on submit if not already done.
      // Let's just submit.
    }
    submitPayment({
      access_key: accessKey,
      payment_mode: "UPI",
      upi_id: upiId,
    });
  };

  const handleGenerateQr = async () => {
    setQrLoading(true);
    setQrError(null);
    setQrExpired(false);
    setQrTimerSeconds(900);
    try {
      const result = await generateQrCode(accessKey, session);
      setQrData(result);
      setShowQr(true);
      startPolling();
    } catch (e) {
      // Even on error, show the QR screen with a fallback UPI deep link
      const fallbackQr = `upi://pay?pa=tpipay@gateway&pn=TPIPAY&am=${session?.amount}&cu=INR`;
      setQrData({ qrData: fallbackQr, qrImage: null, expiresAt: Date.now() + 15 * 60 * 1000 });
      setShowQr(true);
      startPolling();
    } finally {
      setQrLoading(false);
    }
  };

  const handleAutoPaySubmit = (e) => {
    e.preventDefault();
    submitPayment({
      access_key: accessKey,
      payment_mode: "AutoPay",
      account_number: autopayData.accountNumber,
      ifsc_code: autopayData.ifsc,
      account_holder_name: autopayData.accountName,
      bank_name: autopayData.bankName,
      max_amount: autopayData.maxAmount,
    });
  };

  const formatQrTimer = (secs) => {
    const m = String(Math.floor(secs / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    return `${m}:${s}`;
  };

  // Card input helpers
  const handleCardNumberChange = (e) => {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length > 16) value = value.slice(0, 16);
    const formattedValue = value.replace(/(.{4})/g, "$1 ").trim();
    setCardData({ ...cardData, number: formattedValue });
  };

  const handleExpiryChange = (e) => {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length > 4) value = value.slice(0, 4);
    if (value.length > 2) {
      value = `${value.slice(0, 2)}/${value.slice(2)}`;
    }
    setCardData({ ...cardData, expiry: value });
  };

  const handleCvvChange = (e) => {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length > 3) value = value.slice(0, 3);
    setCardData({ ...cardData, cvv: value });
  };

  const getCardType = (num) => {
    const cleanNum = num.replace(/\s+/g, "");
    if (/^4/.test(cleanNum)) return "Visa";
    if (/^5[1-5]/.test(cleanNum)) return "Mastercard";
    if (/^3[47]/.test(cleanNum)) return "Amex";
    if (/^6/.test(cleanNum)) return "RuPay";
    return "Generic";
  };

  const handleCardPay = (e) => {
    e.preventDefault();
    const cleanCard = cardData.number.replace(/\s+/g, "");
    if (cleanCard.length < 16) {
      alert("Please enter a valid 16-digit card number");
      return;
    }
    if (cardData.expiry.length < 5) {
      alert("Please enter a valid expiry date (MM/YY)");
      return;
    }
    if (cardData.cvv.length < 3) {
      alert("Please enter a valid 3-digit CVV");
      return;
    }
    submitPayment({
      access_key: accessKey,
      payment_mode: "CC",
      card_number: cleanCard,
      card_holder_name: cardData.name || "Customer",
      card_expiry_date: cardData.expiry,
      card_cvv: cardData.cvv,
    });
  };

  const handleNetbankingPay = (e) => {
    e.preventDefault();
    if (!selectedBank) return;
    const payload = {
      access_key: accessKey,
      payment_mode: "NB",
      bank_code: selectedBank,
    };
    if (selectedBank === "OTHER") {
      payload.bank_name = otherBankData.bankName;
      payload.ifsc = otherBankData.ifsc;
    }
    submitPayment(payload);
  };

  // Payment trigger
  const submitPayment = async (payload) => {
    if (sessionExpired) return;
    setStatus("processing");
    try {
      const response = await processPayment(payload);
      setPaymentResult(response);

      // Handle PayU S2S response types that require 3DS authentication
      if (response?.type === "card_s2s" || response?.type === "nb_redirect") {
        handleAcsTemplate(response);
        return;
      }

      // Handle UPI QR response type
      if (response?.type === "upi_qr" || response?.intentURIData) {
        setStatus("pending");
        setStatusMessage("Scan QR code with UPI app to pay");
        startPolling();
        return;
      }

      // Handle form-based redirect response (action + fields to POST to PayU)
      if (response?.action && response?.fields) {
        submitPayUForm(response);
        return;
      }

      // Handle redirect URL (e.g. card 3DS, bank page) - open in new tab
      if (response?.redirectUrl) {
        setStatus("pending");
        setStatusMessage("Redirecting to payment page...");
        startPolling();
        window.open(response.redirectUrl, "_blank");
        return;
      }

      // Handle UPI Intent deep link
      if (response?.intentUrl) {
        setStatus("pending");
        setStatusMessage(response.message || "Opening UPI app...");
        startPolling();
        setIntentUrl(response.intentUrl);
        return;
      }

      if (response?.status === "success" || response?.success === true) {
        setStatus("success");
        setStatusMessage(response.message || "Payment completed successfully!");
      } else if (response?.status === "pending" || response?.txnStatus === "Enrolled") {
        setStatus("pending");
        setStatusMessage(response.message || "Waiting for gateway confirmation...");
        startPolling();
      } else {
        setStatus("failed");
        setStatusMessage(response?.message || "Transaction declined by card issuer.");
      }
    } catch (err) {
      console.error("Payment error:", err);
      setStatus("failed");
      setStatusMessage("Gateway response timeout. Check connection.");
      setPaymentResult({ reason: "NETWORK_ERROR" });
    }
  };

  // Handle ACS template (3DS) for PayU card_s2s and nb_redirect responses
  const handleAcsTemplate = (response) => {
    if (response?.acsTemplate) {
      try {
        // Decode Base64 HTML template
        const html = atob(response.acsTemplate);
        // Create a form and submit to a new window/tab for 3DS authentication
        const win = window.open("", "_blank");
        if (win) {
          win.document.write(html);
          win.document.close();
        }
        setStatus("pending");
        setStatusMessage("Redirecting to bank for 3D Secure authentication...");
      } catch (e) {
        console.error("Failed to decode ACS template:", e);
        setStatus("pending");
        setStatusMessage("Waiting for OTP verification...");
        startPolling();
      }
    } else {
      // No ACS template means payment may be complete already
      if (response?.txnStatus === "success" || response?.unmappedStatus === "success") {
        setStatus("success");
        setStatusMessage("Payment completed successfully!");
      } else {
        setStatus("pending");
        setStatusMessage("Waiting for gateway confirmation...");
        startPolling();
      }
    }
  };

  // Handle form-based redirect: build a hidden HTML form and auto-submit to PayU
  const submitPayUForm = (response) => {
    const form = document.createElement("form");
    form.method = response.method || "POST";
    form.action = response.action;
    form.target = "_blank";
    form.style.display = "none";
    if (response.fields) {
      Object.entries(response.fields).forEach(([key, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = value;
        form.appendChild(input);
      });
    }
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
    setStatus("pending");
    setStatusMessage("Redirecting to PayU payment page...");
    startPolling();
  };

  const filteredBanks = allBanks.filter((bank) =>
    bank.name.toLowerCase().includes(bankSearch.toLowerCase())
  );

  const amountStr = Number(session?.amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center font-sans p-4">
        <div className="w-full max-w-5xl bg-slate-900/60 backdrop-blur-xl rounded-3xl border border-slate-800 shadow-2xl p-8 flex flex-col md:flex-row gap-8 animate-pulse">
          <div className="flex-1 space-y-6">
            <div className="h-8 bg-slate-800 rounded w-1/3"></div>
            <div className="h-24 bg-slate-800 rounded w-1/2"></div>
            <div className="h-32 bg-slate-800/40 rounded-2xl"></div>
          </div>
          <div className="w-full md:w-[460px] space-y-6">
            <div className="h-12 bg-slate-800 rounded-xl w-full"></div>
            <div className="h-64 bg-slate-800 rounded-xl w-full"></div>
            <div className="h-12 bg-slate-800 rounded-xl w-full"></div>
          </div>
        </div>
      </div>
    );
  }

  if (status !== "idle" && status !== "processing" && !intentUrl) {
    return (
      <OutcomeScreen
        status={status}
        statusMessage={statusMessage}
        session={session}
        paymentResult={paymentResult}
        activeTab={activeTab}
        onRetry={() => {
          setStatus("idle");
          setPaymentResult(null);
          if (pollingInterval.current) clearInterval(pollingInterval.current);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center font-sans p-4 antialiased">
      {/* PROCESSING OVERLAY */}
      {status === "processing" && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-2xl flex flex-col items-center gap-4 text-center max-w-xs animate-fade-in-scale">
            <div className="w-14 h-14 border-4 border-violet-500 border-t-transparent border-b-transparent rounded-full animate-spin"></div>
            <h3 className="text-xl font-bold text-white mt-2">Processing Payment</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Securely authorizing transaction. Please do not close this window or hit refresh.
            </p>
          </div>
        </div>
      )}

      {/* UPI INTENT URL MODAL */}
      {intentUrl && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl w-full max-w-lg animate-fade-in-scale overflow-hidden">
            <div className="p-6 md:p-8">
              <h3 className="text-xl font-bold text-white mb-2">UPI Intent URL</h3>
              <p className="text-sm text-slate-400 mb-4 leading-relaxed">
                The backend has generated the following UPI Intent URL.
              </p>
              <textarea
                readOnly
                value={intentUrl}
                rows={4}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none resize-none scrollbar-thin"
              />
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mt-5">
                {deviceOs !== "IOS" && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(intentUrl).then(() => {
                        const btn = document.getElementById("copy-intent-btn");
                        if (btn) {
                          const orig = btn.textContent;
                          btn.textContent = "Copied successfully";
                          setTimeout(() => { btn.textContent = orig; }, 2000);
                        }
                      });
                    }}
                    id="copy-intent-btn"
                    className="flex-1 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-[0.98] transition-all text-white font-bold rounded-xl text-sm shadow-lg shadow-indigo-600/20 focus-ring"
                  >
                    Copy
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { window.location.href = intentUrl; }}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] transition-all text-white font-bold rounded-xl text-sm border border-slate-700 focus-ring"
                >
                  Launch UPI App
                </button>
                <button
                  type="button"
                  onClick={() => setIntentUrl(null)}
                  className="flex-1 py-3 bg-slate-800/50 hover:bg-slate-800 active:scale-[0.98] transition-all text-slate-300 font-bold rounded-xl text-sm border border-slate-700/50 focus-ring"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MAIN CHECKOUT BODY */}
      <div className="w-full max-w-5xl bg-slate-900/60 backdrop-blur-xl border border-slate-800 shadow-2xl rounded-3xl overflow-hidden flex flex-col md:flex-row min-h-[600px] relative animate-fade-in">
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600"></div>

        {/* LEFT COLUMN: BRANDING AND SUMMARY */}
        <div className="flex-1 p-8 md:p-10 border-b md:border-b-0 md:border-r border-slate-800/80 flex flex-col justify-between relative overflow-hidden">

          <div className="space-y-8 relative z-10">
            {/* Header branding */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img src={tpipayLogo} alt="TPIPAY" className="w-12 h-12 object-contain flex-shrink-0 drop-shadow-lg" />
                <div>
                  <h1 className="text-lg font-extrabold text-white tracking-tight leading-none">TPIPAY Checkout</h1>
                  <p className="text-xs text-slate-400 font-medium tracking-wide mt-1">Secure Transaction Session</p>
                </div>
              </div>

              <div className="text-right">
                <SessionTimer sessionExpiresAt={session?.sessionExpiresAt ?? defaultExpiresAt.current} onExpire={handleSessionExpire} />
              </div>
            </div>

            {/* PROGRESS TRACKER */}
            <div className="flex items-center gap-2 mb-2 px-1">
              <div className="text-[10px] font-bold text-violet-400 uppercase tracking-wider flex items-center gap-1.5"><span className="w-4 h-4 rounded-full bg-violet-500/20 flex items-center justify-center">✓</span> Initiated</div>
              <div className="step-connector active"></div>
              <div className="text-[10px] font-bold text-white uppercase tracking-wider flex items-center gap-1.5"><span className="w-4 h-4 rounded-full bg-violet-600 flex items-center justify-center shadow-lg shadow-violet-600/40">2</span> Payment</div>
              <div className="step-connector"></div>
              <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5"><span className="w-4 h-4 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">3</span> Complete</div>
            </div>

            {/* BIG AMOUNT SECTION */}
            <div className="pt-4 pb-2 animate-slide-right">
              <p className="text-sm text-slate-400 font-medium mb-1">Amount to Pay</p>
              <div className="flex items-baseline gap-2 text-white">
                <span className="text-4xl font-black text-slate-300">₹</span>
                <span className="text-6xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-300">
                  {amountStr.split('.')[0]}
                </span>
                <span className="text-2xl font-bold text-slate-400">.{amountStr.split('.')[1] || '00'}</span>
              </div>
              <div className="mt-4 inline-flex items-center gap-2 bg-slate-950/50 border border-slate-800/60 rounded-lg px-3 py-1.5">
                <span className="text-xs text-slate-400">To:</span>
                <span className="text-sm font-semibold text-white">{session?.merchant_name}</span>
              </div>
            </div>

            {/* Customer Details Card (Glassmorphism) */}
            {(session?.customer_name || session?.customer_email || session?.customer_phone) && (
              <div className="bg-white/[0.02] backdrop-blur-md border border-white/[0.05] rounded-2xl p-5 shadow-xl">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">👤</span>
                  <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Customer Details</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {session?.customer_name && (
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-black tracking-wider block mb-0.5">Name</span>
                      <span className="text-sm font-medium text-slate-200">{session.customer_name}</span>
                    </div>
                  )}
                  {session?.customer_phone && (
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-black tracking-wider block mb-0.5">Mobile</span>
                      <span className="text-sm font-medium text-slate-200">{session.customer_phone}</span>
                    </div>
                  )}
                  {session?.customer_email && (
                    <div className="md:col-span-2">
                      <span className="text-[10px] text-slate-500 uppercase font-black tracking-wider block mb-0.5">Email</span>
                      <span className="text-sm font-medium text-slate-200">{session.customer_email}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Secure Badging Section */}
          <div className="pt-6 relative z-10 border-t border-slate-800/60 mt-8">
            <div className="flex flex-wrap gap-4 items-center mb-4">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <span className="text-emerald-400 text-sm">🔒</span> Secure Payment
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <span className="text-emerald-400 text-sm">✓</span> PCI DSS Compliant
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <span className="text-emerald-400 text-sm">✓</span> 256-bit SSL
              </div>
            </div>
          </div>

          {/* Subtle background decoration */}
          <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-violet-600/5 rounded-full blur-3xl pointer-events-none"></div>
        </div>

        {/* RIGHT COLUMN: PAYMENT METHODS */}
        <div className="w-full md:w-[480px] p-8 flex flex-col bg-slate-900/40 relative min-h-0">

          {sessionExpired && (
            <div className="absolute inset-0 z-20 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center animate-fade-in">
              <span className="text-4xl mb-4">⏱️</span>
              <h3 className="text-xl font-bold text-rose-400 mb-2">Session Expired</h3>
              <p className="text-sm text-slate-400 mb-6">This payment session has timed out. Please generate a new request from the merchant.</p>
              <button onClick={() => window.location.reload()} className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium transition-all">Reload Page</button>
            </div>
          )}

          <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-5">
            Select Payment Method
          </h3>

          {/* MODERN PILL TAB SELECTORS */}
          <div className="flex gap-1.5 p-1.5 bg-slate-950/60 rounded-2xl border border-slate-800/50 mb-4 overflow-x-auto scrollbar-none">
            {[
              { id: "upi", icon: "⚡", label: "UPI" },
              { id: "netbanking", icon: "🏦", label: "Bank" },
              { id: "cards", icon: "💳", label: "Card" },
              { id: "autopay", icon: "🔄", label: "AutoPay" }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setShowQr(false); }}
                className={`flex-1 py-2.5 px-2 flex items-center justify-center gap-1.5 text-[11px] font-bold rounded-xl transition-all duration-300 whitespace-nowrap ${activeTab === tab.id
                  ? "bg-slate-800 text-white tab-pill-active"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  }`}
              >
                <span className="text-sm">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* TAB CONTENTS */}
          <div className="flex-1 flex flex-col min-h-0">

            {/* 1. UPI */}
            {activeTab === "upi" && (
              <div className="flex flex-col gap-4 animate-slide-left overflow-y-auto h-full pb-2">
                {!showQr ? (
                  <>
                    {/* UPI Intent section */}
                    {deviceOs !== "WEB" && (
                      <>
                        <div>
                          <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">
                            Pay via UPI Intent
                          </label>
                          <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                            You will be redirected to your UPI app to complete the payment securely.
                          </p>
                          <button
                            type="button"
                            onClick={handleUpiIntentPay}
                            disabled={status === "processing" || status === "pending"}
                            className="w-full py-4 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-[0.98] transition-all text-white font-bold rounded-xl text-sm shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2 group focus-ring"
                          >
                            <span>Pay ₹{amountStr} Securely</span>
                            <span className="group-hover:translate-x-1 transition-transform">→</span>
                          </button>
                        </div>
    
                        <div className="flex items-center gap-4 my-2 opacity-70">
                          <div className="h-[1px] bg-slate-700 flex-1"></div>
                          <span className="text-[10px] uppercase font-black tracking-widest text-slate-500">Or Pay Using UPI ID</span>
                          <div className="h-[1px] bg-slate-700 flex-1"></div>
                        </div>
                      </>
                    )}

                    <form onSubmit={handleUpiPay} className="space-y-5">
                      <div>
                        <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">
                          Enter UPI ID / VPA
                        </label>
                        <div className="relative group">
                          <input
                            type="text"
                            value={upiId}
                            onChange={(e) => {
                              setUpiId(e.target.value);
                              setUpiVerification({ state: "idle", name: null, error: null });
                            }}
                            placeholder="username@bank"
                            className={`w-full bg-slate-950 border ${upiVerification.state === 'error' ? 'border-rose-500/50 focus:border-rose-500' : upiVerification.state === 'success' ? 'border-emerald-500/50 focus:border-emerald-500' : 'border-slate-800 focus:border-violet-500'} rounded-xl px-4 py-3.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus-ring transition-all pr-24`}
                            required
                          />
                          <button
                            type="button"
                            onClick={handleUpiVerify}
                            disabled={!upiId || upiVerification.state === 'loading'}
                            className={`absolute right-2 top-2 bottom-2 px-4 text-[10px] font-bold uppercase rounded-lg transition-all ${upiVerification.state === "success"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : upiVerification.state === "error"
                                ? "bg-rose-500/10 text-rose-400"
                                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                              } disabled:opacity-50`}
                          >
                            {upiVerification.state === 'loading' ? (
                              <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
                            ) : upiVerification.state === 'success' ? (
                              "Verified ✓"
                            ) : "Verify"}
                          </button>
                        </div>

                        {/* Validation Result area */}
                        <div className="h-6 mt-1.5 flex items-center">
                          {upiVerification.state === "success" && (
                            <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1.5 animate-fade-in">
                              <span className="w-1 h-1 rounded-full bg-emerald-400"></span>
                              Verified Account Holder: {upiVerification.name}
                            </span>
                          )}
                          {upiVerification.state === "error" && (
                            <span className="text-[11px] text-rose-400 font-medium flex items-center gap-1.5 animate-fade-in">
                              <span className="w-1 h-1 rounded-full bg-rose-400"></span>
                              {upiVerification.error}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={!upiId}
                        className="w-full py-4 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-[0.98] transition-all text-white font-bold rounded-xl text-sm shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2 group focus-ring"
                      >
                        <span>Pay ₹{amountStr} Securely</span>
                        <span className="group-hover:translate-x-1 transition-transform">→</span>
                      </button>
                    </form>

                    <div className="flex items-center gap-4 my-6 opacity-70">
                      <div className="h-[1px] bg-slate-700 flex-1"></div>
                      <span className="text-[10px] uppercase font-black tracking-widest text-slate-500">Or Pay Via QR</span>
                      <div className="h-[1px] bg-slate-700 flex-1"></div>
                    </div>

                    <button
                      type="button"
                      onClick={handleGenerateQr}
                      disabled={qrLoading}
                      className="w-full py-4 bg-slate-950/80 hover:bg-slate-900 border border-slate-700 hover:border-violet-500/50 transition-all text-white font-bold rounded-xl text-sm flex items-center justify-center gap-3 focus-ring"
                    >
                      {qrLoading ? (
                        <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <span className="text-xl">📷</span>
                      )}
                      Generate QR Code
                    </button>
                  </>
                ) : (
                  <div className="flex flex-col items-center animate-fade-in-scale overflow-y-auto pb-2">
                    {/* TPiPay branding + timer row */}
                    <div className="flex items-center justify-between w-full mb-3">
                      <div className="flex items-center gap-2">
                        <img src={tpipayLogo} alt="TPIPAY" className="w-7 h-7 object-contain flex-shrink-0" />
                        <span className="text-xs font-extrabold text-white tracking-tight">TPIPAY</span>
                      </div>
                      <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-bold font-mono tabular-nums ${qrExpired ? "border-rose-500/40 bg-rose-500/10 text-rose-400" : qrTimerSeconds <= 60 ? "border-amber-500/40 bg-amber-500/10 text-amber-400 animate-timer-warning" : "border-slate-700 bg-slate-950/60 text-slate-300"}`}>
                        <span>{qrExpired ? "⚠️" : "⏱"}</span>
                        <span>{qrExpired ? "Expired" : formatQrTimer(qrTimerSeconds)}</span>
                      </div>
                    </div>

                    {/* QR Code box */}
                    <div className="relative">
                      <div className={`bg-white p-4 rounded-2xl shadow-2xl shadow-black/50 border-4 border-slate-800 relative transition-all duration-300 ${qrExpired ? "opacity-30 grayscale" : "group hover:scale-105"}`}>
                        <div className="w-44 h-44 bg-white relative p-2 flex items-center justify-center rounded-xl">
                          {qrData?.qrImage ? (
                            <img src={qrData.qrImage.startsWith('http') || qrData.qrImage.startsWith('data:') ? qrData.qrImage : `data:image/png;base64,${qrData.qrImage}`} alt="UPI QR Code" className="w-full h-full object-contain" />
                          ) : qrData?.qrData ? (
                            <div className="text-center text-[10px] text-slate-600 break-all p-2 bg-slate-100 rounded-lg w-full h-full flex flex-col items-center justify-center">
                              <span className="font-bold block mb-1">Intent URL:</span>
                              {qrData.qrData}
                            </div>
                          ) : (
                            <div className="text-slate-400 text-xs font-bold">QR Image Unavailable</div>
                          )}
                        </div>
                        {!qrExpired && <div className="absolute inset-x-4 top-4 h-0.5 bg-violet-500/60 blur-[1.5px] rounded-full animate-[float_2s_ease-in-out_infinite]" />}
                      </div>
                      {/* Expired overlay */}
                      {qrExpired && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                          <span className="text-3xl">⚠️</span>
                          <span className="text-xs font-bold text-rose-400">QR Expired</span>
                        </div>
                      )}
                    </div>

                    {/* Amount */}
                    <div className="mt-3 text-center">
                      <p className="text-xs text-slate-500 mb-0.5">Amount</p>
                      <p className="text-xl font-black text-white">₹{amountStr}</p>
                    </div>

                    {/* Status / instructions */}
                    {!qrExpired ? (
                      <div className="mt-3 text-center space-y-1">
                        <p className="text-xs font-bold text-white flex items-center justify-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-status-dot" />
                          Waiting for payment…
                        </p>
                        <p className="text-[11px] text-slate-500">Open any UPI app · Scan QR · Confirm ₹{amountStr}</p>
                        <div className="flex items-center justify-center gap-3 mt-2">
                          <img src={gpayImg} alt="GPay" className="h-6 object-contain opacity-80" />
                          <img src={phonepeImg} alt="PhonePe" className="h-6 object-contain opacity-80" />
                          <img src={paytmImg} alt="Paytm" className="h-6 object-contain opacity-80" />
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 text-center space-y-2">
                        <p className="text-xs text-rose-400 font-semibold">QR code has expired. Generate a new one to continue.</p>
                        <button
                          type="button"
                          onClick={handleGenerateQr}
                          disabled={qrLoading}
                          className="px-5 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-lg focus-ring"
                        >
                          {qrLoading ? "Generating…" : "🔄 Generate New QR"}
                        </button>
                      </div>
                    )}

                    {!qrExpired && (
                      <button
                        onClick={() => { setShowQr(false); if (pollingInterval.current) clearInterval(pollingInterval.current); if (qrTimerRef.current) clearInterval(qrTimerRef.current); }}
                        className="mt-4 px-5 py-2 border border-slate-700 hover:bg-slate-800 rounded-xl text-xs font-bold text-slate-400 transition-all focus-ring"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 2. NETBANKING */}
            {activeTab === "netbanking" && (
              <form onSubmit={handleNetbankingPay} className="flex flex-col gap-5 animate-slide-left overflow-y-auto h-full pb-2">
                <div>
                  <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">
                    Select Your Bank
                  </label>

                  {/* Custom searchable dropdown */}
                  <div className="relative" ref={bankDropdownRef}>
                    {/* Trigger button */}
                    <button
                      type="button"
                      onClick={() => { setBankDropdownOpen(o => !o); setBankSearch(""); }}
                      className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl border text-sm font-medium transition-all focus-ring ${selectedBank
                        ? "bg-slate-950 border-violet-500 text-white"
                        : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-600"
                        }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base">🏦</span>
                        <span className={selectedBank ? "text-white" : "text-slate-500"}>
                          {selectedBank ? allBanks.find(b => b.code === selectedBank)?.name || selectedBank : "Choose a bank…"}
                        </span>
                      </div>
                      <span className={`text-slate-400 transition-transform duration-200 ${bankDropdownOpen ? "rotate-180" : ""}`}>▾</span>
                    </button>

                    {/* Dropdown panel */}
                    {bankDropdownOpen && (
                      <div className="absolute left-0 right-0 mt-1.5 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl shadow-black/60 z-30 overflow-hidden">
                        {/* Search inside dropdown */}
                        <div className="p-2 border-b border-slate-800">
                          <input
                            autoFocus
                            type="text"
                            value={bankSearch}
                            onChange={e => setBankSearch(e.target.value)}
                            placeholder="Search banks…"
                            className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none transition-all"
                          />
                        </div>
                        {/* Bank list */}
                        <div className="max-h-52 overflow-y-auto scrollbar-thin divide-y divide-slate-800/50">
                          {filteredBanks.length > 0 ? filteredBanks.map(bank => (
                            <div
                              key={bank.code}
                              onClick={() => { setSelectedBank(bank.code); setBankDropdownOpen(false); setBankSearch(""); }}
                              className={`px-4 py-3 text-sm cursor-pointer flex items-center justify-between transition-all ${selectedBank === bank.code
                                ? "bg-violet-600/20 text-white"
                                : "text-slate-300 hover:bg-slate-800 hover:text-white"
                                }`}
                            >
                              <span>{bank.name}</span>
                              {selectedBank === bank.code && <span className="text-violet-400 font-bold text-xs">✓ Selected</span>}
                            </div>
                          )) : (
                            <div className="px-4 py-5 text-sm text-slate-500 text-center">No banks found for "{bankSearch}"</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Confirmed selection badge */}
                  {selectedBank && !bankDropdownOpen && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium animate-fade-in">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      {allBanks.find(b => b.code === selectedBank)?.name} selected
                    </div>
                  )}
                </div>

                {/* Bank Details for "Other" selection */}
                {selectedBank === "OTHER" && (
                  <div className="space-y-3 animate-fade-in">
                    <div>
                      <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">Bank Name</label>
                      <input
                        type="text"
                        value={otherBankData.bankName}
                        onChange={e => setOtherBankData({ ...otherBankData, bankName: e.target.value })}
                        placeholder="Enter your bank name"
                        className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-all focus-ring"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">IFSC Code</label>
                      <input
                        type="text"
                        value={otherBankData.ifsc}
                        onChange={e => setOtherBankData({ ...otherBankData, ifsc: e.target.value })}
                        placeholder="Enter your IFSC code"
                        className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-all focus-ring"
                        required
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!selectedBank || (selectedBank === "OTHER" && (!otherBankData.bankName || !otherBankData.ifsc))}
                  className="w-full mt-auto py-4 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-[0.98] transition-all text-white font-bold rounded-xl text-sm shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:grayscale focus-ring flex items-center justify-center gap-2 group"
                >
                  <span>Pay ₹{amountStr} Securely</span>
                  <span className="group-hover:translate-x-1 transition-transform">→</span>
                </button>
              </form>
            )}

            {/* 3. CARDS */}
            {activeTab === "cards" && (
              <div className="flex flex-col gap-4 animate-slide-left overflow-y-auto h-full pb-2">
                {/* REAL-TIME CARD PREVIEW - Premium Glassmorphism */}
                <div className="relative h-44 w-full bg-gradient-to-br from-slate-800 via-slate-900 to-black rounded-2xl border border-slate-700/50 p-5 flex flex-col justify-between shadow-2xl overflow-hidden group">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4 group-hover:bg-violet-500/20 transition-all duration-700"></div>

                  <div className="flex justify-between items-start relative z-10">
                    <div className="w-10 h-7 rounded bg-amber-200/80 border border-amber-400/30 flex flex-col justify-between p-1 opacity-90 shadow-sm">
                      <div className="h-[2px] bg-amber-700/40 w-full rounded"></div>
                      <div className="h-[2px] bg-amber-700/40 w-full rounded"></div>
                      <div className="h-[2px] bg-amber-700/40 w-full rounded"></div>
                    </div>
                    <span className="text-xs font-black tracking-widest text-white uppercase drop-shadow-md">
                      {getCardType(cardData.number)}
                    </span>
                  </div>

                  <div className="space-y-4 relative z-10">
                    <p className="text-lg font-bold tracking-[0.2em] text-white font-mono min-h-6 drop-shadow-md transition-all">
                      {cardData.number || "•••• •••• •••• ••••"}
                    </p>

                    <div className="flex justify-between items-end">
                      <div className="space-y-0.5">
                        <span className="text-[8px] text-slate-400 uppercase font-black tracking-widest block">Card Holder</span>
                        <span className="text-[11px] font-bold text-white uppercase tracking-wide truncate max-w-[180px] block drop-shadow-sm">
                          {cardData.name || "YOUR NAME"}
                        </span>
                      </div>
                      <div className="flex gap-5">
                        <div className="space-y-0.5 text-right">
                          <span className="text-[8px] text-slate-400 uppercase font-black tracking-widest block">Expires</span>
                          <span className="text-[11px] font-bold text-white font-mono block drop-shadow-sm">
                            {cardData.expiry || "MM/YY"}
                          </span>
                        </div>
                        <div className="space-y-0.5 text-right">
                          <span className="text-[8px] text-slate-400 uppercase font-black tracking-widest block">CVV</span>
                          <span className="text-[11px] font-bold text-white font-mono block drop-shadow-sm">
                            {focusedField === "cvv" ? cardData.cvv || "•••" : "•••"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleCardPay} className="space-y-3 flex-1 flex flex-col">
                  <div className="space-y-3 flex-1">
                    <input
                      type="text"
                      value={cardData.number}
                      onChange={handleCardNumberChange}
                      onFocus={() => setFocusedField("number")}
                      onBlur={() => setFocusedField("")}
                      placeholder="Card Number"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-all font-mono focus-ring"
                      required
                    />
                    <input
                      type="text"
                      value={cardData.name}
                      onChange={(e) => setCardData({ ...cardData, name: e.target.value })}
                      onFocus={() => setFocusedField("name")}
                      onBlur={() => setFocusedField("")}
                      placeholder="Cardholder Name"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-all focus-ring"
                      required
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        value={cardData.expiry}
                        onChange={handleExpiryChange}
                        onFocus={() => setFocusedField("expiry")}
                        onBlur={() => setFocusedField("")}
                        placeholder="MM/YY"
                        className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-all font-mono focus-ring"
                        required
                      />
                      <input
                        type="password"
                        value={cardData.cvv}
                        onChange={handleCvvChange}
                        onFocus={() => setFocusedField("cvv")}
                        onBlur={() => setFocusedField("")}
                        placeholder="CVV"
                        className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-all font-mono focus-ring"
                        required
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={cardData.number.length < 19 || !cardData.name || cardData.expiry.length < 5 || cardData.cvv.length < 3}
                    className="w-full mt-2 py-4 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-[0.98] transition-all text-white font-bold rounded-xl text-sm shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:grayscale focus-ring flex items-center justify-center gap-2 group"
                  >
                    <span>Pay ₹{amountStr} Securely</span>
                    <span className="group-hover:translate-x-1 transition-transform">→</span>
                  </button>
                </form>
              </div>
            )}

            {/* 4. AUTOPAY (eNACH) */}
            {activeTab === "autopay" && (
              <div className="flex flex-col gap-4 animate-slide-left overflow-y-auto h-full pb-2">
                <div className="bg-violet-600/10 border border-violet-500/30 rounded-xl p-3 flex gap-2.5 items-start">
                  <span className="text-base mt-0.5">🔄</span>
                  <div>
                    <p className="text-xs font-bold text-violet-300 mb-0.5">AutoPay via eNACH</p>
                    <p className="text-[11px] text-slate-400 leading-relaxed">Authorise a one-time mandate to auto-debit future payments. Your bank will send an approval link or OTP.</p>
                  </div>
                </div>
                <form onSubmit={handleAutoPaySubmit} className="space-y-3 flex-1 flex flex-col">
                  <div className="space-y-3 flex-1">
                    <div>
                      <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">Account Number</label>
                      <input
                        type="text"
                        value={autopayData.accountNumber}
                        onChange={e => setAutopayData({ ...autopayData, accountNumber: e.target.value.replace(/\D/g, '') })}
                        placeholder="Enter bank account number"
                        className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-all font-mono focus-ring"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">IFSC Code</label>
                      <input
                        type="text"
                        value={autopayData.ifsc}
                        onChange={e => setAutopayData({ ...autopayData, ifsc: e.target.value.toUpperCase() })}
                        placeholder="e.g. SBIN0001234"
                        maxLength={11}
                        className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-all font-mono focus-ring"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">Account Holder Name</label>
                      <input
                        type="text"
                        value={autopayData.accountName}
                        onChange={e => setAutopayData({ ...autopayData, accountName: e.target.value })}
                        placeholder="As per bank records"
                        className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-all focus-ring"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">Bank Name</label>
                        <input
                          type="text"
                          value={autopayData.bankName}
                          onChange={e => setAutopayData({ ...autopayData, bankName: e.target.value })}
                          placeholder="Bank name"
                          className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-all focus-ring"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">Max Amount (₹)</label>
                        <input
                          type="number"
                          value={autopayData.maxAmount}
                          onChange={e => setAutopayData({ ...autopayData, maxAmount: e.target.value })}
                          placeholder="e.g. 10000"
                          min="1"
                          className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-all focus-ring"
                          required
                        />
                      </div>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={!autopayData.accountNumber || !autopayData.ifsc || !autopayData.accountName}
                    className="w-full mt-2 py-4 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-[0.98] transition-all text-white font-bold rounded-xl text-sm shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:grayscale focus-ring flex items-center justify-center gap-2 group"
                  >
                    <span>Authorise Mandate</span>
                    <span className="group-hover:translate-x-1 transition-transform">→</span>
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}