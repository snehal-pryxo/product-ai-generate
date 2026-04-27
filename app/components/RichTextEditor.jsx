import { useCallback, useEffect, useRef, useState } from "react";
import { InlineStack, Select, Text } from "@shopify/polaris";

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

  const ToolButton = ({ onClick, label, children, isActive = false, width = 34 }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`app-rich-text-editor__tool-btn${isActive ? " is-active" : ""}`}
      style={{ width }}
    >
      {children}
    </button>
  );

  const ToolDivider = () => <span className="app-rich-text-editor__tool-divider" aria-hidden="true" />;

  return (
    <div className="app-rich-text-editor" style={{ border: "1px solid #d1d5db", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
      <div className="app-rich-text-editor__toolbar">
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
          <ToolDivider />
          <ToolButton onClick={() => exec("bold")} label="Bold"><strong>B</strong></ToolButton>
          <ToolButton onClick={() => exec("italic")} label="Italic"><span style={{ fontStyle: "italic" }}>I</span></ToolButton>
          <ToolButton onClick={() => exec("underline")} label="Underline"><span style={{ textDecoration: "underline" }}>U</span></ToolButton>
          <div style={{ position: "relative", width: 34, height: 32 }}>
            <ToolButton onClick={() => {}} label="Text color">A</ToolButton>
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
          <ToolDivider />
          <ToolButton onClick={() => exec("justifyLeft")} label="Align left">
            <svg viewBox="0 0 20 20" width="16" height="16"><path d="M3 5h12M3 9h9M3 13h12M3 17h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </ToolButton>
          <ToolButton onClick={() => exec("justifyCenter")} label="Align center">
            <svg viewBox="0 0 20 20" width="16" height="16"><path d="M4 5h12M6 9h8M4 13h12M6 17h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </ToolButton>
          <ToolButton onClick={() => exec("justifyRight")} label="Align right">
            <svg viewBox="0 0 20 20" width="16" height="16"><path d="M5 5h12M8 9h9M5 13h12M8 17h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </ToolButton>
          <ToolDivider />
          <ToolButton onClick={applyLink} label="Insert link">
            <svg viewBox="0 0 20 20" width="16" height="16"><path d="M7.5 12.5l-1.5 1.5a3 3 0 104.2 4.2l1.6-1.6M12.5 7.5l1.5-1.5a3 3 0 10-4.2-4.2L8.2 3.4M7 10h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none"/></svg>
          </ToolButton>
          <ToolButton onClick={applyImage} label="Insert image">
            <svg viewBox="0 0 20 20" width="16" height="16"><rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" fill="none" strokeWidth="1.6"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><path d="M4.5 14l3.5-3.5 2.5 2.2 2.2-2.2 2.8 3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round"/></svg>
          </ToolButton>
          <ToolButton onClick={insertTable} label="Insert table">
            <svg viewBox="0 0 20 20" width="16" height="16"><rect x="3" y="4" width="14" height="12" rx="1" stroke="currentColor" fill="none" strokeWidth="1.6"/><path d="M3 9.5h14M8 4v12M13 4v12" stroke="currentColor" strokeWidth="1.2"/></svg>
          </ToolButton>
          <ToolDivider />
          <ToolButton onClick={() => exec("insertUnorderedList")} label="Bullet list">
            <svg viewBox="0 0 20 20" width="16" height="16"><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="10" r="1.2" fill="currentColor"/><circle cx="4.5" cy="14" r="1.2" fill="currentColor"/><path d="M8 6h8M8 10h8M8 14h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </ToolButton>
          <ToolButton onClick={() => exec("insertOrderedList")} label="Numbered list">
            <svg viewBox="0 0 20 20" width="16" height="16"><path d="M3.2 6h2M3.2 10h2M3.2 14h2M8 6h8M8 10h8M8 14h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </ToolButton>
          <ToolButton onClick={() => exec("outdent")} label="Outdent">
            <svg viewBox="0 0 20 20" width="16" height="16"><path d="M8 6h9M8 10h9M8 14h9M3 10h4M5 8l-2 2 2 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none"/></svg>
          </ToolButton>
          <ToolButton onClick={() => exec("indent")} label="Indent">
            <svg viewBox="0 0 20 20" width="16" height="16"><path d="M3 6h9M3 10h9M3 14h9M12 10h4M14 8l2 2-2 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none"/></svg>
          </ToolButton>
          <ToolDivider />
          <ToolButton onClick={() => exec("unlink")} label="Remove link">
            <svg viewBox="0 0 20 20" width="16" height="16"><path d="M4 4l12 12M7.5 12.5l-1.5 1.5a3 3 0 104.2 4.2l1.6-1.6M12.5 7.5l1.5-1.5a3 3 0 10-4.2-4.2L8.2 3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none"/></svg>
          </ToolButton>
          <ToolButton onClick={() => exec("removeFormat")} label="Clear formatting">Tx</ToolButton>
          <ToolButton onClick={() => exec("undo")} label="Undo">
            <svg viewBox="0 0 20 20" width="16" height="16"><path d="M7 6L3 10l4 4M4 10h7a4 4 0 010 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none"/></svg>
          </ToolButton>
          <ToolButton onClick={() => exec("redo")} label="Redo">
            <svg viewBox="0 0 20 20" width="16" height="16"><path d="M13 6l4 4-4 4M16 10H9a4 4 0 000 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none"/></svg>
          </ToolButton>
          {showSourceToggle ? (
            <ToolButton onClick={toggleSourceMode} label={showSource ? "Editor mode" : "HTML source"} width={42}>
              {"</>"}
            </ToolButton>
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
            overflowY: "visible",
            padding: 16,
            outline: "none",
            fontSize: 15,
            lineHeight: 1.65,
          }}
        />
      )}
      <style>{`
        .app-rich-text-editor__toolbar {
          padding: 8px;
          border-bottom: 1px solid #e5e7eb;
          background: #f6f6f7;
          overflow-x: auto;
          overflow-y: hidden;
        }
        .app-rich-text-editor__tool-btn {
          height: 32px;
          min-width: 32px;
          border-radius: 8px;
          border: 1px solid #d1d5db;
          background: #ffffff;
          color: #374151;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease;
        }
        .app-rich-text-editor__tool-btn:hover {
          background: #f3f4f6;
          border-color: #9ca3af;
        }
        .app-rich-text-editor__tool-btn.is-active {
          background: #e5e7eb;
          border-color: #6b7280;
          color: #111827;
        }
        .app-rich-text-editor__tool-divider {
          width: 1px;
          height: 22px;
          background: #d1d5db;
          margin: 0 2px;
          flex: 0 0 auto;
        }
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
