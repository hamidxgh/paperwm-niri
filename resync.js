/**
 * Self-healing for PaperWM's "settle" step (PaperWM Niri).
 *
 * After moving windows, PaperWM runs Space.moveDone() from an animation's onComplete: it moves the
 * real windows to where their clones are, shows the real windows and hides the clones. When one
 * movement interrupts another (e.g. a resize during a scroll), that callback can be lost. The space
 * then stays "animating", windows stay as clones, and real windows can be left invisible but still
 * on screen — where they swallow clicks meant for what you see.
 *
 * Every 750 ms (low priority) this checks each space; if it has settled but is left in that state,
 * it runs moveDone() again. Normal operation is untouched: it never acts while anything moves,
 * during navigation, drag, preview or the overview.
 */
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Tiling, Navigator } from './imports.js';

const INTERVAL_MS = 750;
let timerId = 0;

function isMoving(actor) {
    return !!(actor?.get_transition('x') || actor?.get_transition('y'));
}

function needsResync(space) {
    if (!space?.cloneContainer || space.cloneContainer.x !== space.targetX || space.actor?.y !== 0)
        return false;
    if (isMoving(space.cloneContainer))
        return false;
    const windows = space.getWindows();
    if (windows.some(w => isMoving(w.clone)))
        return false;
    if (space._isAnimating)
        return true;
    return windows.some(w => {
        const actor = w.get_compositor_private();
        return actor && !actor.visible && !w.minimized && space.isPlaceable(w);
    });
}

function tick() {
    if (Navigator.navigating || Tiling.inGrab || Tiling.inPreview || Main.overview.visible)
        return GLib.SOURCE_CONTINUE;
    for (const space of Tiling.spaces?.monitors?.values() ?? []) {
        if (!needsResync(space))
            continue;
        try {
            space.moveDone();
        } catch (e) {
            console.error('PaperWM resync failed', e);
        }
    }
    return GLib.SOURCE_CONTINUE;
}

export function enable() {
    timerId = GLib.timeout_add(GLib.PRIORITY_LOW, INTERVAL_MS, tick);
}

export function disable() {
    if (timerId)
        GLib.source_remove(timerId);
    timerId = 0;
}
