# AeroPulse Widget

Widget theo dõi hệ thống (CPU, RAM, ổ đĩa, mạng) kèm lịch âm dương, viết bằng Tauri 2 (Rust + HTML/JS thuần).

- Chạy: `run-widget.bat` (hoặc mở `widget-app.exe`). App không hiện trên taskbar; điều khiển qua icon ở khay hệ thống
  (click trái: ẩn/hiện; click phải: luôn ở trên cùng, khởi động cùng Windows, về góc trên phải, thoát).
- Build: `build-release.bat` (cần Rust toolchain `stable-x86_64-pc-windows-gnu` và WinLibs MinGW).
- Nhiệt độ CPU đọc từ bộ đếm hiệu năng "Thermal Zone Information" của Windows (không cần quyền Admin).
  Máy không có cảm biến này thì ô nhiệt độ tự ẩn.

Mã nguồn: `src/` (giao diện, `lunar.js` là thuật toán âm lịch Hồ Ngọc Đức), `src-tauri/src/lib.rs` (backend).
