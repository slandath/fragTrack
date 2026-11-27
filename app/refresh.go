package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

// Fetcher performs one retailer fetch. It is an interface so tests can
// substitute a fake without network.
type Fetcher interface {
	Fetch(url string, cfg RetailerConfig) (priceMinor int64, currency string, err error)
}

type httpFetcher struct {
	client *http.Client
}

func newHTTPFetcher() *httpFetcher {
	return &httpFetcher{client: &http.Client{Timeout: 10 * time.Second}}
}

func (f *httpFetcher) Fetch(url string, cfg RetailerConfig) (int64, string, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("User-Agent", "fragTrack/1.0 (+personal buy list)")
	resp, err := f.client.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusTooManyRequests {
		return 0, "", &blockedError{fmt.Sprintf("http %d", resp.StatusCode)}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, "", fmt.Errorf("http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return 0, "", err
	}
	return parseRetailerPrice(body, cfg)
}

type blockedError struct{ msg string }

func (e *blockedError) Error() string { return e.msg }

// RefreshEvent is one per-retailer outcome streamed over SSE.
type RefreshEvent struct {
	Retailer      string `json:"retailer"`
	Status        string `json:"status"` // ok | failed | blocked
	PriceMinor    *int64 `json:"priceMinor,omitempty"`
	PriceCurrency string `json:"priceCurrency,omitempty"`
	LastSuccessAt string `json:"lastSuccessAt,omitempty"`
	LastAttemptAt string `json:"lastAttemptAt,omitempty"`
	FailureReason string `json:"failureReason,omitempty"`
}

type refreshJob struct {
	events chan RefreshEvent
	done   chan struct{}
}

type jobRegistry struct {
	mu   sync.Mutex
	jobs map[string]*refreshJob
	seq  int
}

func newJobRegistry() *jobRegistry {
	return &jobRegistry{jobs: map[string]*refreshJob{}}
}

func (r *jobRegistry) create() (string, *refreshJob) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.seq++
	id := fmt.Sprintf("job-%d", r.seq)
	job := &refreshJob{
		events: make(chan RefreshEvent, 64),
		done:   make(chan struct{}),
	}
	r.jobs[id] = job
	return id, job
}

func (r *jobRegistry) get(id string) (*refreshJob, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	job, ok := r.jobs[id]
	return job, ok
}

// runRefresh fetches every pasted link for one fragrance and records
// per-link freshness outcomes. Every explicit tap starts fresh fetches;
// there is no TTL on taps and no silently cached price.
func runRefresh(store Store, fetch Fetcher, fragranceID string, job *refreshJob) {
	defer func() {
		close(job.events)
		close(job.done)
	}()
	links, err := store.LinksForFragrance(fragranceID)
	if err != nil {
		return
	}
	var wg sync.WaitGroup
	for _, link := range links {
		link := link
		wg.Add(1)
		go func() {
			defer wg.Done()
			cfg, ok := retailerByName(link.Retailer)
			if !ok {
				now := time.Now().UTC()
				_ = store.RecordAttempt(link.ID, now, "failed", "unsupported retailer")
				job.events <- RefreshEvent{Retailer: link.Retailer, Status: "failed", LastAttemptAt: now.Format(time.RFC3339), FailureReason: "unsupported retailer"}
				return
			}
			attemptAt := time.Now().UTC()
			priceMinor, currency, ferr := fetch.Fetch(link.URL, cfg)
			if ferr != nil {
				status := "failed"
				var be *blockedError
				if convertToBlocked(ferr, &be) {
					status = "blocked"
				}
				reason := ferr.Error()
				_ = store.RecordAttempt(link.ID, attemptAt, status, reason)
				job.events <- RefreshEvent{
					Retailer:      link.Retailer,
					Status:        status,
					LastAttemptAt: attemptAt.Format(time.RFC3339),
					FailureReason: reason,
				}
				return
			}
			_ = store.RecordSuccess(link.ID, attemptAt, priceMinor, currency)
			job.events <- RefreshEvent{
				Retailer:      link.Retailer,
				Status:        "ok",
				PriceMinor:    &priceMinor,
				PriceCurrency: currency,
				LastSuccessAt: attemptAt.Format(time.RFC3339),
				LastAttemptAt: attemptAt.Format(time.RFC3339),
			}
		}()
	}
	wg.Wait()
}

func convertToBlocked(err error, target **blockedError) bool {
	for {
		if be, ok := err.(*blockedError); ok {
			*target = be
			return true
		}
		type unwrapper interface{ Unwrap() error }
		u, ok := err.(unwrapper)
		if !ok || u.Unwrap() == nil {
			return false
		}
		err = u.Unwrap()
	}
}

func encodeEvent(ev RefreshEvent) ([]byte, error) {
	data, err := json.Marshal(ev)
	if err != nil {
		return nil, err
	}
	var evName string
	switch ev.Status {
	case "ok":
		evName = "result"
	case "blocked":
		evName = "blocked"
	default:
		evName = "failed"
	}
	return []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", evName, data)), nil
}
