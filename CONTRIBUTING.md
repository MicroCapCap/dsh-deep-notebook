# Contributing

Deep Notebook is a DeepSeek Harness plugin. Keep changes small and verifiable.

## Development

- Node 24 or newer is required (`node:sqlite` is used directly).
- `node scripts/build.mjs` rebuilds `lib/client.js` from `client/*.js` and the CSS files.
- `node --test` runs the test suite.
- Pack an installable archive with `pnpm pack` or `npm pack`.

There are no runtime npm dependencies. Do not add a dependency unless the feature cannot be implemented with Node's standard library and the Harness services already injected by the plugin.

## What to keep stable

- One notebook is one folder and one Harness workspace.
- Sessions are the conversation layer; the notebook stores only state, indexes, and learner memory.
- Structured results are reported through the workspace `notebook` skill, not by parsing chat text.
- Do not hard-code tool restrictions; the tutor uses the agent configuration the user chose.
- Do not make lesson completion automatic; the learner marks a lesson complete.

## Pull requests

Include the tests or a manual verification note for the changed behavior. If a change touches the workspace files (`AGENTS.md`, `SKILL.md`, `brief.md`), say how an existing notebook picks it up on the next session.
