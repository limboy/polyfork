package main

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// Updates is what polyfork.dev has that the library does not.
type Updates struct {
	// Changed lists downloaded models whose file on the site differs; it
	// is empty until CheckChanged fills it.
	Changed []UpdateItem `json:"changed"`
	// New lists models the library does not have; InKit marks those in a
	// kit the library already has models of.
	New []UpdateItem `json:"new"`
	// Gone counts downloaded models the site no longer lists.
	Gone int `json:"gone"`
}

// UpdateItem is a model in Updates.
type UpdateItem struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Kit   string `json:"kit,omitempty"`
	InKit bool   `json:"inKit,omitempty"`
}

// CheckProgress reports an update check in progress.
type CheckProgress struct {
	Stage string `json:"stage"` // "compare" while checking files
	Done  int    `json:"done"`
	Total int    `json:"total"`
}

// checkWorkers is how many HEAD requests CheckChanged makes at once: the
// CDN takes most of a second to answer each.
const checkWorkers = 24

// CheckUpdates reads the catalogue on polyfork.dev and lists the models the
// library lacks and the downloaded ones the site no longer lists. It does
// not look at files: CheckChanged does.
func (l *Library) CheckUpdates(ctx context.Context) (Updates, error) {
	remote, err := l.search(ctx, DownloadOptions{})
	if err != nil {
		return Updates{}, err
	}
	l.rememberRemote(remote)
	local, err := l.List()
	if err != nil {
		return Updates{}, err
	}

	have := map[string]bool{}
	kits := map[string]bool{}
	for _, a := range local {
		have[a.ID] = true
		if a.Kit != "" {
			kits[a.Kit] = true
		}
	}
	u := Updates{Changed: []UpdateItem{}, New: []UpdateItem{}}
	onSite := map[string]bool{}
	for _, r := range remote {
		onSite[r.ID] = true
		if !have[r.ID] {
			u.New = append(u.New, UpdateItem{ID: r.ID, Title: r.Title, Kit: r.Kit, InKit: kits[r.Kit]})
		}
	}
	for _, a := range local {
		if !onSite[a.ID] {
			u.Gone++
		}
	}
	return u, nil
}

// CheckChanged lists the downloaded models whose file on polyfork.dev
// differs from theirs. The ETag of a GLB on the CDN is the MD5 of the file,
// so a HEAD request and a hash of the local file tell, without
// downloading; it takes a request per model.
func (l *Library) CheckChanged(ctx context.Context, progress *mygo.Channel[CheckProgress]) ([]UpdateItem, error) {
	check, err := l.List()
	if err != nil {
		return nil, err
	}
	var (
		mu      sync.Mutex
		done    int
		changed = []UpdateItem{}
		wg      sync.WaitGroup
		jobs    = make(chan Asset)
	)
	progress.Send(CheckProgress{Stage: "compare", Total: len(check)})
	for range checkWorkers {
		wg.Go(func() {
			for a := range jobs {
				c := l.changed(ctx, a)
				mu.Lock()
				done++
				if c {
					changed = append(changed, UpdateItem{ID: a.ID, Title: a.Title, Kit: a.Kit})
				}
				if done%20 == 0 || done == len(check) {
					progress.Send(CheckProgress{Stage: "compare", Done: done, Total: len(check)})
				}
				mu.Unlock()
			}
		})
	}
	for _, a := range check {
		select {
		case jobs <- a:
		case <-ctx.Done():
		}
		if ctx.Err() != nil {
			break
		}
	}
	close(jobs)
	wg.Wait()
	return changed, ctx.Err()
}

// Update downloads ids again, replacing the files the library has, or for
// the first time.
func (l *Library) Update(ctx context.Context, ids []string, progress *mygo.Channel[Progress]) (int, error) {
	if len(ids) == 0 {
		return 0, errors.New("nothing to update")
	}
	l.remoteMu.Lock()
	known := l.remote
	l.remoteMu.Unlock()
	remote := make([]remoteAsset, 0, len(ids))
	for _, id := range ids {
		r, ok := known[id]
		if !ok {
			if err := l.getJSON(ctx, apiBase+"/assets/"+url.PathEscape(id), &r); err != nil {
				return 0, err
			}
		}
		remote = append(remote, r)
	}
	return l.fetchMany(ctx, remote, true, progress)
}

// rememberRemote keeps the catalogue CheckUpdates read for Update.
func (l *Library) rememberRemote(remote []remoteAsset) {
	m := make(map[string]remoteAsset, len(remote))
	for _, r := range remote {
		m[r.ID] = r
	}
	l.remoteMu.Lock()
	l.remote = m
	l.remoteMu.Unlock()
}

// changed reports whether a's GLB on the site differs from the downloaded
// one. Failures count as unchanged, so that a flaky network does not
// suggest downloading everything again.
func (l *Library) changed(ctx context.Context, a Asset) bool {
	resp, err := l.do(ctx, "HEAD", "https://polyfork.dev/cdn/"+url.PathEscape(a.ID)+".glb")
	if err != nil {
		return false
	}
	resp.Body.Close()
	etag := strings.Trim(strings.TrimPrefix(resp.Header.Get("ETag"), "W/"), `"`)
	if len(etag) != 32 {
		return false // not an MD5: nothing to compare with
	}
	sum, err := l.md5(filepath.Join(l.Folder(), a.GLB))
	if err != nil {
		return true // the file is missing or unreadable: download it again
	}
	return !strings.EqualFold(sum, etag)
}

type fileSum struct {
	size int64
	mod  time.Time
	sum  string
}

// md5 returns the MD5 of the file at path, remembering it while the file's
// size and modification time stay the same.
func (l *Library) md5(path string) (string, error) {
	fi, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	l.sumMu.Lock()
	c, ok := l.sums[path]
	l.sumMu.Unlock()
	if ok && c.size == fi.Size() && c.mod.Equal(fi.ModTime()) {
		return c.sum, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := md5.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	sum := hex.EncodeToString(h.Sum(nil))
	l.sumMu.Lock()
	if l.sums == nil {
		l.sums = map[string]fileSum{}
	}
	l.sums[path] = fileSum{fi.Size(), fi.ModTime(), sum}
	l.sumMu.Unlock()
	return sum, nil
}
