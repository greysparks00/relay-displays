import { render as renderText } from "/displays/text/main.js";
import { render as renderComparison } from "/displays/comparison/main.js";

const renderers = new Map([
    ["text", renderText],
    ["comparison", renderComparison],
]);
const templates = new Map();
const payload = document.querySelector("#payload");
let revision = 0;

async function display(screen) {
    const current = ++revision;
    const render = renderers.get(screen.type);
    try {
        if (!render) throw new Error("Unknown display type");
        let template = templates.get(screen.type);
        if (!template) {
            const response = await fetch("/displays/" + screen.type + "/index.html");
            if (!response.ok) throw new Error("Missing layout");
            template = document.createElement("template");
            // Only the bundled layout is HTML. Each renderer inserts message fields as text.
            template.innerHTML = await response.text();
            templates.set(screen.type, template);
        }
        // A newer update may have arrived while this layout was loading.
        if (current !== revision) return;
        const view = template.content.cloneNode(true);
        render(view, screen);
        payload.replaceChildren(view);
    } catch (error) {
        console.error("Could not display screen", error);
        if (current === revision) payload.textContent = "Could not load this layout.";
    }
}

const suppliedKey = new URLSearchParams(location.hash.slice(1)).get("key");
if (suppliedKey !== null) history.replaceState(null, "", location.pathname + location.search);
const id = location.pathname.split("/").pop();
const storageKey = "relay-screen-" + id;
if (suppliedKey) sessionStorage.setItem(storageKey + "-managed", "1");
const managed = sessionStorage.getItem(storageKey + "-managed") === "1";
// Keep the sleep screen through a reload or socket reconnect in this kiosk tab.
const sleepKey = storageKey + "-sleep";
document.documentElement.classList.toggle("sleeping", sessionStorage.getItem(sleepKey) === "1");
const login = document.querySelector("#login");
const key = document.querySelector("#key");
const statusLine = document.querySelector("#status");
document.querySelector("#heading").textContent = document.title = "Screen " + id;

// The page owns the connection. Rendering a new layout only replaces the contents of <main>.
function connect(token) {
    login.hidden = true;
    statusLine.textContent = "Connecting…";
    const url = new URL("/v1/screens/" + id + "/connect", location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    socket.onopen = () => socket.send(token);
    socket.onmessage = event => {
        const data = JSON.parse(event.data);
        if (data.status === "registered") {
            sessionStorage.setItem(storageKey, token);
            statusLine.textContent = "Connected";
        } else if (typeof data.enabled === "boolean") {
            document.documentElement.classList.toggle("sleeping", !data.enabled);
            if (data.enabled) sessionStorage.removeItem(sleepKey);
            else sessionStorage.setItem(sleepKey, "1");
            socket.send(JSON.stringify({applied: data.command_id}));
        } else {
            display(data.screen);
        }
    };
    socket.onclose = event => {
        if ([4403, 4409, 1008].includes(event.code) && !managed) {
            sessionStorage.removeItem(storageKey);
            statusLine.textContent = event.code === 4409 ? "Screen ID already connected." : "Registration rejected.";
            document.documentElement.classList.remove("sleeping");
            sessionStorage.removeItem(sleepKey);
            login.hidden = false;
        } else {
            statusLine.textContent = event.code === 4403 ? "Check the configured screen key. Retrying…" : "Disconnected. Reconnecting…";
            setTimeout(() => connect(token), 2000);
        }
    };
}
login.onsubmit = event => {
    event.preventDefault();
    const token = key.value;
    key.value = "";
    connect(token);
};
const saved = suppliedKey ?? sessionStorage.getItem(storageKey);
if (saved) connect(saved);
