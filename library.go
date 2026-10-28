package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

const apiBase = "https://polyfork.dev/api"

// Library downloads free Polyfork assets and keeps them in a folder with a
// manifest.json that lists them.
type Library struct {
	dirOnce sync.Once
	dir     string
	mu      sync.Mutex
	client  *http.Client

	kitMu     sync.Mutex
	kitTitles map[string]string
}

// NewLibrary returns a library stored in the app's user data folder.
func NewLibrary() *Library {
	return &Library{client: &http.Client{Timeout: 2 * time.Minute}}
}

// Asset is a downloaded model.
type Asset struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Class     string `json:"class,omitempty"`
	Kit       string `json:"kit,omitempty"`
	KitTitle  string `json:"kit_title,omitempty"`
	Triangles int    `json:"triangles,omitempty"`
	Size      *Size  `json:"size_m,omitempty"`
	Rigged    bool   `json:"rigged,omitempty"`
	Page      string `json:"page,omitempty"`
	GLB       string `json:"glb"`
	Thumb     string `json:"thumb,omitempty"`
	Bytes     int64  `json:"bytes,omitempty"`
	// Meta is the version of the metadata above; entries below metaVersion
	// are brought up to date by Refresh.
	Meta int `json:"meta,omitempty"`
}

const metaVersion = 1

// Size is an asset's bounding box in metres.
type Size struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

// Kit is a Polyfork kit: a set of assets that share a palette and scale.
type Kit struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
	Parts  int    `json:"parts"`
}

// DownloadOptions selects which assets to download. At least one field
// must be set; All selects the whole free catalogue.
type DownloadOptions struct {
	All   bool   `json:"all,omitempty"`
	Kit   string `json:"kit,omitempty"`
	Query string `json:"query,omitempty"`
	Class string `json:"class,omitempty"`
	Limit int    `json:"limit,omitempty"`
}

// Progress reports a download in progress.
type Progress struct {
	Done   int    `json:"done"`
	Total  int    `json:"total"`
	ID     string `json:"id,omitempty"`
	Title  string `json:"title,omitempty"`
	Error  string `json:"error,omitempty"`
	Cached bool   `json:"cached,omitempty"`
}

// Folder returns the folder the models are stored in.
// It is resolved on first use, so that `mygo generate`, which runs main to
// read the bindings, creates no folder.
func (l *Library) Folder() string {
	l.dirOnce.Do(func() {
		base, err := mygo.App.Path(mygo.PathUserData)
		if err != nil {
			log.Fatal(err)
		}
		l.dir = filepath.Join(base, "models")
		if err := os.MkdirAll(l.dir, 0o755); err != nil {
			log.Fatal(err)
		}
	})
	return l.dir
}

// OpenFolder shows the models folder in Finder.
func (l *Library) OpenFolder() error { return mygo.Shell.OpenPath(l.Folder()) }

// OpenPage opens an asset's page on polyfork.dev in the browser.
func (l *Library) OpenPage(id string) error {
	return mygo.Shell.OpenExternal("https://polyfork.dev/asset/" + url.PathEscape(id))
}

// List returns the downloaded models, sorted by title.
func (l *Library) List() ([]Asset, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.readManifest()
}

// Kits returns the kits on polyfork.dev.
func (l *Library) Kits(ctx context.Context) ([]Kit, error) {
	var res struct {
		Kits []struct {
			ID             string `json:"id"`
			Title          string `json:"title"`
			Status         string `json:"status"`
			PartsPublished int    `json:"parts_published"`
		} `json:"kits"`
	}
	if err := l.getJSON(ctx, apiBase+"/kits", &res); err != nil {
		return nil, err
	}
	kits := make([]Kit, len(res.Kits))
	for i, k := range res.Kits {
		kits[i] = Kit{ID: k.ID, Title: k.Title, Status: k.Status, Parts: k.PartsPublished}
	}
	slices.SortFunc(kits, func(a, b Kit) int { return strings.Compare(a.Title, b.Title) })
	return kits, nil
}

// Download fetches the assets opts selects, sending progress as each one
// finishes, and returns how many are now in the library.
func (l *Library) Download(ctx context.Context, opts DownloadOptions, progress *mygo.Channel[Progress]) (int, error) {
	if !opts.All && opts.Kit == "" && opts.Query == "" && opts.Class == "" && opts.Limit <= 0 {
		return 0, errors.New("choose a kit, a search, a class or a limit, or download everything")
	}
	if opts.All {
		opts = DownloadOptions{All: true}
	}
	titles := l.kitNames(ctx)
	remote, err := l.search(ctx, opts)
	if err != nil {
		return 0, err
	}
	if len(remote) == 0 {
		return 0, errors.New("no assets match")
	}

	var (
		sendMu sync.Mutex
		done   int
		got    []Asset
		wg     sync.WaitGroup
		jobs   = make(chan remoteAsset)
	)
	progress.Send(Progress{Total: len(remote)})
	for range 4 {
		wg.Go(func() {
			for r := range jobs {
				a, cached, err := l.fetchAsset(ctx, r, titles)
				sendMu.Lock()
				done++
				p := Progress{Done: done, Total: len(remote), ID: r.ID, Title: r.Title, Cached: cached}
				if err != nil {
					p.Error = err.Error()
				} else {
					got = append(got, a)
				}
				progress.Send(p)
				sendMu.Unlock()
			}
		})
	}
	for _, r := range remote {
		select {
		case jobs <- r:
		case <-ctx.Done():
		}
		if ctx.Err() != nil {
			break
		}
	}
	close(jobs)
	wg.Wait()

	l.mu.Lock()
	defer l.mu.Unlock()
	all, err := l.readManifest()
	if err != nil {
		return 0, err
	}
	byID := map[string]Asset{}
	for _, a := range all {
		byID[a.ID] = a
	}
	for _, a := range got {
		byID[a.ID] = a
	}
	if err := l.writeManifest(byID); err != nil {
		return 0, err
	}
	return len(byID), ctx.Err()
}

// Catalog describes the whole free catalogue on polyfork.dev.
type Catalog struct {
	Total int `json:"total"`
	// Bytes estimates the download from the average size of the models
	// already in the library.
	Bytes int64 `json:"bytes"`
}

// Catalog returns how many free assets polyfork.dev has and about how much
// downloading all of them takes.
func (l *Library) Catalog(ctx context.Context) (Catalog, error) {
	var res struct {
		Total int `json:"total"`
	}
	if err := l.getJSON(ctx, apiBase+"/assets?free=1&per_page=1&fields=compact", &res); err != nil {
		return Catalog{}, err
	}
	avg := int64(1 << 20)
	if all, err := l.List(); err == nil {
		var sum, n int64
		for _, a := range all {
			if a.Bytes == 0 {
				continue
			}
			sum += a.Bytes
			n++
			if a.Thumb != "" {
				if fi, err := os.Stat(filepath.Join(l.Folder(), a.Thumb)); err == nil {
					sum += fi.Size()
				}
			}
		}
		if n > 0 {
			avg = sum / n
		}
	}
	return Catalog{Total: res.Total, Bytes: avg * int64(res.Total)}, nil
}

// Refresh fetches the metadata of downloaded models whose entries are older
// than this version of the app, and returns how many it updated.
func (l *Library) Refresh(ctx context.Context) (int, error) {
	l.mu.Lock()
	all, err := l.readManifest()
	l.mu.Unlock()
	if err != nil {
		return 0, err
	}
	var stale []Asset
	for _, a := range all {
		if a.Meta < metaVersion {
			stale = append(stale, a)
		}
	}
	if len(stale) == 0 {
		return 0, nil
	}
	titles := l.kitNames(ctx)
	fresh := make([]Asset, len(stale))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for i, a := range stale {
		wg.Go(func() {
			sem <- struct{}{}
			defer func() { <-sem }()
			var r remoteAsset
			if err := l.getJSON(ctx, apiBase+"/assets/"+url.PathEscape(a.ID), &r); err != nil || r.ID != a.ID {
				return
			}
			n := r.asset(titles)
			n.GLB, n.Thumb, n.Bytes = a.GLB, a.Thumb, a.Bytes
			if n.Bytes == 0 {
				if fi, err := os.Stat(filepath.Join(l.Folder(), a.GLB)); err == nil {
					n.Bytes = fi.Size()
				}
			}
			fresh[i] = n
		})
	}
	wg.Wait()

	l.mu.Lock()
	defer l.mu.Unlock()
	all, err = l.readManifest()
	if err != nil {
		return 0, err
	}
	byID := map[string]Asset{}
	for _, a := range all {
		byID[a.ID] = a
	}
	updated := 0
	for _, n := range fresh {
		if _, ok := byID[n.ID]; ok && n.ID != "" {
			byID[n.ID] = n
			updated++
		}
	}
	return updated, l.writeManifest(byID)
}

// kitNames maps kit ids to their titles, fetched once; it is empty when the
// kits cannot be read.
func (l *Library) kitNames(ctx context.Context) map[string]string {
	l.kitMu.Lock()
	defer l.kitMu.Unlock()
	if l.kitTitles == nil {
		kits, err := l.Kits(ctx)
		if err != nil {
			return map[string]string{}
		}
		l.kitTitles = map[string]string{}
		for _, k := range kits {
			l.kitTitles[k.ID] = k.Title
		}
	}
	return l.kitTitles
}

// Remove deletes a downloaded model.
func (l *Library) Remove(id string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	all, err := l.readManifest()
	if err != nil {
		return err
	}
	byID := map[string]Asset{}
	for _, a := range all {
		if a.ID == id {
			os.Remove(filepath.Join(l.Folder(), a.GLB))
			if a.Thumb != "" {
				os.Remove(filepath.Join(l.Folder(), a.Thumb))
			}
			continue
		}
		byID[a.ID] = a
	}
	return l.writeManifest(byID)
}

type remoteAsset struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Class     string `json:"class"`
	Kit       string `json:"kit"`
	Triangles int    `json:"triangles"`
	Size      *Size  `json:"size_m"`
	HasRig    bool   `json:"has_rig"`
	Page      string `json:"page"`
	Thumbnail string `json:"thumbnail"`
	Download  struct {
		GLB string `json:"glb"`
	} `json:"download"`
}

func (l *Library) search(ctx context.Context, opts DownloadOptions) ([]remoteAsset, error) {
	var all []remoteAsset
	for page := 1; ; page++ {
		q := url.Values{"free": {"1"}, "per_page": {"100"}, "page": {fmt.Sprint(page)}}
		if opts.Kit != "" {
			q.Set("kit", opts.Kit)
		}
		if opts.Query != "" {
			q.Set("q", opts.Query)
		}
		if opts.Class != "" {
			q.Set("class", opts.Class)
		}
		var res struct {
			Total  int           `json:"total"`
			Assets []remoteAsset `json:"assets"`
		}
		if err := l.getJSON(ctx, apiBase+"/assets?"+q.Encode(), &res); err != nil {
			return nil, err
		}
		all = append(all, res.Assets...)
		if len(res.Assets) == 0 || len(all) >= res.Total || (opts.Limit > 0 && len(all) >= opts.Limit) {
			break
		}
	}
	if opts.Limit > 0 && len(all) > opts.Limit {
		all = all[:opts.Limit]
	}
	return all, nil
}

func (r remoteAsset) asset(titles map[string]string) Asset {
	return Asset{
		ID: r.ID, Title: r.Title, Class: r.Class, Kit: r.Kit, KitTitle: titles[r.Kit], Triangles: r.Triangles,
		Size: r.Size, Rigged: r.HasRig, Page: r.Page, GLB: r.ID + ".glb", Meta: metaVersion,
	}
}

func (l *Library) fetchAsset(ctx context.Context, r remoteAsset, titles map[string]string) (Asset, bool, error) {
	glbURL := r.Download.GLB
	if glbURL == "" {
		glbURL = "https://polyfork.dev/cdn/" + url.PathEscape(r.ID) + ".glb"
	}
	thumbURL := r.Thumbnail
	if thumbURL == "" {
		thumbURL = "https://polyfork.dev/files/" + url.PathEscape(r.ID) + "/renders/hero.png"
	}
	a := r.asset(titles)
	cached, err := l.fetchFile(ctx, glbURL, a.GLB)
	if err != nil {
		return a, false, err
	}
	if _, err := l.fetchFile(ctx, thumbURL, r.ID+".png"); err == nil {
		a.Thumb = r.ID + ".png"
	}
	if fi, err := os.Stat(filepath.Join(l.Folder(), a.GLB)); err == nil {
		a.Bytes = fi.Size()
	}
	return a, cached, nil
}

// fetchFile downloads src to name in the library, unless it is there already.
func (l *Library) fetchFile(ctx context.Context, src, name string) (cached bool, err error) {
	dest := filepath.Join(l.Folder(), name)
	if fi, err := os.Stat(dest); err == nil && fi.Size() > 0 {
		return true, nil
	}
	resp, err := l.get(ctx, src)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	tmp := dest + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return false, err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(tmp)
		return false, err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return false, err
	}
	return false, os.Rename(tmp, dest)
}

func (l *Library) get(ctx context.Context, u string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "polyfork-local-viewer/1.0")
	resp, err := l.client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("%s: %s", u, resp.Status)
	}
	return resp, nil
}

func (l *Library) getJSON(ctx context.Context, u string, v any) error {
	resp, err := l.get(ctx, u)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return json.NewDecoder(resp.Body).Decode(v)
}

func (l *Library) manifestPath() string { return filepath.Join(l.Folder(), "manifest.json") }

// readManifest and writeManifest are called with l.mu held.
func (l *Library) readManifest() ([]Asset, error) {
	b, err := os.ReadFile(l.manifestPath())
	if errors.Is(err, os.ErrNotExist) {
		return []Asset{}, nil
	}
	if err != nil {
		return nil, err
	}
	var all []Asset
	if err := json.Unmarshal(b, &all); err != nil {
		return nil, fmt.Errorf("manifest.json: %w", err)
	}
	return all, nil
}

func (l *Library) writeManifest(byID map[string]Asset) error {
	all := make([]Asset, 0, len(byID))
	for _, a := range byID {
		all = append(all, a)
	}
	slices.SortFunc(all, func(a, b Asset) int {
		return strings.Compare(strings.ToLower(a.Title), strings.ToLower(b.Title))
	})
	b, err := json.MarshalIndent(all, "", " ")
	if err != nil {
		return err
	}
	tmp := l.manifestPath() + ".part"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, l.manifestPath())
}
