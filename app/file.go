package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// copyFile copies src to dst, creating parent directories.
func copyFile(src, dst string) (string, error) {
	data, err := os.ReadFile(src)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(dst, data, 0o600); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s (%d bytes)", dst, len(data)), nil
}
