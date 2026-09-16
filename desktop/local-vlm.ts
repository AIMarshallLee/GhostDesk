import type { ComputerUseAction } from '../shared/computer-use';

export interface QwenVlmParsedAction {
  action: ComputerUseAction;
  rawText: string;
  thought?: string;
}

/**
 * Adapter for Qwen2.5-VL running locally on Ollama, vLLM, or LMDeploy.
 * Handles parsing Qwen's vision-coordinate predictions (0-1000 scale)
 * and translates them into GhostDesk's normalized (0.0-1.0) ComputerUseAction.
 */
export class QwenVlmAdapter {
  /**
   * Builds an OpenAI-compatible vision payload for local Ollama / vLLM.
   */
  public static buildPayload(
    prompt: string,
    base64Image: string,
    modelName = 'qwen2.5-vl:7b',
  ): Record<string, unknown> {
    return {
      model: modelName,
      messages: [
        {
          role: 'system',
          content:
            'You are a Windows Computer Use agent. Analyze the screenshot and execute the user command. Output actions using format: Thought: <reasoning>\nAction: click(point=[y, x]) or type(content="text") or hotkey(key="enter") or scroll(direction="down"). Point coordinates are normalized to 0-1000.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: base64Image.startsWith('data:') ? base64Image : `data:image/png;base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      temperature: 0.1,
    };
  }

  /**
   * Parses Qwen2.5-VL response string into a normalized ComputerUseAction.
   * Qwen coordinates are typically [y, x] on a 0-1000 integer grid.
   */
  public static parseAction(response: string): QwenVlmParsedAction {
    const text = response.trim();
    let thought: string | undefined;

    // Extract Thought if present
    const thoughtMatch = /Thought[:：]([\s\S]*?)(?=Action[:：]|$)/i.exec(text);
    if (thoughtMatch) {
      thought = thoughtMatch[1].trim();
    }

    // Extract Action section
    const actionMatch = /Action[:：]([\s\S]*)/i.exec(text);
    const actionSection = (actionMatch ? actionMatch[1] : text).trim();

    // 1. Match click: click(point=[y, x]) or click(start_box='[y, x]')
    const clickMatch = /click\s*\(\s*(?:point|start_box)?\s*=?\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/i.exec(actionSection);
    if (clickMatch) {
      const rawY = parseInt(clickMatch[1], 10);
      const rawX = parseInt(clickMatch[2], 10);
      // Normalize from 0-1000 to 0.0-1.0
      const x = Math.min(1.0, Math.max(0.0, rawX / 1000));
      const y = Math.min(1.0, Math.max(0.0, rawY / 1000));
      return {
        action: { kind: 'click', x, y, button: 'left', count: 1 },
        rawText: actionSection,
        thought,
      };
    }

    // 2. Match type: type(content="text") or type(text="text")
    const typeMatch = /type\s*\(\s*(?:content|text)?\s*=?\s*["']([\s\S]*?)["']\s*\)/i.exec(actionSection);
    if (typeMatch) {
      return {
        action: { kind: 'type', text: typeMatch[1] },
        rawText: actionSection,
        thought,
      };
    }

    // 3. Match hotkey: hotkey(key="enter") or key("esc")
    const keyMatch = /(?:hotkey|key)\s*\(\s*(?:key)?\s*=?\s*["']([a-zA-Z0-9+_]+)["']\s*\)/i.exec(actionSection);
    if (keyMatch) {
      return {
        action: { kind: 'key', key: keyMatch[1].toLowerCase() },
        rawText: actionSection,
        thought,
      };
    }

    // 4. Match scroll: scroll(direction="down|up", amount=3)
    const scrollMatch = /scroll\s*\(\s*(?:direction)?\s*=?\s*["'](up|down)["'](?:,\s*amount\s*=\s*(\d+))?\s*\)/i.exec(
      actionSection,
    );
    if (scrollMatch) {
      return {
        action: {
          kind: 'scroll',
          direction: scrollMatch[1].toLowerCase() as 'up' | 'down',
          amount: scrollMatch[2] ? parseInt(scrollMatch[2], 10) : 3,
          x: 0.5,
          y: 0.5,
        },
        rawText: actionSection,
        thought,
      };
    }

    // Fallback: default to key wait or enter
    return {
      action: { kind: 'key', key: 'enter' },
      rawText: actionSection,
      thought: thought ?? 'Fallback default',
    };
  }
}
