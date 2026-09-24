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
  {
    id: 'playbook_wecom_sales',
    category: '企业微信与私域促单',
    name: '企微专属销冠转化与促单话术包',
    description: '专为企业微信打造的高转化破冰、深度场景挖掘、限时活动促单与沉淀微信好友。',
    workflow: {
      name: '企业微信高转化促单流程',
      instructions: '1. 专业亲和力开场，明确能帮客户解决的核心问题；2. 针对客户提及的行业与预算给出针对性参考；3. 适时给出限时权益，引导进入下一步评估或电话深入。',
      greeting: '您好呀！我是官方专属顾问，很高兴为您服务。请问目前主要是想了解哪块业务需求呢？',
    },
    items: [
      {
        title: '企微通过好友第一句话（价值交付法）',
        content: '话术原则：不发长篇大论广告，传递专业感+赠送独家干货资料。\\n示例：您好呀！非常高兴认识您~ 我是这边的产品顾问。看您刚关注我们的系统，我先给您发一份我们团队整理的【行业核心实操白皮书与避坑指南】，您可以先对照看看。平时有任何技术或方案问题随时发我，看到第一时间回您！',
        tags: ['企微破冰', '加好友', '价值交付'],
      },
      {
        title: '挖掘客户痛点与预算（温和探针法）',
        content: '话术原则：避免审讯式提问，通过二选一和场景共情引导客户开口。\\n示例：特别理解您的考虑！其实大部分同行业伙伴在找方案时，最头疼的就是前期部署周期太长或者后期容易被风控封号。您目前主要是希望先在单台设备小规模跑通，还是直接搭建多窗口多客服的自动化矩阵呢？',
        tags: ['需求调研', '痛点挖掘', '预算摸底'],
      },
      {
        title: '限时权益逼单与促成（无风险承诺法）',
        content: '话术原则：制造合理的稀缺性，降低决策心理防线。\\n示例：刚好本月我们为首批上线的企业客户预留了专属一对一工程师远程陪跑权益（仅限前5家）。您今天先确定下来，不仅能保价享受早鸟权益，如果上线两周内达不到您预期的自动化效果，我们承诺无条件全额退款，绝对不让您承担任何试错成本！',
        tags: ['促成', '逼单', '无风险承诺'],
      },
    ],
  },
  {
    id: 'playbook_wechat_vip',
    category: '微信大客户与VIP咨询',
    name: '微信高净值大客户专属顾问话术包',
    description: '针对高客单定制、高端企业客户的顾问式沟通、信任塑造与专家深度诊断预约。',
    workflow: {
      name: '大客户顾问式深度诊断流程',
      instructions: '1. 尊重大客户时间，直奔核心价值与架构实力；2. 展示真实硬核技术护城河（如物理防封、私有化部署）；3. 邀约15分钟技术专家线上方案评审。',
      greeting: '您好！我是大客户解决方案负责人。感谢您的垂询，请问贵司目前具体的业务场景是怎样的？我为您做针对性评估。',
    },
    items: [
      {
        title: '大客户核心关切：安全与风控合规解答',
        content: '话术原则：从底层硬件架构与私有化数据安全维度给出降维打击式回答。\\n示例：老板您的顾虑非常专业！这也是为什么市面上常规的软件注入工具我们一概不用。我们核心采用的是全自研硬件级 USB HID 物理透传架构，对宿主系统来说完全等同于真人外接物理键鼠，从物理层杜绝封号；同时数据支持100%本地私有化，不上传任何外部云端，充分满足企业合规审计。',
        tags: ['大客户', '安全合规', '物理防封', '技术壁垒'],
      },
      {
        title: '邀约首席架构师 15 分钟深度线上评审',
        content: '话术原则：提供极高专业价值的诊断会议，不推销，重在解决痛点。\\n示例：您现在的业务复杂度比较高，打字沟通可能不够直接全面。明天下午 3 点或周四上午 10 点，我们安排首席技术架构师为您做一次 15 分钟的线上架构诊断评审，帮您梳理一份定制化的落地路线图。您看这两个时间哪个更方便您？',
        tags: ['专家诊断', '线上会议', '大客户跟进'],
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
