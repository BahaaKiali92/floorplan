# Publishing Floorplan

## 1. Rename the GitHub repository (once)

The plugin and marketplace are named `floorplan`; the docs point to `github.com/BahaaKiali92/floorplan`.
On GitHub: repository **Settings → General → Repository name** → `floorplan`. GitHub redirects the old URL, but
update your local remote: `git remote set-url origin https://github.com/BahaaKiali92/floorplan.git`.

## 2. Release checklist (every version)

1. `./tests/run.sh` passes (CI also runs it on Linux and Windows).
2. Playwright tests in `tests/ui/` pass; look at the screenshots.
3. Version bumped in `plugin/.claude-plugin/plugin.json` **and** `plugin/skills/floorplan/scripts/VERSION`
   (the tests check they match), and a section in `CHANGELOG.md`.
4. `claude plugin validate --strict ./plugin` and `claude plugin validate --strict .` print "Validation passed".
5. Install from the local marketplace and try it: `claude plugin marketplace add ./` then
   `claude plugin install floorplan@floorplan`, start a session in a test repository, run `/floorplan:floorplan map`.
6. Tag and push: `git tag -a v1.0.0 -m "Floorplan 1.0.0" && git push && git push --tags`.

Teammates then install with:

```
/plugin marketplace add BahaaKiali92/floorplan
/plugin install floorplan@floorplan
```

and update with `claude plugin update floorplan@floorplan` (or auto-update for the marketplace in `/plugin`).
For a whole company, an admin can require it through managed settings (`extraKnownMarketplaces` + `enabledPlugins`,
see docs/1-SETUP.md section 11).

## 3. Anthropic's community marketplace

Listed plugins can be installed by anyone with `/plugin marketplace add anthropics/claude-plugins-community` and
`/plugin install floorplan@claude-community`. "floorplan" was not taken there (checked 2026-10-13, 2,284 plugins).

- Submission form for individuals: <https://platform.claude.com/plugins/submit> (Console).
  For a Team/Enterprise organization (Directory permission, Owners have it): claude.ai → Admin settings → Directory →
  Submissions → Plugins → New.
- What to enter: repository `https://github.com/BahaaKiali92/floorplan`, plugin path `plugin/`, name `floorplan`,
  the description from `plugin.json`, category development, license MIT, a screenshot (`docs/img/graph-angular.png`).
- Listed plugins are pinned to a commit. For a new version, submit again (or follow the form's update flow).
- Check whether it is listed: search for `floorplan` in
  <https://github.com/anthropics/claude-plugins-community/blob/main/.claude-plugin/marketplace.json>.
- Never change the plugin `name` after publishing (installs are recorded as `floorplan@…`). Change `displayName`
  for the label instead.

The official marketplace (`claude-plugins-official`) doesn't take submissions through these forms.

## 4. Cloud sessions

Cloud sessions don't install plugins. Teams that use them commit the skill into each repository
(`.claude/skills/floorplan/`, offered by `/floorplan setup`). Alternatively each person uploads the skill folder as a
zip on claude.ai (Customize → Skills); the skill's frontmatter only uses fields claude.ai accepts (`name`,
`description`).
