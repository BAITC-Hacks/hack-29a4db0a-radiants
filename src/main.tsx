import React from "react";
import { createRoot } from "react-dom/client";
import App from "./components/App";
import { createCareerApi } from "./lib/frontend/api";
import "./styles/global.css";
import "./styles/presentation.css";

const api = createCareerApi({ baseUrl: import.meta.env.VITE_API_BASE_URL || "/api" });
createRoot(document.getElementById("root")!).render(<React.StrictMode><App api={api} /></React.StrictMode>);
