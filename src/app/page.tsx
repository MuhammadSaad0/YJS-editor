"use client";

import { useState, useEffect, useRef } from "react";
import * as Y from "yjs";
import { supabase } from "../lib/supabaseClient";
import "quill/dist/quill.snow.css";
import { WebsocketProvider } from "y-websocket";

export default function NovelEditor() {
  const [novels, setNovels] = useState("");
  const [selectedNovel, setSelectedNovel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editorReady, setEditorReady] = useState(false);

  const editorRef = useRef(null);
  const quillRef = useRef(null);
  const ydocRef = useRef(null);
  const providerRef = useRef(null);
  const bindingRef = useRef(null);

  useEffect(() => {
    let quill: any = null;
    let ydoc: any = null;
    let provider: any = null;
    let binding: any = null;

    const initializeEditor = async () => {
      if (!editorRef.current) return;

      try {
        const [
          { default: Quill },
          { default: QuillCursors },
          { QuillBinding },
          { WebrtcProvider },
        ] = await Promise.all([
          import("quill"),
          import("quill-cursors"),
          import("y-quill"),
          import("y-webrtc"),
        ]);

        Quill.register("modules/cursors", QuillCursors);

        quill = new Quill(editorRef.current, {
          modules: {
            cursors: true,
            toolbar: [
              [{ header: [1, 2, false] }],
              ["bold", "italic", "underline"],
              ["image", "code-block"],
              ["clean"],
            ],
            history: {
              userOnly: true,
            },
          },
          placeholder: "Start collaborating on your novel...",
          theme: "snow",
        });

        ydoc = new Y.Doc();
        provider = new WebsocketProvider(
          "wss://websocket-broken-water-5889.fly.dev/",
          "novel-editor-room",
          ydoc
        );
        const ytext = ydoc.getText("quill");

        const awareness = provider.awareness;

        awareness.setLocalStateField("user", {
          color: "#ffb61e",
        });

        binding = new QuillBinding(ytext, quill, awareness);

        quillRef.current = quill;
        ydocRef.current = ydoc;
        providerRef.current = provider;
        bindingRef.current = binding;
        quill.setText(novels);

        // // Load initial content if available and Yjs document is empty
        // if (novels && novels.ops && ytext.length === 0) {
        //   quill.setContents(novels)
        // }

        const handleBlur = () => {
          quill.blur();
        };
        window.addEventListener("blur", handleBlur);

        setEditorReady(true);

        // Store cleanup function
        return () => {
          // window.removeEventListener("blur", handleBlur);
          // if (binding) binding.destroy();
          // if (provider) provider.destroy();
          // if (ydoc) ydoc.destroy();
        };
      } catch (error) {
        console.error("Error initializing editor:", error);
      }
    };

    initializeEditor().then((cleanup) => {
      // Store cleanup function for later use
      // if (cleanup) {
      //   if(editorRef && editorRef.current && editorRef.current.cleanup){
      //   editorRef.current.cleanup = cleanup
      //   }
      // }
    });

    return () => {
      // if (editorRef.current?.cleanup) {
      //   editorRef.current.cleanup()
      // }
    };
  }, [novels]);

  useEffect(() => {
    async function fetchNovels() {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("novels")
          .select("final_manuscript")
          .eq("id", 1031);
        console.log(data);
        if (error) {
          throw error;
        }

        const manuscript = data[0]?.final_manuscript;
        setNovels(manuscript || { ops: [] });
      } catch (error) {
        console.error("Error fetching novels:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchNovels();
  }, []);

  const saveToSupabase = async () => {
    // if (!quillRef.current) return
    // const contents = quillRef.current.getContents()
    // try {
    //   const { error } = await supabase
    //     .from('novels')
    //     .update({ final_manuscript: contents })
    //     .eq('id', 1031)
    //   if (error) throw error
    //   alert('Content saved successfully!')
    // } catch (error) {
    //   console.error('Error saving content:', error)
    //   alert('Failed to save content')
    // }
  };

  useEffect(() => {
    if (!editorReady || !quillRef.current) return;

    const autoSave = () => {
      saveToSupabase();
    };

    const interval = setInterval(autoSave, 30000);

    return () => clearInterval(interval);
  }, [editorReady]);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-300 rounded w-1/4 mb-4"></div>
          <div className="h-96 bg-gray-300 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-4">Collaborative Novel Editor</h1>
        <div className="flex gap-4">
          <button
            onClick={saveToSupabase}
            disabled={!editorReady}
            className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white px-4 py-2 rounded transition-colors"
          >
            Save to Database
          </button>
          <div className="flex items-center">
            <div
              className={`w-3 h-3 rounded-full mr-2 ${
                editorReady ? "bg-green-500" : "bg-red-500"
              }`}
            ></div>
            <span className="text-sm text-gray-600">
              {editorReady ? "Connected" : "Connecting..."}
            </span>
          </div>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div ref={editorRef} className="min-h-96" />
      </div>

      <style jsx global>{`
        @import "quill/dist/quill.snow.css";

        .ql-editor {
          min-height: 300px;
        }

        .ql-container {
          font-size: 14px;
        }

        .ql-editor.ql-blank::before {
          font-style: italic;
          color: #aaa;
        }
      `}</style>
    </div>
  );
}
