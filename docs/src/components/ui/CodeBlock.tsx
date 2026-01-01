import { useState, useMemo } from 'react';

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
}

// Simple JavaScript syntax highlighter
function highlightJS(code: string): string {
  // First escape HTML entities
  let result = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Apply highlighting in a specific order to avoid conflicts
  // Comments first (they can contain anything)
  result = result.replace(/(\/\/[^\n]*)/g, '<span class="hl-comment">$1</span>');
  
  // Strings (double quotes)
  result = result.replace(/(&quot;|")((?:[^"\\]|\\.)*)(&quot;|")/g, '<span class="hl-string">$1$2$3</span>');
  
  // Strings (single quotes)
  result = result.replace(/(&#39;|')((?:[^'\\]|\\.)*)(\1)/g, '<span class="hl-string">$1$2$3</span>');
  
  // Template literals (simplified)
  result = result.replace(/(`[^`]*`)/g, '<span class="hl-string">$1</span>');
  
  // Numbers
  result = result.replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-number">$1</span>');
  
  // Keywords
  result = result.replace(/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|typeof|instanceof|in|of|async|await|class|extends|import|export|default|from)\b/g, '<span class="hl-keyword">$1</span>');
  
  // Built-in objects
  result = result.replace(/\b(console|JSON|Date|Math|Object|Array|String|Number|Boolean|Promise|Error|RegExp)\b/g, '<span class="hl-builtin">$1</span>');
  
  // Boolean/null/undefined
  result = result.replace(/\b(true|false|null|undefined)\b/g, '<span class="hl-boolean">$1</span>');
  
  // Function calls (word followed by parenthesis)
  result = result.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g, '<span class="hl-function">$1</span>(');
  
  // Properties (after dot)
  result = result.replace(/\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g, '.<span class="hl-property">$1</span>');

  return result;
}

export function CodeBlock({ code, language = 'javascript', filename, showLineNumbers = false }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  
  const highlightedCode = useMemo(() => {
    if (language === 'javascript' || language === 'js' || language === 'typescript' || language === 'ts') {
      return highlightJS(code);
    }
    return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }, [code, language]);
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const lines = highlightedCode.split('\n');
  
  return (
    <div className="cb">
      {filename && (
        <div className="cb-header">
          <span className="cb-filename">{filename}</span>
          <span className="cb-lang">{language}</span>
        </div>
      )}
      <div className="cb-container">
        <button 
          className="cb-copy" 
          onClick={handleCopy}
          aria-label="Copy code"
        >
          {copied ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          )}
        </button>
        <pre className="cb-pre">
          {showLineNumbers ? (
            <code className="cb-code">
              {lines.map((line, i) => (
                <span key={i} className="cb-line">
                  <span className="cb-ln">{i + 1}</span>
                  <span dangerouslySetInnerHTML={{ __html: line || ' ' }} />
                </span>
              ))}
            </code>
          ) : (
            <code className="cb-code" dangerouslySetInnerHTML={{ __html: highlightedCode }} />
          )}
        </pre>
      </div>
      <style>{`
        .cb {
          margin: 1rem 0;
          border-radius: 8px;
          border: 1px solid #2d2d2d;
          overflow: hidden;
          background: #1a1b26;
        }
        .cb-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.5rem 1rem;
          background: #13141c;
          border-bottom: 1px solid #2d2d2d;
        }
        .cb-filename {
          font-size: 0.875rem;
          font-family: monospace;
          color: #888;
        }
        .cb-lang {
          font-size: 0.75rem;
          color: #666;
          text-transform: uppercase;
        }
        .cb-container {
          position: relative;
        }
        .cb-copy {
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          color: #666;
          background: #24283b;
          border: 1px solid #3b4261;
          border-radius: 6px;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.2s;
        }
        .cb:hover .cb-copy {
          opacity: 1;
        }
        .cb-copy:hover {
          color: #c0caf5;
          border-color: #565f89;
        }
        .cb-pre {
          margin: 0;
          padding: 1rem;
          overflow-x: auto;
        }
        .cb-code {
          font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace;
          font-size: 13px;
          color: #a9b1d6;
          line-height: 1.7;
        }
        .cb-line {
          display: block;
        }
        .cb-ln {
          display: inline-block;
          width: 3ch;
          margin-right: 1rem;
          color: #3b4261;
          text-align: right;
          user-select: none;
        }
        /* Syntax highlighting colors - Tokyo Night theme */
        .hl-comment { color: #565f89; font-style: italic; }
        .hl-string { color: #9ece6a; }
        .hl-number { color: #ff9e64; }
        .hl-keyword { color: #bb9af7; }
        .hl-builtin { color: #7dcfff; }
        .hl-boolean { color: #ff9e64; }
        .hl-function { color: #7aa2f7; }
        .hl-property { color: #73daca; }
      `}</style>
    </div>
  );
}

export default CodeBlock;
