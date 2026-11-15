/**
 * Window open/close animations (PaperWM Niri).
 *
 *   open : grows smoothly from 10% width (90% height) to full size, anchored on its right edge,
 *          starting once the app has painted (ease-out cubic, 450 ms, 220 ms fade-in).
 *   close: shrinks horizontally, left edge sweeping to the right edge (height unchanged,
 *          350 ms ease-in-out), fading out only near the end.
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

const OPEN_MS = 450;        // grow duration
const FADE_IN_MS = 220;     // fade-in duration
const START_SCALE_X = 0.1;  // opens at 10% width…
const START_SCALE_Y = 0.9;  // …and 90% height, anchored on its right edge
const CLOSE_MS = 350;       // shrink duration: left edge sweeps to the right edge
const CLOSE_FADE_DELAY_MS = 170;  // stay visible while shrinking, fade out at the end
const FIRST_FRAME_WAIT_MS = 300;  // start anyway if the app hasn't painted by then

let blocked = [];
let connected = [];
let origGetType = null;

function animationsEnabled() {
    return St.Settings.get().enable_animations;
}

const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeOutQuad = t => 1 - (1 - t) * (1 - t);

/**
 * Grow an actor (window actor or PaperWM clone) into place from its right edge.
 * Clutter skips transitions on unmapped actors, and PaperWM keeps new windows hidden until it
 * has placed them, so the motion starts when the actor actually appears. Actors that share a
 * `startTime` (a window's clone and its real actor) stay in sync even if they appear at different
 * moments: a late one joins the motion where it already is.
 * With `waitFirstFrame`, the grow starts when the app has painted its first frame (apps paint
 * ~100-150 ms after mapping; starting earlier would hide most of the motion).
 */
export function slideIn(actor, startTime = null, { waitFirstFrame = false } = {}) {
    if (!actor || !animationsEnabled())
        return;
    const token = (actor._paperwmGrowToken ?? 0) + 1;   // newest call wins
    actor._paperwmGrowToken = token;
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
        if (actor._paperwmGrowToken !== token)
            return;
        startTime ??= GLib.get_monotonic_time();
        const elapsed = Math.max(0, (GLib.get_monotonic_time() - startTime) / 1000);

        if (elapsed < OPEN_MS) {
            const p = easeOutCubic(elapsed / OPEN_MS);
            actor.scale_x = START_SCALE_X + (1 - START_SCALE_X) * p;
            actor.scale_y = START_SCALE_Y + (1 - START_SCALE_Y) * p;
            actor.ease({
                scale_x: 1,
                scale_y: 1,
                duration: OPEN_MS - elapsed,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
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

    const whenMapped = () => {
        if (actor.mapped) {
            run();
            return;
        }
        const id = actor.connect('notify::mapped', () => {
            if (!actor.mapped)
                return;
            actor.disconnect(id);
            run();
        });
    };

    if (!waitFirstFrame) {
        whenMapped();
        return;
    }
    let started = false;
    const start = () => {
        if (started)
            return;
        started = true;
        whenMapped();
    };
    const ffId = actor.connect('first-frame', () => {
        actor.disconnect(ffId);
        start();
    });
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, FIRST_FRAME_WAIT_MS, () => {
        if (!started) {
            try { actor.disconnect(ffId); } catch (_e) { /* already disconnected */ }
            start();
        }
        return GLib.SOURCE_REMOVE;
    });
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
    slideIn(actor, null, { waitFirstFrame: true });
}

/** Shrink an actor toward its right edge (left → right), fading out only near the end. */
function shrinkOut(target, done) {
    target.set_pivot_point(1.0, 0.5);
    target.ease({
        scale_x: START_SCALE_X,
        duration: CLOSE_MS,
        mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
        onStopped: done,
    });
    target.ease({
        opacity: 0,
        delay: CLOSE_FADE_DELAY_MS,
        duration: CLOSE_MS - CLOSE_FADE_DELAY_MS,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
    });
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
    actor._paperwmGrowToken = (actor._paperwmGrowToken ?? 0) + 1;   // cancel a pending grow
    // While Super is held, PaperWM shows windows through clones and hides the real actors, then
    // drops the clone as soon as the window is gone. Animate a live copy in the clone's place.
    const clone = window.clone;
    let target = actor;
    let ghost = null;
    if (!actor.visible && clone?.visible && clone.get_parent()) {
        ghost = new Clutter.Clone({ source: actor });
        clone.get_parent().add_child(ghost);
        const inner = clone.cloneActor;
        ghost.set_position(clone.x + (inner?.x ?? 0), clone.y + (inner?.y ?? 0));
        target = ghost;
    }
    shrinkOut(target, () => {
        ghost?.destroy();
        wm._destroyWindowDone(shellwm, actor);
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
