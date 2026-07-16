#!/usr/bin/env gjs

imports.gi.versions.Gtk = '4.0';
const { Gtk, Gio, GLib } = imports.gi;
const System = imports.system;

const CONFIG_FILE = GLib.get_user_config_dir() + '/prism-routines.json';

function loadRoutines() {
    try {
        let file = Gio.File.new_for_path(CONFIG_FILE);
        if (!file.query_exists(null)) return [];
        let [, contents] = file.load_contents(null);
        return JSON.parse(new TextDecoder().decode(contents));
    } catch (e) { return []; }
}

function saveRoutines(routines) {
    let file = Gio.File.new_for_path(CONFIG_FILE);
    file.replace_contents(new TextEncoder().encode(JSON.stringify(routines, null, 2)), null, false, Gio.FileCreateFlags.NONE, null);
}

function ensureAutostart() {
    const autostartDir = GLib.get_user_config_dir() + '/autostart';
    GLib.mkdir_with_parents(autostartDir, 0o755);
    const desktopFile = autostartDir + '/prism-routines-daemon.desktop';
    
    let file = Gio.File.new_for_path(desktopFile);
    if (!file.query_exists(null)) {
        let currentPath = Gio.File.new_for_commandline_arg(System.programInvocationName).get_path();
        
        let content = `[Desktop Entry]
Type=Application
Name=PRISM Routines (Daemon)
Exec=env PRISM_MODE=daemon ${currentPath}
Hidden=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
`;
        file.replace_contents(new TextEncoder().encode(content), null, false, Gio.FileCreateFlags.NONE, null);
        console.log("✅ [PRISM] Fichier d'autostart créé avec succès au premier lancement.");
    }
}

function startDaemon() {
    console.log("🚀 [PRISM Daemon] Démarrage du moteur d'automatisation en arrière-plan...");
    
    let routines = loadRoutines();
    let stateMemory = { lastMinute: "", apps: {}, wifi: "", mediaPlaying: false };

    let monitor = Gio.File.new_for_path(CONFIG_FILE).monitor_file(Gio.FileMonitorFlags.NONE, null);
    monitor.connect('changed', (m, file, otherFile, eventType) => {
        if (eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT) {
            console.log("🔄 [PRISM Daemon] Fichier modifié par l'interface ! Rechargement des règles...");
            routines = loadRoutines();
        }
    });

    function execAction(routine) {
        console.log(`⚡ [Exécution] Routine : ${routine.name}`);
        let cmd = '';
        
        switch (routine.act_type) {
            case 'Fermer une application': cmd = `killall ${routine.act_val}`; break;
            case 'Economie d\'energie': cmd = `powerprofilesctl set power-saver`; break;
            case 'Activer le clavier virtuel': cmd = `gsettings set org.gnome.desktop.a11y.applications screen-keyboard-enabled true`; break;
            case 'Mettre en pause la musique': cmd = `playerctl pause`; break;
            case 'Musique Suivante': cmd = `playerctl next`; break;
            case 'Lancer un locigiciel': cmd = `${routine.act_val} &`; break;
            case 'Activer ne pas deranger': cmd = `gsettings set org.gnome.desktop.notifications show-banners false`; break;
            case 'Definir la luminausité sur ...': cmd = `gdbus call --session --dest org.gnome.SettingsDaemon.Power --object-path /org/gnome/SettingsDaemon/Power --method org.freedesktop.DBus.Properties.Set org.gnome.SettingsDaemon.Power.Screen Brightness "<int32 ${routine.act_val}>"`; 
            break;
        }

        if (cmd) {
            try { GLib.spawn_command_line_async(cmd); } 
            catch(e) { console.error(`Erreur exécution: ${e}`); }
        }
    }

    Gio.DBus.session.signal_subscribe('org.freedesktop.Notifications', 'org.freedesktop.Notifications', 'Notify', '/org/freedesktop/Notifications', null, Gio.DBusSignalFlags.NONE,
        (connection, sender, path, iface, signal, params) => {
            let summary = params.get_child_value(3).get_string()[0].toLowerCase();
            let body = params.get_child_value(4).get_string()[0].toLowerCase();
            
            routines.forEach(r => {
                if (r.cond_type === 'Notification recu') {
                    let keyword = r.cond_val.toLowerCase();
                    if (summary.includes(keyword) || body.includes(keyword)) execAction(r);
                }
            });
        }
    );

    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
        let now = new Date();
        let currentH = now.getHours().toString().padStart(2, '0');
        let currentM = now.getMinutes().toString().padStart(2, '0');
        let currentMinuteStr = `${currentH}:${currentM}`;

        let getCmdOutput = (c) => { try { let [, out] = GLib.spawn_command_line_sync(c); return new TextDecoder().decode(out).trim(); } catch(e) { return ""; } };

        let currentWifi = getCmdOutput("iwgetid -r");
        let currentMedia = getCmdOutput("playerctl status") === "Playing";

        routines.forEach(r => {
            if (r.cond_type === 'Heure spécifique') {
                if (r.cond_val === currentMinuteStr && stateMemory.lastMinute !== currentMinuteStr) execAction(r);
            }
            
            if (r.cond_type === 'Periode' && r.cond_val.includes('-')) {
                let [start, end] = r.cond_val.split('-');
                if (currentMinuteStr === start && stateMemory.lastMinute !== start) execAction(r);
            }

            if (r.cond_type === 'Wifi') {
                if (currentWifi === r.cond_val && stateMemory.wifi !== r.cond_val) execAction(r);
            }

            if (r.cond_type === 'Appareil Bluetooth') {
                let btDevices = getCmdOutput("bluetoothctl devices Connected");
                if (btDevices.includes(r.cond_val)) {
                    if (stateMemory.wifi !== r.cond_val + "_BT") execAction(r);
                    stateMemory.wifi = r.cond_val + "_BT";
                }
            }

            if (r.cond_type === 'Application ouvert') {
                let isAppRunning = getCmdOutput(`pgrep -x ${r.cond_val}`) !== "";
                if (isAppRunning && !stateMemory.apps[r.cond_val]) execAction(r);
                stateMemory.apps[r.cond_val] = isAppRunning;
            }

            if (r.cond_type === 'Media en cours de lecture') {
                if (currentMedia && !stateMemory.mediaPlaying) execAction(r);
            }
        });

        stateMemory.lastMinute = currentMinuteStr;
        stateMemory.wifi = currentWifi;
        stateMemory.mediaPlaying = currentMedia;

        return GLib.SOURCE_CONTINUE;
    });

    let loop = new GLib.MainLoop(null, false);
    loop.run();
}

function startUI() {
    ensureAutostart();

    const app = new Gtk.Application({
        application_id: 'fr.projet-prism.routines',
        flags: Gio.ApplicationFlags.FLAGS_NONE
    });

    app.connect('activate', () => {
        let routines = loadRoutines();

        const win = new Gtk.ApplicationWindow({ application: app, title: 'Routines PRISM', default_width: 800, default_height: 600 });
        const headerStack = new Gtk.Stack({ transition_type: Gtk.StackTransitionType.CROSSFADE });
        win.set_titlebar(headerStack);

        const mainHeader = new Gtk.HeaderBar();
        mainHeader.set_title_widget(new Gtk.Label({ label: '<b>Routines</b>', use_markup: true }));
        const addBtn = new Gtk.Button({ icon_name: 'list-add-symbolic' });
        mainHeader.pack_start(addBtn);

        const createHeader = new Gtk.HeaderBar();
        createHeader.set_title_widget(new Gtk.Label({ label: '<b>Créer une routine</b>', use_markup: true }));
        const backBtn = new Gtk.Button({ icon_name: 'go-previous-symbolic' });
        createHeader.pack_start(backBtn);

        headerStack.add_named(mainHeader, "main_header");
        headerStack.add_named(createHeader, "create_header");

        const contentStack = new Gtk.Stack({ transition_type: Gtk.StackTransitionType.SLIDE_LEFT_RIGHT });
        win.set_child(contentStack);

        const scrolled = new Gtk.ScrolledWindow({ vexpand: true });
        const flowBox = new Gtk.FlowBox({ 
            valign: Gtk.Align.START, max_children_per_line: 3, selection_mode: Gtk.SelectionMode.NONE,
            margin_top: 20, margin_bottom: 20, margin_start: 20, margin_end: 20, column_spacing: 15, row_spacing: 15
        });
        scrolled.set_child(flowBox);
        contentStack.add_named(scrolled, "main_view");

        function updateTiles() {
            let child = flowBox.get_first_child();
            while (child != null) { let next = child.get_next_sibling(); flowBox.remove(child); child = next; }

            routines.forEach((r, index) => {
                let tile = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8, margin_top: 15, margin_bottom: 15, margin_start: 15, margin_end: 15 });
                tile.set_size_request(220, 160);
                tile.add_css_class("card");
                
                let nameLbl = new Gtk.Label({ label: `<b>${r.name}</b>`, use_markup: true, halign: Gtk.Align.CENTER, margin_top: 10 });
                let condLbl = new Gtk.Label({ label: `<small>Si: ${r.cond_type}</small>`, use_markup: true, halign: Gtk.Align.CENTER });
                let actLbl = new Gtk.Label({ label: `<small>Alors: ${r.act_type}</small>`, use_markup: true, halign: Gtk.Align.CENTER });
                
                let delBtn = new Gtk.Button({ icon_name: 'user-trash-symbolic', margin_top: 10, halign: Gtk.Align.CENTER });
                delBtn.add_css_class("destructive-action");
                delBtn.connect('clicked', () => { routines.splice(index, 1); saveRoutines(routines); updateTiles(); });

                tile.append(nameLbl);
                tile.append(new Gtk.Separator());
                tile.append(condLbl);
                tile.append(actLbl);
                tile.append(delBtn);
                flowBox.insert(tile, -1);
            });
        }

        const formScrolled = new Gtk.ScrolledWindow({ vexpand: true });
        const formBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 15, margin_top: 30, margin_start: 40, margin_end: 40, margin_bottom: 30 });
        formScrolled.set_child(formBox);
        
        const routineName = new Gtk.Entry({ placeholder_text: "Ex: Routine du soir" });
        routineName.add_css_class("large-title");
        formBox.append(new Gtk.Label({ label: "Nom de la routine", halign: Gtk.Align.START }));
        formBox.append(routineName);

        formBox.append(new Gtk.Label({ label: "<b>SI (Condition)</b>", use_markup: true, halign: Gtk.Align.START, margin_top: 15 }));
        const condTypes = ['Heure spécifique', 'Periode', 'Wifi', 'Appareil Bluetooth', 'Niveau de batterie', 'Application ouvert', 'Notification recu', 'Media en cours de lecture'];
        const condDrop = new Gtk.DropDown({ model: Gtk.StringList.new(condTypes) });
        const condEntry = new Gtk.Entry({ placeholder_text: "Ex: 20:00" });
        
        condDrop.connect('notify::selected-item', () => {
            let sel = condDrop.get_selected();
            condEntry.set_sensitive(true);
            switch(sel) {
                case 0: condEntry.set_placeholder_text("Ex: 20:00"); break;
                case 1: condEntry.set_placeholder_text("Ex: 08:00-12:00"); break;
                case 2: condEntry.set_placeholder_text("Nom du Wi-Fi (SSID)"); break;
                case 3: condEntry.set_placeholder_text("Nom ou Adresse MAC"); break;
                case 4: condEntry.set_placeholder_text("Pourcentage (ex: 20)"); break;
                case 5: condEntry.set_placeholder_text("Nom du processus (ex: firefox)"); break;
                case 6: condEntry.set_placeholder_text("Mot-clé du message"); break;
                case 7: condEntry.set_placeholder_text("Aucune valeur"); condEntry.set_text(""); condEntry.set_sensitive(false); break;
            }
        });
        
        let condBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 10 });
        condBox.append(condDrop); condBox.append(condEntry); condEntry.set_hexpand(true);
        formBox.append(condBox);

        formBox.append(new Gtk.Label({ label: "<b>ALORS (Action)</b>", use_markup: true, halign: Gtk.Align.START, margin_top: 15 }));
        const actTypes = ['Fermer une application', 'Economie d\'energie', 'Activer le clavier virtuel', 'Mettre ne pause la musique', 'Musique Suivante', 'Lancer un locigiciel', 'Activer ne pas deranger', 'Definir la luminausité sur ...'];
        const actDrop = new Gtk.DropDown({ model: Gtk.StringList.new(actTypes) });
        const actEntry = new Gtk.Entry({ placeholder_text: "Nom du processus (ex: gedit)" });
        
        actDrop.connect('notify::selected-item', () => {
            let sel = actDrop.get_selected();
            actEntry.set_sensitive(true);
            switch(sel) {
                case 0: actEntry.set_placeholder_text("Processus à tuer (ex: firefox)"); break;
                case 5: actEntry.set_placeholder_text("Commande à lancer"); break;
                case 7: actEntry.set_placeholder_text("Niveau en % (ex: 50)"); break;
                default: actEntry.set_placeholder_text("Aucune valeur"); actEntry.set_text(""); actEntry.set_sensitive(false); break;
            }
        });
        
        let actBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 10 });
        actBox.append(actDrop); actBox.append(actEntry); actEntry.set_hexpand(true);
        formBox.append(actBox);

        const saveBtn = new Gtk.Button({ label: "Enregistrer la routine", margin_top: 30 });
        saveBtn.add_css_class("suggested-action"); saveBtn.add_css_class("pill");
        saveBtn.connect('clicked', () => {
            if (routineName.get_text().trim() !== "") {
                routines.push({
                    name: routineName.get_text(),
                    cond_type: condTypes[condDrop.get_selected()], cond_val: condEntry.get_text(),
                    act_type: actTypes[actDrop.get_selected()], act_val: actEntry.get_text()
                });
                saveRoutines(routines); updateTiles();
                
                routineName.set_text(""); condEntry.set_text(""); actEntry.set_text("");
                contentStack.set_visible_child_name("main_view"); headerStack.set_visible_child_name("main_header");
            }
        });
        formBox.append(saveBtn);

        contentStack.add_named(formScrolled, "create_view");

        addBtn.connect('clicked', () => { contentStack.set_visible_child_name("create_view"); headerStack.set_visible_child_name("create_header"); });
        backBtn.connect('clicked', () => { contentStack.set_visible_child_name("main_view"); headerStack.set_visible_child_name("main_header"); });

        updateTiles();
        win.present();
    });

    app.run([System.programInvocationName]);
}

if (GLib.getenv('PRISM_MODE') === 'daemon') {
    startDaemon();
} else {
    startUI();
}