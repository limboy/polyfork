package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

func TestListUpdateTimesForExistingLibrary(t *testing.T) {
	l := NewLibrary()
	dir := t.TempDir()
	l.dirOnce.Do(func() { l.dir = dir })
	oldTime := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	newTime := oldTime.Add(24 * time.Hour)
	assets := map[string]Asset{}
	for id, modified := range map[string]time.Time{"old": oldTime, "new": newTime} {
		a := Asset{ID: id, Title: id, GLB: id + ".glb"}
		path := filepath.Join(dir, a.GLB)
		if err := os.WriteFile(path, []byte(id), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, modified, modified); err != nil {
			t.Fatal(err)
		}
		assets[id] = a // A legacy manifest has no update times.
	}
	assets["missing"] = Asset{ID: "missing", Title: "Missing", GLB: "missing.glb"}
	if err := l.writeManifest(assets); err != nil {
		t.Fatal(err)
	}
	list, err := l.List()
	if err != nil || len(list) != 3 {
		t.Fatalf("List: %+v, %v", list, err)
	}
	want := map[string]int64{"old": oldTime.UnixMilli(), "new": newTime.UnixMilli(), "missing": 0}
	for _, a := range list {
		if a.UpdatedAt != want[a.ID] {
			t.Errorf("%s: update time %d, want %d", a.ID, a.UpdatedAt, want[a.ID])
		}
	}
}

func TestUpdateTimeChangesOnlyWithModelFile(t *testing.T) {
	var status atomic.Int32
	status.Store(http.StatusOK)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(int(status.Load()))
		fmt.Fprint(w, "model")
	}))
	defer server.Close()
	l := NewLibrary()
	dir := t.TempDir()
	l.dirOnce.Do(func() { l.dir = dir })
	l.kitTitles = map[string]string{}
	r := remoteAsset{ID: "model", Title: "Model", Thumbnail: server.URL + "/thumb.png"}
	r.Download.GLB = server.URL + "/model.glb"
	ctx := context.Background()
	fetch := func(force bool) Asset {
		t.Helper()
		if n, err := l.fetchMany(ctx, []remoteAsset{r}, force, &mygo.Channel[Progress]{}); err != nil || n != 1 {
			t.Fatalf("fetchMany: %d models, %v", n, err)
		}
		all, err := l.List()
		if err != nil || len(all) != 1 {
			t.Fatalf("List: %+v, %v", all, err)
		}
		return all[0]
	}
	fetch(false)
	oldTime := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	if err := os.Chtimes(filepath.Join(dir, "model.glb"), oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	if cached := fetch(false); cached.UpdatedAt != oldTime.UnixMilli() {
		t.Fatalf("cached download changed update time: %d", cached.UpdatedAt)
	}
	// Refreshing the manifest's metadata must not make a model look newer.
	r.Title = "Updated title"
	if metadata := fetch(false); metadata.Title != r.Title || metadata.UpdatedAt != oldTime.UnixMilli() {
		t.Fatalf("metadata refresh changed update time: %+v", metadata)
	}
	updated := fetch(true)
	if updated.UpdatedAt <= oldTime.UnixMilli() {
		t.Fatalf("model update did not advance update time: %d", updated.UpdatedAt)
	}
	status.Store(http.StatusNotFound)
	if skipped := fetch(true); skipped.UpdatedAt != updated.UpdatedAt {
		t.Fatalf("unavailable source changed update time: %d", skipped.UpdatedAt)
	}
}
