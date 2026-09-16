export interface WindowIdentity {
  hwnd: string;
  pid: number;
  process: string;
  processStart?: string;
  title: string;
  width?: number;
  height?: number;
}

export interface WorkspaceEvent {
  type: 'window_switched' | 'unauthorized_focus' | 'window_added' | 'window_removed';
  targetHwnd: string;
  timestamp: string;
  details?: string;
}

export class MultiWindowWorkspace {
  private scope = new Map<string, WindowIdentity>();
  private activeHwnd: string | undefined;
  private eventHistory: WorkspaceEvent[] = [];

  constructor(initialWindows: WindowIdentity[] = []) {
    for (const win of initialWindows) {
      this.addWindow(win);
    }
  }

  /**
   * Adds an allowed application window to the AI employee's workspace scope.
   */
  public addWindow(win: WindowIdentity): void {
    if (!win.hwnd || !/^(?:0x[0-9a-fA-F]+|\d+|[a-zA-Z0-9_.-]+)$/.test(win.hwnd)) {
      throw new Error(`Invalid HWND / Window ID: ${win.hwnd}`);
    }
    this.scope.set(win.hwnd, { ...win });
    if (!this.activeHwnd) {
      this.activeHwnd = win.hwnd;
    }
    this.recordEvent('window_added', win.hwnd, `Added window "${win.title}" (${win.process}) to scope.`);
  }

  /**
   * Removes a window from the workspace scope.
   */
  public removeWindow(hwnd: string): void {
    if (this.scope.delete(hwnd)) {
      this.recordEvent('window_removed', hwnd, `Removed HWND ${hwnd} from scope.`);
      if (this.activeHwnd === hwnd) {
        this.activeHwnd = this.scope.keys().next().value;
      }
    }
  }

  /**
   * Returns all windows currently whitelisted in the workspace.
   */
  public listWindows(): WindowIdentity[] {
    return Array.from(this.scope.values());
  }

  /**
   * Gets the currently active target window.
   */
  public getActiveWindow(): WindowIdentity | undefined {
    return this.activeHwnd ? this.scope.get(this.activeHwnd) : undefined;
  }

  /**
   * Checks whether a window is within the authorized scope.
   */
  public isInScope(hwnd: string): boolean {
    return this.scope.has(hwnd);
  }

  /**
   * Safely switches focus to another window within the workspace scope.
   * Throws an error if the target window is not in the authorized scope.
   */
  public switchFocus(targetHwnd: string): WindowIdentity {
    const target = this.scope.get(targetHwnd);
    if (!target) {
      this.recordEvent(
        'unauthorized_focus',
        targetHwnd,
        `Attempted focus on unauthorized HWND ${targetHwnd}. Blocked by workspace guard.`,
      );
      throw new Error(
        `Workspace Security Violation: HWND ${targetHwnd} is not in the authorized workspace scope. Action rejected.`,
      );
    }

    const previousHwnd = this.activeHwnd;
    this.activeHwnd = targetHwnd;
    this.recordEvent(
      'window_switched',
      targetHwnd,
      `Switched focus from ${previousHwnd ?? 'none'} to "${target.title}" (HWND ${targetHwnd}).`,
    );

    return { ...target };
  }

  /**
   * Validates whether a detected foreground window is allowed.
   * If not, marks as unauthorized and throws a fail-closed exception.
   */
  public validateForeground(currentHwnd: string, currentTitle?: string): void {
    if (!this.isInScope(currentHwnd)) {
      this.recordEvent(
        'unauthorized_focus',
        currentHwnd,
        `Foreground window changed to unauthorized window: "${currentTitle ?? 'unknown'}" (HWND ${currentHwnd}).`,
      );
      throw new Error(
        `Workspace Fail-Closed: Foreground window (${currentHwnd}) is outside the AI employee workspace scope. Operation halted for safety.`,
      );
    }
  }

  public getRecentEvents(limit = 20): readonly WorkspaceEvent[] {
    return this.eventHistory.slice(-limit);
  }

  private recordEvent(type: WorkspaceEvent['type'], targetHwnd: string, details?: string): void {
    this.eventHistory.push({
      type,
      targetHwnd,
      timestamp: new Date().toISOString(),
      details,
    });
    if (this.eventHistory.length > 500) {
      this.eventHistory.shift();
    }
  }
}
