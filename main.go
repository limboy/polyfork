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

	// models://localhost/<id>.glb serves the downloaded files to the page.
	var files http.Handler
	var once sync.Once
	mygo.Protocol.HandleFunc("models", func(w http.ResponseWriter, r *http.Request) {
		once.Do(func() { files = mygo.FileServer(os.DirFS(lib.Folder())) })
		files.ServeHTTP(w, r)
	})

	mygo.App.WhenReady(func() {
		mygo.NewWindow(mygo.WindowOptions{
			Title:           "Polyfork",
			Width:           1280,
			Height:          820,
			MinWidth:        720,
			MinHeight:       480,
			BackgroundColor: "light-dark(#f4f3ef, #18181a)", // the page's --bg in src/style.css
			StateKey:        "main",
			URL:             "/",
		})
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
