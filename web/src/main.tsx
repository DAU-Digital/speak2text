import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { parseRoomPath } from "./roomClient";
import { ViewerPage } from "./ViewerPage";
import "@fontsource-variable/inter";
import "./index.css";

const room = parseRoomPath(location.pathname);
const page = room !== null ? <ViewerPage code={room} /> : <App />;

createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
