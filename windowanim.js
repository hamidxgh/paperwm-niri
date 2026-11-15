/**
 * Window open/close animations (PaperWM Niri).
 *
 *   open : grows from 75% width (92% height) to full size, anchored on its right edge, with
 *          Hyprland/Omarchy's easeOutQuint curve (330 ms) and a quick fade-in (140 ms): the
 *          timings Omarchy ships in looknfeel.lua (windowsIn 3.28, fadeIn 1.38).
 *   close: sinks ~140 px downward while fading out (260 ms, ease-in).
 *
 * Only NORMAL windows are affected; dialogs, menus and minimize effects keep GNOME's defaults.
 * GNOME's own `map`/`destroy` handlers are blocked and replaced by ours, which reuse GNOME's
 * bookkeeping (_shouldAnimateActor, _destroying, _destroyWindowDone), so nothing is leaked.
 * Respects the system "Animations" switch.
 */
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const OPEN_MS = 330;        // grow duration (Omarchy windowsIn: 328 ms)
const FADE_IN_MS = 140;     // fade duration (Omarchy fadeIn: 138 ms)
const START_SCALE_X = 0.75; // starts at 75% width…
const START_SCALE_Y = 0.92; // …and 92% height, anchored on its right edge
const CLOSE_MS = 260;
const CLOSE_OFFSET_Y = 140;

let blocked = [];
let connected = [];
let origGetType = null;

function animationsEnabled() {
    return St.Settings.get().enable_animations;
}

// Omarchy's easeOutQuint is cubic-bezier(0.23, 1, 0.32, 1) ≈ the standard quint ease-out.
const easeOutQuint = t => 1 - Math.pow(1 - t, 5);
const easeOutQuad = t => 1 - (1 - t) * (1 - t);

/**
 * Grow an actor (window actor or PaperWM clone) into place from its right edge.
 * Clutter skips transitions on unmapped actors, and PaperWM keeps new windows hidden until it
 * has placed them, so the motion starts when the actor actually appears. Actors that share a
 * `startTime` (a window's clone and its real actor) stay in sync even if they appear at different
 * moments: a late one joins the motion where it already is.
 */
export function slideIn(actor, startTime = GLib.get_monotonic_time()) {
    if (!actor || !animationsEnabled())
        return;
    actor.remove_transition('scale-x');
    actor.remove_transition('scale-y');
    actor.remove_transition('opacity');
    actor.set_pivot_point(1.0, 0.5);          // right edge, vertical centre
    actor.scale_x = START_SCALE_X;
    actor.scale_y = START_SCALE_Y;
    actor.opacity = 0;

    const finish = () => {
        actor.scale_x = 1;
        actor.scale_y = 1;
        actor.set_pivot_point(0, 0);
    };

    const run = () => {
        const elapsed = Math.max(0, (GLib.get_monotonic_time() - startTime) / 1000);

        if (elapsed < OPEN_MS) {
            const p = easeOutQuint(elapsed / OPEN_MS);
            actor.scale_x = START_SCALE_X + (1 - START_SCALE_X) * p;
            actor.scale_y = START_SCALE_Y + (1 - START_SCALE_Y) * p;
            actor.ease({
                scale_x: 1,
                scale_y: 1,
                duration: OPEN_MS - elapsed,
                mode: Clutter.AnimationMode.EASE_OUT_QUINT,
                onStopped: finish,
            });
        } else {
            finish();
        }

        if (elapsed < FADE_IN_MS) {
            actor.opacity = Math.round(255 * easeOutQuad(elapsed / FADE_IN_MS));
            actor.ease({
                opacity: 255,
                duration: FADE_IN_MS - elapsed,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onStopped: () => { actor.opacity = 255; },
            });
        } else {
            actor.opacity = 255;
        }
    };

    if (actor.mapped) {
        run();
    } else {
        const id = actor.connect('notify::mapped', () => {
            if (!actor.mapped)
                return;
            actor.disconnect(id);
            run();
        });
    }
}

function isNormal(actor) {
    return origGetType.call(Main.wm, actor) === Meta.WindowType.NORMAL;
}

function onMap(shellwm, actor) {
    const wm = Main.wm;
    if (!isNormal(actor) || !wm._shouldAnimateActor(actor, [Meta.WindowType.NORMAL])) {
        wm._mapWindow(shellwm, actor);          // GNOME default (dialogs etc.)
        return;
    }
    // Let GNOME run its bookkeeping, but skip its own NORMAL animation.
    actor._paperwmCustomAnim = true;
    wm._mapWindow(shellwm, actor);
    delete actor._paperwmCustomAnim;
    actor.show();
    slideIn(actor);
}

function onDestroy(shellwm, actor) {
    const wm = Main.wm;
    if (!isNormal(actor) || !animationsEnabled() ||
        !wm._shouldAnimateActor(actor, [Meta.WindowType.NORMAL])) {
        wm._destroyWindow(shellwm, actor);      // GNOME default
        return;
    }
    const window = actor.meta_window;
    window.disconnectObject(actor);
    if (window.is_attached_dialog())
        wm._checkDimming(window.get_transient_for());

    wm._destroying.add(actor);
    actor.remove_all_transitions();
    actor.ease({
        translation_y: CLOSE_OFFSET_Y,
        opacity: 0,
        duration: CLOSE_MS,
        mode: Clutter.AnimationMode.EASE_IN_CUBIC,
        onStopped: () => wm._destroyWindowDone(shellwm, actor),
    });
}

export function enable() {
    const wm = Main.wm;
    const shellwm = wm._shellwm;
    origGetType = wm._getAnimationWindowType;
    // During our map handler GNOME sees "no animation type" → it completes the map immediately.
    wm._getAnimationWindowType = actor =>
        actor._paperwmCustomAnim ? null : origGetType.call(wm, actor);

    for (const [signal, handler] of [['map', onMap], ['destroy', onDestroy]]) {
        const id = GObject.signal_handler_find(shellwm, { signalId: signal });
        if (id) {
            GObject.signal_handler_block(shellwm, id);
            blocked.push(id);
        }
        connected.push(shellwm.connect(signal, handler));
    }
}

export function disable() {
    const shellwm = Main.wm._shellwm;
    connected.forEach(id => shellwm.disconnect(id));
    blocked.forEach(id => GObject.signal_handler_unblock(shellwm, id));
    connected = [];
    blocked = [];
    if (origGetType) {
        Main.wm._getAnimationWindowType = origGetType;
        origGetType = null;
    }
}
