# Open the bubble graph

The graph server is a normal Node process. Started from Claude it runs as a background task, and background tasks
are stopped after a while (and when the session ends); the undo history lives in that process and goes with it.

1. Port: the number after `ui` in the arguments, otherwise 4321.
2. Ask (or decide from the request) how long the user wants it:
   - **Quick look** (default): start it in the background (Bash with run_in_background) from the repository root:
     `node scripts/floorplan/server.mjs --port <port>`.
   - **Longer session** (moving many files, a refactoring afternoon): don't start it; tell the user to run it in their
     own terminal so it survives Claude sessions: `npm run map:ui` (Angular) or `node scripts/floorplan/server.mjs`.
3. After a second, check it answers: `curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/` (200). The `/api/*` routes
   answer 403 without the page's token; that is expected.
   If the port is taken, try the next one.
4. Tell the user in four short lines:
   - Open http://localhost:<port>
   - Moving files/folders changes the working copy after a preview (git mv + imports rewritten).
   - Undo works while this server runs; after it stops, use git (`git status`, `git restore`, `git reset`).
   - Moving methods is preview only: press "Copy task for Claude", then run `/floorplan move-methods` and paste it.
5. Leave the server running. Stop it when the user asks.
