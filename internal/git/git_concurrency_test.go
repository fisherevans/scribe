package git

import (
	"context"
	"fmt"
	"sync"
	"testing"
)

// TestConcurrentReadsDuringWrites exercises the lock split: reads (StagedPaths,
// Status) must run concurrently with commits/pushes/sync without racing or
// deadlocking. Run under -race; reaching the end at all proves no deadlock.
func TestConcurrentReadsDuringWrites(t *testing.T) {
	work, _, _ := setupRemote(t)
	r, err := Open(work, "staging", "main", true)
	if err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	stop := make(chan struct{})

	// Readers hammer the cached staged-path lookup that every list request makes.
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					if _, err := r.StagedPaths(context.Background()); err != nil {
						t.Errorf("StagedPaths: %v", err)
						return
					}
				}
			}
		}()
	}
	// Status pollers (the UI's sync banner).
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					_ = r.Status()
				}
			}
		}()
	}

	// Writer: commit a series of distinct resources (each pushes to origin),
	// interleaving a backup and a sync.
	const n = 20
	for i := 0; i < n; i++ {
		slug := fmt.Sprintf("posts/c%d", i)
		write(t, work, slug+".md", fmt.Sprintf("body %d\n", i))
		if err := r.Commit(slug, []string{slug + ".md"}, "edit "+slug); err != nil {
			t.Fatal(err)
		}
		if i%5 == 0 {
			if err := r.BackupPush(); err != nil {
				t.Fatal(err)
			}
			if err := r.Sync(); err != nil {
				t.Fatal(err)
			}
		}
	}

	close(stop)
	wg.Wait()

	// Every committed resource is staged vs main (cache was invalidated by the
	// last commit, so this recomputes).
	set, err := r.StagedPaths(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < n; i++ {
		if p := fmt.Sprintf("posts/c%d.md", i); !set[p] {
			t.Errorf("%s should be staged", p)
		}
	}
}
