import contract from './tool-contract.json' with { type: 'json' };
import limits from './edit-policy.json' with { type: 'json' };
function resolve(value) {
  if (Array.isArray(value)) return value.map(resolve);
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && value.$limit) {
      const key = value.$limit;
      return key.startsWith('-') ? -limits[key.slice(1)] : limits[key];
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]));
  }
  return value;
}
export const toolContract = resolve(contract);
export function validateToolArguments(name, value) {
  const tool = toolContract.tools.find((entry) => entry.name === name);
  if (!tool) throw new Error('지원하지 않는 도구입니다.');
  validate(value, tool.inputSchema);
}
function validate(value, rule) {
  if (rule.oneOf) {
    const matches = rule.oneOf.filter((option) => {
      try {
        validate(value, option);
        return true;
      } catch {
        return false;
      }
    });
    if (matches.length !== 1) throw new Error('작업 형식이 올바르지 않습니다.');
    return;
  }
  if ('const' in rule && value !== rule.const) throw new Error('값이 일치하지 않습니다.');
  if (rule.enum && !rule.enum.includes(value)) throw new Error('지원하지 않는 값입니다.');
  const fail = () => {
    throw new Error('도구 입력 형식 또는 한도를 확인해 주세요.');
  };
  if (rule.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
    for (const key of rule.required || []) if (!Object.hasOwn(value, key)) fail();
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(rule.properties || {}, key)) {
        if (rule.additionalProperties === false) fail();
      } else validate(item, rule.properties[key]);
    }
  } else if (rule.type === 'array') {
    if (
      !Array.isArray(value) ||
      value.length < (rule.minItems ?? 0) ||
      value.length > (rule.maxItems ?? Infinity)
    )
      fail();
    for (const item of value) validate(item, rule.items);
  } else if (rule.type === 'string') {
    if (
      typeof value !== 'string' ||
      [...value].length < (rule.minLength ?? 0) ||
      [...value].length > (rule.maxLength ?? Infinity)
    )
      fail();
  } else if (rule.type === 'boolean') {
    if (typeof value !== 'boolean') fail();
  } else if (rule.type === 'number' || rule.type === 'integer') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (rule.type === 'integer' && !Number.isInteger(value)) ||
      value < (rule.minimum ?? -Infinity) ||
      value > (rule.maximum ?? Infinity)
    )
      fail();
  }
}
