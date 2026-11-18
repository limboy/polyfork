package main

import (
	"cmp"
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

type updateTestTransport struct {
	target *url.URL
	base   http.RoundTripper
}

func (tr updateTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.URL.Scheme = tr.target.Scheme
	req.URL.Host = tr.target.Host
	return tr.base.RoundTrip(req)
}

func TestUpdateHandlesMetadataPerModel(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusNotFound, http.StatusGone, http.StatusInternalServerError} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/assets/broken":
					if status == http.StatusOK {
						fmt.Fprint(w, `{"id":"broken","title":"Resolved model"}`)
					} else {
						w.WriteHeader(status)
					}
				case "/cdn/new.glb", "/cdn/broken.glb":
					fmt.Fprint(w, "new model")
				case "/anim/clips.json":
					fmt.Fprint(w, "{}")
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			l := NewLibrary()
			dir := t.TempDir()
			l.dirOnce.Do(func() { l.dir = dir })
			l.kitTitles = map[string]string{}
			target, _ := url.Parse(server.URL)
			l.client.Transport = updateTestTransport{target, http.DefaultTransport}
			l.rememberRemote([]remoteAsset{{ID: "new", Title: "New model"}})

			// A failed catalogue lookup must not prevent the other selected
			// models from downloading and being saved in the manifest.
			n, err := l.Update(context.Background(), []string{"broken", "new"}, &mygo.Channel[Progress]{})
			want := 1
			if status == http.StatusOK {
				want = 2
			}
			if err != nil || n != want {
				t.Fatalf("Update: %d models, %v", n, err)
			}
			all, err := l.List()
			if err != nil || len(all) != want {
				t.Fatalf("downloaded model was not recorded with an update time: %+v, %v", all, err)
			}
			for _, a := range all {
				if a.UpdatedAt == 0 || (a.ID == "broken" && a.Title != "Resolved model") {
					t.Fatalf("incorrect metadata after update: %+v", a)
				}
			}
			if data, err := os.ReadFile(filepath.Join(dir, "new.glb")); err != nil || string(data) != "new model" {
				t.Fatalf("available model was not downloaded: %q, %v", data, err)
			}
		})
	}
}

func TestUpdatesPreserveDelistedModelsAndDownloadNewOnes(t *testing.T) {
	var goneRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/assets":
			json.NewEncoder(w).Encode(struct {
				Total  int           `json:"total"`
				Assets []remoteAsset `json:"assets"`
			}{2, []remoteAsset{{ID: "listed", Title: "Listed"}, {ID: "new", Title: "New"}}})
		case "/cdn/gone.glb":
			// Delisted models can retain a changed file on the CDN even
			// though their API detail page now returns 404.
			goneRequests.Add(1)
			fallthrough
		case "/cdn/listed.glb", "/cdn/new.glb":
			w.Header().Set("ETag", fmt.Sprintf(`"%x"`, md5.Sum([]byte("new model"))))
			if r.Method != http.MethodHead {
				fmt.Fprint(w, "new model")
			}
		case "/anim/clips.json":
			fmt.Fprint(w, "{}")
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	l := NewLibrary()
	dir := t.TempDir()
	l.dirOnce.Do(func() { l.dir = dir })
	l.kitTitles = map[string]string{}
	target, _ := url.Parse(server.URL)
	l.client.Transport = updateTestTransport{target, http.DefaultTransport}
	oldTime := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	local := map[string]Asset{}
	for _, id := range []string{"listed", "gone"} {
		a := Asset{ID: id, Title: id, GLB: id + ".glb"}
		path := filepath.Join(dir, a.GLB)
		if err := os.WriteFile(path, []byte("local model"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, oldTime, oldTime); err != nil {
			t.Fatal(err)
		}
		local[id] = a
	}
	if err := l.writeManifest(local); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	u, err := l.CheckUpdates(ctx)
	if err != nil || u.Gone != 1 || len(u.New) != 1 || u.New[0].ID != "new" {
		t.Fatalf("CheckUpdates: %+v, %v", u, err)
	}
	changed, err := l.CheckChanged(ctx, &mygo.Channel[CheckProgress]{})
	if err != nil || len(changed) != 1 || changed[0].ID != "listed" {
		t.Fatalf("CheckChanged must exclude delisted models: %+v, %v", changed, err)
	}
	if goneRequests.Load() != 0 {
		t.Fatal("CheckChanged checked a delisted model's stale CDN file")
	}
	if n, err := l.Update(ctx, []string{changed[0].ID, u.New[0].ID}, &mygo.Channel[Progress]{}); err != nil || n != 3 {
		t.Fatalf("Update: %d models, %v", n, err)
	}
	all, err := l.List()
	if err != nil || len(all) != 3 {
		t.Fatalf("List: %+v, %v", all, err)
	}
	slices.SortFunc(all, func(a, b Asset) int { return cmp.Compare(b.UpdatedAt, a.UpdatedAt) })
	if all[2].ID != "gone" || all[2].UpdatedAt != oldTime.UnixMilli() || all[0].UpdatedAt <= oldTime.UnixMilli() || all[1].UpdatedAt <= oldTime.UnixMilli() {
		t.Fatalf("new and updated models must sort before the preserved model: %+v", all)
	}
	if data, err := os.ReadFile(filepath.Join(dir, "gone.glb")); err != nil || string(data) != "local model" {
		t.Fatalf("delisted model was changed: %q, %v", data, err)
	}
	u, err = l.CheckUpdates(ctx)
	if err != nil || len(u.New) != 0 || u.Gone != 1 {
		t.Fatalf("next check must not list downloaded models as new: %+v, %v", u, err)
	}
}
