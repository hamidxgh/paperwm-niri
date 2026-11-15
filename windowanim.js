/**
 * elementary-OS-style window open/close animations (PaperWM Niri).
 *
 *   open : the window rises ~60 px from below while fading in   (ease-out)
 *   close: the window sinks ~60 px downward while fading out    (ease-in)
 *
 * Only NORMAL windows are affected; dialogs, menus and minimize effects keep GNOME's defaults.
 * GNOME's own `map`/`destroy` handlers are blocked and replaced by ours, which reuse GNOME's
 * bookkeeping (_shouldAnimateActor, _destroying, _destroyWindowDone), so nothing is leaked.
 * Respects the system "Animations" switch.
 */
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const OPEN_MS = 300;
const CLOSE_MS = 220;
const OFFSET = 60;

let blocked = [];
let connected = [];
let origGetType = null;

function animationsEnabled() {
    return St.Settings.get().enable_animations;
}

/** Animate any actor (window actor or PaperWM clone) rising into place. */
export function slideIn(actor) {
    if (!actor || !animationsEnabled())
        return;
    actor.remove_transition('translation-y');
    actor.translation_y = OFFSET;
    actor.opacity = 0;
    actor.ease({
        translation_y: 0,
        opacity: 255,
        duration: OPEN_MS,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        onStopped: () => {
            actor.translation_y = 0;
            actor.opacity = 255;
        },
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
        translation_y: OFFSET,
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
