import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ViewerPage } from "./ViewerPage";
import "./index.css";

const room = /^\/r\/([^/]+)\/?$/.exec(location.pathname)?.[1];
const page = room ? <ViewerPage code={decodeURIComponent(room).toLowerCase()} /> : <App />;

createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
