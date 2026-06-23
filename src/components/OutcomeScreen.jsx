import { useState } from "react";

function CopyBtn({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      onClick={handle}
      aria-label={`Copy ${label}`}
      className="ml-2 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all focus-ring"
    >
      {copied ? "✓" : "Copy"}
    </button>
  );
}

export default function OutcomeScreen({ status, statusMessage, session, paymentResult, activeTab, onRetry }) {
  const isSuccess = status === "success";
  const isPending = status === "pending";
  const isFailed = status === "failed";

  const txnId = paymentResult?.transaction_id || session?.txnid || session?.paymentId || "—";
  const amount = Number(session?.amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  const methodLabel = paymentResult?.payment_method || activeTab?.toUpperCase() || "—";
  const now = paymentResult?.timestamp ? new Date(paymentResult.timestamp) : new Date();
  const dateStr = now.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  const failureReasons = {
    CARD_DECLINED: "Transaction declined by card issuer",
    BANK_PENDING: "Awaiting bank approval",
    NETWORK_ERROR: "Gateway connection timeout",
    PAYMENT_TIMEOUT: "Payment session timed out",
    SESSION_EXPIRED: "Payment session expired",
    GATEWAY_ERROR: "Gateway processing error",
  };
  const reason = paymentResult?.reason ? (failureReasons[paymentResult.reason] || paymentResult.reason) : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center font-sans p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden relative animate-fade-in-scale">
        <div className={`absolute top-0 inset-x-0 h-1.5 ${isSuccess ? "bg-gradient-to-r from-emerald-500 to-teal-500" : isPending ? "bg-gradient-to-r from-amber-500 to-yellow-500" : "bg-gradient-to-r from-rose-600 to-red-500"}`} />

        <div className="p-8 flex flex-col items-center text-center">
          {/* Icon */}
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 animate-success-bounce ${isSuccess ? "bg-emerald-500/10 border border-emerald-500/30" : isPending ? "bg-amber-500/10 border border-amber-500/30" : "bg-rose-500/10 border border-rose-500/30"}`}>
            {isSuccess ? (
              <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none" stroke="#10b981" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 24 L20 34 L38 14" className="check-draw" />
              </svg>
            ) : isPending ? (
              <span className="text-3xl">⏳</span>
            ) : (
              <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none" stroke="#f43f5e" strokeWidth="3.5" strokeLinecap="round">
                <path d="M16 16 L32 32 M32 16 L16 32" className="check-draw" />
              </svg>
            )}
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-white mb-1">
            {isSuccess ? "Payment Successful" : isPending ? "Verification Pending" : "Payment Failed"}
          </h2>
          {isSuccess && <p className="text-emerald-400 text-xs font-semibold mb-4">₹{amount} paid successfully</p>}
          {(isFailed || isPending) && <p className="text-slate-400 text-sm mb-4 leading-relaxed">{statusMessage}</p>}
          {isFailed && reason && (
            <div className="text-xs bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-2.5 text-rose-400 mb-4 w-full">
              Reason: {reason}
            </div>
          )}

          {/* Transaction details */}
          <div className="w-full bg-slate-950/60 rounded-2xl border border-slate-800/80 p-4 mb-6 text-left space-y-3">
            {[
              { label: "Amount", value: `₹${amount}` },
              { label: "Transaction ID", value: txnId, copy: true, mono: true },
              { label: "Order ID", value: session?.orderId || "—", copy: true, mono: true },
              { label: "Merchant", value: session?.merchant_name || "—" },
              { label: "Payment Method", value: methodLabel },
              { label: "Date & Time", value: dateStr },
            ].map(({ label, value, copy, mono }) => (
              <div key={label} className="flex justify-between items-center text-xs">
                <span className="text-slate-500">{label}</span>
                <span className={`${mono ? "font-mono" : ""} text-slate-300 flex items-center`}>
                  {value}
                  {copy && value !== "—" && <CopyBtn text={value} label={label} />}
                </span>
              </div>
            ))}
          </div>

          {/* Actions */}
          {isSuccess ? (
            <div className="w-full space-y-2">
              <button
                onClick={() => window.print()}
                className="w-full py-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-[0.98] transition-all text-white font-semibold rounded-xl text-sm shadow-lg shadow-indigo-600/20"
              >
                Download Receipt
              </button>
              <button
                onClick={onRetry}
                className="w-full py-3 border border-slate-700 hover:border-slate-600 hover:bg-slate-800 transition-all text-slate-300 font-medium rounded-xl text-sm"
              >
                Back to Merchant
              </button>
            </div>
          ) : (
            <div className="w-full space-y-2">
              <button
                onClick={onRetry}
                className="w-full py-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-[0.98] transition-all text-white font-semibold rounded-xl text-sm shadow-lg"
              >
                {isPending ? "Check Status" : "Retry Payment"}
              </button>
              <button
                onClick={() => window.location.reload()}
                className="w-full py-3 border border-slate-700 hover:border-slate-600 hover:bg-slate-800 transition-all text-slate-400 font-medium rounded-xl text-sm"
              >
                Choose Another Method
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
