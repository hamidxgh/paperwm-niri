/**
 * Spring-loaded scrolling for drag-and-drop (PaperWM Niri).
 *
 * While the primary button is held (e.g. dragging a file out of Files or a link out of a browser),
 * hovering over a peeking neighbour window, or the very screen edge, scrolls that neighbour into
 * view after a short dwell, so the drop target becomes reachable. Keep hovering and it continues
 * one window at a time, like macOS spring-loaded folders / niri's DnD edge scrolling.
 *
 * App-initiated drags hold an X pointer grab, so the shell never sees motion events; GNOME's
 * PointerWatcher polls the pointer instead (and stops polling while the user is idle).
 */
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Tiling, Utils } from './imports.js';

const POLL_MS = 50;     // pointer sampling while it moves
const DWELL_MS = 350;   // hover time before the neighbour scrolls in
const REPEAT_MS = 300;  // pause after a scroll before the next step can start
const EDGE_PX = 3;      // screen-edge hot zone (works even when nothing peeks)
const RELEASE_POLL_MS = 100;
const RELEASE_MAX_MS = 60000;

let watch = null;
let dwellId = 0;
let repeatId = 0;
let target = null;
let releaseId = 0;
let landed = null;  // window the drag scrolled to; focused when the button is released

export function enable() {
    watch = Utils.addPointerWatch(POLL_MS, (x, y) => evaluate(x, y));
}

export function disable() {
    watch?.remove();
    watch = null;
    cancel();
    stopReleaseWatch();
}

function stopReleaseWatch() {
    if (releaseId) {
        GLib.source_remove(releaseId);
        releaseId = 0;
    }
    landed = null;
}

/** After the drop (button released), make the window we scrolled to the active one. */
function watchForRelease(mw) {
    landed = mw;
    if (releaseId)
        return;
    let waited = 0;
    releaseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RELEASE_POLL_MS, () => {
        waited += RELEASE_POLL_MS;
        if (buttonHeld() && waited < RELEASE_MAX_MS)
            return GLib.SOURCE_CONTINUE;
        releaseId = 0;
        const mw = landed;
        landed = null;
        if (mw?.get_compositor_private() && !busy() && waited < RELEASE_MAX_MS)
            Main.activateWindow(mw);
        return GLib.SOURCE_REMOVE;
    });
}

function cancel() {
    if (dwellId) {
        GLib.source_remove(dwellId);
        dwellId = 0;
    }
    if (repeatId) {
        GLib.source_remove(repeatId);
        repeatId = 0;
    }
    target = null;
}

function buttonHeld() {
    const [, , mods] = global.get_pointer();
    return (mods & Clutter.ModifierType.BUTTON1_MASK) !== 0;
}

/** Shell UI that owns the pointer (overview, menus, PaperWM's own window grab) — leave it alone. */
function busy() {
    return Tiling.inGrab || Main.overview.visible || Main.modalCount > 0;
}

function spaceAt(x, y) {
    const monitor = Utils.monitorAtPoint(x, y);
    return monitor ? Tiling.spaces?.monitors?.get(monitor) : null;
}

function windowAt(space, x, y) {
    for (const column of space) {
        for (const mw of column) {
            if (mw.minimized)
                continue;
            const f = mw.get_frame_rect();
            if (x >= f.x && x < f.x + f.width && y >= f.y && y < f.y + f.height)
                return mw;
        }
    }
    return null;
}

/** The window that should scroll in for a drag at (x, y), or null. */
function targetAt(x, y) {
    const space = spaceAt(x, y);
    if (!space || space.length < 2 || !space.selectedWindow)
        return [null, null];

    const selected = space.selectedWindow;
    const under = windowAt(space, x, y);
    if (under && under !== selected && Tiling.isTiled(under))
        return [under, space];

    // Screen-edge hot zone: step to the neighbour column in that direction.
    const m = space.monitor;
    const i = space.indexOf(selected);
    let j = -1;
    if (x <= m.x + EDGE_PX)
        j = i - 1;
    else if (x >= m.x + m.width - 1 - EDGE_PX)
        j = i + 1;
    if (j >= 0 && j < space.length)
        return [space[j][0], space];

    return [null, null];
}

function evaluate(x, y) {
    if (!buttonHeld() || busy()) {
        cancel();
        return;
    }
    if (repeatId)
        return; // just scrolled; let the layout settle

    const [next, space] = targetAt(x, y);
    if (next === target)
        return;

    if (dwellId) {
        GLib.source_remove(dwellId);
        dwellId = 0;
    }
    target = next;
    if (!next)
        return;

    dwellId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DWELL_MS, () => {
        dwellId = 0;
        const [px, py] = global.get_pointer();
        const [still] = targetAt(px, py);
        if (!buttonHeld() || busy() || still !== next) {
            target = null;
            return GLib.SOURCE_REMOVE;
        }

        Tiling.ensureViewport(next, space);
        watchForRelease(next);
        target = null;

        // Continue stepping while the pointer keeps hovering (it may not move at all).
        repeatId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REPEAT_MS, () => {
            repeatId = 0;
            const [rx, ry] = global.get_pointer();
            evaluate(rx, ry);
            return GLib.SOURCE_REMOVE;
        });
        return GLib.SOURCE_REMOVE;
    });
}
