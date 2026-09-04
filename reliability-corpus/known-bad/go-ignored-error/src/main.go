package main

import (
	"fmt"
	"io"
	"os"
)

// BAD: the canonical Go ignored-error idiom. The value is kept, the error
// is dropped on the floor, and the failure becomes invisible at runtime.
func readConfig(path string) []byte {
	f, _ := os.Open(path)
	data, _ := io.ReadAll(f)
	return data
}

// BAD: panic inside a guard — the shape a panic almost always takes in real
// Go, and the one a line-anchored rule never sees.
func mustConnect(dsn string) {
	if dsn == "" {
		panic("no DSN configured")
	}
}

func main() {
	fmt.Println(string(readConfig("/etc/app.conf")))
	mustConnect(os.Getenv("DSN"))
}
