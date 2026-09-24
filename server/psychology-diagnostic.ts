import type { CandidateDraft, PsychologyDiagnostic } from '../shared/types.ts';

/**
 * Psychological & Tactical Intent Diagnostic Engine
 * Analyzes conversational psychology, underlying motivation, tension/risk level, and tactical strategy.
 */
export function analyzePsychologyAndIntent(
  text: string,
  history: Array<{ direction: string; text: string }> = []
): PsychologyDiagnostic {
  const normalized = text.toLowerCase().trim();

  // 1. Evaluate risk and emotional tension
  let riskLevel: PsychologyDiagnostic['riskLevel'] = 'safe';
  if (/退款|投诉|差评|欺诈|报警|曝光|骗子|避雷|假货|打假|违法|黑心|315/.test(normalized)) {
    riskLevel = 'high_risk';
  } else if (/贵|太贵|降价|少点|优惠|别家|竞品|考虑|犹豫|不确定|靠谱吗|质量好吗|被骗|售后|麻烦/.test(normalized)) {
    riskLevel = 'cautious';
  }

  // 2. Identify core underlying psychological need
  let coreNeed: PsychologyDiagnostic['coreNeed'] = 'other';
  if (/贵|价格|多少钱|报价|预算|优惠|打折|活动|便宜/.test(normalized)) {
    coreNeed = 'price';
  } else if (/靠谱|正品|保修|坏了|售后|资质|合同|安全|跑路|保障|发票/.test(normalized)) {
    coreNeed = 'trust';
  } else if (/发货|多久|几天|加急|顺丰|现货|马上|立刻|几点|什么时候/.test(normalized)) {
    coreNeed = 'speed';
  } else if (/怎么用|教我|安装|配对|调测|教程|售后|支持/.test(normalized)) {
    coreNeed = 'service';
  } else if (/退换|不合适|不喜欢|无理由|不满意|保障|试用/.test(normalized)) {
    coreNeed = 'reassurance';
  }

  // 3. Uncover the underlying hidden motivation (透视真实心理)
  let underlyingIntent = '常规业务咨询，了解产品或服务基础信息。';
  let suggestedAction = '提供清晰友善的规格与说明，保持开放沟通节奏。';
  let confidence = 85;

  if (riskLevel === 'high_risk') {
    underlyingIntent = '严重信任受损预警，处于愤怒或防御状态，核心诉求是情绪平复与权益保障承诺。';
    suggestedAction = '⚡ 绝不辩解，优先共情致歉；明确由专属主管先行介入解决，锁定电话或即时处理。';
    confidence = 96;
  } else if (coreNeed === 'price') {
    underlyingIntent = '表面议价试探，实则寻求心理平衡感与占便宜确信；需确认高价值匹配而非单纯降价。';
    suggestedAction = '🤝 认可预算考量，不破坏价格体系；强调独特服务与质保，赠送高价值配套方案促单。';
    confidence = 92;
  } else if (coreNeed === 'trust') {
    underlyingIntent = '防御性决策焦虑，担心买后踩坑或无售后支撑；迫切需要真实背书与确定性保障。';
    suggestedAction = '🛡️ 出示权威案例或标准质保规则，主动承诺不满意兜底，降低决策防线。';
    confidence = 90;
  } else if (coreNeed === 'speed') {
    underlyingIntent = '对履约时效有紧迫需求，交付确定性是其最终决定下单的核心催化剂。';
    suggestedAction = '⚡ 明确告知现货状态与最快发货批次，建立准时送达预期，顺势催促锁定库存。';
    confidence = 88;
  } else if (coreNeed === 'reassurance') {
    underlyingIntent = '对试错成本敏感，担心选型不符造成损失，渴望零风险体验与退换无忧。';
    suggestedAction = '🤝 重点强调 7 天无忧体验与一对一指导，消除后顾之忧，推动先行尝试。';
    confidence = 89;
  }

  // History boost: if previous messages showed hesitation, refine confidence
  if (history.some(m => m.direction === 'incoming' && /贵|考虑/.test(m.text))) {
    if (coreNeed === 'price') confidence = Math.min(99, confidence + 5);
  }

  return {
    underlyingIntent,
    riskLevel,
    coreNeed,
    suggestedAction,
    confidence,
  };
}

/**
 * Generates three strategic candidate drafts with different tactical postures:
 * - quick: ⚡ 极简短句 (fast ice-breaker, <30 chars)
 * - warm: 🤝 亲和共情 (empathetic, explanatory, relationship-focused)
 * - conversion: 🎯 促单转化 (value-anchoring + call to action)
 */
export function generateTripleCandidates(
  baseReply: string,
  diagnostic: PsychologyDiagnostic,
  customerInput: string
): CandidateDraft[] {
  const cleanBase = baseReply.trim();

  // 1. Quick candidate: extract primary point or construct concise short sentence
  let quickText = '';
  const firstSentence = cleanBase.split(/[。\n！？!?]/).filter(s => s.trim().length > 0)[0] || cleanBase;
  if (firstSentence.length <= 35) {
    quickText = firstSentence.trim();
  } else {
    quickText = firstSentence.slice(0, 32).trim() + '。';
  }
  if (!quickText.endsWith('。') && !quickText.endsWith('！') && !quickText.endsWith('!') && !quickText.endsWith('？') && !quickText.endsWith('?')) {
    quickText += '。';
  }

  // 2. Warm candidate: empathize with the specific customer emotion / need
  let warmPrefix = '明白您的顾虑，';
  if (diagnostic.riskLevel === 'high_risk') {
    warmPrefix = '非常理解您的心情，请您先别着急，';
  } else if (diagnostic.coreNeed === 'price') {
    warmPrefix = '非常理解您对预算的考虑，';
  } else if (diagnostic.coreNeed === 'speed') {
    warmPrefix = '收到，明白您这边时间比较紧迫，';
  } else if (diagnostic.coreNeed === 'trust') {
    warmPrefix = '完全明白您的担心，咱们都是正规质保的，';
  }

  const warmText = cleanBase.startsWith(warmPrefix.slice(0, 4)) ? cleanBase : `${warmPrefix}${cleanBase}`;

  // 3. Conversion candidate: add high-value closing / next-step CTA
  let cta = '方便留个电话，我给您发送专属资料和详细方案吗？';
  if (diagnostic.riskLevel === 'high_risk') {
    cta = '您方便留个联系方式吗？我立即安排专属主管电话为您加急妥善处理！';
  } else if (diagnostic.coreNeed === 'price') {
    cta = '今天定下我还可以帮您向主管申请一份专属配套赠品，您看如何？';
  } else if (diagnostic.coreNeed === 'speed') {
    cta = '现在确认地址的话，我今天第一批次就能帮您安排发出！';
  } else if (diagnostic.coreNeed === 'trust' || diagnostic.coreNeed === 'reassurance') {
    cta = '咱们支持全程技术指导与无忧保障，您可以放心先体验看看！';
  }

  const conversionText = `${cleanBase}\n${cta}`;

  return [
    {
      id: 'quick',
      label: '⚡ 极简短句',
      text: quickText,
      rationale: '适合快速破冰与秒回，打消等待焦虑',
    },
    {
      id: 'warm',
      label: '🤝 亲和共情',
      text: warmText,
      rationale: '先共情再解答，拉近客情关系',
    },
    {
      id: 'conversion',
      label: '🎯 促单转化',
      text: conversionText,
      rationale: '价值锚定并引导下一步行动，推进线索留资',
    },
  ];
}
