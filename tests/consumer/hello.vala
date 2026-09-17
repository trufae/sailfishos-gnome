// Compile/link check for the public GTK4 and libadwaita development files.
int main(string[] args) {
    var app = new Adw.Application("org.sailfishgnome.Smoke", ApplicationFlags.DEFAULT_FLAGS);
    app.activate.connect(() => {
        var window = new Adw.ApplicationWindow(app);
        window.set_content(new Gtk.Label("Sailfish GNOME"));
        window.present();
    });
    return app.run(args);
}
