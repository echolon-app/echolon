import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './ColorEmojiPicker.css';

// Default color palette for environments
export const ENV_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#84cc16', // lime
  '#22c55e', // green
  '#10b981', // emerald
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#0ea5e9', // sky
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#d946ef', // fuchsia
  '#ec4899', // pink
  '#f43f5e', // rose
  '#64748b', // slate
];

// Common emojis for environments
export const ENV_EMOJIS = [
  '🚀', '🔥', '⚡', '🌟', '💎', '🎯', '🏆', '🎨',
  '🔧', '⚙️', '🛠️', '🔨', '📦', '📁', '🗂️', '💼',
  '🌍', '🌐', '☁️', '🏠', '🏢', '🏭', '🧪', '🔬',
  '🐛', '🐞', '🦋', '🐝', '🦊', '🐱', '🐶', '🦁',
  '🌱', '🌿', '🍀', '🌸', '🌺', '🌻', '🌴', '🎄',
  '✅', '❌', '⚠️', '🚧', '🔒', '🔓', '🔑', '🛡️',
];

export interface ColorEmojiPickerProps {
  color?: string;
  emoji?: string;
  onChange: (updates: { color?: string; emoji?: string }) => void;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}

export const ColorEmojiPicker: React.FC<ColorEmojiPickerProps> = ({
  color,
  emoji,
  onChange,
  size = 'md',
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'color' | 'emoji'>('color');
  const [customColor, setCustomColor] = useState(color || '');
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Calculate dropdown position
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const dropdownHeight = 300;
      const dropdownWidth = 280;
      
      let top = rect.bottom + 8;
      let left = rect.left;
      
      // Adjust if would overflow right
      if (left + dropdownWidth > window.innerWidth - 16) {
        left = window.innerWidth - dropdownWidth - 16;
      }
      
      // Adjust if would overflow bottom
      if (top + dropdownHeight > window.innerHeight - 16) {
        top = rect.top - dropdownHeight - 8;
      }
      
      setDropdownPosition({ top, left });
    }
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && 
        !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleColorSelect = (selectedColor: string) => {
    onChange({ color: selectedColor, emoji: undefined });
    setIsOpen(false);
  };

  const handleEmojiSelect = (selectedEmoji: string) => {
    onChange({ emoji: selectedEmoji, color: undefined });
    setIsOpen(false);
  };

  const handleCustomColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomColor(e.target.value);
  };

  const handleCustomColorApply = () => {
    if (customColor && /^#[0-9A-Fa-f]{6}$/.test(customColor)) {
      onChange({ color: customColor, emoji: undefined });
      setIsOpen(false);
    }
  };

  const handleClear = () => {
    onChange({ color: undefined, emoji: undefined });
    setIsOpen(false);
  };

  const displayValue = emoji || (color ? undefined : null);
  const displayColor = emoji ? undefined : color;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`color-emoji-picker__trigger color-emoji-picker__trigger--${size}${disabled ? ' color-emoji-picker__trigger--disabled' : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        title={emoji ? `Emoji: ${emoji}` : color ? `Color: ${color}` : 'Choose color or emoji'}
      >
        {displayValue ? (
          <span className="color-emoji-picker__emoji">{displayValue}</span>
        ) : displayColor ? (
          <span 
            className="color-emoji-picker__color-preview"
            style={{ backgroundColor: displayColor }}
          />
        ) : (
          <span className="color-emoji-picker__placeholder" />
        )}
      </button>

      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          className="color-emoji-picker__dropdown"
          style={{
            position: 'fixed',
            top: dropdownPosition.top,
            left: dropdownPosition.left,
          }}
        >
          <div className="color-emoji-picker__tabs">
            <button
              type="button"
              className={`color-emoji-picker__tab ${activeTab === 'color' ? 'active' : ''}`}
              onClick={() => setActiveTab('color')}
            >
              Colors
            </button>
            <button
              type="button"
              className={`color-emoji-picker__tab ${activeTab === 'emoji' ? 'active' : ''}`}
              onClick={() => setActiveTab('emoji')}
            >
              Emoji
            </button>
          </div>

          <div className="color-emoji-picker__content">
            {activeTab === 'color' && (
              <>
                <div className="color-emoji-picker__grid">
                  {ENV_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`color-emoji-picker__color-option ${color === c ? 'selected' : ''}`}
                      style={{ backgroundColor: c }}
                      onClick={() => handleColorSelect(c)}
                      title={c}
                    />
                  ))}
                </div>
                <div className="color-emoji-picker__custom">
                  <input
                    type="text"
                    className="color-emoji-picker__custom-input"
                    placeholder="#000000"
                    value={customColor}
                    onChange={handleCustomColorChange}
                    maxLength={7}
                  />
                  <input
                    type="color"
                    className="color-emoji-picker__color-input"
                    value={customColor || '#3b82f6'}
                    onChange={(e) => {
                      setCustomColor(e.target.value);
                      onChange({ color: e.target.value, emoji: undefined });
                    }}
                  />
                  <button
                    type="button"
                    className="color-emoji-picker__apply-btn"
                    onClick={handleCustomColorApply}
                    disabled={!customColor || !/^#[0-9A-Fa-f]{6}$/.test(customColor)}
                  >
                    Apply
                  </button>
                </div>
              </>
            )}

            {activeTab === 'emoji' && (
              <div className="color-emoji-picker__emoji-grid">
                {ENV_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className={`color-emoji-picker__emoji-option ${emoji === e ? 'selected' : ''}`}
                    onClick={() => handleEmojiSelect(e)}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="color-emoji-picker__footer">
            <button
              type="button"
              className="color-emoji-picker__clear-btn"
              onClick={handleClear}
            >
              Clear
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default ColorEmojiPicker;

