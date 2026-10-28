package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/egoist/mygo"
)

// TestUpdates downloads two real assets, then checks that a changed file is
// found and that Update restores it; -short skips it.
func TestUpdates(t *testing.T) {
	if testing.Short() {
		t.Skip("needs the network")
	}
	l := NewLibrary()
	dir := t.TempDir()
	l.dirOnce.Do(func() { l.dir = dir })
	ctx := context.Background()

	if n, err := l.Download(ctx, DownloadOptions{Query: "chair", Limit: 2}, &mygo.Channel[Progress]{}); err != nil || n != 2 {
		t.Fatalf("Download: %v, %d", err, n)
	}
	list, _ := l.List()
	a := list[0]

	u, err := l.CheckUpdates(ctx, &mygo.Channel[CheckProgress]{})
	if err != nil {
		t.Fatal(err)
	}
	if len(u.Changed) != 0 || u.Gone != 0 || len(u.New) < 100 {
		t.Fatalf("fresh library: %d changed, %d gone, %d new", len(u.Changed), u.Gone, len(u.New))
	}
	for _, n := range u.New {
		if n.ID == a.ID {
			t.Fatalf("%s is downloaded but listed as new", a.ID)
		}
	}

	// Change the file on disk, as a new version on the site would look.
	path := filepath.Join(dir, a.GLB)
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	f.Write([]byte{0})
	f.Close()
	if !l.changed(ctx, a) {
		t.Fatalf("%s: a modified file is not reported as changed", a.ID)
	}

	if _, err := l.Update(ctx, []string{a.ID}, &mygo.Channel[Progress]{}); err != nil {
		t.Fatal(err)
	}
	if l.changed(ctx, a) {
		t.Fatalf("%s: still changed after Update", a.ID)
	}
}
