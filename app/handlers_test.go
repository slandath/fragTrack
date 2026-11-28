package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// TestHandlerFlow drives the HTTP surface in-process (no sockets, which
// the sandbox forbids) through the recorder: auth gate, alphabetical
// listing, POST refresh, and the SSE stream to completion.
func TestHandlerFlow(t *testing.T) {
	s := newTestStore(t)
	f := Fragrance{ID: "f1", Brand: "Creed", Name: "Aventus", SizeMl: 100}
	links := []RetailerLink{{ID: "l1", Retailer: "FragranceNet", URL: "https://example.com/a"}}
	if err := s.CreateFragrance(f, links); err != nil {
		t.Fatalf("create: %v", err)
	}
	srv := newServer(s, &fakeFetcher{minor: 11000}, mustTemplates())
	handler := requireSecret("s3cret", srv.routes())

	call := func(method, target string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, target+"?key=s3cret", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	// List renders the seeded fragrance.
	rec := call(http.MethodGet, "/")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Aventus") {
		t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}

	// Buy view shows it with the never-checked label.
	rec = call(http.MethodGet, "/buy")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "no check yet") {
		t.Fatalf("buy: %d %s", rec.Code, rec.Body.String())
	}

	// Start a refresh; then drain its SSE stream to completion.
	rec = call(http.MethodPost, "/api/fragrances/f1/refresh-prices")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"jobId"`) {
		t.Fatalf("refresh: %d %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	jobID := strings.TrimPrefix(body, `{"jobId":"`)
	jobID = strings.TrimSuffix(jobID, `"}`+"\n")
	rec = call(http.MethodGet, "/api/refreshes/"+jobID+"/events")
	// The handler returns after the terminal complete event once the
	// synchronous refresh finishes; with a fake fetcher this is fast.
	if rec.Code != http.StatusOK {
		t.Fatalf("events: %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "complete") || !strings.Contains(rec.Body.String(), `"status":"ok"`) {
		t.Fatalf("events body: %s", rec.Body.String())
	}

	// The stored snapshot now reads confirmed.
	rec = call(http.MethodGet, "/buy")
	if !strings.Contains(rec.Body.String(), "confirmed") {
		t.Fatalf("buy after refresh missing confirmed: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "$110.00") {
		t.Fatalf("buy after refresh missing price: %s", rec.Body.String())
	}
}

func TestLinkManagementHandlers(t *testing.T) {
	s := newTestStore(t)
	f := Fragrance{ID: "f1", Brand: "Creed", Name: "Aventus", SizeMl: 100}
	if err := s.CreateFragrance(f, []RetailerLink{{ID: "l1", Retailer: "FragranceNet", URL: "https://example.com/a"}}); err != nil {
		t.Fatalf("create: %v", err)
	}
	srv := newServer(s, &fakeFetcher{minor: 1}, mustTemplates())
	handler := requireSecret("s3cret", srv.routes())

	call := func(method, target string, form url.Values) *httptest.ResponseRecorder {
		var req *http.Request
		if form != nil {
			req = httptest.NewRequest(method, target+"?key=s3cret", strings.NewReader(form.Encode()))
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		} else {
			req = httptest.NewRequest(method, target+"?key=s3cret", nil)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	// Add a second retailer link to the existing fragrance.
	rec := call(http.MethodPost, "/fragrances/f1/links", url.Values{
		"retailer": {"FragranceX"},
		"url":      {"https://example.com/b"},
	})
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("add link: %d %s", rec.Code, rec.Body.String())
	}
	links, _ := s.LinksForFragrance("f1")
	if len(links) != 2 {
		t.Fatalf("expected 2 links, got %+v", links)
	}

	// Remove one of them by id.
	var secondID string
	for _, l := range links {
		if l.Retailer == "FragranceX" {
			secondID = l.ID
		}
	}
	rec = call(http.MethodPost, "/fragrances/f1/links/"+secondID+"/delete", nil)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("delete link: %d", rec.Code)
	}
	links, _ = s.LinksForFragrance("f1")
	if len(links) != 1 || links[0].Retailer != "FragranceNet" {
		t.Fatalf("after delete: %+v", links)
	}

	// Unknown retailer and empty URL are rejected.
	rec = call(http.MethodPost, "/fragrances/f1/links", url.Values{
		"retailer": {"Nope"},
		"url":      {"https://example.com/c"},
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown retailer: %d", rec.Code)
	}
}

func postForm(t *testing.T, handler http.Handler, method, target string, form url.Values) *httptest.ResponseRecorder {
	t.Helper()
	var req *http.Request
	if form != nil {
		req = httptest.NewRequest(method, target+"?key=s3cret", strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	} else {
		req = httptest.NewRequest(method, target+"?key=s3cret", nil)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// TestCreateFragranceValidation pins issue #40: empty brand, bad size,
// and garbage retailer URLs are rejected with feedback and store nothing.
func TestCreateFragranceValidation(t *testing.T) {
	newSrv := func() (*sqliteStore, http.Handler) {
		s := newTestStore(t)
		srv := newServer(s, &fakeFetcher{minor: 1}, mustTemplates())
		return s, requireSecret("s3cret", srv.routes())
	}

	// Empty brand.
	s, h := newSrv()
	rec := postForm(t, h, http.MethodPost, "/fragrances", url.Values{
		"brand": {""}, "name": {"Chrome"}, "size_ml": {"100"},
	})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "brand") {
		t.Fatalf("empty brand: %d %q", rec.Code, rec.Body.String())
	}
	if all, _ := s.ListFragrances(nil); len(all) != 0 {
		t.Fatalf("nothing must be stored: %+v", all)
	}

	// Size 0.
	_, h = newSrv()
	s2, h2 := newSrv()
	_ = s2
	rec = postForm(t, h2, http.MethodPost, "/fragrances", url.Values{
		"brand": {"Azzaro"}, "name": {"Chrome"}, "size_ml": {"0"},
	})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "size_ml") {
		t.Fatalf("size 0: %d %q", rec.Code, rec.Body.String())
	}

	// Garbage retailer URL alongside valid fields.
	s3, h3 := newSrv()
	rec = postForm(t, h3, http.MethodPost, "/fragrances", url.Values{
		"brand": {"Azzaro"}, "name": {"Chrome"}, "size_ml": {"100"},
		"url_fragrancex.com": {"not-a-url"},
	})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "url_fragrancex.com") {
		t.Fatalf("bad url: %d %q", rec.Code, rec.Body.String())
	}
	if all, _ := s3.ListFragrances(nil); len(all) != 0 {
		t.Fatalf("nothing must be stored: %+v", all)
	}

	// Valid submission still succeeds.
	s4, h4 := newSrv()
	rec = postForm(t, h4, http.MethodPost, "/fragrances", url.Values{
		"brand": {"Azzaro"}, "name": {"Chrome"}, "size_ml": {"100"},
		"url_fragrancex.com": {"https://www.fragrancex.com/products/azzaro/chrome-cologne"},
	})
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("valid: %d %q", rec.Code, rec.Body.String())
	}
	all, _ := s4.ListFragrances(nil)
	if len(all) != 1 {
		t.Fatalf("valid must store: %+v", all)
	}
	links, _ := s4.LinksForFragrance(all[0].ID)
	if len(links) != 1 {
		t.Fatalf("valid link must store: %+v", links)
	}

	// Edit with empty name is rejected; original survives.
	s5, h5 := newSrv()
	rec = postForm(t, h5, http.MethodPost, "/fragrances", url.Values{
		"brand": {"Azzaro"}, "name": {"Chrome"}, "size_ml": {"100"},
	})
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("seed: %d", rec.Code)
	}
	seeded, _ := s5.ListFragrances(nil)
	rec = postForm(t, h5, http.MethodPost, "/fragrances/"+seeded[0].ID+"/edit", url.Values{
		"brand": {"Azzaro"}, "name": {""}, "size_ml": {"100"},
	})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "name") {
		t.Fatalf("edit empty name: %d %q", rec.Code, rec.Body.String())
	}

	// addLink with non-URL is rejected.
	rec = postForm(t, h5, http.MethodPost, "/fragrances/"+seeded[0].ID+"/links", url.Values{
		"retailer": {"FragranceX"}, "url": {"junk"},
	})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "url") {
		t.Fatalf("addLink junk: %d %q", rec.Code, rec.Body.String())
	}

	// URL with credentials is rejected.
	rec = postForm(t, h5, http.MethodPost, "/fragrances/"+seeded[0].ID+"/links", url.Values{
		"retailer": {"FragranceX"}, "url": {"https://user:pass@www.fragrancex.com/p"},
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("credentials url: %d %q", rec.Code, rec.Body.String())
	}
}

func TestHandlerAuthGate(t *testing.T) {
	s := newTestStore(t)
	srv := newServer(s, &fakeFetcher{minor: 1}, mustTemplates())
	handler := requireSecret("s3cret", srv.routes())
	req := httptest.NewRequest(http.MethodGet, "/buy", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", rec.Code)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	req = httptest.NewRequestWithContext(ctx, http.MethodGet, "/healthz", nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("healthz got %d, want 200", rec.Code)
	}
}
