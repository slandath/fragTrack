package main

import (
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"time"
)

type server struct {
	store Store
	fetch Fetcher
	jobs  *jobRegistry
	tpl   *template.Template
}

func newServer(store Store, fetch Fetcher, tpl *template.Template) *server {
	return &server{store: store, fetch: fetch, jobs: newJobRegistry(), tpl: tpl}
}

func (s *server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /", s.listPage)
	mux.HandleFunc("GET /buy", s.buyPage)
	mux.HandleFunc("GET /fragrance/{id}", s.detailPage)
	mux.HandleFunc("POST /fragrances", s.createFragrance)
	mux.HandleFunc("POST /fragrances/{id}/edit", s.editFragrance)
	mux.HandleFunc("POST /fragrances/{id}/delete", s.deleteFragrance)
	mux.HandleFunc("POST /fragrances/{id}/links", s.addLink)
	mux.HandleFunc("POST /fragrances/{id}/links/{linkID}/delete", s.deleteLink)
	mux.HandleFunc("POST /api/fragrances/{id}/refresh-prices", s.startRefresh)
	mux.HandleFunc("GET /api/refreshes/{jobID}/events", s.refreshEvents)
	mux.HandleFunc("GET /static/app.js", s.appJS)
	return mux
}

func (s *server) health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (s *server) render(w http.ResponseWriter, name string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := s.tpl.ExecuteTemplate(w, name, data); err != nil {
		fmt.Printf("template %s: %v\n", name, err)
	}
}

type listData struct {
	Fragrances []Fragrance
	Retailers  []RetailerConfig
}

func (s *server) listPage(w http.ResponseWriter, r *http.Request) {
	owned, err := parseOwnedParam(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	fragrances, err := s.store.ListFragrances(owned)
	if err != nil {
		http.Error(w, "list fragrances", http.StatusInternalServerError)
		return
	}
	s.render(w, "list", listData{Fragrances: fragrances, Retailers: retailerConfigs})
}

type buyRow struct {
	Fragrance Fragrance
	Links     []RetailerLink
}

type buyData struct {
	Rows            []buyRow
	RetailerOptions []RetailerConfig
}

func (s *server) buyPage(w http.ResponseWriter, r *http.Request) {
	owned := false
	fragrances, err := s.store.ListFragrances(&owned)
	if err != nil {
		http.Error(w, "list fragrances", http.StatusInternalServerError)
		return
	}
	data := buyData{RetailerOptions: retailerConfigs}
	for _, f := range fragrances {
		links, err := s.store.LinksForFragrance(f.ID)
		if err != nil {
			http.Error(w, "list links", http.StatusInternalServerError)
			return
		}
		data.Rows = append(data.Rows, buyRow{Fragrance: f, Links: links})
	}
	s.render(w, "buy", data)
}

type detailData struct {
	Fragrance Fragrance
	Links     []RetailerLink
}

func (s *server) detailPage(w http.ResponseWriter, r *http.Request) {
	f, err := s.store.GetFragrance(r.PathValue("id"))
	if err != nil {
		http.Error(w, "get fragrance", http.StatusInternalServerError)
		return
	}
	if f == nil {
		http.NotFound(w, r)
		return
	}
	links, err := s.store.LinksForFragrance(f.ID)
	if err != nil {
		http.Error(w, "list links", http.StatusInternalServerError)
		return
	}
	s.render(w, "detail", detailData{Fragrance: *f, Links: links})
}

func formLinks(r *http.Request) []RetailerLink {
	var links []RetailerLink
	for _, cfg := range retailerConfigs {
		url := r.FormValue("url_" + cfg.Domain)
		if url == "" {
			continue
		}
		links = append(links, RetailerLink{
			ID:       newID(),
			Retailer: cfg.Name,
			URL:      url,
		})
	}
	return links
}

func (s *server) createFragrance(w http.ResponseWriter, r *http.Request) {
	f := Fragrance{
		ID:     newID(),
		Brand:  r.FormValue("brand"),
		Name:   r.FormValue("name"),
		SizeMl: atoi(r.FormValue("size_ml")),
		Owned:  r.FormValue("owned") == "true",
	}
	if err := s.store.CreateFragrance(f, formLinks(r)); err != nil {
		http.Error(w, "create fragrance", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/buy?owned=false", http.StatusSeeOther)
}

func (s *server) editFragrance(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	f, err := s.store.GetFragrance(id)
	if err != nil {
		http.Error(w, "get fragrance", http.StatusInternalServerError)
		return
	}
	if f == nil {
		http.NotFound(w, r)
		return
	}
	f.Brand = r.FormValue("brand")
	f.Name = r.FormValue("name")
	f.SizeMl = atoi(r.FormValue("size_ml"))
	f.Owned = r.FormValue("owned") == "true"
	if err := s.store.UpdateFragrance(*f, formLinks(r)); err != nil {
		http.Error(w, "update fragrance", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// addLink adds (or replaces) one retailer URL for a fragrance, without
// a full edit. The new link starts never-checked.
func (s *server) addLink(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	retailer := r.FormValue("retailer")
	url := r.FormValue("url")
	if _, ok := retailerByName(retailer); !ok || url == "" {
		http.Error(w, "retailer and url are required", http.StatusBadRequest)
		return
	}
	f, err := s.store.GetFragrance(id)
	if err != nil {
		http.Error(w, "get fragrance", http.StatusInternalServerError)
		return
	}
	if f == nil {
		http.NotFound(w, r)
		return
	}
	link := RetailerLink{ID: newID(), Retailer: retailer, URL: url}
	if err := s.store.AddLink(id, link); err != nil {
		http.Error(w, "add link", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/buy", http.StatusSeeOther)
}

// deleteLink removes one retailer URL from a fragrance. Removing the
// last link is fine; the fragrance remains with no links.
func (s *server) deleteLink(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteLink(r.PathValue("linkID")); err != nil {
		http.Error(w, "delete link", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/buy", http.StatusSeeOther)
}

func (s *server) deleteFragrance(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteFragrance(r.PathValue("id")); err != nil {
		http.Error(w, "delete fragrance", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *server) startRefresh(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	f, err := s.store.GetFragrance(id)
	if err != nil {
		http.Error(w, "get fragrance", http.StatusInternalServerError)
		return
	}
	if f == nil {
		http.NotFound(w, r)
		return
	}
	jobID, job := s.jobs.create()
	go runRefresh(s.store, s.fetch, id, job)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"jobId": jobID})
}

func (s *server) refreshEvents(w http.ResponseWriter, r *http.Request) {
	job, ok := s.jobs.get(r.PathValue("jobID"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	for {
		select {
		case ev, open := <-job.events:
			if !open {
				_, _ = fmt.Fprint(w, "event: complete\ndata: {}\n\n")
				flusher.Flush()
				return
			}
			payload, err := encodeEvent(ev)
			if err != nil {
				continue
			}
			_, _ = w.Write(payload)
			flusher.Flush()
		case <-r.Context().Done():
			return
		case <-time.After(25 * time.Second):
			_, _ = fmt.Fprint(w, "event: ping\ndata: {}\n\n")
			flusher.Flush()
		}
	}
}

func (s *server) appJS(w http.ResponseWriter, r *http.Request) {
	data, err := assets.ReadFile("static/app.js")
	if err != nil {
		http.Error(w, "app.js missing", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	_, _ = w.Write(data)
}
