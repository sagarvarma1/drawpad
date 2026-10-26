# Drawpad

A drawing pad everyone shares. Draw, and everyone on the page sees your lines appear as you draw them.

**Live:** https://drawpad.orbitdeploy.dev

There's no database and no realtime service. The drawing lives in the memory of the one Node.js
server running the deployment, which every visitor is connected to. When everyone leaves, the server
goes to sleep and the pad starts fresh.

It runs on [Orbit](https://github.com/sagarvarma1/orbit), a deployment platform I built, which gives
each deployment its own long-running server. That's what makes this a single small app instead of
a serverless function plus a database plus a websocket service.

## How it works

- **Strokes, not pixels.** Points are recorded in a 1000×1000 space and scaled to each screen, so a
  drawing looks the same on a phone and a laptop ([`app/components/Drawpad.js`](app/components/Drawpad.js)).
- **Live.** While you draw, new points are posted every 50ms, one request at a time so they stay in
  order. The server batches everyone's points every 40ms and pushes them to every viewer over a
  server-sent event stream ([`app/api/stream`](app/api/stream/route.js)).
- **Instant for you.** Your own lines draw locally right away; if the server rejects them, they're
  taken back off your screen so everyone sees the same pad.
- **Fair.** Each visitor has a refilling budget of points, with a global cap on top, and the oldest
  strokes fade out past a size limit ([`app/lib/board.js`](app/lib/board.js)).
- **Moderated.** Set an `ADMIN_TOKEN` env var, and `POST /api/admin/clear` with it wipes the pad.

## Run it

```bash
npm install
npm run dev
```
