import React from "react";
import { createRoot } from "react-dom/client";
import AuthBoundary from "./components/AuthBoundary";
import "./styles/global.css";
import "./styles/presentation.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><AuthBoundary /></React.StrictMode>);
