package main

import (
	"log/slog"
	"net/http"
	"os"

	"github.com/benaskins/axon"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dir := os.Getenv("MUSICBOX_WEB_DIR")
	if dir == "" {
		dir = "www"
	}

	slog.Info("serving musicbox", "dir", dir, "port", port)
	axon.ListenAndServe(port, http.FileServer(http.Dir(dir)))
}
