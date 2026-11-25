package main

import (
	"context"
	"net/http"
	"net/http/httptest"
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
	if !strings.Contains(rec.Body.String(), "USD 110.00") {
		t.Fatalf("buy after refresh missing price: %s", rec.Body.String())
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
