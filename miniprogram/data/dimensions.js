// 自动生成, 来源: 01-指标体系.json (v0.3)
// 6 个能力维度, 含 id/code/name/name_en/tagline/weight/abilities
module.exports = [
  {
    "id": "D1",
    "code": "AI_COMM",
    "name": "AI 沟通能力",
    "name_en": "AI Communication",
    "tagline": "把业务诉求翻译成 AI 能听懂的指令",
    "weight": 0.18,
    "abilities": [
      "受众识别 (受众决定表达方式)",
      "目标定义 (回答什么 / 不回答什么)",
      "约束声明 (格式 / 字数 / 语气 / 受众)",
      "上下文注入 (背景 / 角色 / 既有材料)"
    ]
  },
  {
    "id": "D2",
    "code": "TASK_DECOMP",
    "name": "任务拆解能力",
    "name_en": "Task Decomposition",
    "tagline": "把模糊目标拆成可顺序执行的子任务",
    "weight": 0.17,
    "abilities": [
      "问题驱动 (先问'要回答什么'再选方法)",
      "子任务分解 (粒度合理 / 依赖清晰)",
      "解耦与并行 (不同模块分别处理再整合)",
      "完成标准前置 (DoD: Definition of Done)"
    ]
  },
  {
    "id": "D3",
    "code": "PROCESS_DESIGN",
    "name": "流程选择能力",
    "name_en": "Process Design",
    "tagline": "为不同风险/复杂度的任务选择合适的协作流程",
    "weight": 0.17,
    "abilities": [
      "一次成型 vs 分阶段 (按任务分级)",
      "节点化质量门禁 (关键节点检查方向)",
      "解耦-汇总流程 (避免错误累积到最后)",
      "风险分级 (低风险一次出 / 高风险分段确认)"
    ]
  },
  {
    "id": "D4",
    "code": "QUALITY_CTRL",
    "name": "质量管控能力",
    "name_en": "Quality Control",
    "tagline": "对 AI 输出做有重点的核查与修正",
    "weight": 0.16,
    "abilities": [
      "决策驱动核验 (先想用来做什么决策)",
      "影响范围判断 (错在哪里 / 会不会改结论)",
      "原文/真值回查 (数字/引用/事实)",
      "经验沉淀为检查清单 (按类型迭代)"
    ]
  },
  {
    "id": "D5",
    "code": "RISK_AWARE",
    "name": "风险应对能力",
    "name_en": "Risk Awareness",
    "tagline": "识别对外/合规/承诺类内容的风险并分级处置",
    "weight": 0.16,
    "abilities": [
      "风险点识别 (承诺/价格/合同/数据出处)",
      "信息分级处理 (按类型调整检查重点)",
      "口径披露 (待确认/估算 vs 确定事实)",
      "时效-风险平衡 (紧急但有风险时如何处置)"
    ]
  },
  {
    "id": "D6",
    "code": "REUSE",
    "name": "经验复用能力",
    "name_en": "Experience Reuse",
    "tagline": "把一次性的好做法沉淀为可被自己和他人复用的资产",
    "weight": 0.16,
    "abilities": [
      "分类资产化 (按任务类型整理模板/问法)",
      "差异分析 (上次哪些步骤这次仍可用)",
      "隐性经验显性化 (可观察标准 vs 直觉)",
      "外化与反馈迭代 (给别人用, 按反馈改进)"
    ]
  }
];
