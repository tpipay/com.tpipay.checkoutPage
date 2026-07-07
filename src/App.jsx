import { Routes, Route } from "react-router-dom";
import CheckoutPage from "./CheckoutPage";

function ExternalRedirect() {
  window.location.href = "https://tpipay.ai";
  return null;
}

function App() {
  return (
    <Routes>
      <Route path="/pay/:accessKey" element={<CheckoutPage />} />
      <Route path="*" element={<ExternalRedirect />} />
    </Routes>
  );
}

export default App;
