export interface SkillStep {
  id: string;
  name: string;
  targetProcess: string;
  instruction: string;
  expectedOutcome: string;
  channelPreference?: 'auto' | 'ghost' | 'fast';
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  requiredProcesses: string[];
  steps: SkillStep[];
  fallbackPrompt?: string;
}

/**
 * Standard enterprise benchmark skill:
 * Cross-software order processing:
 * 1. Read customer order details from WeChat (Ghost channel)
 * 2. Switch focus to Excel spreadsheet
 * 3. Append order row instantaneously via Fast channel (50ms)
 * 4. Switch back to WeChat and reply confirmation via Ghost channel
 */
export const BUILTIN_SKILL_ORDER_TO_EXCEL: SkillDefinition = {
  id: 'skill_order_to_excel',
  name: '微信订单自动归档至 Excel',
  description: '从微信客户群提取订单需求，跨软件快速录入 Excel 流水表，并切回微信向客户确认。',
  version: '1.0.0',
  requiredProcesses: ['wechat.exe', 'excel.exe'],
  steps: [
    {
      id: 'step_read_wechat',
      name: '读取微信客户订单消息',
      targetProcess: 'wechat.exe',
      instruction: '定位最新客户消息，提取收件人姓名、联系电话、购买商品及数量。',
      expectedOutcome: '获得结构化订单信息（姓名、电话、SKU、数量）。',
      channelPreference: 'ghost',
    },
    {
      id: 'step_switch_to_excel',
      name: '安全切换至 Excel 订单表',
      targetProcess: 'excel.exe',
      instruction: '激活并聚焦已授权的订单表格窗口，定位至最后空白行首单元格。',
      expectedOutcome: 'Excel 窗口已置顶且目标单元格处于选中状态。',
      channelPreference: 'fast',
    },
    {
      id: 'step_fast_input_row',
      name: '高速录入订单明细',
      targetProcess: 'excel.exe',
      instruction: '通过 Fast 通道无损录入 CSV/Tab 分隔的订单数据行，按回车保存。',
      expectedOutcome: '新订单行显示在表格中，耗时 < 100ms。',
      channelPreference: 'fast',
    },
    {
      id: 'step_reply_confirmation',
      name: '切回微信发送确认通知',
      targetProcess: 'wechat.exe',
      instruction: '重新聚焦微信窗口，使用 Ghost 通道全拼逐键输入“您的订单已为您登记入库，正在安排出库！”，安全发送。',
      expectedOutcome: '微信聊天框中出现已发出的确认回复。',
      channelPreference: 'ghost',
    },
  ],
};

/**
 * SkillRegistry manages modular AI employee skills.
 */
export class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();

  constructor() {
    this.register(BUILTIN_SKILL_ORDER_TO_EXCEL);
  }

  public register(skill: SkillDefinition): void {
    if (!skill.id || !skill.name) {
      throw new Error('Skill must have a valid id and name');
    }
    if (!Array.isArray(skill.requiredProcesses) || skill.requiredProcesses.length === 0) {
      throw new Error(`Skill ${skill.id} must declare at least one requiredProcess`);
    }
    if (!Array.isArray(skill.steps) || skill.steps.length === 0) {
      throw new Error(`Skill ${skill.id} must declare at least one step`);
    }
    this.skills.set(skill.id, structuredClone(skill));
  }

  public get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  public list(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * Validates if the active workspace contains all required processes for a skill.
   */
  public validateWorkspaceSupport(skillId: string, openProcesses: string[]): { supported: boolean; missing: string[] } {
    const skill = this.get(skillId);
    if (!skill) throw new Error(`Skill ${skillId} not found`);

    const openSet = new Set(openProcesses.map((p) => p.toLowerCase()));
    const missing = skill.requiredProcesses.filter((req) => !openSet.has(req.toLowerCase()));

    return {
      supported: missing.length === 0,
      missing,
    };
  }
}
