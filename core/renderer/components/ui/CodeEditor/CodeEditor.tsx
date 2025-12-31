import React, { useCallback, forwardRef } from 'react';
import AceEditor, { IAceEditorProps } from 'react-ace';
import { useApp, useTheme } from '@/contexts';

import 'ace-builds/src-noconflict/mode-json';
import 'ace-builds/src-noconflict/mode-text';
import 'ace-builds/src-noconflict/mode-javascript';
import 'ace-builds/src-noconflict/theme-one_dark';
import 'ace-builds/src-noconflict/theme-chrome';

export interface CodeEditorProps extends Omit<IAceEditorProps, 'theme'> {
  /** Override the auto-detected theme */
  forceTheme?: 'dark' | 'light';
  /** Additional class name */
  className?: string;
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
  ...props
}, ref) => {
  const { settings } = useApp();
  const { resolvedTheme } = useTheme();
  
  // Determine theme
  const theme = forceTheme 
    ? (forceTheme === 'dark' ? 'one_dark' : 'chrome')
    : (resolvedTheme === 'dark' ? 'one_dark' : 'chrome');
  
  // Merge settings with provided options
  const mergedOptions = {
    showLineNumbers: settings.showLineNumbers ?? true,
    tabSize: settings.tabSize ?? 2,
    wrap: settings.wordWrap ?? true,
    useWorker: false,
    ...setOptions,
  };
  
  // Handle editor load to configure additional settings
  const handleLoad = useCallback((editor: any) => {
    // Apply search box extension
    editor.commands.addCommand({
      name: 'find',
      bindKey: { win: 'Ctrl-F', mac: 'Cmd-F' },
      exec: () => {
        editor.execCommand('find');
      },
    });
    
    // Call original onLoad if provided
    onLoad?.(editor);
  }, [onLoad]);
  
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
    />
  );
});

CodeEditor.displayName = 'CodeEditor';

export default CodeEditor;

