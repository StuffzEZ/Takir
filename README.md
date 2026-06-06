# Takir — Skills & Quests

A task and skill manager that turns your abilities and projects into a leveled, dependency-aware ledger. Skills are assessed by an AI (I–X scale, Roman numerals). Quests are broken down by an AI into required skills, sub-quests, and prerequisites.

A [Tauri 2](https://tauri.app) desktop app with a vanilla HTML/CSS/JS frontend and a small Rust shell for state persistence.

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│  TAKIR · Skills & Quests                          [Settings] │
├──────────────────────────────────────────┬───────────────────┤
│  [Skills] [Quests]            [+ New …]  │                   │
│  [Search…]    [Tree] [Grid]              │   Detail Pane     │
│  ────────────────────────────────────    │   (selected item) │
│  Tree (or grid) of skills / quests       │                   │
│                  75% width               │       25% width   │
└──────────────────────────────────────────┴───────────────────┘
```

## What it does

- **Skills.** You create a skill ("Blender 3D Modeling", "Sourdough Baking"). The AI generates a 10-question assessment (multiple-choice, free-text, and image-based) ranging from easy to very hard. You answer, the AI scores you, and you get a level from **I (Novice)** to **X (Legend)** with a title (Apprentice, Adept, Journeyman, Veteran, …).
- **Quests.** You create a task you want to complete. The AI analyzes it and suggests:
  - **Required skills** and the **minimum level** for each (auto-linked to existing skills or created new)
  - **Sub-quests** that break the work down (with auto-wired prerequisites)
  - **Prerequisite quests** that should be completed first
- **Trees & dependencies.** Skills depend on prerequisite skills (must be assessed). Quests depend on prerequisite quests (must be completed) and required skill levels. Locked items appear dimmed.
- **Vision-capable.** Quiz questions can include images. You can attach reference images to your answers and the AI judges them.

## Tech

- **Tauri 2** (Rust) — host shell, state file persistence.
- **Vanilla HTML/CSS/JS (ES modules)** — no framework, no bundler.
- **OpenRouter** for LLM calls. Default model: `google/gemma-4-31b-it:free` (your recommendation). You can change it to anything in **Settings**.
- **localStorage** is the primary store; **`<AppData>/Stuf_y/Takir/takir_state.json`** is a debounced file mirror (path shown in Settings).

## First-run setup

1. Get an OpenRouter API key at <https://openrouter.ai>.
2. Launch Takir. Click **Settings** (top right) and paste your key.
3. (Optional) Change the model — the default is the suggested `google/gemma-4-31b-it:free`. If that's unavailable, try `google/gemma-3-27b-it:free` (a known free, vision-capable model).
4. Click **+ New Skill**, give it a name and description.
5. When the modal closes, the assessment begins — answer the 10 questions and receive your level.
6. Switch to **Quests** and **+ New Quest** to start a task. Use **Analyze with AI** to get skill, sub-quest, and prerequisite suggestions.

## Data location

State is written to:

- **Windows:** `%APPDATA%\Stuf_y\Takir\takir_state.json`
- **macOS:** `~/Library/Application Support/Stuf_y/Takir/takir_state.json`
- **Linux:** `$XDG_DATA_HOME/Stuf_y/Takir/takir_state.json` (or `~/.local/share/Stuf_y/Takir/takir_state.json`)

The exact path is shown in the Settings modal.

## Project layout

```
Takir/
├── src/                       # Frontend (loaded by Tauri)
│   ├── index.html
│   ├── styles.css
│   └── js/
│       ├── utils.js           # Roman numerals, JSON extraction, etc.
│       ├── state.js           # Reactive store, persistence
│       ├── api.js             # OpenRouter client + prompts
│       ├── ui.js              # DOM helpers, rendering, modals
│       └── app.js             # Entry: tabs, modals, quiz, analysis
├── src-tauri/                 # Tauri (Rust) shell
│   ├── src/lib.rs             # save_state / load_state / state_path commands
│   ├── tauri.conf.json
│   └── capabilities/default.json
└── tests/                     # Node-only validation tests
    ├── validate.mjs           # utils tests
    ├── tree_test.mjs          # tree algorithm tests
    ├── bugcheck.mjs           # edge-case tests
    └── smoke.mjs              # state and api smoke tests
```

## Develop / test

The frontend is plain HTML/JS served by Tauri — no build step.

To run the JS unit tests (Node only, no Tauri needed):

```sh
cd Takir
npm test
# or directly:
node tests/validate.mjs
node tests/tree_test.mjs
node tests/bugcheck.mjs
node tests/smoke.mjs
```

To launch the Tauri app, follow the standard Tauri 2 setup (Rust toolchain + `tauri-cli`):

```sh
cd Takir/src-tauri
cargo tauri dev
```

## Notes

- The **level** of a skill is set by the AI after the assessment. You can re-take it any time to update.
- A skill's **assessment** can be started only when all its prerequisite skills are themselves assessed (level ≥ I).
- A quest is **available** when all prerequisite quests are `completed` and the user meets every required skill's level.
- A quest is **blocked** when one of its required skills doesn't exist yet, or one of its prerequisite quests is `blocked`.
