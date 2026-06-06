/* ==========================================================
   views/ai-memory.js
   Modal: view/edit the AI's persistent memory (facts, notes, pins).
   ========================================================== */

import { el, openModal, closeModal, confirmDialog, success } from '../ui.js';
import { store } from '../state.js';

export function openAiMemoryModal() {
    const mem = store.getMemory();
    const facts = mem.facts || {};
    const factEntries = Object.entries(facts);

    const body = el('div', {});

    body.appendChild(el('h4', {}, 'Facts'));
    if (factEntries.length === 0) {
        body.appendChild(el('p', { class: 'text-soft fs-sm' }, 'No facts yet. The AI will store things here when you ask it to remember something.'));
    } else {
        const list = el('ul', { class: 'ai-memory-list' });
        for (const [k, v] of factEntries) {
            list.appendChild(el('li', { class: 'ai-memory-item' }, [
                el('span', { class: 'key' }, k),
                el('span', { class: 'value' }, String(v)),
            ]));
        }
        body.appendChild(list);
    }

    body.appendChild(el('h4', { style: 'margin-top:16px;' }, 'Notes'));
    if (mem.notes) {
        body.appendChild(el('div', { class: 'ai-memory-notes' }, mem.notes));
    } else {
        body.appendChild(el('p', { class: 'text-soft fs-sm' }, 'No notes yet.'));
    }

    const pinned = mem.pinned || { skills: [], tasks: [] };
    const pinnedCount = (pinned.skills || []).length + (pinned.tasks || []).length;
    body.appendChild(el('h4', { style: 'margin-top:16px;' }, 'Pinned'));
    if (pinnedCount === 0) {
        body.appendChild(el('p', { class: 'text-soft fs-sm' }, 'Nothing pinned.'));
    } else {
        const wrap = el('div', { class: 'ai-memory-pinned' });
        for (const sid of (pinned.skills || [])) {
            const sk = store.getSkill(sid);
            wrap.appendChild(el('span', { class: 'chip' }, `S: ${sk?.name || sid}`));
        }
        for (const tid of (pinned.tasks || [])) {
            const t = store.getTask(tid);
            wrap.appendChild(el('span', { class: 'chip' }, `Q: ${t?.title || t?.name || tid}`));
        }
        body.appendChild(wrap);
    }

    const close = el('button', { class: 'btn btn-ghost', onClick: closeModal }, 'Close');
    const clearNotes = el('button', {
        class: 'btn btn-ghost',
        onClick: async () => {
            const ok = await confirmDialog({
                title: 'Clear memory notes?',
                message: 'This deletes all free-form notes the AI has written. Facts and pinned items are kept.',
                confirmLabel: 'Clear notes',
            });
            if (!ok) return;
            store.clearMemoryNotes();
            success('Notes cleared.');
            openAiMemoryModal();
        },
    }, 'Clear notes');
    const clearAll = el('button', {
        class: 'btn btn-ghost',
        onClick: async () => {
            const ok = await confirmDialog({
                title: 'Erase all memory?',
                message: 'This deletes every fact, note, and pinned item the AI has stored. This cannot be undone.',
                confirmLabel: 'Erase everything',
            });
            if (!ok) return;
            const m = store.getMemory();
            for (const k of Object.keys(m.facts || {})) store.forgetFact(k);
            store.clearMemoryNotes();
            store.state.memory.pinned = { skills: [], tasks: [] };
            store.notify({ type: 'memory' });
            success('Memory erased.');
            openAiMemoryModal();
        },
    }, 'Erase all');

    openModal({
        title: 'AI Memory',
        body,
        footer: [clearNotes, clearAll, close],
        large: true,
    });
}
