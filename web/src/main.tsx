import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { isLang } from "./languages";
import { SubPage } from "./SubPage";
import "./index.css";

const lang = new URLSearchParams(location.search).get("lang");
const page = location.pathname === "/sub" ? <SubPage lang={isLang(lang) ? lang : "vi"} /> : <App />;

createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
