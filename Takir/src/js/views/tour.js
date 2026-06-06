/* ==========================================================
   views/tour.js
   Skippable guided tour of the main UI. Walks the user through
   the tabs, search, add button, list/tree, detail pane, AI
   panel, and settings/help. Each step highlights a target via
   a positioned "ring" with a popover that explains it.
   ========================================================== */

import { store } from '../state.js';

const TOUR_STEPS = [
    {
        target: '.tab-bar',
        title: 'Three views',
        body: 'Switch between <strong>Skills</strong> (what you know), <strong>Quests</strong> (what you\'re doing), and <strong>Learn</strong> (chat with Tak).',
    },
    {
        target: '.filter-bar',
        title: 'Search & filter',
        body: 'Type to search by name, description, or <code>#N</code> display id. The chips filter by status.',
    },
    {
        target: '#btn-add',
        title: 'Add new',
        body: 'Click <strong>+</strong> to create a new skill (on the Skills tab) or a new quest (on the Quests tab).',
    },
    {
        target: '#view-container',
        title: 'Lists & trees',
        body: 'Skills and quests are shown as trees. Quests with unmet prerequisites show a lock icon and stay inactive until you complete them.',
    },
    {
        target: '#detail-pane',
        title: 'Detail pane',
        body: 'Click any item to see its details here. From here you can take a skill quiz, plan a quest, or upload progress for AI feedback.',
    },
    {
        target: '#btn-ai',
        title: 'Meet Tak',
        body: 'Open the AI panel to chat with <strong>Tak</strong>. He can search the web, recommend free learning resources, and manage your data via tool calls.',
    },
    {
        target: '#btn-help',
        title: 'Help & tour',
        body: 'Need this tour again? Click the <strong>?</strong> button to replay it, see the welcome flow, or report a bug. The <strong>gear</strong> opens settings.',
    },
];

let currentIndex = 0;
let active = false;
let placement = 'bottom';

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function openOverlay() {
    const o = $('#tour-overlay');
    if (o) o.classList.remove('hidden');
    document.body.classList.add('tour-active');
}

function closeOverlay() {
    const o = $('#tour-overlay');
    if (o) o.classList.add('hidden');
    document.body.classList.remove('tour-active');
    const hl = $('#tour-highlight');
    if (hl) hl.style.display = 'none';
}

function positionPopover(target) {
    const pop = $('#tour-popover');
    const margin = 12;
    if (!pop || !target) return;
    const tr = target.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Choose placement: prefer below, fall back to above, then right.
    let place = 'bottom';
    let top = tr.bottom + margin;
    if (top + popRect.height + 16 > vh) {
        top = tr.top - popRect.height - margin;
        place = 'top';
        if (top < 16) {
            // Fall back to side
            place = tr.right + popRect.width + margin < vw ? 'right' : 'left';
            if (place === 'right') {
                top = Math.max(16, Math.min(tr.top, vh - popRect.height - 16));
                pop.style.left = (tr.right + margin) + 'px';
            } else {
                top = Math.max(16, Math.min(tr.top, vh - popRect.height - 16));
                pop.style.left = (tr.left - popRect.width - margin) + 'px';
            }
            pop.style.top = top + 'px';
            pop.className = 'tour-popover tour-placement-' + place;
            placement = place;
            return;
        }
    }
    // Center horizontally on target, clamped to viewport.
    let left = tr.left + tr.width / 2 - popRect.width / 2;
    left = Math.max(16, Math.min(left, vw - popRect.width - 16));
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    pop.className = 'tour-popover tour-placement-' + place;
    placement = place;
}

function positionHighlight(target) {
    const hl = $('#tour-highlight');
    if (!hl || !target) return;
    const tr = target.getBoundingClientRect();
    const pad = 6;
    hl.style.display = 'block';
    hl.style.left = (tr.left - pad) + 'px';
    hl.style.top = (tr.top - pad) + 'px';
    hl.style.width = (tr.width + pad * 2) + 'px';
    hl.style.height = (tr.height + pad * 2) + 'px';
}

function scrollTargetIntoView(target) {
    if (!target) return;
    try {
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    } catch { /* ignore */ }
}

function renderStep() {
    const step = TOUR_STEPS[currentIndex];
    if (!step) return endTour();
    const target = $(step.target);
    if (!target) {
        // Skip silently if the target isn't on the page (e.g. wrong tab).
        if (currentIndex < TOUR_STEPS.length - 1) {
            currentIndex++;
            renderStep();
        } else {
            endTour();
        }
        return;
    }
    scrollTargetIntoView(target);
    // After scroll, position.
    requestAnimationFrame(() => {
        positionHighlight(target);
        positionPopover(target);
    });

    const title = $('#tour-title');
    const body = $('#tour-body');
    const counter = $('#tour-step-counter');
    const dots = $('#tour-dots');
    if (title) title.textContent = step.title;
    if (body) body.innerHTML = step.body;
    if (counter) counter.textContent = `${currentIndex + 1} / ${TOUR_STEPS.length}`;

    if (dots) {
        dots.innerHTML = '';
        for (let i = 0; i < TOUR_STEPS.length; i++) {
            const d = document.createElement('span');
            d.className = 'tour-dot' + (i === currentIndex ? ' active' : '');
            dots.appendChild(d);
        }
    }

    const prev = $('#tour-prev');
    const next = $('#tour-next');
    if (prev) prev.classList.toggle('hidden', currentIndex === 0);
    if (next) next.textContent = currentIndex === TOUR_STEPS.length - 1 ? 'Finish' : 'Next';
}

function next() {
    if (currentIndex < TOUR_STEPS.length - 1) {
        currentIndex++;
        renderStep();
    } else {
        endTour();
    }
}

function prev() {
    if (currentIndex > 0) {
        currentIndex--;
        renderStep();
    }
}

export function startTour() {
    if (active) return;
    if (TOUR_STEPS.length === 0) return;
    active = true;
    currentIndex = 0;
    openOverlay();
    renderStep();
}

export function endTour() {
    if (!active) return;
    active = false;
    closeOverlay();
    store.markTourComplete();
}

function reposition() {
    if (!active) return;
    const step = TOUR_STEPS[currentIndex];
    if (!step) return;
    const target = $(step.target);
    if (!target) return;
    positionHighlight(target);
    positionPopover(target);
}

function wireTour() {
    const o = $('#tour-overlay');
    if (!o) return;
    const skip = $('#tour-skip');
    const back = $('#tour-prev');
    const nextBtn = $('#tour-next');
    const backdrop = $('#tour-backdrop');
    if (skip) skip.addEventListener('click', endTour);
    if (back) back.addEventListener('click', prev);
    if (nextBtn) nextBtn.addEventListener('click', next);
    if (backdrop) backdrop.addEventListener('click', endTour);
    document.addEventListener('keydown', (e) => {
        if (!active) return;
        if (e.key === 'Escape') endTour();
        else if (e.key === 'ArrowRight') next();
        else if (e.key === 'ArrowLeft') prev();
    });
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
}

export function initTour() {
    wireTour();
}

/* ----- test helpers (no DOM, used by tests) ----- */

/** Return the list of tour steps. Used by tests. */
export function getTourSteps() {
    return TOUR_STEPS.map(s => ({ target: s.target, title: s.title, body: s.body }));
}

/** A pure function for popover placement, exposed for tests. */
export function pickPlacement(viewport, targetRect, popoverSize, margin = 12) {
    const { vw, vh } = viewport;
    // Below
    const belowTop = targetRect.bottom + margin;
    if (belowTop + popoverSize.height + 16 <= vh) {
        return { place: 'bottom', top: belowTop, left: targetRect.left + targetRect.width / 2 - popoverSize.width / 2 };
    }
    // Above
    const aboveTop = targetRect.top - popoverSize.height - margin;
    if (aboveTop >= 16) {
        return { place: 'top', top: aboveTop, left: targetRect.left + targetRect.width / 2 - popoverSize.width / 2 };
    }
    // Right
    if (targetRect.right + popoverSize.width + margin < vw) {
        return { place: 'right', top: targetRect.top, left: targetRect.right + margin };
    }
    // Left
    return { place: 'left', top: targetRect.top, left: targetRect.left - popoverSize.width - margin };
}
