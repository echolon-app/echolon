import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { storageManager } from '@/services';
import type { ColorScheme, ColorSchemeInfo } from '@/types';

type Theme = 'light' | 'dark' | 'system';

// Color scheme definitions with metadata
export const COLOR_SCHEMES: ColorSchemeInfo[] = [
  {
    id: 'terminal',
    name: 'Terminal',
    description: 'Classic terminal vibes with deep blacks and vibrant greens',
    primaryColor: '#22c55e',
    previewColors: ['#0a0a0a', '#111111', '#22c55e', '#4ade80'],
  },
  {
    id: 'midnight',
    name: 'Midnight Indigo',
    description: 'Deep indigo tones for a refined, modern look',
    primaryColor: '#6366f1',
    previewColors: ['#0f0f1a', '#1a1a2e', '#6366f1', '#818cf8'],
  },
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Calming blue palette inspired by the deep sea',
    primaryColor: '#0ea5e9',
    previewColors: ['#0c1929', '#0f2942', '#0ea5e9', '#38bdf8'],
  },
  {
    id: 'sunset',
    name: 'Sunset',
    description: 'Warm oranges and ambers for a cozy atmosphere',
    primaryColor: '#f97316',
    previewColors: ['#1a0f0a', '#2e1a0f', '#f97316', '#fb923c'],
  },
  {
    id: 'rose',
    name: 'Rose',
    description: 'Elegant pink and magenta accents',
    primaryColor: '#ec4899',
    previewColors: ['#1a0f14', '#2e1a24', '#ec4899', '#f472b6'],
  },
  {
    id: 'emerald',
    name: 'Emerald',
    description: 'Fresh teal and cyan for a refreshing feel',
    primaryColor: '#14b8a6',
    previewColors: ['#0a1a18', '#0f2e2a', '#14b8a6', '#2dd4bf'],
  },
];

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  colorScheme: ColorScheme;
  setTheme: (theme: Theme) => void;
  setColorScheme: (scheme: ColorScheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => storageManager.getTheme());
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>(() => storageManager.getColorScheme());
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark');

  const updateResolvedTheme = useCallback(() => {
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setResolvedTheme(prefersDark ? 'dark' : 'light');
    } else {
      setResolvedTheme(theme);
    }
  }, [theme]);

  useEffect(() => {
    updateResolvedTheme();

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        updateResolvedTheme();
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, updateResolvedTheme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-color-scheme', colorScheme);
  }, [colorScheme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    storageManager.setTheme(newTheme);
  }, []);

  const setColorScheme = useCallback((newScheme: ColorScheme) => {
    setColorSchemeState(newScheme);
    storageManager.setColorScheme(newScheme);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, colorScheme, setTheme, setColorScheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};

export default ThemeContext;

