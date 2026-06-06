/* ==========================================================
   views/onboarding.js
   First-run welcome flow. Two steps:
     1. Brief intro to the three views (Skills, Quests, Learn).
     2. Optional OpenRouter API key (skippable).
   Once finished, hands off to the guided tour (views/tour.js).
   Re-runnable from the Help menu.
   ========================================================== */

import { store } from '../state.js';
import { startTour } from './tour.js';

let currentStep = 0;
const TOTAL_STEPS = 2;

function $(sel, root = document) { return root.querySelector(sel); }

function showStep(step) {
    currentStep = Math.max(0, Math.min(TOTAL_STEPS - 1, step));
    for (const elStep of document.querySelectorAll('.onboarding-step')) {
        const isActive = Number(elStep.dataset.step) === currentStep;
        elStep.classList.toggle('hidden', !isActive);
        elStep.classList.toggle('onboarding-step-active', isActive);
    }
    for (const dot of document.querySelectorAll('.onboarding-dot')) {
        dot.classList.toggle('active', Number(dot.dataset.step) === currentStep);
    }
    const back = $('#onboarding-back');
    const next = $('#onboarding-next');
    if (back) back.classList.toggle('hidden', currentStep === 0);
    if (next) {
        next.textContent = currentStep === TOTAL_STEPS - 1 ? "Start the tour" : 'Next';
    }
    // Pre-fill the key input on step 1.
    if (currentStep === 1) {
        const input = $('#onboarding-key');
        if (input) input.value = store.state.apiKey || '';
    }
}

function closeOnboarding() {
    const m = $('#onboarding-modal');
    if (m) m.classList.add('hidden');
}

function openOnboardingModal() {
    const m = $('#onboarding-modal');
    if (!m) return;
    m.classList.remove('hidden');
    showStep(0);
}

function finish({ startTheTour }) {
    store.markOnboardingComplete();
    closeOnboarding();
    if (startTheTour && !store.state.tourComplete) {
        // Small delay so the modal close animation doesn't fight the tour.
        setTimeout(() => startTour(), 200);
    }
}

function wireOnboarding() {
    const m = $('#onboarding-modal');
    if (!m) return;
    const skip = $('#onboarding-skip');
    const back = $('#onboarding-back');
    const next = $('#onboarding-next');
    if (skip) {
        skip.addEventListener('click', () => finish({ startTheTour: false }));
    }
    if (back) {
        back.addEventListener('click', () => showStep(currentStep - 1));
    }
    if (next) {
        next.addEventListener('click', () => {
            if (currentStep < TOTAL_STEPS - 1) {
                // Save key as we leave step 1 — even if user clicks Next on step 0 we go to 1.
                if (currentStep === 0) {
                    showStep(1);
                    return;
                }
                showStep(currentStep + 1);
            } else {
                // Last step ("Add your OpenRouter API key"): save key if present, then finish.
                const keyInput = $('#onboarding-key');
                if (keyInput) {
                    const k = (keyInput.value || '').trim();
                    if (k) store.setApiKey(k);
                }
                finish({ startTheTour: true });
            }
        });
    }
    // ESC closes (and skips the tour). Click on backdrop closes.
    const backdrop = m.querySelector('.modal-backdrop, [data-close]');
    // Use the same backdrop pattern as the main modal: a click on the wrapper
    // outside .modal-card closes it.
    m.addEventListener('click', (e) => {
        if (e.target === m) finish({ startTheTour: false });
    });
    // Backdrop element (added implicitly by the modal pattern). Look for a
    // backdrop child if present.
    const bd = m.querySelector('.modal-backdrop');
    if (bd) bd.addEventListener('click', () => finish({ startTheTour: false }));
    // ESC key.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !m.classList.contains('hidden')) {
            finish({ startTheTour: false });
        }
    });
}

/**
 * Show the onboarding flow if it hasn't been completed yet.
 * Re-runnable from the Help menu; pass { force: true } to show it again.
 */
export function maybeShowOnboarding({ force = false } = {}) {
    if (!force && store.state.onboardingComplete) return false;
    openOnboardingModal();
    return true;
}

/** Replay the welcome flow regardless of completion state. */
export function replayOnboarding() {
    openOnboardingModal();
}

export function initOnboarding() {
    wireOnboarding();
}
