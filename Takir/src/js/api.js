/* ==========================================================
   api.js
   Thin client over OpenRouter's chat-completions API.
   Supports text + image inputs (vision). Falls back to text
   for non-image attachments.
   ========================================================== */

import { extractJSON } from './utils.js';
import { store } from './state.js';

function isDebug() {
    try { return !!(store && store.state && store.state.aiDebug); }
    catch { return false; }
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 120_000;

function trimTrailingSlash(s) { return (s || '').replace(/\/+$/, ''); }

export function isApiKeyConfigured(state) {
    return !!(state?.apiKey && state.apiKey.length >= 10);
}

function buildHeaders(apiKey) {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://takir.local',
        'X-Title': 'Takir',
    };
}

/* ---------------- core call ---------------- */

export async function chat({
    apiKey,
    model,
    messages,
    tools,           // optional array of OpenRouter tool definitions
    toolChoice,      // optional 'auto' | 'required' | 'none' | { type: 'function', function: { name } }
    temperature = 0.6,
    maxTokens = 1500,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    responseFormat, // optional { type: 'json_object' } if supported
}) {
    if (!apiKey) throw new Error('OpenRouter API key is not set. Open Runes (settings) to set it.');
    if (!model) throw new Error('No model configured.');

    const body = {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
    };
    if (responseFormat) body.response_format = responseFormat;
    if (Array.isArray(tools) && tools.length > 0) body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;

    // Debug logging (toggle via store.state.aiDebug)
    if (isDebug()) {
        try {
            const loggedBody = { ...body };
            if (loggedBody.messages) {
                loggedBody.messages = loggedBody.messages.map(m => {
                    if (Array.isArray(m.content)) {
                        return { ...m, content: m.content.map(c => c.type === 'image_url' ? { ...c, image_url: { url: '[image data omitted for log]' } } : c) };
                    }
                    return m;
                });
            }
            console.debug('[Takir AI] → request', loggedBody);
        } catch { /* ignore */ }
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    let res;
    try {
        res = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: buildHeaders(apiKey),
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('The AI did not answer in time. Try again.');
        throw new Error(`Network error: ${e.message || e}`);
    } finally {
        clearTimeout(timer);
    }

    let payload;
    try { payload = await res.json(); } catch { /* may be empty */ }

    if (!res.ok) {
        const msg = payload?.error?.message
            || payload?.message
            || res.statusText
            || `HTTP ${res.status}`;
        throw new Error(`OpenRouter error (${res.status}): ${msg}`);
    }

    const choice = payload?.choices?.[0];
    const message = choice?.message || {};
    const text = message.content ?? '';
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!text && toolCalls.length === 0 && !choice) {
        throw new Error('The AI returned no response. Check your model name and try again.');
    }

    if (isDebug()) {
        try {
            console.debug('[Takir AI] ← response', { text, toolCalls, usage: payload?.usage, model: payload?.model });
        } catch { /* ignore */ }
    }
    return { text, toolCalls, raw: payload };
}

/* ---------------- content helpers ---------------- */

/**
 * Build a user message that can include both text and image attachments.
 * Attachments is an array of { type: 'image' | 'video' | 'file', dataUrl, mime, name }
 * OpenRouter/vision models support image_url content parts.
 */
export function buildUserMessage(text, attachments = []) {
    const parts = [];
    if (text) parts.push({ type: 'text', text });
    for (const a of attachments || []) {
        if (!a || !a.dataUrl) continue;
        if (a.type === 'image') {
            parts.push({
                type: 'image_url',
                image_url: { url: a.dataUrl },
            });
        } else if (a.type === 'video') {
            // Most chat models don't accept video directly; convert to a note.
            parts.push({
                type: 'text',
                text: `[Video attached: ${a.name || 'untitled'} (${a.mime || 'video'}). The model can analyze the description only.]`,
            });
        } else {
            parts.push({
                type: 'text',
                text: `[File attached: ${a.name || 'untitled'} (${a.mime || 'file'}).]`,
            });
        }
    }
    return { role: 'user', content: parts };
}

export function textMessage(text) {
    return { role: 'user', content: text };
}

export function systemMessage(text) {
    return { role: 'system', content: text };
}

/* ---------------- domain prompts ---------------- */

const SKILL_QUIZ_SYSTEM = `You are an assessment designer. Your job is to assess someone's skill in a given area by producing a 10-question quiz that ranges from very easy to extremely difficult, so the level of mastery can be measured on a scale of I (Novice) to X (Legend).

Rules:
- Questions must be appropriate for the skill topic.
- Mix question types: multiple-choice, free-text, and image-based where useful.
- For "image" type questions: the user will attach images and/or videos from their device to the question. YOU DO NOT generate, depict, or render any image. In the "imagePrompt" field, just give a short note that tells the user what to attach (e.g. "Attach a photo of your finished work" or "Attach a short clip of you performing the task"). The actual image/video comes from the user at answer time, not from you.
- Difficulty must ascend across the questions; rate each from 1 (easiest) to 10 (hardest).
- Each question must include a "correctAnswer" string (the option letter for multiple-choice, the canonical text for free-response). Include an "explanation" and a "keyPoints" array of grading notes for free-response.
- For multiple-choice, provide exactly 4 distinct options labeled "A", "B", "C", "D".
- Output ONLY valid JSON matching the schema, with no prose before or after.`;

const SKILL_QUIZ_SCHEMA = `{
  "title": "string - the assessment name",
  "questions": [
    {
      "id": "q1",
      "type": "multiple-choice" | "free-text" | "image",
      "question": "string",
      "options": ["A: ...", "B: ...", "C: ...", "D: ..."],   // omit for non-MCQ
      "correctAnswer": "string",
      "explanation": "string",
      "keyPoints": ["..."],                                 // for free-text grading
      "imagePrompt": "string",                              // for image questions
      "difficulty": 1
    }
  ]
}`;

export async function generateSkillQuiz({ apiKey, model, skillName, description, attachments }) {
    const userText = `Create an assessment quiz for the skill: "${skillName}".
Description: ${description || '(none)'}

Use extra context from any attached materials when relevant.

Return JSON exactly matching this schema:
${SKILL_QUIZ_SCHEMA}`;

    const messages = [
        systemMessage(SKILL_QUIZ_SYSTEM),
        buildUserMessage(userText, attachments),
    ];

    const { text } = await chat({ apiKey, model, messages, temperature: 0.5, maxTokens: 2400 });
    return parseQuizResponse(text);
}

function parseQuizResponse(text) {
    const json = extractJSON(text);
    if (!json || !Array.isArray(json.questions)) {
        throw new Error('The AI did not return a valid quiz. Please try again.');
    }
    return json;
}

const SKILL_SCORE_SYSTEM = `You are a quiz evaluator. Evaluate each answer for correctness and depth, considering difficulty weighting. Output ONLY valid JSON.`;

export async function scoreSkillQuiz({ apiKey, model, skillName, quiz, answers }) {
    const prompt = `Skill: "${skillName}"
Score the following answers and determine a final level from 1 to 10.

Quiz:
${JSON.stringify(quiz, null, 2)}

Answers (in order of question id):
${JSON.stringify(answers, null, 2)}

Return JSON of the form:
{
  "perQuestion": [
    { "id": "q1", "score": 0.0, "maxScore": 1.0, "isCorrect": true, "feedback": "string" }
  ],
  "totalScore": 0.0,
  "maxTotal": 10.0,
  "level": 5,            // integer 1-10
  "reasoning": "string", // 1-3 sentences
  "strengths": ["..."],
  "weaknesses": ["..."]
}`;

    const { text } = await chat({
        apiKey, model,
        messages: [systemMessage(SKILL_SCORE_SYSTEM), textMessage(prompt)],
        temperature: 0.3, maxTokens: 1500,
    });
    const json = extractJSON(text);
    if (!json || typeof json.level !== 'number') {
        throw new Error('The AI did not return a valid score. Please try again.');
    }
    return json;
}

const TASK_ANALYZE_SYSTEM = `You are a planning assistant. Analyze the given task and recommend the skills, subtasks, and prerequisite tasks required. Output ONLY valid JSON.`;

export async function analyzeTask({ apiKey, model, taskName, description, skills }) {
    const skillsList = skills
        .map(s => ({ id: s.id, name: s.name, level: s.level }))
        .map(s => `  - id: ${s.id}, name: "${s.name}", currentLevel: ${s.level}`)
        .join('\n');

    const prompt = `Analyze this task: "${taskName}"
Description: ${description || '(none)'}

Known skills (with current assessed level, 0 = unassessed):
${skillsList || '  (none yet)'}

Determine:
1. requiredSkills: which skills (by id from the list above, or by proposed name if not present) and minimum level (1-10) needed. Use the existing id when the skill exists.
2. subtasks: smaller pieces of the same task (each with name and 1-2 sentence description).
3. prerequisites: any prerequisite tasks (each with name and 1-2 sentence description) that should be completed first.
4. difficulty: 1 (trivial) to 10 (legendary).
5. reasoning: 1-3 sentences explaining the suggestion.

Return JSON of the form:
{
  "requiredSkills": [
    { "name": "string", "level": 1, "existingId": "string|null" }
  ],
  "subtasks": [
    { "name": "string", "description": "string" }
  ],
  "prerequisites": [
    { "name": "string", "description": "string" }
  ],
  "difficulty": 5,
  "reasoning": "string"
}`;

    const { text } = await chat({
        apiKey, model,
        messages: [systemMessage(TASK_ANALYZE_SYSTEM), textMessage(prompt)],
        temperature: 0.5, maxTokens: 1800,
    });
    const json = extractJSON(text);
    if (!json) throw new Error('The AI did not return a valid task analysis. Please try again.');
    return json;
}

/* ---------------- unsaved-item suggestions ----------------
   Used by the add-skill and add-task modals to auto-suggest
   prerequisites BEFORE the item is created.
*/

const SKILL_PREREQ_SYSTEM = `You are a learning designer. Given a new skill the user wants to track, suggest the prerequisite skills someone would need first, with a target level (1-10) for each. Consider only the skill domain itself, not the user's existing skills. Output ONLY valid JSON.`;

export async function suggestSkillPrerequisites({ apiKey, model, skillName, description, existingSkills }) {
    const skillsList = existingSkills
        .map(s => `  - id: ${s.id}, name: "${s.name}", currentLevel: ${s.level || 0}`)
        .join('\n');
    const prompt = `Suggest prerequisite skills for this new skill: "${skillName}"
Description: ${description || '(none)'}

Existing skills in the user's Takir (for reference, so you can match by id when the prereq already exists):
${skillsList || '  (none)'}

Return JSON of the form:
{
  "suggested": [
    { "name": "string", "level": 1, "existingId": "string|null", "reason": "1 short sentence" }
  ],
  "reasoning": "1-2 sentences overall"
}
Use existingId when the prerequisite is already in the user's list. Only include real, defensible prerequisites.`;

    const { text } = await chat({
        apiKey, model,
        messages: [systemMessage(SKILL_PREREQ_SYSTEM), textMessage(prompt)],
        temperature: 0.5, maxTokens: 1200,
    });
    const json = extractJSON(text);
    if (!json || !Array.isArray(json.suggested)) {
        throw new Error('The AI did not return valid skill suggestions. Please try again.');
    }
    return json;
}

const TASK_PLAN_SYSTEM = `You are a project planner. Given a new quest/task, suggest the required skills (with target levels), subtasks, and prerequisite tasks. Consider only the quest itself, not the user's existing data. Output ONLY valid JSON.`;

export async function suggestTaskPlan({ apiKey, model, taskName, description, existingSkills, existingTasks }) {
    const skillsList = existingSkills
        .map(s => `  - skill id: ${s.id}, name: "${s.name}", currentLevel: ${s.level || 0}`)
        .join('\n');
    const tasksList = existingTasks
        .map(t => `  - task id: ${t.id}, title: "${t.title || t.name}"`)
        .join('\n');
    const prompt = `Suggest a plan for this new quest: "${taskName}"
Description: ${description || '(none)'}

Existing skills (for reference, match by id when possible):
${skillsList || '  (none)'}

Existing tasks (for reference):
${tasksList || '  (none)'}

Return JSON of the form:
{
  "requiredSkills": [
    { "name": "string", "level": 1, "existingId": "string|null", "reason": "1 short sentence" }
  ],
  "subtasks": [
    { "name": "string", "description": "string" }
  ],
  "prerequisites": [
    { "name": "string", "description": "string" }
  ],
  "difficulty": 5,
  "reasoning": "1-2 sentences"
}
Use existingId when the skill already exists. Only include real, defensible suggestions.`;

    const { text } = await chat({
        apiKey, model,
        messages: [systemMessage(TASK_PLAN_SYSTEM), textMessage(prompt)],
        temperature: 0.5, maxTokens: 1800,
    });
    const json = extractJSON(text);
    if (!json) {
        throw new Error('The AI did not return a valid quest plan. Please try again.');
    }
    return json;
}

const PROGRESS_REVIEW_SYSTEM = `You are a thoughtful coach. The user is sharing progress on a quest (text, image, or video). Give concrete, encouraging feedback in plain language.

Cover:
- what is going well
- what looks off or could be improved
- concrete next steps (1-3 bullets)
- an honest readiness verdict: "on track", "needs more work", or "ready to mark complete"

Output ONLY valid JSON.`;

export async function reviewProgress({ apiKey, model, taskName, taskDescription, progressText, attachment }) {
    const parts = [];
    if (progressText) parts.push({ type: 'text', text: progressText });
    if (attachment && attachment.dataUrl) {
        if (attachment.type === 'image') {
            parts.push({ type: 'image_url', image_url: { url: attachment.dataUrl } });
        } else if (attachment.type === 'video') {
            parts.push({ type: 'text', text: `[Video attached: ${attachment.name || 'untitled'}. The model can analyze the description and any frames implied by your text only.]` });
        }
    }

    const userText = `Quest: "${taskName}"
Description: ${taskDescription || '(none)'}

The user has submitted this progress update${attachment ? ` (with a ${attachment.type} attached)` : ''}:

${progressText || '(no text provided)'}

Give your feedback as JSON of the form:
{
  "verdict": "on track" | "needs more work" | "ready to mark complete",
  "whatIsWorking": "1-3 sentences",
  "whatToImprove": "1-3 sentences, or empty string if none",
  "nextSteps": ["...", "...", "..."],
  "encouragement": "1 short sentence"
}`;

    const messages = [
        systemMessage(PROGRESS_REVIEW_SYSTEM),
        { role: 'user', content: parts.length ? [...parts, { type: 'text', text: userText }] : userText },
    ];

    const { text } = await chat({
        apiKey, model, messages,
        temperature: 0.5, maxTokens: 1200,
    });
    const json = extractJSON(text);
    if (!json || !json.verdict) {
        throw new Error('The AI did not return a valid progress review. Please try again.');
    }
    return json;
}
