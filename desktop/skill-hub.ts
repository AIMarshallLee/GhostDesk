import fs from 'node:fs';
import path from 'node:path';
import type { SkillDefinition, SkillStep } from './skill-engine';

export class SkillHubManager {
  private skills = new Map<string, SkillDefinition>();

  constructor(skillsDir?: string) {
    if (skillsDir && fs.existsSync(skillsDir)) {
      this.loadDirectory(skillsDir);
    }
  }

  /**
   * Parses a community Skill SOP from human-readable Markdown.
   */
  public parseSkillMarkdown(content: string): SkillDefinition {
    const lines = content.split(/\r?\n/);
    let id = '';
    let name = '';
    let description = '';
    let version = '1.0.0';
    const requiredProcesses: string[] = [];
    const steps: SkillStep[] = [];

    let inFrontmatter = false;
    let frontmatterDone = false;
    let currentStep: Partial<SkillStep> | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Frontmatter delimiter
      if (line === '---') {
        if (!inFrontmatter && !frontmatterDone) {
          inFrontmatter = true;
          continue;
        } else if (inFrontmatter) {
          inFrontmatter = false;
          frontmatterDone = true;
          continue;
        }
      }

      if (inFrontmatter) {
        if (line.startsWith('id:')) id = line.replace('id:', '').trim();
        else if (line.startsWith('name:')) name = line.replace('name:', '').trim();
        else if (line.startsWith('description:')) description = line.replace('description:', '').trim();
        else if (line.startsWith('version:')) version = line.replace('version:', '').trim();
        else if (line.startsWith('processes:')) {
          const inline = line.replace('processes:', '').trim();
          if (inline.startsWith('[') && inline.endsWith(']')) {
            const items = inline
              .slice(1, -1)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            requiredProcesses.push(...items);
          } else if (inline.length > 0) {
            const items = inline.split(',').map((s) => s.trim()).filter(Boolean);
            requiredProcesses.push(...items);
          }
        } else if (line.startsWith('-')) {
          const prev = lines[i - 1]?.trim() || '';
          if (prev.startsWith('processes:') || prev.startsWith('-')) {
            const item = line.replace(/^-\s*/, '').trim();
            if (item) requiredProcesses.push(item);
          }
        }
        continue;
      }

      // Step headers: ### Step N: Step Name
      const stepHeader = /^###\s*(?:Step\s*\d+[:：]\s*)?(.*)/i.exec(line);
      if (stepHeader) {
        if (currentStep && currentStep.name && currentStep.instruction) {
          steps.push(currentStep as SkillStep);
        }
        currentStep = {
          id: `step_${steps.length + 1}`,
          name: stepHeader[1].trim(),
          targetProcess: requiredProcesses[0] || 'app.exe',
          instruction: '',
          expectedOutcome: 'Step completed.',
          channelPreference: 'auto',
        };
        continue;
      }

      // Step attributes
      if (currentStep) {
        if (line.startsWith('- Target:') || line.startsWith('- 目标:')) {
          currentStep.targetProcess = line.replace(/- (?:Target|目标):/, '').trim();
        } else if (line.startsWith('- Channel:') || line.startsWith('- 通道:')) {
          const val = line
            .replace(/- (?:Channel|通道):/, '')
            .trim()
            .toLowerCase();
          if (val === 'ghost' || val === 'fast') currentStep.channelPreference = val;
        } else if (line.startsWith('- Action:') || line.startsWith('- 指令:')) {
          currentStep.instruction = line.replace(/- (?:Action|指令):/, '').trim();
        } else if (line.startsWith('- Expect:') || line.startsWith('- 期望:')) {
          currentStep.expectedOutcome = line.replace(/- (?:Expect|期望):/, '').trim();
        } else if (!currentStep.instruction && line.length > 0 && !line.startsWith('#')) {
          currentStep.instruction = line;
        }
      }
    }

    if (currentStep && currentStep.name && currentStep.instruction) {
      steps.push(currentStep as SkillStep);
    }

    if (!id) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (slug.length > 0) {
        id = `skill_${slug}`;
      } else {
        const hex = Buffer.from(name, 'utf8').toString('hex').slice(0, 8);
        id = `skill_${hex}`;
      }
    }
    if (!name) throw new Error('Invalid Skill Markdown: Missing name in frontmatter');
    if (steps.length === 0) throw new Error('Invalid Skill Markdown: Must contain at least one step');

    return {
      id,
      name,
      description,
      version,
      requiredProcesses: requiredProcesses.length > 0 ? requiredProcesses : ['app.exe'],
      steps,
    };
  }

  public loadDirectory(dirPath: string): number {
    let count = 0;
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (file.endsWith('.md')) {
        const fullPath = path.join(dirPath, file);
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const skill = this.parseSkillMarkdown(content);
          this.skills.set(skill.id, skill);
          count++;
        } catch {
          // Skip malformed files
        }
      }
    }
    return count;
  }

  public list(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  public get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }
}
