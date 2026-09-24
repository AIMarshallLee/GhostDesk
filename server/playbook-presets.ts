import { parseChatTranscript } from './knowledge-import';
import type { PlaybookPack, ChatExtractResult, CustomerLead } from '../shared/types.ts';

export const PRESET_PLAYBOOKS: PlaybookPack[] = [
  {
    id: 'playbook_social_sales',
    category: '私域运营与销售转化',
    name: '私域高情商获客与转化话术包',
    description: '销售沟通示例模板；仅供适配，审核企业事实后再启用。',
    workflow: {
      name: '私域高情商转化流程',
      instructions: '1. 先肯定客户并表达感谢，共情客户顾虑；2. 引用知识库进行价值拆解，禁止生硬推销；3. 给出二选一明确选择，推动加深信任或预约体验。',
      greeting: '您好呀！很高兴认识您，请问是想了解哪方面或者有什么具体需求吗？我随时为您解答~',
    },
    items: [
      {
        title: '私域初次添加破冰第一句',
        content: '示例模板，使用前请按本企业事实审核。先简短自我介绍，再询问客户希望了解的业务；仅介绍知识库已确认的资料，不承诺存在礼包或已发送文件。',
        tags: ['破冰', '加好友', '私域获客'],
      },
      {
        title: '客户嫌贵/要打折的异议化解（价值锚定法）',
        content: '先确认客户预算与需要的服务，再依据本企业已审核的价格、范围和售后规则说明价值。未确认优惠、赠品、延保时请交由负责人核实，不引用虚构客户反馈。',
        tags: ['嫌贵', '打折', '异议化解', '价格'],
      },
      {
        title: '客户对比友商竞品的回应技巧（不踩同行+强化专长）',
        content: '先询问客户比较的具体维度，仅比较可核验的功能、价格、交付和支持范围。缺乏实测时不声称比竞品更稳定、安全或无法识别。',
        tags: ['竞品对比', '友商', '转化'],
      },
      {
        title: '促成下单临门一脚（限时稀缺+降门槛）',
        content: '确认客户仍有哪项疑问，依据有效报价说明下一步。不得编造剩余名额、截止时间、定金金额、退款或保价条件。',
        tags: ['促成', '逼单', '成交'],
      },
      {
        title: '未读未回/沉默客户二次激活话术',
        content: '在客户同意的跟进范围内，询问是否仍需了解此前的问题。仅提供真实存在且已审核的新增资料，不声称刚发布了案例或已经代为操作。',
        tags: ['激活', '沉默客户', '跟进'],
      },
    ],
  },
  {
    id: 'playbook_ecommerce_support',
    category: '电商与客户服务',
    name: '电商极速售后与情绪安抚包',
    description: '售后沟通示例模板；赔付、时效和退换政策必须由企业确认。',
    workflow: {
      name: '电商极速售后流程',
      instructions: '1. 确认客户问题；2. 仅依据已审核政策和已核实订单结果回复；3. 无依据或超出权限时转人工，不虚构处理进度。',
      greeting: '您好，请描述需要协助的售后问题，我先核对适用的处理流程。',
    },
    items: [
      {
        title: '物流停滞/超时未到达安抚话术',
        content: '先询问必要的订单标识并核对已确认的物流记录。没有查询结果时说明需要核实；不得声称已经联系快递、催件或确定补发时间。',
        tags: ['物流', '超时', '快递', '售后'],
      },
      {
        title: '产品破损/质量问题极速先行赔付',
        content: '先确认商品问题及适用售后政策，必要时请客户提供最少必要的描述或图片。补发、赔付、退款时效均以审核政策和实际处理结果为准。',
        tags: ['破损', '退款', '先行赔付', '质量'],
      },
      {
        title: '退换货保姆级流程指引',
        content: '按客户订单渠道与已审核政策说明退换货申请、地址确认和寄回步骤。未核实运费承担、自动回填或退款时间时不要作出承诺。',
        tags: ['退换货', '退货流程', '运费险'],
      },
      {
        title: '情绪化抱怨与差评化解',
        content: '先复述客户遇到的问题，再说明可核实的处理步骤。原因和责任未查明时不要下结论；补偿、优惠券或退款须由有权限的负责人确认。',
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
      instructions: '1. 确认业务场景；2. 只引用可核验且获授权的资料；3. 经客户同意后按实际服务安排下一步沟通。',
      greeting: '您好，感谢关注！我是技术顾问，很高兴能为您评估方案。',
    },
    items: [
      {
        title: '客户需求挖掘提问清单',
        content: '先询问当前业务流程、工作量、关键困难及希望改善的结果；只收集本次评估需要的信息，不默认某个方案适合客户。',
        tags: ['需求调研', '痛点挖掘', '高客单'],
      },
      {
        title: '标杆客户案例与背书介绍',
        content: '只使用得到授权且可核验的客户案例，明确适用背景、统计口径和限制。没有已确认案例时说明尚无可分享数据，不编造效率、响应率、营收或投资回报。',
        tags: ['案例背书', '客户案例', '信任构建'],
      },
      {
        title: '引导留电话/预约专家 15 分钟线上诊断',
        content: '先确认客户是否愿意继续沟通，再按真实服务安排商定渠道和时间。不默认免费咨询、专家排期或会提供定制报告；无需电话即可沟通时不要索取号码。',
        tags: ['留资', '电话预约', '线索转化'],
      },
    ],
  },
];

/**
 * Extracts Q&A knowledge pairs and SOP guidelines from raw chat transcript.
 */
export function extractPlaybookFromChat(transcript: string): ChatExtractResult {
  const parsed = parseChatTranscript(transcript, '本地聊天记录');
  return {
    title: '本地聊天整理（待审核）',
    objection: '按明确的客户与客服角色保留原文，未进行模型分析。',
    strategy: parsed.warnings.join('；') || '请审核适用条件、业务事实和个人信息后启用。',
    suggestedQa: parsed.rows.filter(row => row.question).map(row => ({ title: row.title, question: row.question!, answer: row.content, tags: row.tags })),
    workflowGuidelines: ['只启用业务负责人确认的事实和规则', '无答案或超出权限时澄清或转人工'],
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
