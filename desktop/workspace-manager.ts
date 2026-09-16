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
    const hwnd = String(win.hwnd ?? '').trim();
    if (!hwnd || !/^(?:0x[0-9a-fA-F]+|\d+|[a-zA-Z0-9_.:-]+)$/.test(hwnd)) {
      throw new Error(`Invalid HWND / Window ID: ${win.hwnd}`);
    }
    const sanitizedWin: WindowIdentity = { ...win, hwnd };
    this.scope.set(hwnd, sanitizedWin);
    if (!this.activeHwnd) {
      this.activeHwnd = hwnd;
    }
    this.recordEvent('window_added', hwnd, `Added window "${sanitizedWin.title}" (${sanitizedWin.process}) to scope.`);
  }

  /**
   * Removes a window from the workspace scope.
   */
  public removeWindow(hwnd: string): void {
    const id = String(hwnd ?? '').trim();
    if (this.scope.delete(id)) {
      this.recordEvent('window_removed', id, `Removed HWND ${id} from scope.`);
      if (this.activeHwnd === id) {
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
    const id = String(hwnd ?? '').trim();
    return this.scope.has(id);
  }

  /**
   * Safely switches focus to another window within the workspace scope.
   * Throws an error if the target window is not in the authorized scope.
   */
  public switchFocus(targetHwnd: string): WindowIdentity {
    const id = String(targetHwnd ?? '').trim();
    const target = this.scope.get(id);
    if (!target) {
      this.recordEvent(
        'unauthorized_focus',
        id,
        `Attempted focus on unauthorized HWND ${id}. Blocked by workspace guard.`,
      );
      throw new Error(
        `Workspace Security Violation: HWND ${id} is not in the authorized workspace scope. Action rejected.`,
      );
    }

    const previousHwnd = this.activeHwnd;
    this.activeHwnd = id;
    this.recordEvent(
      'window_switched',
      id,
      `Switched focus from ${previousHwnd ?? 'none'} to "${target.title}" (HWND ${id}).`,
    );

    return { ...target };
  }

  /**
   * Validates whether a detected foreground window is allowed.
   * If not, marks as unauthorized and throws a fail-closed exception.
   */
  public validateForeground(currentHwnd: string, currentTitle?: string): void {
    const id = String(currentHwnd ?? '').trim();
    if (!this.isInScope(id)) {
      this.recordEvent(
        'unauthorized_focus',
        id,
        `Foreground window changed to unauthorized window: "${currentTitle ?? 'unknown'}" (HWND ${id}).`,
      );
      throw new Error(
        `Workspace Fail-Closed: Foreground window (${id}) is outside the AI employee workspace scope. Operation halted for safety.`,
      );
    }
  }

  /**
   * Validates that the window's PID and process name match registration,
   * defending against PID recycling and rogue window impersonation.
   */
  public validateWindowIntegrity(hwnd: string, currentPid?: number, currentProcess?: string): boolean {
    const id = String(hwnd ?? '').trim();
    const win = this.scope.get(id);
    if (!win) {
      throw new Error(`Workspace Security Violation: HWND ${id} is not registered in workspace.`);
    }

    if (currentPid !== undefined && win.pid !== 0 && currentPid !== win.pid) {
      this.recordEvent(
        'unauthorized_focus',
        id,
        `PID mismatch for HWND ${id}: registered PID ${win.pid}, detected PID ${currentPid}. Possible PID reuse. Blocked.`,
      );
      throw new Error(
        `Workspace Security Violation: PID mismatch for HWND ${id} (expected ${win.pid}, detected ${currentPid}).`,
      );
    }

    if (currentProcess !== undefined && win.process) {
      const regProc = win.process.toLowerCase().replace(/\.exe$/, '');
      const curProc = currentProcess.toLowerCase().replace(/\.exe$/, '');
      if (regProc !== curProc) {
        this.recordEvent(
          'unauthorized_focus',
          id,
          `Process name mismatch for HWND ${id}: expected "${win.process}", detected "${currentProcess}". Blocked.`,
        );
        throw new Error(
          `Workspace Security Violation: Process mismatch for HWND ${id} (expected "${win.process}", detected "${currentProcess}").`,
        );
      }
    }

    return true;
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
