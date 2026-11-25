package main

import (
	"crypto/subtle"
	"fmt"
	"net/http"
	"strings"
)

const cookieName = "ft_key"

// requireSecret gates every route except /healthz. The secret may arrive
// as a cookie (normal browsing), a ?key= query param (sets the cookie
// on first use), or an X-App-Secret header (API clients).
func requireSecret(secret string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			next.ServeHTTP(w, r)
			return
		}
		given := ""
		if c, err := r.Cookie(cookieName); err == nil {
			given = c.Value
		}
		if q := r.URL.Query().Get("key"); q != "" {
			given = q
		}
		if h := r.Header.Get("X-App-Secret"); h != "" {
			given = h
		}
		if given == "" || subtle.ConstantTimeCompare([]byte(given), []byte(secret)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.URL.Query().Get("key") != "" {
			http.SetCookie(w, &http.Cookie{
				Name:   cookieName,
				Value:  given,
				Path:   "/",
				MaxAge: 60 * 60 * 24 * 365,
			})
		}
		next.ServeHTTP(w, r)
	})
}

func parseOwnedParam(r *http.Request) (*bool, error) {
	raw := r.URL.Query().Get("owned")
	if raw == "" {
		return nil, nil
	}
	switch strings.ToLower(raw) {
	case "true", "1", "yes":
		v := true
		return &v, nil
	case "false", "0", "no":
		v := false
		return &v, nil
	default:
		return nil, fmt.Errorf("owned must be true or false")
	}
}
