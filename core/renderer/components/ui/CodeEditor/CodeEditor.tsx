import React, { useCallback, forwardRef, useEffect, useContext, useMemo, useRef } from 'react';
import AceEditor, { IAceEditorProps } from 'react-ace';
import ace from 'ace-builds';
import { useApp, useTheme } from '@/contexts';
import EnvironmentsContext from '@/contexts/EnvironmentsContext';
import { CollectionEnvironment } from '@/types';
import {
  getFunctionSuggestions,
  categoryLabels,
  FunctionSuggestion,
} from '@/services/DynamicFunctions';
import {
  getScriptCompletions,
  ScriptContext,
} from '@/services/ScriptCompletions';

import 'ace-builds/src-noconflict/mode-json';
import 'ace-builds/src-noconflict/mode-text';
import 'ace-builds/src-noconflict/mode-javascript';
import 'ace-builds/src-noconflict/theme-one_dark';
import 'ace-builds/src-noconflict/theme-chrome';
import 'ace-builds/src-noconflict/ext-language_tools';
import './CodeEditor.css';

// Define custom JSON mode with variable highlighting
const defineCustomModes = () => {
  const JsonMode = ace.require('ace/mode/json').Mode;
  const JsonHighlightRules = ace.require('ace/mode/json_highlight_rules').JsonHighlightRules;
  const TextHighlightRules = ace.require('ace/mode/text_highlight_rules').TextHighlightRules;
  
  // Custom highlight rules that add variable/function detection
  class CustomJsonHighlightRules extends JsonHighlightRules {
    constructor() {
      super();
      
      // Add variable highlighting rules to all states
      const variableRule = {
        token: 'variable.template',
        regex: /\{\{[^}]*\}\}/,
      };
      
      // Insert variable rule at the beginning of each state
      for (const state in this.$rules) {
        this.$rules[state].unshift(variableRule);
      }
    }
  }
  
  // Custom JSON mode
  class CustomJsonMode extends JsonMode {
    constructor() {
      super();
      this.HighlightRules = CustomJsonHighlightRules;
    }
  }
  
  // Custom text highlight rules for plain text mode
  class CustomTextHighlightRules extends TextHighlightRules {
    constructor() {
      super();
      this.$rules = {
        start: [
          {
            token: 'variable.template',
            regex: /\{\{[^}]*\}\}/,
          },
          {
            defaultToken: 'text',
          },
        ],
      };
    }
  }
  
  // Custom text mode
  const TextMode = ace.require('ace/mode/text').Mode;
  class CustomTextMode extends TextMode {
    constructor() {
      super();
      this.HighlightRules = CustomTextHighlightRules;
    }
  }
  
  // Register the custom modes (cast to any for ace.define which isn't typed)
  (ace as any).define('ace/mode/json_variables', ['require', 'exports', 'module'], function(_require: any, exports: any) {
    exports.Mode = CustomJsonMode;
  });
  
  (ace as any).define('ace/mode/text_variables', ['require', 'exports', 'module'], function(_require: any, exports: any) {
    exports.Mode = CustomTextMode;
  });
};

// Initialize custom modes
defineCustomModes();

export interface CodeEditorProps extends Omit<IAceEditorProps, 'theme'> {
  forceTheme?: 'dark' | 'light';
  className?: string;
  supportVariables?: boolean;
  collectionEnvironment?: CollectionEnvironment | null;
  /** Enable script autocompletion for pre/post scripts */
  scriptContext?: ScriptContext | null;
}

/**
 * CodeEditor - A wrapper around AceEditor that respects app settings.
 * 
 * Settings applied from AppSettings:
 * - tabSize: Number of spaces per indentation level
 * - wordWrap: Whether to wrap long lines
 * - showLineNumbers: Whether to display line numbers
 * - highlightActiveLine: Whether to highlight the current line
 * - fontSize: Editor font size
 */

export const CodeEditor = forwardRef<AceEditor, CodeEditorProps>(({
  forceTheme,
  setOptions,
  className,
  onLoad,
  supportVariables = false,
  collectionEnvironment,
  scriptContext = null,
  ...props
}, ref) => {
  const { settings } = useApp();
  const { resolvedTheme } = useTheme();
  
  const envContext = useContext(EnvironmentsContext);
  const activeEnvironment = supportVariables ? envContext?.activeEnvironment : null;
  const getMergedVariables = supportVariables ? envContext?.getMergedVariables : null;
  
  const variableNames = useMemo(() => {
    if (!supportVariables) return [];
    
    if (getMergedVariables) {
      return getMergedVariables(collectionEnvironment || null)
        .filter(v => v.enabled && v.key)
        .map(v => ({ key: v.key, value: v.value }));
    }
    
    if (!activeEnvironment) return [];
    return activeEnvironment.variables
      .filter(v => v.enabled && v.key)
      .map(v => ({ key: v.key, value: v.value }));
  }, [supportVariables, getMergedVariables, collectionEnvironment, activeEnvironment]);

  const functionSuggestions = useMemo(() => {
    if (!supportVariables) return [];
    return getFunctionSuggestions();
  }, [supportVariables]);
  
  // Use refs so completer always has access to current data
  const variableNamesRef = useRef(variableNames);
  const functionSuggestionsRef = useRef<FunctionSuggestion[]>(functionSuggestions);
  
  useEffect(() => {
    variableNamesRef.current = variableNames;
  }, [variableNames]);
  
  useEffect(() => {
    functionSuggestionsRef.current = functionSuggestions;
  }, [functionSuggestions]);
  
  // Register completer in useEffect (like the working example from react-ace issues)
  useEffect(() => {
    if (!supportVariables) return;
    
    const langTools = ace.require('ace/ext/language_tools');
    
    const variableCompleter = {
      getCompletions: (
        _editor: any,
        session: any,
        pos: { row: number; column: number },
        _prefix: string,
        callback: (err: any, completions: any[]) => void
      ) => {
        const line = session.getLine(pos.row);
        const textBeforeCursor = line.substring(0, pos.column);
        const textAfterCursor = line.substring(pos.column);
        
        // Check if we're inside {{ }}
        const lastOpenBraces = textBeforeCursor.lastIndexOf('{{');
        const lastCloseBraces = textBeforeCursor.lastIndexOf('}}');
        
        if (lastOpenBraces === -1 || lastCloseBraces > lastOpenBraces) {
          callback(null, []);
          return;
        }
        
        const filterText = textBeforeCursor.slice(lastOpenBraces + 2).toLowerCase();
        const hasClosingBraces = textAfterCursor.trimStart().startsWith('}}');
        const closingSuffix = hasClosingBraces ? '' : '}}';
        
        const completions: any[] = [];
        
        // Environment variables
        variableNamesRef.current.forEach((v) => {
          if (v.key.toLowerCase().includes(filterText)) {
            completions.push({
              caption: v.key,
              value: v.key + closingSuffix,
              score: 1000,
              meta: 'Environment',
            });
          }
        });
        
        // Functions
        functionSuggestionsRef.current.forEach((fn) => {
          if (fn.name.toLowerCase().includes(filterText) || fn.description.toLowerCase().includes(filterText)) {
            const insertValue = fn.hasParameters 
              ? fn.name + '()' + closingSuffix 
              : fn.name + closingSuffix;
            completions.push({
              caption: fn.name,
              value: insertValue,
              score: 500,
              meta: categoryLabels[fn.category],
            });
          }
        });
        
        callback(null, completions);
      },
    };
    
    langTools.addCompleter(variableCompleter);
    
    // Cleanup: remove completer on unmount
    return () => {
      const completers = langTools.completers;
      if (completers) {
      const index = completers.indexOf(variableCompleter);
        if (index > -1) {
          completers.splice(index, 1);
        }
      }
    };
  }, [supportVariables]);
  
  // Script autocompletion for pre/post scripts
  const scriptCompletionsRef = useRef(scriptContext ? getScriptCompletions(scriptContext) : []);
  
  useEffect(() => {
    scriptCompletionsRef.current = scriptContext ? getScriptCompletions(scriptContext) : [];
  }, [scriptContext]);
  
  useEffect(() => {
    if (!scriptContext) return;
    
    const langTools = ace.require('ace/ext/language_tools');
    
    const scriptCompleter = {
      getCompletions: (
        _editor: any,
        session: any,
        pos: { row: number; column: number },
        prefix: string,
        callback: (err: any, completions: any[]) => void
      ) => {
        const line = session.getLine(pos.row);
        const textBeforeCursor = line.substring(0, pos.column);
        
        // Get word at cursor position for filtering
        const wordMatch = textBeforeCursor.match(/[\w.]*$/);
        const word = wordMatch ? wordMatch[0] : '';
        
        const completions = scriptCompletionsRef.current
          .filter(c => {
            if (!word) return true;
            return c.name.toLowerCase().includes(word.toLowerCase());
          })
          .map(c => ({
            caption: c.name,
            value: c.value.replace(/\$\d/g, ''), // Remove snippet placeholders
            snippet: c.value, // Keep snippet format for tabstops
            meta: c.meta,
            score: c.score,
            docHTML: `<div style="padding: 4px; max-width: 300px;">${c.description}</div>`,
          }));
        
        callback(null, completions);
      },
      getDocTooltip: (item: any) => {
        // Find the completion to get its description
        const completion = scriptCompletionsRef.current.find(c => c.name === item.caption);
        if (completion) {
          item.docHTML = `<div style="padding: 4px; max-width: 300px; color: var(--color-text-secondary);">${completion.description}</div>`;
        }
      },
    };
    
    langTools.addCompleter(scriptCompleter);
    
    // Cleanup
    return () => {
      const completers = langTools.completers;
      if (completers) {
        const index = completers.indexOf(scriptCompleter);
        if (index > -1) {
          completers.splice(index, 1);
        }
      }
    };
  }, [scriptContext]);
  
  const theme = forceTheme 
    ? (forceTheme === 'dark' ? 'one_dark' : 'chrome')
    : (resolvedTheme === 'dark' ? 'one_dark' : 'chrome');
  
  const mergedOptions = useMemo(() => ({
    showLineNumbers: settings.showLineNumbers ?? true,
    tabSize: settings.tabSize ?? 2,
    wrap: settings.wordWrap ?? true,
    useWorker: false,
    enableBasicAutocompletion: supportVariables || !!scriptContext,
    enableLiveAutocompletion: supportVariables || !!scriptContext,
    enableSnippets: !!scriptContext, // Enable snippets for script editors
    ...setOptions,
  }), [settings.showLineNumbers, settings.tabSize, settings.wordWrap, supportVariables, scriptContext, setOptions]);
  
  const editorRef = useRef<any>(null);

  const handleLoad = useCallback((editor: any) => {
    editorRef.current = editor;
    editor.commands.removeCommand('find');
    
    // Trigger autocomplete based on context
    if (supportVariables || scriptContext) {
      editor.commands.on('afterExec', (e: any) => {
        if (e.command.name === 'insertstring') {
          const pos = editor.getCursorPosition();
          const line = editor.session.getLine(pos.row);
          const textBeforeCursor = line.substring(0, pos.column);
          
          // Trigger autocomplete after typing {{
          if (supportVariables && textBeforeCursor.endsWith('{{')) {
            editor.execCommand('startAutocomplete');
          }
          
          // Trigger autocomplete after typing a dot for script context
          // (e.g., "echo.", "req.", "res.", "console.")
          if (scriptContext && textBeforeCursor.endsWith('.')) {
            const wordBeforeDot = textBeforeCursor.match(/(echo|req|res|console|JSON|Date|Math)\.$/);
            if (wordBeforeDot) {
              editor.execCommand('startAutocomplete');
            }
          }
        }
      });
    }
    
    onLoad?.(editor);
  }, [onLoad, supportVariables, scriptContext]);
  
  // Determine the mode - use custom mode with variable highlighting if supportVariables
  const mode = useMemo(() => {
    if (!supportVariables) return props.mode;
    
    // Map standard modes to their custom variants
    if (props.mode === 'json') return 'json_variables';
    if (props.mode === 'text') return 'text_variables';
    
    return props.mode;
  }, [props.mode, supportVariables]);
  
  return (
    <AceEditor
      ref={ref}
      theme={theme}
      fontSize={settings.fontSize ?? 13}
      showPrintMargin={false}
      showGutter={settings.showLineNumbers ?? true}
      highlightActiveLine={settings.highlightActiveLine ?? true}
      setOptions={mergedOptions}
      onLoad={handleLoad}
      className={className}
      {...props}
      mode={mode}
    />
  );
});

CodeEditor.displayName = 'CodeEditor';

export default CodeEditor;
