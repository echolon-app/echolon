/**
 * Date formatting utilities with locale support
 * 
 * Default locale is determined by the browser, but can be overridden
 * by setting a custom locale in the app settings.
 */

// Get the user's preferred locale from localStorage or use browser default
function getLocale(): string {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('echolon_locale');
    if (stored) return stored;
  }
  return navigator.language || 'en-US';
}

/**
 * Set the app's locale for date formatting
 * @param locale - ISO locale code (e.g., 'de-DE', 'en-US', 'fr-FR')
 */
export function setLocale(locale: string): void {
  localStorage.setItem('echolon_locale', locale);
}

/**
 * Get the current locale
 */
export function getCurrentLocale(): string {
  return getLocale();
}

/**
 * Format a date as date only (e.g., "1/1/2024" or "01.01.2024")
 * @param date - Date object, timestamp (ms), or ISO string
 * @param locale - Optional locale override (e.g., 'de-DE')
 * @param options - Optional Intl.DateTimeFormatOptions
 */
export function formatDate(
  date: Date | number | string,
  locale?: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = toDate(date);
  if (!d) return '';
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  };
  
  return d.toLocaleDateString(locale || getLocale(), options || defaultOptions);
}

/**
 * Format a date as time only (e.g., "14:30:00" or "2:30 PM")
 * @param date - Date object, timestamp (ms), or ISO string
 * @param locale - Optional locale override
 * @param options - Optional Intl.DateTimeFormatOptions
 */
export function formatTime(
  date: Date | number | string,
  locale?: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = toDate(date);
  if (!d) return '';
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  };
  
  return d.toLocaleTimeString(locale || getLocale(), options || defaultOptions);
}

/**
 * Format a date as short time (e.g., "14:30" or "2:30 PM")
 * @param date - Date object, timestamp (ms), or ISO string
 * @param locale - Optional locale override
 */
export function formatTimeShort(
  date: Date | number | string,
  locale?: string
): string {
  const d = toDate(date);
  if (!d) return '';
  
  return d.toLocaleTimeString(locale || getLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Format a date as full datetime (e.g., "1/1/2024, 14:30:00")
 * @param date - Date object, timestamp (ms), or ISO string
 * @param locale - Optional locale override
 * @param options - Optional Intl.DateTimeFormatOptions
 */
export function formatDateTime(
  date: Date | number | string,
  locale?: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = toDate(date);
  if (!d) return '';
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  };
  
  return d.toLocaleString(locale || getLocale(), options || defaultOptions);
}

/**
 * Format a date as short datetime (e.g., "1/1/2024, 14:30")
 * @param date - Date object, timestamp (ms), or ISO string
 * @param locale - Optional locale override
 */
export function formatDateTimeShort(
  date: Date | number | string,
  locale?: string
): string {
  const d = toDate(date);
  if (!d) return '';
  
  return d.toLocaleString(locale || getLocale(), {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Format a date relative to today (e.g., "Today at 14:30", "Yesterday at 10:00", "Jan 5")
 * @param date - Date object, timestamp (ms), or ISO string
 * @param locale - Optional locale override
 */
export function formatRelativeDate(
  date: Date | number | string,
  locale?: string
): string {
  const d = toDate(date);
  if (!d) return '';
  
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const inputDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  
  const loc = locale || getLocale();
  const timeStr = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', hour12: false });
  
  if (inputDate.getTime() === today.getTime()) {
    return `Today at ${timeStr}`;
  }
  
  if (inputDate.getTime() === yesterday.getTime()) {
    return `Yesterday at ${timeStr}`;
  }
  
  // For older dates, show month and day
  return d.toLocaleDateString(loc, { month: 'short', day: 'numeric' });
}

/**
 * Format a date with full month name (e.g., "January 1, 2024")
 * @param date - Date object, timestamp (ms), or ISO string
 * @param locale - Optional locale override
 */
export function formatDateLong(
  date: Date | number | string,
  locale?: string
): string {
  const d = toDate(date);
  if (!d) return '';
  
  return d.toLocaleDateString(locale || getLocale(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format a date with abbreviated month (e.g., "Jan 1, 2024")
 * @param date - Date object, timestamp (ms), or ISO string
 * @param locale - Optional locale override
 */
export function formatDateMedium(
  date: Date | number | string,
  locale?: string
): string {
  const d = toDate(date);
  if (!d) return '';
  
  return d.toLocaleDateString(locale || getLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Helper to convert various date inputs to a Date object
 */
function toDate(date: Date | number | string): Date | null {
  if (!date) return null;
  
  if (date instanceof Date) {
    return isNaN(date.getTime()) ? null : date;
  }
  
  if (typeof date === 'number') {
    const d = new Date(date);
    return isNaN(d.getTime()) ? null : d;
  }
  
  if (typeof date === 'string') {
    const d = new Date(date);
    return isNaN(d.getTime()) ? null : d;
  }
  
  return null;
}

/**
 * Format timestamp for logs/console (e.g., "14:30:45.123")
 * @param timestamp - Timestamp in milliseconds
 */
export function formatLogTime(timestamp: number): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const seconds = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Format a date/time or return a fallback if invalid/missing
 * @param date - Date object, timestamp (ms), or ISO string (can be undefined/null)
 * @param fallback - Fallback string to return if date is invalid
 * @param formatter - Formatter function to use (default: formatDateTime)
 */
export function formatDateOr(
  date: Date | number | string | undefined | null,
  fallback: string = 'Never',
  formatter: (date: Date | number | string, locale?: string) => string = formatDateTime
): string {
  if (!date) return fallback;
  const result = formatter(date);
  return result || fallback;
}

