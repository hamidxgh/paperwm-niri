# PaperWM Niri

**Scrolling tiling for GNOME that feels like [niri](https://github.com/YaLTeR/niri) / [Omarchy](https://omarchy.org).**
Windows sit on an endless horizontal strip; the focused one fills the screen while its neighbours peek in from the sides.

Works on GNOME 45 – 50, on both X11 and Wayland. No root needed.

```
 one window            leftmost focused             middle focused
┌──────────────────┐  ┌──────────────────┬─┐  ┌─┬───────────────┬─┐
│                  │  │                  │ │  │ │               │ │
│     focused      │  │     focused      │▒│  │▒│    focused    │▒│
│                  │  │                  │ │  │ │               │ │
└──────────────────┘  └──────────────────┴─┘  └─┴───────────────┴─┘
  gaps on all sides     edge gap · ~94% · 5%     5% · ~89% · 5%
```

## Features

- **Niri-style focus layout.** One window gets full width; with several, the focused window takes the screen and the neighbours peek 5% on each side. Edge windows grow into the empty side. Gaps stay visible on every screen edge.
- **Your sizes win.** Maximized, fullscreen and manually resized (Super+R, etc.) windows are left alone.
- **Focus border follows your theme.** Write a hex colour to `~/.config/paperwm/selection-color` and the border updates live. This is handy for theme switchers.
- **Move across monitors.** Moving a window past the end of the strip sends it to the neighbouring monitor.
- **Stable styling.** `~/.config/paperwm/user.css` is re-applied after screen unlock and shell-theme changes, without freezing the top bar.
- **Smoother animations** (cubic easing).
- Plus everything PaperWM already has: scratch layer, window stacking, touchpad gestures, per-app rules, and per-workspace settings.

## Install

```bash
git clone https://github.com/hamidxgh/paperwm-niri
cd paperwm-niri
./install.sh
```

Then reload GNOME Shell:
- **X11:** press Alt+F2, type `r`, press Enter.
- **Wayland:** log out and back in.

If upstream PaperWM is installed, the installer turns it off, because the two can't run at the same time. Your PaperWM settings and keybindings carry over, since both use the same settings.

This fork installs under its own ID (`paperwm-niri@hamidxgh.github.com`), so GNOME extension updates never overwrite it.

### Uninstall

```bash
gnome-extensions uninstall paperwm-niri@hamidxgh.github.com
```

## Default keys

| Key | Action |
|---|---|
| Super + ← / → / ↑ / ↓ | Focus window left / right / up / down |
| Super + Ctrl + ← / → | Move window left / right (past the edge: to the next monitor) |
| Super + R / Super + Alt + R | Cycle window width forward / back |
| Super + F | Toggle full width |
| Super + Shift + F | Fullscreen |
| Super + C | Centre window |
| Super + I / Super + O | Stack window into the column on the left / pop it out |
| Super + Tab | Switch windows (live) |
| Super + Shift + ← / → | Focus monitor left / right |
| Super + Shift + Ctrl + ← / → | Move window to monitor left / right |
| Super + Shift + Esc | Move window to / from the floating scratch layer |
| Super + Ctrl + Esc | Show / hide the scratch layer |
| Super + Backspace | Close window |

You can change any of these in the extension's settings:

```bash
gnome-extensions prefs paperwm-niri@hamidxgh.github.com
```

## Configure

| What | Where |
|---|---|
| Gaps, margins, animation speed, keybindings, app rules | Extension settings (command above) |
| Focus border colour | `~/.config/paperwm/selection-color` (e.g. `#7aa2f7`) |
| Border width and corner radius | Extension settings → *Border \| Gaps \| Margins* |
| Extra styling | `~/.config/paperwm/user.css` |
| Peek size (default 5%) | `PEEK` in `ProportionalFocus` at the top of `tiling.js` |

The upstream [PaperWM documentation](https://github.com/paperwm/PaperWM#readme) still applies to everything not listed here: window rules, scratch layer, gestures and `user.js`.

## Updating from upstream PaperWM

```bash
git remote add upstream https://github.com/paperwm/PaperWM   # first time only
git fetch upstream --tags
git merge <release-tag>          # e.g. v50.0.2
./install.sh
```

If the merge reports conflicts on upstream files this fork removed (their README, CI or Nix files), keep them deleted with `git rm <file>`.

## Credits & licence

Built on [PaperWM](https://github.com/paperwm/PaperWM) by the PaperWM contributors. All of the core tiling engine is their work.
This fork is licensed under the same **GPL-3.0**; see [LICENSE](LICENSE).
