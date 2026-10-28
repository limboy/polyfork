package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

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
