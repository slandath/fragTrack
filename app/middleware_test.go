package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequireSecret(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := requireSecret("s3cret", next)

	// Health endpoint is exempt.
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("healthz: got %d, want 200", rec.Code)
	}

	// Missing secret is rejected.
	req = httptest.NewRequest(http.MethodGet, "/buy", nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no secret: got %d, want 401", rec.Code)
	}

	// Query param works and sets the cookie.
	req = httptest.NewRequest(http.MethodGet, "/buy?key=s3cret", nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("query secret: got %d, want 200", rec.Code)
	}
	if rec.Result().Header.Get("Set-Cookie") == "" {
		t.Fatal("expected Set-Cookie after query secret")
	}

	// Cookie works on subsequent requests.
	req = httptest.NewRequest(http.MethodGet, "/buy", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: "s3cret"})
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("cookie secret: got %d, want 200", rec.Code)
	}

	// Header works for API clients.
	req = httptest.NewRequest(http.MethodPost, "/api/fragrances/f1/refresh-prices", nil)
	req.Header.Set("X-App-Secret", "s3cret")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("header secret: got %d, want 200", rec.Code)
	}
}
