# Relay Displays

## Set up the servers

1. Create a local `.env` in both `relay-displays` and `relay-mcp` on a fresh install.
2. In `relay-displays/.env`, set `RELAY_SCREEN_KEY` to the password you will enter on every kiosk. Set `RELAY_DISPLAY_TOKEN` to a second secret and copy that value to `relay-mcp/.env`. Generate each secret with `python -c "import secrets; print(secrets.token_urlsafe(32))"`.
3. From each project directory run `uv run --locked python server.py` in a separate terminal. Both servers read their own .env on startup. Existing environment variables take precedence.
4. Open `http://127.0.0.1:8766/screen/1` on the host, enter the shared screen key and click **Connect**. For a second screen use `/screen/2` and the same key. Anyone with this key can claim any available positive screen ID. One tab can hold each ID. No screen list is required.

## Send content

Call `change_screen(id=1, screen={"type":"text","content":"Hello"})` in Relay. MCP sends an authenticated POST to `/v1/screens/send` with `{"id":1,"screen":{"type":"text","content":"Hello"}}`. The registered browser displays that JSON. Offline requests return 409 and are discarded.

The server listens on loopback port 8766. For another device, use an SSH tunnel or an HTTPS reverse proxy with WebSocket support. Use one server worker. On a Pi desktop, launch Chromium with `chromium --kiosk http://127.0.0.1:8766/screen/1`.

The screen object is either `{"type":"text","content":"..."}` or `{"type":"comparison","option1":"...","option2":"..."}`. The agent writes the display copy. Each text field accepts up to 8192 characters. Comparison options must be nonempty.

For direct access on a trusted LAN, run `uv run --locked uvicorn server:create_app --factory --host 0.0.0.0 --port 8766` on the display host. Open `/screen/1` using its LAN IP or hostname.

For direct access on a trusted LAN, run `uv run --locked uvicorn server:create_app --factory --host 0.0.0.0 --port 8766` on the display host. Open `/screen/1` using its LAN IP or hostname.
