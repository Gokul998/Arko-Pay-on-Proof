import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App.tsx";
import { StoreProvider } from "./lib/store.tsx";
import { PayPalReturn } from "./features/deals/PayPalReturn.tsx";

const path = location.pathname;
const root = createRoot(document.getElementById("root")!);

root.render(
  <StrictMode>
    {path.startsWith("/paypal/") ? (
      <PayPalReturn cancelled={path.startsWith("/paypal/cancel")} />
    ) : (
      <StoreProvider>
        <App />
      </StoreProvider>
    )}
  </StrictMode>,
);
