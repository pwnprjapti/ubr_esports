/**
 * UBR Esports - Global UI Tap Sound
 * Plays a clean, modern, tactile gaming tap sound on every button and link click.
 */
(function () {
    'use strict';

    let audioCtx = null;
    let tapBuffer = null;
    let lastPlayedTime = 0;
    let isInitialized = false;

    // Build the synthesized gaming tap sound buffer directly in memory (zero network latency)
    function buildTapBuffer(ctx) {
        if (!ctx) return null;
        try {
            const sampleRate = ctx.sampleRate || 44100;
            const duration = 0.042; // 42ms - ultra snappy, gaming responsive
            const numSamples = Math.floor(sampleRate * duration);
            const buffer = ctx.createBuffer(1, numSamples, sampleRate);
            const data = buffer.getChannelData(0);

            for (let i = 0; i < numSamples; i++) {
                const t = i / sampleRate;

                // 1. Tactile click transient (first 3.5ms): high crisp snap at ~3600Hz & 5200Hz
                const click = t < 0.0035 
                    ? (Math.sin(2 * Math.PI * 3600 * t) + 0.4 * Math.sin(2 * Math.PI * 5200 * t)) * Math.exp(-t * 1200) * 0.45 
                    : 0;

                // 2. Gaming UI pitch sweep: downward tactical chirp from 2250Hz down to 1250Hz
                // Classic signature feedback of modern esports/gaming UI (like Valorant / BGMI menu taps)
                const freq = 1250 + 1000 * Math.exp(-t * 110);
                const phase = 2 * Math.PI * freq * t;
                
                // Primary futuristic tone
                const primary = Math.sin(phase) * Math.exp(-t * 90);
                // Subtle harmonic for metallic clarity
                const overtone = 0.28 * Math.sin(phase * 1.75) * Math.exp(-t * 130);

                // 3. Subtle micro-sparkle
                const sparkle = t < 0.003 ? (Math.random() * 2 - 1) * 0.08 * Math.exp(-t * 900) : 0;

                // Master Envelope: instant attack, snappy exponential decay
                const envelope = Math.exp(-t * 85);
                let sample = (click + (primary + overtone) * 0.65 + sparkle) * envelope * 0.45;

                // Soft clip using tanh
                data[i] = Math.tanh ? Math.tanh(sample * 1.15) * 0.82 : Math.max(-1, Math.min(1, sample));
            }
            return buffer;
        } catch (e) {
            return null;
        }
    }

    // Get or initialize AudioContext
    function getAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
                tapBuffer = buildTapBuffer(audioCtx);
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
        if (audioCtx && !tapBuffer) {
            tapBuffer = buildTapBuffer(audioCtx);
        }
        return audioCtx;
    }

    // Fallback HTML5 audio element
    let fallbackAudio = null;
    function playFallbackAudio() {
        try {
            if (!fallbackAudio) {
                fallbackAudio = new Audio('/sounds/tap.wav');
                fallbackAudio.volume = 0.45;
            }
            // Clone or reset to allow rapid replay
            const sound = fallbackAudio.cloneNode();
            sound.volume = 0.45;
            sound.play().catch(() => {});
        } catch (e) {}
    }

    // Main play function
    function playTapSound() {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        // Throttle rapid clicks (prevent double sound if nested elements trigger within 35ms)
        if (now - lastPlayedTime < 35) {
            return;
        }
        lastPlayedTime = now;

        try {
            const ctx = getAudioContext();
            if (ctx && tapBuffer) {
                const source = ctx.createBufferSource();
                source.buffer = tapBuffer;
                source.connect(ctx.destination);
                source.start(0);
                return;
            }
        } catch (e) {}

        // Fallback if AudioContext wasn't ready
        playFallbackAudio();
    }

    // Expose globally
    window.playTapSound = playTapSound;

    // Comprehensive selector matching all buttons, links, and clickable UI elements
    const CLICKABLE_SELECTOR = [
        'button',
        'a',
        'input[type="button"]',
        'input[type="submit"]',
        'input[type="reset"]',
        '[role="button"]',
        '[role="tab"]',
        '[onclick]',
        '.btn',
        '.slot-btn',
        '.pay-btn',
        '.nav-btn',
        '.action-btn',
        '.tab-btn',
        '.reset-filter-btn',
        '.modal-close-btn',
        '.modal-team-item',
        '.nav-toggle',
        '.bottom-nav-item',
        '.category-card',
        '.ref-copy-btn',
        '.ref-share-btn',
        '.nav-link',
        '.user-registered-teams-link',
        '.profile-circle',
        '.sidebar-toggle-btn',
        '.btn-icon',
        '.badge-btn'
    ].join(', ');

    // Elements that should be EXCLUDED (e.g. typing inputs, textareas)
    function isIgnoredInput(el) {
        if (!el) return false;
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'textarea' || tag === 'select') return true;
        if (tag === 'input') {
            const type = (el.type || '').toLowerCase();
            return !['button', 'submit', 'reset', 'checkbox', 'radio'].includes(type);
        }
        return false;
    }

    // Handle click event with capture phase
    function handleClick(e) {
        if (!e || !e.target) return;

        // Don't play when clicking inside text inputs or textareas
        if (isIgnoredInput(e.target)) return;

        // Check if clicked element or any ancestor is a clickable target
        const clickable = e.target.closest(CLICKABLE_SELECTOR);
        if (!clickable) return;

        // Skip disabled elements
        if (clickable.disabled || clickable.getAttribute('aria-disabled') === 'true') {
            return;
        }

        playTapSound();
    }

    // Listen to document clicks in CAPTURE phase (runs even if child handlers stop propagation)
    document.addEventListener('click', handleClick, { capture: true, passive: true });

    // Pre-unlock AudioContext on first user interaction anywhere on the screen
    function unlockAudio() {
        getAudioContext();
        ['click', 'pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach(evt => {
            document.removeEventListener(evt, unlockAudio);
        });
    }

    ['click', 'pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach(evt => {
        document.addEventListener(evt, unlockAudio, { capture: true, passive: true, once: true });
    });
})();
