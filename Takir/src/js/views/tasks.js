/* ==========================================================
   views/tasks.js
   Quest modal (add/edit) + delete confirm + analyze + progress.
   ========================================================== */

import { el, openModal, closeModal, confirmDialog, success, error, warn, readAttachment } from '../ui.js';
import { store } from '../state.js';
import { toRoman } from '../utils.js';
import { analyzeTask, suggestTaskPlan, reviewProgress, isApiKeyConfigured } from '../api.js';
import { renderTaskSuggestions } from './ai-suggest.js';
import { openSettings } from './settings.js';

export function openAddTaskModal(editId = null) {
    const existing = editId ? store.getTask(editId) : null;
    const isEdit = !!existing;

    const name = el('input', { class: 'form-input', type: 'text', placeholder: 'e.g. Build a portfolio website' });
    const desc = el('textarea', { class: 'form-textarea', rows: 3, placeholder: 'Describe this quest...' });

    if (existing) {
        name.value = existing.name;
        desc.value = existing.description || '';
    }

    const otherTasks = store.getTasks().filter(t => t.id !== editId);
    const prereqChips = el('div', { class: 'tag-list' });
    const selectedPrereqs = new Set(existing?.prerequisites || []);

    function renderPrereqs() {
        prereqChips.innerHTML = '';
        if (selectedPrereqs.size === 0) {
            prereqChips.appendChild(el('p', { class: 'text-faint italic fs-sm' }, 'None.'));
            return;
        }
        for (const id of selectedPrereqs) {
            const t = store.getTask(id);
            if (!t) continue;
            prereqChips.appendChild(el('span', { class: 'tag' }, [
                t.name,
                el('button', {
                    class: 'btn btn-ghost btn-sm',
                    style: 'padding:0 4px;margin-left:4px;',
                    onClick: () => { selectedPrereqs.delete(id); renderPrereqs(); refreshPrereqSelect(); },
                }, '\u2715'),
            ]));
        }
    }

    const prereqSel = el('select', { class: 'form-select' });
    prereqSel.appendChild(el('option', { value: '' }, '+ Add prerequisite quest...'));
    function refreshPrereqSelect() {
        while (prereqSel.children.length > 1) prereqSel.removeChild(prereqSel.lastChild);
        for (const t of otherTasks) {
            if (selectedPrereqs.has(t.id)) continue;
            prereqSel.appendChild(el('option', { value: t.id }, t.name));
        }
    }
    prereqSel.addEventListener('change', () => {
        const v = prereqSel.value;
        if (v) {
            selectedPrereqs.add(v);
            renderPrereqs();
            refreshPrereqSelect();
            prereqSel.value = '';
        }
    });
    renderPrereqs();
    refreshPrereqSelect();

    const prereqBlock = el('div', { class: 'form-group' }, [
        el('label', { class: 'form-label' }, 'Prerequisite Quests'),
        prereqChips,
        el('div', { style: 'margin-top:8px;' }, [prereqSel]),
    ]);

    const requiredSkillsChips = el('div', { class: 'tag-list' });
    const selectedSkills = (existing?.requiredSkills || []).map(rs => ({ ...rs }));

    const skillOpts = store.getSkills();
    const skillSel = el('select', { class: 'form-select' });
    skillSel.appendChild(el('option', { value: '' }, '+ Add required skill...'));
    for (const s of skillOpts) {
        if (selectedSkills.find(x => x.skillId === s.id)) continue;
        skillSel.appendChild(el('option', { value: s.id }, s.name));
    }
    const levelInput = el('input', { class: 'form-input', type: 'number', min: '1', max: '10', value: '1', style: 'width:80px;display:inline-block;margin-left:6px;' });
    skillSel.addEventListener('change', () => {
        if (!skillSel.value) return;
        const lvl = Math.max(1, Math.min(10, parseInt(levelInput.value, 10) || 1));
        selectedSkills.push({ skillId: skillSel.value, level: lvl });
        skillSel.querySelector(`option[value="${skillSel.value}"]`)?.remove();
        skillSel.value = '';
        renderRequired();
    });

    function renderRequired() {
        requiredSkillsChips.innerHTML = '';
        if (selectedSkills.length === 0) {
            requiredSkillsChips.appendChild(el('p', { class: 'text-faint italic fs-sm' }, 'None. (You can let the AI suggest them.)'));
            return;
        }
        for (let i = 0; i < selectedSkills.length; i++) {
            const rs = selectedSkills[i];
            const s = store.getSkill(rs.skillId);
            if (!s) continue;
            const idx = i;
            requiredSkillsChips.appendChild(el('span', { class: 'tag' }, [
                `${s.name} (need ${toRoman(rs.level)})`,
                el('input', {
                    type: 'number', min: '1', max: '10', value: String(rs.level),
                    style: 'width:50px;margin-left:4px;background:var(--bg-deep);border:1px solid var(--border-soft);color:var(--text);border-radius:3px;padding:0 4px;',
                    onChange: (e) => {
                        selectedSkills[idx].level = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1));
                        renderRequired();
                    },
                }),
                el('button', {
                    class: 'btn btn-ghost btn-sm',
                    style: 'padding:0 4px;margin-left:4px;',
                    onClick: () => {
                        selectedSkills.splice(idx, 1);
                        renderRequired();
                        refreshSkillSel();
                    },
                }, '\u2715'),
            ]));
        }
    }
    function refreshSkillSel() {
        while (skillSel.children.length > 1) skillSel.removeChild(skillSel.lastChild);
        for (const s of skillOpts) {
            if (selectedSkills.find(x => x.skillId === s.id)) continue;
            skillSel.appendChild(el('option', { value: s.id }, s.name));
        }
    }
    renderRequired();

    const requiredBlock = el('div', { class: 'form-group' }, [
        el('label', { class: 'form-label' }, 'Required Skills & Levels'),
        requiredSkillsChips,
        el('div', { style: 'margin-top:8px;display:flex;align-items:center;gap:6px;' }, [
            skillSel,
            el('span', { class: 'form-hint', style: 'margin:0;' }, 'min. level:'),
            levelInput,
        ]),
    ]);

    const taskSuggestList = el('div', { class: 'ai-suggest-list' });
    const taskSuggestSpinner = el('div', { class: 'spinner' }, '');
    taskSuggestSpinner.style.display = 'none';
    const taskSuggestBtn = el('button', {
        class: 'btn btn-ghost',
        onClick: async () => {
            const n = name.value.trim();
            if (!n) { error('Name the quest first.'); return; }
            if (!isApiKeyConfigured(store.state)) {
                error('Set your OpenRouter API key in Settings first.');
                return;
            }
            taskSuggestBtn.disabled = true;
            taskSuggestSpinner.style.display = '';
            taskSuggestList.innerHTML = '';
            try {
                const out = await suggestTaskPlan({
                    apiKey: store.state.apiKey,
                    model: store.state.model,
                    taskName: n,
                    description: desc.value.trim(),
                    existingSkills: store.getSkills(),
                    existingTasks: store.getTasks(),
                });
                renderTaskSuggestions(out, taskSuggestList, selectedSkills, (skillId, level) => {
                    if (!selectedSkills.find(x => x.skillId === skillId)) {
                        selectedSkills.push({ skillId, level });
                        renderRequired();
                        refreshSkillSel();
                    }
                });
            } catch (e) {
                error(e.message);
            } finally {
                taskSuggestBtn.disabled = false;
                taskSuggestSpinner.style.display = 'none';
            }
        },
    }, [
        el('span', { class: 'icon', html: '\u2728' }),
        el('span', {}, 'Auto-suggest by AI'),
    ]);
    const taskSuggestBlock = el('div', { class: 'form-group' }, [
        el('label', { class: 'form-label' }, 'AI Requirements'),
        el('div', { class: 'ai-suggest-bar' }, [taskSuggestBtn, taskSuggestSpinner]),
        taskSuggestList,
    ]);

    const body = el('div', {}, [
        el('div', { class: 'form-group' }, [
            el('label', { class: 'form-label' }, 'Quest Name'),
            name,
        ]),
        el('div', { class: 'form-group' }, [
            el('label', { class: 'form-label' }, 'Description'),
            desc,
        ]),
        taskSuggestBlock,
        requiredBlock,
        prereqBlock,
    ]);

    const footerLeft = el('div', { style: 'display:flex;gap:8px;' }, [
        isEdit ? el('button', {
            class: 'btn btn-danger',
            onClick: async () => {
                const yes = await confirmDialog({
                    title: 'Delete Quest?',
                    message: `"${(store.getTask(editId)?.name) || 'This quest'}" will be permanently removed. This cannot be undone.`,
                    confirmLabel: 'Delete',
                    danger: true,
                });
                if (yes) {
                    store.deleteTask(editId);
                    closeModal();
                }
            },
        }, 'Delete') : null,
    ].filter(Boolean));

    const analyzeBtn = el('button', {
        class: 'btn',
        onClick: () => {
            const n = name.value.trim();
            if (!n) { error('Name the quest first.'); return; }
            const created = isEdit
                ? store.updateTask(editId, {
                    name: n,
                    description: desc.value.trim(),
                    prerequisites: Array.from(selectedPrereqs),
                    requiredSkills: selectedSkills.slice(),
                })
                : store.addTask({
                    name: n,
                    description: desc.value.trim(),
                    prerequisites: Array.from(selectedPrereqs),
                    requiredSkills: selectedSkills.slice(),
                });
            if (!isEdit) closeModal();
            analyzeTaskFlow(created.id);
        },
    }, isEdit ? 'Re-analyze with AI' : 'Analyze with AI');

    const saveBtn = el('button', {
        class: 'btn btn-primary',
        onClick: () => {
            const n = name.value.trim();
            if (!n) { error('Name the quest first.'); return; }
            if (isEdit) {
                store.updateTask(editId, {
                    name: n,
                    description: desc.value.trim(),
                    prerequisites: Array.from(selectedPrereqs),
                    requiredSkills: selectedSkills.slice(),
                });
                success('Quest updated.');
            } else {
                store.addTask({
                    name: n,
                    description: desc.value.trim(),
                    prerequisites: Array.from(selectedPrereqs),
                    requiredSkills: selectedSkills.slice(),
                });
                success('Quest created.');
            }
            closeModal();
        },
    }, isEdit ? 'Save Changes' : 'Create Quest');

    const cancelBtn = el('button', { class: 'btn btn-ghost', onClick: closeModal }, 'Cancel');

    openModal({
        title: isEdit ? 'Edit Quest' : 'New Quest',
        body, footer: [footerLeft, analyzeBtn, cancelBtn, saveBtn],
        large: true,
    });
}

export function deleteTaskConfirm(id) {
    const t = store.getTask(id);
    if (!t) return;
    confirmDialog({
        title: 'Delete Quest?',
        message: `"${t.name}" will be permanently removed. This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
    }).then(yes => {
        if (yes) {
            store.deleteTask(id);
            success('Quest deleted.');
        }
    });
}

/* ---------------- Progress submission ---------------- */

export function openProgressModal(taskId) {
    const task = store.getTask(taskId);
    if (!task) return;
    if (!isApiKeyConfigured(store.state)) {
        error('Set your OpenRouter API key in Settings first.');
        openSettings();
        return;
    }

    const ta = el('textarea', {
        class: 'form-textarea',
        rows: 5,
        placeholder: "What did you do? What's working? What's still tricky? Be specific.",
    });

    const fileInput = el('input', { class: 'form-input', type: 'file', accept: 'image/*,video/*' });
    const fileLabel = el('span', { class: 'filename text-faint' }, 'No file attached');
    const thumb = el('div', { class: 'progress-thumb' });
    let attached = null;

    fileInput.addEventListener('change', async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try {
            attached = await readAttachment(f);
            fileLabel.textContent = `${attached.name} (${attached.type})`;
            thumb.innerHTML = '';
            if (attached.type === 'image') {
                thumb.appendChild(el('img', { class: 'attached-thumb', src: attached.dataUrl, alt: attached.name }));
            } else {
                thumb.appendChild(el('video', { class: 'attached-thumb', src: attached.dataUrl, controls: true }));
            }
        } catch (err) {
            error(err.message);
        }
    });

    const reviewArea = el('div', { class: 'progress-review-area' });
    const submitBtn = el('button', {
        class: 'btn btn-primary',
        onClick: async () => {
            const text = ta.value.trim();
            if (!text && !attached) {
                warn('Write some text or attach a file first.');
                return;
            }
            submitBtn.disabled = true;
            reviewArea.innerHTML = '';
            const loading = el('div', { class: 'loading-overlay' }, [
                el('div', { class: 'spinner lg' }),
                el('div', { class: 'loading-text' }, 'Reviewing your progress\u2026'),
            ]);
            reviewArea.appendChild(loading);
            try {
                const out = await reviewProgress({
                    apiKey: store.state.apiKey,
                    model: store.state.model,
                    taskName: task.title || task.name,
                    taskDescription: task.description || '',
                    progressText: text,
                    attachment: attached,
                });
                reviewArea.innerHTML = '';
                reviewArea.appendChild(renderProgressReview(out));
            } catch (e) {
                reviewArea.innerHTML = '';
                reviewArea.appendChild(el('div', { class: 'ai-msg error' }, e.message));
            } finally {
                submitBtn.disabled = false;
            }
        },
    }, 'Get AI Feedback');

    const body = el('div', {}, [
        el('div', { class: 'form-group' }, [
            el('label', { class: 'form-label' }, 'Progress notes'),
            ta,
        ]),
        el('div', { class: 'form-group' }, [
            el('label', { class: 'form-label' }, 'Attachment (image or video)'),
            el('div', { class: 'progress-attach' }, [fileInput, fileLabel]),
            thumb,
        ]),
        el('div', { class: 'form-group' }, [
            el('p', { class: 'form-hint' }, "The AI will give you a verdict, what's working, what to improve, and concrete next steps."),
        ]),
        reviewArea,
    ]);

    const closeBtn = el('button', { class: 'btn btn-ghost', onClick: closeModal }, 'Close');
    openModal({
        title: `Progress: ${task.title || task.name}`,
        body,
        footer: [closeBtn, submitBtn],
        large: true,
    });
}

function renderProgressReview(out) {
    const verdictClass = out.verdict === 'ready to mark complete' ? 'ready'
                       : out.verdict === 'needs more work' ? 'needs-work'
                       : 'on-track';
    return el('div', { class: 'progress-review' }, [
        el('div', {}, [
            el('span', { class: `verdict ${verdictClass}` }, out.verdict || 'feedback'),
        ]),
        out.whatIsWorking ? el('div', { class: 'review-body' }, `What is working: ${out.whatIsWorking}`) : null,
        out.whatToImprove ? el('div', { class: 'review-body' }, `What to improve: ${out.whatToImprove}`) : null,
        (out.nextSteps || []).length ? el('ul', { class: 'review-next' },
            out.nextSteps.map(s => el('li', {}, s))
        ) : null,
        out.encouragement ? el('div', { class: 'review-body', style: 'color:var(--accent-bright);font-style:italic;' }, out.encouragement) : null,
    ].filter(Boolean));
}

/* ---------------- Task analysis flow ---------------- */

export async function analyzeTaskFlow(taskId) {
    const task = store.getTask(taskId);
    if (!task) return;
    if (!isApiKeyConfigured(store.state)) {
        error('Set your OpenRouter API key in Runes first.');
        openSettings();
        return;
    }

    const body = el('div', { class: 'loading-overlay' }, [
        el('div', { class: 'spinner lg' }),
        el('div', { class: 'loading-text' }, 'Analyzing quest\u2026'),
    ]);
    openModal({ title: 'Analyzing', body, footer: [], large: true });

    let analysis;
    try {
        analysis = await analyzeTask({
            apiKey: store.state.apiKey,
            model: store.state.model,
            taskName: task.name,
            description: task.description,
            skills: store.getSkills(),
        });
    } catch (e) {
        error(e.message);
        closeModal();
        return;
    }

    renderAnalysis(task, analysis);
}

function renderAnalysis(task, analysis) {
    const body = el('div', {});

    if (analysis.reasoning) {
        body.appendChild(el('div', { class: 'suggestion-block' }, [
            el('h4', {}, 'Reasoning'),
            el('p', { class: 'text-soft' }, analysis.reasoning),
            analysis.difficulty ? el('p', { class: 'text-faint fs-sm' }, `Difficulty: ${analysis.difficulty}/10`) : null,
        ]));
    }

    const skillsBlock = el('div', { class: 'suggestion-block' }, [
        el('h4', {}, 'Suggested Required Skills'),
    ]);
    if (!analysis.requiredSkills?.length) {
        skillsBlock.appendChild(el('p', { class: 'text-faint italic fs-sm' }, 'None suggested.'));
    } else {
        for (const s of analysis.requiredSkills) {
            const existing = s.existingId ? store.getSkill(s.existingId) : store.getSkills().find(x => x.name.toLowerCase() === (s.name || '').toLowerCase());
            const item = el('div', { class: 'suggestion-item' }, [
                el('div', { class: 'suggestion-item-content' }, [
                    el('div', { class: 'suggestion-item-name' }, `${s.name} \u2014 need ${toRoman(s.level || 1)}`),
                    el('div', { class: 'suggestion-item-meta' }, existing
                        ? `You already know this skill (current: ${toRoman(existing.level || 0)}).`
                        : 'New skill.'),
                ]),
                el('div', { class: 'suggestion-actions' }, [
                    el('button', {
                        class: 'btn btn-sm',
                        onClick: () => {
                            if (existing) {
                                if (!task.requiredSkills.find(rs => rs.skillId === existing.id)) {
                                    store.updateTask(task.id, {
                                        requiredSkills: [...(task.requiredSkills || []), { skillId: existing.id, level: s.level || 1 }],
                                    });
                                }
                                success(`Linked to existing skill: ${existing.name}`);
                            } else {
                                const created = store.addSkill({ name: s.name, description: `Imported from quest analysis: ${task.name}.` });
                                store.updateTask(task.id, {
                                    requiredSkills: [...(task.requiredSkills || []), { skillId: created.id, level: s.level || 1 }],
                                });
                                success(`Skill created: ${created.name}`);
                            }
                        },
                    }, existing ? 'Link' : 'Create'),
                ]),
            ]);
            skillsBlock.appendChild(item);
        }
    }
    body.appendChild(skillsBlock);

    const subBlock = el('div', { class: 'suggestion-block' }, [el('h4', {}, 'Suggested Sub-quests')]);
    if (!analysis.subtasks?.length) {
        subBlock.appendChild(el('p', { class: 'text-faint italic fs-sm' }, 'None suggested.'));
    } else {
        for (const st of analysis.subtasks) {
            subBlock.appendChild(el('div', { class: 'suggestion-item' }, [
                el('div', { class: 'suggestion-item-content' }, [
                    el('div', { class: 'suggestion-item-name' }, st.name),
                    el('div', { class: 'suggestion-item-meta' }, st.description || ''),
                ]),
                el('div', { class: 'suggestion-actions' }, [
                    el('button', {
                        class: 'btn btn-sm',
                        onClick: () => {
                            const created2 = store.addTask({
                                name: st.name,
                                description: st.description || '',
                                prerequisites: [task.id],
                            });
                            store.updateTask(task.id, { subtasks: [...(task.subtasks || []), created2.id] });
                            success(`Sub-quest created: ${created2.name}`);
                        },
                    }, 'Add'),
                ]),
            ]));
        }
    }
    body.appendChild(subBlock);

    const prereqBlock = el('div', { class: 'suggestion-block' }, [el('h4', {}, 'Suggested Prerequisite Quests')]);
    if (!analysis.prerequisites?.length) {
        prereqBlock.appendChild(el('p', { class: 'text-faint italic fs-sm' }, 'None suggested.'));
    } else {
        for (const p of analysis.prerequisites) {
            prereqBlock.appendChild(el('div', { class: 'suggestion-item' }, [
                el('div', { class: 'suggestion-item-content' }, [
                    el('div', { class: 'suggestion-item-name' }, p.name),
                    el('div', { class: 'suggestion-item-meta' }, p.description || ''),
                ]),
                el('div', { class: 'suggestion-actions' }, [
                    el('button', {
                        class: 'btn btn-sm',
                        onClick: () => {
                            const created2 = store.addTask({
                                name: p.name,
                                description: p.description || '',
                            });
                            store.updateTask(task.id, { prerequisites: [...(task.prerequisites || []), created2.id] });
                            success(`Prerequisite created: ${created2.name}`);
                        },
                    }, 'Add'),
                ]),
            ]));
        }
    }
    body.appendChild(prereqBlock);

    const close = el('button', { class: 'btn btn-primary', onClick: closeModal }, 'Done');
    openModal({ title: `Analysis: ${task.name}`, body, footer: [close], large: true });
}
