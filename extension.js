import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import {
    Utils, Settings, Gestures, Keybindings, LiveAltTab, Navigator,
    Stackoverlay, Scratch, Workspace, Tiling, Topbar, Patches, App, Grab, DndScroll
} from './imports.js';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

/**
   The currently used modules
     - tiling is the main module, responsible for tiling and workspaces

     - navigator is used to initiate a discrete navigation.
       Focus is only switched when the navigation is done.

     - keybindings is a utility wrapper around mutters keybinding facilities.

     - scratch is used to manage floating windows, or scratch windows.

     - liveAltTab is a simple altTab implementiation with live previews.

     - stackoverlay is somewhat kludgy. It makes clicking on the left or right
       edge of the screen always activate the partially (or sometimes wholly)
       concealed window at the edges.

     - app creates new windows based on the current application. It's possible
       to create custom new window handlers.

     - Patches is used for monkey patching gnome shell behavior which simply
       doesn't fit paperwm.

     - topbar adds the workspace name to the topbar and styles it.

     - gestures is responsible for 3-finger swiping (only works in wayland).

     Notes of ordering:
        - several modules import settings, so settings should be before them;
          - settings.js should not depend on other paperwm modules;
        - Settings should be before Patches (for reverse order disable);
 */

export default class PaperWM extends Extension {
    modules = [
        Utils, Settings, Patches,
        Gestures, Keybindings, LiveAltTab, Navigator, Stackoverlay, Scratch,
        Workspace, Tiling, Topbar, App, Grab, DndScroll,
    ];

    #userStylesheet = null;
    #themeChangedId = 0;
    #reloadTimeout = 0;
    /**
     * load_stylesheet emits ThemeContext 'changed'. If we reload from that
     * signal without a guard, gnome-shell hits "too much recursion" and freezes
     * the topbar for minutes after login/unlock.
     */
    #reloadingStyles = false;

    enable() {
        console.log(`#PaperWM enabled (proportion)`);
        this.enableUserConfig();
        this.enableUserStylesheet();
        // Unlock / theme switch rebuilds St.Theme and drops loaded stylesheets.
        // Re-apply user.css once, debounced + re-entry guarded.
        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        this.#themeChangedId = themeContext.connect('changed', () => {
            if (this.#reloadingStyles) {
                return;
            }
            if (this.#reloadTimeout) {
                GLib.source_remove(this.#reloadTimeout);
            }
            this.#reloadTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                this.#reloadTimeout = 0;
                this.enableUserStylesheet();
                return GLib.SOURCE_REMOVE;
            });
        });

        // run enable method (with extension argument on all modules)
        this.modules.forEach(m => {
            if (m['enable']) {
                m.enable(this);
            }
        });
    }

    disable() {
        console.log('#PaperWM disabled');
        this.prepareForDisable();
        if (this.#reloadTimeout) {
            GLib.source_remove(this.#reloadTimeout);
            this.#reloadTimeout = 0;
        }
        if (this.#themeChangedId) {
            St.ThemeContext.get_for_stage(global.stage).disconnect(this.#themeChangedId);
            this.#themeChangedId = 0;
        }
        [...this.modules].reverse().forEach(m => {
            if (m['disable']) {
                m.disable();
            }
        });

        this.disableUserStylesheet();
    }

    /**
     * Prepares PaperWM for disable across modules.
     */
    prepareForDisable() {
        /**
         * Finish any navigation (e.g. workspace switch view).
         * Can put PaperWM in a breakable state of lock/disable
         * while navigating.
         */
        Navigator.finishNavigation();
    }

    getConfigDir() {
        return Gio.file_new_for_path(`${GLib.get_user_config_dir()}/paperwm`);
    }

    configDirExists() {
        return this.getConfigDir().query_exists(null);
    }

    hasUserConfigFile() {
        return this.getConfigDir().get_child("user.js").query_exists(null);
    }

    hasUserStyleFile() {
        return this.getConfigDir().get_child("user.css").query_exists(null);
    }

    /**
     * Update the metadata.json in user config dir to always keep it up to date.
     * We copy metadata.json to the config directory so gnome-shell-mode
     * knows which extension the files belong to (ideally we'd symlink, but
     * that trips up the importer: Extension.imports.<complete> in
     * gnome-shell-mode crashes gnome-shell..)
     */
    updateUserConfigFiles() {
        if (!this.configDirExists()) {
            return;
        }
        const configDir = this.getConfigDir();

        try {
            const metadata = this.dir.get_child("metadata.json");
            metadata.copy(configDir.get_child("metadata.json"), Gio.FileCopyFlags.OVERWRITE, null, null);
        } catch (error) {
            console.error('PaperWM', `could not update user config metadata.json: ${error}`);
        }

        if (!this.hasUserStyleFile()) {
            try {
                const user = this.dir.get_child("config/user.css");
                user.copy(configDir.get_child("user.css"), Gio.FileCopyFlags.NONE, null, null);
            } catch (error) {
                console.error('PaperWM', `could not update user config metadata.json: ${error}`);
            }
        }
    }

    installConfig() {
        const configDir = this.getConfigDir();
        // if user config folder doesn't exist, create it
        if (!this.configDirExists()) {
            configDir.make_directory_with_parents(null);
        }
    }

    enableUserConfig() {
        if (!this.configDirExists()) {
            try {
                this.installConfig();

                const configDir = this.getConfigDir().get_path();
                Main.notify("PaperWM", `Created user configuration folder: ${configDir}`);
            } catch (e) {
                Main.notifyError("PaperWM", `Failed create user configuration folder: ${e.message}`);
            }
        }

        this.updateUserConfigFiles();

        /* TODO: figure out something here
        fmuellner:
        > you can't
        > as I said, it's part of gjs legacy imports
        > you'll have to do something like const userMod = await import(${this.getConfigDir()}/user.js)
        */
        /*
        // add to searchpath if user has config file and action user.js
        if (this.hasUserConfigFile()) {
            let SearchPath = Extension.imports.searchPath;
            let path = this.getConfigDir().get_path();
            if (!SearchPath.includes(path)) {
                SearchPath.push(path);
            }
        }
        */
    }

    /**
     * Loads user.css. Re-entrancy safe: load_stylesheet may emit theme
     * 'changed'; we keep #reloadingStyles until the next idle.
     */
    enableUserStylesheet() {
        if (this.#reloadingStyles) {
            return;
        }
        const file = this.getConfigDir().get_child("user.css");
        if (!file.query_exists(null)) {
            return;
        }

        this.#reloadingStyles = true;
        try {
            const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
            if (this.#userStylesheet) {
                try {
                    theme.unload_stylesheet(this.#userStylesheet);
                } catch (_e) {
                    /* theme may already have dropped it on rebuild */
                }
            }
            this.#userStylesheet = file;
            theme.load_stylesheet(this.#userStylesheet);
        } catch (error) {
            console.error('PaperWM', `load user.css failed: ${error}`);
        } finally {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this.#reloadingStyles = false;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    /**
     * Unloads user.css styles (if user.css present in ~/.config/paperwm).
     */
    disableUserStylesheet() {
        if (!this.#userStylesheet) {
            return;
        }
        this.#reloadingStyles = true;
        try {
            let themeContext = St.ThemeContext.get_for_stage(global.stage);
            themeContext.get_theme().unload_stylesheet(this.#userStylesheet);
        } catch (_e) {
            /* ignore */
        }
        this.#userStylesheet = null;
        this.#reloadingStyles = false;
    }

    spawnPager(content) {
        const quoted = GLib.shell_quote(content);
        Util.spawn(["sh", "-c", `echo -En ${quoted} | gedit --new-window -`]);
    }
}
