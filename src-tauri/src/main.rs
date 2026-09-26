// Enforce Windows GUI Subsystem so NO terminal/cmd window ever appears
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    widget_app_lib::run()
}
