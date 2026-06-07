/* ==========================================================
   views/skills.js
   Skill modal (add/edit) + delete confirm + quiz flow.
   ========================================================== */

import { el, openModal, closeModal, confirmDialog, success, error, warn, readAttachment } from '../ui.js';
import { store } from '../state.js';
import { toRoman, levelLabel, extractJSON } from '../utils.js';
import { generateSkillQuiz, suggestSkillPrerequisites, chat, isApiKeyConfigured } from '../api.js';
import { renderSkillSuggestions } from './ai-suggest.js';
import { openSettings } from './settings.js';

export function openAddSkillModal(editId = null) {
    const existing = editId ? store.getSkill(editId) : null;
    const isEdit = !!existing;

    const name = el('input', { class: 'form-input', type: 'text', placeholder: 'e.g. Blender 3D Modeling' });
    const desc = el('textarea', { class: 'form-textarea', rows: 3, placeholder: 'Describe this skill...' });

    if (existing) {
        name.value = existing.name;
        desc.value = existing.description || '';
    }

    const prereqSelect = el('div', { class: 'form-group' });
    const otherSkills = store.getSkills().filter(s => s.id !== editId);
    const prereqChips = el('div', { class: 'tag-list' });
    const selected = new Set(existing?.prerequisites || []);

    function renderChips() {
        prereqChips.innerHTML = '';
        if (selected.size === 0) {
            prereqChips.appendChild(el('p', { class: 'text-faint italic fs-sm' }, 'None selected.'));
            return;
        }
        for (const id of selected) {
            const s = store.getSkill(id);
            if (!s) continue;
            prereqChips.appendChild(el('span', { class: 'tag' }, [
                s.name,
                el('button', {
                    class: 'btn btn-ghost btn-sm',
                    style: 'padding:0 4px;margin-left:4px;',
                    onClick: () => { selected.delete(id); renderChips(); },
                }, '\u2715'),
            ]));
        }
    }
    renderChips();

    const prereqAddSel = el('select', { class: 'form-select' });
    prereqAddSel.appendChild(el('option', { value: '' }, '+ Add prerequisite...'));
    for (const s of otherSkills) {
        if (selected.has(s.id)) continue;
        prereqAddSel.appendChild(el('option', { value: s.id }, s.name));
    }
    prereqAddSel.addEventListener('change', () => {
        const v = prereqAddSel.value;
        if (v) {
            selected.add(v);
            prereqAddSel.querySelector(`option[value="${v}"]`)?.remove();
            renderChips();
            prereqAddSel.value = '';
        }
    });
    prereqSelect.appendChild(el('label', { class: 'form-label' }, 'Prerequisites (must be assessed first)'));
    prereqSelect.appendChild(prereqChips);
    prereqSelect.appendChild(el('div', { style: 'margin-top:8px;' }, [prereqAddSel]));

    const suggestList = el('div', { class: 'ai-suggest-list' });
    const suggestSpinner = el('div', { class: 'spinner' }, '');
    suggestSpinner.style.display = 'none';
    const suggestBtn = el('button', {
        class: 'btn btn-ghost',
        onClick: async () => {
            const n = name.value.trim();
            if (!n) { error('Name the skill first.'); return; }
            if (!isApiKeyConfigured(store.state)) {
                error('Set your OpenRouter API key in Settings first.');
                return;
            }
            suggestBtn.disabled = true;
            suggestSpinner.style.display = '';
            suggestList.innerHTML = '';
            try {
                const out = await suggestSkillPrerequisites({
                    apiKey: store.state.apiKey,
                    model: store.state.model,
                    skillName: n,
                    description: desc.value.trim(),
                    existingSkills: store.getSkills(),
                });
                renderSkillSuggestions(out, suggestList, selected, renderChips, prereqAddSel);
            } catch (e) {
                error(e.message);
            } finally {
                suggestBtn.disabled = false;
                suggestSpinner.style.display = 'none';
            }
        },
    }, [
        el('span', { class: 'icon', html: '\u2728' }),
        el('span', {}, 'Auto-suggest by AI'),
    ]);
    const suggestBlock = el('div', { class: 'form-group' }, [
        el('label', { class: 'form-label' }, 'AI Requirements'),
        el('div', { class: 'ai-suggest-bar' }, [suggestBtn, suggestSpinner]),
        suggestList,
    ]);

    const body = el('div', {}, [
        el('div', { class: 'form-group' }, [
            el('label', { class: 'form-label' }, 'Skill Name'),
            name,
        ]),
        el('div', { class: 'form-group' }, [
            el('label', { class: 'form-label' }, 'Description'),
            desc,
        ]),
        suggestBlock,
        prereqSelect,
    ]);

    const saveBtn = el('button', {
        class: 'btn btn-primary',
        onClick: () => {
            const n = name.value.trim();
            if (!n) { error('Give the skill a name.'); return; }
            if (isEdit) {
                store.updateSkill(editId, {
                    name: n,
                    description: desc.value.trim(),
                    prerequisites: Array.from(selected),
                });
                success('Skill updated.');
            } else {
                const created = store.addSkill({
                    name: n,
                    description: desc.value.trim(),
                    prerequisites: Array.from(selected),
                });
                success('Skill created! Starting assessment\u2026');
                closeModal();
                if (isApiKeyConfigured(store.state)) {
                    setTimeout(() => startQuiz(created.id), 250);
                } else {
                    warn('Set your OpenRouter API key in Settings before taking the assessment.');
                }
                return;
            }
            closeModal();
        },
    }, isEdit ? 'Save Changes' : 'Create Skill');

    const cancelBtn = el('button', { class: 'btn btn-ghost', onClick: closeModal }, 'Cancel');
    const deleteBtn = isEdit ? el('button', {
        class: 'btn btn-danger',
        onClick: async () => {
            const yes = await confirmDialog({
                title: 'Delete Skill?',
                message: `"${(store.getSkill(editId)?.name) || 'This skill'}" will be permanently removed. This cannot be undone.`,
                confirmLabel: 'Delete',
                danger: true,
            });
            if (yes) {
                store.deleteSkill(editId);
                closeModal();
            }
        },
    }, 'Delete') : null;

    openModal({
        title: isEdit ? 'Edit Skill' : 'New Skill',
        body,
        footer: [deleteBtn, cancelBtn, saveBtn].filter(Boolean),
    });
}

export function deleteSkillConfirm(id) {
    const s = store.getSkill(id);
    if (!s) return;
    confirmDialog({
        title: 'Delete Skill?',
        message: `"${s.name}" will be permanently removed. This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
    }).then(yes => {
        if (yes) {
            store.deleteSkill(id);
            success('Skill deleted.');
        }
    });
}

/* ---------------- Quiz flow ---------------- */

export async function startQuiz(skillId) {
    const skill = store.getSkill(skillId);
    if (!skill) return;
    if (!isApiKeyConfigured(store.state)) {
        error('Set your OpenRouter API key in Runes first.');
        openSettings();
        return;
    }

    const body = el('div', {});
    body.appendChild(el('div', { class: 'loading-overlay' }, [
        el('div', { class: 'spinner lg' }),
        el('div', { class: 'loading-text' }, 'Generating assessment\u2026'),
    ]));

    openModal({
        title: `Assessment: ${skill.name}`,
        body,
        footer: [],
        large: true,
    });

    let quiz;
    try {
        quiz = await generateSkillQuiz({
            apiKey: store.state.apiKey,
            model: store.state.model,
            skillName: skill.name,
            description: skill.description,
            attachments: [],
        });
    } catch (e) {
        // The AI helper has already logged the raw response to the
        // console as [Takir AI] (regardless of the debug toggle), so
        // give the user a clear, actionable message here.
        try {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn(`[Takir] Quiz generation failed for "${skill.name}":`, e.message);
            }
        } catch { /* ignore */ }
        error(`Couldn't generate the assessment: ${e.message}`);
        closeModal();
        return;
    }

    if (!quiz || !Array.isArray(quiz.questions) || quiz.questions.length === 0) {
        try {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn(`[Takir] generateSkillQuiz returned an empty quiz for "${skill.name}"`);
            }
        } catch { /* ignore */ }
        error('The AI returned an empty assessment. Please try again.');
        closeModal();
        return;
    }

    store.setSkillQuiz(skillId, { questions: quiz.questions, takenAt: null, level: 0 });
    renderQuiz(skill, quiz);
}

function renderQuiz(skill, quiz) {
    const state = {
        index: 0,
        answers: new Array(quiz.questions.length).fill(null),
    };
    const DONT_KNOW = { __idontknow: true };

    const body = el('div', {});
    const footer = el('div', {});

    function render() {
        body.innerHTML = '';
        footer.innerHTML = '';

        const q = quiz.questions[state.index];
        const progressFill = el('div', { class: 'quiz-progress-fill' });
        progressFill.style.width = `${((state.index + 1) / quiz.questions.length) * 100}%`;

        const current = state.answers[state.index];
        const isDontKnow = current && typeof current === 'object' && current.__idontknow;

        body.appendChild(el('div', { class: 'quiz-progress' }, [
            el('span', {}, `Question ${state.index + 1} of ${quiz.questions.length}`),
            el('div', { class: 'quiz-progress-bar' }, [progressFill]),
            el('span', {}, `Difficulty: ${q.difficulty || '?'}/10`),
        ]));

        const block = el('div', { class: `quiz-question ${isDontKnow ? 'skipped' : ''}` });
        block.appendChild(el('h3', { class: 'quiz-question-text' }, q.question || ''));
        block.appendChild(el('div', { class: 'quiz-difficulty' }, q.type === 'image'
            ? `Image-based question \u2014 attach an image, video, or written description.`
            : q.type === 'free-text' ? 'Free-response question.' : 'Choose the most correct answer.'));

        if (q.imagePrompt && q.type === 'image') {
            block.appendChild(el('div', { class: 'quiz-media' }, [
                el('p', { class: 'text-faint italic fs-sm' }, q.imagePrompt),
            ]));
        }

        if (isDontKnow) {
            block.appendChild(el('div', { class: 'quiz-skip-banner' }, [
                el('span', {}, 'You marked this as "I don\'t know".'),
                el('button', {
                    class: 'btn btn-ghost btn-sm',
                    onClick: () => { state.answers[state.index] = null; render(); },
                }, 'Answer instead'),
            ]));
        } else if (q.type === 'multiple-choice') {
            const opts = el('div', { class: 'quiz-options' });
            for (const opt of (q.options || [])) {
                const letter = opt.split(/[:.\s]/)[0].trim().toUpperCase().slice(0, 1) || opt.trim().slice(0, 1).toUpperCase();
                const input = el('input', { type: 'radio', name: `q-${state.index}`, value: letter });
                if (current === letter) input.checked = true;
                const lbl = el('label', { class: `quiz-option ${current === letter ? 'selected' : ''}` }, [
                    input,
                    el('span', {}, opt),
                ]);
                input.addEventListener('change', () => {
                    state.answers[state.index] = letter;
                    opts.querySelectorAll('.quiz-option').forEach(o => o.classList.remove('selected'));
                    lbl.classList.add('selected');
                });
                opts.appendChild(lbl);
            }
            block.appendChild(opts);
        } else {
            const ta = el('textarea', {
                class: 'quiz-textarea',
                rows: q.type === 'image' ? 3 : 4,
                placeholder: q.type === 'image' ? 'Describe what you see, or upload an image/video below...' : 'Type your answer here...',
            });
            ta.value = (current && typeof current === 'object') ? (current.text || '') : '';
            ta.addEventListener('input', () => {
                state.answers[state.index] = { text: ta.value };
            });
            block.appendChild(ta);

            if (q.type === 'image') {
                const fileInput = el('input', { class: 'form-input', type: 'file', accept: 'image/*,video/*' });
                fileInput.addEventListener('change', async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                        const att = await readAttachment(f);
                        state.answers[state.index] = { ...(state.answers[state.index] || {}), image: att };
                        block.querySelector('.attached-preview')?.remove();
                        const preview = el('div', { class: 'attached-preview quiz-media' }, [
                            att.type === 'video'
                                ? el('video', { src: att.dataUrl, controls: true, style: 'max-height:160px;' })
                                : el('img', { src: att.dataUrl, alt: att.name, style: 'max-height:160px;' }),
                        ]);
                        block.appendChild(preview);
                    } catch (err) { error(err.message); }
                });
                block.appendChild(el('div', { style: 'margin-top:8px;' }, [
                    el('label', { class: 'form-label' }, 'Attach image or video (optional)'),
                    fileInput,
                ]));
            }
        }

        body.appendChild(block);

        if (state.index > 0) {
            footer.appendChild(el('button', {
                class: 'btn btn-ghost',
                onClick: () => { state.index--; render(); },
            }, 'Previous'));
        } else {
            footer.appendChild(el('span'));
        }

        const isLast = state.index >= quiz.questions.length - 1;
        if (!isLast) {
            footer.appendChild(el('button', {
                class: 'btn btn-ghost',
                onClick: () => {
                    state.answers[state.index] = DONT_KNOW;
                    state.index++;
                    render();
                },
            }, "I don't know"));
        }

        if (isLast) {
            footer.appendChild(el('button', {
                class: 'btn btn-primary',
                onClick: () => submitQuiz(skill, quiz, state.answers, DONT_KNOW),
            }, 'Submit Trial'));
        } else {
            footer.appendChild(el('button', {
                class: 'btn btn-primary',
                onClick: () => {
                    if (!validateAnswer(q, state.answers[state.index])) {
                        warn('Please answer, or click "I don\'t know" to skip.');
                        return;
                    }
                    state.index++;
                    render();
                },
            }, 'Next'));
        }
    }

    function validateAnswer(q, a) {
        if (a && typeof a === 'object' && a.__idontknow) return true;
        if (q.type === 'multiple-choice') return !!a;
        if (q.type === 'free-text') return a && typeof a === 'object' && (a.text || '').trim().length > 0;
        if (q.type === 'image') return a && (a.text || a.image);
        return true;
    }

    render();
}

async function submitQuiz(skill, quiz, answers, DONT_KNOW) {
    const body = el('div', { class: 'loading-overlay' }, [
        el('div', { class: 'spinner lg' }),
        el('div', { class: 'loading-text' }, 'Scoring your answers\u2026'),
    ]);
    openModal({ title: 'Scoring', body, footer: [], large: true });

    const payload = answers.map((a, i) => {
        const q = quiz.questions[i];
        if (a && typeof a === 'object' && a.__idontknow) {
            return { questionId: q.id, type: q.type, answer: "[I don't know]", skipped: true };
        }
        if (q.type === 'image' && a?.image?.dataUrl) {
            return { questionId: q.id, type: 'image', text: a.text || '', hasImage: true };
        }
        return { questionId: q.id, type: q.type, answer: a?.text ?? a };
    });

    const userText = `Skill: "${skill.name}"
Score the following answers and return JSON only.

Quiz:
${JSON.stringify(quiz, null, 2)}

Answers (questions with "hasImage": true have an attached image in the next content parts - inspect them too):
${JSON.stringify(payload, null, 2)}

Return JSON of the form:
{
  "perQuestion": [{ "id": "q1", "score": 0.0, "maxScore": 1.0, "isCorrect": true, "feedback": "string" }],
  "totalScore": 0.0,
  "maxTotal": 10.0,
  "level": 5,
  "reasoning": "string",
  "strengths": ["..."],
  "weaknesses": ["..."]
}`;

    const imageAnswers = answers.filter(a => a?.image?.dataUrl);

    const messages = [
        { role: 'system', content: 'You are a quiz evaluator. Output ONLY valid JSON.' },
    ];
    const userContent = [{ type: 'text', text: userText }];
    for (const a of imageAnswers) {
        userContent.push({ type: 'image_url', image_url: { url: a.image.dataUrl } });
    }
    messages.push({ role: 'user', content: userContent });

    let scored;
    try {
        const res = await chat({
            apiKey: store.state.apiKey,
            model: store.state.model,
            messages,
            temperature: 0.3,
            maxTokens: 1500,
        });
        const json = extractJSON(res.text);
        if (!json || typeof json.level !== 'number') throw new Error('Could not parse the AI score.');
        scored = json;
    } catch (e) {
        error(e.message);
        closeModal();
        return;
    }

    const finalLevel = Math.max(1, Math.min(10, Math.round(scored.level)));
    const skippedSet = new Set(
        answers
            .map((a, i) => (a && typeof a === 'object' && a.__idontknow) ? (quiz.questions[i]?.id) : null)
            .filter(Boolean)
    );
    const perQuestion = (scored.perQuestion || []).map(pq => {
        if (skippedSet.has(pq.id)) {
            return { ...pq, score: 0, maxScore: pq.maxScore || 1, isCorrect: false, feedback: 'Skipped: you marked this as "I don\'t know".' };
        }
        return pq;
    });
    const record = {
        questions: quiz.questions,
        answers,
        perQuestion,
        totalScore: perQuestion.reduce((s, p) => s + (p.score || 0), 0),
        maxTotal: perQuestion.reduce((s, p) => s + (p.maxScore || 1), 0) || 10,
        level: finalLevel,
        reasoning: scored.reasoning || '',
        strengths: scored.strengths || [],
        weaknesses: scored.weaknesses || [],
        skippedCount: skippedSet.size,
        takenAt: new Date().toISOString(),
    };
    store.setSkillQuiz(skill.id, record);
    renderQuizResult(skill, record);
}

function renderQuizResult(skill, record) {
    const body = el('div', { class: 'quiz-result' });

    body.appendChild(el('div', { class: 'quiz-result-roman', dataset: { level: String(record.level) } }, toRoman(record.level)));
    body.appendChild(el('h2', { class: 'quiz-result-title' }, levelLabel(record.level)));
    body.appendChild(el('p', { class: 'quiz-result-reasoning' }, record.reasoning || ''));
    body.appendChild(el('div', { class: 'quiz-result-score' }, `Score: ${(record.totalScore || 0).toFixed(1)} / ${(record.maxTotal || 10).toFixed(1)}`));

    if (record.strengths?.length) {
        body.appendChild(el('div', { class: 'suggestion-block' }, [
            el('h4', {}, 'Strengths'),
            el('ul', { style: 'margin:0;padding-left:18px;color:var(--text-soft);' },
                record.strengths.map(s => el('li', {}, s))),
        ]));
    }
    if (record.weaknesses?.length) {
        body.appendChild(el('div', { class: 'suggestion-block' }, [
            el('h4', {}, 'Areas to Train'),
            el('ul', { style: 'margin:0;padding-left:18px;color:var(--text-soft);' },
                record.weaknesses.map(s => el('li', {}, s))),
        ]));
    }

    const detail = el('details', { class: 'suggestion-block' }, [
        el('summary', { style: 'cursor:pointer;color:var(--gold);' }, 'Show per-question feedback'),
    ]);
    const list = el('div', {});
    for (const pq of (record.perQuestion || [])) {
        const q = record.questions.find(x => x.id === pq.id) || record.questions[record.perQuestion.indexOf(pq)];
        list.appendChild(el('div', { class: 'suggestion-item' }, [
            el('div', { class: 'suggestion-item-content' }, [
                el('div', { class: 'suggestion-item-name' }, q?.question || pq.id),
                el('div', { class: 'suggestion-item-meta' }, pq.feedback || ''),
            ]),
            el('div', { class: 'suggestion-actions' }, [
                pq.feedback?.startsWith('Skipped:')
                    ? el('span', { class: 'tag skipped' }, 'Skipped')
                    : el('span', { class: `tag ${pq.isCorrect ? 'met' : 'unmet'}` }, `${(pq.score || 0).toFixed(1)} / ${(pq.maxScore || 1).toFixed(1)}`),
            ]),
        ]));
    }
    detail.appendChild(list);
    body.appendChild(detail);

    const close = el('button', { class: 'btn btn-primary btn-block', onClick: closeModal }, 'Done');
    const retake = el('button', {
        class: 'btn btn-ghost btn-block', style: 'margin-top:8px;',
        onClick: () => startQuiz(skill.id),
    }, 'Re-take Assessment');

    openModal({
        title: `Result: ${skill.name}`,
        body,
        footer: [retake, close],
        large: true,
    });
}
