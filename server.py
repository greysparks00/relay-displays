# One live WebSocket per screen, one POST to route content. Run one worker.

import asyncio
import json
import os
from uuid import uuid4
from pathlib import Path
from secrets import compare_digest

from dotenv import load_dotenv
import uvicorn
from starlette.applications import Starlette
from starlette.responses import FileResponse, JSONResponse, RedirectResponse
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocketDisconnect

# Compare a provided value against a secret using a constant-time comparison.
def matches(value, secret):
    return isinstance(value, str) and compare_digest(value.encode(), secret.encode())

def create_app():
    # Load environment variables from the .env file.
    load_dotenv(Path(__file__).with_name(".env"))

    sender = os.environ.get("RELAY_DISPLAY_TOKEN")
    screen_key = os.environ.get("RELAY_SCREEN_KEY")
    if not screen_key or not sender or screen_key == sender:
        raise ValueError("Set distinct RELAY_SCREEN_KEY and RELAY_DISPLAY_TOKEN in relay-displays/.env.")

    live = {}
    pending = {}  # Browser acknowledgements, indexed by socket and command ID.

    # Redirect the root path to the first screen.
    async def home(request):
        return RedirectResponse("/screen/1")

    # Serve the screen page for a valid screen ID.
    async def page(request):
        if not 1 <= request.path_params["id"] <= 2147483647:
            return JSONResponse({"error": "unknown screen"}, status_code=404)
        return FileResponse(Path(__file__).with_name("screen.html"), headers={"Cache-Control": "no-store"})

    async def connection_script(request):
        return FileResponse(Path(__file__).with_name("server.js"), media_type="text/javascript")

    # Register a screen connection after validating its token.
    async def register(ws):
        screen = str(ws.path_params["id"])
        if not 1 <= ws.path_params["id"] <= 2147483647:
            await ws.close()
            return

        await ws.accept()

        try:
            async with asyncio.timeout(5):
                token = await ws.receive_text()

            if not matches(token, screen_key):
                await ws.close(code=4403)
                return

            if screen in live:
                await ws.close(code=4409)
                return

            live[screen] = ws
            pending[ws] = {}
            await ws.send_json({"status": "registered", "id": int(screen)})
            while True:
                frame = await ws.receive()
                if frame["type"] == "websocket.disconnect":
                    break
                try:
                    ack = json.loads(frame.get("text") or "")
                    if not isinstance(ack, dict) or not isinstance(ack.get("applied"), str):
                        raise ValueError
                except (ValueError, RecursionError):
                    await ws.close(code=1008)
                    break
                waiter = pending[ws].get(ack["applied"])
                if waiter is not None and not waiter.done():
                    waiter.set_result(True)

        except TimeoutError:
            await ws.close(code=1008)

        except WebSocketDisconnect:
            pass

        finally:
            for waiter in pending.pop(ws, {}).values():
                if not waiter.done():
                    waiter.set_result(False)
            if live.get(screen) is ws:
                del live[screen]

    # Route a message to a connected screen.
    async def send(request):
        if not matches(request.headers.get("authorization"), "Bearer " + sender):
            return JSONResponse({"error": "unauthorized"}, status_code=401)

        body = bytearray()

        async for chunk in request.stream():
            if len(body) + len(chunk) > 210_000:
                return JSONResponse({"error": "request too large"}, status_code=413)

            body.extend(chunk)

        try:
            message = json.loads(body)

            if (not isinstance(message, dict)
                    or type(message.get("id")) is not int or not 1 <= message["id"] <= 2147483647):
                raise ValueError
            control = set(message) == {"id", "enabled"} and type(message["enabled"]) is bool
            if not control:
                if set(message) != {"id", "screen"}:
                    raise ValueError
                layout = message["screen"]
                if not isinstance(layout, dict):
                    raise ValueError
                if layout.get("type") == "text":
                    fields = ("content",)
                elif layout.get("type") == "comparison":
                    fields = ("option1", "option2")
                else:
                    raise ValueError
                if set(layout) != {"type", *fields}:
                    raise ValueError
                for field in fields:
                    value = layout[field]
                    if not isinstance(value, str) or len(value) > 8192 or (field != "content" and not value):
                        raise ValueError
                    value.encode("utf-8")
        except (ValueError, RecursionError):
            return JSONResponse({"error": "Expected an ID with a screen payload or an enabled boolean."}, status_code=400)

        screen = str(message["id"])

        ws = live.get(screen)

        # Check if the screen is currently connected.
        if ws is None:
            return JSONResponse({"error": "screen offline"}, status_code=409)

        if control:
            command = uuid4().hex
            waiter = asyncio.get_running_loop().create_future()
            waiters = pending[ws]
            waiters[command] = waiter
            try:
                async with asyncio.timeout(3):
                    await ws.send_json({**message, "command_id": command})
                    if await waiter:
                        return JSONResponse({"id": message["id"], "status": "applied"})
            except (TimeoutError, WebSocketDisconnect, OSError, RuntimeError):
                pass
            finally:
                waiters.pop(command, None)
            return JSONResponse({"error": "kiosk did not confirm the command"}, status_code=504)

        # Send the message to the connected screen.
        try:
            async with asyncio.timeout(2):
                await ws.send_json(message)

        # Handle delivery errors and remove the disconnected screen.
        except (TimeoutError, WebSocketDisconnect, OSError, RuntimeError):
            if live.get(screen) is ws:
                del live[screen]

            return JSONResponse({"error": "delivery unconfirmed"}, status_code=503)

        # Return the successful delivery response.
        return JSONResponse({"id": message["id"], "status": "accepted"})

    # Define the application routes.
    return Starlette(routes=[
        Route("/", home),
        Route("/screen/{id:int}", page),
        Route("/server.js", connection_script),
        Mount("/displays", app=StaticFiles(directory=Path(__file__).with_name("displays"))),
        WebSocketRoute("/v1/screens/{id:int}/connect", register),
        Route("/v1/screens/send", send, methods=["POST"]),
    ])

if __name__ == "__main__":
    uvicorn.run(create_app(), host="127.0.0.1", port=8766, ws_max_size=16384)
