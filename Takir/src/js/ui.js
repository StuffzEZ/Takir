/* ==========================================================
   ui.js
   DOM helpers, rendering, and modal/toast management.
   ========================================================== */

import { store } from './state.js';
import { toRoman, levelLabel, formatDate, bytesToHuman, isImageMime, isVideoMime, fileToDataURL, clamp } from './utils.js';

/* ---------------- generic helpers ---------------- */

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

export function formatDisplayId(item) {
    return (item && Number.isInteger(item.seq) && item.seq > 0) ? `#${item.seq} ` : '';
}

export function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (k === 'class') node.className = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k === 'style') {
            if (typeof v === 'string') node.style.cssText = v;
            else if (typeof v === 'object' && v) Object.assign(node.style, v);
        }
        else if (k.startsWith('on') && typeof v === 'function') {
            node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'html') {
            node.innerHTML = v;
        } else if (v === false || v == null) {
            /* skip */
        } else if (v === true) {
            node.setAttribute(k, '');
        } else {
            node.setAttribute(k, v);
        }
    }
    for (const c of [].concat(children || [])) {
        if (c == null || c === false) continue;
        if (typeof c === 'string' || typeof c === 'number') {
            node.appendChild(document.createTextNode(String(c)));
        } else {
            node.appendChild(c);
        }
    }
    return node;
}

export function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
}

/* ---------------- toasts ---------------- */

let toastContainer = null;
function ensureToastContainer() {
    if (toastContainer) return toastContainer;
    toastContainer = $('#toast-container');
    return toastContainer;
}

export function toast(message, type = 'info', timeoutMs = 3800) {
    const container = ensureToastContainer();
    if (!container) return;
    const t = el('div', { class: `toast ${type}` }, [message]);
    container.appendChild(t);
    setTimeout(() => {
        t.style.transition = 'opacity .3s, transform .3s';
        t.style.opacity = '0';
        t.style.transform = 'translateX(100%)';
        setTimeout(() => t.remove(), 320);
    }, timeoutMs);
}

export function error(message) { toast(message, 'error', 6000); }
export function success(message) { toast(message, 'success'); }
export function warn(message) { toast(message, 'warn'); }

/* ---------------- modal ---------------- */

let modalRoot = null;
let modalBody = null;
let modalTitle = null;
let modalFooter = null;
let _modalOnClose = null;

export function openModal({ title, body, footer, onClose, large = false } = {}) {
    modalRoot = modalRoot || $('#modal-root');
    modalBody = modalBody || $('#modal-body');
    modalTitle = modalTitle || $('#modal-title');
    modalFooter = modalFooter || $('#modal-footer');

    if (!modalRoot) return;

    modalTitle.textContent = title || '';
    clear(modalBody);
    if (body instanceof Node) modalBody.appendChild(body);
    else if (body != null) {
        // Treat as plain text (no innerHTML) to avoid XSS from user input
        modalBody.appendChild(document.createTextNode(String(body)));
    }

    clear(modalFooter);
    if (footer) {
        modalFooter.style.display = '';
        if (footer instanceof Node) modalFooter.appendChild(footer);
        else if (Array.isArray(footer)) {
            for (const f of footer) if (f instanceof Node) modalFooter.appendChild(f);
        }
    } else {
        modalFooter.style.display = 'none';
    }

    modalRoot.classList.remove('hidden');
    modalRoot.querySelector('.modal-window').style.maxWidth = large ? '880px' : '';

    _modalOnClose = onClose || null;
}

export function closeModal() {
    if (!modalRoot) return;
    modalRoot.classList.add('hidden');
    clear(modalBody);
    clear(modalFooter);
    modalFooter.style.display = 'none';
    if (_modalOnClose) { try { _modalOnClose(); } catch { /* ignore */ } }
    _modalOnClose = null;
}

/**
 * In-app confirm dialog. Returns a Promise<boolean>.
 * Resolves with false if the user closes via backdrop, Escape, or Cancel.
 * Resolves with true only via the confirm button.
 */
export function confirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
    return new Promise((resolve) => {
        let resolved = false;
        const safeResolve = (v) => { if (!resolved) { resolved = true; resolve(v); } };

        const body = el('div', {}, [
            el('p', { class: 'detail-text' }, message),
        ]);
        // Order matters: resolve first, THEN close. If we close first,
        // closeModal() runs the onClose handler (safeResolve(false))
        // which would mark the promise as resolved with the wrong value
        // before the button's own safeResolve(true) ever runs.
        const yes = el('button', {
            class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
            onClick: () => { safeResolve(true); closeModal(); },
        }, confirmLabel);
        const no = el('button', {
            class: 'btn btn-ghost',
            onClick: () => { safeResolve(false); closeModal(); },
        }, cancelLabel);
        openModal({
            title, body, footer: [no, yes],
            onClose: () => safeResolve(false),
        });
    });
}

export function initModalDismiss() {
    document.addEventListener('click', (e) => {
        const t = e.target.closest('[data-close]');
        if (t && modalRoot && !modalRoot.classList.contains('hidden')) {
            closeModal();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalRoot && !modalRoot.classList.contains('hidden')) {
            closeModal();
        }
    });
}

/* ---------------- prereq helpers ---------------- */

/**
 * Determine if a given node's prerequisites are all met.
 * For skills: a prerequisite is met if the other skill has level >= this skill's required level
 *             (we treat the prereq skill's level as its minimum required, i.e. you must be at least as good).
 *             Actually simpler model: you can take the assessment for this skill only if all prereqs are assessed >= 1.
 * For tasks: all prereq tasks must be 'completed'.
 */
export function isSkillAvailable(skill) {
    const prereqs = skill?.prerequisites || [];
    for (const pid of prereqs) {
        const p = store.getSkill(pid);
        if (!p) return false;
        if (!p.level || p.level < 1) return false;
    }
    return true;
}

export function isTaskAvailable(task) {
    const prereqs = task?.prerequisites || [];
    for (const pid of prereqs) {
        const p = store.getTask(pid);
        if (!p) return false;
        if (p.status !== 'completed') return false;
    }
    // Also: all required skills must meet level
    for (const rs of (task.requiredSkills || [])) {
        const s = store.getSkill(rs.skillId);
        if (!s) return false;
        if ((s.level || 0) < (rs.level || 0)) return false;
    }
    return true;
}

export function isTaskBlocked(task) {
    const prereqs = task?.prerequisites || [];
    if (prereqs.some(pid => {
        const p = store.getTask(pid);
        return p && p.status === 'blocked';
    })) return true;
    for (const rs of (task.requiredSkills || [])) {
        const s = store.getSkill(rs.skillId);
        if (!s) return true;  // missing skill is treated as blocked
    }
    return false;
}

/* ---------------- list rendering ---------------- */

const TREE_EMBLEM_SKILL = 'S';
const TREE_EMBLEM_TASK  = 'Q';

const LOCK_SVG = '<svg class="lock-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 1.5a3.5 3.5 0 0 0-3.5 3.5V7H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-.5V5A3.5 3.5 0 0 0 8 1.5Zm-2 5.5V5a2 2 0 1 1 4 0v2H6Z"/></svg>';

export function lockIconSvg() { return LOCK_SVG; }

function filterByQuery(items, q) {
    const term = (q || '').trim().toLowerCase();
    if (!term) return items;
    // #N references — let users search by display id.
    const seqMatch = /^#?(\d+)$/.exec(term);
    if (seqMatch) {
        const n = parseInt(seqMatch[1], 10);
        return items.filter(it => it.seq === n);
    }
    return items.filter(it => {
        const hay = `${formatDisplayId(it)}${it.name} ${it.description || ''}`.toLowerCase();
        return hay.includes(term);
    });
}

function sortByName(a, b) { return a.name.localeCompare(b.name); }

function buildSkillsTree() {
    const skills = store.getSkills();
    const byId = new Map(skills.map(s => [s.id, { ...s, children: [] }]));
    const roots = [];
    for (const node of byId.values()) {
        const parents = (node.prerequisites || []).filter(p => byId.has(p));
        if (parents.length === 0) {
            roots.push(node);
        } else {
            for (const pid of parents) {
                const parent = byId.get(pid);
                if (parent) parent.children.push(node);
            }
        }
    }
    roots.sort(sortByName);
    for (const n of byId.values()) n.children.sort(sortByName);
    return { roots, byId };
}

function buildTasksTree() {
    const tasks = store.getTasks();
    const byId = new Map(tasks.map(t => [t.id, { ...t, children: [] }]));
    const roots = [];
    for (const node of byId.values()) {
        const parents = (node.prerequisites || []).filter(p => byId.has(p));
        if (parents.length === 0) {
            roots.push(node);
        } else {
            for (const pid of parents) {
                const parent = byId.get(pid);
                if (parent) parent.children.push(node);
            }
        }
    }
    roots.sort(sortByName);
    for (const n of byId.values()) n.children.sort(sortByName);
    return { roots, byId };
}

function treeNodeView(node, kind, depth = 0, visited = new Set()) {
    if (visited.has(node.id)) {
    return el('div', { class: 'tree-node' }, [
        el('div', { class: 'tree-node-row locked' }, [
            el('span', { class: 'tree-toggle empty', html: '•' }),
            el('span', { class: 'tree-emblem', html: kind === 'skill' ? TREE_EMBLEM_SKILL : TREE_EMBLEM_TASK }),
            el('span', { class: 'tree-name italic' }, `${formatDisplayId(node)}${node.name} (cycle)`),
            el('span', { class: 'tree-lock', html: LOCK_SVG, title: 'Cycle detected' }),
        ]),
    ]);
    }
    const nextVisited = new Set(visited);
    nextVisited.add(node.id);

    const isSelected = store.state.selectedId === node.id && store.state.selectedType === kind;
    const available = kind === 'skill' ? isSkillAvailable(node) : isTaskAvailable(node);
    const blocked = kind === 'task' ? isTaskBlocked(node) : false;
    const locked = !available || blocked;

    const emblem = kind === 'skill' ? TREE_EMBLEM_SKILL : TREE_EMBLEM_TASK;
    const meta = kind === 'skill'
        ? (node.level ? `${toRoman(node.level)} \u00B7 ${levelLabel(node.level)}` : 'Unassessed')
        : (node.status || 'pending');

    const hasChildren = node.children && node.children.length > 0;

    const row = el('div', {
        class: `tree-node-row${isSelected ? ' selected' : ''}${locked ? ' locked' : ''}`,
        dataset: { id: node.id, kind },
    }, [
        el('span', { class: `tree-toggle ${hasChildren ? '' : 'empty'}`, html: hasChildren ? '▾' : '•' }),
        el('span', { class: 'tree-emblem', html: emblem }),
        el('span', { class: 'tree-name' }, `${formatDisplayId(node)}${node.name}`),
        locked
            ? el('span', { class: 'tree-lock', html: LOCK_SVG, title: 'Prerequisites not met' })
            : el('span', { class: 'tree-lock hidden', html: '' }),
        el('span', { class: 'tree-meta' }, meta),
    ]);

    row.addEventListener('click', (ev) => {
        if (ev.target.closest('.tree-toggle') && hasChildren) {
            ev.stopPropagation();
            const childContainer = row.parentElement.querySelector(':scope > .tree-children');
            if (childContainer) {
                const showing = !childContainer.classList.contains('hidden');
                childContainer.classList.toggle('hidden', showing);
                const t = row.querySelector('.tree-toggle');
                if (t) t.textContent = showing ? '▸' : '▾';
            }
            return;
        }
        store.select(node.id, kind);
    });

    const wrap = el('div', { class: 'tree-node' }, [row]);

    if (hasChildren) {
        const childContainer = el('div', { class: 'tree-children' });
        for (const child of node.children) {
            childContainer.appendChild(treeNodeView(child, kind, depth + 1, nextVisited));
        }
        wrap.appendChild(childContainer);
    }

    return wrap;
}

function gridCardView(item, kind) {
    const tpl = kind === 'skill' ? $('#tpl-skill-card') : $('#tpl-task-card');
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = item.id;
    node.dataset.kind = kind;
    node.querySelector('.card-title').textContent = `${formatDisplayId(item)}${item.name}`;
    node.querySelector('.card-desc').textContent = item.description || '';
    node.querySelector('.card-emblem').innerHTML = kind === 'skill' ? TREE_EMBLEM_SKILL : TREE_EMBLEM_TASK;
    node.querySelector('.card-status').innerHTML = isSelected(item, kind) ? '\u2605' : '';

    if (kind === 'skill') {
        const badge = node.querySelector('.level-badge');
        if (item.level) {
            badge.textContent = `${toRoman(item.level)} \u00B7 ${levelLabel(item.level)}`;
            badge.dataset.level = String(item.level);
            badge.classList.remove('unassessed');
        } else {
            badge.textContent = 'unassessed';
            badge.classList.add('unassessed');
            delete badge.dataset.level;
        }
        const prereqInfo = node.querySelector('.prereq-info');
        const prereqs = (item.prerequisites || []).map(id => store.getSkill(id)).filter(Boolean);
        if (prereqs.length) {
            const ok = prereqs.every(p => p.level >= 1);
            prereqInfo.textContent = `Requires: ${prereqs.map(p => p.name).join(', ')}`;
            prereqInfo.classList.toggle('has-prereqs', !ok);
        } else {
            prereqInfo.textContent = '';
        }
    } else {
        const badge = node.querySelector('.status-badge');
        badge.textContent = (item.status || 'pending').replace('-', ' ');
        badge.dataset.status = item.status || 'pending';
        const prereqInfo = node.querySelector('.prereq-info');
        const prereqs = (item.prerequisites || []).map(id => store.getTask(id)).filter(Boolean);
        if (prereqs.length) {
            const ok = prereqs.every(p => p.status === 'completed');
            prereqInfo.textContent = `Requires: ${prereqs.map(p => p.name).join(', ')}`;
            prereqInfo.classList.toggle('has-prereqs', !ok);
        } else {
            prereqInfo.textContent = '';
        }
    }

    if (kind === 'skill' ? !isSkillAvailable(item) : (!isTaskAvailable(item) || isTaskBlocked(item))) {
        node.classList.add('locked');
    }
    if (isSelected(item, kind)) node.classList.add('selected');

    node.addEventListener('click', () => store.select(item.id, kind));
    return node;
}

function isSelected(item, kind) {
    return store.state.selectedId === item.id && store.state.selectedType === kind;
}

export function renderView() {
    const view = $('#view-container');
    if (!view) return;

    const state = store.state;
    const tab = state.activeTab;
    const q = state.searchQuery;
    const onlyAvail = state.showOnlyAvailable;

    const learnView = $('#learn-view');
    const filterBar = $('.filter-bar');

    if (tab === 'learn') {
        // The Learn view is a sibling of #view-container (not a child), so
        // we just toggle visibility — clearing the view container has no
        // effect on it. We still need to clear the previous list/tree so
        // the skills/quests don't show through behind the Learn view.
        if (learnView) learnView.classList.remove('hidden');
        if (filterBar) filterBar.classList.add('hidden');
        document.getElementById('btn-add')?.classList.add('hidden');
        clear(view);
        return;
    }

    if (learnView) learnView.classList.add('hidden');
    if (filterBar) filterBar.classList.remove('hidden');
    document.getElementById('btn-add')?.classList.remove('hidden');

    clear(view);
    if (tab === 'skills') {
        renderSkillsView(view, q, onlyAvail);
    } else {
        renderTasksView(view, q, onlyAvail);
    }
}

function renderSkillsView(view, q, onlyAvail) {
    const items = store.getSkills();
    if (items.length === 0) {
        view.appendChild(emptyState({
            icon: 'S',
            title: 'No skills yet',
            message: 'Create your first skill and the AI will generate an assessment to measure your level.',
        }));
        return;
    }

    const filtered = filterByQuery(items, q);
    if (filtered.length === 0) {
        view.appendChild(emptyState({
            icon: '\u2315',
            title: 'No skills match your search.',
            message: 'Try a different word or clear the search field.',
        }));
        return;
    }

    const viewMode = view.dataset.mode || 'tree';

    if (viewMode === 'grid') {
        const grid = el('div', { class: 'card-grid' });
        for (const it of filtered) {
            if (onlyAvail && !isSkillAvailable(it)) continue;
            grid.appendChild(gridCardView(it, 'skill'));
        }
        view.appendChild(grid);
    } else {
        const treeWrap = el('div', { class: 'tree-view' });
        const { roots, byId } = buildSkillsTree();
        const filteredIds = new Set(filtered.map(s => s.id));
        // If all nodes are in cycles, treat them as roots
        let visibleRoots = roots.filter(r => filteredIds.has(r.id) || r.children.some(c => filteredIds.has(c.id)));
        if (visibleRoots.length === 0 && filtered.length > 0) {
            visibleRoots = filtered.map(s => byId.get(s.id)).filter(Boolean);
        }
        if (visibleRoots.length === 0) {
            view.appendChild(emptyState({
                icon: '\u2315',
                title: 'No skills match your search.',
                message: 'Try a different word or clear the search field.',
            }));
            return;
        }
        for (const r of visibleRoots) treeWrap.appendChild(treeNodeView(r, 'skill'));
        view.appendChild(treeWrap);
    }
}

function renderTasksView(view, q, onlyAvail) {
    const items = store.getTasks();
    if (items.length === 0) {
        view.appendChild(emptyState({
            icon: 'Q',
            title: 'No quests yet',
            message: 'Add a quest and the AI will suggest the skills, sub-quests, and prerequisites you need.',
        }));
        return;
    }

    const filtered = filterByQuery(items, q);
    if (filtered.length === 0) {
        view.appendChild(emptyState({
            icon: '\u2315',
            title: 'No quests match your search.',
            message: 'Try a different word or clear the search field.',
        }));
        return;
    }

    const viewMode = view.dataset.mode || 'tree';

    if (viewMode === 'grid') {
        const grid = el('div', { class: 'card-grid' });
        for (const it of filtered) {
            if (onlyAvail && (!isTaskAvailable(it) || isTaskBlocked(it))) continue;
            grid.appendChild(gridCardView(it, 'task'));
        }
        view.appendChild(grid);
    } else {
        const treeWrap = el('div', { class: 'tree-view' });
        const { roots, byId } = buildTasksTree();
        const filteredIds = new Set(filtered.map(t => t.id));
        let visibleRoots = roots.filter(r => filteredIds.has(r.id) || r.children.some(c => filteredIds.has(c.id)));
        if (visibleRoots.length === 0 && filtered.length > 0) {
            visibleRoots = filtered.map(t => byId.get(t.id)).filter(Boolean);
        }
        if (visibleRoots.length === 0) {
            view.appendChild(emptyState({
                icon: '\u2315',
                title: 'No quests match your search.',
                message: 'Try a different word or clear the search field.',
            }));
            return;
        }
        for (const r of visibleRoots) treeWrap.appendChild(treeNodeView(r, 'task'));
        view.appendChild(treeWrap);
    }
}

function emptyState({ icon, title, message }) {
    return el('div', { class: 'empty-state' }, [
        el('span', { class: 'empty-icon', html: icon }),
        el('h3', {}, title),
        el('p', { class: 'text-faint italic' }, message),
    ]);
}

/* ---------------- filter chips ---------------- */

export function renderFilterChips() {
    const wrap = $('#filter-chips');
    if (!wrap) return;
    clear(wrap);
    const state = store.state;
    wrap.appendChild(el('span', { class: 'chip', style: 'background:transparent;border:none;cursor:default;text-transform:uppercase;' }, 'View:'));
    wrap.appendChild(viewChip('Tree', 'tree', state));
    wrap.appendChild(viewChip('Grid', 'grid', state));
    wrap.appendChild(filterChip('Available only', () => store.setShowOnlyAvailable(!state.showOnlyAvailable), state.showOnlyAvailable));
}

/* Internal helper alias */
function filterChip(label, onClick, active) {
    return el('span', {
        class: `chip ${active ? 'active' : ''}`,
        onClick,
    }, label);
}

function viewChip(label, mode, state) {
    const current = (typeof document !== 'undefined' ? document.querySelector('#view-container')?.dataset?.mode : null) || 'tree';
    return el('span', {
        class: `chip ${current === mode ? 'active' : ''}`,
        onClick: () => {
            const v = $('#view-container');
            if (v) v.dataset.mode = mode;
            renderFilterChips();
            renderView();
        },
    }, label);
}

/* ---------------- detail view ---------------- */

export function renderDetail() {
    const pane = $('#detail-pane');
    if (!pane) return;
    if (store.state.activeTab === 'learn') {
        // Detail pane isn't used on the Learn tab.
        return;
    }
    clear(pane);

    const sel = store.getSelected();
    if (!sel) {
        pane.appendChild(el('div', { class: 'detail-empty' }, [
            el('div', { class: 'detail-empty-emblem', html: '\u2756' }),
            el('h2', {}, 'Nothing selected'),
            el('p', {}, 'Pick a skill or quest from the list to see its details, or create a new one.'),
        ]));
        return;
    }

    if (sel.type === 'skill') renderSkillDetail(pane, sel);
    else renderTaskDetail(pane, sel);
}

function renderSkillDetail(pane, skill) {
    const lvl = skill.level || 0;

    const root = el('div', { class: 'detail-content' });

    root.appendChild(el('div', { class: 'detail-header' }, [
        el('div', { class: 'detail-emblem', html: TREE_EMBLEM_SKILL }),
        el('h1', { class: 'detail-title' }, `${formatDisplayId(skill)}${skill.name}`),
        el('div', { class: 'detail-subtitle' }, 'Skill'),
    ]));

    // Level
    const levelBox = el('div', { class: 'skill-level-display' }, [
        el('div', { class: 'skill-level-roman', dataset: { level: String(lvl) || '0' } }, lvl ? toRoman(lvl) : '\u2014'),
        el('div', { class: 'skill-level-label' }, lvl ? levelLabel(lvl) : 'Not yet assessed'),
    ]);
    root.appendChild(el('div', { class: 'detail-section' }, [
        el('div', { class: 'detail-section-title' }, 'Level'),
        levelBox,
    ]));

    if (skill.description) {
        root.appendChild(el('div', { class: 'detail-section' }, [
            el('div', { class: 'detail-section-title' }, [
                el('span', { class: 'icon', html: '\u2756' }), ' Description',
            ]),
            el('p', { class: 'detail-text' }, skill.description),
        ]));
    }

    // Prerequisites
    const prereqs = (skill.prerequisites || []).map(id => store.getSkill(id)).filter(Boolean);
    root.appendChild(el('div', { class: 'detail-section' }, [
        el('div', { class: 'detail-section-title' }, 'Prerequisites'),
        prereqs.length
            ? el('div', { class: 'tag-list' }, prereqs.map(p =>
                el('span', {
                    class: 'tag tag-link',
                    title: `${toRoman(p.level || 0)} \u00B7 ${p.name}`,
                    onClick: () => store.select(p.id, 'skill'),
                }, [
                    p.level ? toRoman(p.level) : '\u2014',
                    ' ',
                    p.name,
                ])))
            : el('p', { class: 'detail-text text-faint italic' }, 'No prerequisites.'),
    ]));

    // Unlocks (skills that depend on this)
    const unlocks = Object.values(store.state.skills).filter(s =>
        s.id !== skill.id && (s.prerequisites || []).includes(skill.id)
    );
    if (unlocks.length) {
        root.appendChild(el('div', { class: 'detail-section' }, [
            el('div', { class: 'detail-section-title' }, 'Unlocks'),
            el('div', { class: 'tag-list' }, unlocks.map(u =>
                el('span', {
                    class: 'tag tag-link',
                    onClick: () => store.select(u.id, 'skill'),
                }, u.name))),
        ]));
    }

    // Quiz history
    if (skill.quiz) {
        root.appendChild(el('div', { class: 'detail-section' }, [
            el('div', { class: 'detail-section-title' }, 'Last Assessment'),
            el('p', { class: 'detail-text' }, [
                `Scored ${toRoman(skill.quiz.level || 0)} on ${formatDate(skill.quiz.takenAt)}. `,
                skill.quiz.reasoning || '',
            ].join('')),
        ]));
    }

    // Actions
    const actions = el('div', { class: 'detail-actions' });
    const canTake = isSkillAvailable(skill);
    actions.appendChild(el('button', {
        class: 'btn btn-primary btn-block',
        disabled: !canTake,
        title: canTake ? 'Take the assessment' : 'Complete prerequisites first',
        onClick: () => window.dispatchEvent(new CustomEvent('takir:start-quiz', { detail: { id: skill.id } })),
    }, skill.quiz ? 'Re-take Assessment' : 'Take Assessment'));

    if (!canTake) {
        actions.appendChild(el('p', { class: 'text-faint italic fs-sm' }, 'This skill is locked. Complete its prerequisites first.'));
    }

    actions.appendChild(el('button', {
        class: 'btn btn-ghost btn-block',
        onClick: () => window.dispatchEvent(new CustomEvent('takir:edit-skill', { detail: { id: skill.id } })),
    }, 'Edit Skill'));

    actions.appendChild(el('button', {
        class: 'btn btn-danger btn-block',
        onClick: () => window.dispatchEvent(new CustomEvent('takir:delete-skill', { detail: { id: skill.id } })),
    }, 'Delete Skill'));

    root.appendChild(actions);
    pane.appendChild(root);
}

function renderTaskDetail(pane, task) {
    const root = el('div', { class: 'detail-content' });

    root.appendChild(el('div', { class: 'detail-header' }, [
        el('div', { class: 'detail-emblem', html: TREE_EMBLEM_TASK }),
        el('h1', { class: 'detail-title' }, `${formatDisplayId(task)}${task.name}`),
        el('div', { class: 'detail-subtitle' }, 'Quest'),
    ]));

    if (task.description) {
        root.appendChild(el('div', { class: 'detail-section' }, [
            el('div', { class: 'detail-section-title' }, [
                el('span', { class: 'icon', html: '\u2756' }), ' Description',
            ]),
            el('p', { class: 'detail-text' }, task.description),
        ]));
    }

    // Status changer (locked when prereqs / required skills are not met)
    const taskBlocked = isTaskBlocked(task);
    const statusSel = el('select', { class: 'form-select' });
    for (const opt of ['pending', 'in-progress', 'completed', 'blocked']) {
        const o = el('option', { value: opt }, opt.replace('-', ' '));
        if ((task.status || 'pending') === opt) o.setAttribute('selected', '');
        // While blocked, only "pending" and "blocked" are allowed.
        if (taskBlocked && (opt === 'in-progress' || opt === 'completed')) {
            o.setAttribute('disabled', '');
        }
        statusSel.appendChild(o);
    }
    if (taskBlocked) {
        statusSel.disabled = true;
        statusSel.title = 'Complete the prerequisite quests and required skills first.';
    } else {
        statusSel.addEventListener('change', (e) => store.updateTask(task.id, { status: e.target.value }));
    }
    const statusBlock = el('div', { class: 'detail-section' }, [
        el('div', { class: 'detail-section-title' }, 'Status'),
        statusSel,
    ]);
    if (taskBlocked) {
        statusBlock.appendChild(el('div', { class: 'detail-locked-msg' }, [
            el('span', { html: LOCK_SVG, class: 'lock-inline' }),
            el('span', {}, ' Status changes are locked. Complete the prerequisite quests and required skills first.'),
        ]));
    }
    root.appendChild(statusBlock);

    // Required skills
    const required = (task.requiredSkills || []).map(rs => ({ ...rs, skill: store.getSkill(rs.skillId) }));
    root.appendChild(el('div', { class: 'detail-section' }, [
        el('div', { class: 'detail-section-title' }, 'Required Skills'),
        required.length
            ? el('div', { class: 'tag-list' }, required.map(rs => {
                const have = rs.skill?.level || 0;
                const ok = have >= rs.level;
                const cls = `tag ${ok ? 'met' : 'unmet'} tag-link`;
                const label = rs.skill
                    ? `${rs.skill.name} ${toRoman(rs.level)}`
                    : `(missing) ${toRoman(rs.level)}`;
                return el('span', {
                    class: cls,
                    title: rs.skill ? `Have: ${toRoman(have)} \u00B7 Need: ${toRoman(rs.level)}` : 'Skill not yet known',
                    onClick: () => rs.skill && store.select(rs.skill.id, 'skill'),
                }, [ok ? '\u2714 ' : '\u2716 ', label]);
            }))
            : el('p', { class: 'detail-text text-faint italic' }, 'No specific skills required.'),
    ]));

    // Prerequisites (tasks)
    const prereqs = (task.prerequisites || []).map(id => store.getTask(id)).filter(Boolean);
    root.appendChild(el('div', { class: 'detail-section' }, [
        el('div', { class: 'detail-section-title' }, 'Prerequisite Quests'),
        prereqs.length
            ? el('div', { class: 'tag-list' }, prereqs.map(p => {
                const ok = p.status === 'completed';
                return el('span', {
                    class: `tag ${ok ? 'met' : 'unmet'} tag-link`,
                    onClick: () => store.select(p.id, 'task'),
                }, [ok ? '\u2714 ' : '\u2716 ', p.name]);
            }))
            : el('p', { class: 'detail-text text-faint italic' }, 'No prerequisite quests.'),
    ]));

    // Subtasks
    const subs = (task.subtasks || []).map(id => store.getTask(id)).filter(Boolean);
    root.appendChild(el('div', { class: 'detail-section' }, [
        el('div', { class: 'detail-section-title' }, 'Sub-quests'),
        subs.length
            ? el('div', { class: 'tag-list' }, subs.map(s =>
                el('span', {
                    class: 'tag tag-link',
                    onClick: () => store.select(s.id, 'task'),
                }, [s.status === 'completed' ? '\u2714 ' : '\u25CB ', s.name])))
            : el('p', { class: 'detail-text text-faint italic' }, 'No sub-quests.'),
    ]));

    // Actions
    const actions = el('div', { class: 'detail-actions' });
    actions.appendChild(el('button', {
        class: 'btn btn-primary btn-block',
        onClick: () => window.dispatchEvent(new CustomEvent('takir:edit-task', { detail: { id: task.id } })),
    }, 'Edit Quest'));

    actions.appendChild(el('button', {
        class: 'btn btn-ghost btn-block',
        onClick: () => window.dispatchEvent(new CustomEvent('takir:submit-progress', { detail: { id: task.id } })),
    }, 'Submit Progress \u2192'));

    actions.appendChild(el('button', {
        class: 'btn btn-ghost btn-block',
        onClick: () => window.dispatchEvent(new CustomEvent('takir:analyze-task', { detail: { id: task.id } })),
    }, 'Re-analyze with AI'));

    actions.appendChild(el('button', {
        class: 'btn btn-danger btn-block',
        onClick: () => window.dispatchEvent(new CustomEvent('takir:delete-task', { detail: { id: task.id } })),
    }, 'Delete Quest'));

    // Last progress review (if any)
    const lastReview = (task.notes || '').split('\n').reverse().find(l => l.includes('progress review'));
    if (lastReview) {
        actions.appendChild(el('p', { class: 'text-faint italic fs-sm', style: 'margin-top:8px;' }, [
            'Last review: ', lastReview.replace(/^\[\d{4}-\d{2}-\d{2} progress review\] /, ''),
        ]));
    }

    root.appendChild(actions);
    pane.appendChild(root);
}

/* ---------------- attachment input helper ---------------- */

export async function readAttachment(file) {
    if (!file) return null;
    const mime = file.type || '';
    if (isImageMime(mime)) {
        if (file.size > 8 * 1024 * 1024) {
            throw new Error(`Image ${file.name} is too large (${bytesToHuman(file.size)}). Limit is 8MB.`);
        }
        const dataUrl = await fileToDataURL(file);
        return { type: 'image', name: file.name, mime, size: file.size, dataUrl };
    }
    if (isVideoMime(mime)) {
        if (file.size > 20 * 1024 * 1024) {
            throw new Error(`Video ${file.name} is too large (${bytesToHuman(file.size)}). Limit is 20MB.`);
        }
        const dataUrl = await fileToDataURL(file);
        return { type: 'video', name: file.name, mime, size: file.size, dataUrl };
    }
    throw new Error(`Unsupported file type: ${mime || 'unknown'}`);
}

export { clamp };
