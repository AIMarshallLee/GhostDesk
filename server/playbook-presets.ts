import type { PlaybookPack, ChatExtractResult, CustomerLead } from '../shared/types.ts';

export const PRESET_PLAYBOOKS: PlaybookPack[] = [
  {
    id: 'playbook_social_sales',
    category: '私域运营与销售转化',
    name: '私域高情商获客与转化话术包',
    description: '针对即时通讯私域好友的高情商破冰、异议化解、价值锚定与促成定金成交。',
    workflow: {
      name: '私域高情商转化流程',
      instructions: '1. 先肯定客户并表达感谢，共情客户顾虑；2. 引用知识库进行价值拆解，禁止生硬推销；3. 给出二选一明确选择，推动加深信任或预约体验。',
      greeting: '您好呀！很高兴认识您，请问是想了解哪方面或者有什么具体需求吗？我随时为您解答~',
    },
    items: [
      {
        title: '私域初次添加破冰第一句',
        content: '话术原则：不直接发广告，先自我介绍+提供轻量价值礼包。\n示例： 您好呀！感谢关注，我是这里的咨询顾问。我整理了一份【新人避坑与实用入门清单】，稍后直接发给您参考，平时有什么问题随时微信随时找我~',
        tags: ['破冰', '加好友', '私域获客'],
      },
      {
        title: '客户嫌贵/要打折的异议化解（价值锚定法）',
        content: '话术原则：不直接拒绝也不直接降价，先赞赏眼光，再拆解价值与全生命周期成本。\n示例：特别理解您的想法，谁都想把钱花在刀刃上！其实不少老客户一开始也这么觉得，但体验后都反馈我们的用料/响应速度/售后质保省心太多。现在刚好有专属会员赠礼，今天订下可以额外为您锁定一年延保，您看如何？',
        tags: ['嫌贵', '打折', '异议化解', '价格'],
      },
      {
        title: '客户对比友商竞品的回应技巧（不踩同行+强化专长）',
        content: '话术原则：肯定友商品牌，突出我方差异化优势与核心技术护城河。\n示例：您提到的那家确实也很优秀！我们的差异在于核心采用全自研物理级架构，稳定性更高，且支持无缝定制。如果您的核心诉求是长期省心与安全，我们绝对是最合适的选择。',
        tags: ['竞品对比', '友商', '转化'],
      },
      {
        title: '促成下单临门一脚（限时稀缺+降门槛）',
        content: '话术原则：制造合理的紧迫感，提供定金保价或体验门槛。\n示例：刚好本周批次仅剩最后 2 个专属扶持名额，您可以先支付 50 元定金锁定活动权益，不满意随时全额退还，避免错过本轮福利哦。',
        tags: ['促成', '逼单', '成交'],
      },
      {
        title: '未读未回/沉默客户二次激活话术',
        content: '话术原则：不施压，提供增量新信息或行业最新动态轻量唤醒。\n示例：哈喽朋友，前两天看您咨询过方案，今天正好官方刚更新了最新实操案例库，里面有几个同行成功的落地模板，顺手发您参考下，没准对您有启发！',
        tags: ['激活', '沉默客户', '跟进'],
      },
    ],
  },
  {
    id: 'playbook_ecommerce_support',
    category: '电商与客户服务',
    name: '电商极速售后与情绪安抚包',
    description: '涵盖物流异常排查、质量破损先行赔付、退换货保姆级指引与差评化解。',
    workflow: {
      name: '电商极速售后流程',
      instructions: '1. 先向客户诚恳致歉并共情情绪；2. 极速调取订单并给出明确处理时效；3. 优先执行先行补发或赔付，杜绝扯皮推诿。',
      greeting: '您好，非常抱歉让您久等了！您的售后问题由我全权跟进到底，请放心。',
    },
    items: [
      {
        title: '物流停滞/超时未到达安抚话术',
        content: '话术原则：主动承担责任，快速核查并提供兜底赔偿承诺。\n示例：真的非常抱歉给您添麻烦了！我刚刚已加急联系顺丰/中通专员为您拦截催件。如果明天上午 11 点前物流信息仍未更新，我们无条件为您立即免费补发一份顺丰特快！',
        tags: ['物流', '超时', '快递', '售后'],
      },
      {
        title: '产品破损/质量问题极速先行赔付',
        content: '话术原则：不要求复杂质检流程，拍照即赔，让客户感到被信任。\n示例：看到图片了，确实有破损，给您的体验大打折扣真的很愧疚！请您无需将破损件寄回，我现在立刻帮您申请补发全新原装件/直接退还对应差价，款项预计10分钟内原路退回。',
        tags: ['破损', '退款', '先行赔付', '质量'],
      },
      {
        title: '退换货保姆级流程指引',
        content: '话术原则：用编号排版清晰说明寄回地址、运费险与单号填写步骤。\n示例：为您整理了最省心的退货步骤：1. 在订单中申请退货退款；2. 包装完好后选择上门取件（平台自带运费险免运费）；3. 寄出后系统自动回填单号，收到后 1 小时内极速退款完毕。',
        tags: ['退换货', '退货流程', '运费险'],
      },
      {
        title: '情绪化抱怨与差评化解',
        content: '话术原则：情绪先于事实，倾听+肯定客户委屈+给出超出预期的补偿。\n示例：非常能理解您的气愤，换成是我遇到这种情况也会特别生气！这件事确实是我们品控细节失误，除了给您全额处理退货，主管特批为您补赠一张 30 元无门槛优惠券，真心希望您能再给我们一次证明的机会。',
        tags: ['差评', '投诉', '情绪安抚'],
      },
    ],
  },
  {
    id: 'playbook_high_ticket_consulting',
    category: '高客单与商务咨询',
    name: '高端商务咨询与电话预约包',
    description: '适合企业服务、定制开发、咨询培训等高客单业务的需求挖掘与电话预约。',
    workflow: {
      name: '商务咨询与留资预约流程',
      instructions: '1. 聚焦客户业务场景与实际痛点；2. 给出行业案例与解题思路；3. 邀请添加业务微信或留电话预约 15 分钟专家深度诊断。',
      greeting: '您好，感谢关注！我是技术顾问，很高兴能为您评估方案。',
    },
    items: [
      {
        title: '客户需求挖掘提问清单',
        content: '话术原则：通过开放式提问引导客户说出痛点和业务现状。\n示例：为了更贴合您的业务场景，我想先请教下：您目前这个流程每天大概需要处理多少条数据/多少个会话？主要卡点是在人力成本高还是响应速度跟不上呢？',
        tags: ['需求调研', '痛点挖掘', '高客单'],
      },
      {
        title: '标杆客户案例与背书介绍',
        content: '话术原则：给出同行业类似痛点企业的真实落地数据对比。\n示例：我们上个月刚为一家同类型华南电商团队完成了交付，他们此前 5 个人轮班处理微信咨询，上线后一人即可监管 10 台客户端，首周客户响应率提升至 99.2%，直接省去夜班人力。',
        tags: ['案例背书', '客户案例', '信任构建'],
      },
      {
        title: '引导留电话/预约专家 15 分钟线上诊断',
        content: '话术原则：提供免费高价值评估，降低沟通摩擦。\n示例：文字沟通细节比较多，方便留一个您的手机号码或者微信号吗？我们资深架构师明天可以为您做一次 15 分钟的免费技术可行性与 ROI 评估，还会给您一份定制的方案建议书。',
        tags: ['留资', '电话预约', '线索转化'],
      },
    ],
  },
];

/**
 * Extracts Q&A knowledge pairs and SOP guidelines from raw chat transcript.
 */
export function extractPlaybookFromChat(transcript: string): ChatExtractResult {
  const lines = transcript.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const questions: string[] = [];
  const answers: string[] = [];
  
  for (const line of lines) {
    if (/[?？]|多少钱|能不能|怎么|贵|打折|优惠|售后|发货|退货/.test(line)) {
      questions.push(line.replace(/^(客户|买家|咨询者|用户)[:：]\s*/, ''));
    } else if (/[!！。]|好的|可以|支持|我们|保证|退款|补发|安排/.test(line)) {
      answers.push(line.replace(/^(客服|销售|金牌|我|顾问)[:：]\s*/, ''));
    }
  }

  const suggestedQa: ChatExtractResult['suggestedQa'] = [];
  const count = Math.min(questions.length, answers.length, 5);

  if (count > 0) {
    for (let i = 0; i < count; i++) {
      const q = questions[i];
      const a = answers[i];
      suggestedQa.push({
        title: `实战萃取：${q.slice(0, 15)}...`,
        question: q,
        answer: a,
        tags: ['实战聊天萃取', '高转化问答'],
      });
    }
  } else {
    // Fallback if formatting was not strictly turn-by-turn
    suggestedQa.push({
      title: '实战对话核心问答萃取',
      question: questions[0] || '客户咨询业务核心细节与办理流程',
      answer: answers[0] || transcript.slice(0, 300),
      tags: ['实战聊天萃取'],
    });
  }

  return {
    title: '金牌实战话术萃取',
    objection: '客户重点关注性价比、响应时效及可靠性',
    strategy: '先认同客户痛点，再陈述产品价值，最后给出明确下一步指引',
    suggestedQa,
    workflowGuidelines: [
      '保持亲和积极的沟通语气，多用标点和语气词拉近距离',
      '优先解答核心疑问，不兜圈子；适时提出二选一引导意向',
      '涉及资金和退换保障时给出明确时间节点，打消顾虑',
    ],
  };
}

/**
 * Automatically classifies customer intent and extracts lead attributes from conversation.
 */
export function qualifyLeadFromText(conversationName: string, text: string): CustomerLead {
  const normalized = text.toLowerCase();
  
  let intent: CustomerLead['intent'] = 'low';
  if (/退款|投诉|差评|欺诈|报警|曝光|骗子/.test(normalized)) {
    intent = 'complaint';
  } else if (/下单|定金|付款|购买|合同|签约|怎么买|转账|微信多少|马上要/.test(normalized)) {
    intent = 'high';
  } else if (/多少钱|价格|报价|贵|优惠|折扣|对比|哪家好/.test(normalized)) {
    intent = 'medium';
  }

  // Extract phone number (Chinese mobile phone 13x-19x)
  const phoneMatch = text.match(/(?:1[3-9]\d{9})/);
  const phone = phoneMatch ? phoneMatch[0] : undefined;

  // Extract potential WeChat ID
  const wechatMatch = text.match(/(?:微信号?(?:是|为|：|:|\s)*)([a-zA-Z][-_a-zA-Z0-9]{4,29})/);
  const wechatId = wechatMatch ? wechatMatch[1] : undefined;

  // Extract budget mentions
  const budgetMatch = text.match(/(\d+(?:\.\d+)?(?:万|千|k|元|块))/i);
  const budget = budgetMatch ? budgetMatch[0] : undefined;

  // Extract pain point
  let painPoint = '咨询产品基础规格与价格';
  if (/贵|价格/.test(text)) painPoint = '对价格预算较为敏感，关注优惠';
  else if (/快|加急|时间|多久/.test(text)) painPoint = '对交付时效要求较高';
  else if (/售后|质保|保修|坏了/.test(text)) painPoint = '注重售后保障与长期稳定性';

  let nextStep = '发送标准产品资料，保持跟进';
  if (intent === 'high') nextStep = '🔥 立即人工介入，发送收款码或合同促成定金';
  else if (intent === 'complaint') nextStep = '⚠️ 优先情绪安抚，电话或极速先行处理';
  else if (intent === 'medium') nextStep = '发送限时专属优惠与价值对比表';

  return {
    id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    conversationName,
    intent,
    phone,
    wechatId,
    budget,
    painPoint,
    nextStep,
    updatedAt: new Date().toISOString(),
  };
}
