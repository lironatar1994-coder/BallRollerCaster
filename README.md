# Ball Coaster

Build marble runs in a kid's room with real physics, then ride inside the ball.

Live: https://lawebs.co.il/ball-coaster/

- Rolling-sphere physics written from scratch (`src/physics.js`): spin, friction, rolling resistance, air drag, bounces, and moving parts (water wheel, seesaw, dominoes) pushed by the balls.
- Tracks, lifts, loops, funnels, flip-flops, xylophone, trampolines, bells, bumpers; open, glass, laser-cut wood and rail styles.
- Build, Chase, Ride (POV), Movie and Replay cameras; prediction line; challenges with stars; night mode; English / Hebrew.

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
