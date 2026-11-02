# Ball Coaster

Build marble runs in a kid's room with real physics, then ride inside the ball.

Live: https://lawebs.co.il/ball-coaster/

- Rolling-sphere physics written from scratch (`src/physics.js`): spin, friction, rolling resistance, air drag, bounces, and moving parts (water wheel, seesaw, dominoes) pushed by the balls.
- Tracks, lifts, loops, funnels, flip-flops, xylophone, trampolines, bells, bumpers; open, glass, laser-cut wood and rail styles.
- Build, Chase, Ride (POV), Movie and Replay cameras; prediction line; challenges with stars; night mode; English / Hebrew.
- A coaster library: publish your coaster, then anyone can search and filter (room, features, size, reaches a goal), sort (popular, new, loved) and try it, with a play counter, likes and a report button.

## Run locally

No build step — three.js is vendored in `vendor/`.

```
node serve.cjs
```

Then open http://localhost:5173 (or double-click `Play Ball Coaster.bat`).

## Check and deploy

```
node tools/check.mjs
```

runs the real physics headless and fails if any ball type stops reaching the goal on the demo coaster or the moving-pieces test track.

```
.\deploy.ps1 -CommitMessage "What changed"
```

validates, commits, pushes to GitHub, uploads that exact commit to the server and runs `deploy_linux.sh`, which publishes the static files to `/var/www/ball-coaster`, wires `lawebs.co.il/ball-coaster/` in nginx and rolls back on any failed check. `-ValidateOnly` runs only the checks.

## The coaster library

`server/api.cjs` stores published coasters (plain Node, no packages): one JSON file of details and
counters plus one of pieces per coaster, and a thumbnail, under `DATA_DIR`. Locally `node serve.cjs`
runs it at `/api/` with its data in `.data/`. On the server, `deploy_linux.sh` installs it to
`/opt/ball-coaster-api` as the systemd service `ball-coaster-api` (127.0.0.1:4021, data in
`/var/lib/ball-coaster`, backed up before every deploy), and nginx forwards
`lawebs.co.il/ball-coaster/api/` to it. `node tools/api-check.mjs` tests publishing, search, filters,
counters and deleting.

Names are checked for rude words; three reports hide a coaster. To remove one by hand on the server:
delete its files in `/var/lib/ball-coaster/{meta,pieces,thumbs}/` and `systemctl restart ball-coaster-api`.
