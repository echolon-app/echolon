/**
 * Current editor search max results limit. Synced from app settings
 * so the Ace searchbox patch can read it without depending on React.
 */
let editorSearchMaxResults = 9999;

export function getEditorSearchMaxResults(): number {
  return editorSearchMaxResults;
}

export function setEditorSearchMaxResults(value: number): void {
  editorSearchMaxResults = value;
}
