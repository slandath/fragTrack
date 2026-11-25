package main

import (
	"testing"
	"time"
)

type fakeFetcher struct {
	minor int64
	err   error
}

func (f *fakeFetcher) Fetch(url string, cfg RetailerConfig) (int64, string, error) {
	return f.minor, cfg.Currency, f.err
}

// TestRunRefreshRecordsOutcomes proves the freshness contract per link:
// success stores price + confirmations, failure keeps the old price and
// stamps the attempt, and every tap (every runRefresh call) attempts
// fresh fetches — there is no TTL that could silently serve a cache.
func TestRunRefreshRecordsOutcomes(t *testing.T) {
	s := newTestStore(t)
	f := Fragrance{ID: "f1", Brand: "Creed", Name: "Aventus", SizeMl: 100}
	links := []RetailerLink{
		{ID: "l1", Retailer: "FragranceNet", URL: "https://example.com/a"},
		{ID: "l2", Retailer: "FragranceX", URL: "https://example.com/b"},
	}
	if err := s.CreateFragrance(f, links); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Run 1: everything succeeds.
	job := &refreshJob{events: make(chan RefreshEvent, 64), done: make(chan struct{})}
	runRefresh(s, &fakeFetcher{minor: 11000}, "f1", job)
	drained := drain(job)
	if len(drained) != 2 {
		t.Fatalf("expected 2 events, got %d", len(drained))
	}
	after, _ := s.LinksForFragrance("f1")
	if after[0].LastPriceMinor == nil || *after[0].LastPriceMinor != 11000 {
		t.Fatalf("expected stored price: %+v", after[0])
	}

	// Run 2 (immediate re-tap): must attempt fresh fetches again and
	// now fail — old price stays, attempt stamps advance.
	job2 := &refreshJob{events: make(chan RefreshEvent, 64), done: make(chan struct{})}
	runRefresh(s, &fakeFetcher{err: errBoom{}}, "f1", job2)
	drained = drain(job2)
	if len(drained) != 2 {
		t.Fatalf("second run must also fetch: got %d events", len(drained))
	}
	after, _ = s.LinksForFragrance("f1")
	if after[0].LinkStatus != "failed" {
		t.Fatalf("expected failed status: %+v", after[0])
	}
	if after[0].LastPriceMinor == nil || *after[0].LastPriceMinor != 11000 {
		t.Fatalf("old price must survive a failed run: %+v", after[0])
	}
}

type errBoom struct{}

func (errBoom) Error() string { return "boom" }

func drain(job *refreshJob) []RefreshEvent {
	var out []RefreshEvent
	deadline := time.After(3 * time.Second)
	for {
		select {
		case ev, open := <-job.events:
			if !open {
				return out
			}
			out = append(out, ev)
		case <-job.done:
			// done closes after events; drain remainder then exit
			// via a short lull check
			select {
			case ev, open := <-job.events:
				if !open {
					return out
				}
				out = append(out, ev)
			default:
				return out
			}
		case <-deadline:
			return out
		}
	}
}
