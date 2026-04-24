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

function formatInlineText(value) {
  if (!value) return "";
  let output = escapeHtml(value);
  output = output.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/__(.+?)__/g, "<u>$1</u>");
  output = output.replace(/\*(.+?)\*/g, "<em>$1</em>");
  output = output.replace(/_(.+?)_/g, "<em>$1</em>");
  return output;
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
    html.push(`<p>${formatInlineText(paragraph.join(" "))}</p>`);
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
      listItems.push(formatInlineText((bulletMatch?.[1] || numberedMatch?.[1] || "").trim()));
      continue;
    }

    const markdownHeadingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (markdownHeadingMatch) {
      flushParagraph();
      flushList();
      const level = markdownHeadingMatch[1].length;
      const content = formatInlineText(markdownHeadingMatch[2].trim());
      const mappedTag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      html.push(`<${mappedTag}>${content}</${mappedTag}>`);
      continue;
    }

    const cleanLine = line.replace(/:$/, "");
    const headingCandidate =
      line.endsWith(":") ||
      (cleanLine.length <= 80 && cleanLine.split(/\s+/).length <= 12 && /^[A-Z0-9]/.test(cleanLine));

    if (headingCandidate) {
      flushParagraph();
      flushList();
      html.push(`<h3>${formatInlineText(cleanLine)}</h3>`);
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
  const [activeBlockType, setActiveBlockType] = useState("p");
  const [textColor, setTextColor] = useState("#111827");

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
      setActiveBlockType(nextType);
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

  const applyImage = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = window.prompt("Enter image URL");
    if (!url) return;
    exec("insertImage", url);
  }, [exec]);

  const insertTable = useCallback(() => {
    const tableHtml = `
      <table style="border-collapse:collapse;width:100%;margin:12px 0;">
        <tbody>
          <tr>
            <td style="border:1px solid #d1d5db;padding:8px;">Cell 1</td>
            <td style="border:1px solid #d1d5db;padding:8px;">Cell 2</td>
          </tr>
          <tr>
            <td style="border:1px solid #d1d5db;padding:8px;">Cell 3</td>
            <td style="border:1px solid #d1d5db;padding:8px;">Cell 4</td>
          </tr>
        </tbody>
      </table>
    `;
    exec("insertHTML", tableHtml);
  }, [exec]);

  const applyTextColor = useCallback(
    (nextColor) => {
      setTextColor(nextColor);
      exec("foreColor", nextColor);
    },
    [exec],
  );

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
    <div className="app-rich-text-editor" style={{ border: "1px solid #d1d5db", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
      <div style={{ padding: 8, borderBottom: "1px solid #e5e7eb", background: "#f6f6f7" }}>
        <InlineStack gap="100" wrap={false}>
          <div style={{ minWidth: 150 }}>
            <Select
              label="Text style"
              labelHidden
              options={[
                { label: "Paragraph", value: "p" },
                { label: "Heading 1", value: "h1" },
                { label: "Heading", value: "h2" },
                { label: "Sub heading", value: "h3" },
                { label: "Small heading", value: "h4" },
              ]}
              value={activeBlockType}
              onChange={applyBlockType}
            />
          </div>
          <Text as="span" tone="subdued">|</Text>
          <Button size="slim" onClick={() => exec("bold")} accessibilityLabel="Bold">B</Button>
          <Button size="slim" onClick={() => exec("italic")} accessibilityLabel="Italic"><i>I</i></Button>
          <Button size="slim" onClick={() => exec("underline")} accessibilityLabel="Underline"><u>U</u></Button>
          <div style={{ position: "relative", width: 34, height: 28 }}>
            <Button size="slim" onClick={() => {}} accessibilityLabel="Text color">A</Button>
            <input
              type="color"
              value={textColor}
              onChange={(e) => applyTextColor(e.target.value)}
              style={{
                position: "absolute",
                inset: 0,
                opacity: 0,
                cursor: "pointer",
              }}
              aria-label="Pick text color"
            />
          </div>
          <Text as="span" tone="subdued">|</Text>
          <Button size="slim" onClick={() => exec("justifyLeft")} accessibilityLabel="Align left">Left</Button>
          <Button size="slim" onClick={() => exec("justifyCenter")} accessibilityLabel="Align center">Center</Button>
          <Button size="slim" onClick={() => exec("justifyRight")} accessibilityLabel="Align right">Right</Button>
          <Text as="span" tone="subdued">|</Text>
          <Button size="slim" onClick={applyLink} accessibilityLabel="Insert link">Link</Button>
          <Button size="slim" onClick={applyImage} accessibilityLabel="Insert image">Image</Button>
          <Button size="slim" onClick={insertTable} accessibilityLabel="Insert table">Table</Button>
          <Text as="span" tone="subdued">|</Text>
          <Button size="slim" onClick={() => exec("insertUnorderedList")} accessibilityLabel="Bullet list">Bullet</Button>
          <Button size="slim" onClick={() => exec("insertOrderedList")} accessibilityLabel="Numbered list">1. List</Button>
          <Button size="slim" onClick={() => exec("outdent")} accessibilityLabel="Outdent">Outdent</Button>
          <Button size="slim" onClick={() => exec("indent")} accessibilityLabel="Indent">Indent</Button>
          <Text as="span" tone="subdued">|</Text>
          <Button size="slim" onClick={() => exec("unlink")} accessibilityLabel="Remove link">Unlink</Button>
          <Button size="slim" onClick={() => exec("removeFormat")} accessibilityLabel="Clear format">Clear</Button>
          <Button size="slim" onClick={() => exec("undo")} accessibilityLabel="Undo">Undo</Button>
          <Button size="slim" onClick={() => exec("redo")} accessibilityLabel="Redo">Redo</Button>
          {showSourceToggle ? (
            <Button size="slim" onClick={toggleSourceMode}>{showSource ? "Editor" : "</>"}</Button>
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
      <style>{`
        .app-rich-text-editor [contenteditable="true"] h1,
        .app-rich-text-editor [contenteditable="true"] h2,
        .app-rich-text-editor [contenteditable="true"] h3,
        .app-rich-text-editor [contenteditable="true"] h4 {
          margin: 0 0 10px;
          color: #111827;
          line-height: 1.35;
          font-weight: 700;
        }
        .app-rich-text-editor [contenteditable="true"] h2 { font-size: 24px; }
        .app-rich-text-editor [contenteditable="true"] h3 { font-size: 20px; }
        .app-rich-text-editor [contenteditable="true"] h4 { font-size: 17px; }
        .app-rich-text-editor [contenteditable="true"] p {
          margin: 0 0 12px;
          color: #1f2937;
        }
        .app-rich-text-editor [contenteditable="true"] ul,
        .app-rich-text-editor [contenteditable="true"] ol {
          margin: 0 0 12px;
          padding-left: 22px;
        }
        .app-rich-text-editor [contenteditable="true"] li {
          margin-bottom: 6px;
          color: #1f2937;
        }
        .app-rich-text-editor [contenteditable="true"] strong {
          font-weight: 700;
        }
        .app-rich-text-editor [contenteditable="true"] em {
          font-style: italic;
        }
        .app-rich-text-editor [contenteditable="true"] u {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
