package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/egoist/mygo"
)

func TestUnavailableSourcePreservesDownloadedFile(t *testing.T) {
	for _, code := range []int{http.StatusNotFound, http.StatusGone, http.StatusForbidden, http.StatusInternalServerError} {
		t.Run(fmt.Sprint(code), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(code)
			}))
			defer server.Close()
			l := NewLibrary()
			dir := t.TempDir()
			l.dirOnce.Do(func() { l.dir = dir })
			path := filepath.Join(dir, "model.glb")
			if err := os.WriteFile(path, []byte("local model"), 0o644); err != nil {
				t.Fatal(err)
			}

			_, err := l.fetchFile(context.Background(), server.URL, "model.glb", true)
			if err == nil {
				t.Fatal("expected an HTTP error")
			}
			if want := code == http.StatusNotFound || code == http.StatusGone; unavailable(err) != want {
				t.Fatalf("unavailable(%v) = %v, want %v", err, unavailable(err), want)
			}
			if data, err := os.ReadFile(path); err != nil || string(data) != "local model" {
				t.Fatalf("local model was changed: %q, %v", data, err)
			}
			if _, err := os.Stat(path + ".part"); !os.IsNotExist(err) {
				t.Fatalf("unexpected partial file: %v", err)
			}
		})
	}
	if unavailable(os.ErrNotExist) {
		t.Fatal("a local filesystem error must not be treated as an unavailable source")
	}
}

func TestFetchManyContinuesPastUnavailableSources(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/old.glb", "/missing.glb":
			w.WriteHeader(http.StatusNotFound)
		case "/broken.glb":
			w.WriteHeader(http.StatusInternalServerError)
		default:
			fmt.Fprint(w, "new model")
		}
	}))
	defer server.Close()
	l := NewLibrary()
	dir := t.TempDir()
	l.dirOnce.Do(func() { l.dir = dir })
	l.kitTitles = map[string]string{} // Keep the test entirely offline.
	old := Asset{ID: "old", Title: "Old model", GLB: "old.glb"}
	if err := os.WriteFile(filepath.Join(dir, old.GLB), []byte("local model"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := l.writeManifest(map[string]Asset{old.ID: old}); err != nil {
		t.Fatal(err)
	}
	var remote []remoteAsset
	for _, id := range []string{"old", "missing", "broken", "new"} {
		r := remoteAsset{ID: id, Title: id, Thumbnail: server.URL + "/thumb.png"}
		r.Download.GLB = server.URL + "/" + id + ".glb"
		remote = append(remote, r)
	}
	if n, err := l.fetchMany(context.Background(), remote, true, &mygo.Channel[Progress]{}); err != nil || n != 2 {
		t.Fatalf("fetchMany: %d models, %v", n, err)
	}
	list, err := l.List()
	if err != nil || len(list) != 2 {
		t.Fatalf("List: %+v, %v", list, err)
	}
	for _, a := range list {
		if a.ID != "old" && a.ID != "new" {
			t.Fatalf("failed download was saved in the manifest: %+v", a)
		}
	}
	if data, err := os.ReadFile(filepath.Join(dir, old.GLB)); err != nil || string(data) != "local model" {
		t.Fatalf("unavailable source replaced the old model: %q, %v", data, err)
	}
	if data, err := os.ReadFile(filepath.Join(dir, "new.glb")); err != nil || string(data) != "new model" {
		t.Fatalf("available model was not downloaded: %q, %v", data, err)
	}
}

// TestFetch downloads two real assets from polyfork.dev; -short skips it.
func TestFetch(t *testing.T) {
	if testing.Short() {
		t.Skip("needs the network")
	}
	l := NewLibrary()
	dir := t.TempDir()
	l.dirOnce.Do(func() { l.dir = dir })
	ctx := context.Background()

	kits, err := l.Kits(ctx)
	if err != nil || len(kits) == 0 {
		t.Fatalf("Kits: %v, %d kits", err, len(kits))
	}
	remote, err := l.search(ctx, DownloadOptions{Query: "chair", Limit: 2})
	if err != nil || len(remote) != 2 {
		t.Fatalf("search: %v, %d assets", err, len(remote))
	}
	byID := map[string]Asset{}
	for _, r := range remote {
		a, _, err := l.fetchAsset(ctx, r, l.kitNames(ctx), false)
		if err != nil {
			t.Fatal(err)
		}
		if a.Bytes == 0 || a.Thumb == "" {
			t.Errorf("%s: bytes %d, thumb %q", a.ID, a.Bytes, a.Thumb)
		}
		byID[a.ID] = a
	}
	if err := l.writeManifest(byID); err != nil {
		t.Fatal(err)
	}
	list, err := l.List()
	if err != nil || len(list) != 2 {
		t.Fatalf("List: %v, %d", err, len(list))
	}
	if err := l.Remove(list[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, list[0].GLB)); !os.IsNotExist(err) {
		t.Errorf("Remove left %s", list[0].GLB)
	}
	list, _ = l.List()
	if len(list) != 1 {
		t.Fatalf("after Remove: %d assets", len(list))
	}

	// An entry from an older version gets its metadata back.
	old := list[0]
	old.Meta, old.Class, old.Triangles = 0, "", 0
	if err := l.writeManifest(map[string]Asset{old.ID: old}); err != nil {
		t.Fatal(err)
	}
	if n, err := l.Refresh(ctx); err != nil || n != 1 {
		t.Fatalf("Refresh: %v, %d updated", err, n)
	}
	list, _ = l.List()
	if a := list[0]; a.Meta != metaVersion || a.Class == "" || a.Triangles == 0 || a.Bytes == 0 {
		t.Errorf("after Refresh: %+v", a)
	}
}
