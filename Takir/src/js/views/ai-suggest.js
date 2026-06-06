/* ==========================================================
   views/ai-suggest.js
   Renderers for AI requirement auto-suggestion cards.
   ========================================================== */

import { el } from '../ui.js';
import { store } from '../state.js';
import { toRoman } from '../utils.js';

export function renderSkillSuggestions(out, container, selectedSet, rerenderChips, prereqAddSel) {
    container.innerHTML = '';
    const suggested = (out && out.suggested) || [];
    if (!suggested.length) {
        container.appendChild(el('p', { class: 'text-soft fs-sm' }, 'The AI did not suggest any prerequisites.'));
        return;
    }
    container.appendChild(el('p', { class: 'text-faint fs-sm' }, out.reasoning || ''));
    for (const s of suggested) {
        const isExisting = !!s.existingId;
        const alreadyAdded = isExisting && selectedSet.has(s.existingId);
        const card = el('div', { class: `ai-suggest-item ${alreadyAdded ? 'applied' : ''}` }, [
            el('div', { class: 'ai-suggest-item-name' }, [
                s.name,
                isExisting
                    ? el('span', { class: 'ai-suggest-badge existing' }, 'existing')
                    : el('span', { class: 'ai-suggest-badge new' }, 'new skill'),
            ]),
            el('div', { class: 'ai-suggest-item-meta' }, `level ${toRoman(s.level)}${s.reason ? ' \u2014 ' + s.reason : ''}`),
            el('div', { class: 'ai-suggest-item-actions' }, [
                alreadyAdded
                    ? el('span', { class: 'text-faint fs-sm' }, 'Added')
                    : el('button', {
                        class: 'btn btn-sm',
                        onClick: () => {
                            if (isExisting) {
                                selectedSet.add(s.existingId);
                                const opt = prereqAddSel.querySelector(`option[value="${s.existingId}"]`);
                                if (opt) opt.remove();
                                rerenderChips();
                            } else {
                                const created = store.addSkill({ name: s.name, description: '', prerequisites: [] });
                                if (s.level) store.updateSkill(created.id, { level: s.level });
                                selectedSet.add(created.id);
                                rerenderChips();
                                prereqAddSel.appendChild(el('option', { value: created.id }, created.name));
                            }
                            card.classList.add('applied');
                            const actions = card.querySelector('.ai-suggest-item-actions');
                            if (actions) actions.innerHTML = '';
                            actions?.appendChild(el('span', { class: 'text-faint fs-sm' }, 'Added'));
                        },
                    }, 'Apply'),
            ]),
        ]);
        container.appendChild(card);
    }
}

export function renderTaskSuggestions(out, container, selectedSkillsArr, onApplySkill) {
    container.innerHTML = '';
    const skills = (out && out.requiredSkills) || [];
    if (out?.reasoning) {
        container.appendChild(el('p', { class: 'text-faint fs-sm' }, out.reasoning));
    }
    if (!skills.length) {
        container.appendChild(el('p', { class: 'text-soft fs-sm' }, 'The AI did not suggest any required skills.'));
        return;
    }
    for (const s of skills) {
        const isExisting = !!s.existingId;
        const alreadyAdded = isExisting && selectedSkillsArr.some(x => x.skillId === s.existingId);
        const card = el('div', { class: `ai-suggest-item ${alreadyAdded ? 'applied' : ''}` }, [
            el('div', { class: 'ai-suggest-item-name' }, [
                s.name,
                isExisting
                    ? el('span', { class: 'ai-suggest-badge existing' }, 'existing')
                    : el('span', { class: 'ai-suggest-badge new' }, 'new skill'),
            ]),
            el('div', { class: 'ai-suggest-item-meta' }, `level ${toRoman(s.level)}${s.reason ? ' \u2014 ' + s.reason : ''}`),
            el('div', { class: 'ai-suggest-item-actions' }, [
                alreadyAdded
                    ? el('span', { class: 'text-faint fs-sm' }, 'Added')
                    : el('button', {
                        class: 'btn btn-sm',
                        onClick: () => {
                            let skillId = s.existingId;
                            if (!isExisting) {
                                const created = store.addSkill({ name: s.name, description: '' });
                                if (s.level) store.updateSkill(created.id, { level: s.level });
                                skillId = created.id;
                            }
                            onApplySkill(skillId, s.level);
                            card.classList.add('applied');
                            const actions = card.querySelector('.ai-suggest-item-actions');
                            if (actions) actions.innerHTML = '';
                            actions?.appendChild(el('span', { class: 'text-faint fs-sm' }, 'Added'));
                        },
                    }, 'Apply'),
            ]),
        ]);
        container.appendChild(card);
    }
}
