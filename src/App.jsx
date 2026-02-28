import { useRef, useState, useEffect, useCallback } from 'react';
import './App.css';

const INDENT = '  ';
const COMMENT_PREFIX = '// ';
const DEBOUNCE_MS = 150;
const CHORD_TIMEOUT_MS = 2000;

function debounce(callback, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => callback.apply(this, args), delay);
  };
}


export default function App() {
  const [content, setContent] = useState('');
  const [eventLogs, setEventLogs] = useState([]);
  
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const isComposingRef = useRef(false);
  const chordWaitingRef = useRef(false);
  const chordTimeoutRef = useRef(null);
  const highlightCallCountRef = useRef(0);
  const editorRef = useRef(null);
  const lastContentRef = useRef('');
  const pendingCursorRef = useRef(null);

  const addLog = useCallback((text) => {
    setEventLogs((prev) => {
      const updatedLogs = [...prev, { id: Date.now() + Math.random(), text }];
      return updatedLogs.slice(-500);
    });
  }, []);

  const pushUndo = useCallback((value) => {
    undoStackRef.current.push(value);
    redoStackRef.current = [];
  }, []);

  const handleHighlight = useRef(
    debounce(() => {
      highlightCallCountRef.current += 1;
    }, DEBOUNCE_MS)
  ).current;

  useEffect(() => {
    lastContentRef.current = content;
  }, [content]);

  useEffect(() => {
    window.getEditorState = () => ({
      content: lastContentRef.current,
      historySize: undoStackRef.current.length + 1,
    });
    window.getHighlightCallCount = () => highlightCallCountRef.current;
    
    return () => {
      delete window.getEditorState;
      delete window.getHighlightCallCount;
    };
  }, []);

  const startOfLine = (text, pos) => {
    let i = pos - 1;
    while (i >= 0 && text[i] !== '\n') i--;
    return i + 1;
  };

  const endOfLine = (text, pos) => {
    let i = pos;
    while (i < text.length && text[i] !== '\n') i++;
    return i;
  };

  const getLineIndent = (text, pos) => {
    const start = startOfLine(text, pos);
    let spaces = 0;
    while (start + spaces < text.length && text[start + spaces] === ' ') spaces++;
    return text.slice(start, start + spaces);
  };

  const setEditorContentAndCursor = useCallback((newContent, newCursor) => {
    lastContentRef.current = newContent;
    pendingCursorRef.current = typeof newCursor === 'number' ? newCursor : null;
    setContent(newContent);
  }, []);

  const handleInput = useCallback(
    (e) => {
      const newContent = e.target.value;
      if (isComposingRef.current) {
        setContent(newContent);
        return;
      }
      pushUndo(lastContentRef.current);
      setContent(newContent);
      handleHighlight();
    },
    [pushUndo, handleHighlight]
  );

  const handleKeyDown = useCallback(
    (e) => {
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === 'Tab') {
        e.preventDefault();
        const editor = editorRef.current;
        const start = editor.selectionStart;
        const text = content;
        const lineStart = startOfLine(text, start);
        const beforeLine = text.slice(0, lineStart);
        const afterLine = text.slice(lineStart);
        
        if (e.shiftKey) {
          if (afterLine.startsWith('  ')) {
            const newText = beforeLine + afterLine.slice(2);
            const newCursor = Math.max(lineStart, start - 2);
            pushUndo(content);
            setEditorContentAndCursor(newText, newCursor);
          }
        } else {
          const newText = beforeLine + INDENT + afterLine;
          pushUndo(content);
          setEditorContentAndCursor(newText, lineStart + 2);
        }
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const editor = editorRef.current;
        const start = editor.selectionStart;
        const indentString = getLineIndent(content, start);
        const before = content.slice(0, start);
        const after = content.slice(start);
        const newText = before + '\n' + indentString + after;
        pushUndo(content);
        setEditorContentAndCursor(newText, start + 1 + indentString.length);
        return;
      }

      if (mod && e.key === 's') {
        e.preventDefault();
        addLog('Action: Save');
        return;
      }

      if (mod && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (redoStackRef.current.length > 0) {
            const nextState = redoStackRef.current.pop();
            undoStackRef.current.push(content);
            setEditorContentAndCursor(nextState);
          }
        } else {
          if (undoStackRef.current.length > 0) {
            const prevState = undoStackRef.current.pop();
            redoStackRef.current.push(content);
            setEditorContentAndCursor(prevState);
          }
        }
        return;
      }

      if (mod && e.key === '/') {
        e.preventDefault();
        const editor = editorRef.current;
        const text = content;
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const lineStart = startOfLine(text, start);
        const lineEnd = endOfLine(text, end);
        const block = text.slice(lineStart, lineEnd);
        const lines = block.split('\n');
        
        const allAreCommented = lines.every((l) => l.startsWith(COMMENT_PREFIX));
        
        let newLines;
        if (allAreCommented) {
          newLines = lines.map((l) => (l.startsWith(COMMENT_PREFIX) ? l.slice(COMMENT_PREFIX.length) : l));
        } else {
          newLines = lines.map((l) => (l.trim().length === 0 ? l : COMMENT_PREFIX + l));
        }
        
        const newBlock = newLines.join('\n');
        const newText = text.slice(0, lineStart) + newBlock + text.slice(lineEnd);
        const offset = allAreCommented ? -COMMENT_PREFIX.length : COMMENT_PREFIX.length;
        const newCursor = Math.max(lineStart, start + (lines.length > 1 ? 0 : offset));
        
        pushUndo(content);
        setEditorContentAndCursor(newText, newCursor);
        return;
      }

      if (mod && e.key === 'k') {
        e.preventDefault();
        if (chordTimeoutRef.current) clearTimeout(chordTimeoutRef.current);
        chordWaitingRef.current = true;
        chordTimeoutRef.current = setTimeout(() => {
          chordWaitingRef.current = false;
          chordTimeoutRef.current = null;
        }, CHORD_TIMEOUT_MS);
        return;
      }

      if (mod && e.key === 'c' && chordWaitingRef.current) {
        e.preventDefault();
        if (chordTimeoutRef.current) clearTimeout(chordTimeoutRef.current);
        chordWaitingRef.current = false;
        chordTimeoutRef.current = null;
        addLog('Action: Chord Success');
        return;
      }

      if (chordWaitingRef.current && !(mod && (e.key === 'k' || e.key === 'c'))) {
        if (chordTimeoutRef.current) clearTimeout(chordTimeoutRef.current);
        chordWaitingRef.current = false;
        chordTimeoutRef.current = null;
      }
    },
    [content, addLog, pushUndo, setEditorContentAndCursor]
  );

  const createEventLogString = useCallback((type, e) => {
    const key = e.key ?? '';
    const code = e.code ?? '';
    const modifiers = [];
    if (e.ctrlKey) modifiers.push('ctrl');
    if (e.metaKey) modifiers.push('meta');
    if (e.shiftKey) modifiers.push('shift');
    if (e.altKey) modifiers.push('alt');
    const modString = modifiers.length ? ` [${modifiers.join(',')}]` : '';
    return `${type} key="${key}" code="${code}"${modString}`;
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;
    const cursor = pendingCursorRef.current;
    pendingCursorRef.current = null;
    if (typeof cursor === 'number') {
      editorRef.current.setSelectionRange(cursor, cursor);
    }
  }, [content]);

  return (
    <div className="app-layout">
      <div className="editor-section" data-test-id="editor-container">
        <textarea
          ref={editorRef}
          className="editor-input"
          data-test-id="editor-input"
          value={content}
          onChange={handleInput}
          onKeyDown={(e) => {
            addLog(createEventLogString('keydown', e));
            handleKeyDown(e);
          }}
          onKeyUp={(e) => addLog(createEventLogString('keyup', e))}
          onInput={(e) => addLog(createEventLogString('input', e))}
          onCompositionStart={(e) => {
            isComposingRef.current = true;
            addLog(createEventLogString('compositionstart', e));
          }}
          onCompositionUpdate={(e) => addLog(createEventLogString('compositionupdate', e))}
          onCompositionEnd={(e) => {
            isComposingRef.current = false;
            addLog(createEventLogString('compositionend', e));
          }}
          spellCheck={false}
          aria-label="Code editor"
          placeholder="Type here..."
        />
      </div>

      <div className="dashboard-section" data-test-id="event-dashboard">
        <h2 className="dashboard-title">Event Log</h2>
        <div className="event-log-list" data-test-id="event-log-list">
          {eventLogs.map((entry) => (
            <div
              key={entry.id}
              className="event-log-entry"
              data-test-id="event-log-entry"
            >
              {entry.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


