/* ==========================================================
   agent.js
   AI control layer for Takir. The agent can read & search
   skills/tasks, create/update/delete them, manage a persistent
   memory, compare proposed skill requirements against the
   user's current levels, and run the quiz/task-analysis flows.

   Tool-calling transport is provided by api.js (chat()).
   ========================================================== */

import { store } from './state.js';
import { chat, generateSkillQuiz, analyzeTask, suggestSkillPrerequisites, suggestTaskPlan, reviewProgress } from './api.js';
import { toRoman } from './utils.js';
import { freeSitesPromptBlock } from './data/free-sites.js';

function tauriInvoke() {
    try {
        if (typeof window === 'undefined') return null;
        const t = window.__TAURI__;
        if (t && t.core && typeof t.core.invoke === 'function') return t.core.invoke;
    } catch { /* ignore */ }
    return null;
}

/** True if the user has enabled the AI debug console toggle. */
function isDebug() {
    try { return !!(store && store.state && store.state.aiDebug); }
    catch { return false; }
}

/* ---------------------- system prompt ---------------------- */

export const TAKIR_SYSTEM_PROMPT = `You are Tak (or "the AI"), the AI assistant inside Takir, a personal task and skill manager. Be friendly, precise, and useful. Your name is Tak.

DATA MODEL
- Skills: a competence in a domain. Fields: id, seq (display number), name, description, level (0=unassessed, 1..10 mapped to Roman numerals I..X), prerequisites (array of skill IDs), notes.
  Levels: 1=Novice, 2=Apprentice, 3-4=Competent, 5-6=Proficient, 7-8=Advanced, 9-10=Legend.
- Tasks (called "Quests" in the UI): an action the user wants to complete. Fields: id, seq (display number), title, description, status ("pending"|"in-progress"|"completed"|"blocked"), skills (array of skill IDs the task practices), prerequisites (array of task IDs), subtasks, notes.
- State persists locally; changes are saved automatically.
- Each item has a short opaque id ("sk_abc" / "tk_xyz") AND a human-friendly display id (the "#1", "#2" seq number). Users will refer to items as "#5" or "Swordplay (#5)" or "the quest about Blender". Either is fine.
- When the user mentions "#N" you can pass "#N" directly to the id field of any tool — the tool handler resolves it. Same for the user just saying a name; use list_skills/list_tasks with a filter to resolve.
- Never invent an id that wasn't returned by a tool.

PERSISTENT MEMORY
- You have a long-term memory in store.memory with three parts:
    facts:  key->value structured facts about the user (name, role, preferences, prior work, project context)
    notes:  free-form dated notes you append to (great for tracking prior work, decisions, things to follow up on)
    pinned: arrays of skill and task ids the user has marked as important
- You may freely read, write, and forget memory. ALWAYS consult memory at the start of a turn before responding, and ALWAYS write back anything the user asks you to remember or anything you learn that future-you will need (their role, prior projects, preferences, etc.).
- When the user tells you about themselves or asks you to remember something, call remember_fact or append_memory_note immediately.

SKILL REQUIREMENTS — IMPORTANT
- The user expects you to ALWAYS suggest skill requirements (with levels) for any task, and to compare those levels to the user's current assessed levels.
- Whenever you create, update, or analyze a task, IMMEDIATELY follow up with assess_skill_requirements using the proposed (skill_id, level) list. The handler returns each requirement with the user's current level, the target level, and the gap. Surface this to the user in plain language ("You need Carpentry at level V (you are at II, gap of 3)").
- You may also use assess_skill_requirements on its own when the user asks "what skills do I need for X?" or "how ready am I for Y?".

CAPABILITIES (TOOLS)
- read: list/get/search skills, tasks, memory, active tab
- write: create/update/delete skills and tasks
- assess: assess_skill_requirements, generate_quiz, analyze_task
- plan: suggest_skill_prerequisites, suggest_task_plan
- review: review_progress (user-submitted text/image/video update on a quest)
- memory: read_memory, remember_fact, forget_fact, append_memory_note, pin_item, unpin_item
- web: web_search (SearXNG-backed) and web_fetch (read a URL as plain text) for questions that need current/outside info

RECOMMENDED FREE LEARNING SITES
When the user asks for resources, tutorials, or docs, PREFER 100% free sites. Here is a curated list grouped by what they're for. Use the list directly when you know the topic; use web_search for fresh or very specific material.

${freeSitesPromptBlock()}

BEHAVIOR
- For non-trivial requests, start by calling list_skills, list_tasks, and read_memory to understand current state. Do this even if you think you remember.
- Reference items by display id (#N) when talking to the user; use the raw id only when calling a tool.
- Prerequisites, subtasks, and task.skills are arrays of IDs, not names.
- Destructive actions (delete_skill, delete_task) require explicit user approval in the current message. Pass confirm=true only after the user clearly says "yes", "do it", "delete it", "remove it", etc. Otherwise show a preview and ask.
- Lowering a skill level is mildly destructive. Prefer set_skill_level only after a freshly scored quiz or with user approval.
- If a tool returns ok:false, read the error, fix the call, and retry. Do not loop on the same error more than twice.
- If the user's request is ambiguous, ask one short clarifying question instead of guessing.
- Keep responses short. Plain text, no markdown headings, no code fences.
- Maximum 8 tool steps per turn. If you cannot finish in 8 steps, summarize progress and ask the user to continue.

SAFETY
- Never call delete_* with confirm=true unless the user has clearly approved that exact deletion in this turn.
- Never invent IDs. If a tool returns "not found", tell the user and ask for clarification.`;

const P = (type, desc, extra = {}) => ({ type, description: desc, ...extra });

/* -------------------------- tools -------------------------- */

export const TOOLS = [
    { type: 'function', function: {
        name: 'list_skills',
        description: 'List all skills. Optionally filter by a case-insensitive substring of the name or description.',
        parameters: { type: 'object', properties: { filter: P('string', 'Optional substring filter applied to name and description.') }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'get_skill',
        description: 'Get a single skill by id, including description, level, prerequisites, notes, and the last quiz result if any.',
        parameters: { type: 'object', required: ['id'], properties: { id: P('string', 'The skill id, e.g. "sk_abc123".') }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'create_skill',
        description: 'Create a new skill. Returns the created skill object including its new id.',
        parameters: { type: 'object', required: ['name'], properties: {
            name: P('string', 'The skill name. Required.'),
            description: P('string', 'Optional short description.'),
            prerequisites: P('array', 'Optional array of existing skill ids that should be prerequisites.', { items: P('string') }),
            level: P('integer', 'Optional initial level 0-10. Default 0 (unassessed).', { minimum: 0, maximum: 10 }),
        }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'update_skill',
        description: 'Update fields on an existing skill. Only provided fields are changed.',
        parameters: { type: 'object', required: ['id'], properties: {
            id: P('string', 'The skill id to update.'),
            name: P('string', 'New name (optional).'),
            description: P('string', 'New description (optional).'),
            level: P('integer', 'New level 0-10 (optional).', { minimum: 0, maximum: 10 }),
            prerequisites: P('array', 'New full prerequisites list (array of skill ids). Replaces existing.', { items: P('string') }),
            notes: P('string', 'Free-form notes (optional).'),
        }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'delete_skill',
        description: 'Delete a skill and clean up references to it. Requires confirm=true; only pass true when the user has explicitly approved deletion in this turn.',
        parameters: { type: 'object', required: ['id', 'confirm'], properties: {
            id: P('string', 'The skill id to delete.'),
            confirm: P('boolean', 'Must be true to perform the deletion. Pass false (or omit) to do a dry-run preview.'),
        }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'list_tasks',
        description: 'List all tasks/quests. Optionally filter by status or substring.',
        parameters: { type: 'object', properties: {
            filter: P('string', 'Optional substring filter applied to title and description.'),
            status: P('string', 'Optional status filter: "pending", "in-progress", "completed", "blocked".'),
        }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'get_task',
        description: 'Get a single task/quest by id.',
        parameters: { type: 'object', required: ['id'], properties: { id: P('string', 'The task id, e.g. "tk_abc123".') }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'create_task',
        description: 'Create a new task/quest. Returns the created task including its new id. After creation, ALWAYS call assess_skill_requirements to compare any required skills to the user\'s current levels.',
        parameters: { type: 'object', required: ['title'], properties: {
            title: P('string', 'Task title. Required.'),
            description: P('string', 'Optional description.'),
            status: P('string', 'Initial status. Default "pending".'),
            skills: P('array', 'Optional array of skill ids the task practices.', { items: P('string') }),
            prerequisites: P('array', 'Optional array of prerequisite task ids.', { items: P('string') }),
            required_skills: P('array', 'Optional array of {skill_id, level} objects the task requires. Each level is 1-10.', { items: P('object') }),
        }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'update_task',
        description: 'Update fields on an existing task. Only provided fields are changed.',
        parameters: { type: 'object', required: ['id'], properties: {
            id: P('string', 'The task id to update.'),
            title: P('string', 'New title (optional).'),
            description: P('string', 'New description (optional).'),
            status: P('string', 'New status (optional): "pending"|"in-progress"|"completed"|"blocked".'),
            skills: P('array', 'New full skills list (replaces existing).', { items: P('string') }),
            prerequisites: P('array', 'New full prerequisites list (replaces existing).', { items: P('string') }),
            notes: P('string', 'Free-form notes (optional).'),
        }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'delete_task',
        description: 'Delete a task/quest. Requires confirm=true; only pass true when the user has explicitly approved deletion in this turn.',
        parameters: { type: 'object', required: ['id', 'confirm'], properties: {
            id: P('string', 'The task id to delete.'),
            confirm: P('boolean', 'Must be true to perform the deletion. Pass false (or omit) to do a dry-run preview.'),
        }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'search_all',
        description: 'Search both skills and tasks by a substring.',
        parameters: { type: 'object', required: ['query'], properties: { query: P('string', 'Substring to search for in skills and tasks.') }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'assess_skill_requirements',
        description: 'Compare a proposed list of (skill_id, level) requirements against the user\'s current levels. Returns each requirement with the user\'s current level, target level, and gap. Use this whenever a task is created, updated, or analyzed, and when the user asks "what skills do I need for X?" or "how ready am I?".',
        parameters: { type: 'object', required: ['requirements'], properties: {
            requirements: P('array', 'Array of {skill_id, level} or {skillId, level} objects. level is 1-10.', { items: P('object') }),
            task_id: P('string', 'Optional task id these requirements belong to (informational only).'),
        }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'generate_quiz',
        description: 'Generate an assessment quiz for a skill. Returns the quiz structure; the user still has to take it.',
        parameters: { type: 'object', required: ['skill_id'], properties: { skill_id: P('string', 'The skill id to generate a quiz for.') }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'analyze_task',
        description: 'Analyze a task: propose required skills (with levels), subtasks, and prerequisite tasks. The returned required_skills is suitable to pass straight into assess_skill_requirements.',
        parameters: { type: 'object', required: ['task_id'], properties: { task_id: P('string', 'The task id to analyze.') }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'suggest_skill_prerequisites',
        description: 'Suggest prerequisite skills for a NEW skill the user is thinking of creating. Takes a name and description (not an id, since the skill does not exist yet). Returns suggested prereqs with target levels and an existingId when the prereq already exists in the user\'s Takir.',
        parameters: { type: 'object', required: ['name'], properties: {
            name: P('string', 'The proposed skill name.'),
            description: P('string', 'Optional proposed skill description.'),
        }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'suggest_task_plan',
        description: 'Suggest required skills (with levels), subtasks, and prerequisite tasks for a NEW quest the user is thinking of creating. Takes a title and description (not an id, since the quest does not exist yet).',
        parameters: { type: 'object', required: ['title'], properties: {
            title: P('string', 'The proposed quest title.'),
            description: P('string', 'Optional proposed quest description.'),
        }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'review_progress',
        description: 'Review a user-submitted progress update on a quest. The user may attach an image or video. Returns a verdict ("on track"|"needs more work"|"ready to mark complete"), what is working, what to improve, and concrete next steps. ALWAYS follow a create_task / update_task with review_progress if the user said they did some of the work and want feedback.',
        parameters: { type: 'object', required: ['task_id'], properties: {
            task_id: P('string', 'The task id the progress update is for.'),
            progress_text: P('string', 'What the user said about their progress (text).'),
            attachment_url: P('string', 'Optional data URL of an attached image or video the user shared.'),
            attachment_type: P('string', '"image" or "video" if an attachment was provided.'),
        }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'read_memory',
        description: 'Read the AI\'s persistent memory: facts (key->value), notes (free-form dated), and pinned skill/task ids.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'remember_fact',
        description: 'Store or update a structured fact about the user in memory (e.g. key="name", value="Alice"). Overwrites any existing value for that key.',
        parameters: { type: 'object', required: ['key', 'value'], properties: {
            key: P('string', 'Short snake_case or camelCase key, e.g. "name", "primary_role", "current_project".'),
            value: P('string', 'The fact to remember.'),
        }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'forget_fact',
        description: 'Remove a structured fact from memory by key.',
        parameters: { type: 'object', required: ['key'], properties: { key: P('string', 'The fact key to remove.') }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'append_memory_note',
        description: 'Append a dated free-form note to memory. Use for prior work, decisions, things to follow up on, etc.',
        parameters: { type: 'object', required: ['text'], properties: { text: P('string', 'The note text.') }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'pin_item',
        description: 'Pin a skill or task id in memory as important.',
        parameters: { type: 'object', required: ['type', 'id'], properties: {
            type: P('string', '"skill" or "task".'),
            id: P('string', 'The id to pin.'),
        }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'unpin_item',
        description: 'Unpin a previously pinned skill or task id.',
        parameters: { type: 'object', required: ['type', 'id'], properties: {
            type: P('string', '"skill" or "task".'),
            id: P('string', 'The id to unpin.'),
        }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'web_search',
        description: 'Search the public web using the configured SearXNG instance. Returns a list of results with title, URL, and snippet. Use this when the user asks a question that needs current information from the web (tutorials, docs, recent changes, etc.). Prefer the free-sites list in your system prompt for programming references; use web_search for everything else or for very recent material.',
        parameters: { type: 'object', required: ['query'], properties: {
            query: P('string', 'The search query. Be specific.'),
            max_results: P('integer', 'Optional max results (1-20). Default 8.', { minimum: 1, maximum: 20 }),
        }, additionalProperties: false },
    }},
    { type: 'function', function: {
        name: 'web_fetch',
        description: 'Fetch a web page and return its content as plain text (HTML stripped). Use after web_search to read a result in full, or directly when the user gives you a URL.',
        parameters: { type: 'object', required: ['url'], properties: {
            url: P('string', 'An http:// or https:// URL.'),
            max_chars: P('integer', 'Optional max characters to return (500-200000). Default 20000.', { minimum: 500, maximum: 200000 }),
        }, additionalProperties: false },
    }},
];

/* ---------------------- tool handlers ---------------------- */

function ok(data) { return { ok: true, data }; }
function fail(message, code = 'error') { return { ok: false, error: { code, message } }; }

function str(v, fallback = '') {
    if (v == null) return fallback;
    return String(v);
}
function intInRange(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}
function idArray(v) {
    if (!Array.isArray(v)) return [];
    return [...new Set(v.map(x => String(x || '')).filter(Boolean))];
}

/**
 * Resolve a user-supplied id reference. Accepts the raw id ("sk_...") or a
 * display id like "#5". Returns the underlying id, or null if not found.
 */
function resolveId(ref, kind) {
    if (ref == null) return null;
    const s = String(ref).trim();
    if (!s) return null;
    if (s.startsWith('#')) {
        const n = parseInt(s.slice(1), 10);
        if (!Number.isInteger(n) || n < 1) return null;
        const items = kind === 'task' ? store.getTasks() : store.getSkills();
        const found = items.find(it => it.seq === n);
        return found ? found.id : null;
    }
    return s;
}
function parseToolArgs(call) {
    const raw = call?.function?.arguments;
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return {}; }
}

function summarizeSkill(s) {
    if (!s) return null;
    return {
        id: s.id,
        seq: s.seq ?? null,
        displayId: s.seq ? `#${s.seq}` : null,
        name: s.name,
        description: s.description || '',
        level: s.level,
        levelRoman: toRoman(s.level),
        prerequisites: [...(s.prerequisites || [])],
        notes: s.notes || '',
        lastQuizLevel: s.quiz?.level ?? null,
        updatedAt: s.updatedAt || null,
    };
}
function summarizeTask(t) {
    if (!t) return null;
    const skillIds = (t.skills && t.skills.length)
        ? t.skills
        : (t.requiredSkills || []).map(rs => rs.skillId);
    return {
        id: t.id,
        seq: t.seq ?? null,
        displayId: t.seq ? `#${t.seq}` : null,
        title: t.title || t.name || '(untitled)',
        description: t.description || '',
        status: t.status || 'pending',
        skills: [...skillIds],
        prerequisites: [...(t.prerequisites || [])],
        subtasks: [...(t.subtasks || [])],
        notes: t.notes || '',
        updatedAt: t.updatedAt || null,
    };
}

function createsCycleSkill(skillId, prereqIds) {
    const seen = new Set();
    const stack = [...prereqIds];
    while (stack.length) {
        const cur = stack.pop();
        if (cur === skillId) return true;
        if (seen.has(cur)) continue;
        seen.add(cur);
        const s = store.getSkill(cur);
        if (s) for (const p of (s.prerequisites || [])) stack.push(p);
    }
    return false;
}
function createsCycleTask(taskId, prereqIds) {
    const seen = new Set();
    const stack = [...prereqIds];
    while (stack.length) {
        const cur = stack.pop();
        if (cur === taskId) return true;
        if (seen.has(cur)) continue;
        seen.add(cur);
        const t = store.getTask(cur);
        if (t) for (const p of (t.prerequisites || [])) stack.push(p);
    }
    return false;
}

export const TOOL_HANDLERS = {
    list_skills({ filter } = {}) {
        let items = store.getSkills();
        if (filter) {
            const f = String(filter).toLowerCase();
            items = items.filter(s =>
                (s.name || '').toLowerCase().includes(f) ||
                (s.description || '').toLowerCase().includes(f)
            );
        }
        return ok(items.map(summarizeSkill));
    },

    get_skill({ id } = {}) {
        const rawRef = str(id).trim();
        if (!rawRef) return fail('id is required', 'missing_arg');
        const idStr = resolveId(rawRef, 'skill') || rawRef;
        const skill = store.getSkill(idStr);
        if (!skill) return fail(`No skill with id "${rawRef}".`, 'not_found');
        return ok(summarizeSkill(skill));
    },

    create_skill({ name, description, prerequisites, level } = {}) {
        const nameStr = str(name).trim();
        if (!nameStr) return fail('name is required', 'missing_arg');
        const levelN = (level === undefined || level === null) ? 0 : intInRange(level, 0, 10, 0);
        const prereqIds = idArray(prerequisites);
        for (const pid of prereqIds) {
            if (!store.getSkill(pid)) return fail(`Prerequisite skill "${pid}" not found.`, 'bad_ref');
            if (createsCycleSkill('__pending__', [pid])) return fail('Prerequisite cycle detected.', 'cycle');
        }
        const skill = store.addSkill({ name: nameStr, description: str(description), prerequisites: prereqIds });
        if (levelN) store.updateSkill(skill.id, { level: levelN });
        return ok(summarizeSkill(store.getSkill(skill.id)));
    },

    update_skill({ id, name, description, level, prerequisites, notes } = {}) {
        const rawRef = str(id).trim();
        if (!rawRef) return fail('id is required', 'missing_arg');
        const idStr = resolveId(rawRef, 'skill') || rawRef;
        if (!store.getSkill(idStr)) return fail(`No skill with id "${rawRef}".`, 'not_found');
        const patch = {};
        if (name !== undefined) patch.name = str(name);
        if (description !== undefined) patch.description = str(description);
        if (level !== undefined) patch.level = intInRange(level, 0, 10, 0);
        if (prerequisites !== undefined) {
            const prereqIdsRaw = idArray(prerequisites);
            const prereqIds = prereqIdsRaw.map(p => resolveId(p, 'skill') || p);
            for (const pid of prereqIds) {
                if (pid === idStr) return fail('A skill cannot be its own prerequisite.', 'cycle');
                if (!store.getSkill(pid)) return fail(`Prerequisite skill "${pid}" not found.`, 'bad_ref');
            }
            if (createsCycleSkill(idStr, prereqIds)) {
                return fail('This update would create a prerequisite cycle.', 'cycle');
            }
            patch.prerequisites = prereqIds;
        }
        if (notes !== undefined) patch.notes = str(notes);
        const updated = store.updateSkill(idStr, patch);
        return ok(summarizeSkill(updated));
    },

    delete_skill({ id, confirm } = {}) {
        const rawRef = str(id).trim();
        if (!rawRef) return fail('id is required', 'missing_arg');
        const idStr = resolveId(rawRef, 'skill') || rawRef;
        const skill = store.getSkill(idStr);
        if (!skill) return fail(`No skill with id "${rawRef}".`, 'not_found');
        if (!confirm) {
            return ok({ preview: true, wouldDelete: summarizeSkill(skill), message: 'Pass confirm=true to actually delete.' });
        }
        const okDel = store.deleteSkill(idStr);
        return okDel ? ok({ deleted: true, id: idStr, name: skill.name }) : fail('Delete failed.', 'state');
    },

    list_tasks({ filter, status } = {}) {
        let items = store.getTasks();
        if (status) items = items.filter(t => (t.status || 'pending') === status);
        if (filter) {
            const f = String(filter).toLowerCase();
            items = items.filter(t =>
                (t.title || t.name || '').toLowerCase().includes(f) ||
                (t.description || '').toLowerCase().includes(f)
            );
        }
        return ok(items.map(summarizeTask));
    },

    get_task({ id } = {}) {
        const rawRef = str(id).trim();
        if (!rawRef) return fail('id is required', 'missing_arg');
        const idStr = resolveId(rawRef, 'task') || rawRef;
        const task = store.getTask(idStr);
        if (!task) return fail(`No task with id "${rawRef}".`, 'not_found');
        const summary = summarizeTask(task);
        // Enrich with the user's current levels for any associated skills.
        summary.skillLevels = (summary.skills || []).map(sid => {
            const sk = store.getSkill(sid);
            return { skillId: sid, name: sk?.name || null, currentLevel: sk?.level ?? 0, currentLevelRoman: toRoman(sk?.level ?? 0) };
        });
        return ok(summary);
    },

    create_task({ title, description, status, skills, prerequisites, required_skills } = {}) {
        const titleStr = str(title).trim();
        if (!titleStr) return fail('title is required', 'missing_arg');
        const skillIds = idArray(skills).map(s => resolveId(s, 'skill') || s);
        for (const sid of skillIds) {
            if (!store.getSkill(sid)) return fail(`Skill "${sid}" not found.`, 'bad_ref');
        }
        const prereqIds = idArray(prerequisites).map(p => resolveId(p, 'task') || p);
        for (const pid of prereqIds) {
            if (!store.getTask(pid)) return fail(`Prerequisite task "${pid}" not found.`, 'bad_ref');
        }
        const requiredSkills = Array.isArray(required_skills) ? required_skills
            .map(rs => {
                const idRaw = str(rs.skill_id || rs.skillId || rs.id);
                return { skillId: resolveId(idRaw, 'skill') || idRaw, level: intInRange(rs.level, 1, 10, 1) };
            })
            .filter(rs => rs.skillId) : [];
        for (const rs of requiredSkills) {
            if (!store.getSkill(rs.skillId)) return fail(`Required skill "${rs.skillId}" not found.`, 'bad_ref');
        }
        const task = store.addTask({
            name: titleStr,
            description: str(description),
            status: str(status) || 'pending',
            prerequisites: prereqIds,
            requiredSkills: requiredSkills.length ? requiredSkills : skillIds.map(skillId => ({ skillId, level: 0 })),
        });
        if (Array.isArray(task.skills) || skillIds.length) {
            store.updateTask(task.id, { skills: skillIds });
        }
        const created = store.getTask(task.id);
        // Surface gap analysis for any required skills
        const gaps = (requiredSkills.length ? requiredSkills : skillIds.map(skillId => ({ skillId, level: 1 })))
            .map(rs => {
                const sk = store.getSkill(rs.skillId);
                return {
                    skillId: rs.skillId,
                    name: sk?.name || '(unknown)',
                    currentLevel: sk?.level ?? 0,
                    targetLevel: rs.level || 1,
                    gap: sk ? Math.max(0, (rs.level || 1) - sk.level) : null,
                };
            });
        return ok({ ...summarizeTask(created), requiredSkills, gaps });
    },

    update_task({ id, title, description, status, skills, prerequisites, notes } = {}) {
        const rawRef = str(id).trim();
        if (!rawRef) return fail('id is required', 'missing_arg');
        const idStr = resolveId(rawRef, 'task') || rawRef;
        const task = store.getTask(idStr);
        if (!task) return fail(`No task with id "${rawRef}".`, 'not_found');
        const patch = {};
        if (title !== undefined) patch.name = str(title);
        if (description !== undefined) patch.description = str(description);
        if (status !== undefined) {
            const valid = ['pending', 'in-progress', 'completed', 'blocked'];
            patch.status = valid.includes(status) ? status : 'pending';
        }
        if (skills !== undefined) {
            const skillIdsRaw = idArray(skills).map(s => resolveId(s, 'skill') || s);
            for (const sid of skillIdsRaw) {
                if (!store.getSkill(sid)) return fail(`Skill "${sid}" not found.`, 'bad_ref');
            }
            patch.requiredSkills = skillIdsRaw.map(skillId => ({ skillId, level: 0 }));
            patch.skills = skillIdsRaw;
        }
        if (prerequisites !== undefined) {
            const prereqIdsRaw = idArray(prerequisites).map(p => resolveId(p, 'task') || p);
            for (const pid of prereqIdsRaw) {
                if (pid === idStr) return fail('A task cannot be its own prerequisite.', 'cycle');
                if (!store.getTask(pid)) return fail(`Prerequisite task "${pid}" not found.`, 'bad_ref');
            }
            if (createsCycleTask(idStr, prereqIdsRaw)) {
                return fail('This update would create a prerequisite cycle.', 'cycle');
            }
            patch.prerequisites = prereqIdsRaw;
        }
        if (notes !== undefined) patch.notes = str(notes);
        const updated = store.updateTask(idStr, patch);
        return ok(summarizeTask(updated));
    },

    delete_task({ id, confirm } = {}) {
        const rawRef = str(id).trim();
        if (!rawRef) return fail('id is required', 'missing_arg');
        const idStr = resolveId(rawRef, 'task') || rawRef;
        const task = store.getTask(idStr);
        if (!task) return fail(`No task with id "${rawRef}".`, 'not_found');
        if (!confirm) {
            return ok({ preview: true, wouldDelete: summarizeTask(task), message: 'Pass confirm=true to actually delete.' });
        }
        const okDel = store.deleteTask(idStr);
        return okDel ? ok({ deleted: true, id: idStr, title: task.title || task.name }) : fail('Delete failed.', 'state');
    },

    search_all({ query } = {}) {
        const q = str(query).trim().toLowerCase();
        if (!q) return fail('query is required', 'missing_arg');
        const skills = store.getSkills()
            .filter(s => (s.name || '').toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q))
            .map(summarizeSkill);
        const tasks = store.getTasks()
            .filter(t => (t.title || t.name || '').toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q))
            .map(summarizeTask);
        return ok({ query, skills, tasks });
    },

    assess_skill_requirements({ requirements, task_id } = {}) {
        const list = Array.isArray(requirements) ? requirements : [];
        if (!list.length) return fail('requirements must be a non-empty array', 'missing_arg');
        const normalized = list.map(r => {
            const idRaw = str(r.skillId || r.skill_id || r.id);
            return {
                skillId: resolveId(idRaw, 'skill') || idRaw,
                level: intInRange(r.level, 0, 10, 0),
            };
        }).filter(r => r.skillId);
        const gaps = store.computeSkillGaps(normalized);
        return ok({ task_id: task_id ? str(task_id) : null, requirements: gaps });
    },

    async generate_quiz({ skill_id } = {}) {
        const rawRef = str(skill_id).trim();
        const idStr = resolveId(rawRef, 'skill') || rawRef;
        const skill = store.getSkill(idStr);
        if (!skill) return fail(`No skill with id "${rawRef}".`, 'not_found');
        const apiKey = store.state.apiKey;
        const model = store.state.model;
        if (!apiKey) return fail('API key is not set.', 'config');
        try {
            const quiz = await generateSkillQuiz({
                apiKey, model,
                skillName: skill.name,
                description: skill.description || '',
                attachments: [],
            });
            store.setSkillQuiz(idStr, {
                ...(skill.quiz || {}),
                questions: quiz.questions,
                title: quiz.title,
                generatedAt: new Date().toISOString(),
            });
            return ok({ skillId: idStr, title: quiz.title, questionCount: (quiz.questions || []).length });
        } catch (e) {
            return fail(`Quiz generation failed: ${e.message}`, 'ai');
        }
    },

    async analyze_task({ task_id } = {}) {
        const rawRef = str(task_id).trim();
        const idStr = resolveId(rawRef, 'task') || rawRef;
        const task = store.getTask(idStr);
        if (!task) return fail(`No task with id "${rawRef}".`, 'not_found');
        const apiKey = store.state.apiKey;
        const model = store.state.model;
        if (!apiKey) return fail('API key is not set.', 'config');
        try {
            const analysis = await analyzeTask({
                apiKey, model,
                taskName: task.title || task.name,
                description: task.description || '',
                skills: store.getSkills(),
            });
            const stamp = new Date().toISOString().slice(0, 10);
            const note = `[${stamp} analysis] ${analysis.reasoning || ''}`.trim();
            const newNotes = (task.notes ? task.notes.trimEnd() + '\n' : '') + note + '\n';
            store.updateTask(idStr, { notes: newNotes });
            // Convert "existingId" into concrete skill ids where possible
            const reqs = (analysis.requiredSkills || []).map(rs => ({
                skillId: rs.existingId || (rs.name ? `__new__:${rs.name}` : ''),
                level: intInRange(rs.level, 1, 10, 1),
                proposedName: rs.existingId ? null : (rs.name || null),
            })).filter(r => r.skillId);
            const gaps = reqs
                .filter(r => !r.skillId.startsWith('__new__:'))
                .map(r => {
                    const sk = store.getSkill(r.skillId);
                    return {
                        skillId: r.skillId,
                        name: sk?.name || r.proposedName,
                        currentLevel: sk?.level ?? 0,
                        targetLevel: r.level,
                        gap: sk ? Math.max(0, r.level - sk.level) : null,
                    };
                });
            return ok({ taskId: idStr, requiredSkills: reqs, subtasks: analysis.subtasks || [], prerequisites: analysis.prerequisites || [], difficulty: analysis.difficulty, reasoning: analysis.reasoning, gaps });
        } catch (e) {
            return fail(`Task analysis failed: ${e.message}`, 'ai');
        }
    },

    async suggest_skill_prerequisites({ name, description } = {}) {
        const nameStr = str(name).trim();
        if (!nameStr) return fail('name is required', 'missing_arg');
        const apiKey = store.state.apiKey;
        const model = store.state.model;
        if (!apiKey) return fail('API key is not set.', 'config');
        try {
            const out = await suggestSkillPrerequisites({
                apiKey, model,
                skillName: nameStr,
                description: str(description),
                existingSkills: store.getSkills(),
            });
            const suggested = (out.suggested || []).map(s => ({
                name: s.name,
                level: intInRange(s.level, 1, 10, 1),
                existingId: s.existingId || null,
                reason: s.reason || '',
            })).filter(s => s.name);
            return ok({ name: nameStr, description: str(description), suggested, reasoning: out.reasoning || '' });
        } catch (e) {
            return fail(`Skill suggestion failed: ${e.message}`, 'ai');
        }
    },

    async suggest_task_plan({ title, description } = {}) {
        const titleStr = str(title).trim();
        if (!titleStr) return fail('title is required', 'missing_arg');
        const apiKey = store.state.apiKey;
        const model = store.state.model;
        if (!apiKey) return fail('API key is not set.', 'config');
        try {
            const out = await suggestTaskPlan({
                apiKey, model,
                taskName: titleStr,
                description: str(description),
                existingSkills: store.getSkills(),
                existingTasks: store.getTasks(),
            });
            const skills = (out.requiredSkills || []).map(s => ({
                name: s.name,
                level: intInRange(s.level, 1, 10, 1),
                existingId: s.existingId || null,
                reason: s.reason || '',
            })).filter(s => s.name);
            return ok({
                title: titleStr,
                description: str(description),
                requiredSkills: skills,
                subtasks: out.subtasks || [],
                prerequisites: out.prerequisites || [],
                difficulty: out.difficulty,
                reasoning: out.reasoning || '',
            });
        } catch (e) {
            return fail(`Quest plan failed: ${e.message}`, 'ai');
        }
    },

    async review_progress({ task_id, progress_text, attachment_url, attachment_type } = {}) {
        const idStr = str(task_id);
        const task = store.getTask(idStr);
        if (!task) return fail(`No task with id "${idStr}".`, 'not_found');
        const apiKey = store.state.apiKey;
        const model = store.state.model;
        if (!apiKey) return fail('API key is not set.', 'config');
        const att = (attachment_url && attachment_type)
            ? { dataUrl: str(attachment_url), type: str(attachment_type), name: 'attachment' }
            : null;
        try {
            const out = await reviewProgress({
                apiKey, model,
                taskName: task.title || task.name,
                taskDescription: task.description || '',
                progressText: str(progress_text),
                attachment: att,
            });
            const stamp = new Date().toISOString().slice(0, 10);
            const note = [
                `[${stamp} progress review] verdict: ${out.verdict}`,
                `What is working: ${out.whatIsWorking || ''}`,
                `What to improve: ${out.whatToImprove || ''}`,
                `Next steps: ${(out.nextSteps || []).map(s => `- ${s}`).join('\n')}`,
                `Encouragement: ${out.encouragement || ''}`,
            ].join('\n');
            const newNotes = (task.notes ? task.notes.trimEnd() + '\n' : '') + note + '\n';
            store.updateTask(idStr, { notes: newNotes });
            return ok({ taskId: idStr, ...out });
        } catch (e) {
            return fail(`Progress review failed: ${e.message}`, 'ai');
        }
    },

    read_memory() {
        return ok(store.getMemory());
    },

    remember_fact({ key, value } = {}) {
        const k = str(key).trim();
        if (!k) return fail('key is required', 'missing_arg');
        store.rememberFact(k, value);
        return ok({ key: k, value: String(value ?? '') });
    },

    forget_fact({ key } = {}) {
        const k = str(key).trim();
        if (!k) return fail('key is required', 'missing_arg');
        const removed = store.forgetFact(k);
        return removed ? ok({ forgotten: k }) : fail(`No fact with key "${k}".`, 'not_found');
    },

    append_memory_note({ text } = {}) {
        const t = str(text).trim();
        if (!t) return fail('text is required', 'missing_arg');
        store.appendMemoryNote(t);
        return ok({ appended: t });
    },

    pin_item({ type, id } = {}) {
        const t = str(type);
        if (!['skill', 'task'].includes(t)) return fail('type must be "skill" or "task"', 'missing_arg');
        const idStr = str(id);
        if (!idStr) return fail('id is required', 'missing_arg');
        if (t === 'skill' && !store.getSkill(idStr)) return fail(`No skill with id "${idStr}".`, 'not_found');
        if (t === 'task' && !store.getTask(idStr)) return fail(`No task with id "${idStr}".`, 'not_found');
        store.pinItem(t, idStr);
        return ok({ type: t, id: idStr, pinned: true });
    },

    unpin_item({ type, id } = {}) {
        const t = str(type);
        if (!['skill', 'task'].includes(t)) return fail('type must be "skill" or "task"', 'missing_arg');
        const idStr = str(id);
        if (!idStr) return fail('id is required', 'missing_arg');
        const okUn = store.unpinItem(t, idStr);
        return okUn ? ok({ type: t, id: idStr, unpinned: true }) : fail('Item was not pinned.', 'not_found');
    },

    async web_search({ query, max_results } = {}) {
        const q = str(query).trim();
        if (!q) return fail('query is required', 'missing_arg');
        const max = Number.isFinite(Number(max_results)) ? Math.max(1, Math.min(20, Math.round(Number(max_results)))) : 8;
        const invoke = tauriInvoke();
        if (!invoke) {
            return fail('Web search is only available inside the Tauri desktop app. (No invoke handle found.)', 'env');
        }
        const baseUrl = (store.state && store.state.searxngUrl) || '';
        try {
            const res = await invoke('web_search', { query: q, searxngUrl: baseUrl, maxResults: max });
            const out = (res && Array.isArray(res.results)) ? res.results.slice(0, max) : [];
            return ok({
                query: res?.query || q,
                engine: res?.engine_url || baseUrl || null,
                count: out.length,
                results: out.map(r => ({ title: r.title || '', url: r.url, snippet: r.snippet || '', engine: r.engine || null })),
            });
        } catch (e) {
            return fail(`Web search failed: ${e?.message || e}`, 'network');
        }
    },

    async web_fetch({ url, max_chars } = {}) {
        const u = str(url).trim();
        if (!u) return fail('url is required', 'missing_arg');
        if (!/^https?:\/\//i.test(u)) return fail('url must start with http:// or https://', 'bad_arg');
        const cap = Number.isFinite(Number(max_chars)) ? Math.max(500, Math.min(200000, Math.round(Number(max_chars)))) : 20000;
        const invoke = tauriInvoke();
        if (!invoke) {
            return fail('Web fetch is only available inside the Tauri desktop app.', 'env');
        }
        try {
            const res = await invoke('web_fetch', { url: u, maxChars: cap });
            return ok({
                url: res?.url || u,
                contentType: res?.content_type || '',
                truncated: !!res?.truncated,
                body: res?.body || '',
            });
        } catch (e) {
            return fail(`Web fetch failed: ${e?.message || e}`, 'network');
        }
    },
};

/* ---------------------- agent loop ---------------------- */

const DEFAULT_MAX_STEPS = 8;

/**
 * Run a single user turn through the agent. Streams tool-call events
 * to onToolCall for UI feedback, then returns the final assistant text
 * plus the transcript.
 */
export async function runAgentTurn({
    apiKey,
    model,
    history = [],
    userMessage,
    maxSteps = DEFAULT_MAX_STEPS,
    onToolCall = null,
    onAssistantText = null,
    systemPrompt = null,
    tools = null,
    temperature = 0.5,
    maxTokens = 1500,
}) {
    if (!apiKey) throw new Error('OpenRouter API key is not set.');
    if (!model) throw new Error('No model configured.');

    const messages = [
        { role: 'system', content: systemPrompt || TAKIR_SYSTEM_PROMPT },
        ...history,
    ];
    if (typeof userMessage === 'string') {
        messages.push({ role: 'user', content: userMessage });
    } else if (userMessage) {
        messages.push(userMessage);
    }

    const transcript = [];
    let finalText = '';

    for (let step = 0; step < maxSteps; step++) {
        if (isDebug()) {
            try { console.debug(`[Takir AI] step ${step + 1}/${maxSteps} (${messages.length} msgs in history)`); } catch { /* ignore */ }
        }
        const result = await chat({
            apiKey, model, messages,
            tools: tools || TOOLS,
            toolChoice: 'auto',
            temperature,
            maxTokens,
        });

        const assistantMsg = {
            role: 'assistant',
            content: result.text || null,
            tool_calls: result.toolCalls && result.toolCalls.length ? result.toolCalls : undefined,
        };
        messages.push(assistantMsg);
        transcript.push(assistantMsg);

        if (result.text) {
            finalText = result.text;
            if (onAssistantText) {
                try { await onAssistantText(result.text); } catch { /* ignore */ }
            }
        }

        if (!result.toolCalls || result.toolCalls.length === 0) break;

        for (const call of result.toolCalls) {
            const name = call?.function?.name;
            const args = parseToolArgs(call);
            const handler = TOOL_HANDLERS[name];
            const record = { name, arguments: args, id: call.id };
            if (isDebug()) {
                try { console.debug(`[Takir AI] tool call: ${name}`, args); } catch { /* ignore */ }
            }
            try {
                const out = handler ? await handler(args) : fail(`Unknown tool: ${name}`, 'unknown_tool');
                record.result = out;
                const content = typeof out === 'string' ? out : JSON.stringify(out);
                messages.push({ role: 'tool', tool_call_id: call.id, content });
                transcript.push({ role: 'tool', tool_call_id: call.id, content });
                if (isDebug()) {
                    try { console.debug(`[Takir AI] tool result: ${name}`, out); } catch { /* ignore */ }
                }
            } catch (e) {
                const err = fail(e.message || String(e), 'exception');
                record.result = err;
                messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(err) });
                transcript.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(err) });
            }
            if (onToolCall) {
                try { await onToolCall(record); } catch { /* ignore */ }
            }
        }
    }

    return { text: finalText, transcript };
}
