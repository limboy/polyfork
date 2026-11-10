package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"golang.org/x/mod/semver"
)

const (
	appReleasesAPI = "https://api.github.com/repos/limboy/polyfork/releases/latest"
	appReleasesURL = "https://github.com/limboy/polyfork/releases"
)

// AppUpdateRequested opens the app update dialog from the application menu.
var AppUpdateRequested = mygo.NewEvent[bool]("app-update-requested")

// AppUpdates checks published application releases independently of model updates.
type AppUpdates struct {
	client  *http.Client
	apiURL  string
	version string
}

func NewAppUpdates() *AppUpdates {
	return &AppUpdates{
		client:  &http.Client{Timeout: 15 * time.Second},
		apiURL:  appReleasesAPI,
		version: strings.TrimPrefix(mygo.App.Version(), "v"),
	}
}

// AppRelease describes the latest stable application release and its changes.
type AppRelease struct {
	CurrentVersion string `json:"currentVersion"`
	Version        string `json:"version"`
	Available      bool   `json:"available"`
	Notes          string `json:"notes"`
	ReleaseURL     string `json:"releaseURL"`
	DownloadURL    string `json:"downloadURL,omitempty"`
}

// Version returns the running app's version; a plain development executable may have none.
func (u *AppUpdates) Version() string {
	v := "v" + strings.TrimPrefix(u.version, "v")
	if !semver.IsValid(v) {
		return ""
	}
	return strings.TrimPrefix(v, "v")
}

// Check reads the latest stable GitHub release, including its Markdown release notes.
func (u *AppUpdates) Check(ctx context.Context) (AppRelease, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.apiURL, nil)
	if err != nil {
		return AppRelease{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2026-03-10")
	req.Header.Set("User-Agent", "Polyfork/"+u.version)
	resp, err := u.client.Do(req)
	if err != nil {
		return AppRelease{}, fmt.Errorf("无法连接更新服务：%w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return AppRelease{}, errors.New("暂未找到已发布的正式版本。")
	case http.StatusForbidden, http.StatusTooManyRequests:
		return AppRelease{}, errors.New("更新检查暂时受限，请稍后重试。")
	default:
		return AppRelease{}, fmt.Errorf("更新服务返回 %s，请稍后重试。", resp.Status)
	}
	var release struct {
		Tag        string `json:"tag_name"`
		Body       string `json:"body"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
		Assets     []struct {
			Name  string `json:"name"`
			URL   string `json:"browser_download_url"`
			State string `json:"state"`
			Size  int64  `json:"size"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&release); err != nil {
		return AppRelease{}, errors.New("无法读取更新信息，请稍后重试。")
	}
	tag := "v" + strings.TrimPrefix(release.Tag, "v")
	if release.Draft || release.Prerelease || !semver.IsValid(tag) || semver.Prerelease(tag) != "" {
		return AppRelease{}, errors.New("正式版本信息无效，请稍后重试。")
	}
	currentVersion := u.Version()
	current := "v" + currentVersion
	result := AppRelease{
		CurrentVersion: currentVersion,
		Version:        strings.TrimPrefix(tag, "v"),
		Available:      semver.IsValid(current) && semver.Compare(tag, current) > 0,
		Notes:          strings.TrimSpace(release.Body),
		ReleaseURL:     appReleasesURL + "/tag/" + url.PathEscape(release.Tag),
	}
	// The release workflow publishes one universal macOS DMG. Only offer it
	// once the upload has finished and its URL belongs to this repository.
	name := "polyfork-" + result.Version + ".dmg"
	download := appReleasesURL + "/download/" + url.PathEscape(release.Tag) + "/" + url.PathEscape(name)
	for _, asset := range release.Assets {
		if asset.Name == name && asset.State == "uploaded" && asset.Size > 0 && asset.URL == download {
			result.DownloadURL = asset.URL
			break
		}
	}
	return result, nil
}

// OpenURL opens an HTTPS release-note or download link in the user's browser.
func (u *AppUpdates) OpenURL(raw string) error {
	link, err := httpsURL(raw)
	if err != nil {
		return err
	}
	return mygo.Shell.OpenExternal(link)
}

func httpsURL(raw string) (string, error) {
	link, err := url.Parse(raw)
	if err != nil || link.Scheme != "https" || link.Host == "" || link.User != nil {
		return "", errors.New("无法打开此链接。")
	}
	return link.String(), nil
}
