package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func testAppRelease(tag string) map[string]any {
	version := tag[1:]
	return map[string]any{
		"tag_name": tag,
		"body":     "## Changes\n\n- New sorting\n- Resizable sidebar",
		"assets": []map[string]any{{
			"name": "polyfork-" + version + ".dmg", "state": "uploaded", "size": 123,
			"browser_download_url": appReleasesURL + "/download/" + tag + "/polyfork-" + version + ".dmg",
		}},
	}
}

func testAppUpdates(t *testing.T, version string, response any) *AppUpdates {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") != "application/vnd.github+json" || r.Header.Get("User-Agent") == "" {
			t.Error("missing GitHub request headers")
		}
		json.NewEncoder(w).Encode(response)
	}))
	t.Cleanup(server.Close)
	return &AppUpdates{client: server.Client(), apiURL: server.URL, version: version}
}

func TestAppUpdateVersionComparison(t *testing.T) {
	for _, test := range []struct {
		current, latest string
		available       bool
	}{
		{"0.2.0", "v0.3.0", true},
		{"0.2.0", "v0.2.0", false},
		{"0.10.0", "v0.2.0", false},
		{"0.9.0", "v0.10.0", true},
		{"0.3.0-rc.1", "v0.3.0", true},
		{"0.3.0+build.1", "v0.3.0", false},
		{"v0.2.0", "v0.3.0", true},
		{"", "v0.3.0", false},
		{"development", "v0.3.0", false},
	} {
		t.Run(test.current+"/"+test.latest, func(t *testing.T) {
			service := testAppUpdates(t, test.current, testAppRelease(test.latest))
			release, err := service.Check(context.Background())
			if err != nil || release.Available != test.available {
				t.Fatalf("Check: %+v, %v", release, err)
			}
			if release.Notes == "" || release.DownloadURL == "" || release.ReleaseURL == "" {
				t.Fatalf("missing release details, including when up to date: %+v", release)
			}
			if test.current == "development" && release.CurrentVersion != "" {
				t.Fatal("an unversioned build must not be reported as up to date")
			}
		})
	}
}

func TestAppUpdateRequiresPublishedStableVersion(t *testing.T) {
	for _, test := range []struct{ tag, flag string }{
		{"v0.3.0", "draft"},
		{"v0.3.0", "prerelease"},
		{"v0.3.0-rc.1", ""},
		{"vnot-a-version", ""},
	} {
		t.Run(test.tag+test.flag, func(t *testing.T) {
			response := testAppRelease(test.tag)
			response[test.flag] = true
			if _, err := testAppUpdates(t, "0.2.0", response).Check(context.Background()); err == nil {
				t.Fatal("expected an invalid release error")
			}
		})
	}
}

func TestAppUpdateOffersOnlyCompletedUniversalDMG(t *testing.T) {
	for _, field := range []string{"missing", "name", "state", "size", "browser_download_url"} {
		t.Run(field, func(t *testing.T) {
			response := testAppRelease("v0.3.0")
			if field == "missing" {
				delete(response, "assets")
			} else {
				response["assets"].([]map[string]any)[0][field] = map[string]any{
					"name": "polyfork-0.3.0.zip", "state": "uploading", "size": 0,
					"browser_download_url": "https://example.com/polyfork-0.3.0.dmg",
				}[field]
			}
			release, err := testAppUpdates(t, "0.2.0", response).Check(context.Background())
			if err != nil || !release.Available || release.DownloadURL != "" || release.ReleaseURL == "" {
				t.Fatalf("expected release-page fallback: %+v, %v", release, err)
			}
		})
	}
}

func TestAppUpdateErrorsDoNotReportUpToDate(t *testing.T) {
	for _, code := range []int{http.StatusNotFound, http.StatusForbidden, http.StatusTooManyRequests, http.StatusInternalServerError, http.StatusOK} {
		t.Run(http.StatusText(code), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(code) // An empty HTTP 200 is invalid JSON.
			}))
			defer server.Close()
			service := &AppUpdates{client: server.Client(), apiURL: server.URL, version: "0.2.0"}
			if _, err := service.Check(context.Background()); err == nil {
				t.Fatal("expected a check failure")
			}
		})
	}
	service := testAppUpdates(t, "0.2.0", testAppRelease("v0.3.0"))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := service.Check(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
}

func TestAppUpdateLinks(t *testing.T) {
	for _, raw := range []string{"javascript:alert(1)", "file:///Applications", "http://example.com", "https:", "https://user:pass@example.com"} {
		if _, err := httpsURL(raw); err == nil {
			t.Errorf("accepted non-HTTPS or credential-bearing link: %s", raw)
		}
	}
	if link, err := httpsURL(appReleasesURL); err != nil || link != appReleasesURL {
		t.Fatalf("expected HTTPS release link: %q, %v", link, err)
	}
}

func TestAppReleaseLive(t *testing.T) {
	if testing.Short() {
		t.Skip("needs the network")
	}
	release, err := NewAppUpdates().Check(context.Background())
	if err != nil || release.Version == "" || release.Notes == "" || release.DownloadURL == "" {
		t.Fatalf("published release: %+v, %v", release, err)
	}
}
