// Enforce Windows GUI Subsystem so NO terminal/cmd window ever appears
#![windows_subsystem = "windows"]

fn main() {
    widget_app_lib::run()
}
