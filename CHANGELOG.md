# Changelog

## 2.1.1

- **Lesson completion is manual.** Each lesson card has **Mark completed**; once complete it shows **Completed** and clicking it reopens the lesson. The tutor no longer writes `lesson_done` records, and those records are rejected if they appear.
- **Plugin icon.** Added an original notebook-and-spark icon, exported as `./icon` for the Harness plugin list.
- Removed the "do not browse the web" and "you do not need to read files" instructions from lesson and quiz prompts and from the generated `AGENTS.md`. The tutor keeps the full tool set and decides when to read files, search, or browse; there are no tool restrictions or tool policies in the plugin.

## 2.1.0

- **English by default.** Session prompts, the workspace brief, `AGENTS.md`, and the notebook skill all instruct the tutor to answer in English. Only a notebook's course style can request another language.
- **Course style per notebook.** Notebook settings has a free-text course style. It is written into `AGENTS.md`, `brief.md`, and every session prompt, and explicitly takes precedence over global answer-format instructions. Use it for lesson length, language, tone, or to suppress the global four-section format.
- **Quizzes use the native question card.** The notebook skill now tells the tutor to use Harness's question tool with clickable multiple-choice options. It can ask one question at a time (feedback after each) or a batch (then explain every miss). Explanations are never shortened; if the tool caps a batch, the next batch continues instead of dropping questions. The tutor reports one `quiz_result` after the last explanation.
- **Notebook sessions no longer clutter the native Workspaces list.** The plugin hides each notebook workspace group in Harness's sidebar, so its sessions appear only in the Deep Notebook sidebar and notebook page. Sessions created directly in a notebook workspace are adopted into the notebook index before hiding.
- **Prompt cleanup.** Session prompts no longer force "write it as Markdown"; the tutor chooses prose, tables, examples, or interactive steps. Course style is included in every prompt.
- **New Session.** The per-notebook "New conversation" button is now **New Session**.
- Removed dead dialog paths for the old create/chat-rename flows; audited every source dialog tab and notebook menu item (all remaining ones are wired).

## 2.0.0

Deep Notebook now turns every study action into a real DeepSeek Harness session. A notebook is a workspace, each course is a session, and the tutor reports results back through a notebook skill.

- **Notebook = Harness workspace.** Opening a notebook registers its `workspace/` folder as a Harness workspace (once), so its sessions appear under the notebook in the Harness sidebar and can be opened in the native session view.
- **Buttons are session entries.** A lesson, the study plan, a new conversation, and notebook setup each create or reopen a Harness session with the current default agent configuration and send one preset prompt as the first message. The quiz button sends a quiz prompt into the same lesson session; the quiz itself stays inside that session. Diagnostic and practice quizzes open a chat session with a quiz prompt.
- **No private preset, no prompt injection.** The prompt is the first user message. Goals, lesson details, and the lesson plan are written into the prompt; the workspace `brief.md`, `memory.md`, and `AGENTS.md` carry the rest.
- **A notebook skill reports results.** Every workspace contains `.agents/skills/notebook/SKILL.md`. When a goal is agreed, a quiz ends, a lesson finishes, or the learner reveals something durable, the tutor writes one JSON file under `agent/records/`. Deep Notebook imports those records when the notebook is opened: the goal starts a background map and plan build; quiz results update attempts, progress, and learner memory; lesson completion marks the unit; memory records update the learner profile.
- **Workspace files.** `AGENTS.md` now describes the tutor role and working rules; `brief.md` and `memory.md` carry the plan and learner memory; only selected sources are mirrored under `sources/`.
- **Home is a plan and an entry point.** The dashboard shows priorities, all lessons, a quiz button on every lesson, more ways to study, progress, the notebook's sessions, and earlier conversations. Old plugin conversations and 1.1 study threads are shown read-only.
- **Removed the in-plugin conversation and quiz screens.** `StudyChat`, `Conversation`, `LessonView`, `PlanView`, `AssessmentView`, `QuestionSession`, `QuizSetup`, the tutor prompt modes, and the `thread-*`, `ask`, `study-ask`, `study-setup`, and `study-submit` actions are gone; sessions and the native Harness view replace them.
- **Deletion archives sessions.** Deleting a notebook archives its Harness sessions, removes the workspace registration, and deletes the notebook folder. DSH has no session-delete API, so archived session logs stay in Harness's archive.
- **Exports include session transcripts** when the session history is available.
- **Removed the direct dependency on the harness's internal menu component**, so a Harness UI change cannot blank the sidebar entry.

## 1.1.0

Deep Notebook now keeps a learner memory and runs lessons, plans, and quizzes as persistent study sessions.

- **Learner memory**: every quiz submission updates per-notebook and cross-notebook mastery, records specific misconceptions and the correct answer, and creates strengths or focus areas. Goals and notebook preferences are mirrored into the global profile. Existing study history is backfilled on startup, and deleting a notebook removes the memories sourced from it while keeping aggregate mastery accurate.
- Every study request now receives a compact `learnerMemory` context built from the notebook's memory, the global profile, relevant misconceptions, and cross-notebook mastery. The model is told to adapt explanations and priorities to it without citing it as evidence.
- **Learner memory panel**: a new dialog in the notebook ⋯ menu, the library, and the sidebar shows mastery, goals, preferences, strengths, focus areas, misconceptions, notes, and strategies. Memories can be added, edited, forgotten, and scoped to this notebook or across notebooks.
- **Study sessions**: lessons, plans, and quizzes are now persistent sessions stored in the notebook. Opening a lesson creates a lesson session with a dedicated teaching prompt and full history; follow-up questions, hints, worked examples, and “check yourself” continue the same session. Existing generated lessons are converted into session transcripts without a model call.
- **Quiz sessions**: “Take quiz”, the diagnostic, and practice tests create quiz sessions and activities, keep the structured runner for grading, and append the result to the session. The session then accepts follow-up questions about missed questions.
- **Plan sessions**: the weekly plan is a session too. The Day/Task table stays structured for starting lessons, while pacing and ordering questions persist in the session transcript.
- The notebook dashboard now lists **Study sessions** alongside past chats and agent sessions.
- Each notebook workspace gains `memory.md` and a generated `AGENTS.md`, so a Harness study agent loads the learner memory automatically. The brief also includes a learner-memory section.
- Math cleanup now handles `$…$` and `$$…$$` delimiters and common LaTeX spacing, so lesson articles render cleanly.

## 1.0.0

Deep Notebook, rebuilt around the **Study & learn** flow.

- Renamed the plugin from Deepmind Notebook to **Deep Notebook** (`dsh-deep-notebook`). Existing data is copied from `$DSH_HOME/deepmind-notebook/notebooks.sqlite` on first run.
- The post-goal study surface is now one Gemini-style canvas with no tabs or side panels: **Top priorities**, **All lessons**, **More ways to study** (weekly plan and quiz, plus a flashcards link), **Your progress** once results exist, **Past chats**, and a pinned composer. The notebook chat is a normal centered chat that works with or without sources and renders headings, lists, tables, emphasis, and citations; the home composer starts a new chat.
- **New notebook** is now a full-page setup instead of a dialog: “What are you studying?”, Organize your ideas / Study and learn cards, a large name field, and one full-width Create notebook button. Notebooks store their mode: **Organize your ideas** keeps the source, Studio, and Notes workspace, while **Study and learn** lands on a Gemini-style **Get started** page whose **Set a study goal** card opens a guided setup conversation. The assistant asks for the specific objective and sources, confirms the goal, and **View notebook** builds the learning map and lesson plan while skeleton cards show loading progress.
- Learning map: generate 3–8 topics with measurable objectives, then track each topic as **Strength**, **Focus area**, **Developing**, or **Not started**. The dashboard shows strong-topic percentage, coverage, mastery, streak, today's activity, weak topics, and the next recommended lesson.
- Study setup: set a goal, starting level, daily minutes, and optional target date. The goal can be edited later without losing completed lessons or attempts.
- Lessons open as chat-style articles with cited sections, key takeaways, a **Review what you've learned** quiz card, **Let's keep learning** suggestions, a **View notebook** action, and a follow-up composer; **Mark completed** lives in the top bar. **See your personalized study plan** opens a Gemini-style chat with a Day / Task weekly table whose rows start the lesson.
- Quiz setup: choose 5, 10, or 20 questions, select map topics or add a custom topic, and toggle instant feedback and hints.
- Quiz runner: live correct/wrong counters, progress segments, flags, hints, inline explanations under the chosen option, and correct/incorrect badges. Reports show a score ring, per-topic bars, the number of new focus areas, and reviewable answers with follow-up tutoring.
- Flashcards and spaced review: generate cards from sources and weak topics, then schedule them with Again / Hard / Good / Easy. The dashboard shows due counts, and missed cards return in the same session.
- Studio and the source workspace remain for **Organize your ideas** notebooks: reports, guides, mind maps, tables, slides, infographics, timelines, audio scripts, notes, citations, web and Harness-chat imports, and local search.
- Study goal and learning map are available from the notebook ⋯ menu; notebook rename and deletion are available there, from every sidebar row, and from every card in **All notebooks** (deletion asks for confirmation).
- Each notebook is now a self-contained folder: `notebook.sqlite` for canonical state, `meta.json`, and a `workspace/` directory with `brief.md`, `sources/`, `exports/`, and `agent/`. A rebuildable `index.sqlite` powers the library. Legacy single-file databases are split into folders automatically and kept as a backup.
- **Work with the agent** prepares the notebook workspace, mirrors sources, registers the folder as a Harness workspace, and opens a linked Harness session with full agent tools. Agent workspaces are tracked per notebook, shown under **Agent sessions**, and removed with the notebook (deletion is blocked while a session is still active).
- Larger notebook budget, normalized older notebooks, and a safe SQLite copy migration.

## 0.2.0

- Study & Learn tab with a goal, diagnostic quiz, lesson plan, lessons with knowledge checks, topic scores, practice tests, and attempt history.
- Notebook navigation, linked Harness sessions, notes, studio artifacts, local search, and export.

## 0.1.0

- First notebook release: sources, cited conversation, studio artifacts, and local SQLite storage.
