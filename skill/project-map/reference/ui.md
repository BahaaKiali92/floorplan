# Open the bubble graph

1. Port: the number after `ui` in the arguments, otherwise 4321.
2. Start the server in the background (Bash with run_in_background) from the repository root:
   `node scripts/project-map/server.mjs --port <port>`
3. After a second, check it answers: `curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/api/map`.
   If the port is taken, try the next one.
4. Tell the user in three short lines:
   - Open http://localhost:<port>
   - Moving files/folders changes the working copy after a preview (git mv + imports rewritten). Undo works while the server runs.
   - Moving methods is preview only: press "Copy task for Claude", then run `/project-map move-methods` and paste it.
5. Leave the server running. Stop it when the user asks.
