import { useCallback, useEffect, useRef, useState } from "react";
import { Button, InlineStack, Select, Text } from "@shopify/polaris";

function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value || "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plainTextToStructuredHtml(value) {
  const input = String(value || "").trim();
  if (!input) return "";

  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${escapeHtml(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) return;
    html.push(`<${listType}>${listItems.map((item) => `<li>${item}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)/) || line.match(/^\u2022\s+(.+)/);
    const numberedMatch = line.match(/^\d+[.)]\s+(.+)/);
    if (bulletMatch || numberedMatch) {
      flushParagraph();
      const nextListType = bulletMatch ? "ul" : "ol";
      if (listType && listType !== nextListType) flushList();
      listType = nextListType;
      listItems.push(escapeHtml((bulletMatch?.[1] || numberedMatch?.[1] || "").trim()));
      continue;
    }

    const cleanLine = line.replace(/:$/, "");
    const headingCandidate =
      line.endsWith(":") ||
      (cleanLine.length <= 80 && cleanLine.split(/\s+/).length <= 12 && /^[A-Z0-9]/.test(cleanLine));

    if (headingCandidate) {
      flushParagraph();
      flushList();
      html.push(`<h3>${escapeHtml(cleanLine)}</h3>`);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return html.join("");
}

function normalizeInitialValue(value, normalizePlainText) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!normalizePlainText) return String(value || "");
  if (looksLikeHtml(text)) return String(value || "");
  return plainTextToStructuredHtml(text);
}

export function RichTextEditor({
  value,
  onChange,
  minHeight = 260,
  maxHeight = 420,
  showSourceToggle = true,
  normalizePlainText = true,
}) {
  const editorRef = useRef(null);
  const [showSource, setShowSource] = useState(false);
  const [sourceHtml, setSourceHtml] = useState("");

  useEffect(() => {
    const normalized = normalizeInitialValue(value, normalizePlainText);
    if (showSource) {
      if (sourceHtml !== normalized) setSourceHtml(normalized);
      return;
    }
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML !== normalized) {
      editorRef.current.innerHTML = normalized;
    }
  }, [value, showSource, sourceHtml, normalizePlainText]);

  const emitChange = useCallback(
    (next) => {
      if (typeof onChange === "function") onChange(next);
    },
    [onChange],
  );

  const exec = useCallback(
    (command, arg = null) => {
      if (!editorRef.current) return;
      editorRef.current.focus();
      document.execCommand(command, false, arg);
      emitChange(editorRef.current.innerHTML || "");
    },
    [emitChange],
  );

  const handleInput = useCallback(() => {
    if (!editorRef.current) return;
    emitChange(editorRef.current.innerHTML || "");
  }, [emitChange]);

  const applyBlockType = useCallback(
    (nextType) => {
      exec("formatBlock", nextType === "p" ? "<p>" : `<${nextType}>`);
    },
    [exec],
  );

  const applyLink = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = window.prompt("Enter URL");
    if (!url) return;
    exec("createLink", url);
  }, [exec]);

  const handleSourceChange = useCallback(
    (nextValue) => {
      setSourceHtml(nextValue);
      emitChange(nextValue);
    },
    [emitChange],
  );

  const toggleSourceMode = useCallback(() => {
    if (!showSource) {
      setSourceHtml(editorRef.current?.innerHTML || "");
      setShowSource(true);
      return;
    }
    if (editorRef.current) editorRef.current.innerHTML = sourceHtml;
    emitChange(sourceHtml);
    setShowSource(false);
  }, [showSource, sourceHtml, emitChange]);

  return (
    <div style={{ border: "1px solid #d1d5db", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
      <div style={{ padding: 10, borderBottom: "1px solid #e5e7eb", background: "#f6f6f7" }}>
        <InlineStack gap="100" wrap>
          <div style={{ minWidth: 180 }}>
            <Select
              label="Text style"
              labelHidden
              options={[
                { label: "Paragraph", value: "p" },
                { label: "Heading", value: "h2" },
                { label: "Sub heading", value: "h3" },
                { label: "Small heading", value: "h4" },
              ]}
              value="p"
              onChange={applyBlockType}
            />
          </div>
          <Button size="slim" onClick={() => exec("bold")}>Bold</Button>
          <Button size="slim" onClick={() => exec("italic")}>Italic</Button>
          <Button size="slim" onClick={() => exec("underline")}>Underline</Button>
          <Button size="slim" onClick={() => exec("insertUnorderedList")}>Bullet</Button>
          <Button size="slim" onClick={() => exec("insertOrderedList")}>Numbered</Button>
          <Button size="slim" onClick={applyLink}>Link</Button>
          <Button size="slim" onClick={() => exec("unlink")}>Unlink</Button>
          <Button size="slim" onClick={() => exec("undo")}>Undo</Button>
          <Button size="slim" onClick={() => exec("redo")}>Redo</Button>
          <Button size="slim" onClick={() => exec("removeFormat")}>Clear</Button>
          {showSourceToggle ? (
            <Button size="slim" onClick={toggleSourceMode}>{showSource ? "Editor" : "HTML"}</Button>
          ) : null}
        </InlineStack>
      </div>

      {showSource ? (
        <div style={{ padding: 12 }}>
          <Text as="p" variant="bodySm" tone="subdued">HTML Source</Text>
          <textarea
            value={sourceHtml}
            onChange={(e) => handleSourceChange(e.target.value)}
            spellCheck={false}
            style={{
              width: "100%",
              minHeight,
              maxHeight,
              padding: 12,
              borderRadius: 8,
              border: "1px solid #d1d5db",
              fontFamily: "Consolas, Menlo, Monaco, monospace",
              fontSize: 13,
              lineHeight: 1.55,
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
              marginTop: 8,
            }}
          />
        </div>
      ) : (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          style={{
            minHeight,
            maxHeight,
            overflowY: "auto",
            padding: 16,
            outline: "none",
            fontSize: 15,
            lineHeight: 1.65,
          }}
        />
      )}
    </div>
  );
}
