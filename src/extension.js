const {Meta, St} = imports.gi;

const Main = imports.ui.main;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

/**
 * https://developer.mozilla.org/docs/Web/API/WindowOrWorkerGlobalScope/setTimeout
 * https://developer.mozilla.org/docs/Web/API/WindowOrWorkerGlobalScope/clearTimeout
 */
window.setTimeout = function(func, delay, ...args) {
    return GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
        func(...args);
        return GLib.SOURCE_REMOVE;
    });
};

window.clearTimeout = GLib.source_remove;


function getSettings() {
    let GioSSS = Gio.SettingsSchemaSource;
    let schemaSource = GioSSS.new_from_directory(
        Me.dir.get_child("schemas").get_path(),
        GioSSS.get_default(),
        false
    );
    let schemaObj = schemaSource.lookup(
        'net.evendanan.gnome.topBarVisual', true);
    if (!schemaObj) {
        throw new Error('cannot find schemas');
    }
    return new Gio.Settings({settings_schema: schemaObj});
}

class Extension {
    constructor() {
        this._actorSignalIds = null;
        this._windowSignalIds = null;
        this._settings = getSettings();
        this._currentTransparency = this._settings.get_int('transparency');
        this._currentBlur = this._settings.get_int('blur');
        this.settingChangeDebounce = null;
    }

    enable() {
        this._
        this._actorSignalIds = new Map();
        this._windowSignalIds = new Map();

        this._settings.connect('changed', this.topBarVisualSettingsChanged.bind(this));
        this._actorSignalIds.set(Main.overview, [
            Main.overview.connect('showing', this._updateTopBarVisual.bind(this)),
            Main.overview.connect('hiding', this._updateTopBarVisual.bind(this))
        ]);

        this._actorSignalIds.set(Main.sessionMode, [
            Main.sessionMode.connect('updated', this._updateTopBarVisual.bind(this))
        ]);

        for (const metaWindowActor of global.get_window_actors()) {
            this._onWindowActorAdded(metaWindowActor.get_parent(), metaWindowActor);
        }

        this._actorSignalIds.set(global.window_group, [
            global.window_group.connect('actor-added', this._onWindowActorAdded.bind(this)),
            global.window_group.connect('actor-removed', this._onWindowActorRemoved.bind(this))
        ]);

        this._actorSignalIds.set(global.window_manager, [
            global.window_manager.connect('switch-workspace', this._updateTopBarVisual.bind(this))
        ]);

        this._updateTopBarVisual();
    }

    topBarVisualSettingsChanged(settings, key) {
        if (key === 'transparency') {
            clearTimeout(this.settingChangeDebounce);
            this.settingChangeDebounce = setTimeout(() => {
                Main.panel.remove_style_class_name('transparent-top-bar--transparent-' + this._currentTransparency);
                this._updateTopBarVisual();
            }, 500);
        } else if (key === 'transparency-full') {
            clearTimeout(this.settingChangeDebounce);
            this.settingChangeDebounce = setTimeout(() => {
                Main.panel.remove_style_class_name('transparent-top-bar--transparent-' + this._currentTransparency);
                this._updateTopBarVisual();
            }, 500);
        } else if (key === 'blur') {
            clearTimeout(this.settingChangeDebounce);
            this.settingChangeDebounce = setTimeout(() => {
                Main.panel.remove_style_class_name('transparent-top-bar--blur-' + this._currentBlur);
                this._updateTopBarVisual();
            }, 500);
        }
    }

    disable() {
        for (const actorSignalIds of [this._actorSignalIds, this._windowSignalIds]) {
            for (const [actor, signalIds] of actorSignalIds) {
                for (const signalId of signalIds) {
                    actor.disconnect(signalId);
                }
            }
        }
        this._actorSignalIds = null;
        this._windowSignalIds = null;

        this._setTopBarVisual(false);
    }

    _onWindowActorAdded(container, metaWindowActor) {
        this._windowSignalIds.set(metaWindowActor, [
            metaWindowActor.connect('notify::allocation', this._updateTopBarVisual.bind(this)),
            metaWindowActor.connect('notify::visible', this._updateTopBarVisual.bind(this))
        ]);
    }

    _onWindowActorRemoved(container, metaWindowActor) {
        for (const signalId of this._windowSignalIds.get(metaWindowActor)) {
            metaWindowActor.disconnect(signalId);
        }
        this._windowSignalIds.delete(metaWindowActor);
        this._updateTopBarVisual();
    }

    _updateTopBarVisual() {
        global.log("_updateTopBarVisual called.");
        if (!Main.layoutManager.primaryMonitor) {
            return;
        }

        this._setTopBarVisual(true);
    }

    _setTopBarVisual(enabled) {
        Main.panel.remove_style_class_name('transparent-top-bar--transparent-' + this._currentTransparency);
        Main.panel.remove_style_class_name('transparent-top-bar--blur-' + this._currentBlur);

        if (enabled) {
            //need to determine which transparency to use: full-window or regular

            // Get all the windows in the active workspace that are in the primary monitor and visible.
            const workspaceManager = global.workspace_manager;
            const activeWorkspace = workspaceManager.get_active_workspace();
            const windows = activeWorkspace.list_windows().filter(metaWindow => {
                return metaWindow.is_on_primary_monitor()
                    && metaWindow.showing_on_its_workspace()
                    && !metaWindow.is_hidden()
                    && metaWindow.get_window_type() !== Meta.WindowType.DESKTOP;
            });

            // Check if at least one window is near enough to the panel.
            const panelTop = Main.panel.get_transformed_position()[1];
            const panelBottom = panelTop + Main.panel.get_height();
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const isNearEnough = windows.some(metaWindow => {
                const verticalPosition = metaWindow.get_frame_rect().y;
                return verticalPosition < panelBottom + 5 * scale;
            });
            
            const transparency = isNearEnough? this._settings.get_int("transparency-full") : this._settings.get_int("transparency");
            const blur = this._settings.get_int("blur");
            

            global.log("_setTopBarVisual: isNearEnough: "+isNearEnough+", transparency: "+transparency+", blur: "+blur);
            Main.panel.remove_style_class_name('transparent-top-bar--solid');
            Main.panel.add_style_class_name('transparent-top-bar--not-solid');
            Main.panel.add_style_class_name('transparent-top-bar--transparent-' + transparency);
            Main.panel.add_style_class_name('transparent-top-bar--blur-' + blur);

            this._currentTransparency = transparency;
            this._currentBlur = blur;
        } else {
            global.log("_setTopBarVisual disabled");
            Main.panel.add_style_class_name('transparent-top-bar--solid');
            Main.panel.remove_style_class_name('transparent-top-bar--not-solid');
        }
    }

};

function init() {
    return new Extension();
}
