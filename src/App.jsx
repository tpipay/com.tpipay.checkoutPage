import { useEffect, useState } from "react";
import CheckoutPage from "./CheckoutPage";

function App() {
  const [accessKey, setAccessKey] = useState("");

  useEffect(() => {
    // Extract access key from path: /pay/ACCESS_KEY
    const pathSegments = window.location.pathname.split("/");
    const payIndex = pathSegments.indexOf("pay");
    let key = "";

    if (payIndex !== -1 && payIndex + 1 < pathSegments.length) {
      key = pathSegments[payIndex + 1];
    }

    // Fallback: Extract from query parameters: ?access_key=ACCESS_KEY
    if (!key) {
      const urlParams = new URLSearchParams(window.location.search);
      key = urlParams.get("access_key") || urlParams.get("key") || "";
    }

    // If no key is found and the user is at the base URL, redirect to https://tpipay.ai
    if (!key && (window.location.pathname === "/" || window.location.pathname === "")) {
      window.location.href = "https://tpipay.ai";
      return;
    }

    // Fallback for testing/sandbox if no key is provided
    if (!key) {
      key = "TEST_SESSION_KEY";
    }

    setAccessKey(key);
  }, []);

  if (!accessKey) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-medium tracking-wide opacity-85">Initializing secure gateway session...</p>
        </div>
      </div>
    );
  }

  return <CheckoutPage accessKey={accessKey} />;
}

export default App;