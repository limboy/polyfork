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
		a, _, err := l.fetchAsset(ctx, r)
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
	if list, _ := l.List(); len(list) != 1 {
		t.Errorf("after Remove: %d assets", len(list))
	}
}
