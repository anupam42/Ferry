//go:build windows

package main

import "golang.org/x/sys/windows"

// enableVT turns on ANSI escape handling in classic Windows consoles
// (Windows Terminal and PowerShell 7 already have it on).
func enableVT() {
	for _, h := range []windows.Handle{windows.Stdout, windows.Stderr} {
		var mode uint32
		if windows.GetConsoleMode(h, &mode) == nil {
			_ = windows.SetConsoleMode(h, mode|windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING)
		}
	}
}
