# Deep Notebook

![Deep Notebook icon](icon.svg)

Deep Notebook is a study notebook for DeepSeek Harness Desktop. A notebook is a Harness workspace with a planned lesson map; every study action — a lesson, a quiz, the weekly plan, a conversation — opens a real Harness session with a preset prompt. The tutor reports results back so the notebook can track progress and learner memory.

## How it works

1. **Plan.** Setting a goal records it in the notebook. Deep Notebook builds a learning map and a lesson plan from the goal (and from any selected sources).
2. **Open a session.** Clicking a lesson, the study plan, a quiz, or New Session opens a Harness session inside the notebook's workspace and sends one prompt as the first message. The lesson prompt names the lesson, objective, topics, and time. The quiz prompt asks the tutor to quiz you inside the same lesson session, one question at a time.
3. **Report back.** Every workspace contains a `notebook` skill (`.agents/skills/notebook/SKILL.md`). When a goal is agreed, a quiz ends, or you reveal something durable, the tutor writes one JSON file under `agent/records/`. Deep Notebook imports those reports when you return to the notebook: progress, mastery, and learner memory update, and a new goal starts the map and plan build. Lesson completion is manual: click **Mark completed** on the lesson card when you decide it is done.

## Use it

In DeepSeek Harness Desktop 0.2.2-rc.5 or a compatible 0.2 build, open **Plugins → Add plugin** and enter the absolute path to this folder or its packed `.tgz`. Enable **dsh-deep-notebook** and restart Harness if it asks. **More → Deep Notebook** opens the library.

| Where | What it does |
| --- | --- |
| Get started | **Set goal** opens a setup session. The tutor asks about the objective, level, daily time, and deadline, then records the goal. |
| Dashboard | **Top priorities** and **All lessons** open each lesson in its own session; every lesson card also has a **Quiz** button that sends the quiz prompt into that same session. **See your personalized study plan** opens a plan session. **Check your learning with a quiz** opens a new quiz session. |
| Quiz | The tutor uses Harness's native question card with clickable options. It can ask one question at a time and explain after each answer, or ask a batch and then explain everything you missed. Explanations are not shortened; a long quiz continues in another batch instead of dropping questions. The score is reported back to the notebook. |
| Sessions | The dashboard and the Deep Notebook sidebar list the notebook's sessions; **New Session** starts a chat session. Notebook sessions are hidden from Harness's own Workspaces list so the same conversation does not appear twice. |
| Course style | Notebook settings has a free-text **Course style**. It is used by every session and takes precedence over global answer-format instructions; use it for lesson length, language, tone, or to suppress a global answer template. Answers are in English by default; only this field can request another language. |
| Learner memory | Every quiz report updates per-notebook and cross-notebook mastery, strengths, focus areas, and misconceptions. **Learner memory** in the ⋯ menu, the library, or the sidebar lets you view, add, edit, and forget entries. |
| Flashcards | Generate active-recall cards from your sources and weak topics, then review them with Again / Hard / Good / Easy scheduling. This stays a local notebook tool, not a session. |
| Sources | **Add sources** uploads files, pastes text, imports public pages or Harness transcripts, discovers web sources, selects context, and searches locally. Only selected sources are mirrored into the workspace. |
| Ideas notebook | **Organize your ideas** keeps the source workspace with Sources, Studio, and Notes. Its conversations are sessions too; Studio artifacts remain local. |
| Study agent | **Work with the agent** opens a session with full Harness tools. It reads the same workspace brief and learner memory. |
| Notebook menu | Study goal, learning map, learner memory, course style and model (Notebook settings), rename, delete, export, linked sessions. |

## What is stored where

Each notebook is a folder under `$DSH_HOME/deep-notebook/notebooks/<name>-<id>/`:

- `notebook.sqlite` — canonical notebook state: title, sources, notes, artifacts, learning goal, map, plan, attempts, flashcards, and the indexes of its Harness sessions.
- `memory.sqlite` — this notebook's learner memory.
- `meta.json` — human-readable metadata.
- `workspace/` — the Harness workspace: `brief.md`, `memory.md`, generated `AGENTS.md`, `.agents/skills/notebook/SKILL.md`, `sources/`, `exports/`, `agent/` (including `agent/records/`).
- `index.sqlite` at `$DSH_HOME/deep-notebook/` — rebuildable library index.
- `$DSH_HOME/deep-notebook/learner/memory.sqlite` — cross-notebook learner memory.

Conversations themselves live in Harness session storage. Exporting a notebook includes the session transcripts when Harness can read them.

## Things to know

- The workspace is registered in Harness the first time you open a session, not when the notebook is created.
- Deleting a notebook archives its Harness sessions, removes the workspace registration, and deletes the notebook folder. Harness has no session-delete API, so archived session logs remain in Harness's archive.
- The default agent configuration is used for sessions, so the global `AGENTS.md` applies to lessons too. A notebook's **Course style** takes precedence when the two conflict.
- Notebook sessions are hidden from Harness's native Workspaces list; they appear in the Deep Notebook sidebar and the notebook page. Sessions created directly in a notebook workspace are adopted into the notebook before that group is hidden.
- The tutor reports results by writing files and, when needed, reading the workspace. The first such action may ask for permission depending on your Harness permission mode.
- Old plugin conversations from 1.1 and earlier are shown read-only under **Earlier conversations**; they are not converted into Harness sessions.
- A notebook's folder path is permanent after its first session (Harness session working directories are immutable). Renaming a notebook changes its title only.

## Plugin index

DSH has no central plugin store. It discovers plugins through index files. This repository publishes one:

```
https://cdn.jsdelivr.net/gh/MicroCapCap/dsh-deep-notebook@main/market/index.json
```

To use it, enable **Experimental plugins → Custom plugin indexes**, open **Plugins → Discover → Add index source**, and paste the URL. The index lists Deep Notebook 2.1.1 with its icon, description, repository, and install source. Fallbacks: `https://raw.githubusercontent.com/MicroCapCap/dsh-deep-notebook/main/market/index.json` and `https://microcapcap.github.io/dsh-deep-notebook/market/index.json`.

## Development

`node scripts/build.mjs` creates the browser bundle. `node --test` runs the storage, report-import, workspace, study-progress, spaced-review, memory, artifact, and route tests. Use `pnpm pack` to build an installable archive.

PDF, DOCX, PPTX, XLSX, and EPUB imports use the local [MarkItDown CLI](https://github.com/microsoft/markitdown); text files work directly. Imports support up to 12 MB per file, 600,000 characters per source, and 150 sources per notebook, subject to the notebook storage limit.

## License

MIT. See [LICENSE](LICENSE).
