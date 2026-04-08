import type { SelfCheckItem } from './types';

export interface HumanIssue {
  techLabel: string;
  humanText: string;
}

function afterColon(text: string) {
  const idx = text.indexOf(':');
  return idx >= 0 ? text.slice(idx + 1).trim() : text.trim();
}

export function explainSelfCheckItem(item: SelfCheckItem): HumanIssue {
  switch (item.code) {
    case 'file.missing': {
      const filename = afterColon(item.message);
      return {
        techLabel: `文件缺失 ${filename}`,
        humanText: `插件目录里没有找到 ${filename}。相关功能可能无法正常工作，请先确认目录是否选对，或者把缺少的文件补回来。`,
      };
    }
    case 'json.invalid': {
      return {
        techLabel: 'JSON 解析失败',
        humanText: `${afterColon(item.message)}。这表示文件内容已经不是合法 JSON，GUI 和插件都可能无法正确读取它，建议先修正格式再继续。`,
      };
    }
    case 'usageEvents.file.missing':
      return {
        techLabel: '用量事件日志缺失',
        humanText: '没有找到 usage_events.json。聊天和图像的长期图表、统一用量事件排查与趋势统计会不完整。可以先自动修复补一个空文件，后续等插件继续运行累积数据。',
      };
    case 'usageEvents.structure.invalid':
      return {
        techLabel: '用量事件日志结构错误',
        humanText: 'usage_events.json 不是插件现在预期的结构。GUI 无法稳定读取这份日志，统一图表和排障信息都可能失真，建议先修正文件结构。',
      };
    case 'usageEvents.all-invalid':
      return {
        techLabel: '用量事件全部无效',
        humanText: '这份 usage_events.json 里虽然有数据，但关键字段已经坏到无法可靠统计。继续拿它做图表或判断限额趋势都不可信，建议先备份，再让插件重新生成新的有效日志。',
      };
    case 'usageEvents.invalid-events':
      return {
        techLabel: '用量事件部分损坏',
        humanText: '统一用量事件日志里混入了格式不对的记录。当前 GUI 只能跳过这些坏记录继续统计，所以图表和明细可能已经有轻微偏差。',
      };
    case 'usageEvents.near-retention-limit':
      return {
        techLabel: '用量事件接近保留上限',
        humanText: '统一用量事件日志已经快到最近 10000 条的保留上限。再继续使用时，更早的历史记录会被自动裁剪；如果你要做长期分析，最好先备份。',
      };
    case 'usageEvents.future-timestamp':
      return {
        techLabel: '用量事件时间异常',
        humanText: '日志里有一部分事件时间明显比当前系统时间更靠后，这通常意味着系统时钟、时区或写入时间出了问题，后续时间分布图可能不准。',
      };
    case 'usageEvents.denied-spike':
      return {
        techLabel: '用量拒绝比例偏高',
        humanText: '最近一段时间里，被权限、配额或其他规则拒绝的请求比例偏高。通常说明黑白名单、群总额度、个人额度，或者图像节点配置正在频繁拦请求，建议优先排查这些规则。',
      };
    case 'usageEvents.request-failed-spike':
      return {
        techLabel: '下游请求失败偏多',
        humanText: '最近一段时间里，真实的 request-failed 事件明显偏多。这通常不是用户参数问题，而是节点健康度、代理、API 或下游服务稳定性在掉链子。',
      };
    case 'index.activeApiIndex':
      return {
        techLabel: 'Active API Index 越界',
        humanText: '当前默认 API 指向了一个不存在的节点，建议改回现有节点编号。',
      };
    case 'type.activeApiIndex':
      return {
        techLabel: 'Active API Index 类型错误',
        humanText: '当前默认 API 编号不是有效数字，建议改成现有节点编号。',
      };
    case 'index.activeGroupPersonalityIndex':
      return {
        techLabel: 'Active Group Personality Index 越界',
        humanText: '当前默认群聊人格指向了一个不存在的人格，建议改回现有人格编号。',
      };
    case 'type.activeGroupPersonalityIndex':
      return {
        techLabel: 'Active Group Personality Index 类型错误',
        humanText: '当前默认群聊人格编号不是有效数字，建议改成现有人格编号。',
      };
    case 'index.activePrivatePersonalityIndex':
      return {
        techLabel: 'Active Private Personality Index 越界',
        humanText: '当前默认私聊人格指向了一个不存在的人格，建议改回现有人格编号。',
      };
    case 'type.activePrivatePersonalityIndex':
      return {
        techLabel: 'Active Private Personality Index 类型错误',
        humanText: '当前默认私聊人格编号不是有效数字，建议改成现有人格编号。',
      };
    case 'schema.unknown-fields':
      return {
        techLabel: 'Runtime Config 未知字段',
        humanText: '配置文件里出现了当前 schema 不认识的字段。通常是旧字段残留、手工拼写错误，或者配置文件版本和插件版本不一致，建议打开配置编辑页查看迁移提醒。',
      };
    case 'schema.deprecated-fields':
      return {
        techLabel: 'Runtime Config 已废弃字段',
        humanText: '配置文件里还保留了旧字段。它们可能暂时还能被忽略，但建议尽快迁移到当前字段，避免以后升级时出问题。',
      };
    default:
      return {
        techLabel: item.code,
        humanText: item.message,
      };
  }
}
