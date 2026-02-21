/**
 * Patch Ace Editor searchbox to allow more than the default 999 search results.
 * Limit is configurable via Settings → Editor → Search max results (see aceSearchboxConfig).
 */
import ace from 'ace-builds';
import 'ace-builds/src-noconflict/ext-searchbox';
import { getEditorSearchMaxResults } from './aceSearchboxConfig';

function applySearchboxPatch() {
  const searchboxModule = ace.require('ace/ext/searchbox');
  const SearchBox = searchboxModule.SearchBox;
  const lang = ace.require('ace/lib/lang');
  const nls = ace.require('ace/config').nls;

  const originalUpdateCounter = SearchBox.prototype.updateCounter;
  if (originalUpdateCounter._acePatched) return;
  originalUpdateCounter._acePatched = true;

  SearchBox.prototype.updateCounter = function (this: any) {
    const maxCount = getEditorSearchMaxResults();
    const editor = this.editor;
    const regex = editor.$search.$options.re;
    let supportsUnicodeFlag = false;
    let all = 0;
    let before = 0;
    if (regex) {
      supportsUnicodeFlag = regex.unicode;
      let value = this.searchRange
        ? editor.session.getTextRange(this.searchRange)
        : editor.getValue();

      if (editor.$search.$isMultilineSearch(editor.getLastSearchOptions())) {
        value = value.replace(/\r\n|\r|\n/g, '\n');
        editor.session.doc.$autoNewLine = '\n';
      }

      let offset = editor.session.doc.positionToIndex(editor.selection.anchor);
      if (this.searchRange) {
        offset -= editor.session.doc.positionToIndex(this.searchRange.start);
      }

      let last = (regex.lastIndex = 0);
      let m: RegExpExecArray | null;
      while ((m = regex.exec(value))) {
        all++;
        last = m.index;
        if (last <= offset) before++;
        if (all > maxCount) break;
        if (!m[0]) {
          regex.lastIndex = last += lang.skipEmptyMatch(value, last, supportsUnicodeFlag);
          if (last >= value.length) break;
        }
      }
    }
    this.searchCounter.textContent = nls(
      'search-box.search-counter',
      '$0 of $1',
      [before, all > maxCount ? maxCount + '+' : all]
    );
  };
}

applySearchboxPatch();
