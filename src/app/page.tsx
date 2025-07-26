"use client";

import { useState, useEffect, useRef } from "react";
import * as Y from "yjs";
import { supabase } from "../lib/supabaseClient";
import "quill/dist/quill.snow.css";
import { WebsocketProvider } from "y-websocket";

const TAB_SET_KEY = "novel-editor-tab-ids";

function getTabIds() {
  try {
    return JSON.parse(localStorage.getItem(TAB_SET_KEY) || "[]");
  } catch {
    return [];
  }
}

function setTabIds(ids: string[]) {
  localStorage.setItem(TAB_SET_KEY, JSON.stringify(ids));
}

export default function NovelEditor() {
  const [novels, setNovels] = useState({ ops: [] });
  const [loading, setLoading] = useState(true);
  const [editorReady, setEditorReady] = useState(false);
  const [versions, setVersions] = useState([]);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [contentLoaded, setContentLoaded] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSavedContent, setLastSavedContent] = useState("");
  const [userName] = useState(() => {
    if (typeof window !== "undefined") {
      let name = localStorage.getItem("novel-editor-username");
      if (!name) {
        name = `User-${Math.floor(Math.random() * 1000)}`;
        localStorage.setItem("novel-editor-username", name);
      }
      return name;
    }
    return "";
  });

  const editorRef: any = useRef(null);
  const quillRef: any = useRef(null);
  const ydocRef: any = useRef(null);
  const providerRef: any = useRef(null);
  const bindingRef: any = useRef(null);
  const initializedRef: any = useRef(false);
  const versionRefreshInterval: any = useRef(null);

  const TAB_ID = useRef(
    typeof window !== "undefined"
      ? window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
      : ""
  );
  const [tabIdsState, setTabIdsState] = useState([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let ids = getTabIds();
    if (!ids.includes(TAB_ID.current)) {
      ids.push(TAB_ID.current);
      setTabIds(ids);
    }
    setTabIdsState(getTabIds());

    const cleanup = () => {
      let ids = getTabIds().filter((id: string) => id !== TAB_ID.current);
      setTabIds(ids);
    };
    window.addEventListener("beforeunload", cleanup);

    const onStorage = (e: StorageEvent) => {
      if (e.key === TAB_SET_KEY) {
        setTabIdsState(getTabIds());
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      cleanup();
      window.removeEventListener("beforeunload", cleanup);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const isTabLeader = () => {
    const ids = getTabIds();
    return ids.length > 0 && TAB_ID.current === ids.sort().slice(-1)[0];
  };

  const fetchVersions = async () => {
    setVersionsLoading(true);
    try {
      const { data, error } = await supabase
        .from("novel_versions")
        .select("*")
        .eq("novel_id", 964)
        .order("created_at", { ascending: false });

      if (!error && data) {
        setVersions(data as any);
        console.log(`Fetched ${data.length} versions`);
      } else if (error) {
        console.error("Error fetching versions:", error);
      }
    } catch (err) {
      console.error("Exception fetching versions:", err);
    } finally {
      setVersionsLoading(false);
    }
  };

  useEffect(() => {
    const channel = supabase
      .channel("novel_versions_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "novel_versions",
          filter: "novel_id=eq.964",
        },
        (payload) => {
          console.log("Version change detected:", payload);
          fetchVersions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    fetchVersions();

    versionRefreshInterval.current = setInterval(() => {
      fetchVersions();
    }, 30000);

    return () => {
      if (versionRefreshInterval.current) {
        clearInterval(versionRefreshInterval.current);
      }
    };
  }, []);

  const revertToVersion = async (version: any) => {
    if (quillRef.current) {
      quillRef.current.setContents(version.content);
      
      setTimeout(() => {
        const currentText = quillRef.current.getText();
        setLastSavedContent(currentText);
        setHasUnsavedChanges(false);
        console.log("Updated lastSavedContent after version revert:", currentText);
      }, 100);
    }
    
    await supabase
      .from("novels")
      .update({
        final_manuscript: version.plain_text,
        current_version_id: version.id,
      })
      .eq("id", 964);

    fetchVersions();
  };

  const checkForChanges = () => {
    if (!quillRef.current) return false;
    
    const currentContent = quillRef.current.getText();
    const hasChanged = currentContent.trim() !== lastSavedContent.trim();
    
    if (hasChanged !== hasUnsavedChanges) {
      setHasUnsavedChanges(hasChanged);
      console.log("Change detected:", { 
        hasChanged, 
        currentLength: currentContent.length, 
        savedLength: lastSavedContent.length,
        currentPreview: currentContent.substring(0, 50),
        savedPreview: lastSavedContent.substring(0, 50)
      });
    }
    
    return hasChanged;
  };

  const loadInitialContent = async () => {
    if (!quillRef.current || !ydocRef.current) return;

    const ytext = ydocRef.current.getText("quill");

    console.log("Attempting to load content:", {
      contentLoaded,
      novelsType: typeof novels,
      novelsContent: novels,
      ytextLength: ytext.length,
      ytextString: ytext.toString(),
    });

    const hasContentToLoad =
      novels &&
      (typeof novels === "string" || (novels.ops && novels.ops.length > 0));

    if (hasContentToLoad && ytext.length === 0 && !contentLoaded) {
      console.log("Loading initial content:", novels);

      try {
        if (typeof novels === "string") {
          ytext.insert(0, novels);
          setLastSavedContent((novels as any).trim());
          console.log("Inserted plain text into YJS");
        } else if (novels.ops && novels.ops.length > 0) {
          quillRef.current.setContents(novels);
          setTimeout(() => {
            const currentText = quillRef.current.getText();
            setLastSavedContent(currentText.trim());
          }, 100);
          console.log("Set Delta content in Quill");
        }

        setContentLoaded(true);
        setHasUnsavedChanges(false);
      } catch (error) {
        console.error("Error loading initial content:", error);
      }
    } else {
      console.log("Not loading content:", {
        hasContentToLoad,
        ytextEmpty: ytext.length === 0,
        alreadyLoaded: contentLoaded,
      });
    }
  };

  useEffect(() => {
    if (loading || initializedRef.current) return;

    let quill: any = null;
    let ydoc: any = null;
    let provider: any = null;
    let binding: any = null;

    const initializeEditor = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      if (!editorRef.current) {
        console.error("Editor ref not available");
        return;
      }

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

        quill.on('text-change', () => {
          setTimeout(() => {
            checkForChanges();
          }, 100);
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
          name: userName,
        });

        binding = new QuillBinding(ytext, quill, awareness);

        quillRef.current = quill;
        ydocRef.current = ydoc;
        providerRef.current = provider;
        bindingRef.current = binding;

        if (awareness) {
          const updateUsers = () => {
            const states = Array.from(awareness.getStates().values());
            const seen = new Set();
            const uniqueUsers: any = [];
            for (const s of states as any) {
              const user = s.user || { color: "#ccc", name: "Anonymous" };
              const key = `${user.name}|${user.color}`;
              if (!seen.has(key)) {
                seen.add(key);
                uniqueUsers.push(user);
              }
            }
            setUsers(uniqueUsers);
          };
          awareness.on("change", updateUsers);
          updateUsers();
        }

        const handleBlur = () => {
          quill.blur();
        };
        window.addEventListener("blur", handleBlur);

        setEditorReady(true);
        initializedRef.current = true;

        console.log("Editor initialized successfully");

        provider.on("status", (event: any) => {
          console.log("WebSocket status:", event.status);
          if (event.status === "connected") {
            setTimeout(() => {
              loadInitialContent();
            }, 1000); 
          }
        });

        setTimeout(() => {
          loadInitialContent();
        }, 2000);

        return () => {
          window.removeEventListener("blur", handleBlur);
          if (binding) binding.destroy();
          if (provider) provider.destroy();
          if (ydoc) ydoc.destroy();
        };
      } catch (error) {
        console.error("Error initializing editor:", error);
      }
    };

    initializeEditor();

    return () => {
      if (bindingRef.current) bindingRef.current.destroy();
      if (providerRef.current) providerRef.current.destroy();
      if (ydocRef.current) ydocRef.current.destroy();
    };
  }, [loading]);

  useEffect(() => {
    if (editorReady && !contentLoaded && novels) {
      console.log("useEffect triggered for content loading");
      setTimeout(() => {
        loadInitialContent();
      }, 500);
    }
  }, [editorReady, novels, contentLoaded]);

  useEffect(() => {
    async function fetchNovels() {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("novels")
          .select("final_manuscript")
          .eq("id", 964);
        console.log("DATA: ", data);
        if (error) {
          throw error;
        }

        let manuscript = data[0]?.final_manuscript;

        if (typeof manuscript === "string") {
          try {
            const parsed = JSON.parse(manuscript);
            if (parsed.ops) {
              manuscript = parsed;
            } else {
              manuscript = manuscript;
            }
          } catch {
            manuscript = manuscript;
          }
        }

        if (!manuscript) {
          manuscript = { ops: [] };
        }

        console.log("manuscript: ", manuscript);
        setNovels(manuscript);
        
        if (typeof manuscript === "string") {
          setLastSavedContent(manuscript.trim());
        } else {
          setLastSavedContent("");
        }
      } catch (error) {
        console.error("Error fetching novels:", error);
        setNovels({ ops: [] });
      } finally {
        setLoading(false);
      }
    }

    fetchNovels();
  }, []);

  const saveToSupabase = async (
    description = "Manual save",
    isAutosave = false
  ) => {
    if (!quillRef.current) return;

    const contents = quillRef.current.getContents();
    const plainText = quillRef.current.getText();
    const wordCount = plainText.trim().split(/\s+/).filter(Boolean).length;
    console.log("Saving contents:", contents, plainText, wordCount);

    try {
      const { error: upsertNovelError } = await supabase.from("novels").upsert([
        {
          id: 964,
          created_at: new Date().toISOString(),
        },
      ]);
      if (upsertNovelError) {
        console.error("Error upserting parent novel:", upsertNovelError);
        return;
      }

      const { data: latestVersionData, error: latestVersionError } =
        await supabase
          .from("novel_versions")
          .select("version_number")
          .eq("novel_id", 964)
          .order("version_number", { ascending: false })
          .limit(1);

      let nextVersionNumber = 1;
      if (
        !latestVersionError &&
        latestVersionData &&
        latestVersionData.length > 0
      ) {
        const latest = latestVersionData[0]?.version_number;
        if (typeof latest === "number") {
          nextVersionNumber = latest + 1;
        }
      }

      const { data, error } = await supabase
        .from("novel_versions")
        .insert([
          {
            novel_id: 964,
            content: JSON.parse(JSON.stringify(contents)),
            plain_text: plainText,
            word_count: wordCount,
            is_auto_save: isAutosave,
            version_number: nextVersionNumber,
            description,
            created_at: new Date().toISOString(),
          },
        ])
        .select("id");

      if (error) {
        console.error("Error saving version:", error);
        return;
      }

      const versionId = data?.[0]?.id;
      if (!versionId) {
        console.error("No versionId returned from novel_versions insert");
        return;
      }

      const { error: upsertError } = await supabase.from("novels").upsert([
        {
          id: 964,
          final_manuscript: plainText,
          current_version_id: versionId,
          created_at: new Date().toISOString(),
        },
      ]);

      if (upsertError) {
        console.error("Error upserting novels:", upsertError);
        return;
      }

      const { data: updatedNovel, error: fetchNovelError } = await supabase
        .from("novels")
        .select("*")
        .eq("id", 964);
      if (fetchNovelError) {
        console.error("Error fetching updated novel:", fetchNovelError);
      } else {
        console.log("Updated novel:", updatedNovel);
      }

      console.log(
        "Saved version",
        contents,
        plainText,
        wordCount,
        nextVersionNumber
      );

      setLastSavedContent(plainText.trim());
      setHasUnsavedChanges(false);

      fetchVersions();
    } catch (error) {
      console.error("Error in saveToSupabase:", error);
    }
  };

  function getUserId(user: any) {
    const match = user.name && user.name.match(/User-(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  useEffect(() => {
    const interval = setInterval(() => {
      if (!editorReady) return;
      if (!users || users.length === 0) return;
      
      const leader: any = users.reduce((max, user) => {
        return getUserId(user) > getUserId(max) ? user : max;
      }, users[0]);

      if (isTabLeader()) {
        console.log("This guy is leader");
      }
      
      if (leader && leader.name === userName && isTabLeader()) {
        const hasChanges = checkForChanges();
        if (hasChanges) {
          console.log("Autosaving due to detected changes");
          saveToSupabase("Autosave", true);
        } else {
          console.log("Skipping autosave - no changes detected");
        }
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [users, userName, editorReady, tabIdsState, hasUnsavedChanges, lastSavedContent]);

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
    <div
      className="p-8 max-w-4xl mx-auto min-h-screen"
      style={{ backgroundColor: "#021524", color: "#ffffff" }}
    >
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-4" style={{ color: "#ffffff" }}>
          Collaborative Novel Editor
        </h1>
        <div className="mb-2 flex flex-wrap gap-2 items-center">
          <span className="text-sm mr-2" style={{ color: "#5e6a74" }}>
            Users in room:
          </span>
          {users.length === 0 && (
            <span className="text-xs" style={{ color: "#838c94" }}>
              (none)
            </span>
          )}
          {users.map((user: any, idx) => (
            <span
              key={idx}
              className="flex items-center px-2 py-1 rounded text-xs font-medium"
              style={{ backgroundColor: "#041726", color: "#f9f9fa" }}
            >
              <span
                className="w-2 h-2 rounded-full mr-1 inline-block"
                style={{ backgroundColor: user.color || "#5e6a74" }}
              ></span>
              {user.name || "Anonymous"}
            </span>
          ))}
        </div>
        {(() => {
          const leader: any =
            users && users.length > 0
              ? users.reduce((max, user) => {
                  return getUserId(user) > getUserId(max) ? user : max;
                }, users[0])
              : null;
          if (leader && leader.name === userName) {
            return (
              <div
                className="mt-2 p-2 rounded text-xs"
                style={{ backgroundColor: "#031625", color: "#bdc2c5" }}
              >
                <strong>Tab IDs (this user):</strong> {tabIdsState.join(", ")}
                <br />
                <strong>Unsaved changes:</strong> {hasUnsavedChanges ? "Yes" : "No"}
              </div>
            );
          }
          return null;
        })()}
        <div className="flex gap-4 flex-wrap">
          <button
            onClick={() => saveToSupabase()}
            disabled={!editorReady}
            className="px-4 py-2 rounded transition-colors font-medium cursor-pointer"
            style={{
              backgroundColor: editorReady ? "#bcffba" : "#5e6a74",
              color: "#081c15",
            }}
          >
            Save to Database
            {hasUnsavedChanges && <span className="ml-1">*</span>}
          </button>
          <div className="flex items-center space-x-2">
            <button
              onClick={fetchVersions}
              disabled={versionsLoading}
              className="px-3 py-2 rounded transition-colors text-sm cursor-pointer"
              style={{
                backgroundColor: versionsLoading ? "#838c94" : "#bcffba",
                color: "#041726",
              }}
            >
              {versionsLoading ? "Refreshing..." : "Refresh Versions"}
            </button>
            <div
              className={`w-3 h-3 rounded-full shadow-sm ${
                editorReady ? "bg-green-600" : "bg-gray-400"
              }`}
            ></div>
            <span
              className={`text-sm font-medium ${
                editorReady ? "text-gray-100" : "text-gray-400"
              }`}
            >
              {editorReady ? "Connected" : "Connecting..."}
            </span>
            {hasUnsavedChanges && (
              <span className="text-xs text-yellow-400">
                • Unsaved changes
              </span>
            )}
          </div>
        </div>
        <div className="mt-4">
          <label className="mr-2" style={{ color: "#f9f9fa" }}>
            Restore version:
          </label>
          <select
            value={selectedVersionId || ""}
            onChange={async (e) => {
              const id: any = e.target.value;
              setSelectedVersionId(id);
              const v: any = versions.find((ver: any) => String(ver.id) === id);
              if (v) await revertToVersion(v);
            }}
            className="border rounded px-2 py-1"
            style={{
              backgroundColor: "#031625",
              borderColor: "#838c94",
              color: "#ffffff",
            }}
          >
            <option value="">
              Select a version ({versions.length} available)
            </option>
            {versions.map((v: any) => (
              <option
                key={v.id}
                value={v.id}
                style={{ backgroundColor: "#031625", color: "#ffffff" }}
              >
                v{v.version_number} - {new Date(v.created_at).toLocaleString()}{" "}
                - {v.description || "No description"}
                {v.is_auto_save ? " (auto)" : ""}
              </option>
            ))}
          </select>
          {versionsLoading && (
            <span className="ml-2 text-sm" style={{ color: "#838c94" }}>
              Loading versions...
            </span>
          )}
        </div>
      </div>

      <div
        className="border rounded-lg overflow-hidden relative"
        style={{ borderColor: "#838c94" }}
      >
        <div
          ref={editorRef}
          className="min-h-96 p-4"
          style={{
            backgroundColor: "#f2f3f4",
            color: "#021524",
            minHeight: "400px",
          }}
        >
          <div
            className="text-sm"
            style={{ color: "#5e6a74", fontStyle: "italic" }}
          >
            Start collaborating on your novel...
          </div>
        </div>
        {!editorReady && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-opacity-75"
            style={{ backgroundColor: "rgba(2, 21, 36, 0.75)" }}
          >
            <div style={{ color: "#bdc2c5" }}>Loading editor...</div>
          </div>
        )}
      </div>

      <style jsx global>{`
        .ql-editor {
          min-height: 300px;
          background-color: #f2f3f4 !important;
          color: #021524 !important;
        }

        .ql-container {
          font-size: 14px;
          background-color: #f2f3f4 !important;
        }

        .ql-toolbar {
          background-color: #031625 !important;
          border-color: #838c94 !important;
        }

        .ql-toolbar .ql-picker-label,
        .ql-toolbar .ql-picker-item,
        .ql-toolbar button {
          color: #ffffff !important;
        }

        .ql-toolbar button:hover {
          background-color: #041726 !important;
        }

        .ql-editor.ql-blank::before {
          font-style: italic;
          color: #5e6a74 !important;
        }

        .ql-picker-options {
          background-color: #031625 !important;
          border-color: #838c94 !important;
        }

        .ql-picker-item:hover {
          background-color: #041726 !important;
        }

        .ql-snow .ql-picker.ql-expanded .ql-picker-label {
          border-color: #838c94 !important;
        }

        .ql-snow .ql-stroke {
          stroke: #ffffff !important;
        }

        .ql-snow .ql-fill {
          fill: #ffffff !important;
        }
      `}</style>
    </div>
  );
}