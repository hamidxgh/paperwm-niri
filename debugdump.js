/**
 * On-demand state dump for diagnosing "what I see vs where I click" mismatches.
 * Touch ~/.cache/paperwm-niri/dump-request (the `paperwm-dump` script does this) and the current
 * state of every window — real actor vs PaperWM clone, scale, translation, frame rect — is
 * written to ~/.cache/paperwm-niri/state.json.
 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { Tiling, Navigator } from './imports.js';

const DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'paperwm-niri']);
const REQUEST = GLib.build_filenamev([DIR, 'dump-request']);
const OUT = GLib.build_filenamev([DIR, 'state.json']);
let monitor = null;

function actorInfo(a) {
    if (!a)
        return null;
    let pos = null;
    try {
        const [x, y] = a.get_transformed_position();
        const [w, h] = a.get_transformed_size();
        pos = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    } catch (_e) { /* disposed */ }
    return {
        visible: a.visible, mapped: a.mapped, opacity: a.opacity,
        scale: [a.scale_x, a.scale_y], translation: [a.translation_x, a.translation_y],
        pivot: a.pivot_point ? [a.pivot_point.x, a.pivot_point.y] : null, onScreen: pos,
    };
}

function dump() {
    const out = [];
    for (const actor of global.get_window_actors()) {
        const mw = actor.meta_window;
        if (!mw)
            continue;
        const f = mw.get_frame_rect();
        out.push({
            title: mw.get_title(), wmClass: mw.get_wm_class(), focused: mw.has_focus(),
            type: mw.get_window_type(), above: mw.is_above(), transientFor: mw.get_transient_for()?.get_title() ?? null,
            scratch: Tiling.isScratch(mw), monitor: mw.get_monitor(),
            frame: { x: f.x, y: f.y, w: f.width, h: f.height },
            actor: actorInfo(actor),
            clone: actorInfo(mw.clone),
            cloneInner: actorInfo(mw.clone?.cloneActor),
            growToken: actor._paperwmGrowToken ?? null,
        });
    }
    const spaces = [];
    for (const [mon, sp] of Tiling.spaces?.monitors ?? []) {
        spaces.push({
            monitor: mon.index, cloneContainerX: sp.cloneContainer?.x, targetX: sp.targetX,
            actorY: sp.actor?.y, isAnimating: sp._isAnimating ?? null, selected: sp.selectedWindow?.get_title?.(),
        });
    }
    const flags = { navigating: Navigator.navigating ?? null, inGrab: !!Tiling.inGrab };
    GLib.file_set_contents(OUT, JSON.stringify({ time: new Date().toISOString(), flags, spaces, windows: out }, null, 1));
}

export function enable() {
    GLib.mkdir_with_parents(DIR, 0o755);
    const file = Gio.File.new_for_path(REQUEST);
    monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
    monitor.connect('changed', (_m, _f, _o, event) => {
        if (event === Gio.FileMonitorEvent.CHANGES_DONE_HINT || event === Gio.FileMonitorEvent.CREATED) {
            try {
                dump();
            } catch (e) {
                console.error('PaperWM debug dump failed', e);
            }
        }
    });
}

export function disable() {
    monitor?.cancel();
    monitor = null;
}
