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
