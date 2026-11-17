import React, { useEffect, useRef, useState } from "react";
import { loader } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor/editor/editor.api.js";

/** Own the diff and its models so models are detached before disposal. */
export function ReadOnlyDiff({
  original,
  modified,
}: {
  original: string;
  modified: string;
}) {
  const [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
  const latest = useRef({ original, modified });
  latest.current = { original, modified };
  useEffect(() => {
    let cancelled = false;
    let models:
      | {
          original: Monaco.editor.ITextModel;
          modified: Monaco.editor.ITextModel;
        }
      | undefined;
    void loader
      .init()
      .then((monaco) => {
        if (cancelled || !host.current) return;
        models = {
          original: monaco.editor.createModel(
            latest.current.original,
            "plaintext",
          ),
          modified: monaco.editor.createModel(
            latest.current.modified,
            "plaintext",
          ),
        };
        editor.current = monaco.editor.createDiffEditor(host.current, {
          readOnly: true,
          originalEditable: false,
          automaticLayout: true,
          theme: "vs-dark",
        });
        editor.current?.setModel(models);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load comparison editor",
          );
      });
    return () => {
      cancelled = true;
      editor.current?.setModel(null);
      editor.current?.dispose();
      editor.current = null;
      models?.original.dispose();
      models?.modified.dispose();
    };
  }, []);
  useEffect(() => {
    const models = editor.current?.getModel();
    if (models?.original.getValue() !== original)
      models?.original.setValue(original);
    if (models?.modified.getValue() !== modified)
      models?.modified.setValue(modified);
  }, [original, modified]);
  if (error) return <p role="alert">{error}</p>;
  return (
    <div
      ref={host}
      className="h-full w-full"
      aria-label="Read-only text comparison"
    />
  );
}
