import path from 'node:path';
import { SkillHubManager } from './skill-hub';
import { resolveExecutionChannel } from './hybrid-policy';
import { BUILTIN_SKILL_ORDER_TO_EXCEL, type SkillDefinition } from './skill-engine';

export interface SimulationResult {
  skillId: string;
  skillName: string;
  totalSteps: number;
  completedSteps: number;
  ghostChannelActions: number;
  fastChannelActions: number;
  totalTokensSaved: number;
  totalDurationMs: number;
  recoveredBlockages: number;
  status: 'completed' | 'failed';
}

export interface SimulationOptions {
  interactiveDelayMs?: number;
  simulateBlockage?: boolean;
  quiet?: boolean;
}

const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

export async function runSimulation(
  targetSkillId?: string,
  options: SimulationOptions = {},
): Promise<SimulationResult> {
  const delay = options.interactiveDelayMs ?? 150;
  const quiet = options.quiet ?? false;
  const log = (msg: string) => {
    if (!quiet) console.log(msg);
  };

  // Load skills
  const skillsDir = path.resolve(process.cwd(), 'skills');
  const hub = new SkillHubManager(skillsDir);
  const allSkills = [BUILTIN_SKILL_ORDER_TO_EXCEL, ...hub.list()];

  let skill: SkillDefinition | undefined;
  if (targetSkillId) {
    skill = allSkills.find((s) => s.id === targetSkillId);
  }
  if (!skill) {
    skill = allSkills[0];
  }

  log('');
  log(`${c.cyan}${c.bright}==============================================================${c.reset}`);
  log(`${c.magenta}${c.bright}   GhostDesk 👻 Desktop AI Employee Terminal Simulator        ${c.reset}`);
  log(`${c.cyan}${c.bright}==============================================================${c.reset}`);
  log(`${c.dim}Simulating Hardware-in-the-Loop & Hybrid Channel Execution...${c.reset}\n`);

  log(`${c.yellow}[Skill]${c.reset} ${c.bright}${skill.name}${c.reset} (ID: ${skill.id})`);
  log(`${c.dim}Desc: ${skill.description}${c.reset}`);
  log(`${c.dim}Allowed Scope: [${skill.requiredProcesses.join(', ')}]${c.reset}`);
  log(`Total SOP Steps: ${skill.steps.length}\n`);

  let ghostCount = 0;
  let fastCount = 0;
  let tokensSaved = 0;
  let blockagesRecovered = 0;
  const startTime = Date.now();

  for (let i = 0; i < skill.steps.length; i++) {
    const step = skill.steps[i];
    const decision = resolveExecutionChannel(step.targetProcess);

    const isGhost = decision.channel === 'ghost';
    if (isGhost) {
      ghostCount++;
    } else {
      fastCount++;
      tokensSaved += 350; // Saved VLM tokens by bypassing OCR candidate loop
    }

    const channelBadge = isGhost
      ? `${c.red}[Ghost 慢通道: Pico USB HID 物理防封]${c.reset}`
      : `${c.green}[Fast 快通道: 50ms 原生高吞吐录入]${c.reset}`;

    log(
      `${c.bright}Step ${i + 1}/${skill.steps.length}:${c.reset} ${step.name}`,
    );
    log(`  Target: ${c.cyan}${step.targetProcess}${c.reset} | ${channelBadge}`);
    log(`  Action: ${c.dim}${step.instruction}${c.reset}`);

    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }

    // Simulate unexpected popup blockage and ESC self-healing if requested
    if (options.simulateBlockage && i === 1) {
      log(`  ${c.yellow}⚠️ [Self-Healing] Unexpected modal dialog detected! Screen stuck.${c.reset}`);
      log(`  ${c.yellow}👉 Dispatching emergency ESC recovery action to restore neutral state...${c.reset}`);
      blockagesRecovered++;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      log(`  ${c.green}✓ Modal dismissed. Resuming SOP step.${c.reset}`);
    }

    log(`  Expect: ${c.dim}${step.expectedOutcome}${c.reset} -> ${c.green}✓ Done${c.reset}\n`);
  }

  const durationMs = Date.now() - startTime;

  log(`${c.cyan}--------------------------------------------------------------${c.reset}`);
  log(`${c.green}${c.bright}🎉 SOP 执行圆满完成！(Completed Successfully)${c.reset}`);
  log(`${c.dim}  - 总耗时:${c.reset} ${durationMs} ms`);
  log(`${c.dim}  - Ghost 物理防封动作:${c.reset} ${ghostCount} 次 (Pico USB HID)`);
  log(`${c.dim}  - Fast 极速无损动作:${c.reset} ${fastCount} 次`);
  log(`${c.dim}  - 累计节省 Token 估算:${c.reset} ~${tokensSaved} tokens`);
  log(`${c.dim}  - 自愈防卡死恢复:${c.reset} ${blockagesRecovered} 次`);
  log(`${c.cyan}==============================================================${c.reset}\n`);

  return {
    skillId: skill.id,
    skillName: skill.name,
    totalSteps: skill.steps.length,
    completedSteps: skill.steps.length,
    ghostChannelActions: ghostCount,
    fastChannelActions: fastCount,
    totalTokensSaved: tokensSaved,
    totalDurationMs: durationMs,
    recoveredBlockages: blockagesRecovered,
    status: 'completed',
  };
}

// Auto-run if executed directly via CLI
if (process.argv[1] && process.argv[1].endsWith('simulate.ts')) {
  const targetId = process.argv[2];
  runSimulation(targetId).catch((err) => {
    console.error('Simulation error:', err);
    process.exit(1);
  });
}
