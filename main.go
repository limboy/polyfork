package main

import (
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/egoist/mygo"
)

func main() {
	lib := NewLibrary()
	mygo.Bind(lib)
	mygo.Bind(NewAppUpdates())

	// models://localhost/<id>.glb serves the downloaded files to the page.
	var files http.Handler
	var once sync.Once
	mygo.Protocol.HandleFunc("models", func(w http.ResponseWriter, r *http.Request) {
		once.Do(func() { files = mygo.FileServer(os.DirFS(lib.Folder())) })
		files.ServeHTTP(w, r)
	})

	mygo.App.WhenReady(func() {
		win := mygo.NewWindow(mygo.WindowOptions{
			Title:           "Polyfork",
			Width:           1280,
			Height:          820,
			MinWidth:        720,
			MinHeight:       480,
			BackgroundColor: "light-dark(#f4f3ef, #18181a)", // the page's --bg in src/style.css
			StateKey:        "main",
			URL:             "/",
		})
		mygo.App.SetMenu(mygo.NewMenu([]*mygo.MenuItem{
			{Label: mygo.App.Name(), Submenu: []*mygo.MenuItem{
				{Role: mygo.RoleAbout},
				{Label: "Check for Updates…", Click: func(*mygo.MenuItem, *mygo.Window) {
					win.Show()
					if err := AppUpdateRequested.Emit(win, true); err != nil {
						log.Println(err)
					}
				}},
				mygo.Separator(),
				{Role: mygo.RoleServices},
				mygo.Separator(),
				{Role: mygo.RoleHide},
				{Role: mygo.RoleHideOthers},
				{Role: mygo.RoleUnhide},
				mygo.Separator(),
				{Role: mygo.RoleQuit},
			}},
			{Role: mygo.RoleFileMenu},
			{Role: mygo.RoleEditMenu},
			{Role: mygo.RoleViewMenu},
			{Role: mygo.RoleWindowMenu},
		}))
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
