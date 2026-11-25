package main

import (
	"embed"
	"html/template"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

//go:embed templates/*.html static/app.js
var assets embed.FS

func mustTemplates() *template.Template {
	funcs := template.FuncMap{
		"formatPrice":    formatPrice,
		"rowStatus":      rowStatus,
		"retailerDomain": retailerDomainForName,
	}
	tpl, err := template.New("fragtrack").Funcs(funcs).ParseFS(assets, "templates/*.html")
	if err != nil {
		log.Fatalf("parse templates: %v", err)
	}
	return tpl
}

func main() {
	port := envOr("PORT", "3000")
	dataPath := envOr("DATA_PATH", "./data/fragtrack.db")
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		log.Fatal("APP_SECRET is required")
	}
	if err := os.MkdirAll(filepath.Dir(dataPath), 0o755); err != nil {
		log.Fatalf("create data dir: %v", err)
	}
	store, err := openSQLite(dataPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer store.Close()

	// Timestamped, checkpointed copies alongside the live database.
	if backupDir := envOr("BACKUP_DIR", filepath.Join(filepath.Dir(dataPath), "backups")); backupDir != "" {
		if name, berr := store.Backup(backupDir); berr == nil {
			log.Printf("database backup: %s", name)
		} else {
			log.Printf("database backup failed: %v", berr)
		}
	}

	srv := newServer(store, newHTTPFetcher(), mustTemplates())
	handler := requireSecret(secret, srv.routes())
	httpServer := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // SSE streams ride long-lived connections
	}
	log.Printf("listening on :%s (data: %s)", port, dataPath)
	log.Fatal(httpServer.ListenAndServe())
}
