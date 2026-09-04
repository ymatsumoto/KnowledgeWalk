import type { HistoryEntry, PreviewState } from './protocol';

/**
 * Per-tab back/forward stack, kept free of any VS Code dependency so the navigation
 * rules can be reasoned about — and tested — on their own.
 *
 * Each entry remembers the link that was followed *out of* it (`linkId`). That is what
 * lets Back put the reader's finger back on the link they clicked, rather than at an
 * arbitrary saved pixel offset.
 */
export class NavigationHistory {
  private entries: HistoryEntry[] = [];
  private cursor = -1;

  constructor(private maxLength: number) {}

  static fromState(state: PreviewState | undefined, maxLength: number): NavigationHistory {
    const history = new NavigationHistory(maxLength);
    const entries = state?.history ?? [];
    if (entries.length > 0) {
      history.entries = entries.slice(0, maxLength);
      history.cursor = Math.min(Math.max(state?.index ?? 0, 0), history.entries.length - 1);
    }
    return history;
  }

  get length(): number {
    return this.entries.length;
  }

  get index(): number {
    return this.cursor;
  }

  get current(): HistoryEntry | undefined {
    return this.entries[this.cursor];
  }

  get canGoBack(): boolean {
    return this.cursor > 0;
  }

  get canGoForward(): boolean {
    return this.cursor >= 0 && this.cursor < this.entries.length - 1;
  }

  setMaxLength(maxLength: number): void {
    this.maxLength = Math.max(2, maxLength);
    this.trim();
  }

  /**
   * Follow a link. `fromLinkId` is stamped onto the entry being left behind, the
   * forward branch is discarded, and the new page becomes current.
   */
  push(uri: string, fragment?: string, fromLinkId?: number): void {
    if (this.cursor >= 0 && typeof fromLinkId === 'number' && fromLinkId >= 0) {
      this.entries[this.cursor].linkId = fromLinkId;
    }
    this.entries = this.entries.slice(0, this.cursor + 1);
    this.entries.push({ uri, fragment });
    this.cursor = this.entries.length - 1;
    this.trim();
  }

  back(): boolean {
    if (!this.canGoBack) {
      return false;
    }
    this.cursor -= 1;
    return true;
  }

  forward(): boolean {
    if (!this.canGoForward) {
      return false;
    }
    this.cursor += 1;
    return true;
  }

  snapshot(): PreviewState {
    return { history: this.entries, index: this.cursor };
  }

  /** Drop the oldest entries once the stack outgrows the configured limit. */
  private trim(): void {
    const overflow = this.entries.length - this.maxLength;
    if (overflow > 0) {
      this.entries = this.entries.slice(overflow);
      this.cursor = Math.max(0, this.cursor - overflow);
    }
  }
}
